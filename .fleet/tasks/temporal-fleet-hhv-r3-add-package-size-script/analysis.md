# temporal-fleet-hhv-r3 Analysis: expose contract size report through package.json

## Summary

This task is the package-script exposure step for the contract size report. On the current branch, that end state already exists: [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/package.json#L6) already defines `"size": "hardhat size-contracts"`, and [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/hardhat.config.js#L10) already registers the backing `size-contracts` task.

Because the required npm entrypoint is already present, the practical plan for this ticket is to confirm the existing script shape, avoid unnecessary edits, and leave runtime validation to the downstream verification task.

## Current State

- [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/package.json#L6) exposes the standard script surface:
  - `clean`
  - `compile`
  - `size`
  - `test`
- The exact script required by this task is already present at [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/package.json#L9):
  - `"size": "hardhat size-contracts"`
- [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/hardhat.config.js#L10) already defines `task("size-contracts", ...)`, so the npm script points at a real command surface rather than a missing task.
- The parent fleet decomposition in [`.fleet/tasks/temporal-fleet-hhv/decomposition.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/.fleet/tasks/temporal-fleet-hhv/decomposition.json#L17) models this as a follow-on to `add-hardhat-contract-size-task`, which matches the current repository state.

## Implications

The repository already satisfies the task description as written. There is no additional package-level plumbing to add unless the existing `size` script were removed or renamed.

That means this ticket should remain tightly scoped:

- `package.json` is the only file that would need editing if the script were missing.
- No dependency, lockfile, contract, backend, or frontend changes are required for this task.
- The only remaining meaningful work after confirming the script exists is command verification, which belongs to the separate `verify-contract-size-report-command` task.

## Plan

1. Confirm that `package.json` exposes a standard npm script named `size`.
2. Confirm that the script invokes `hardhat size-contracts` and therefore matches the task requirement directly.
3. Confirm that the backing Hardhat task exists so the package script is not a dead entry.
4. If any of the above were missing, add or correct the `size` entry in `package.json` only.
5. Otherwise, treat this task as already complete and avoid no-op code churn.

## Verification Notes

I verified the static wiring only:

- the `size` script exists in [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/package.json#L9)
- the `size-contracts` Hardhat task exists in [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/hardhat.config.js#L10)

I did not run `npm run size` in this analysis task. Runtime validation is more appropriately handled by the downstream verification task in the fleet DAG.

## Risk Notes

- The main risk here is unnecessary churn: changing `package.json` despite the script already existing would create a no-op diff for a task that is already satisfied.
- If a future refactor renames or removes `size-contracts` without updating [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-hhv-r3-add-package-size-script/package.json#L9), the package script would silently become stale.
