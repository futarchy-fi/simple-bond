# sh-003 Analysis: add PR template

## Summary

The requested change is a small repository-maintenance update: create `.github/pull_request_template.md` so new pull requests start with a consistent structure.

This is a low-risk documentation and workflow change because it only affects GitHub's PR authoring experience and does not alter contract, backend, frontend, or test behavior.

## Current Branch State

- The repository already has a `.github/` directory.
- The only committed file currently under `.github/` is `.github/workflows/pages.yml`.
- No repository-level PR template file currently exists at `.github/pull_request_template.md`.

## Recommended Approach

1. Create `.github/pull_request_template.md`.
2. Add four top-level sections:
   - `Summary`
   - `Changes`
   - `Testing`
   - `Checklist`
3. Under `Checklist`, add unchecked checklist items covering:
   - tests pass
   - no secrets committed
   - docs updated

The template should stay concise and use plain Markdown so GitHub renders it directly in the PR body editor.

## Verification

Verification for the implementation should be limited to:

1. Confirm `.github/pull_request_template.md` exists.
2. Confirm the file contains the four requested sections: `Summary`, `Changes`, `Testing`, and `Checklist`.
3. Confirm the checklist includes unchecked items for tests passing, no secrets committed, and docs updated.
4. Confirm no unrelated files are modified.

## Scope

Expected implementation change surface:

- add `.github/pull_request_template.md`

No contract, backend, frontend, configuration, or automated test changes should be required.
