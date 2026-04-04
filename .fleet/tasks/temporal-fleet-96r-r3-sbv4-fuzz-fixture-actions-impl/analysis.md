# temporal-fleet-96r-r3-sbv4-fuzz-fixture-actions-impl Analysis: implement the reusable `SimpleBondV4` fuzz fixture and action driver

## Summary

This task is the shared test-utility layer for the `SimpleBondV4` fuzz work.

The repository already has the core lifecycle coverage and a small set of inline helpers in `test/SimpleBondV4.test.js`. The implementation should extract that setup into a reusable CommonJS module at `test/helpers/simpleBondV4Fuzz.js`, expand it into deterministic action wrappers, and expose raw state readers that later invariant and seeded-sequence tasks can reuse directly.

The helper should stay intentionally thin:

- no randomness
- no `expect(...)` assertions
- no invariant logic
- no contract changes unless the extraction exposes a real bug

## Current State

### Parent task split

The current decomposition already places this work ahead of the invariant and fuzz-test tasks:

1. `sbv4-fuzz-fixture-actions-impl`
2. `sbv4-fuzz-invariants`
3. `sbv4-fuzz-tests`
4. `sbv4-fuzz-verification`

That ordering is important because later tasks should build on a stable deployment/action/read layer rather than re-implementing setup in each test.

### Existing extraction candidates

`test/SimpleBondV4.test.js` already contains the logic that should move into the reusable helper:

- `deployFixture()`
  - deploys `TestToken`
  - deploys `SimpleBondV4`
  - assigns `poster`, `judge`, three challengers, and `outsider`
  - mints poster/challenger balances
  - approves the bond contract
  - registers the judge
  - sets the default per-token judge fee
- `createDefaultBond()`
- `advanceToRulingWindow()`
- `advancePastRulingDeadline()`
- `challengeBond()`

The current inline helper shape is enough for the unit suite, but it is too narrow for reusable fuzz-style sequencing because it hardcodes only three challengers and does not expose general read helpers.

### Contract surface already available

`contracts/SimpleBondV4.sol` already exposes the actions and views the helper needs:

- creation: `createBond(...)`
- challenges: `challenge(...)`
- terminal/refund paths: `concede(...)`, `rejectBond(...)`, `withdrawBond(...)`, `claimTimeout(...)`
- rulings: `ruleForPoster(...)`, `ruleForChallenger(...)`
- reads: `bonds(...)`, `getChallengeCount(...)`, `getChallenge(...)`, `rulingWindowStart(...)`, `rulingDeadline(...)`, `getJudgeMinFee(...)`

No helper-specific contract hooks appear necessary.

### Test-stack constraints

- The repo uses Hardhat + Mocha/Chai in CommonJS.
- There is no separate fuzzing framework to integrate with.
- `@nomicfoundation/hardhat-network-helpers` is already present and used for time control.
- There is currently no `test/helpers/` directory.

## Scope Boundary

This task should deliver:

- a reusable fixture factory in `test/helpers/simpleBondV4Fuzz.js`
- deterministic action wrappers for the `SimpleBondV4` lifecycle
- raw read helpers for bond/challenge/balance inspection
- extraction of deployment/setup logic away from `test/SimpleBondV4.test.js`

This task should not yet deliver:

- invariant assertions
- seeded fuzz-style tests
- runtime/CI tuning for seed count

Those belong to the follow-up tasks and should consume this helper rather than being mixed into it.

## Recommended Module Shape

Create `test/helpers/simpleBondV4Fuzz.js` as a CommonJS module exporting one primary factory and shared defaults, for example:

```js
async function deploySimpleBondV4FuzzFixture(options = {}) { ... }

module.exports = {
  deploySimpleBondV4FuzzFixture,
  DEFAULTS,
};
```

The fixture result should be structured enough for later tests to use without guessing field names. A practical shape is:

```js
{
  bond,
  token,
  actors,
  addresses,
  defaults,
  actions,
  read,
}
```

Recommended sub-objects:

- `actors`
  - `poster`
  - `judge`
  - `outsider`
  - `challengers`
- `addresses`
  - `bond`
  - `token`
- `defaults`
  - `bondAmount`
  - `challengeAmount`
  - `judgeFee`
  - `acceptanceDelay`
  - `rulingBuffer`
  - `deadline`
  - default metadata strings

## Fixture Setup Requirements

The extracted fixture should preserve the semantics of the current V4 unit tests while broadening actor capacity for fuzz-style sequencing.

### Actor provisioning

Use deterministic signer assignment from `ethers.getSigners()`:

- signer `0`: `poster`
- signer `1`: `judge`
- one reserved signer: `outsider`
- all remaining eligible signers: challenger pool

The exact outsider position is less important than keeping it stable and excluding it from the funded challenger pool unless intentionally chosen later.

### Token funding and approvals

Mint a large deterministic amount to:

- `poster`
- every signer in `actors.challengers`

Then set `MaxUint256` approval for the deployed bond contract from each funded participant.

This is the main fixture change beyond the current inline setup: later tests should be able to drive deeper challenge queues without adding more one-off signers or approvals.

### Default judge registration

The helper should register the canonical judge and set a per-token default minimum fee for the fixture token during deployment.

That keeps the default path consistent with the existing test suite and satisfies the task requirement to "register a default judge fee."

### Default deadline

Mirror the current test convention:

- `deadline = (await time.latest()) + 3 * ONE_MONTH`

The deadline should be part of `defaults` so later tests can build expected-state calculations without re-deriving it from hidden setup.

## Action Driver Design

The helper should expose deterministic wrappers around the contract entrypoints. The wrappers should not choose actors or branch behavior internally beyond explicit defaults.

Recommended actions:

1. `createBond(overrides = {})`
2. `challenge({ bondId = 0, challenger = actors.challengers[0], metadata })`
3. `advanceToRulingWindow({ bondId = 0 })`
4. `advancePastRulingDeadline({ bondId = 0 })`
5. `ruleForPoster({ bondId = 0, feeCharged = defaults.judgeFee, caller = actors.judge })`
6. `ruleForChallenger({ bondId = 0, feeCharged = defaults.judgeFee, caller = actors.judge })`
7. `withdrawBond({ bondId = 0, caller = actors.poster })`
8. `claimTimeout({ bondId = 0, caller = actors.outsider })`

Useful but slightly beyond the minimum wording, and still worth including for later terminal-path coverage:

9. `concede({ bondId = 0, metadata, caller = actors.poster })`
10. `rejectBond({ bondId = 0, caller = actors.judge })`

### Wrapper behavior

Each action should:

- use stable defaults
- await the transaction before returning
- avoid assertions
- return enough information for callers to inspect results immediately

For `createBond(...)`, the cleanest deterministic pattern is:

1. read `bond.nextBondId()` before sending the transaction
2. submit the transaction
3. await confirmation
4. return that pre-read `bondId` along with the transaction or receipt

That avoids depending on event parsing for the most common setup step.

### Time wrappers

The time wrappers are especially important because later tests need repeatable legal sequencing around:

- `rulingWindowStart(bondId)`
- `rulingDeadline(bondId)`

The helper should centralize these transitions rather than duplicating `time.increaseTo(...)` arithmetic in every test.

## Raw Read Layer

The read layer should expose raw state without embedding any opinionated assertions. Later invariant helpers will sit on top of this.

Recommended reads:

- `getBond(bondId)`
- `getChallengeCount(bondId)`
- `getChallenge(bondId, index)`
- `getChallenges(bondId)`
- `getJudgeMinFee(judgeAddress = actors.judge.address, tokenAddress = addresses.token)`
- `balanceOf(accountOrAddress)`
- `balancesOf(accounts)`
- `contractBalance()`

`getChallenges(bondId)` is especially useful because later invariant checks will need the entire queue without repeating array-loading boilerplate.

## Relationship To `test/SimpleBondV4.test.js`

The task description explicitly says to extract deployment/setup logic from `test/SimpleBondV4.test.js`, so the implementation should not leave the new helper completely unused.

The lowest-risk extraction is:

1. create the shared helper module
2. update `test/SimpleBondV4.test.js` to source setup/defaults from it where practical
3. keep the existing test semantics unchanged

A minimal refactor is sufficient. The goal is reuse and drift prevention, not a wholesale rewrite of the unit file.

## Recommended Implementation Plan

1. Create `test/helpers/`.
2. Add `test/helpers/simpleBondV4Fuzz.js` in CommonJS format.
3. Move or mirror the canonical V4 defaults from `test/SimpleBondV4.test.js` into the helper.
4. Implement the deployment factory:
   - derive signer roles
   - deploy `TestToken`
   - deploy `SimpleBondV4`
   - mint token balances to poster and the challenger pool
   - approve the bond contract
   - register the judge
   - set the judge's default token fee
   - compute the default deadline
5. Implement deterministic action wrappers for create/challenge/ruling/withdraw/timeout, plus `concede` and `rejectBond` if included.
6. Implement raw read helpers for bonds, challenges, and token balances.
7. Update `test/SimpleBondV4.test.js` enough to consume the extracted setup logic and avoid duplicated deployment/setup code.
8. Run focused verification.

## Likely Files

Expected:

- `test/helpers/simpleBondV4Fuzz.js`

Likely:

- `test/SimpleBondV4.test.js`

Unlikely:

- `contracts/SimpleBondV4.sol`
- `hardhat.config.js`
- `package.json`

## Verification Plan

The most relevant verification for this task is helper correctness and compatibility with existing V4 behavior.

Recommended checks:

1. `npx hardhat test test/SimpleBondV4.test.js`
2. if the helper is not exercised by the refactored unit suite strongly enough, add or run a focused smoke test that:
   - deploys the fixture
   - creates a bond
   - submits at least one challenge
   - drives one poster-win ruling
   - drives one timeout path on a fresh bond

The follow-up verification task can cover broader runtime practicality and seed reproducibility.

## Main Risks

- Making the helper too smart:
  - hidden caller selection or hidden branching would make later seeded tests harder to reason about.
- Under-provisioning challengers:
  - keeping only three named challengers would force another fixture refactor in the next task.
- Blurring fixture and invariant concerns:
  - adding `expect(...)` into the helper would violate the decomposition and make the helper harder to reuse.
- Leaving extraction incomplete:
  - if `test/SimpleBondV4.test.js` keeps owning the real setup logic, the new helper can drift immediately.

## Bottom Line

The implementation should produce a CommonJS fixture module that owns deployment, default actor/token/judge setup, deterministic lifecycle actions, and raw state reads. It should also absorb the existing inline V4 setup from `test/SimpleBondV4.test.js` enough that the helper becomes the canonical source of truth for later invariant and seeded-fuzz tasks.
