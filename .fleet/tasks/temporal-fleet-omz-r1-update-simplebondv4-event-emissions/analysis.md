# temporal-fleet-omz-r1 Analysis: lightweight lifecycle event emissions in `SimpleBondV4`

## Summary

This task is narrow and contract-focused, but the current branch already appears to satisfy the requested event surface in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-update-simplebondv4-event-emissions/contracts/SimpleBondV4.sol#L1).

The contract keeps the existing detailed lifecycle events and also exposes additive lightweight events for:

- bond creation
- challenge creation
- poster concession
- judge resolution

The explicit `BondResolved` verdict encoding is already present as `uint8`, with:

- `1` = poster won
- `2` = challenger won

The main work for this task is therefore to confirm the event surface, preserve it if any implementation changes are still pending, and avoid breaking off-chain consumers that depend on the detailed `BondCreated` event.

## Current State

`SimpleBondV4` currently emits both a detailed and a lightweight signal for each requested lifecycle transition:

- `createBond()` emits:
  - detailed `BondCreated(uint256,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,string)`
  - lightweight `BondCreated(uint256,address,address,uint256)`
- `challenge()` emits:
  - detailed `Challenged(uint256,uint256,address,string)`
  - lightweight `BondChallenged(uint256,address,uint256)`
- `concede()` emits:
  - detailed `ClaimConceded(uint256,address,string)`
  - lightweight `BondConceded(uint256)`
- `ruleForPoster()` emits:
  - detailed `RuledForPoster(uint256,uint256,address,uint256)`
  - lightweight `BondResolved(uint256,uint8)` with verdict `1`
- `ruleForChallenger()` emits:
  - detailed `RuledForChallenger(uint256,uint256,address,uint256)`
  - lightweight `BondResolved(uint256,uint8)` with verdict `2`

That matches the task's requested additive pattern: keep the richer events and provide a normalized top-level lifecycle layer.

## Important Detail

The only subtle ABI concern is the overloaded `BondCreated` name.

The contract now has two `BondCreated` event signatures:

- the existing detailed create event
- the new lightweight create event

That is acceptable in Solidity and in tests, but anything off-chain that refers to `BondCreated` by bare name may need to disambiguate by full signature if it ever includes both overloads in its ABI.

## Recommended Approach

1. Treat this as a confirm-or-preserve task, not a redesign.
2. Keep the current detailed events unchanged.
3. Keep the lightweight companions additive only:
   - `BondCreated(bondId, poster, token, amount)`
   - `BondChallenged(bondId, challenger, amount)`
   - `BondConceded(bondId)`
   - `BondResolved(bondId, verdict)`
4. Keep the verdict encoding explicit and stable as `uint8`:
   - `1` for poster win
   - `2` for challenger win
5. If any further implementation work is required, update tests before or alongside contract edits so the overloaded `BondCreated` assertions remain signature-specific.

## Test Surface

[`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-update-simplebondv4-event-emissions/test/SimpleBondV4.test.js#L1) already reflects this event model:

- it defines both `BondCreated` signatures explicitly
- it asserts both create events on bond creation
- it asserts `BondChallenged` on challenge
- it asserts `BondConceded` on concession
- it asserts `BondResolved(..., 1)` for poster rulings
- it asserts `BondResolved(..., 2)` for challenger rulings

That means the existing test suite is already structured to verify the requested behavior.

## Expected Implementation Scope

If this task moves from analysis to code changes, the likely scope is still small:

- primary file: [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-update-simplebondv4-event-emissions/contracts/SimpleBondV4.sol#L1)
- primary verification file: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-update-simplebondv4-event-emissions/test/SimpleBondV4.test.js#L1)

Potential follow-up review surface if ABI consumers are touched:

- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-update-simplebondv4-event-emissions/frontend/index.html#L1)
- [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-update-simplebondv4-event-emissions/backend/config.mjs#L1)
- [`backend/watcher.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-update-simplebondv4-event-emissions/backend/watcher.mjs#L1)

## Verification Plan

If implementation changes are made, verify with:

1. `npx hardhat test test/SimpleBondV4.test.js`
2. Confirm both `BondCreated` overloads are emitted and asserted by full signature.
3. Confirm `BondResolved` remains `uint8`-encoded as:
   - `1` for poster win
   - `2` for challenger win
4. If any frontend or backend ABI is updated to include both `BondCreated` overloads, review event parsing and filtering carefully to avoid ambiguous name-based handling or duplicate processing.

## Bottom Line

Based on the current branch contents, the requested lightweight lifecycle emissions are already implemented in the intended additive form. The main implementation risk is not missing contract events, but accidentally regressing the overloaded `BondCreated` handling in tests or off-chain consumers.
