# temporal-fleet-hhv-r1 Analysis: contract size reporting surface

## Conclusion

The canonical implementation point for contract size reporting in this repo is the existing custom Hardhat task in `hardhat.config.js`, and the canonical developer-facing entrypoint is the existing `size` npm script in `package.json`.

If this feature is documented for contributors, the most coherent documentation home is `CONTRIBUTING.md`, because that file already defines the standard local verification workflow. The deploy-focused `README.md` is a weaker fit for a developer-only report.

## Hardhat and npm integration points

- `hardhat.config.js:10-71` already defines `task("size-contracts", ...)`.
- That task calls `hre.run("compile")`, reads all artifacts, then filters to:
  - `artifact.sourceName.startsWith("contracts/")`
  - `artifact.deployedBytecode !== "0x"`
- `package.json:6-13` already exposes the task as `npm run size` via `"size": "hardhat size-contracts"`.

This means no new standalone script is needed for contract size reporting. The report already belongs in the Hardhat task layer, with npm only exposing that task.

## Existing developer command surfaces

These files currently expose or document the project's developer commands:

- `package.json:6-13`
  - npm scripts for `clean`, `compile`, `size`, `test`, and notification services.
- `Makefile:1-19`
  - Make targets for `compile`, `test`, `clean`, and `lint`.
  - There is currently no `size` make target.
- `CONTRIBUTING.md:8-25`
  - documents `npm install`, `npx hardhat compile`, and `npx hardhat test` as the standard verification flow.
  - does not currently mention contract size reporting.
- `README.md:112-118`
  - documents deployment commands (`npx hardhat compile` and `npx hardhat run scripts/deploy.js --network gnosis`), not general contributor workflows.

If the repo wants the size report to be discoverable to developers, `CONTRIBUTING.md` is the strongest existing documentation surface. If the repo wants parity across command wrappers, `Makefile` is the strongest secondary command surface to add alongside `package.json`.

## Observed current report behavior

After installing dependencies locally, `npm run size` succeeded and printed this report:

| Contract | Runtime bytes | % of EIP-170 |
| --- | ---: | ---: |
| `SimpleBondV4` | 10531 | 42.85 |
| `SimpleBondV3` | 7782 | 31.67 |
| `KlerosJudge` | 7325 | 29.81 |
| `SimpleBond` | 5859 | 23.84 |
| `TestToken` | 1926 | 7.84 |
| `MockArbitrator` | 1331 | 5.42 |

So the current task reports every deployable artifact under `contracts/`, including legacy and test-only contracts.

## Include and exclude recommendations

### Include in the default report

- `contracts/SimpleBondV4.sol`
  - This is the active bond contract in deployment docs and backend config.
  - Evidence:
    - `scripts/deploy.js:3-14` deploys `SimpleBondV4`
    - `README.md:158-166` lists live `SimpleBondV4` addresses
    - `backend/config.mjs:39-57` watches deployed `SimpleBondV4` instances
    - `SECURITY.md:21-29` includes `contracts/SimpleBondV4.sol` in the main security scope
- `contracts/KlerosJudge.sol`
  - This is the active adapter contract paired with `SimpleBondV4`.
  - Evidence:
    - `scripts/deployKlerosJudge.js:29-56` deploys `KlerosJudge`
    - `README.md:160-166` lists a live `KlerosJudge` address
    - `SECURITY.md:21-29` includes `contracts/KlerosJudge.sol` in the main security scope

### Exclude from the default report

- Interface-only outputs
  - `contracts/interfaces/IArbitrator.sol` outputs: `IArbitrator`, `IArbitrable`, `IEvidence`
  - embedded `ISimpleBondV4` from `contracts/KlerosJudge.sol`
  - Reason: they compile to artifacts but have `deployedBytecode === "0x"`, so they are already skipped by the current task.
- `contracts/TestToken.sol`
  - Reason: explicitly marked "for testing only" in `contracts/TestToken.sol:6-12`.
- `contracts/MockArbitrator.sol`
  - Reason: explicitly marked as a "Test mock" in `contracts/MockArbitrator.sol:6-10`.
  - It is only used by `test/KlerosJudge.test.js:35-46`.
- `contracts/SimpleBond.sol`
  - Reason: legacy contract generation. It has no deploy script, no listed live address, no backend integration, no security-scope mention, and no direct test file in the current repo.
- `contracts/SimpleBondV3.sol`
  - Reason: retained for historical coverage, but not part of the current deploy/docs/security surface.
  - Evidence:
    - it still has dedicated tests in `test/SimpleBondV3.test.js:17-80`
    - but current deployment and operational docs only surface `SimpleBondV4`

## Recommended scope rule

For a developer-facing default report, the cleanest scope is:

- include active deployable contracts: `SimpleBondV4`, `KlerosJudge`
- exclude test scaffolding: `TestToken`, `MockArbitrator`
- exclude legacy generations: `SimpleBond`, `SimpleBondV3`
- continue auto-excluding interface-only artifacts with no runtime bytecode

If the team still wants a full internal inventory, that should be a separate "all contracts" mode, because the current default output mixes shipping contracts with legacy and test helpers.

## Verification notes

- `npm run size` failed before dependency install because the worktree had no local `node_modules`.
- After `npm install`, the existing `size` script worked without code changes.
