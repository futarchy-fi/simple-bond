# temporal-fleet-cej-r1 Analysis: `SimpleBondV4` storage surface

## Summary

[`SimpleBondV4`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L27) has no base-contract inheritance and no immutable state, so the declaration order in its state-variable block is the authoritative top-level storage ordering.

The comments should document five top-level storage entries, in this order:

1. `nextBondId`
2. `bonds`
3. `challenges`
4. `judges`
5. `judgeMinFees`

## Current Top-Level Storage Ordering

The storage-bearing declarations are:

1. [`uint256 public nextBondId;`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L64)
   top-level slot `0`
2. [`mapping(uint256 => Bond) public bonds;`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L65)
   top-level slot anchor `1`
3. [`mapping(uint256 => Challenge[]) public challenges;`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L66)
   top-level slot anchor `2`
4. [`mapping(address => JudgeInfo) public judges;`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L67)
   top-level slot anchor `3`
5. [`mapping(address => mapping(address => uint256)) public judgeMinFees;`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L69)
   top-level slot anchor `4`

For the mapping entries above, the numbered slot is the mapping's declared slot anchor. The actual values are stored at hashed locations derived from that slot and the relevant key or keys.

## What Does Not Belong In The Top-Level Ordering

These declarations appear above the state-variable block but should not be counted as top-level storage entries:

- [`BOND_RESOLVED_FOR_POSTER`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L30) and [`BOND_RESOLVED_FOR_CHALLENGER`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L31) are `constant`, so they do not occupy storage slots.
- [`Challenge`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L37), [`Bond`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L43), and [`JudgeInfo`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L60) are type declarations, not storage variables.
- `using SafeERC20 for IERC20;` and the custom error declaration also do not create storage.

## Version Comparison

[`SimpleBondV3`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV3.sol#L43) only had three top-level storage entries:

1. [`nextBondId`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV3.sol#L73)
2. [`bonds`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV3.sol#L74)
3. [`challenges`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV3.sol#L75)

[`SimpleBondV4`](/tmp/temporal-worktrees/task-temporal-fleet-cej-r1-analyze-simplebondv4-storage-surface/contracts/SimpleBondV4.sol#L27) preserves that original prefix and appends:

4. `judges`
5. `judgeMinFees`

So the current comments should describe the v4 top-level ordering as:

`nextBondId -> bonds -> challenges -> judges -> judgeMinFees`
