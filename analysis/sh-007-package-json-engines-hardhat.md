# sh-007 Analysis: add `package.json` `engines` metadata for Node and clarify the Hardhat version

## Summary

This task is primarily a package-metadata change.

The repository currently has no root-level `engines` field in `package.json`, even though contributor documentation already says the project requires Node.js 18+.

The only meaningful ambiguity is the phrase "note the Hardhat version used":

- `package.json` declares Hardhat as `^2.22.0`
- `package-lock.json` currently resolves that range to `2.28.6`
- `engines` is the right place for Node.js compatibility, but not the best place to describe a dev tool dependency like Hardhat

## Current State

- [`package.json`](/tmp/temporal-worktrees/task-sh-007/package.json#L1) has no `engines` field.
- [`package.json`](/tmp/temporal-worktrees/task-sh-007/package.json#L22) declares:
  - `hardhat: "^2.22.0"`
- [`package-lock.json`](/tmp/temporal-worktrees/task-sh-007/package-lock.json#L7) mirrors the root manifest and still shows the declared range:
  - `hardhat: "^2.22.0"`
- [`package-lock.json`](/tmp/temporal-worktrees/task-sh-007/package-lock.json#L3798) shows the currently resolved installed Hardhat package:
  - `version: "2.28.6"`
- [`CONTRIBUTING.md`](/tmp/temporal-worktrees/task-sh-007/CONTRIBUTING.md#L3) already documents:
  - `Node.js 18+`

## Key Interpretation

The safest interpretation is:

1. Add an `engines` field to the root `package.json` with:
   - `"node": ">=18"`
2. Treat the Hardhat version as informational context, not as an `engines` constraint.

That recommendation is based on field semantics:

- `engines.node` communicates the supported Node runtime version.
- Hardhat is already represented in `devDependencies`, which is the canonical place to track the tool version requirement for this project.
- Adding something like `engines.hardhat` would be unusual and likely not enforced in the way a reader would expect.

## Hardhat Version Ambiguity

If the implementation must "note the Hardhat version used," there are two different values available:

- Declared compatibility range: `^2.22.0`
- Current lockfile-resolved version: `2.28.6`

Those values answer different questions:

- `^2.22.0` is what the repository allows when dependencies are installed.
- `2.28.6` is what the current lockfile pins today.

For an implementation limited to `package.json`, the least surprising choice is to leave Hardhat in `devDependencies` as-is and avoid trying to encode it in `engines`.

## Recommended Approach

1. Update the root `package.json` to add:

```json
"engines": {
  "node": ">=18"
}
```

2. Place the new field near the other package metadata, before `dependencies` or after `license`, to keep the manifest readable.
3. Do not change the Hardhat dependency range unless the task owner explicitly wants the dependency pinned differently.
4. If the reviewer wants the Hardhat version called out in-repo, use the version already present in `devDependencies` or the lockfile rather than adding a nonstandard `engines.hardhat` entry.

## Scope

Expected implementation change surface:

- [`package.json`](/tmp/temporal-worktrees/task-sh-007/package.json)

Possible optional follow-up, only if the repo expects lockfile metadata to stay synchronized after any manifest edit:

- [`package-lock.json`](/tmp/temporal-worktrees/task-sh-007/package-lock.json)

Because this task does not change dependency graphs, a lockfile update should not be necessary unless the team wants the root package metadata mirrored there via `npm install --package-lock-only`.

## Verification

Implementation can be verified with manifest inspection:

1. Confirm [`package.json`](/tmp/temporal-worktrees/task-sh-007/package.json) contains:
   - `"engines": { "node": ">=18" }`
2. Confirm the existing Hardhat declaration remains visible under `devDependencies`.
3. Confirm no dependency versions changed unless explicitly intended.

Optional command-level verification:

1. `npm pkg get engines`
2. `npm pkg get devDependencies.hardhat`

## Risk Notes

- The requested Node range `>=18` allows newer majors such as Node 22 as well as Node 18 and 20. That matches the literal task request, but it is broader than an LTS-only bound like `>=18 <23`.
- The local environment for this analysis is `node v22.22.1` and `npm 10.9.4`, so adding `>=18` would not conflict with the current toolchain.
