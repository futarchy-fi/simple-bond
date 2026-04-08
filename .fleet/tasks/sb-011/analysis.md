# sb-011 Analysis: add appeal support stubs to `KlerosJudge`

## Summary

This is a narrow contract-and-test task, not a full appeal implementation.

The audit note in `/home/kelvin/shared/docs/simple-bond-pro-audit.txt` flags that [`KlerosJudge`](/tmp/temporal-worktrees/task-sb-011/contracts/KlerosJudge.sol#L89) exposes dispute creation and execution, but no appeal-facing API. The requested fix is to make that limitation explicit by adding appeal stub functions that always revert with the exact string `Appeals not yet supported`, plus NatSpec explaining that the stubs exist for interface clarity and as a future extension point.

## Current State

- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-sb-011/contracts/KlerosJudge.sol#L89) currently exposes `requestArbitration`, `rule`, `executeRuling`, `submitEvidence`, owner functions, and `getArbitrationCost`, but no `appeal`, `appealCost`, or `appealPeriod`.
- [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-sb-011/test/KlerosJudge.test.js#L90) has a strict ABI-surface assertion that enumerates every public and external function. Any new stub functions must be added there or the suite will fail.
- The existing test file has no coverage for appeal-related revert behavior.
- The rest of the adapter logic does not need to change for this task. No appeal flow, dispute storage, or mock-arbitrator behavior needs to be implemented.

## Recommended Approach

1. Update [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-sb-011/contracts/KlerosJudge.sol) to add three external appeal stub functions that revert with `revert("Appeals not yet supported");`.
2. Add NatSpec above those functions explaining:
   - Kleros and ERC-792 define an appeal lifecycle.
   - `KlerosJudge` does not currently support safely propagating appeals through the current `SimpleBondV4` timing model.
   - These stubs make the unsupported status explicit in the ABI instead of silently omitting the interface.
   - The functions are reserved as a future extension point for real appeal support.
3. Keep the revert mechanism as a string revert, not a custom error, because the task explicitly requires a clear message and the tests should assert the exact string.
4. Update [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-sb-011/test/KlerosJudge.test.js) in two places:
   - extend the ABI-surface expectation with the new function signatures
   - add dedicated tests asserting that `appeal`, `appealCost`, and `appealPeriod` each revert with `Appeals not yet supported`
5. Run the targeted Hardhat suite for [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-sb-011/test/KlerosJudge.test.js) after the implementation lands.

## Signature Choice

There is one small ABI decision to make before implementation:

1. Literal task interpretation:
   `appeal()`, `appealCost()`, and `appealPeriod()` are zero-argument placeholder functions because the ticket spells them that way.
2. ERC-792 / Kleros-shaped placeholder:
   `appeal(uint256,bytes) payable`, `appealCost(uint256,bytes)`, and `appealPeriod(uint256)` mirror the standard arbitrator appeal surface and give a cleaner future extension point.

My recommendation is to mirror the ERC-792/Kleros signatures, because the audit finding is about missing appeal-path interface clarity, not just missing names. The official Kleros arbitrator interface defines `appeal`, `appealCost`, and `appealPeriod` with dispute-oriented parameters. However, if this task is being interpreted strictly from the ticket text, zero-argument stubs are the smallest possible change. Either choice is localized, but the ABI test must match whichever version is selected.

## Files Expected To Change

- [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-sb-011/contracts/KlerosJudge.sol)
- [`test/KlerosJudge.test.js`](/tmp/temporal-worktrees/task-sb-011/test/KlerosJudge.test.js)

No changes should be necessary in:

- [`contracts/MockArbitrator.sol`](/tmp/temporal-worktrees/task-sb-011/contracts/MockArbitrator.sol)
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-sb-011/contracts/SimpleBondV4.sol)

## Verification Plan

1. Compile the contracts.
2. Run `npx hardhat test test/KlerosJudge.test.js`.
3. Confirm the ABI-surface test includes the new appeal stubs.
4. Confirm each new appeal-related test fails with the exact revert string `Appeals not yet supported`.
