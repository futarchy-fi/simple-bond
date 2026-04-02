# sh-002 Analysis: add README test badge placeholder

## Summary

The requested change is a minimal documentation-only update: insert a placeholder test coverage badge at the top of `README.md` using the exact Markdown:

`![Tests](https://img.shields.io/badge/tests-passing-green)`

This is a low-risk change because it only affects README presentation and does not alter any runtime, contract, backend, or frontend behavior.

## Current Branch State

`README.md` currently starts with the top-level heading:

`# SimpleBond v4`

The requested badge line is not present in the file.

## Recommended Approach

1. Edit `README.md`.
2. Insert the badge Markdown as the new first line of the file.
3. Leave all existing README content unchanged.

The implementation should be a single-line addition only, placed above the existing title so the badge renders at the top of the page.

## Verification

Verification for the implementation should be limited to:

1. Confirm the first line of `README.md` is `![Tests](https://img.shields.io/badge/tests-passing-green)`.
2. Confirm the existing `# SimpleBond v4` heading remains immediately below the added badge.
3. Confirm no unrelated files are modified.

## Scope

Expected implementation change surface:

- update `README.md`

No tests, contract changes, backend changes, frontend changes, or configuration changes should be required.
