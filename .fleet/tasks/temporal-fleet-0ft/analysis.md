# temporal-fleet-0ft Analysis: add comprehensive error messages to `SimpleBondV4` require statements

## Summary

This is a focused contract-and-test string-update task centered on [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L1). The contract currently uses 53 string-based `require(...)` checks with terse and sometimes inconsistent revert messages. The task should replace those strings with fuller, consistent user-facing messages while preserving validation order, helper reuse, and all existing business logic.

The scope is not contract behavior in general. The existing `InsufficientChallengeAmount` custom error in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L32) is already descriptive and should remain intact.

## Current State

- Registry and fee-setting entrypoints in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L163), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L175), and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L187) use short strings such as `Not registered`, `Zero token`, `Length mismatch`, and `Empty batch`.
- Bond creation and lifecycle entrypoints in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L241), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L305), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L341), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L374), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L414), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L453), and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L474) use similarly terse strings such as `Only judge`, `Only poster`, `Already settled`, `No pending challenges`, `Past deadline`, and `Fee exceeds max`.
- Shared internal helpers in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L543) and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L547) centralize the nonexistent-bond and ruling-window checks. Updating those helper strings will affect multiple public entrypoints at once.
- Concession-related wording is already inconsistent. [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L207) and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L345) use `Already conceded`, while [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L309), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L378), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L418), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L457), and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L478) use `Claim conceded`.
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/test/SimpleBondV4.test.js#L1) currently contains 54 `revertedWith(...)` assertions spread across registry, creation, challenge, concede, ruling, withdrawal, timeout, permission, and view coverage. Any message changes in the contract will require synchronized test updates.

## Scope Boundaries

- In scope: replace string literals passed to `require(...)` in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L1) and update [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/test/SimpleBondV4.test.js#L1) to assert the new wording.
- Out of scope: reordering checks, adding new validations, converting requires to custom errors, touching older bond contracts such as [`contracts/SimpleBond.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBond.sol#L1) or [`contracts/SimpleBondV3.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV3.sol#L1), or changing any settlement or token-transfer behavior.

## Recommended Approach

1. Inventory every current `require(...)` message in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L1) and group them by recurring condition:
   - caller authorization
   - bond existence or state
   - deadline and ruling-window timing
   - challenge queue state
   - input validation
2. Define a single replacement message catalog before editing. Repeated conditions should keep identical wording across inline checks and helper functions, especially for nonexistent bonds, caller-role checks, and concession/settlement state.
3. Update the string arguments on `require(...)` only. Preserve the existing validation order so overlapping invalid states keep surfacing the same first failure condition. That matters because some current tests reach `Already settled` before any conceded-specific branch due to the current check order.
4. Update the exact-string assertions in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/test/SimpleBondV4.test.js#L1). The custom-error assertion for `InsufficientChallengeAmount` should remain unchanged.
5. Run the targeted `SimpleBondV4` Hardhat suite after the edits.

## Expected Files To Change

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/contracts/SimpleBondV4.sol#L1)
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft/test/SimpleBondV4.test.js#L1)

## Verification Plan

1. Install dependencies first if `node_modules/` is still absent in the worktree.
2. Run `npx hardhat test test/SimpleBondV4.test.js`.
3. Confirm every updated string-based revert now matches the new wording.
4. Confirm the `InsufficientChallengeAmount` custom-error coverage still passes.
5. Confirm behavior did not change beyond revert text, especially for:
   - conceded-versus-settled precedence
   - helper-driven nonexistent-bond failures
   - ruling-window boundary failures

## Risks And Notes

- The main regression risk is string drift, not logic. Shared conditions currently appear in multiple places, so partial rewrites would leave inconsistent user-facing errors and failing tests.
- Reordering checks to make some messages read better would change externally observable behavior and break tests in overlapping-state cases.
- Because helper functions own some widely reused failures, those helper messages should be coordinated with inline duplicates so `SimpleBondV4` does not expose two different phrasings for the same failed condition.
