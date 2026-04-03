# sb-012 Analysis: add a Hardhat task to report contract sizes

## Summary

This is a narrow Hardhat tooling task. The cleanest implementation is a custom task in [`hardhat.config.js`](/tmp/temporal-worktrees/task-sb-012/hardhat.config.js#L1) that compiles the project, reads Hardhat artifact JSONs, and prints the deployed runtime byte size for each concrete project contract against the 24 KB EIP-170 limit.

No new dependency should be required. Hardhat already produces the artifact data needed for this report.

## Current State

- [`hardhat.config.js`](/tmp/temporal-worktrees/task-sb-012/hardhat.config.js#L1) currently loads plugins and exports network/solidity settings, but it does not register any custom Hardhat tasks.
- [`package.json`](/tmp/temporal-worktrees/task-sb-012/package.json#L6) currently exposes `clean`, `compile`, and `test`, but there is no contract-size command.
- The repository's Solidity sources currently include these project contracts:
  - [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-sb-012/contracts/KlerosJudge.sol#L1)
  - [`contracts/MockArbitrator.sol`](/tmp/temporal-worktrees/task-sb-012/contracts/MockArbitrator.sol#L1)
  - [`contracts/SimpleBond.sol`](/tmp/temporal-worktrees/task-sb-012/contracts/SimpleBond.sol#L1)
  - [`contracts/SimpleBondV3.sol`](/tmp/temporal-worktrees/task-sb-012/contracts/SimpleBondV3.sol#L1)
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-sb-012/contracts/SimpleBondV4.sol#L1)
  - [`contracts/TestToken.sol`](/tmp/temporal-worktrees/task-sb-012/contracts/TestToken.sol#L1)
- The repository also includes interface-only Solidity sources such as [`contracts/interfaces/IArbitrator.sol`](/tmp/temporal-worktrees/task-sb-012/contracts/interfaces/IArbitrator.sol#L1), which should not be treated as meaningful EIP-170 size candidates.
- [`.gitignore`](/tmp/temporal-worktrees/task-sb-012/.gitignore#L1) ignores both `node_modules/` and `artifacts/`, and this worktree currently has neither directory present. That means any size-report task should either run compilation itself or fail with a very clear message.

## Key Interpretation

The important requirement detail is the reference to the 24 KB EIP-170 limit.

That limit applies to deployed runtime bytecode, not constructor/init bytecode. The task should therefore measure `deployedBytecode` from each artifact, not `bytecode`.

Two practical filtering rules also follow from the current repo layout:

1. Only report project contracts under `contracts/`, not imported dependency artifacts such as OpenZeppelin contracts.
2. Skip artifacts whose `deployedBytecode` is empty (`0x`), which naturally excludes interfaces and abstract-only outputs.

## Recommended Approach

1. Add `const { task } = require("hardhat/config");` near the top of [`hardhat.config.js`](/tmp/temporal-worktrees/task-sb-012/hardhat.config.js#L1).
2. Register a task such as `size-contracts` directly in [`hardhat.config.js`](/tmp/temporal-worktrees/task-sb-012/hardhat.config.js#L1).
3. In the task action:
   - run `await hre.run("compile")` first, because artifacts are ignored and may not already exist
   - enumerate Hardhat artifacts using Hardhat's artifact layer rather than scraping build-info files
   - read each artifact JSON and use its `sourceName`, `contractName`, and `deployedBytecode`
4. Filter results to:
   - `sourceName` values under `contracts/`
   - non-empty `deployedBytecode`
5. Compute byte size as `(deployedBytecode.length - 2) / 2` after removing the `0x` prefix.
6. Sort the output from largest to smallest and print at least:
   - contract name
   - deployed byte size in bytes
   - percentage of the 24,576-byte EIP-170 limit
7. Optionally add a simple status marker such as `OK`, `NEAR LIMIT`, or `OVER LIMIT`, but keep the output lightweight.

## Why `hardhat.config.js`

The ticket explicitly asks for a Hardhat task, and this repository does not have an existing custom-task module layout. Adding the task inline in [`hardhat.config.js`](/tmp/temporal-worktrees/task-sb-012/hardhat.config.js#L1) is the narrowest change and keeps the invocation obvious:

```bash
npx hardhat size-contracts
```

Placing the logic in `scripts/` would work, but it is less direct unless the config still imports and registers it as a task.

## Expected Scope

Expected implementation surface:

- update [`hardhat.config.js`](/tmp/temporal-worktrees/task-sb-012/hardhat.config.js#L1)

Optional but not required:

- add a convenience script in [`package.json`](/tmp/temporal-worktrees/task-sb-012/package.json#L6), for example `"size": "hardhat size-contracts"`

This task should not require contract, test, frontend, backend, dependency, or lockfile changes.

## Verification Plan

Because `node_modules/` is currently absent in this worktree, command verification would require installing dependencies first.

After implementation, verify with:

1. `npm install`
2. `npx hardhat size-contracts`
3. Confirm the task compiles successfully and reports the concrete repo contracts:
   - `KlerosJudge`
   - `MockArbitrator`
   - `SimpleBond`
   - `SimpleBondV3`
   - `SimpleBondV4`
   - `TestToken`
4. Confirm interface-only outputs such as those from [`contracts/interfaces/IArbitrator.sol`](/tmp/temporal-worktrees/task-sb-012/contracts/interfaces/IArbitrator.sol#L1) are skipped.
5. Confirm the displayed sizes are based on deployed runtime bytecode and compared to the 24,576-byte limit.

## Risk Notes

- The main implementation risk is measuring `bytecode` instead of `deployedBytecode`, which would track constructor/init code instead of the EIP-170 limit.
- Enumerating every compiled artifact without filtering would create noisy output from imported dependencies and interface artifacts.
- Since `artifacts/` is ignored and absent by default in this checkout, a task that assumes pre-existing compilation output would be fragile.
