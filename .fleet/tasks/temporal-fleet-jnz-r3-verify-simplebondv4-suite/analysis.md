# temporal-fleet-jnz-r3-verify-simplebondv4-suite Analysis

## Summary

This is a verification-only task on the current branch. The relevant Solidity and test inputs are unchanged from `main`: `git diff main...HEAD -- test/SimpleBondV4.test.js contracts/SimpleBondV4.sol test/SimpleBondV3.test.js hardhat.config.js package.json package-lock.json` is empty.

The correct verification surface is the full [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js) file, not a narrower grep-based subset. The three accounting invariants the task cares about are embedded inside the same suite that exercises the surrounding challenge-flow behavior, so a single-file Hardhat run is what proves both the invariant checks and the adjacent lifecycle coverage still pass together.

If `node_modules/` is missing in a fresh checkout, the only setup prerequisite is to install dependencies before running Hardhat.

## Relevant Coverage Already Present

The requested invariant checks already exist in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js):

- fixed bond pool after a poster win: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L949)
- stable bond/challenge/judge-fee thresholds across queued challenges: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L1147)
- total-token conservation across actors plus the bond contract: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L1344)

Those checks are surrounded by the challenge-flow sections that would reveal a regression in queue handling or settlement behavior:

- concession path: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L740)
- poster-favorable rulings: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L928)
- challenger-favorable rulings: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L986)
- sequential multi-challenger queue: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L1095)
- poster withdrawal after no pending challenges: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L1168)
- timeout unwinds: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L1213)
- end-to-end challenge scenarios, including anti-gaming and token conservation: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/test/SimpleBondV4.test.js#L1284)

That structure is why the single-file suite is enough for this task: if an invariant change breaks challenge progression, refunds, or settlement, the same run should fail in one of these adjacent describe blocks.

## Contract Paths Under Test

The suite maps directly to the V4 challenge lifecycle in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/SimpleBondV4.sol):

- rejection: [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/SimpleBondV4.sol#L203)
- challenge escrow entry: [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/SimpleBondV4.sol#L305)
- concession unwind: [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/SimpleBondV4.sol#L341)
- challenger win settlement: [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/SimpleBondV4.sol#L374)
- poster win settlement: [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/SimpleBondV4.sol#L414)
- poster withdrawal: [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/SimpleBondV4.sol#L453)
- timeout unwind: [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/SimpleBondV4.sol#L474)

These functions are exactly the ones exercised by the invariant and surrounding challenge-flow tests. No contract change is indicated by the current branch state.

## Runtime Verification

I executed the verification flow in this worktree:

1. `npx hardhat test test/SimpleBondV4.test.js`
2. `npx hardhat test`

Results:

- the targeted V4 suite passed unchanged with `126 passing (7s)`
- the full Hardhat suite passed with `256 passing (13s)`

That second run confirms the focused V4 verification did not regress the surrounding repo test surface.

Both runs recompiled the contracts successfully. The compilation emitted two non-blocking Solidity warnings in [`contracts/KlerosJudge.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r3-verify-simplebondv4-suite/contracts/KlerosJudge.sol) about functions whose mutability could be restricted to `pure`; those warnings do not affect this task’s verification result.

## Recommended Approach

For the implementation checkpoint associated with this task, the right plan is:

1. install local dependencies if `node_modules/` is missing
2. run `npx hardhat test test/SimpleBondV4.test.js`
3. treat the full-file pass as the acceptance signal for both the invariant checks and the surrounding challenge-flow coverage
4. avoid contract or test edits unless that targeted suite exposes a real failure

Based on the current codebase and the successful run above, this node is already satisfied as a verification-only task.
