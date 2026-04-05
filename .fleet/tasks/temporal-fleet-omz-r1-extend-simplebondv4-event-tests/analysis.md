# temporal-fleet-omz-r1-extend-simplebondv4-event-tests Analysis

## Summary

This is a narrow test-suite task. The requested behavior lives entirely in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L1): extend the success-path assertions so the suite explicitly checks the new lightweight lifecycle events added by [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L73).

By inspection, the current branch already reflects the intended end state:

- both overloaded `BondCreated` signatures are disambiguated by full signature constants
- challenge success asserts `BondChallenged`
- concession success asserts `BondConceded`
- both ruling branches assert `BondResolved` with the correct verdict code

That means the implementation task is likely confirm-or-preserve rather than a broad rewrite.

## Current State

The contract emits the lightweight events this task cares about:

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L87) defines the lightweight overloaded `BondCreated(uint256,address,address,uint256)`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L101) defines `BondChallenged(uint256,address,uint256)`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L114) defines `BondConceded(uint256)`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L117) defines `BondResolved(uint256,uint8)`

The emit sites line up with the requested test additions:

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L284) emits both `BondCreated` variants in `createBond()`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L323) emits `BondChallenged` in `challenge()`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L359) emits `BondConceded` in `concede()`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L399) emits `BondResolved(..., 2)` in `ruleForChallenger()`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/contracts/SimpleBondV4.sol#L436) emits `BondResolved(..., 1)` in `ruleForPoster()`

The test file already contains the exact assertion pattern this task describes:

- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L15) declares explicit signature constants for both `BondCreated` overloads and verdict constants for `BondResolved`
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L567) asserts both `BondCreated` events on successful bond creation
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L667) asserts `BondChallenged` on successful challenge
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L745) asserts `BondConceded` on successful concession
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L970) asserts `BondResolved(..., 1)` for poster-win rulings
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L1034) asserts `BondResolved(..., 2)` for challenger-win rulings

## Key Constraint

The main subtlety is the overloaded `BondCreated` event name.

`ethers`/Hardhat assertions can become ambiguous if the test refers to the bare event name once both overloads are present. The current test structure avoids that correctly by using full event signatures instead of `"BondCreated"` alone. Any implementation should preserve that pattern.

## Planned Approach

1. Keep the scope limited to [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L1); no contract changes should be required for this task.
2. If the assertions were not already present, add explicit constants for:
   - the detailed `BondCreated` signature
   - the lightweight `BondCreated` signature
   - `BondResolved` verdict values `1` and `2`
3. Assert both `BondCreated` signatures in the bond-creation success test.
4. Assert `BondChallenged` in the challenge success test and `BondConceded` in the concession success test.
5. Assert `BondResolved` in both ruling success paths with the exact verdict codes emitted by the contract.

## Verification Plan

The expected verification command is:

```bash
npx hardhat test test/SimpleBondV4.test.js
```

I could not run that in this worktree because `node_modules/` is currently absent, so dependency-backed validation is not available here.

If dependencies are installed later, verification should confirm:

1. the suite compiles with the overloaded `BondCreated` assertions using full signatures
2. the creation, challenge, concession, and both ruling success-path tests all pass
3. `BondResolved` remains asserted as `1` for poster wins and `2` for challenger wins

## Bottom Line

This task should be a small, test-only extension centered on event assertions in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-extend-simplebondv4-event-tests/test/SimpleBondV4.test.js#L1). Based on the current branch contents, those assertions already appear to be present, so the main risk is regressing the signature-specific handling for overloaded `BondCreated`.
