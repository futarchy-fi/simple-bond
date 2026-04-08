# sh-008 Analysis: add common Hardhat npm scripts to `package.json`

## Summary

This is a small `package.json` task.

The repository already exposes two of the three requested script names:

- [`compile`](/tmp/temporal-worktrees/task-sh-008/package.json#L7) currently runs `hardhat compile`
- [`test`](/tmp/temporal-worktrees/task-sh-008/package.json#L8) currently runs `hardhat test`

The missing script is:

- `clean`

The only meaningful ambiguity is whether the task cares about exact command strings like `npx hardhat compile`, or only about the presence of the script names. In npm scripts, `hardhat ...` already resolves the local binary from `node_modules/.bin`, so the existing `compile` and `test` entries are functionally equivalent to the requested `npx hardhat ...` forms.

## Current State

- [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json#L6) has a root `scripts` block.
- [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json#L7) defines `"compile": "hardhat compile"`.
- [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json#L8) defines `"test": "hardhat test"`.
- [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json#L9) through [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json#L11) define notification scripts unrelated to this task.
- [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json#L34) includes `hardhat` as a local dev dependency, so npm script resolution for `hardhat` is expected to work.
- [`README.md`](/tmp/temporal-worktrees/task-sh-008/README.md#L116) documents `npx hardhat compile` in deploy instructions, which suggests `npx` is the style already shown to contributors even though `package.json` uses bare `hardhat`.

## Key Interpretation

The safest interpretation of the task wording is:

1. Ensure the script names `compile`, `test`, and `clean` exist in the root manifest.
2. Treat the existing `compile` and `test` scripts as already present.
3. Add only the missing `clean` script unless the reviewer explicitly requires command normalization.

That recommendation follows from the phrase "if not already present." The names `compile` and `test` are already present, and changing their command bodies would be a normalization decision, not a presence fix.

## Recommended Approach

Implement the task as a manifest-only edit in [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json):

1. Add `"clean": "npx hardhat clean"` to the `scripts` object.
2. Leave the existing `compile` and `test` entries unchanged by default.
3. Preserve existing script ordering and unrelated notification scripts.

If strict consistency with the task text is preferred, an acceptable alternative would be:

1. Change `compile` to `npx hardhat compile`
2. Change `test` to `npx hardhat test`
3. Add `clean` as `npx hardhat clean`

That broader edit is probably unnecessary, but it would be low risk.

## Scope

Expected implementation surface:

- [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json)

No dependency or lockfile changes should be required, because this task only adjusts npm script metadata.

## Verification

After the implementation, verify:

1. [`package.json`](/tmp/temporal-worktrees/task-sh-008/package.json) contains `compile`, `test`, and `clean` under `scripts`.
2. `npm run clean` resolves and invokes Hardhat successfully.
3. Optional sanity checks: `npm run compile` and `npm test` still resolve the local Hardhat binary as expected.

## Risk Notes

- The main review question is semantic, not technical: whether "already present" refers to script names only or to exact command text.
- Keeping `compile` and `test` as bare `hardhat ...` is normally fine inside npm scripts, but it leaves a small style mismatch with [`README.md`](/tmp/temporal-worktrees/task-sh-008/README.md#L116), which uses `npx hardhat ...`.
- Adding `clean` only is the narrowest change and least likely to create unnecessary diff noise.
