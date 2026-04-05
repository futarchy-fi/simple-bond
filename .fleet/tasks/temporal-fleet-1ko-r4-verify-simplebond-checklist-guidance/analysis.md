# temporal-fleet-1ko-r4 Analysis: verify SimpleBond checklist guidance

## Summary

This is a verification-only follow-on to the prior checklist-helper work. The current branch head already appears to reflect the intended end state: [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/deploy.js#L1) still logs the deployed address, transaction hash, and mined block number, then passes those facts into [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/printSimpleBondDeploymentChecklist.js#L12).

Based on source review plus direct `node` runs of the checklist helper, the checklist wording is already aligned with the repo's actual runtime surface:

1. non-`hardhat` deployments print the expected zero-constructor-arg verify command
2. `gnosis` and `polygon` deployments point operators to [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/frontend/index.html), [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/backend/config.mjs), and [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/README.md)
3. other networks explicitly warn that the shipped runtime config is only active for Gnosis and Polygon, so the helper does not imply broader product support than the repo actually has
4. local `hardhat` runs skip explorer verification

The only meaningful verification gap in this worktree is end-to-end `hardhat run scripts/deploy.js ...` execution: local Hardhat dependencies are missing, so that path could not be executed here.

## Current State

- [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/printSimpleBondDeploymentChecklist.js#L1) hardcodes runtime-config targets only for `gnosis` and `polygon` via `RUNTIME_CONFIG_TARGETS`.
- For any non-`hardhat` network, the helper prints:
  - `npx hardhat verify --network <network> <address>`
  - this is implemented directly in [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/printSimpleBondDeploymentChecklist.js#L36)
- For supported runtime networks, the helper explicitly points operators to:
  - [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/frontend/index.html) updates for `CHAINS[chainId].contract` and `CHAINS[chainId].deployBlock`
  - [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/backend/config.mjs) updates for `CHAINS[chainId].contract` and `CHAINS[chainId].startBlock`
  - [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/README.md) address-table updates
  - this branch is implemented in [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/printSimpleBondDeploymentChecklist.js#L43)
- For unsupported runtime networks, the helper explicitly says:
  - [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/frontend/index.html) and [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/backend/config.mjs) currently ship active SimpleBond runtime config only for Gnosis and Polygon
  - this fallback branch is implemented in [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/printSimpleBondDeploymentChecklist.js#L63)
- [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/deploy.js#L11) deploys `SimpleBondV4`, preserves the existing deploy logs, and then forwards `network`, `contractName`, `address`, `txHash`, and `blockNumber` into the helper at [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/deploy.js#L28).
- The repo's actual product/runtime surface matches the helper's warning text:
  - [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/frontend/index.html#L896) has active `SimpleBondV4` contract addresses only for Gnosis and Polygon, while Ethereum is explicitly `contract: null` at [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/frontend/index.html#L943)
  - [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/backend/config.mjs#L34) only defines confirmation and watcher config for chain IDs `100` and `137`
  - [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/README.md#L158) only publishes canonical `SimpleBondV4` addresses for Gnosis and Polygon
  - [`hardhat.config.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/hardhat.config.js#L78) exposes a wider deploy surface (`base`, `polygon`, `ethereum`, `gnosis`, `hardhat`), so the helper's narrower runtime warning is necessary and correct

## Verification Performed

I directly ran the checklist helper with representative inputs:

1. `node scripts/printSimpleBondDeploymentChecklist.js --network gnosis --address 0x000000000000000000000000000000000000c0de --tx-hash 0xtxhash --block-number 123456`
2. `node scripts/printSimpleBondDeploymentChecklist.js --network ethereum --address 0x000000000000000000000000000000000000dEaD --tx-hash 0xeth --block-number 999`
3. `node scripts/printSimpleBondDeploymentChecklist.js --network hardhat --address 0x000000000000000000000000000000000000f00d --tx-hash 0xlocal --block-number 111`

Those runs confirmed:

- `gnosis` prints `npx hardhat verify --network gnosis <address>` and points to all three repo files
- `ethereum` prints `npx hardhat verify --network ethereum <address>` but then warns that frontend/backend runtime config is only active for Gnosis and Polygon
- `hardhat` prints the local-network "skip explorer verification" message instead of a public verify command

## Verification Gaps

End-to-end deploy-path execution could not be completed in this worktree:

- `npm test -- --grep "deploy.js"` failed because the `test` script resolves to `hardhat test`, but there is no local `hardhat` binary in this checkout
- `npx hardhat test --grep "deploy.js"` and `npx hardhat run scripts/deploy.js --network hardhat` both failed with `HHE22`, indicating `npx` fell back to a non-local Hardhat install
- importing [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/deploy.js#L1) under plain `node` also fails in this worktree because `require("hardhat")` cannot be resolved

So the deploy-flow wiring was verified by source inspection, and the checklist text was verified by direct helper execution, but the actual `hardhat run scripts/deploy.js ...` path remains unexecuted here because dependencies are missing.

## Recommended Approach

1. Treat the current code as already satisfying the functional requirement unless a maintainer wants stronger automated proof.
2. If full runtime verification is required later, restore/install local dependencies and then run `npx hardhat run scripts/deploy.js --network hardhat` to confirm the normal deploy flow prints the checklist after the existing metadata logs.
3. If follow-up hardening is desired, add direct output tests for [`scripts/printSimpleBondDeploymentChecklist.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/printSimpleBondDeploymentChecklist.js#L12), because the existing [`test/deployScript.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/test/deployScript.test.js#L1) only verifies argument plumbing into the helper and does not assert the checklist text itself.

## Risks And Assumptions

- The verification command is correct only as long as [`scripts/deploy.js`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/scripts/deploy.js#L12) continues deploying `SimpleBondV4` with no constructor arguments.
- The largest correctness risk is accidental regression in checklist wording, not deploy behavior. Current automated coverage does not lock down the actual text branches for `gnosis`, `polygon`, `ethereum`/`base`, and `hardhat`.
- This task does not appear to require product-code changes in [`frontend/index.html`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/frontend/index.html), [`backend/config.mjs`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/backend/config.mjs), or [`README.md`](/tmp/temporal-worktrees/task-temporal-fleet-1ko-r4-verify-simplebond-checklist-guidance/README.md); it is a verification pass over the already-updated deployment guidance.
