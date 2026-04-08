# tw-001 Analysis: add `.npmrc` with `save-exact=true`

## Summary

This is a small repository-root npm configuration task.

The requested change is to add a new root `.npmrc` file that sets `save-exact=true` so future npm dependency additions are written without semver range prefixes.

The implementation should be low risk because it changes npm's project-level save behavior for future installs and updates; it does not automatically rewrite the existing dependency declarations already committed in the repository.

## Current State

- No root `.npmrc` file is currently present in the repository.
- [`package.json`](/tmp/temporal-worktrees/task-tw-001/package.json#L22) through [`package.json`](/tmp/temporal-worktrees/task-tw-001/package.json#L34) declare all current dependencies and devDependencies with range prefixes such as `^3.1000.0`, `^16.0.0`, and `^2.22.0`.
- [`package-lock.json`](/tmp/temporal-worktrees/task-tw-001/package-lock.json#L13) through [`package-lock.json`](/tmp/temporal-worktrees/task-tw-001/package-lock.json#L27) mirrors those root manifest ranges while also locking specific resolved package versions further down in the file.
- [`CONTRIBUTING.md`](/tmp/temporal-worktrees/task-tw-001/CONTRIBUTING.md#L13) currently tells contributors to run `npm install`, so a root `.npmrc` is an appropriate place to set project-wide npm defaults.

## Key Interpretation

The important scope distinction is:

1. `save-exact=true` affects how npm writes dependency specifiers during future save operations.
2. It does not retroactively convert the existing caret-prefixed entries in [`package.json`](/tmp/temporal-worktrees/task-tw-001/package.json#L22) or the mirrored root metadata in [`package-lock.json`](/tmp/temporal-worktrees/task-tw-001/package-lock.json#L13).

The narrowest and safest interpretation of the task is therefore:

- add the `.npmrc` file
- do not rewrite existing dependency ranges
- do not regenerate the lockfile

If the actual product intent is to pin all currently declared dependencies immediately, that would be a broader manifest-editing task and should be treated separately.

## Recommended Approach

Create a new repository-root `.npmrc` file with exactly:

```ini
save-exact=true
```

Implementation notes:

1. Keep the file at the repository root so it applies to all npm commands run in the project.
2. Avoid adding unrelated npm settings unless the task explicitly expands.
3. Leave [`package.json`](/tmp/temporal-worktrees/task-tw-001/package.json#L1) and [`package-lock.json`](/tmp/temporal-worktrees/task-tw-001/package-lock.json#L1) unchanged.

## Scope

Expected implementation surface:

- add `.npmrc`

No source, test, dependency, or lockfile changes should be necessary for this task as written.

## Verification

After implementation, verify:

1. `.npmrc` exists at the repository root.
2. It contains `save-exact=true`.
3. [`package.json`](/tmp/temporal-worktrees/task-tw-001/package.json#L1) remains unchanged.
4. [`package-lock.json`](/tmp/temporal-worktrees/task-tw-001/package-lock.json#L1) remains unchanged.
5. Optional sanity check: `npm config get save-exact --location=project` reports `true`.

## Risk Notes

- The main review risk is expectation mismatch: this setting pins future additions, but it does not normalize the existing dependency ranges already in the repository.
- Contributors using non-npm tooling or manual manifest edits could still introduce ranged versions outside this guardrail.
- Because `.npmrc` is a hidden root file, it is easy to miss in review unless the task is kept tightly scoped.
