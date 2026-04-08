# sh-006 Analysis: add a custom error for insufficient challenge amount

## Summary

The requested end state is straightforward:

- add `InsufficientChallengeAmount(uint256 provided, uint256 required)` to `contracts/SimpleBondV4.sol`
- document it with NatSpec
- replace the current string-based revert with the custom error
- update the V4 test suite to assert the custom error and its arguments

The only real wrinkle is that the task description refers to `challengeBond`, but the current V4 contract does not have a `challengeBond` function.

## Current State

The closest match in the current code is in `createBond(...)`:

- `contracts/SimpleBondV4.sol:255` currently enforces
  `require(judgeFee <= challengeAmount, "Fee > challenge amount");`

That is the only plain require in V4 that checks whether a configured `challengeAmount` is sufficient for some required threshold.

By contrast, the actual challenge entrypoint is:

- `contracts/SimpleBondV4.sol:301`
  `function challenge(uint256 bondId, string calldata _metadata) external`

That function does not accept an amount argument and does not perform an explicit "provided vs required" challenge-amount validation. It simply pulls `b.challengeAmount` via `safeTransferFrom(...)`.

## Likely Intended Interpretation

The most coherent implementation is to treat the task as targeting the `createBond(...)` validation at `contracts/SimpleBondV4.sol:255`.

Under that interpretation:

1. Add a new custom error near the contract declarations.
2. Add NatSpec describing what `provided` and `required` mean.
3. Replace the string revert with:
   `if (challengeAmount < judgeFee) revert InsufficientChallengeAmount(challengeAmount, judgeFee);`
4. Update the existing test that currently expects `"Fee > challenge amount"`.

## Recommended Error Shape

Recommended NatSpec wording:

```solidity
/// @notice Reverts when the configured challenge amount is lower than the amount required.
/// @param provided The challenge amount supplied when creating the bond.
/// @param required The minimum required challenge amount.
error InsufficientChallengeAmount(uint256 provided, uint256 required);
```

For the current validation, `required` should be `judgeFee`.

That makes the revert payload explicit:

- `provided = challengeAmount`
- `required = judgeFee`

## Test Plan

The existing test already covers the failing case:

- `test/SimpleBondV4.test.js:608`
  `"reverts if judgeFee > challengeAmount"`

That test should be rewritten to assert the custom error instead of the string message:

```js
await expect(
  bond.connect(poster).createBond(
    tokenAddr,
    BOND_AMOUNT,
    CHALLENGE_AMOUNT,
    CHALLENGE_AMOUNT + 1n,
    judge.address,
    deadline,
    ACCEPTANCE_DELAY,
    RULING_BUFFER,
    ""
  )
)
  .to.be.revertedWithCustomError(bond, "InsufficientChallengeAmount")
  .withArgs(CHALLENGE_AMOUNT, CHALLENGE_AMOUNT + 1n);
```

The current Hardhat setup already includes `@nomicfoundation/hardhat-chai-matchers`, so no harness changes should be needed.

## Risk / Spec Mismatch

The task text should be read carefully during implementation:

- there is no `challengeBond` function in `SimpleBondV4.sol`
- the live `challenge(...)` path has no explicit amount parameter to compare against a required amount

If the task owner literally wants a custom error during `challenge(...)`, that is a different change than the one described above and would require additional design work, because the current interface does not expose a caller-provided challenge amount to validate.

## Expected Change Surface

Only these files should need modification for the implementation:

- `contracts/SimpleBondV4.sol`
- `test/SimpleBondV4.test.js`

## Verification

Implementation should be verified with:

1. `npx hardhat test test/SimpleBondV4.test.js`

That should be sufficient because the behavior change is limited to one revert path and its assertion.
