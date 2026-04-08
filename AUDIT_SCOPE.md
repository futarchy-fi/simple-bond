# SimpleBondV5 Audit Scope

This document defines the intended audit scope for the `SimpleBondV5` core line.

## Objective

Audit the `V5` core bond mechanism and the minimal contract-judge wrapper, without pulling legacy contracts or the current Kleros adapter into scope.

The goal of this audit is to answer:

- does `SimpleBondV5` preserve the intended bond economics and queue semantics?
- does the `V5` concession window behave as specified?
- does the move from EOA judges to contract judges introduce new security issues?
- is the minimal `ManualJudge` wrapper safe within its intended trust model?

## In Scope

Contracts:

- `contracts/core/SimpleBondV5.sol`
- `contracts/interfaces/IBondJudgeV5.sol`
- `contracts/judges/ManualJudge.sol`

Primary tests:

- `test/core/v5/SimpleBondV5.test.js`
- `test/core/v5/SimpleBondV5.fuzz.test.js`
- `test/core/v5/SimpleBondV5.invariants.test.js`
- `test/helpers/v5/simpleBondV5Fuzz.js`
- `test/helpers/v5/simpleBondV5Invariants.js`

## Out Of Scope

Legacy contracts:

- `contracts/legacy/SimpleBond.sol`
- `contracts/legacy/SimpleBondV3.sol`
- `contracts/legacy/SimpleBondV4.sol`

Legacy or future adapters:

- `contracts/legacy/KlerosJudge.sol`
- any future `KlerosJudgeV2` work

Other contracts and tooling:

- `contracts/test/MockArbitrator.sol`
- `contracts/test/TestToken.sol`
- frontend code
- backend notification code
- deployment scripts and deployment checklist tooling
- judge dropdown / registry UX

These files may remain in the repository for regression and development reasons, but they are not intended audit targets for the `V5` core engagement.

## Audit Model

Please audit against the exact git commit selected at engagement kickoff, not a floating branch name.

At the time of writing, the intended `V5` core audit target is the `main` line at an exact agreed commit hash.

## Test Commands

Primary `V5` commands:

```bash
npx hardhat test test/core/v5/SimpleBondV5.test.js
npx hardhat test test/core/v5/SimpleBondV5.fuzz.test.js test/core/v5/SimpleBondV5.invariants.test.js
```

Repository-wide regression command:

```bash
npm test
```

## Explicit Trust Assumptions

- `ManualJudge` is trusted by the parties who choose it.
- `ManualJudge` is intentionally minimal and does not attempt to constrain operator judgment.
- `SimpleBondV5` assumes the configured judge contract may rule, reject, or do nothing until timeout.
- `SimpleBondV5` does not model external arbitration flows, appeals, or evidence systems.

## Explicitly Deferred Work

These are expected future work items and should not be treated as missing pieces in this audit:

- `KlerosJudgeV2`
- frontend support for `V5`
- deploy-path migration from `V4` to `V5`
- UI judge discovery / curation for contract judges

## Intended Reviewer Focus

Please prioritize:

- state-machine correctness
- token accounting and fund conservation
- FIFO queue behavior under repeated challenges
- concession and timeout edge cases
- judge-fee handling
- access control boundaries between poster, challengers, judge contract, and judge operator
- griefing or stuck-fund scenarios
