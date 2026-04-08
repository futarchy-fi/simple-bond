# temporal-fleet-1ko-r2 Analysis: add a `SimpleBondV4` deployment checklist helper

## Summary

This task is a small deployment-tooling addition under [`scripts/`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts). The helper should accept concrete `SimpleBondV4` deployment context and print the repo-specific follow-up work that still has to happen after the on-chain deploy succeeds.

The important scope boundary is that this task is only the helper itself. Wiring it into [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/deploy.js#L1) belongs to the follow-on task in the decomposition, so this analysis should stay focused on the reusable checklist module and its standalone CLI behavior.

## Current State

- [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/deploy.js#L1) deploys `SimpleBondV4`, waits for mining, and prints:
  - deployed address
  - deployment transaction hash
  - mined block number
- [`scripts/deployKlerosJudge.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/deployKlerosJudge.js#L1) is the closest local pattern for the desired UX: it prints deploy metadata plus a short post-deploy checklist.
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/frontend/index.html#L896) hardcodes the active `SimpleBondV4` frontend chain map, including:
  - contract addresses
  - `deployBlock` values used for event reads
  - Kleros adapter addresses
  - a "not deployed yet" placeholder for Ethereum
- [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/backend/config.mjs#L34) hardcodes backend watcher support for Gnosis and Polygon only, including:
  - `CONFIRMATION_BLOCKS`
  - `CHAINS[chainId].contract`
  - `CHAINS[chainId].startBlock`
- [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/README.md#L160) publishes the canonical deployed-address table and current deployment guidance.
- [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/hardhat.config.js#L78) exposes `gnosis`, `base`, `polygon`, and `ethereum` as deploy targets, but the product/runtime surface is narrower than that.

## Key Interpretation

The helper should be `SimpleBondV4`-oriented, even if it accepts a `contractName` field for display.

Why:

1. The active deploy path in [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/deploy.js#L1) is `SimpleBondV4`.
2. The frontend, backend, and README address table are all currently wired around `SimpleBondV4`.
3. Older contracts still exist in [`contracts/SimpleBond.sol`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/contracts/SimpleBond.sol#L1) and [`contracts/SimpleBondV3.sol`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/contracts/SimpleBondV3.sol#L1), but the repo does not treat them as current live deployment targets.

So the safest interpretation is:

- accept deployment context fields like network, contract name, address, tx hash, and block number
- print repo follow-ups for the active `SimpleBondV4` product surface
- avoid implying that every Hardhat-configured network is already supported by the app or backend

## Recommended Implementation Shape

Add one new CommonJS file under [`scripts/`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts), for example:

- [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/printSimpleBondDeploymentChecklist.js)

It should serve two purposes:

1. Export a reusable function such as `printSimpleBondDeploymentChecklist(context)` so the later deploy-flow task can import it directly instead of shelling out.
2. Support direct CLI usage through `node scripts/printSimpleBondDeploymentChecklist.js ...` for manual operator use and easy verification.

### CLI Contract

Use plain `process.argv` parsing instead of adding a dependency. The expected flags should be explicit and stable:

- `--network`
- `--contract-name`
- `--address`
- `--tx-hash`
- `--block-number`

Required behavior:

1. Validate that all five values are present before printing the checklist.
2. Print a short usage message and exit non-zero on missing arguments.
3. Keep the script dependency-free so it can run under plain Node without `hardhat` bootstrapping.

This is preferable to a Hardhat task because the helper is just formatting repo-specific guidance, not interacting with chain state.

### Output Shape

The helper output should stay concise and operational, following the local style already visible in [`scripts/deployKlerosJudge.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/deployKlerosJudge.js#L50).

Recommended sections:

1. `Deployment summary`
   - network
   - contract name
   - address
   - tx hash
   - block number
2. `Post-deploy checklist`
   - verify command
   - frontend follow-up
   - backend follow-up
   - README follow-up
3. `Network support note`
   - clarify whether the named network is already wired into the shipped product or only deployable from Hardhat

## Concrete Checklist Content

The helper should print concrete follow-ups, not generic reminders.

### Verification command

For the current `SimpleBondV4` deploy path, the verify command is the zero-constructor-argument form:

```bash
npx hardhat verify --network <network> <address>
```

That command should be rendered from the provided deployment context. The helper should not invent constructor arguments because [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/deploy.js#L4) currently deploys `SimpleBondV4` with none.

### Frontend follow-up

Point operators to [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/frontend/index.html) and tell them to update the chain entry that the UI uses:

- `CHAINS[chainId].contract`
- `CHAINS[chainId].deployBlock`
- chain-availability copy if the network is newly live in the frontend
- `KLEROS_JUDGE[chainId]` only if a Kleros adapter is also deployed for that chain

For `gnosis` and `polygon`, this is an update-to-existing-entry operation.

For `ethereum` and `base`, the helper should clearly say that extra frontend wiring is still needed before the chain is actually product-live.

### Backend follow-up

Point operators to [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/backend/config.mjs) and tell them to update:

- `CHAINS[chainId].contract`
- `CHAINS[chainId].startBlock`
- `CONFIRMATION_BLOCKS[chainId]`

For `gnosis` and `polygon`, this means updating the existing backend chain map.

For `ethereum` and `base`, this means adding new backend watcher support rather than pretending it already exists.

### README follow-up

Point operators to [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/README.md) and tell them to update:

- the `Addresses` table if the deployment is meant to be canonical/public
- deployment instructions if the supported operational flow changes

## Network-Awareness Requirement

This helper should encode the repo's actual deployment surface instead of treating every Hardhat network the same.

A small internal metadata map is enough:

- `gnosis`: deployed and product-wired in frontend, backend, and README
- `polygon`: deployed and product-wired in frontend, backend, and README
- `ethereum`: present in Hardhat and frontend selector, but still shown as not deployed and absent from backend watcher config
- `base`: present in Hardhat only, not wired into frontend, backend, or README

For unknown network names, the helper can fall back to a generic message like:

- deployment context captured successfully
- inspect frontend, backend, and README before claiming app support for this chain

That fallback is safer than making unsupported assumptions.

## Scope Boundaries

This task should only add the helper file. It should not yet:

- modify [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/deploy.js)
- change [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/frontend/index.html)
- change [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/backend/config.mjs)
- change [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/README.md)
- add npm dependencies or a new package script unless the implementation step proves that a direct CLI entry is necessary

The next task in the decomposition is the correct place to wire the helper into the normal deploy flow.

## Verification Plan

Because the helper should be plain Node code with no new dependencies, verification can stay lightweight:

1. Run the helper directly with sample values:

```bash
node scripts/printSimpleBondDeploymentChecklist.js \
  --network gnosis \
  --contract-name SimpleBondV4 \
  --address 0x1111111111111111111111111111111111111111 \
  --tx-hash 0x2222222222222222222222222222222222222222222222222222222222222222 \
  --block-number 123456
```

2. Confirm the output includes:
   - the provided deployment context
   - `npx hardhat verify --network gnosis 0x1111111111111111111111111111111111111111`
   - a frontend reminder naming [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/frontend/index.html)
   - a backend reminder naming [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/backend/config.mjs)
   - a docs reminder naming [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/README.md)
3. Run it again with `--network ethereum` or `--network base` and confirm the wording says the chain still needs extra product wiring rather than implying it is already live.
4. Run it with a missing required flag and confirm it exits non-zero with a usage message.

## Risks And Assumptions

- The helper can safely assume the current verify command takes no constructor arguments because [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r2-implement-simplebond-checklist-helper/scripts/deploy.js#L4) deploys `SimpleBondV4` with none today. If constructor args are introduced later, both the deploy script and this helper will need to change together.
- The `contractName` field is useful for display and future-proofing, but the concrete checklist content should still be written around the active `SimpleBondV4` product surface.
- The biggest correctness risk is overclaiming network support. The helper must distinguish "deployable from Hardhat" from "wired through frontend/backend/docs" so operators are not misled after deploying to `ethereum` or `base`.
