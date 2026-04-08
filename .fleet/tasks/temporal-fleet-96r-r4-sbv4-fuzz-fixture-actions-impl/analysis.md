# temporal-fleet-96r-r4-sbv4-fuzz-fixture-actions-impl Analysis

## Summary

This task is not greenfield on the current branch. The reusable helper already exists at `test/helpers/simpleBondV4Fuzz.js`, and `test/SimpleBondV4.test.js` is already wired to consume it.

That means the practical analysis for this round is:

- confirm the branch state matches the task description
- identify any small gaps or risks in the extracted helper shape
- keep the implementation boundary centered on test utilities, not contract changes

## Task Requirements

The task description calls for a reusable `SimpleBondV4` fuzz fixture/action layer that:

- adds `test/helpers/simpleBondV4Fuzz.js` in CommonJS
- extracts deployment/setup logic out of `test/SimpleBondV4.test.js`
- provisions a challenger pool with approvals
- registers a default judge fee
- exposes deterministic wrappers plus raw read helpers for create/challenge/ruling/withdraw/timeout flows

## Current Branch State

The current branch already satisfies the main requirements.

### Helper module exists and is CommonJS

`test/helpers/simpleBondV4Fuzz.js:1-312` is a CommonJS module using `require(...)` and `module.exports = { ... }`.

It exports:

- the fixture factory `deploySimpleBondV4FuzzFixture`
- shared constants/defaults
- event signature constants used by the unit suite

### Deployment/setup logic has already been extracted

`test/SimpleBondV4.test.js:4-58` imports the helper and uses it in `beforeEach(...)` instead of deploying/contracts-setting-up inline.

The fixture currently deploys:

- `TestToken`
- `SimpleBondV4`

It also assigns stable roles:

- signer `0` as `poster`
- signer `1` as `judge`
- one reserved `outsider`
- the remaining eligible signers as the challenger pool

### Challenger pool funding and approvals are already implemented

`test/helpers/simpleBondV4Fuzz.js:73-77` mints a deterministic token balance to `poster` and every challenger, then grants `MaxUint256` approvals to the bond contract for each funded participant.

This matches the task's intent to support reusable fuzz/sequencing work without repeating ad hoc setup.

### Default judge registration and fee setup are already implemented

`test/helpers/simpleBondV4Fuzz.js:95-100` registers the canonical judge and sets the per-token minimum fee for the fixture token by default.

That keeps the extracted fixture aligned with the current `SimpleBondV4` unit tests and satisfies the "register a default judge fee" requirement.

### Deterministic action wrappers already exist

The `actions` object in `test/helpers/simpleBondV4Fuzz.js:196-285` already provides deterministic wrappers for:

- `createBond`
- `challenge`
- `advanceToRulingWindow`
- `advancePastRulingDeadline`
- `ruleForPoster`
- `ruleForChallenger`
- `withdrawBond`
- `claimTimeout`
- `concede`
- `rejectBond`

Each wrapper is thin, assertion-free, and returns transaction context such as `bondId`, `challengeIndex`, `tx`, and `receipt`.

### Raw read helpers already exist

The `read` object in `test/helpers/simpleBondV4Fuzz.js:125-194` already exposes the raw state access that later invariant/fuzz tasks need:

- `getBond`
- `getCurrentChallenge`
- `getChallengeCount`
- `getChallenge`
- `getChallenges`
- `rulingWindowStart`
- `rulingDeadline`
- `latestTime`
- `getJudgeMinFee`
- `balanceOf`
- `balancesOf`
- `contractBalance`

## What I Would Preserve If Further Implementation Is Needed

If this task were reopened for code changes, the correct approach would be incremental rather than redesign-heavy:

1. Keep `test/helpers/simpleBondV4Fuzz.js` as the shared source of truth for fixture defaults, actors, action wrappers, and read helpers.
2. Keep `test/SimpleBondV4.test.js` consuming that helper instead of drifting back toward inline deployment/setup.
3. Keep the helper assertion-free so later invariant and seeded-sequence tasks can layer on top of raw state and deterministic transitions.
4. Avoid contract changes unless a helper-driven verification run exposes a real mismatch in `SimpleBondV4.sol`.

## Small Risks / Follow-up Notes

- `defaults.deadlineLeadTime` is always copied from `DEFAULTS.deadlineLeadTime`, even if `options.deadlineLeadTime` were ever provided. This is not a blocker for the task as described because callers can override `deadline` directly, but it is the clearest candidate for cleanup if future fuzz tests want configurable lead-time-derived deadlines.
- `pickOutsider(...)` reserves signer `5` when available, otherwise the last signer. That is deterministic and acceptable, but it implicitly removes one signer from the challenger pool and should stay stable so later fuzz tests do not depend on shifting actor assignment.
- The helper currently returns both named challengers (`challenger1`, `challenger2`, `challenger3`) and a general `challengers` array, which is useful for compatibility with the unit suite and for broader fuzz-style sequencing. That dual shape should be preserved unless all consumers are updated together.

## Verification Status

I attempted to run the targeted `SimpleBondV4` test file, but the environment does not currently have a usable local Hardhat installation:

```text
Error HHE22: Trying to use a non-local installation of Hardhat
```

So the current verification status is:

- branch inspection confirms the helper/action/read layer is already present and wired into the unit suite
- runtime verification is blocked in this worktree until local Node dependencies are installed

## Practical Plan

1. Treat the existing helper implementation as the canonical solution for this task.
2. If follow-up implementation work is requested, limit it to small helper-surface corrections rather than redesigning the fixture.
3. Once dependencies are available, verify with at least `test/SimpleBondV4.test.js` before making any additional fuzz/invariant work depend on the helper.
