# dt-001 Analysis: Harden `SimpleBondV4` input validation

## Summary

This is a contract-hardening task on `contracts/SimpleBondV4.sol`.

Most zero-amount validation is already present where it materially affects fund flows:

- `createBond()` rejects zero `bondAmount`
- `createBond()` rejects zero `challengeAmount`
- `judgeFee` is bounded by `challengeAmount`
- `feeCharged == 0` is intentionally allowed when a judge waives fees
- `minFee == 0` is intentionally allowed because the contract documents free judging as valid

The remaining gaps are mostly:

- missing zero-address validation for token parameters
- missing explicit invalid-`bondId` checks in several public functions
- missing explicit batch/index validation in a few public helpers

## Public Function Review

### Judge registry and fee configuration

- `registerAsJudge()`
  - no input parameters
  - no input-validation change appears required unless duplicate registration should be rejected as a separate state-validation policy
- `deregisterAsJudge()`
  - already checks registration status
- `setJudgeFee(address token, uint256 minFee)`
  - missing `token != address(0)`
  - `minFee == 0` should remain allowed
- `setJudgeFees(address[] tokens, uint256[] minFees)`
  - already checks length equality
  - missing per-entry `tokens[i] != address(0)`
  - an empty batch is likely an invalid no-op and is a reasonable extra guard
  - `minFees[i] == 0` should remain allowed

### Bond creation and challenge entrypoints

- `createBond(...)`
  - already checks:
    - nonzero `bondAmount`
    - nonzero `challengeAmount`
    - nonzero `judge`
    - future `deadline`
    - nonzero `rulingBuffer`
    - `judgeFee <= challengeAmount`
    - registered judge
    - `judgeFee >= judgeMinFees[judge][token]`
  - missing `token != address(0)`
  - `acceptanceDelay == 0` looks intentionally valid and should not be changed without a product decision
- `challenge(uint256 bondId, string calldata _metadata)`
  - already checks bond existence and deadline/state constraints
  - no obvious additional input-validation gap surfaced from this review
- `rejectBond(uint256 bondId)`
  - already checks bond existence and basic state constraints

### Poster, ruling, and timeout flows

These functions all accept `bondId`, but not all of them explicitly reject a nonexistent bond before deeper state checks:

- `concede(uint256 bondId, string calldata _metadata)`
- `ruleForChallenger(uint256 bondId, uint256 feeCharged)`
- `ruleForPoster(uint256 bondId, uint256 feeCharged)`
- `withdrawBond(uint256 bondId)`
- `claimTimeout(uint256 bondId)`

Current behavior on an invalid `bondId` is inconsistent:

- some paths revert with indirect errors such as `"Only poster"` or `"Only judge"`
- some paths can fail later from time-window logic rather than from a clear existence check

This should be normalized with an explicit bond-existence guard near the top of each function.

### Public view helpers

- `getChallengeCount(uint256 bondId)`
  - currently returns `0` for a nonexistent bond, which is ambiguous with a real bond that has no challenges
  - should likely reject invalid `bondId`
- `getChallenge(uint256 bondId, uint256 index)`
  - should explicitly validate bond existence
  - should explicitly validate `index < challenges[bondId].length` instead of relying on an array-bounds panic
- `rulingWindowStart(uint256 bondId)`
  - should reject invalid `bondId`
  - currently computes from zeroed storage for nonexistent bonds
- `rulingDeadline(uint256 bondId)`
  - should reject invalid `bondId`
- `getJudgeMinFee(address judge, address token)`
  - potential zero-address validation candidate if the task scope is interpreted strictly
  - this is the only notable compatibility decision, because permissive getters often return `0` for unknown keys and some callers may rely on that

## Recommended implementation shape

The lowest-risk implementation is to add small internal guards and reuse them:

- `_requireBondExists(uint256 bondId)`
- `_requireNonZeroToken(address token)`

That keeps revert behavior consistent without changing documented economics.

## Scope notes

- Do not add new nonzero requirements for `minFee` or `feeCharged`; zero is already part of the documented behavior.
- Do not add `acceptanceDelay > 0` unless product requirements explicitly change.
- The main open decision is whether `getJudgeMinFee()` should stay permissive or become strict about zero addresses.
