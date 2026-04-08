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

## Audited Surface Inventory

### Explicitly documented already

- `KlerosJudge.requestArbitration(uint256)` with `@notice`, `@param`, and `@return`
- `KlerosJudge.rule(uint256,uint256)` with `@notice` and `@param`
- `KlerosJudge.executeRuling(uint256)` with `@notice` and `@param`
- `KlerosJudge.submitEvidence(uint256,uint256,string)` with `@notice` and `@param`
- `KlerosJudge.withdrawFees(address,address,uint256)` with `@notice` and `@param`
- `KlerosJudge.updateArbitratorExtraData(bytes)` with `@notice` and `@param`
- `KlerosJudge.transferOwnership(address)` with `@notice` and `@param`
- `KlerosJudge.getArbitrationCost()` with `@notice` and `@return`
- public mappings `disputes`, `bondChallengeToDispute`, and `hasDispute` via `/// @notice`

### Undocumented interface entrypoints

These external declarations on `ISimpleBondV4` currently have no NatSpec:

- `registerAsJudge()`
- `ruleForChallenger(uint256 bondId, uint256 feeCharged)`
- `ruleForPoster(uint256 bondId, uint256 feeCharged)`
- `rejectBond(uint256 bondId)`
- `rulingWindowStart(uint256 bondId) returns (uint256)`
- `rulingDeadline(uint256 bondId) returns (uint256)`
- `getChallenge(uint256 bondId, uint256 index) returns (address challenger, uint8 status, string memory metadata)`
- `getChallengeCount(uint256 bondId) returns (uint256)`

### Undocumented generated getters

These `public` state variables generate ABI getter functions but currently have no NatSpec comments:

- `RULING_CHOICES`
- `RULING_POSTER`
- `RULING_CHALLENGER`
- `arbitrator`
- `simpleBond`
- `arbitratorExtraData`
- `owner`

### Partially documented constructor

The constructor has `@param` tags for all arguments, but it is still missing a top-level `@notice` summary describing the deployment side effects:

- stores the arbitrator, bond adapter target, and extra data
- registers itself as a judge in `SimpleBondV4`
- emits the initial ERC-1497 `MetaEvidence`

### Out of scope for the NatSpec patch

These items do not appear to require action for the parent task:

- internal helper functions already documented with `@dev`
- private/internal constants and storage that do not generate public ABI surface
- events, which are part of the ABI but are not the "public functions" named by the parent task

## Implementation Risk

This should be a low-risk patch:

- no control flow changes
- no storage layout changes
- no ABI changes beyond documentation metadata

The appropriate verification step is a compile pass, such as `npm run compile`, to confirm the file still builds cleanly after the NatSpec additions.
