# temporal-fleet-hhv Analysis: add contract size report script

## Summary

This is a narrow Hardhat tooling task. The intended user-facing entry point is a package script such as `npm run size`, backed by a Hardhat task that compiles the contracts and reports deployed runtime bytecode size against the 24 KB EIP-170 limit.

The current branch already reflects that end state in [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/package.json#L1) and [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/hardhat.config.js#L1), so this analysis documents the relevant implementation surface and the minimal DAG needed to deliver the feature cleanly.

## Current State

- [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/package.json#L1) already exposes `"size": "hardhat size-contracts"` alongside the existing Hardhat `clean`, `compile`, and `test` scripts.
- [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/hardhat.config.js#L1) already imports `task` from `hardhat/config`, defines `EIP170_LIMIT_BYTES = 24_576`, and registers a `size-contracts` task.
- The task currently:
  - runs `await hre.run("compile")`
  - enumerates artifacts with `hre.artifacts.getAllFullyQualifiedNames()`
  - reads each artifact with `hre.artifacts.readArtifact(...)`
  - filters to sources under `contracts/`
  - skips artifacts with empty `deployedBytecode`
  - computes byte size from deployed runtime bytecode
  - prints a size table sorted from largest to smallest
- The Solidity contract surface under [`contracts/`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts) includes concrete contracts such as:
  - [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts/KlerosJudge.sol#L1)
  - [`contracts/MockArbitrator.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts/MockArbitrator.sol#L1)
  - [`contracts/SimpleBond.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts/SimpleBond.sol#L1)
  - [`contracts/SimpleBondV3.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts/SimpleBondV3.sol#L1)
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts/SimpleBondV4.sol#L1)
  - [`contracts/TestToken.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts/TestToken.sol#L1)
- The repo also contains interface-only Solidity files such as [`contracts/interfaces/IArbitrator.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts/interfaces/IArbitrator.sol#L1), which should not appear in the size report because they have no deployed runtime bytecode.
- [`.gitignore`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/.gitignore#L1) ignores both `node_modules/` and `artifacts/`, and both directories are absent in this worktree. Any reliable contract-size command therefore needs to compile as part of the reporting flow instead of assuming prebuilt artifacts exist.
- [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/README.md#L1) does not currently mention the size command. Documentation is optional for the narrow ticket described here.

## Key Requirements

The critical correctness detail is that EIP-170 applies to deployed runtime bytecode, not constructor bytecode. The report therefore needs to measure `deployedBytecode`, not `bytecode`.

Two repository-specific filtering rules also matter:

1. Report only project contracts under `contracts/`, not imported dependency artifacts.
2. Skip artifacts whose `deployedBytecode` is empty (`0x`), which naturally excludes interfaces and abstract-only outputs.

## Recommended Implementation Shape

If this task were being implemented from scratch, the smallest clean delivery would be:

1. Register `size-contracts` in [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/hardhat.config.js#L1).
2. Make the task compile before reading artifacts, because `artifacts/` is gitignored and absent by default.
3. Measure `artifact.deployedBytecode` and compare sizes against `24,576` bytes.
4. Sort output by size descending and print contract name, byte count, limit usage, and a lightweight status marker.
5. Expose the task through [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/package.json#L1) as `npm run size`.

That structure is already present on the current branch and matches the ticket intent well. No new dependency should be required.

## Expected Scope

The minimal implementation scope for this feature is:

- update [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/hardhat.config.js#L1)
- update [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/package.json#L1)

This task should not require contract, backend, frontend, or lockfile changes.

## Verification Plan

Because `node_modules/` is absent in this worktree, verification requires dependency installation first.

After implementation, verify with:

1. `npm install`
2. `npm run size`
3. Confirm the task compiles successfully and reports the concrete repo contracts under [`contracts/`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts).
4. Confirm interface-only outputs such as [`contracts/interfaces/IArbitrator.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv/contracts/interfaces/IArbitrator.sol#L1) are omitted.
5. Confirm the reported sizes are based on deployed runtime bytecode and compared to the 24,576-byte EIP-170 limit.

## Risk Notes

- Measuring `bytecode` instead of `deployedBytecode` would report constructor/init code rather than the EIP-170-relevant deployed size.
- Enumerating every artifact without filtering would produce noisy output from dependencies and interface artifacts.
- A report command that assumes `artifacts/` already exists would be fragile in this repository because build output is ignored and absent in a fresh checkout.
