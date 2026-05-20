# SimpleBond v0.6 Core Spec

This document describes the intended behavior of `SimpleBondV6`, the next iteration of the bond core, targeting Ethereum mainnet.

## Overview

`v0.6` extends the `v0.5` model to support evolving claims, per-challenge concession with money-neutral semantics, individual challenge dismissal by the judge, per-challenge timing, a poster-controlled close/open toggle, and a bound on total challenges. It also moves the canonical deployment from Gnosis to Ethereum mainnet and uses sUSDS as the launch token.

## Changes from v0.5

Added:

- `claimVersion` and `modifyClaim`
- `expectedVersion` argument on `challenge`
- per-challenge concession: `concede(bondId, challengeIndex, content)`
- `rejectChallenge(bondId, challengeIndex, content)` for judge-initiated out-of-scope refund
- `closeBond` / `openBond` toggle
- `maxChallenges` cap
- ruling functions accept a `content` argument
- claim, challenge, ruling, concession, rejection metadata represented on-chain as `bytes32` content hash with raw content emitted in events
- profile registries for posters and challengers; judge profile snapshotted into the bond at creation
- per-challenge ruling window
- judge may rule challenges in any order

Removed:

- bond-wide concession (replaced by per-challenge)
- the single `currentChallenge` pointer and strict FIFO ruling order
- bond-level `lastChallengeTime` (each challenge stores its own timestamp)
- the bond `deadline` parameter; the bond lifecycle is fully event-driven (closed, withdrawn, settled), with no time-based wind-down

Unchanged from v0.5:

- bond financial parameters (`bondAmount`, `challengeAmount`, `judgeFee`, `judge`, `token`, `acceptanceDelay`, `rulingBuffer`) are immutable after creation
- judge contract is the only authority that may rule, reject, or dismiss
- timeout-refund liveness fallback
- post-poster-win bond survival
- standard ERC-20 token assumptions (no fee-on-transfer, no rebasing)
- bounded-batch refund claim pattern

## Roles

- `poster`: creates the bond, locks `bondAmount`, may modify claim text, may concede individual challenges, may close and re-open the bond
- `challenger`: locks `challengeAmount` against a specific claim version
- `judge contract`: sole authority for `ruleForPoster`, `ruleForChallenger`, `rejectChallenge`, `rejectBond`
- `judge operator`: off-chain actor authorized by the judge contract
- all three roles may register profiles in the corresponding append-only profile registry

## Bond Creation

The poster creates a bond with:

- `token`
- `bondAmount`
- `challengeAmount`
- `judgeFee`
- `judge`
- `acceptanceDelay`
- `rulingBuffer`
- `maxChallenges`
- `claimContent` (raw bytes, hashed)
- `judgeProfileId` (entry id in `JudgeProfileRegistry`)

Creation rules carry over from v0.5 plus:

- `maxChallenges > 0`
- the `judgeProfileId` references an existing registry entry, and that entry points to the same `judge` address
- the judge contract accepts the proposed terms via `validateBond(...)`

State stored:

- `claimHash = keccak256(claimContent)`
- `claimVersion = 1`
- `closed = false`
- `judgeProfileId`

Event: `BondCreated(bondId, poster, judge, judgeProfileId, token, bondAmount, challengeAmount, judgeFee, acceptanceDelay, rulingBuffer, maxChallenges, claimHash, claimContent)`.

The poster transfers `bondAmount` into the bond contract.

`validateBond` is a creation-time term-acceptance probe with the same semantics as v0.5.

## Claim Versioning

The poster may call `modifyClaim(bondId, newContent)` only when:

- caller is the poster
- bond is not settled
- no pending challenges exist

Effect:

- `claimHash = keccak256(newContent)`
- `claimVersion += 1`
- event `ClaimModified(bondId, oldVersion, newVersion, oldHash, newHash, newContent)`

Modification does not change any financial parameter.

## Challenges

Any address may call `challenge(bondId, expectedVersion, content)` when:

- bond is not settled
- `!closed`
- `challenges[bondId].length < maxChallenges`
- `bond.claimVersion == expectedVersion`

Each challenge stores:

- `challenger`
- `metadataHash = keccak256(content)`
- `challengeAtVersion = expectedVersion`
- `claimHashAtChallenge = bond.claimHash`
- `timestamp = block.timestamp`
- `status = pending`

Event: `Challenged(bondId, challengeIndex, challenger, expectedVersion, claimHashAtChallenge, metadataHash, content)`.

The challenge list is append-only. Ruling order is unconstrained.

The `expectedVersion` check makes claim modification + concurrent challenge collision-safe: any modification between broadcast and inclusion reverts the challenge.

The `maxChallenges` cap is on **total challenges filed ever**, not on the pending set. Dismissed and resolved challenges still consume cap slots. (See [Open Questions](#open-questions).)

## Concession Window

Per-challenge:

```text
concessionDeadline(bondId, i) = challenges[i].timestamp + acceptanceDelay
```

The poster may call `concede(bondId, i, content)` while challenge `i` is `pending` and `block.timestamp <= concessionDeadline(bondId, i)`.

Concession is money-neutral for the poster.

## Concession Outcome

When the poster concedes challenge `i`:

- challenge `i` status set to `conceded`
- challenger `i` becomes refundable for `challengeAmount`
- poster pays nothing
- judge receives nothing
- bond is not settled; other challenges and the bond continue
- event `ClaimConceded(bondId, i, poster, content)`

Each pending challenge must be conceded individually. There is no bond-wide concession in v0.6.

## Judge Resolution

The judge contract may call:

- `ruleForPoster(bondId, i, feeCharged, content)`
- `ruleForChallenger(bondId, i, feeCharged, content)`
- `rejectChallenge(bondId, i, content)`
- `rejectBond(bondId, content)`

`ruleForPoster` and `ruleForChallenger` are gated by the per-challenge ruling window:

```text
rulingWindowStart(bondId, i) = challenges[i].timestamp + acceptanceDelay
rulingDeadline(bondId, i) = rulingWindowStart(bondId, i) + rulingBuffer
```

`rejectChallenge` and `rejectBond` are not gated by the ruling window and may be called at any time before settlement, including before `rulingWindowStart` for the targeted challenge.

The judge may rule challenges in any order.

## `ruleForPoster`

When the judge rules for the poster on challenge `i`:

- challenge `i` status set to `lost`
- poster receives `challengeAmount - feeCharged`
- judge contract receives `feeCharged`
- bond stays active
- event `RuledForPoster(bondId, i, challenger, feeCharged, content)`

## `ruleForChallenger`

When the judge rules for challenger `i`:

- challenge `i` status set to `won`
- challenger `i` receives `bondAmount + challengeAmount - feeCharged`
- judge contract receives `feeCharged`
- bond is settled
- all other `pending` challenges become refundable for `challengeAmount`
- no further challenges or rulings are accepted
- event `RuledForChallenger(bondId, i, challenger, feeCharged, content)`

## `rejectChallenge`

The judge contract may dismiss any individual challenge as out-of-scope:

- challenge `i` status set to `rejectedByJudge`
- challenger `i` becomes refundable for `challengeAmount`
- judge receives nothing
- bond is not settled; other challenges and the bond continue
- event `ChallengeRejected(bondId, i, challenger, content)`

There is no on-chain cap on the number of `rejectChallenge` calls per bond. Spam protection is delegated to the judge's policy and reputation, consistent with the v0.5 model in which the judge is trusted.

## `rejectBond`

The judge contract may void the entire bond:

- bond is settled
- poster receives the full `bondAmount`
- all `pending` challenges become refundable for `challengeAmount`
- judge receives nothing
- no further challenges or rulings are accepted
- event `BondRejectedByJudge(bondId, judge, content)`

Already-finalized challenges (`won`, `lost`, `conceded`, `rejectedByJudge`) are not unwound.

## Close / Open

`closeBond(bondId)`:

- caller is the poster, bond is not settled, `!closed`
- sets `closed = true`
- blocks new `challenge` calls
- existing pending challenges remain active including their concession and ruling windows
- event `BondClosed(bondId)`

`openBond(bondId)`:

- caller is the poster, bond is not settled, `closed`
- sets `closed = false`
- event `BondOpened(bondId)`

Closing and re-opening do not affect `claimVersion` or any financial parameter.

## Poster Withdrawal

The poster may call `withdrawBond(bondId)` only when:

- caller is the poster
- bond is not settled
- `closed`
- no pending challenges

Effect:

- poster receives the full `bondAmount`
- bond is settled
- no re-opening or further activity is allowed

The bond has no time-based withdrawal gate; the poster controls termination via `closeBond`.

## Timeout

If the per-challenge ruling deadline passes while challenge `i` is still `pending`:

```text
block.timestamp > rulingDeadline(bondId, i) && challenges[i].status == pending
```

then anyone may call `claimTimeout(bondId, i)`. Effect mirrors `rejectBond`:

- bond is settled
- poster receives the full `bondAmount`
- all `pending` challenges become refundable for `challengeAmount`
- judge receives nothing
- event `BondTimedOut(bondId, i)`

A timeout triggered by any individual challenge terminates the bond. Already-finalized challenges are not unwound. This is the liveness fallback against judge inaction; it intentionally fires at the granularity of any single missed window so the judge cannot indefinitely starve one challenge while servicing others.

## Refund Claims

Finalization (challenger win, bond reject, timeout, individual concession or challenge rejection) marks challenges refundable without performing transfers, to avoid unbounded loops.

- `claimRefunds(bondId, maxCount)` processes a bounded batch
- each refund pays the original challenger `challengeAmount`
- refundable challenges may be non-contiguous (statuses `conceded` and `rejectedByJudge` accumulate during the bond's life; `pending` entries become refundable on bond-wide settlement)
- the implementation iterates the challenge array bounded by `maxCount`

## Profile Registries

Three append-only registries:

- `JudgeProfileRegistry` (extended from v0.5)
- `PosterProfileRegistry` (new)
- `ChallengerProfileRegistry` (new)

Each exposes:

- `registerProfile(content) -> entryId`
- `getProfile(entryId) -> (owner, contentHash, content)`

Entries are immutable once written. Updating a profile creates a new `entryId`. Old entries remain readable forever.

Snapshot semantics:

- bond stores `judgeProfileId` at creation: observers can resolve the judge's stated criteria as of bond creation, immune to later judge profile edits
- challenge does **not** snapshot the challenger profile
- bond does **not** snapshot the poster profile

Rationale: only the judge makes a forward-looking policy promise that the poster and challengers rely on. Snapshotting posters and challengers adds storage without protecting an economic guarantee.

## Metadata Storage Model

All free-form metadata fields (claim content, challenge content, ruling content, concession content, rejection content, profile content) follow the same pattern:

- caller passes the raw `content` bytes
- contract computes `keccak256(content)` and stores the hash in the corresponding struct field
- contract emits an event containing both the hash and the raw content

This minimizes storage gas on mainnet while keeping a tamper-evident on-chain reference (hash in storage) and the full content reproducible from event logs.

Callers may use the `content` slot to embed a URI (e.g. `ipfs://...` or `https://...`) when the content is large enough that event-data gas of inline storage is unacceptable. The contract treats it as opaque bytes either way.

## Mainnet Deployment

- chain: Ethereum mainnet (chain id 1)
- canonical token: sUSDS; `OfficialBondDirectory` curates the approved-token list and may add others (DAI, USDC, USDS, WETH, etc.)
- registries (`JudgeRegistry`, `JudgeProfileRegistry`, `PosterProfileRegistry`, `ChallengerProfileRegistry`, `OfficialBondDirectory`): EOA owner/admin at launch, transferable; migration to multisig is expected but not gated on launch
- existing Gnosis v0.5 deployment is retired; the frontend redirects to mainnet only

Frontend and notification backend configuration:

- `CHAINS[1]` replaces `CHAINS[100]`
- `runtime-config.js` keys rename `gnosis*` → `mainnet*`
- backend `startBlock` set to the mainnet deployment block

## Token Assumptions

Unchanged from v0.5: standard ERC-20 transfer semantics required. sUSDS is non-rebasing and conforms.

Yield accrual is implicit. sUSDS share price grows against USDS while bond, challenge, and judge-fee funds are escrowed. Funds returned to any party at the end of a flow include the proportional appreciation. No explicit yield distribution is performed.

## Economic Invariants

- token balances are conserved across the bond lifecycle
- after finalization and full refund processing, no funds remain trapped in the bond contract
- once a challenge reaches a terminal status (`won`, `lost`, `conceded`, `rejectedByJudge`, `refunded`), it is not re-opened
- once a bond is `settled`, no further state transitions occur except `claimRefunds`
- bond financial parameters set at creation never change
- `claimVersion` is monotonically increasing
- `judgeProfileId` set at creation never changes

## Out of Scope

- challenger profile snapshot per challenge
- poster profile snapshot per bond
- multi-token bonds (single `token` per bond)
- variable amounts per bond
- judge replacement mid-bond
- claim modification while challenges are pending
- chains other than Ethereum mainnet for v0.6

## Open Questions

- `maxChallenges` interpretation: this spec says **total challenges ever filed**. Alternative: cap on **pending** challenges only, so judge-rejected and resolved entries free up slots. Total-cap is simpler and harder to grief past, but a coordinated spam-then-judge-reject cycle could exhaust the cap before legitimate challengers arrive. Pending-cap protects against that but is more complex.
