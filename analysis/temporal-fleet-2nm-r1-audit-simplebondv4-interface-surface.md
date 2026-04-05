# temporal-fleet-2nm-r1 Analysis: audit undocumented `SimpleBondV4` ABI surface

## Summary

This audit covers every public or external function, generated getter, event, and custom error in [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol).

In-scope ABI surface count:

- 17 explicit public or external functions
- 5 generated getters from `public` state variables
- 16 events
- 1 custom error

29 of those 39 ABI items are currently missing NatSpec entirely or are missing required `@param` or `@return` tags.

## Scope Assumption

For generated getters, this audit follows the repo's existing pattern in [contracts/KlerosJudge.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/KlerosJudge.sol#L116), where a `/// @notice` comment on a `public` state variable is treated as sufficient documentation for the generated getter.

Under that interpretation:

- `judgeMinFees` is not flagged because it already has NatSpec at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L68)
- `nextBondId`, `bonds`, `challenges`, and `judges` are flagged because they have no NatSpec at all

If the task owner wants explicit getter-parameter or getter-return tags for public variables, `judgeMinFees` may also need follow-up documentation. The current repo does not document public-variable getters that way elsewhere.

## Missing NatSpec Surface

### Public / External Functions With Missing Tags

- `createBond(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L241) has `@notice`, `@dev`, and all `@param` tags, but it is missing `@return bondId`.
- `withdrawBond(uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L453) has `@notice` and `@dev`, but it is missing `@param bondId`.
- `claimTimeout(uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L474) has `@notice`, but it is missing `@param bondId`.
- `getChallengeCount(uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L497) has no NatSpec; it is missing `@notice`, `@param bondId`, and a `@return` tag for the count.
- `getChallenge(uint256,uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L502) has no NatSpec; it is missing `@notice`, `@param bondId`, `@param index`, `@return challenger`, `@return status`, and `@return metadata`.
- `getJudgeMinFee(address,address)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L512) has `@notice` only; it is missing `@param judge`, `@param token`, and a `@return` tag for the minimum fee.
- `rulingWindowStart(uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L522) has `@notice` only; it is missing `@param bondId` and a `@return` tag for the window start timestamp.
- `rulingDeadline(uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L530) has `@notice` only; it is missing `@param bondId` and a `@return` tag for the ruling deadline timestamp.

### Generated Getters With No NatSpec

- `nextBondId()` generated from [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L64) has no NatSpec on the backing variable.
- `bonds(uint256 bondId)` generated from [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L65) has no NatSpec on the backing variable.
- `challenges(uint256 bondId, uint256 index)` generated from [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L66) has no NatSpec on the backing variable.
- `judges(address judge)` generated from [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L67) has no NatSpec on the backing variable.

### Events With No NatSpec At All

- The verbose `BondCreated(...)` overload at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L73) has no NatSpec; it is missing `@notice` and `@param` tags for `bondId`, `poster`, `judge`, `token`, `bondAmount`, `challengeAmount`, `judgeFee`, `deadline`, `acceptanceDelay`, `rulingBuffer`, and `metadata`.
- The lightweight `BondCreated(...)` overload at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L87) has no NatSpec; it is missing `@notice` and `@param` tags for `bondId`, `poster`, `token`, and `amount`.
- `Challenged(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L94) has no NatSpec; it is missing `@notice` and `@param` tags for `bondId`, `challengeIndex`, `challenger`, and `metadata`.
- `BondChallenged(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L101) has no NatSpec; it is missing `@notice` and `@param` tags for `bondId`, `challenger`, and `amount`.
- `BondConceded(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L114) has no NatSpec; it is missing `@notice` and `@param bondId`.
- `RuledForChallenger(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L119) has no NatSpec; it is missing `@notice` and `@param` tags for `bondId`, `challengeIndex`, `challenger`, and `feeCharged`.
- `RuledForPoster(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L126) has no NatSpec; it is missing `@notice` and `@param` tags for `bondId`, `challengeIndex`, `challenger`, and `feeCharged`.
- `ChallengeRefunded(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L133) has no NatSpec; it is missing `@notice` and `@param` tags for `bondId`, `challengeIndex`, and `challenger`.
- `BondWithdrawn(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L139) has no NatSpec; it is missing `@notice` and `@param bondId`.
- `BondTimedOut(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L140) has no NatSpec; it is missing `@notice` and `@param bondId`.
- `JudgeRegistered(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L143) has no NatSpec; it is missing `@notice` and `@param judge`.
- `JudgeDeregistered(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L144) has no NatSpec; it is missing `@notice` and `@param judge`.
- `JudgeFeeUpdated(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L145) has no NatSpec; it is missing `@notice` and `@param` tags for `judge`, `token`, and `newMinFee`.
- `BondRejectedByJudge(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L146) has no NatSpec; it is missing `@notice` and `@param` tags for `bondId` and `judge`.

### Events With Partial NatSpec

- `ClaimConceded(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L108) has `@notice` only; it is missing `@param bondId`, `@param poster`, and `@param metadata`.
- `BondResolved(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L117) has `@notice` only; it is missing `@param bondId` and `@param verdict`.

### Custom Error With No NatSpec

- `InsufficientChallengeAmount(uint256,uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L33) has no NatSpec; it is missing `@notice`, `@param challengeAmount`, and `@param judgeFee`.

## Surface Already Documented Enough For This Audit

These items do not appear to need NatSpec changes under the scope assumption above:

- `registerAsJudge()` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L154)
- `deregisterAsJudge()` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L163)
- `setJudgeFee(address,uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L175)
- `setJudgeFees(address[],uint256[])` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L187)
- `rejectBond(uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L203)
- `challenge(uint256,string)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L305)
- `concede(uint256,string)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L341)
- `ruleForChallenger(uint256,uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L374)
- `ruleForPoster(uint256,uint256)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L414)
- `judgeMinFees(address,address)` generated from [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface/contracts/SimpleBondV4.sol#L69)
