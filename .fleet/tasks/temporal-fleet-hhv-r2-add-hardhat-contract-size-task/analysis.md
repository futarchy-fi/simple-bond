# temporal-fleet-hhv-r2 Analysis: add Hardhat contract size task

## Summary

This is a narrow Hardhat tooling task. The intended behavior is a `size-contracts` Hardhat task registered in [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/hardhat.config.js#L1) that compiles the project, reads deployed runtime bytecode from artifacts, filters to concrete project contracts, computes EIP-170 usage against the 24,576-byte limit, and prints a descending size report.

The current branch already reflects that implementation shape, so this analysis focuses on the exact surface area, the constraints that matter for correctness, and the minimal verification needed to treat the task as done.

## Current State

- [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/hardhat.config.js#L1) already imports `task` from `hardhat/config`, defines `EIP170_LIMIT_BYTES = 24_576`, and registers `task("size-contracts", ...)`.
- The task currently:
  - runs `await hre.run("compile")` before reading artifacts
  - enumerates fully qualified artifact names with `hre.artifacts.getAllFullyQualifiedNames()`
  - reads each artifact through `hre.artifacts.readArtifact(...)`
  - filters to sources whose `sourceName` starts with `contracts/`
  - skips entries whose `deployedBytecode` is empty (`0x`)
  - computes byte size from deployed runtime bytecode
  - computes percentage usage of the EIP-170 limit
  - sorts rows by descending size, then contract name
  - prints a table with contract name, size, percent of limit, and status
- [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/package.json#L1) already exposes `"size": "hardhat size-contracts"`, so the report is reachable through the repo's normal script interface.
- The Solidity project surface under [`contracts/`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts) contains concrete contracts that should appear in the report:
  - [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts/KlerosJudge.sol#L1)
  - [`contracts/MockArbitrator.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts/MockArbitrator.sol#L1)
  - [`contracts/SimpleBond.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts/SimpleBond.sol#L1)
  - [`contracts/SimpleBondV3.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts/SimpleBondV3.sol#L1)
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts/SimpleBondV4.sol#L1)
  - [`contracts/TestToken.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts/TestToken.sol#L1)
- The repo also includes interface-only Solidity sources such as [`contracts/interfaces/IArbitrator.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts/interfaces/IArbitrator.sol#L1), which should not appear in the output because they do not produce deployed runtime bytecode.
- [`.gitignore`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/.gitignore#L1) ignores both `node_modules/` and `artifacts/`, and neither directory exists in this worktree right now. That makes the in-task compile step a correctness requirement, not just a convenience.

## Key Requirements

The main correctness detail is the EIP-170 comparison target: the limit applies to deployed runtime bytecode, not constructor bytecode. The task therefore must read `deployedBytecode`, not `bytecode`.

Two repo-specific filtering rules matter as well:

1. Only report project contracts under `contracts/`, not imported dependency artifacts.
2. Skip artifacts with empty deployed bytecode, which naturally excludes interfaces and abstract-only outputs.

## Implementation Plan

The clean implementation plan for this task is:

1. Register `size-contracts` directly in [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/hardhat.config.js#L1), because this repo does not have a separate custom-tasks module layout.
2. Run `compile` inside the task before inspecting artifacts, because `artifacts/` is gitignored and absent in fresh checkouts.
3. Enumerate artifact names through Hardhat's artifact API instead of manually scraping `artifacts/` or `build-info`.
4. Read `sourceName`, `contractName`, and `deployedBytecode` from each artifact and filter to concrete project contracts.
5. Compute `sizeBytes` from the hex string length and compute percentage usage against `24_576`.
6. Sort by largest deployed size first and print a lightweight report that makes near-limit contracts obvious.
7. Expose the task through [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/package.json#L1) as `npm run size`.

That shape is already present on the current branch and matches the task description directly.

## Scope

The minimal file surface for this task is:

- [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/hardhat.config.js#L1)
- [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/package.json#L1)

No contract, backend, frontend, dependency, or lockfile changes should be necessary.

## Verification Plan

The current worktree does not have `node_modules/` or `artifacts/`, so runtime verification has not been performed here.

To verify the implementation:

1. Install dependencies with `npm install`.
2. Run `npm run size`.
3. Confirm the task compiles before reporting sizes.
4. Confirm the output includes the concrete contracts under [`contracts/`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts).
5. Confirm interface-only outputs such as [`contracts/interfaces/IArbitrator.sol`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r2-add-hardhat-contract-size-task/contracts/interfaces/IArbitrator.sol#L1) are omitted.
6. Confirm the report uses deployed runtime bytecode and compares against the 24,576-byte EIP-170 limit.
7. Confirm rows are sorted from largest to smallest contract.

## Risk Notes

- Measuring `bytecode` instead of `deployedBytecode` would report constructor/init size rather than the EIP-170-relevant deployed size.
- Enumerating every artifact without the `contracts/` filter would pollute the report with dependency artifacts.
- Assuming preexisting artifacts would make the task fragile in this repository, since build outputs are ignored and absent in a fresh checkout.
