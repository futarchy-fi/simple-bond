# temporal-fleet-1ko-r3 Analysis: print the checklist from the SimpleBond deploy flow

## Summary

This is a narrow follow-on to the prior checklist-helper task. The reusable helper already exists in [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/printSimpleBondDeploymentChecklist.js#L1); this task is only about wiring that helper into the normal [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/deploy.js#L1) flow.

The required behavior is straightforward:

1. keep the successful `SimpleBondV4` deployment output that operators already rely on
2. capture the same deploy metadata in variables that can be reused
3. invoke the helper automatically after the deploy succeeds

Repository-state note: the current branch head already reflects the intended end state for this task. The parent version of [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/deploy.js#L1) stopped after printing the address, tx hash, and mined block number; the current version adds the helper import and call.

## Current State

- [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/printSimpleBondDeploymentChecklist.js#L1) already exports `printSimpleBondDeploymentChecklist(...)` and supports direct CLI usage.
- The helper already accepts the exact context that [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/deploy.js#L1) has available at deploy time:
  - `network`
  - `contractName`
  - `address`
  - `txHash`
  - `blockNumber`
- The helper is tolerant of partial metadata:
  - it only prints the tx hash when one is provided
  - it only prints the deploy block when one is provided
- [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/deploy.js#L1) currently deploys `SimpleBondV4`, waits for deployment, logs the deployed address, logs the deploy transaction hash, waits for mining, logs the mined block number, and then calls the helper with the captured values.

## Required Delta

If implementing this from the pre-task baseline, the minimal code change is confined to [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/deploy.js#L1):

1. Import `printSimpleBondDeploymentChecklist` from [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/printSimpleBondDeploymentChecklist.js#L1).
2. Preserve the current successful deploy logging:
   - `SimpleBondV4 deployed to: <address>`
   - `Deploy tx hash: <hash>`
   - `Block number: <block>`
3. Promote the mined block number into a `blockNumber` variable so it can be reused after logging.
4. Call the helper after the deploy metadata is printed, passing:
   - `network: hre.network.name`
   - `contractName: "SimpleBondV4"`
   - `address: addr`
   - `txHash: deployTx ? deployTx.hash : undefined`
   - `blockNumber`

The helper should be called directly as a CommonJS import, not via a subprocess, because the reusable function already exists and avoids unnecessary CLI parsing inside the deploy path.

## Scope Boundaries

This task should not change the helper's content unless wiring exposes a concrete bug. The helper implementation from [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/printSimpleBondDeploymentChecklist.js#L1) is already the source of truth for the checklist text.

This task also should not require changes to:

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/contracts/SimpleBondV4.sol#L1)
- [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/frontend/index.html)
- [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/backend/config.mjs)
- [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/README.md)

## Verification Plan

`node_modules/` is absent in this worktree, so runtime verification would require dependency installation first.

After implementation:

1. `npm install`
2. `npx hardhat run scripts/deploy.js --network hardhat`
3. Confirm the output still includes:
   - the deployed address
   - the deploy transaction hash
   - the mined block number
4. Confirm the checklist prints immediately afterward, using the same deployed address and block number.
5. On `hardhat`, confirm the helper takes the local-network branch and prints the "skip explorer verification" guidance instead of a public verify command.

Because this task is only the wiring layer, a direct CLI run of [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r3-wire-checklist-into-simplebond-deploy/scripts/printSimpleBondDeploymentChecklist.js#L1) is optional rather than essential; that helper behavior belongs more directly to the prior task.

## Risks And Assumptions

- `deploymentTransaction()` can theoretically be absent in some environments, so the wiring should continue to tolerate missing `txHash` and `blockNumber` rather than assuming both are always defined.
- The most likely regression is accidental loss of the existing deploy logs while refactoring to pass metadata into the helper. Preserving those console lines is part of the task contract.
- The helper already encodes network-aware messaging, so the deploy script should only pass facts it knows and should not duplicate any checklist formatting logic inline.
