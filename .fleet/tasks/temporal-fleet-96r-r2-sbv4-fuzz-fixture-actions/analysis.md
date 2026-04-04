# temporal-fleet-96r-r2-sbv4-fuzz-fixture-actions Analysis: add a reusable `SimpleBondV4` fuzz fixture and action driver

## Summary

This task is the fixture-and-driver layer for the parent fuzz effort, not the invariant layer and not the fuzz-test file itself.

The repository already has the needed lifecycle coverage and a small set of inline helpers inside [`test/SimpleBondV4.test.js`](../../../test/SimpleBondV4.test.js). The right implementation is to extract that setup into a reusable CommonJS module under `test/helpers/` and expand it into deterministic action wrappers that future seeded tests can call without duplicating deployment, actor provisioning, approvals, or time handling.

## Current State

- The parent decomposition already splits this work into a dedicated helper/action task before invariants and fuzz tests are added; see [`decomposition.json`](../temporal-fleet-96r/decomposition.json) entries `sbv4-fuzz-fixture-actions`, `sbv4-fuzz-invariants`, and `sbv4-fuzz-tests`.
- [`test/SimpleBondV4.test.js`](../../../test/SimpleBondV4.test.js) already contains the direct extraction candidates:
  - `deployFixture` at lines 28-49
  - `createDefaultBond` at lines 51-61
  - `advanceToRulingWindow` at lines 63-67
  - `advancePastRulingDeadline` at lines 69-72
  - `challengeBond` at lines 74-76
- [`contracts/SimpleBondV4.sol`](../../../contracts/SimpleBondV4.sol) already exposes every action this helper needs to drive:
  - `createBond` at lines 241-291
  - `challenge` at lines 305-325
  - `concede` at lines 341-361
  - `ruleForChallenger` at lines 374-404
  - `ruleForPoster` at lines 414-441
  - `withdrawBond` at lines 453-465
  - `claimTimeout` at lines 474-493
  - `rulingWindowStart` at lines 522-525
  - `rulingDeadline` at lines 530-533
  - `rejectBond` at lines 203-220
- There is no existing `test/helpers/` directory and no existing shared test fixture module.
- The test stack is plain Hardhat + Mocha/Chai CommonJS. There is no separate fuzzing framework to integrate with, so the helper should stay in JavaScript and match the current `require(...)` style.

## Scope Boundary

This child task should deliver reusable deployment/setup plus deterministic state-transition wrappers.

It should not yet:

- add the invariant assertion layer from `sbv4-fuzz-invariants`
- add seeded sequence tests from `sbv4-fuzz-tests`
- change [`contracts/SimpleBondV4.sol`](../../../contracts/SimpleBondV4.sol) unless the helper work exposes a real bug

That separation matters because the helper should stay free of `expect(...)` assertions and should primarily provide reusable state access plus legal action execution.

## Recommended Helper Shape

Create a new module such as [`test/helpers/simpleBondV4Fuzz.js`](../../../test/helpers/simpleBondV4Fuzz.js) that exports one primary factory, for example:

```js
async function deploySimpleBondV4FuzzFixture(options = {}) { ... }
```

The returned object should include:

- `token` and `bond`
- `actors`
  - `poster`
  - `judge`
  - `outsider`
  - `challengers`
- `addresses`
  - token address
  - bond address
- `constants`
  - default `bondAmount`
  - default `challengeAmount`
  - default `judgeFee`
  - default `acceptanceDelay`
  - default `rulingBuffer`
  - default metadata strings
- `actions`
  - `createBond`
  - `challenge`
  - `advanceToRulingWindow`
  - `advancePastRulingDeadline`
  - `ruleForPoster`
  - `ruleForChallenger`
  - `concede`
  - `rejectBond`
  - `withdrawBond`
  - `claimTimeout`
- `read`
  - helpers for reading bond/challenge state without embedding assertions

## Actor Provisioning

The current inline fixture only funds `poster` and three challengers. That is enough for the deterministic unit suite, but it is slightly narrow for future fuzz-style sequences.

The helper should instead provision a stable actor roster from `ethers.getSigners()` and pre-approve the bond contract for every account expected to post tokens:

1. reserve canonical roles first
   - signer 0: `poster`
   - signer 1: `judge`
   - signer 2+: challenger pool
2. keep one non-funded or separately labeled actor as `outsider` for timeout calls and access-control coverage
3. mint a large deterministic balance and set `MaxUint256` approval for `poster` and every challenger in the pool

Using a challenger pool rather than three named challenger variables will make the later fuzz tests able to drive deeper queues without further fixture changes.

## Action Driver Design

The action wrappers should be deterministic and explicit. They should not choose random callers internally and they should not depend on ambient `Math.random`.

Recommended behavior:

1. `createBond(overrides = {})`
   - uses the canonical poster, judge, token, and default parameters unless overridden
   - returns the created `bondId`
2. `challenge({ bondId = 0, challenger = actors.challengers[0], metadata })`
   - defaults metadata to a stable string
   - waits for the transaction so future callers can read state immediately
3. `advanceToRulingWindow({ bondId = 0 })`
   - uses `bond.rulingWindowStart(bondId)`
   - advances via Hardhat `time.increaseTo`
4. `advancePastRulingDeadline({ bondId = 0 })`
   - uses `bond.rulingDeadline(bondId)`
   - advances one second past the returned timestamp
5. `ruleForPoster({ bondId = 0, feeCharged = judgeFee, caller = judge })`
6. `ruleForChallenger({ bondId = 0, feeCharged = judgeFee, caller = judge })`
7. `concede({ bondId = 0, metadata, caller = poster })`
8. `rejectBond({ bondId = 0, caller = judge })`
9. `withdrawBond({ bondId = 0, caller = poster })`
10. `claimTimeout({ bondId = 0, caller = outsider })`

These wrappers should be thin and predictable. The later seeded tests can decide which wrapper to call and when.

## State Access Needed For Later Tasks

Even though invariant assertions belong to the next child task, this helper should expose enough raw reads so the next task does not need to re-implement state loading.

Useful non-asserting reads:

- `getBond(bondId)`
- `getChallengeCount(bondId)`
- `getChallenge(bondId, index)`
- `getChallenges(bondId)` to materialize the queue
- `balances(addresses)` or a small token-balance snapshot helper
- `contractBalance()` for the bond contract's token holdings

That keeps the helper reusable while preserving the task boundary: reads now, assertions later.

## Implementation Plan

1. Create `test/helpers/`.
2. Add a new `simpleBondV4Fuzz.js` module in CommonJS format.
3. Move the canonical constants from [`test/SimpleBondV4.test.js`](../../../test/SimpleBondV4.test.js) into the helper or mirror them there so later fuzz tests have one source of defaults.
4. Implement the deploy/setup factory:
   - deploy `TestToken`
   - deploy `SimpleBondV4`
   - derive actor roles from signers
   - mint balances
   - set approvals
   - register the judge
   - set the judge's token fee
5. Implement the deterministic action wrappers around the contract entrypoints and time helpers.
6. Export the factory plus any shared constants that future tests may import.
7. Keep this task's module free of Chai assertions so the next child task can layer invariants on top cleanly.

## Expected Files

Most likely:

- new [`test/helpers/simpleBondV4Fuzz.js`](../../../test/helpers/simpleBondV4Fuzz.js)

Possibly:

- small import or extraction cleanup in [`test/SimpleBondV4.test.js`](../../../test/SimpleBondV4.test.js) if sharing constants materially reduces duplication

Probably not:

- [`contracts/SimpleBondV4.sol`](../../../contracts/SimpleBondV4.sol)
- [`package.json`](../../../package.json)
- [`hardhat.config.js`](../../../hardhat.config.js)

## Verification Plan

For this child task, verification should focus on helper usability rather than full fuzz coverage:

1. load the new helper from a test context without syntax/runtime errors
2. confirm the fixture deploys `TestToken` and `SimpleBondV4`
3. confirm poster/challenger approvals are in place
4. confirm the judge is registered and has the default minimum fee configured for the fixture token
5. confirm each wrapper successfully drives the matching contract entrypoint when called in a legal order

The later child tasks should handle invariant coverage and seeded-sequence execution.

## Risks And Notes

- The biggest design risk is making the helper too smart. If it silently chooses callers, timestamps, or next actions, later seeded tests will be harder to reason about and reproduce.
- The second risk is under-provisioning challengers. A three-challenger helper would force later fuzz tests to patch the fixture again.
- Time-based actions need dedicated wrappers because `ruleForPoster`, `ruleForChallenger`, and `claimTimeout` are only legal in specific windows defined by [`SimpleBondV4.sol`](../../../contracts/SimpleBondV4.sol).
- The helper should not absorb the invariant task by mixing in `expect(...)` checks. Keeping the module as fixture + actions + reads matches the parent decomposition cleanly.
