# temporal-fleet-omz Analysis: Add event emissions to `SimpleBondV4`

## Summary

This is a narrow Solidity observability task centered on [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L27). The requested work is additive rather than behavioral: preserve the existing detailed lifecycle events and emit lightweight state-change events that make indexing and UI updates cheaper.

The current worktree already shows the likely intended end state:

- an overloaded lightweight `BondCreated(...)` next to the existing detailed `BondCreated(...)` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L73)
- new `BondChallenged`, `BondConceded`, and `BondResolved` declarations in the same event block at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L101)
- matching emit sites in `createBond`, `challenge`, `concede`, `ruleForChallenger`, and `ruleForPoster` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L241)
- focused test assertions in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L15)

That means the main implementation surface is contract plus tests, with one compatibility watchpoint around the overloaded `BondCreated` event.

## Current State

`SimpleBondV4` already emits detailed events for all relevant lifecycle steps:

- bond creation via detailed `BondCreated(...)` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L284)
- challenge submission via `Challenged(...)` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L323)
- poster concession via `ClaimConceded(...)` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L359)
- judge rulings via `RuledForChallenger(...)` and `RuledForPoster(...)` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L399) and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L436)

The lightweight event layer is additive on top of that:

- `createBond(...)` emits both the detailed and lightweight `BondCreated` variants at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L284)
- `challenge(...)` emits `BondChallenged` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L324)
- `concede(...)` emits `BondConceded` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L360)
- `ruleForChallenger(...)` and `ruleForPoster(...)` emit `BondResolved` with `uint8` verdict constants at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L400) and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L437)

The test suite already reflects the expected verification pattern:

- it disambiguates the overloaded `BondCreated` event by full signature constants at [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L15)
- it asserts both creation events at [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L567)
- it asserts the new challenge and concession events at [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L667) and [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L745)
- it asserts `BondResolved` for both ruling branches at [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L970) and [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L1034)

## Key Interpretation

The safest interpretation of "add event emissions" is:

1. keep the existing detailed events for backward compatibility and richer off-chain consumers
2. add lightweight events only where they describe the same transition in a simpler shape
3. avoid changing payout logic, state transitions, or revert behavior

For `BondResolved`, the current branch uses `uint8` verdict constants:

- `1` = poster won
- `2` = challenger won

That is a better fit than `bool` because it is explicit, already encoded in the contract constants, and easy to extend later.

## Main Risk: Overloaded `BondCreated`

The only meaningful design risk is the overloaded `BondCreated` event.

Tests already handle that correctly by referring to explicit signatures in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L15). The frontend and backend do not.

- [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz/backend/config.mjs#L57) includes only the detailed `BondCreated` ABI entry
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz/frontend/index.html#L1007) also includes only the detailed `BondCreated` ABI entry
- the frontend calls `readContract.filters.BondCreated(...)` in several places, including [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz/frontend/index.html#L2880), [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz/frontend/index.html#L3179), and [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz/frontend/index.html#L3782)

If those hand-written ABIs stay as detailed-only, existing consumers continue to resolve the verbose event by name and remain non-ambiguous. If those ABIs are expanded to include the lightweight overload, name-based lookups like `filters.BondCreated(...)` become ambiguous in `ethers` and must be rewritten to use explicit signatures.

So the default implementation should treat frontend/backend ABI edits as conditional, not automatic.

## Recommended Plan

1. Update or confirm the event declarations in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L73).
2. Update or confirm the emit sites in:
   - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L241)
   - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L305)
   - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L341)
   - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L374)
   - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L414)
3. Extend or confirm the existing contract tests in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L566), [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L662), [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L740), [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L928), and [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L986).
4. Only touch the frontend/backend ABI definitions if those consumers need to observe the new lightweight events directly. If that happens, move them to signature-specific event access instead of name-only `BondCreated` lookups.

## Verification Plan

1. Run `npx hardhat test test/SimpleBondV4.test.js`.
2. Confirm creation emits both `BondCreated` signatures and the test disambiguates them by full signature.
3. Confirm `challenge`, `concede`, `ruleForPoster`, and `ruleForChallenger` emit the new lightweight events with the exact expected arguments.
4. If frontend/backend ABI files are touched, smoke-test the `BondCreated` filters in:
   - [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz/frontend/index.html#L2880)
   - [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz/frontend/index.html#L3179)
   - [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz/frontend/index.html#L3782)
   - [`backend/watcher.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz/backend/watcher.mjs#L141)

## Expected Change Surface

Likely required:

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-omz/contracts/SimpleBondV4.sol#L73)
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz/test/SimpleBondV4.test.js#L15)

Conditionally required:

- [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz/backend/config.mjs#L57)
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz/frontend/index.html#L1007)
