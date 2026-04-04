# temporal-fleet-96r-r6-sbv4-fuzz-tests Analysis

## Summary

This task is the thin integration layer on top of the two earlier subtasks:

- `test/helpers/simpleBondV4Fuzz.js` already provides the reusable fixture and deterministic action wrappers.
- `test/helpers/simpleBondV4Invariants.js` already provides the reusable snapshot-based invariants.

So the intended implementation for this task is a dedicated Hardhat test file that composes those two helpers into bounded, reproducible seeded sequences. On the current branch, that file already exists as `test/SimpleBondV4.fuzz.test.js` from commit `7a9e009` (`test: add seeded SimpleBondV4 fuzz coverage`).

## Relevant Current State

### Existing helper surface is sufficient

The fixture helper already exposes everything this task needs:

- actor handles for poster, judge, outsider, and challenger pool
- deterministic action wrappers for:
  - `createBond`
  - `challenge`
  - `advanceToRulingWindow`
  - `advancePastRulingDeadline`
  - `ruleForPoster`
  - `ruleForChallenger`
  - `withdrawBond`
  - `claimTimeout`
  - `concede`
  - `rejectBond`
- raw read helpers for bond state, queue state, balances, and contract balance

The invariant helper already exposes the right assertion building blocks:

- token conservation
- queue monotonicity
- `currentChallenge` bounds
- poster-win locked-bond behavior
- terminal outcome checks for challenger win, concession, rejection, timeout, and withdrawal

That means this task should not expand the fixture or contract surface unless the new seeded sequences expose a missing read or a broken invariant.

### Contract behavior the seeded tests must exercise

From `contracts/SimpleBondV4.sol`, the important lifecycle facts are:

- challenges form an append-only FIFO queue
- `ruleForPoster` consumes exactly one queued challenge, pays out only that challenge deposit minus fee, and leaves the poster bond locked
- repeated poster wins should therefore advance `currentChallenge` monotonically while preserving the poster principal inside the contract
- terminal paths are:
  - `ruleForChallenger`
  - `concede`
  - `rejectBond`
  - `claimTimeout`
  - `withdrawBond`
- all terminal paths should drain the contract and distribute balances according to the current queue position

Those are exactly the flows named in the task description.

## What The Dedicated Test File Should Do

The clean shape for the new test file is:

1. create a deterministic PRNG from an integer seed
2. derive bounded choices from that PRNG:
   - number of queued challenges
   - number of sequential poster wins before termination
   - fee choice per ruling
   - terminal action when the poster has not cleared the full queue
3. run only legal state transitions by driving the existing action helpers
4. take a snapshot after each state transition
5. apply generic invariants after every step
6. apply stronger action-specific invariants after poster wins and terminal actions

That keeps the suite reproducible, bounded, and aligned with the existing Hardhat test stack.

## Current Branch Assessment

`test/SimpleBondV4.fuzz.test.js` already follows the right architecture:

- defines a small seeded LCG PRNG
- creates bonds with deterministic queued challenges
- runs repeated `ruleForPoster` steps before a terminal branch
- checks generic invariants after each transition
- checks action-specific invariants for poster wins and each terminal outcome
- splits concession into a dedicated seeded flow

The branch therefore already appears to satisfy the core intent of this task.

## Coverage Notes

The current seed sets are:

- poster-side flows: `7, 11, 23, 31, 47, 61`
- concession flows: `13, 19, 29, 37`

Evaluating the current seed logic shows that the poster-side seeds do hit all non-concession terminal outcomes:

- seed `11` reaches challenger win
- seeds `7` and `23` reach rejection
- seeds `31` and `47` reach timeout
- seed `61` reaches withdrawal after clearing the queue

The concession seeds cover the remaining terminal path.

That is good enough for path coverage, but there is one notable limitation: with the current PRNG and seed choices, all sampled runs currently produce the same queue length (`4` challenges), and most poster-side runs resolve exactly two poster wins before termination. So the suite is deterministic and path-complete, but it is not especially diverse in sequence shape.

## Recommended Approach

If this task were being implemented from the base branch, the plan would be:

1. add `test/SimpleBondV4.fuzz.test.js`
2. keep all randomness deterministic and seed-driven
3. reuse `deploySimpleBondV4FuzzFixture()` rather than duplicating deployment logic
4. reuse the invariant helper rather than embedding per-test bookkeeping
5. choose a small bounded seed set that guarantees coverage of:
   - multiple sequential poster wins
   - challenger win
   - concession
   - rejection
   - timeout
   - final withdrawal
6. keep the test runtime practical for normal local and CI execution

Given the current branch state, the only likely refinement would be to widen seed diversity if verification shows the current sequences are too repetitive.

## Verification Plan

For this task itself, the relevant checks are:

1. run `npx hardhat test test/SimpleBondV4.fuzz.test.js`
2. confirm each failure is seed-reproducible from the test name
3. optionally run `npx hardhat test test/SimpleBondV4.invariants.test.js test/SimpleBondV4.fuzz.test.js` to ensure the seeded suite stays aligned with the invariant helpers
4. if runtime is high or sequence diversity is low, tune the seed list rather than increasing the action space unboundedly

In the current workspace, this verification is blocked because dependencies are not installed: `node_modules/` is absent, and `npx hardhat test ...` currently fails with Hardhat `HHE22` about using a non-local installation.

## Risks / Design Traps

- The main correctness risk is accidentally asserting stronger generic invariants than the contract guarantees. Terminal states can settle with `currentChallenge < challengeCount` because the remaining tail may be refunded rather than consumed.
- The main test-quality risk is faux fuzzing: deterministic seeds that technically cover all paths but do not materially vary queue length, fee pattern, or poster-win depth.
- The main maintenance risk is duplicating fixture or invariant logic inside the fuzz test instead of keeping the dedicated file as a thin composition layer.

## Bottom Line

This task should be implemented as a dedicated seeded Hardhat test file that composes the already-completed fixture and invariant helpers. On the current branch, that implementation already exists and appears structurally correct; the main thing left for follow-up verification is confirming it passes once local dependencies are installed, and deciding whether the seed list needs broader sequence variation.
