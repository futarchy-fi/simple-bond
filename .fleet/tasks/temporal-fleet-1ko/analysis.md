# temporal-fleet-1ko Analysis: add deployment checklist script for SimpleBond contracts

## Summary

This is a small deployment-tooling task. The cleanest implementation is to add a dedicated checklist helper under [`scripts/`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts) and invoke it from [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deploy.js#L1) after a `SimpleBondV4` deployment.

The repository already has a stronger pattern for this in [`scripts/deployKlerosJudge.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deployKlerosJudge.js#L1): it prints deploy metadata plus a concrete post-deploy checklist. [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deploy.js#L1) currently stops at the address, tx hash, and block number.

## Current State

- [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deploy.js#L1) deploys `SimpleBondV4` with no constructor args and prints:
  - deployed address
  - deployment transaction hash
  - mined block number
- [`scripts/deployKlerosJudge.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deployKlerosJudge.js#L1) already prints a `Post-deploy checklist` with:
  - a `hardhat verify` command
  - a reminder to update frontend config
  - a reminder to complete off-chain follow-up work
- [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/README.md#L114) only documents `npx hardhat run scripts/deploy.js --network gnosis`; it does not describe any follow-up checklist for a new SimpleBond deployment.
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/frontend/index.html#L895) hardcodes the active `SimpleBondV4` addresses and deploy blocks for Gnosis and Polygon.
- [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/backend/config.mjs#L36) hardcodes the same Gnosis and Polygon contract addresses plus notification watcher start blocks.
- [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/README.md#L162) also carries the canonical address table for `SimpleBondV4` deployments.
- [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/hardhat.config.js#L1) defines `hardhat`, `gnosis`, `base`, `polygon`, and `ethereum` networks, but the frontend and backend only have active runtime config for Gnosis and Polygon.

## Scope Interpretation

The task title says "SimpleBond contracts", but the live deployment surface in this repository is clearly `SimpleBondV4`:

- [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deploy.js#L4) deploys `SimpleBondV4`
- [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/README.md#L164) lists only `SimpleBondV4` addresses
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/frontend/index.html#L901) and [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/backend/config.mjs#L43) point at `SimpleBondV4`

Older contracts still exist in [`contracts/SimpleBond.sol`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/contracts/SimpleBond.sol#L1) and [`contracts/SimpleBondV3.sol`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/contracts/SimpleBondV3.sol#L1), but there is no parallel deployment tooling or product config that treats them as current targets. The safest reading is therefore:

1. implement the checklist for the active `SimpleBondV4` deployment path
2. keep the helper parameterizable enough that it could print the same structure for another SimpleBond contract name later if needed

## Recommended Approach

1. Add a new helper script under [`scripts/`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts), for example `scripts/printSimpleBondDeploymentChecklist.js`.
2. Feed it the deployment context that [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deploy.js#L1) already knows:
   - Hardhat network name
   - contract name
   - deployed address
   - deployment tx hash
   - mined block number
3. Make the checklist explicitly cover the repo's real follow-up work:
   - explorer verification command for the deployed contract
   - update [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/frontend/index.html#L895) when the new deployment should become the app's active address
   - update [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/backend/config.mjs#L36) when the notification backend should watch that chain/address
   - update [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/README.md#L162) if the deployment is intended to be canonical
   - confirm any chain-support caveat when the deployment lands on a Hardhat-configured network that the frontend/backend do not yet support
4. Invoke the helper from [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deploy.js#L1) so the normal deployment path prints the checklist automatically.
5. Optionally add a package script or README note if maintainers want the checklist runnable without executing a live deployment.

## Expected File Surface

Most likely:

- [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deploy.js)
- one new file under [`scripts/`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts)

Possible but not strictly required:

- [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/package.json)
- [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/README.md)

This task should not require Solidity, frontend behavior, backend behavior, or test logic changes.

## Verification Plan

`node_modules/` is absent in this worktree, so runtime verification would require installing dependencies first.

After implementation:

1. `npm install`
2. `npx hardhat run scripts/deploy.js --network hardhat`
3. Confirm the deployment output still includes the address, tx hash, and block number.
4. Confirm the new checklist prints:
   - a correct `hardhat verify` command for a zero-constructor-arg `SimpleBondV4`
   - frontend update guidance
   - backend update guidance
   - README update guidance
5. If the helper can run standalone, invoke it directly with sample values and confirm its network-specific wording does not imply unsupported chains are already wired through the app.

## Risks And Ambiguities

- The word "contracts" could be interpreted as all historical SimpleBond variants, but the repo's current deployment and product surfaces point to `SimpleBondV4` only.
- [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/hardhat.config.js#L68) includes `base` and `ethereum`, while [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/frontend/index.html#L895) and [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/backend/config.mjs#L36) only wire Gnosis and Polygon. The checklist should state that distinction clearly instead of assuming all configured Hardhat networks are production-supported.
- Because `SimpleBondV4` has no constructor args in [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko/scripts/deploy.js#L4), the verification command is simple now. If constructor args are added later, the helper will need to evolve with the deploy script.
