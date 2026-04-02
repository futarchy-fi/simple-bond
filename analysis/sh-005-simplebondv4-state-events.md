# sh-005 Analysis: add `SimpleBondV4` bond state-change events

## Summary

The task is to add lightweight lifecycle events to `contracts/SimpleBondV4.sol` and extend `test/SimpleBondV4.test.js` to prove they are emitted:

- `BondCreated(bondId, poster, token, amount)`
- `BondChallenged(bondId, challenger, amount)`
- `BondConceded(bondId)`
- `BondResolved(bondId, verdict)`

The contract already emits richer, more detailed events for the same flows, so this is primarily an observability and indexing change rather than a behavior change.

## Current State

`SimpleBondV4` already emits the following events in the relevant paths:

- `createBond(...)` emits a verbose `BondCreated(...)` with judge, fee, timing, and metadata fields.
- `challenge(...)` emits `Challenged(...)`.
- `concede(...)` emits `ClaimConceded(...)`.
- `ruleForChallenger(...)` emits `RuledForChallenger(...)`.
- `ruleForPoster(...)` emits `RuledForPoster(...)`.

The existing V4 test suite already has event assertions around all of those paths, so the most natural implementation will be to extend the current tests rather than add a separate new test file.

## Main Implementation Risk

The requested lightweight `BondCreated(bondId, poster, token, amount)` conflicts by name with the existing verbose `BondCreated(...)` event already declared in `SimpleBondV4`.

That creates a compatibility decision:

- additive interpretation:
  add a second overloaded `BondCreated` event and emit both the verbose and lightweight variants
- breaking interpretation:
  replace the current verbose `BondCreated` event with the requested lightweight one

The additive path is safer for downstream meaning, but it is not free:

- the current test suite refers to `BondCreated` by name
- `backend/config.mjs` includes a hand-written `BondCreated` event ABI
- `frontend/index.html` also includes a hand-written `BondCreated` event ABI and uses `filters.BondCreated(...)`

If the event name becomes overloaded, those consumers may need explicit signature-based event references instead of name-only lookups. That is the main thing to settle before implementation.

## Open Specification Gap

The task names `BondResolved(bondId, verdict)` but does not specify the `verdict` type or encoding.

Before implementation, the code should choose and then test one explicit representation, for example:

- `bool verdict`
  - `true = poster won`, `false = challenger won`
- `uint8 verdict`
  - `1 = poster won`, `2 = challenger won`

`uint8` is more explicit and easier to extend, but either choice is workable if the encoding is fixed in tests.

## Recommended Approach

1. Update `contracts/SimpleBondV4.sol`.
2. Add the new lightweight events next to the existing event declarations.
3. Emit them in the same functions that already emit the richer lifecycle events:
   - `createBond(...)`
   - `challenge(...)`
   - `concede(...)`
   - `ruleForPoster(...)`
   - `ruleForChallenger(...)`
4. Keep the existing detailed events unless the task owner explicitly wants a breaking ABI change.
5. If the exact `BondCreated` name must be preserved for the lightweight variant, expect follow-on ABI/filter updates anywhere the contract ABI is hard-coded.

## Emit Points

- `createBond(...)`
  - emit the lightweight create event after the token transfer and alongside the existing verbose `BondCreated(...)`
- `challenge(...)`
  - emit `BondChallenged(bondId, msg.sender, b.challengeAmount)` after escrow succeeds
- `concede(...)`
  - emit `BondConceded(bondId)` after state flips and refunds complete
- `ruleForPoster(...)`
  - emit `BondResolved(bondId, <poster-wins verdict>)`
- `ruleForChallenger(...)`
  - emit `BondResolved(bondId, <challenger-wins verdict>)`

`rejectBond(...)`, `withdrawBond(...)`, and `claimTimeout(...)` already have their own terminal-state events and do not naturally map to a `verdict`, so they should remain unchanged unless scope expands.

## Test Plan

Extend `test/SimpleBondV4.test.js` with focused assertions in the existing describe blocks:

1. Bond creation:
   - assert the new lightweight create event is emitted with bond id, poster, token, and bond amount
2. Challenges:
   - assert `BondChallenged` is emitted with bond id, challenger, and `challengeAmount`
3. Poster concession:
   - assert `BondConceded` is emitted with the bond id
4. Judge ruling for poster:
   - assert `BondResolved` is emitted with the poster-win verdict
5. Judge ruling for challenger:
   - assert `BondResolved` is emitted with the challenger-win verdict

If the contract uses an overloaded `BondCreated`, the existing creation assertions will likely need to be rewritten to disambiguate which `BondCreated` log they are checking.

## Verification

Implementation should be verified with:

1. `npx hardhat test test/SimpleBondV4.test.js`
2. if the `BondCreated` overload path is taken, a quick smoke check of any hand-maintained ABI consumers:
   - `backend/config.mjs`
   - `frontend/index.html`

## Expected Change Surface

Likely required:

- `contracts/SimpleBondV4.sol`
- `test/SimpleBondV4.test.js`

Conditionally required if `BondCreated` is overloaded and downstream consumers must understand it:

- `backend/config.mjs`
- `frontend/index.html`
