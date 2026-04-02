# sh-009 Analysis: create `.editorconfig`

## Summary

This is a repository-root tooling/configuration task: add a new `.editorconfig` file that establishes LF line endings, UTF-8 encoding, trailing-whitespace trimming, and 2-space indentation for JavaScript, TypeScript, and Solidity files.

The implementation should be low risk because `.editorconfig` changes editor behavior for future edits; it does not reformat tracked files by itself.

## Current State

- No root `.editorconfig` file is currently present in the repository.
- The repository contains JavaScript and Solidity sources, including:
  - [`hardhat.config.js`](/tmp/temporal-worktrees/task-sh-009/hardhat.config.js#L1)
  - [`scripts/deploy.js`](/tmp/temporal-worktrees/task-sh-009/scripts/deploy.js#L1)
  - [`frontend/runtime-config.js`](/tmp/temporal-worktrees/task-sh-009/frontend/runtime-config.js#L1)
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-sh-009/contracts/SimpleBondV4.sol#L1)
- There are currently no tracked `.ts` files.
- The backend is primarily written as `.mjs` modules, for example:
  - [`backend/server.mjs`](/tmp/temporal-worktrees/task-sh-009/backend/server.mjs#L1)
  - [`backend/api.mjs`](/tmp/temporal-worktrees/task-sh-009/backend/api.mjs#L1)
- The repository already uses LF line endings for tracked files, as shown by `git ls-files --eol`.
- Existing indentation is not uniform:
  - [`frontend/runtime-config.js`](/tmp/temporal-worktrees/task-sh-009/frontend/runtime-config.js#L1) uses 2-space indentation.
  - [`hardhat.config.js`](/tmp/temporal-worktrees/task-sh-009/hardhat.config.js#L6) uses 4-space indentation.
  - [`scripts/deploy.js`](/tmp/temporal-worktrees/task-sh-009/scripts/deploy.js#L3) uses 4-space indentation.
  - [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-sh-009/contracts/SimpleBondV4.sol#L27) uses 4-space indentation.

## Key Interpretation

The task wording is explicit about scope:

1. `root=true` should be set at the top level.
2. `end_of_line=lf`, `charset=utf-8`, and `trim_trailing_whitespace=true` should apply generally.
3. `indent_style=space` and `indent_size=2` should apply to `js`, `ts`, and `sol` files.

The only notable ambiguity is `.mjs` coverage. This repository has more `.mjs` files than `.js` files, but the task text does not mention `.mjs`. The narrowest interpretation is to leave `.mjs` out of scope for this task and only configure the explicitly requested extensions.

## Recommended Approach

Create a new root-level `.editorconfig` with:

1. `root = true`
2. A global `[*]` section for:
   - `end_of_line = lf`
   - `charset = utf-8`
   - `trim_trailing_whitespace = true`
3. A language-specific section for `js`, `ts`, and `sol` files that sets:
   - `indent_style = space`
   - `indent_size = 2`

The intended shape is roughly:

```ini
root = true

[*]
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true

[*.{js,ts,sol}]
indent_style = space
indent_size = 2
```

If maximum editor compatibility is preferred over compactness, separate `[*.js]`, `[*.ts]`, and `[*.sol]` sections would also be acceptable.

## Scope

Expected implementation surface:

- add `.editorconfig`

No contract, backend, frontend, test, dependency, or lockfile changes should be necessary.

## Verification

After implementation, verify:

1. `.editorconfig` exists at the repository root.
2. It contains `root = true`.
3. It sets `end_of_line = lf`, `charset = utf-8`, and `trim_trailing_whitespace = true`.
4. It sets `indent_style = space` and `indent_size = 2` for `js`, `ts`, and `sol` patterns.
5. No unrelated files are modified.

## Risk Notes

- Adding `.editorconfig` will not automatically rewrite existing 4-space-indented files such as [`hardhat.config.js`](/tmp/temporal-worktrees/task-sh-009/hardhat.config.js#L6) or [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-sh-009/contracts/SimpleBondV4.sol#L27). Any actual reindentation would require separate file edits and would create unnecessary diff noise for this task.
- Applying `trim_trailing_whitespace = true` globally is consistent with the literal request, but it would also affect Markdown files if contributors edit them with EditorConfig-aware tooling.
- Leaving `.mjs` out of the indentation section follows the task text exactly, but it means the backend ESM modules would remain unconstrained by the new file. If the team wants full JavaScript-family coverage, that should be an explicit scope expansion.
