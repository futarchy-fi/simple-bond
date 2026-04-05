# temporal-fleet-0ft-r1 Analysis: rewrite `SimpleBondV4` require messages

## Summary

This task is narrowly scoped to the contract-side revert strings in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L1). The contract currently contains 53 string-based `require(...)` checks. They cover judge registry operations, bond creation and lifecycle entrypoints, view helpers, and shared internal helper paths. The requested change is to rewrite the string arguments only, without changing any predicate, evaluation order, state transition, access rule, or token flow.

The existing `InsufficientChallengeAmount` custom error in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L32) is not part of this task and should remain untouched.

## Current Require Surface

- Judge registry and registry-adjacent checks live in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L163), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L175), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L187), and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L203). These currently use short messages such as `Not registered`, `Zero token`, `Length mismatch`, `Empty batch`, `Bond does not exist`, `Already settled`, `Already conceded`, and `Only judge`.
- Bond creation validation is concentrated in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L241), with input and registry checks for zero amounts, zero judge, past deadline, zero ruling buffer, unregistered judges, and fees below the judge minimum.
- Active lifecycle entrypoints in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L305), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L341), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L374), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L414), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L453), and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L474) add the rest of the lifecycle strings: `Claim conceded`, `Past deadline`, `Only poster`, `No pending challenges`, `Ruling already started`, `Fee exceeds max`, `No pending challenge`, `Challenge not pending`, `Pending challenges`, and `Before ruling deadline`.
- View and helper paths in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L497), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L512), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L543), and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L547) cover `Challenge does not exist`, `Zero judge`, `Bond does not exist`, `Before ruling window`, and `Past ruling deadline`.
- The current surface already has duplicated and inconsistent wording for similar states. `Bond does not exist` appears both inline and via `_requireBondExists`, `Only judge` and `Only poster` recur across multiple entrypoints, and concession state is split between `Already conceded` and `Claim conceded`.

## Scope Boundaries

- In scope: rewrite the string literal attached to every `require(...)` in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L1).
- Out of scope: altering any condition, changing validation order, converting `require` checks to custom errors, changing event emissions, touching transfer logic, or modifying older bond contract versions.
- This subtask is the contract-edit half of the larger message-refresh effort. [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/test/SimpleBondV4.test.js#L1) currently contains 54 exact-string `revertedWith(...)` assertions and 1 `revertedWithCustomError(...)` assertion, so downstream test updates are required, but they belong to the next decomposition step rather than this one.

## Recommended Approach

1. Define the replacement message catalog before editing so repeated conditions share identical wording across inline checks and helper-backed checks.
2. Update only the string arguments inside `require(...)` calls in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L1). Do not reorder checks, merge checks, or touch the custom-error branch in `createBond`.
3. Pay special attention to helper reuse and inline duplicates:
   - `_requireBondExists` in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L543)
   - `_requireRulingWindow` in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L547)
   - inline existence and lifecycle checks in `rejectBond`, `challenge`, `concede`, both ruling functions, `withdrawBond`, and `claimTimeout`
4. After editing, verify the structural surface is unchanged by confirming the contract still has 53 `require(...)` sites and that only message literals changed.
5. Leave `test/SimpleBondV4.test.js` untouched for this task, but record that exact-string assertions must be updated in the follow-on task once the final catalog is chosen.

## Expected Files To Change

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L1)

## Risks And Notes

- The main regression risk is not logic breakage but externally visible revert-precedence changes. Several functions intentionally check overlapping invalid states in a fixed order, and tests rely on the first failure staying the same.
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-require-strings/contracts/SimpleBondV4.sol#L203) checks `!b.settled` before `!b.conceded`, so a conceded bond currently surfaces the settled message first after `concede()` sets both flags. That ordering must not move.
- Shared helper strings affect multiple entrypoints at once. If `_requireBondExists` or `_requireRulingWindow` get wording that diverges from inline equivalents, the contract will expose inconsistent messages for materially identical failures.
- Because this task only rewrites strings, any diff that changes control flow, state writes, or access restrictions should be treated as out of scope.
