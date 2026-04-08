# temporal-fleet-omz-r1-verify-simplebondv4-event-task Analysis

## Summary

This is a verification task, not a feature task. On `main...HEAD`, the only product-code files that changed in this branch are [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L1008) and [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/test/SimpleBondV4.test.js#L1); the backend ABI consumer files were not modified.

The work should therefore focus on two things:

- run the targeted Hardhat verification for [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/test/SimpleBondV4.test.js#L1)
- because the frontend ABI consumer changed, perform a small event-parsing smoke check that confirms the intended detailed `BondCreated` signature is still the one resolved by both frontend and backend consumer logic, without overload ambiguity

One immediate execution prerequisite is missing in this worktree: `node_modules/` is absent, so the verification task will need dependency installation before Hardhat tests can run.

## Current State

The relevant SimpleBondV4 test coverage is already present in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/test/SimpleBondV4.test.js#L15):

- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/test/SimpleBondV4.test.js#L15) defines full-signature constants for both overloaded `BondCreated` events, which is the correct way to avoid ambiguous Hardhat event assertions
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/test/SimpleBondV4.test.js#L567) asserts both `BondCreated` emissions on successful `createBond()`
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/test/SimpleBondV4.test.js#L1173) and [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/test/SimpleBondV4.test.js#L1180) now also assert `BondWithdrawn`, so the targeted suite verifies both behavior and the newer event surface

The frontend consumer changed specifically to pin create-log handling to the detailed signature:

- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L1023) defines `DETAILED_BOND_CREATED_SIGNATURE` and `DETAILED_BOND_CREATED_TOPIC`
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L2272) uses `parseDetailedBondCreatedLog()` when extracting the created bond ID from a receipt
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L3022) rejects any log whose first topic is not the detailed `BondCreated` topic hash
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L3031) queries creation history with raw topic filters keyed to the detailed signature, preserving poster and judge topic positions
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L3215) and [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L3817) now reuse those helpers instead of `filters.BondCreated(...)`

The backend consumer remains on the detailed event only:

- [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/backend/config.mjs#L57) declares only the detailed `BondCreated` ABI fragment
- [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/backend/config.mjs#L73) routes notifications by bare event name `BondCreated`
- [`backend/watcher.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/backend/watcher.mjs#L51) parses logs via a shared `ethers.Interface`
- [`backend/watcher.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/backend/watcher.mjs#L61) dispatches entirely on `parsed.name`

Because the backend ABI has not been expanded to include the lightweight overload, backend parsing is still unambiguous today.

## Key Constraints

- Overloaded `BondCreated` cannot be treated safely as a bare-name event wherever both signatures are in scope; the test file already avoids that correctly by using full event signatures.
- The frontend's judge-specific discovery depends on the detailed create event keeping `judge` as the third indexed topic; the lightweight overload cannot replace that query path.
- The backend watcher would only become ambiguous if its ABI were widened to include both `BondCreated` overloads while continuing to dispatch solely on `parsed.name`.
- For any ad hoc verification script, avoid importing [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/backend/config.mjs#L1) directly, because that module performs startup-side environment loading; a smoke check should instead use copied ABI fragments or parse source text.

## Planned Approach

1. Install dependencies with `npm ci` if `node_modules/` is still missing.
2. Run the targeted suite with `npx hardhat test test/SimpleBondV4.test.js`.
3. Run a small smoke-check script that uses `ethers.Interface` with explicit event fragments to synthesize and parse both `BondCreated` overloads.
4. In that smoke check, confirm the frontend path only accepts the detailed log by topic hash and that poster/judge topic filtering still aligns with the detailed signature layout used by [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L3031).
5. In the same smoke check, confirm the backend ABI surface still parses the detailed `BondCreated` log and ignores the lightweight overload, which keeps [`backend/watcher.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/backend/watcher.mjs#L61) unambiguous.
6. If either check fails, inspect only the affected consumer path and make the smallest compatibility fix before rerunning the test file and smoke check.

## Verification Plan

Primary verification command:

```bash
npx hardhat test test/SimpleBondV4.test.js
```

Expected smoke-check outcomes:

1. The targeted Hardhat suite passes, including the dual-`BondCreated` assertion path and the `BondWithdrawn` assertions.
2. A detailed `BondCreated` log resolves to the expected `bondId`, `poster`, and `judge` when parsed through the frontend's detailed-topic path.
3. A lightweight `BondCreated` log is rejected by the frontend's detailed-topic gate.
4. The backend ABI surface recognizes only the detailed `BondCreated` log, so `parsed.name === "BondCreated"` still corresponds to the intended legacy/detailed event and not an ambiguous overload.

## Bottom Line

This should be a focused verification pass. The branch already contains the important compatibility fix in [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-omz-r1-verify-simplebondv4-event-task/frontend/index.html#L1023), and the backend remains safe because it still exposes only the detailed create event. The main practical blocker is simply that dependencies are not installed in the current worktree yet.
