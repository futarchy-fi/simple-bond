# parent-tw-002 Analysis: add comprehensive custom errors to `KlerosJudge.sol`

## Summary

`contracts/KlerosJudge.sol` currently contains 25 string-based `require(...)` guards spread across four distinct function groups:

1. constructor and owner/admin access control
2. arbitration request plus internal bond-validation helpers
3. ruling intake and evidence submission
4. ruling execution timing and terminal-state checks

The implementation is mostly mechanical, but it changes the revert surface for both the contract and `test/KlerosJudge.test.js`, which currently asserts many of the string messages directly.

## Require inventory by function group

### 1. Constructor and owner/admin functions

Relevant code:

- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L161) constructor
- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L184) `onlyOwner`
- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L320) `withdrawFees(...)`
- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L338) `transferOwnership(...)`

Current checks in this group:

- zero arbitrator address
- zero `simpleBond` address
- caller is not the owner
- zero withdrawal recipient
- zero new owner

Recommended error shape for this group:

- `error ZeroArbitratorAddress();`
- `error ZeroSimpleBondAddress();`
- `error CallerNotOwner(address caller, address owner);`
- `error ZeroWithdrawalRecipient();`
- `error ZeroNewOwner();`

This group is self-contained and low risk. It mainly affects deployment and owner-only admin flows.

### 2. Arbitration request plus bond-validation helpers

Relevant code:

- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L198) `requestArbitration(...)`
- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L367) `_readBondWord(...)`
- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L385) `_validateAndGetChallenge(...)`

Current checks in this group:

- dispute already exists for the current challenge
- bond is already past the ruling deadline
- `msg.value` is below the current arbitration cost
- refund of excess ETH fails
- low-level `bonds(uint256)` read fails
- returned bond data is shorter than expected
- bond judge is not this adapter
- bond is already settled
- bond was already conceded
- no pending challenge exists
- current challenge status is not pending
- caller is neither the poster nor the current challenger

Recommended error shape for this group:

- `error DisputeAlreadyExists(uint256 bondId, uint256 challengeIndex);`
- `error RulingDeadlinePassed(uint256 currentTime, uint256 deadline);`
- `error InsufficientArbitrationFee(uint256 provided, uint256 required);`
- `error ExcessFeeRefundFailed(address recipient, uint256 amount);`
- `error BondReadFailed(uint256 bondId);`
- `error InvalidBondData(uint256 bondId, uint256 wordIndex, uint256 dataLength);`
- `error BondJudgeMismatch(uint256 bondId, address expectedJudge, address actualJudge);`
- `error BondAlreadySettled(uint256 bondId);`
- `error BondAlreadyConceded(uint256 bondId);`
- `error NoPendingChallenge(uint256 bondId, uint256 currentChallenge, uint256 challengeCount);`
- `error ChallengeNotPending(uint256 bondId, uint256 challengeIndex, uint8 status);`
- `error ArbitrationRequesterNotAuthorized(address caller, address poster, address challenger);`

This is the densest change cluster. Most of the contract's pre-arbitration validation lives here, so it is the best place to keep naming consistent and to decide where dynamic context is worth carrying in the revert payload.

### 3. Ruling intake and evidence submission

Relevant code:

- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L246) `rule(...)`
- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L297) `submitEvidence(...)`

Current checks in this group:

- caller is not the configured arbitrator
- dispute is not active
- incoming ruling value is above `RULING_CHOICES`
- no dispute exists for a `(bondId, challengeIndex)` pair
- dispute attached to evidence is no longer active

Recommended error shape for this group:

- `error CallerNotArbitrator(address caller, address arbitrator);`
- `error DisputeNotActive(uint256 disputeID, uint8 status);`
- `error InvalidRuling(uint256 ruling, uint256 maxRuling);`
- `error NoDisputeForChallenge(uint256 bondId, uint256 challengeIndex);`

`DisputeNotActive(...)` can be reused in both `rule(...)` and `submitEvidence(...)` rather than creating two nearly identical errors.

### 4. Ruling execution

Relevant code:

- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/KlerosJudge.sol#L262) `executeRuling(...)`

Current checks in this group:

- dispute has not yet reached the ruled state
- current time is before the SimpleBond ruling window
- current time is after the SimpleBond ruling deadline

Recommended error shape for this group:

- `error DisputeNotRuled(uint256 disputeID, uint8 status);`
- `error RulingWindowNotOpen(uint256 currentTime, uint256 windowStart);`
- reuse `RulingDeadlinePassed(uint256 currentTime, uint256 deadline);`

This group is small but important because it governs the final state transition from stored Kleros outcome to on-chain SimpleBond settlement.

## Implementation notes

Recommended implementation style:

1. Declare all custom errors near the top of `KlerosJudge`, before the constructor.
2. Replace each `require(condition, "...")` with `if (!condition) revert ErrorName(...);`.
3. Reuse the same custom error when two checks express the same invariant, for example `CallerNotOwner`, `DisputeNotActive`, and `RulingDeadlinePassed`.
4. Prefer context-bearing parameters only where they improve debugging materially; the low-level bond-read helpers are the best candidates for richer payloads.
5. Keep zero-address errors specific to the call site rather than collapsing everything into one generic `ZeroAddress` error, because the task explicitly asks for descriptive names.

One ABI detail to keep simple: when encoding dispute status in errors, `uint8 status` is easier to assert in tests than exposing the enum type directly.

## Test impact

`test/KlerosJudge.test.js` currently uses string reverts for many `KlerosJudge` paths, including:

- constructor validation at [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L155)
- arbitration request failures at [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L221), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L231), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L246), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L258), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L269), and [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L308)
- ruling and execution failures at [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L340), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L505), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L519), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L534), and [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L550)
- evidence and owner-function failures at [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L637), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L650), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L672), [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L682), and [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L694)

These should move to `revertedWithCustomError(...)`, adding `.withArgs(...)` only where the chosen error payload includes dynamic values.

One important nuance: [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-parent-tw-002/test/KlerosJudge.test.js#L370) expects `"Already ruled"` from `MockArbitrator.giveRuling(...)`, which originates in [`contracts/MockArbitrator.sol`](/tmp/temporal-worktrees/task-parent-tw-002/contracts/MockArbitrator.sol#L54), not in `KlerosJudge.sol`. That assertion is outside the direct scope of this task unless the implementation also decides to refactor the mock.

## Verification

After implementation, the relevant verification should be:

1. `npx hardhat test test/KlerosJudge.test.js`
2. a broader compile or test pass if the repository uses shared matcher helpers for custom errors

The main review risk is not behavioral logic change; it is accidentally changing which revert fires first, or overloading errors with arguments that make the tests brittle without adding much value.
