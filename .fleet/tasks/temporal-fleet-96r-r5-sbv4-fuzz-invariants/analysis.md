# temporal-fleet-96r-r5-sbv4-fuzz-invariants Analysis

## Summary

This task should add a separate invariant/assertion layer on top of the already-extracted fuzz fixture in `test/helpers/simpleBondV4Fuzz.js`.

The fixture itself is already in the right shape for this: it exposes raw reads (`getBond`, `getCurrentChallenge`, `getChallengeCount`, `getChallenges`, `balancesOf`, `contractBalance`) and deterministic action wrappers without embedding Chai assertions. The clean implementation is therefore a new helper module that consumes the fixture's read layer rather than expanding the fixture into an assertion-heavy test harness.

## Relevant Current State

### Fixture surface is already sufficient

`test/helpers/simpleBondV4Fuzz.js` currently exposes:

- `actors` and `addresses` for the known participants
- deterministic `actions` for create/challenge/rule/withdraw/timeout/concede/reject flows
- `read.getBond(bondId)`
- `read.getCurrentChallenge(bondId)`
- `read.getChallengeCount(bondId)`
- `read.getChallenge(bondId, index)`
- `read.getChallenges(bondId)`
- `read.balanceOf(...)`
- `read.balancesOf(...)`
- `read.contractBalance()`

That is enough to build reusable invariant helpers without re-querying the contracts manually in each future fuzz test.

### Contract behavior that the invariants need to reflect

From `contracts/SimpleBondV4.sol`:

- `challenge(...)` appends to an unbounded FIFO queue, sets the new challenge status to `0`, and transfers `challengeAmount` into the contract.
- `ruleForPoster(...)` marks the current challenge as lost (`status = 2`), pays `challengeAmount - feeCharged` to the poster, pays `feeCharged` to the judge, and advances `currentChallenge` by exactly one. It does not settle the bond.
- `ruleForChallenger(...)` marks the current challenge as won (`status = 1`), settles the bond, pays the active challenger `bondAmount + challengeAmount - feeCharged`, pays the judge `feeCharged`, and refunds later pending challengers.
- `concede(...)`, `rejectBond(...)`, `claimTimeout(...)`, and `withdrawBond(...)` are terminal flows that should leave the contract drained.
- `claimTimeout(...)` refunds only the still-pending suffix starting at `currentChallenge`; earlier poster-win losses stay consumed.

### Existing tests already encode the target truths

`test/SimpleBondV4.test.js` already contains one-off assertions for the same behaviors this task wants to make reusable:

- total token accounting remains constant
- queue advancement after poster wins is monotonic
- `currentChallenge` advances to the next FIFO item
- poster-win rulings leave the poster's `bondAmount` locked while only challenge deposits are released
- terminal flows end with the bond contract balance at `0`

So the job here is mostly to lift those truths into reusable helpers, not to invent new semantics.

## Recommended Implementation Shape

Add a separate helper module, most likely:

- `test/helpers/simpleBondV4Invariants.js`

That module should import `expect` from Chai and export small, composable helpers that operate on fixture snapshots.

### Snapshot-first API

The most useful base primitive is a state snapshot helper, for example:

- `captureBondSnapshot(fixture, bondId = 0, options = {})`

That snapshot should gather, at minimum:

- `bond`
- `challengeCount`
- `challenges`
- `currentChallenge`
- `contractBalance`
- balances for poster, judge, outsider, and all challengers
- derived lists such as `pendingChallenges`, `refundedChallenges`, and `resolvedChallenges`

Building the invariants on top of a normalized snapshot keeps the later fuzz tests short and avoids each helper re-reading chain state independently.

## Invariants To Implement

### 1. Token conservation

Goal:

- the sum of all tracked participant balances plus the bond contract balance should remain constant across all non-minting actions

Implementation notes:

- Capture a baseline total once after fixture deployment or after bond creation.
- Use fixture actors rather than hardcoded signers.
- Deduplicate addresses so optional/custom actor overrides do not double count.
- Compare `sum(actor balances) + contractBalance` against the baseline after every step.

This should become the generic "run after every action" invariant.

### 2. Queue monotonicity

Goal:

- the challenge queue is append-only and `currentChallenge` never moves backward

Implementation notes:

- compare `before` and `after` snapshots
- assert `after.challengeCount >= before.challengeCount`
- assert `after.currentChallenge >= before.currentChallenge`
- for indices present in both snapshots, challenge identity/order must remain unchanged
- statuses must never move from a terminal state back to pending

The important constraint is monotonicity, not overfitting to a specific action. A later action-specific helper can make stronger claims such as "poster win increments by exactly one."

### 3. `currentChallenge` bounds

Goal:

- `currentChallenge` must always stay within the queue bounds implied by `getChallengeCount`

Implementation notes:

- always assert `currentChallenge <= challengeCount`
- when the bond is active and there are no pending challenges, expect `currentChallenge === challengeCount`
- do not require equality in every settled state, because `ruleForChallenger`, `concede`, `rejectBond`, and `claimTimeout` can settle while `currentChallenge < challengeCount` and leave the suffix marked refunded

This is the place where the helper should encode the contract's real semantics instead of a simplified "fully drained queue means index equals length" rule.

### 4. Poster-win locked-bond behavior

Goal:

- after `ruleForPoster`, the poster's bond remains locked and only one challenge deposit is released

Implementation notes:

- this helper should accept `before` and `after` snapshots plus the charged fee
- assert `after.bond.settled === false`
- assert `after.currentChallenge === before.currentChallenge + 1`
- assert the resolved challenge at `before.currentChallenge` moved to `status = 2`
- assert later queued challenges remain pending and untouched
- assert the contract balance equals:
  - `bondAmount + challengeAmount * pendingChallengeCountAfter`
- equivalently, assert the contract balance fell by exactly one `challengeAmount`
- assert poster gain plus judge gain equals exactly one `challengeAmount`

This is the key invariant that prevents the fuzz tests from accidentally treating a poster win as releasing the poster's principal.

### 5. Terminal balance outcomes

Goal:

- terminal actions pay the correct parties and leave the contract drained

Implementation notes:

- these helpers should be snapshot-based rather than hardcoding balances from fixture deployment
- compute deltas from the `before` snapshot so they still work after earlier poster wins or partially consumed queues

Expected terminal semantics:

- `withdrawBond`
  - poster gains `bondAmount`
  - nobody else changes
  - contract balance becomes `0`
- `concede`
  - poster gains `bondAmount`
  - every pending challenger gains `challengeAmount`
  - judge gains `0`
  - contract balance becomes `0`
- `rejectBond`
  - same distribution as `concede`
- `claimTimeout`
  - poster gains `bondAmount`
  - only challengers at indices `>= before.currentChallenge` gain `challengeAmount`
  - judge gains `0`
  - contract balance becomes `0`
- `ruleForChallenger`
  - active challenger gains `bondAmount + challengeAmount - feeCharged`
  - judge gains `feeCharged`
  - later pending challengers each gain `challengeAmount`
  - poster gains `0`
  - contract balance becomes `0`

For `ruleForChallenger`, the winning challenger should be derived from `before.challenges[before.currentChallenge]`, not passed in blindly by the test.

## Recommended File Boundary

The invariant module should stay separate from `test/helpers/simpleBondV4Fuzz.js`.

Reasons:

- the fixture remains a reusable read/action layer
- the invariant layer can import Chai without polluting the fixture
- later seeded tests can choose whether to use all invariants or only a subset
- the task boundary from the earlier child tasks stays intact

If a tiny addition to the read layer becomes necessary during implementation, it should be limited to convenience reads or snapshot support, not a redesign.

## Implementation Plan

1. Add `test/helpers/simpleBondV4Invariants.js`.
2. Implement a normalized snapshot helper on top of `fixture.read` and `fixture.actors`.
3. Implement the generic invariants:
   - token conservation
   - queue monotonicity
   - `currentChallenge` bounds
4. Implement the action-sensitive invariants:
   - poster-win locked-bond behavior
   - terminal balance outcomes
5. Keep the helpers parameterized by `bondId` and snapshot inputs so the next fuzz-test task can reuse them across many seeds and flows.
6. Add focused helper coverage if needed, or validate them immediately in the next seeded-fuzz test task.

## Verification Plan

Once implementation starts, the minimum useful checks are:

1. run a small deterministic sequence that challenges a bond multiple times and applies the generic invariants after each step
2. run a poster-win sequence and assert the locked-bond helper after each ruling
3. run one example each of `ruleForChallenger`, `concede`, `rejectBond`, `claimTimeout`, and `withdrawBond` against the terminal-outcome helper
4. confirm the helpers work off snapshots and fixture reads only, without duplicating raw contract queries throughout the tests

## Risks / Design Traps

- The main risk is overconstraining terminal states. The helpers must respect that refunded tails can exist while `currentChallenge < challengeCount`.
- The second risk is encoding action assumptions into the generic invariants. Queue monotonicity should stay generic; stronger postconditions belong in action-specific helpers.
- The third risk is computing terminal payouts from fixture defaults instead of pre-action snapshots. That would break once a sequence includes earlier poster wins.

## Practical Conclusion

This task should produce a reusable assertion module, not more fixture setup and not contract changes. The current read layer is already sufficient; the right work is to normalize snapshots and encode the contract's actual accounting/queue semantics into reusable invariant helpers for the upcoming seeded fuzz tests.
