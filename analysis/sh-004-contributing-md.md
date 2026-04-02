# sh-004 Analysis: add `CONTRIBUTING.md`

## Summary

The requested change is a documentation and contributor-workflow update: add a new root-level `CONTRIBUTING.md` that explains local development prerequisites, the basic setup and verification commands, how to add a new contract in this Hardhat project, and how pull requests should use the existing PR template.

This is a low-risk change because it only adds contributor documentation and does not alter contract, backend, frontend, deployment, or test behavior.

## Current Branch State

- No `CONTRIBUTING.md` file exists at the repository root.
- The project is a Node/Hardhat repository with `package.json` scripts for:
  - `compile`: `hardhat compile`
  - `test`: `hardhat test`
- The repository already contains the exact workflow commands requested for setup verification:
  - `npm install`
  - `npx hardhat compile`
  - `npx hardhat test`
- Smart contracts live under `contracts/`.
- Contract tests live under `test/`.
- A PR template already exists at `.github/pull_request_template.md` with sections for `Summary`, `Changes`, `Testing`, and `Checklist`.

## Recommended Approach

1. Create a new root-level `CONTRIBUTING.md`.
2. Keep the document short and task-focused, using plain Markdown headings and fenced shell blocks where helpful.
3. Include a `Prerequisites` section that states:
   - Node.js 18+
   - npm
4. Include a `Development Setup` section with the exact requested command sequence:
   - `npm install`
   - `npx hardhat compile`
   - `npx hardhat test`
5. Include a `Adding a New Contract` section tailored to this repository:
   - add the Solidity file under `contracts/`
   - add or update tests under `test/`
   - run compile and test again before opening a PR
   - update related docs if the contract changes user-facing or deployment behavior
6. Include a `Pull Requests` section that tells contributors to use the existing PR template when opening a PR.

## Content Notes

- The task explicitly asks for `npx hardhat compile` and `npx hardhat test`, so the new document should use those commands directly even though equivalent npm scripts also exist.
- The PR process should reference `.github/pull_request_template.md` rather than duplicating its full contents.
- The “how to add a new contract” guidance should stay minimal and repository-specific; there is no evidence in the current tree of a more complex registration or generation step that needs to be documented.

## Verification

Verification for the implementation should be limited to:

1. Confirm `CONTRIBUTING.md` exists at the repository root.
2. Confirm it includes the requested prerequisites: Node 18+ and npm.
3. Confirm it includes the requested setup commands:
   - `npm install`
   - `npx hardhat compile`
   - `npx hardhat test`
4. Confirm it includes instructions for adding a new contract under `contracts/` and corresponding tests under `test/`.
5. Confirm it tells contributors to use the PR template when opening pull requests.
6. Confirm no unrelated files are modified.

## Scope

Expected implementation change surface:

- add `CONTRIBUTING.md`

No contract, backend, frontend, deployment, or automated test changes should be required.
