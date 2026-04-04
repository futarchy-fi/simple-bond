# temporal-fleet-jnz Analysis: add invariant checks to `SimpleBondV4` test suite

## Summary

This is a test-suite task, not a contract task. The relevant behavior already exists in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/contracts/SimpleBondV4.sol#L241), so the intended work is to prove its accounting guarantees in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js#L22).

On the current repo state, the requested invariant coverage already appears to be present. [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js#L949) already asserts the bond-pool invariant after `ruleForPoster`, [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js#L1147) already asserts fixed thresholds across sequential challenges, and [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js#L1344) already asserts total-token conservation across actors plus the contract.

That means this ticket is effectively already satisfied on `ff/Ttemporal-fleet-jnz` as checked out here. The branch `ff/Ttemporal-fleet-jnz` is currently at the same HEAD as `main` (`557990c`), so there is no task-specific implementation diff to add beyond this analysis metadata.

## Current State

- [`test/SimpleBondV3.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV3.test.js#L454), [`test/SimpleBondV3.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV3.test.js#L644), and [`test/SimpleBondV3.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV3.test.js#L944) already established the three precedent invariants in the V3 suite:
  - the contract keeps exactly `bondAmount` after a poster-favorable ruling
  - `bondAmount`, `challengeAmount`, and `judgeFee` stay constant as queued challenges resolve
  - token balances are conserved across all participants and the contract
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js#L949), [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js#L1147), and [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js#L1344) already port those same checks into the V4 suite.
- The underlying contract logic supports exactly those assertions:
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/contracts/SimpleBondV4.sol#L305) escrows one `challengeAmount` per challenge.
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/contracts/SimpleBondV4.sol#L414) pays the poster from the current challenge escrow, pays any judge fee, and advances `currentChallenge` without mutating `bondAmount`, `challengeAmount`, or `judgeFee`.
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/contracts/SimpleBondV4.sol#L374) settles the bond on a challenger win by paying out the poster stake plus the current challenge, then refunding remaining queued challengers.
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/contracts/SimpleBondV4.sol#L341) and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/contracts/SimpleBondV4.sol#L474) refund escrow on concession and timeout paths.

## Key Interpretation

The word "invariant" is slightly ambiguous. In some Solidity projects it implies Foundry invariant fuzzing or Echidna-style property tests. That is not the right interpretation for this repository.

This repo uses Hardhat + Chai example-based tests, and the existing V3 suite already labels explicit scenario assertions as "Robin's invariant". The natural reading of this ticket is therefore:

1. keep the work in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js)
2. do not add Foundry, Echidna, or a new invariant-testing harness
3. port or preserve the same three accounting assertions already used in V3

## Recommended Approach

If this task were still unimplemented, the smallest correct change would be test-only work in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/test/SimpleBondV4.test.js):

1. Place the "bond pool stays at `bondAmount`" assertion in the poster-win ruling block, right after a successful `ruleForPoster(...)`.
2. Place the "belief thresholds stay constant" assertion in the multi-challenger queue block, checking both interim contract balances and immutable bond parameters after successive poster-favorable rulings.
3. Place the "token accounting invariant" assertion in an end-to-end scenario block that sums balances for all funded actors plus the bond contract before and after challenge/ruling transitions.

No change should be required in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz/contracts/SimpleBondV4.sol), because the task is about coverage, not behavior.

## Verification Plan

This worktree does not currently have `node_modules/`, so I could not execute Hardhat locally during this analysis pass.

Once dependencies are installed, verify with:

1. `npm install`
2. `npx hardhat test test/SimpleBondV4.test.js`
3. Optionally, `npx hardhat test test/SimpleBondV3.test.js test/SimpleBondV4.test.js` to confirm the V4 suite still mirrors the V3 invariant coverage

The pass condition is that the V4 suite includes and passes the three invariant checks already visible at lines 949, 1147, and 1344.

## Open Question

The only material ambiguity is whether the task owner intended more than these three existing checks. If they meant broader property-based testing, the title underspecifies that expectation and the current repo offers no precedent for it. Based on the actual codebase, the safer conclusion is that the intended work was the V3-to-V4 port, and that work is already present.
