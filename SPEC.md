# SimpleBondV5 Core Spec

This document describes the intended behavior of the `SimpleBondV5` core system.

## Overview

`SimpleBondV5` is a truth-machine bond contract.

- a poster locks tokens behind a claim
- challengers can dispute the claim by posting fixed-size challenges
- challenges are processed in FIFO order
- the poster has a concession window after a challenge
- if the poster does not concede, the configured judge contract may resolve the active challenge
- if the active challenge is not resolved in time, anyone may trigger a timeout and refund the unresolved parties

`V5` is intentionally close to `V4`, with two major changes:

- the judge must be a contract
- the bond core no longer contains a global judge registry

There are also deliberate hardening changes relative to `V4`:

- concession now closes on a real time-based deadline instead of implicitly remaining open until queue state changes
- the poster cannot withdraw before the public challenge deadline expires
- challenger refunds are claimed in bounded batches rather than an unbounded settlement loop

Current repository locations:

- `contracts/core/SimpleBondV5.sol`
- `contracts/judges/ManualJudge.sol`
- `contracts/interfaces/IBondJudgeV5.sol`

## Roles

- `poster`: creates the bond and locks `bondAmount`
- `challenger`: challenges the bond by locking `challengeAmount`
- `judge contract`: the on-chain authority allowed to call `ruleForPoster`, `ruleForChallenger`, or `rejectBond`
- `judge operator`: off-chain actor authorized by a judge contract such as `ManualJudge`

## Bond Creation

The poster creates a bond with:

- `token`
- `bondAmount`
- `challengeAmount`
- `judgeFee`
- `judge`
- `deadline`
- `acceptanceDelay`
- `rulingBuffer`
- `metadata`

Creation rules:

- `bondAmount > 0`
- `challengeAmount > 0`
- `judge != address(0)`
- `judge` must be a contract
- `deadline > block.timestamp`
- `rulingBuffer > 0`
- `judgeFee <= challengeAmount`
- the judge contract must accept the proposed terms via `validateBond(...)`

The poster transfers `bondAmount` into `SimpleBondV5`.

`validateBond(...)` is a creation-time compatibility and term-acceptance check only.

It means:

- this judge contract recognizes the `V5` interface
- this judge contract accepts the proposed static bond terms at creation time

It does not mean:

- the judge contract is obligated to later resolve the dispute on the merits
- the judge contract cannot later refuse, reject the bond, or allow timeout to occur

## Challenges

Any challenger may call `challenge(bondId, metadata)` before `deadline`.

Each challenge:

- transfers exactly `challengeAmount`
- appends to the queue
- records challenger metadata
- updates `lastChallengeTime`

Challenges are FIFO.

The active challenge is `currentChallenge`.

This preserves the `V4` FIFO anti-gaming property. Later challengers cannot jump ahead of earlier challengers.

## Concession Window

Once at least one challenge exists, the poster may concede only before:

```text
concessionDeadline(bondId) = rulingWindowStart(bondId)
```

where:

```text
rulingWindowStart(bondId) = max(deadline, lastChallengeTime + acceptanceDelay)
```

Concession is therefore a real time-based window.

If the concession window closes, the poster cannot concede anymore and must wait for judge resolution or timeout.

This is an intentional fix to the unintended `V4` behavior where concession remained available based on queue state rather than an explicit time cutoff.

## Concession Outcome

If the poster concedes:

- `settled = true`
- `conceded = true`
- poster receives the full `bondAmount`
- all pending challengers become refundable for their full `challengeAmount`
- judge receives nothing

This is intended to preserve the public concession signal while refunding capital.

## Judge Resolution

Only the configured judge contract may resolve a bond on-chain.

The judge contract may call:

- `ruleForPoster(bondId, feeCharged)`
- `ruleForChallenger(bondId, feeCharged)`
- `rejectBond(bondId)`

Resolution is only allowed during the ruling window:

```text
rulingDeadline(bondId) = rulingWindowStart(bondId) + rulingBuffer
```

## Judge Fee Semantics

`judgeFee` is a maximum fee cap for a ruling, not a mandatory fixed charge.

The core enforces:

```text
0 <= feeCharged <= judgeFee
```

The fee is paid in the bond token and routed to the judge contract address, not to the judge operator directly.

This is intentional. The bond core pays the judge contract, and any further accounting or refunding logic belongs to the judge implementation rather than the core.

`SimpleBondV5` does not model any external arbitration-cost system.

## Refund Claims

Some terminal outcomes can leave a large unresolved suffix of the FIFO challenge
queue. `SimpleBondV5` therefore does not perform an unbounded refund loop while
settling those outcomes.

Instead:

- settlement records a refundable contiguous suffix of the challenge queue
- anyone may call `claimRefunds(bondId, maxCount)` to process a bounded batch
- each claimed refund still goes to the original challenger

This preserves the intended economics while avoiding a large-queue settlement
DoS.

## Token Assumptions

`SimpleBondV5` is intended for standard ERC-20 tokens whose transfers move the requested nominal amount.

Out of scope for the intended design:

- fee-on-transfer tokens
- rebasing or elastic-supply tokens
- tokens with transfer callbacks or other non-standard side effects that materially change accounting assumptions

## `ruleForPoster`

When the judge rules for the poster on the active challenge:

- the active challenge is marked lost
- poster receives `challengeAmount - feeCharged`
- judge contract receives `feeCharged`
- `currentChallenge` advances by one
- bond remains active unless all challenges are exhausted

The original `bondAmount` stays locked in the bond contract until a challenger wins, the poster withdraws, a rejection happens, or timeout happens.

## `ruleForChallenger`

When the judge rules for the active challenger:

- the active challenge is marked won
- bond is settled
- challenger receives `bondAmount + challengeAmount - feeCharged`
- judge contract receives `feeCharged`
- all later pending challengers become refundable through bounded refund claims

## `rejectBond`

The judge contract may refuse the bond and trigger a full refund path:

- poster receives the full `bondAmount`
- all pending challengers become refundable for the full `challengeAmount`
- judge receives nothing
- bond becomes settled

This is intended to support judge refusal without forcing a merits ruling.

## Poster Withdrawal

The poster may withdraw the bond only when:

- the bond is not already settled
- the caller is the poster
- the public challenge deadline has passed
- there are no pending challenges

Withdrawal returns the full `bondAmount` to the poster and settles the bond.

## Timeout

If the ruling deadline passes while there is still an unresolved active challenge:

- anyone may call `claimTimeout(bondId)`
- poster receives the full `bondAmount`
- all unresolved pending challengers become refundable for the full `challengeAmount`
- judge receives nothing
- bond becomes settled

This is the liveness fallback for judge inaction.

## Economic Invariants

The intended invariants are:

- tracked token balances plus the bond contract balance are conserved
- `currentChallenge` is monotonic
- challenge order is FIFO
- later pending challenges cannot jump ahead of earlier ones
- after a poster win, the bond remains locked
- after a challenger win, rejection, withdrawal, concession, or timeout, no funds should remain trapped in the bond contract

## ManualJudge

`ManualJudge` is a minimal judge wrapper.

- anyone may deploy it for a proposed operator
- it becomes active only after the proposed operator accepts
- only the accepted operator may forward rulings or rejection calls
- only the accepted operator may withdraw accrued judge fees
- it is intentionally portable across compatible bond contracts

That portability is deliberate. `ManualJudge` is not bound to a single `SimpleBondV5` instance so a future compatible bond core can reuse the same wrapper instead of forcing redeployment.

`ManualJudge` does not impose policy on how the operator judges disputes. It only enforces operator authorization and exposes the generic judge interface expected by `SimpleBondV5`.
