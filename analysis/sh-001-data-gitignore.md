# sh-001 Analysis: ignore `data/`

## Summary

The requested implementation is a one-line repository hygiene change: add `data/` to the root `.gitignore` so local data files do not appear as untracked.

This is a low-risk change because it only affects Git ignore rules and does not alter runtime behavior.

## Current Branch State

- The root `.gitignore` currently contains:
  - `node_modules/`
  - `cache/`
  - `artifacts/`
  - `.env`
- In this worktree, `git status --short --untracked-files=all` is currently clean.
- No `data/` directory exists at the repository root in this checkout, so the reported untracked-directory symptom is not directly reproducible here.

## Interpretation

The task description most likely reflects a developer-local branch state where a generated or manually created `data/` directory exists outside the committed repository contents.

Even though the directory is absent in this checkout, adding `data/` to `.gitignore` is still the correct fix if the repository should consistently ignore local data artifacts across environments.

## Recommended Approach

1. Update the root `.gitignore`.
2. Add a single new line: `data/`.
3. Leave all other files unchanged.

Placement can be at the end of the existing ignore list to keep the change minimal.

## Verification

Verification for the implementation should be limited to:

1. Confirm `.gitignore` contains a `data/` entry.
2. If a local `data/` directory exists, confirm `git status --short` no longer reports it as untracked.
3. Confirm no unrelated files are modified.

## Scope

Expected implementation change surface:

- update `.gitignore`

No contract, backend, frontend, documentation, or test changes should be required.
