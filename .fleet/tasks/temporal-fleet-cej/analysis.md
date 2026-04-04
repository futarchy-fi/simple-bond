# temporal-fleet-cej Analysis: add storage layout comments to `SimpleBondV4`

## Summary

This is a narrow documentation-only Solidity task. The cleanest implementation is to add concise storage-layout comments to the top-level state declarations in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-cej/contracts/SimpleBondV4.sol#L64) without changing any variable names, ordering, types, logic, ABI, or tests.

## Current State

`SimpleBondV4` already has well-structured section headers, inline field comments, and a small amount of NatSpec, but its contract-level storage declarations are currently undocumented from a layout perspective.

The relevant storage block is:

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-cej/contracts/SimpleBondV4.sol#L64) `nextBondId`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-cej/contracts/SimpleBondV4.sol#L65) `bonds`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-cej/contracts/SimpleBondV4.sol#L66) `challenges`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-cej/contracts/SimpleBondV4.sol#L67) `judges`
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-cej/contracts/SimpleBondV4.sol#L69) `judgeMinFees`

Under the current declaration order, the top-level storage anchors are:

- slot `0`: `nextBondId`
- slot `1`: `bonds`
- slot `2`: `challenges`
- slot `3`: `judges`
- slot `4`: `judgeMinFees`

That ordering is exactly what storage-layout comments should document.

## Key Interpretation

The task title points to comments about storage layout, not a behavior change.

The narrowest correct reading is:

1. document the existing storage ordering in `SimpleBondV4`
2. keep the implementation comment-only
3. avoid expanding scope into tests, refactors, or storage-structure changes

The comments should stay attached to the top-level declarations rather than trying to exhaustively describe how every dynamic member inside `Bond` and `Challenge` is encoded. Brief notes about what each mapping anchors are enough; full storage-spec prose would be heavier than the task requires.

## Recommended Approach

1. Update only [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-cej/contracts/SimpleBondV4.sol#L64).
2. Add a short local header such as `// --- Storage Layout ---` or equivalent if it improves scanability.
3. Add concise comments that make the current top-level slot order explicit and explain each variable's role.
4. Preserve declaration order exactly. Reordering or inserting variables would change the layout being documented.
5. Keep the comments factual and low-maintenance. If exact slot numbers are called out, they should be limited to the current top-level anchors above.

## Expected Scope

Expected file changes:

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-cej/contracts/SimpleBondV4.sol#L64)

This task should not require:

- test-file changes
- ABI changes
- contract logic changes
- frontend/backend updates
- dependency or lockfile updates

## Verification Plan

The main verification step is diff review:

1. confirm only comments were added around the `SimpleBondV4` storage declarations
2. confirm variable names, order, and types are unchanged
3. confirm the comments accurately reflect the current top-level slot order

If dependencies are installed, an optional compile check is still reasonable:

1. `npm install`
2. `npx hardhat compile`

`node_modules/` is absent in this worktree, so compilation is not currently available without installing dependencies first.

## Risks And Notes

- The main risk is writing inaccurate slot comments. Since Solidity storage order is declaration-driven, a wrong slot number would be misleading even though it would not affect bytecode.
- Over-documenting nested struct internals would create maintenance burden with little benefit for this task.
- Any future insertion or reordering of state variables would require the comments to be updated as well, so the implementation should keep the comment block short and tightly coupled to the declarations it describes.
