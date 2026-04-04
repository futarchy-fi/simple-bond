# temporal-fleet-hhv-r4 Analysis: verify contract size report command

## Summary

This is a runtime-verification task for an existing command surface, not a new implementation task. The repository already exposes [`npm run size`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/package.json#L6) through [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/package.json#L1), and the backing Hardhat task in [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L10) already compiles the project, filters to `contracts/`, skips empty `deployedBytecode`, and reports deployed runtime size against the 24,576-byte EIP-170 limit.

I verified the runtime path in this worktree from a fresh dependency state. After `npm install`, `npm run size` exited successfully, compiled 17 Solidity files, and printed a size table for the six concrete contracts currently produced under [`contracts/`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/contracts).

## Current State

- [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/package.json#L6) exposes `"size": "hardhat size-contracts"` at [`package.json:9`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/package.json#L9).
- [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L10) already implements the verification-relevant behavior:
  - compiles first via `await hre.run("compile")` at [`hardhat.config.js:12`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L12)
  - restricts the report to sources under `contracts/` at [`hardhat.config.js:20`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L20)
  - measures `artifact.deployedBytecode` at [`hardhat.config.js:24-31`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L24)
  - skips artifacts whose runtime bytecode is empty (`0x`) at [`hardhat.config.js:26`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L26)
  - prints a deployed-runtime report header at [`hardhat.config.js:58`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L58)
- The Solidity surface currently contains six deployable project contracts that should appear in the report:
  - `SimpleBondV4`
  - `SimpleBondV3`
  - `KlerosJudge`
  - `SimpleBond`
  - `TestToken`
  - `MockArbitrator`
- The repo also contains interface-only outputs that should not appear in the report:
  - [`contracts/interfaces/IArbitrator.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/contracts/interfaces/IArbitrator.sol#L9) defines `IArbitrator`, `IArbitrable`, and `IEvidence`
  - [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/contracts/KlerosJudge.sol#L12) defines `ISimpleBondV4`
- A fresh `npm run size` in this worktree produced:
  - `SimpleBondV4  10531`
  - `SimpleBondV3   7782`
  - `KlerosJudge    7325`
  - `SimpleBond     5859`
  - `TestToken      1926`
  - `MockArbitrator 1331`
- The compile step emitted only non-fatal Solidity warnings about mutability in [`contracts/KlerosJudge.sol:361`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/contracts/KlerosJudge.sol#L361) and [`contracts/KlerosJudge.sol:380`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/contracts/KlerosJudge.sol#L380); the command still exited successfully.

## Verification Evidence

The task description asks for four confirmations. The current branch already satisfies all four when exercised directly:

1. Compilation succeeds from the command path.
   - `node_modules/` was absent before verification, so this was a clean dependency-install case.
   - `npm run size` compiled successfully before printing the report.
2. Concrete contracts are listed.
   - The six deployable contracts under `contracts/` all appeared in the output.
3. Interface-only artifacts are skipped.
   - Hardhat generated interface artifacts for `IArbitrator`, `IArbitrable`, `IEvidence`, and `ISimpleBondV4`, but those artifacts have `deployedBytecode === "0x"` and did not appear in the report.
4. The metric uses deployed runtime bytecode.
   - Static evidence: [`hardhat.config.js:24-31`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L24) computes size from `artifact.deployedBytecode`, not `artifact.bytecode`.
   - Runtime spot-checks after compilation matched the report against deployed runtime sizes rather than creation bytecode:
     - `KlerosJudge`: creation `8616`, runtime `7325`, reported `7325`
     - `TestToken`: creation `2407`, runtime `1926`, reported `1926`
     - `SimpleBondV4`: creation `10563`, runtime `10531`, reported `10531`

## Plan

The smallest correct delivery for the downstream task is:

1. Install dependencies with `npm install` in a clean worktree.
2. Run `npm run size`.
3. Confirm the command exits `0` and prints the compile-success banner before the size table.
4. Confirm the output rows are the six concrete deployable contracts currently present under [`contracts/`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/contracts).
5. Confirm interface-only names are absent from the output even though their artifacts are generated.
6. Spot-check at least one or two artifacts against `deployedBytecode` length to prove the metric is runtime size, not creation size.
7. Only modify [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/hardhat.config.js#L1) if one of those checks fails.

## Risk Notes

- This verification task may legitimately require no source edit beyond recording the verification outcome, because the command is already implemented and currently passes.
- `npm install` under the local npm version reorders a small section of [`package-lock.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r4-verify-contract-size-report-command/package-lock.json#L1); that change is incidental to verification and should not be committed as part of this task.
- The current report includes legacy and test deployable contracts (`SimpleBond`, `SimpleBondV3`, `TestToken`, `MockArbitrator`) because the filter is "deployable artifact under `contracts/`", not "production-only contract". That matches the current task description, which asks for concrete contracts to be listed and interface-only artifacts to be skipped.
