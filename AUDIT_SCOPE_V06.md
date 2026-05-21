# SimpleBond v0.6 Audit Scope

This document defines the intended audit scope for the `SimpleBondV6` core line, released as SimpleBond `v0.6`.

## Objective

Audit the `v0.6` core bond mechanism, profile registries, and the minimal contract-judge wrapper, without pulling legacy contracts or earlier versions into scope.

The goal of this audit is to answer:

- does `SimpleBondV6` preserve fund conservation across all action sequences with the new per-challenge state model?
- does the per-challenge ruling window correctly gate `ruleForPoster` and `ruleForChallenger`?
- does `rejectChallenge` (out-of-scope refund) safely advance non-FIFO ordering without enabling griefing of pending challengers?
- does `concede` correctly stay money-neutral for the poster while refunding only the targeted challenger?
- does the `closeBond` / `openBond` toggle interact correctly with pending challenges and `withdrawBond`?
- does the `modifyClaim` + `expectedVersion` design prevent challengers from being silently retargeted?
- does the bonded `claimRefunds` cursor safely drain Pending entries left after `ruleForChallenger`, `rejectBond`, or `claimTimeout` without double-paying or skipping?
- does the `judgeProfileId` snapshot resolve correctly against `JudgeProfileRegistryV6` and prevent the bond from being created against a profile that doesn't match the declared judge?
- is the `viaIR` optimizer pipeline producing safe bytecode for the new contract surface?

## In Scope

Contracts:

- `contracts/core/SimpleBondV6.sol`
- `contracts/interfaces/IBondJudgeV6.sol`
- `contracts/judges/ManualJudgeV6.sol`
- `contracts/profiles/PosterProfileRegistry.sol`
- `contracts/profiles/ChallengerProfileRegistry.sol`
- `contracts/profiles/JudgeProfileRegistryV6.sol`

Primary tests:

- `test/core/v6/SimpleBondV6.test.js`
- `test/core/v6/SimpleBondV6.modifyClaim.test.js`
- `test/core/v6/SimpleBondV6.challenge.test.js`
- `test/core/v6/SimpleBondV6.concede.test.js`
- `test/core/v6/SimpleBondV6.ruleForPoster.test.js`
- `test/core/v6/SimpleBondV6.resolution.test.js`
- `test/judges/ManualJudgeV6.test.js`
- `test/profiles/Registries.test.js`
- `test/helpers/v6/fixtures.js`

## Out Of Scope

Legacy and parallel contracts:

- `contracts/core/SimpleBondV5.sol` (audited separately as v0.5)
- `contracts/legacy/SimpleBond.sol`
- `contracts/legacy/SimpleBondV3.sol`
- `contracts/legacy/SimpleBondV4.sol`
- `contracts/judges/ManualJudge.sol` (v0.5)
- `contracts/judges/JudgeProfileRegistry.sol` (v0.5)
- `contracts/judges/JudgeRegistry.sol`
- `contracts/legacy/KlerosJudge.sol`
- `contracts/directory/OfficialBondDirectory.sol` (reused unchanged from v0.5; in scope only as a curation layer that does not gate the permissionless v0.6 core)

Test-only contracts:

- `contracts/test/MockSUSDS.sol`
- `contracts/test/TestAcceptJudgeV6.sol`
- `contracts/test/TestForwardingJudgeV6.sol`
- `contracts/test/MockArbitrator.sol`
- `contracts/test/TestToken.sol`

Other:

- frontend code
- backend notification code (`backend/`)
- deployment scripts (`scripts/v6/`) and deployment-checklist tooling
- judge dropdown / registry UX

## Audit Model

Audit against the exact git commit selected at engagement kickoff, not a floating branch name.

The intended named snapshot for this engagement is the annotated tag `audit-v6-core`.

At kickoff:

- resolve `audit-v6-core` to its full commit hash
- record that resolved hash in the engagement materials
- do not rely on a floating branch name after kickoff

## Test Commands

```bash
npx hardhat test
npm run size
```

## Explicit Trust Assumptions

- `ManualJudgeV6` is trusted by the parties who choose it. The on-chain spec assumes the operator is responsible and dismisses spam challenges promptly via `rejectChallenge`.
- `SimpleBondV6` assumes the configured judge contract may rule, reject, refuse to act, or repeatedly use `rejectChallenge`; the trust model is the same as v0.5.
- `SimpleBondV6` does not model external arbitration flows, appeals, or evidence systems.
- The bond core does not enforce a cap on `rejectChallenge` calls — judge reputation is the enforcement mechanism.
- `JudgeProfileRegistryV6` is intentionally append-only: a judge can never edit a past profile entry. Older entries remain readable forever; updating a profile creates a new `entryId`.

## Token Assumptions

- `SimpleBondV6` is intended for standard ERC-20 tokens whose transfers move the requested nominal amount.
- sUSDS is the canonical mainnet token; it is non-rebasing and conforms to standard ERC-20.
- yield accrual on sUSDS is implicit: amounts are nominal sUSDS units, the underlying USDS appreciates while escrowed, and funds returned at the end of a flow include the proportional appreciation. No explicit yield distribution.
- fee-on-transfer, rebasing, callback-bearing, or otherwise non-standard tokens are out of scope unless explicitly noted otherwise at engagement kickoff.

## Intentional Diffs From v0.5

The audit should treat the following as intentional `v0.6` design changes, not accidental divergences:

- bond `deadline` is removed; lifecycle is event-driven (`closed` / `withdrawn` / `settled`).
- `acceptanceDelay` and `rulingBuffer` are still bounded by `MAX_*` constants, but the `deadline + acceptanceDelay + rulingBuffer` overflow check is gone (no longer needed).
- bond-wide `concede(bondId)` is gone; replaced by per-challenge `concede(bondId, i, content)` which is money-neutral for the poster and refunds only the specified challenger.
- the single `currentChallenge` pointer is gone; the judge can rule, reject, or time out challenges in any order. The first `ruleForChallenger` settles the bond regardless of position.
- `bond.lastChallengeTime` is gone; each challenge stores its own `timestamp`. `rulingWindowStart(bondId, i)` is per-challenge.
- new poster controls: `modifyClaim` (only when pendingCount == 0), `closeBond` / `openBond` toggle. `withdrawBond` requires `closed && pendingCount == 0`.
- new judge control: `rejectChallenge(bondId, i, content)` dismisses a single challenge as out-of-scope; callable at any time before bond settles. `rejectBond` (whole-bond void) survives unchanged in spirit.
- new mandatory `maxChallenges` cap on total challenges ever filed (not a pending-only cap).
- claim text is hashed on-chain (`bytes32 claimHash`), with the raw content emitted in events. Same pattern applies to challenge, concession, ruling, and rejection metadata. Storage cost is one slot per action instead of an unbounded string.
- claim is versioned: `claimVersion` starts at 1 and increments on each `modifyClaim`. Each `challenge` must pin its `expectedVersion`; mismatch reverts. Each `Challenge` records `challengeAtVersion` and `claimHashAtChallenge` so judges and observers can resolve what was being disputed.
- bond pins a `judgeProfileId` snapshot at creation. The bond constructor takes the `JudgeProfileRegistryV6` address; `createBond` verifies that the registered entry's `judgeContract` matches the passed `judge` address.
- judge fee semantics carry over: `0 <= feeCharged <= judgeFee`. `rejectChallenge`, `rejectBond`, `concede`, `claimTimeout` route no fee to the judge.
- `claimRefunds(bondId, maxCount)` carries over the v0.5 bounded-batch pattern but now skips `Conceded` and `RejectedByJudge` entries (already refunded immediately) and only refunds `Pending` entries left at settlement. `refundCursor[bondId]` tracks position across batches; bounded by iteration count rather than refund count.
- compilation enables `viaIR: true` (required to fit the wider `createBond` signature within Solidity's stack-too-deep budget).

## Explicitly Deferred Work

These are expected future work items and should not be treated as missing pieces in this audit:

- frontend v0.6 promotion (full UI replacement in `frontend/index.html`)
- backend per-chain SQLite schema migration (if any becomes needed)
- mainnet sUSDS curation in `OfficialBondDirectory` beyond a single approved-token entry
- `KlerosJudgeV6` adapter (planned post-audit)
- Gnosis v0.5 retirement (planned at Phase 11 of `PLAN_V06.md`, after mainnet cutover)

## Intended Reviewer Focus

Please prioritize:

- state-machine correctness across the new `ChallengeStatus` enum, including out-of-order rulings
- token accounting and fund conservation under arbitrary action interleavings, especially:
  - concede + rule + reject + timeout combinations
  - settlement followed by partial `claimRefunds` draining
  - `closeBond` + `openBond` toggle while challenges are pending
- claim-versioning correctness:
  - `expectedVersion` race conditions vs. `modifyClaim`
  - `claimHashAtChallenge` snapshot integrity
  - `modifyClaim` strictly blocked when `pendingCount > 0`
- per-challenge timing arithmetic (`concessionDeadline`, `rulingWindowStart`, `rulingDeadline`) and the `claimTimeout` gate
- judge profile snapshot correctness — bond cannot bind to a profile that doesn't match the declared judge
- registry append-only invariant: no path mutates an existing entry
- griefing / stuck-fund scenarios, including:
  - poster who never closes a bond
  - judge who repeatedly `rejectChallenge`s a real challenger
  - challenger flood up to `maxChallenges` cap
  - timeouts on the head-of-queue vs. later challenges
- `viaIR` codegen — confirm no IR-induced bug in the rulings / refund accounting
- reentrancy via ERC-20 callbacks (sUSDS is non-callback, but the core should be safe for any compliant ERC-20)
