# tw-auto-001 Analysis: add a root `Makefile` with common targets

## Summary

This is a small repository-root build tooling task.

The requested change is to add a new root `Makefile` that exposes four common developer targets:

- `compile` -> `npx hardhat compile`
- `test` -> `npx hardhat test`
- `clean` -> `npx hardhat clean`
- `lint` -> `solhint contracts/*.sol` when `solhint` is available

The implementation should be low risk because it adds a new top-level convenience file and does not need to change contract code, backend code, or dependency metadata.

## Current State

- No repository-root `Makefile` is currently present.
- [`package.json`](/tmp/temporal-worktrees/task-tw-auto-001/package.json#L6) through [`package.json`](/tmp/temporal-worktrees/task-tw-auto-001/package.json#L12) already define npm scripts for `clean`, `compile`, and `test`.
- [`package.json`](/tmp/temporal-worktrees/task-tw-auto-001/package.json#L26) through [`package.json`](/tmp/temporal-worktrees/task-tw-auto-001/package.json#L35) include `hardhat` but do not include `solhint`.
- [`CONTRIBUTING.md`](/tmp/temporal-worktrees/task-tw-auto-001/CONTRIBUTING.md#L12) through [`CONTRIBUTING.md`](/tmp/temporal-worktrees/task-tw-auto-001/CONTRIBUTING.md#L15) already document `npx hardhat compile` and `npx hardhat test` as the standard verification commands.
- [`README.md`](/tmp/temporal-worktrees/task-tw-auto-001/README.md#L114) through [`README.md`](/tmp/temporal-worktrees/task-tw-auto-001/README.md#L117) also use `npx hardhat compile` in the deploy flow.
- `node_modules/` is not currently present in this worktree, so command execution depends on installing dependencies first.

## Key Interpretation

The important ambiguity is the `lint` target.

The task says `solhint contracts/*.sol if available`, and the current manifest does not declare `solhint`. The safest interpretation is:

1. A `lint` target should still exist in the `Makefile`.
2. It should run `solhint contracts/*.sol` only when a local or global `solhint` binary is already available.
3. It should skip cleanly with an explanatory message when `solhint` is not installed.
4. It should not add `solhint` to [`package.json`](/tmp/temporal-worktrees/task-tw-auto-001/package.json#L1) or attempt an implicit network install.

That interpretation keeps the patch aligned with the task text while avoiding surprise dependency changes.

## Recommended Approach

Add a new repository-root `Makefile` with:

1. A `.PHONY` declaration covering `compile`, `test`, `clean`, and `lint`.
2. Direct command recipes using the exact task wording for:
   - `compile: npx hardhat compile`
   - `test: npx hardhat test`
   - `clean: npx hardhat clean`
3. A `lint` recipe that:
   - runs `solhint contracts/*.sol` when `solhint` is already available
   - otherwise prints a short skip message and exits successfully

For the `lint` implementation, prefer checking for an existing binary rather than using plain `npx solhint ...`, because plain `npx` may try to fetch an unpinned package when `solhint` is absent. A guarded local/global binary check is the narrowest implementation.

## Scope

Expected implementation surface:

- add [`Makefile`](/tmp/temporal-worktrees/task-tw-auto-001/Makefile)

No changes should be necessary in:

- [`package.json`](/tmp/temporal-worktrees/task-tw-auto-001/package.json#L1)
- [`package-lock.json`](/tmp/temporal-worktrees/task-tw-auto-001/package-lock.json#L1)
- Solidity contracts
- tests
- documentation

## Verification

After implementation, verify:

1. [`Makefile`](/tmp/temporal-worktrees/task-tw-auto-001/Makefile) exists at the repository root.
2. It declares `.PHONY` for `compile`, `test`, `clean`, and `lint`.
3. `make compile` expands to `npx hardhat compile`.
4. `make test` expands to `npx hardhat test`.
5. `make clean` expands to `npx hardhat clean`.
6. `make lint` runs `solhint contracts/*.sol` when `solhint` is installed, or skips successfully when it is not.

Because `node_modules/` is absent in the current worktree, executing the Hardhat targets will require `npm install` first. For this task, file-level verification may be sufficient unless the implementation step also installs dependencies.

## Risk Notes

- The main review risk is the behavior of `make lint` when `solhint` is missing. Failing hard would conflict with the `if available` wording.
- Using plain `npx solhint ...` without a guard could trigger an unexpected package download, which would broaden the task beyond adding a `Makefile`.
- Adding a `Makefile` target set that duplicates existing npm scripts is low risk, but the direct recipes should stay aligned with the contributor docs, which already prefer `npx hardhat ...`.
