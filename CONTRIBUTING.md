# Contributing

## Prerequisites

- Node.js 18+
- npm

## Development Setup

Run the standard setup and verification steps before opening a pull request:

```sh
npm install
npx hardhat compile
npx hardhat test
```

## Adding a New Contract

When adding a new Solidity contract to this repository:

1. Add the contract source under `contracts/`.
2. Add a new test or update the relevant coverage under `test/`.
3. Run `npx hardhat compile` and `npx hardhat test` again before opening a pull request.
4. Update related documentation if the contract changes user-facing behavior, deployment steps, or published addresses.

## Pull Requests

Use the existing PR template at `.github/pull_request_template.md` when opening a pull request. Fill in the `Summary`, `Changes`, `Testing`, and `Checklist` sections so reviewers have the expected context.
