# dt-002 Analysis: Add NatSpec to `KlerosJudge.sol` public functions

## Summary

This is primarily a documentation-only task in [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol).

The key finding is that the explicit external functions on `KlerosJudge` are already documented:

- `requestArbitration()` at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L142)
- `rule()` at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L190)
- `executeRuling()` at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L206)
- `submitEvidence()` at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L241)
- `withdrawFees()` at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L264)
- `updateArbitratorExtraData()` at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L274)
- `transferOwnership()` at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L282)
- `getArbitrationCost()` at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L294)

## Missing NatSpec Surface

The remaining undocumented public or external API surface appears to be:

1. The embedded `ISimpleBondV4` interface declarations at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L12).
   These external functions currently have no `@notice`, `@param`, or `@return` tags.
2. The constructor block at [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-dt-002/contracts/KlerosJudge.sol#L99).
   It has `@param` tags but no `@notice`.
3. Public state variables that generate getter functions but currently have no NatSpec comments:
   - `RULING_CHOICES`
   - `RULING_POSTER`
   - `RULING_CHALLENGER`
   - `arbitrator`
   - `simpleBond`
   - `arbitratorExtraData`
   - `owner`

The mappings `disputes`, `bondChallengeToDispute`, and `hasDispute` already have `/// @notice` comments, so they do not appear to need changes.

## Scope Note

There is a small ambiguity in the task wording:

- If "public and external functions" means explicit function declarations only, the work is mostly the `ISimpleBondV4` interface plus the missing constructor summary.
- If the repo treats generated getters from public state variables as part of the public API, those variables should also receive NatSpec comments so their generated getter functions are documented.

The decomposition assumes the safer interpretation: document every undocumented public-facing callable surface in this file without changing behavior.

## Implementation Risk

This should be a low-risk patch:

- no control flow changes
- no storage layout changes
- no ABI changes beyond documentation metadata

The appropriate verification step is a compile pass, such as `npm run compile`, to confirm the file still builds cleanly after the NatSpec additions.
