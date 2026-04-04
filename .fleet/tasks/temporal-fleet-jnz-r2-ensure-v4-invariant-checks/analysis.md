# temporal-fleet-jnz-r2-ensure-v4-invariant-checks Analysis

## Summary

This is a verification-only task on the current branch. The requested example-based invariant coverage is already present in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r2-ensure-v4-invariant-checks/test/SimpleBondV4.test.js).

The three requested checks are already covered:

- fixed bond pool after a poster win: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r2-ensure-v4-invariant-checks/test/SimpleBondV4.test.js#L949) asserts that `ruleForPoster` leaves exactly `BOND_AMOUNT` in the contract
- stable bond/challenge/judge-fee thresholds across queued challenges: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r2-ensure-v4-invariant-checks/test/SimpleBondV4.test.js#L1147) checks successive poster-favorable rulings in the queue and then re-reads `bondAmount`, `challengeAmount`, and `judgeFee`
- total-token conservation: [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r2-ensure-v4-invariant-checks/test/SimpleBondV4.test.js#L1344) sums balances across actors plus the bond contract before and after challenge/ruling transitions

## Relevant Code Reading

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r2-ensure-v4-invariant-checks/contracts/SimpleBondV4.sol#L265) stores `bondAmount`, `challengeAmount`, and `judgeFee` when the bond is created.
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r2-ensure-v4-invariant-checks/contracts/SimpleBondV4.sol#L414) resolves a challenge for the poster by paying out only from the active challenge escrow and advancing `currentChallenge`; it does not rewrite the threshold fields.
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-jnz-r2-ensure-v4-invariant-checks/contracts/SimpleBondV4.sol#L374) resolves for the challenger by paying `bondAmount + challengeAmount - feeCharged` and refunding remaining queued challengers, which matches the accounting assumptions in the tests.

## Interpretation

The task wording matches the existing Hardhat example style used in this repository. It does not appear to call for a new property-testing harness or contract changes. The current suite already expresses the invariants as scenario assertions, including the "Robin's invariant" naming used elsewhere in the file.

Because the coverage is already present, the correct implementation approach for this node is:

1. verify the existing tests map to the requested invariants
2. avoid changing `contracts/SimpleBondV4.sol`
3. avoid duplicating tests unless runtime verification exposes a real gap

## Verification Status

I confirmed the coverage by reading the current sources, but runtime verification is blocked in this worktree because local Hardhat dependencies are not installed. Running `npx hardhat test test/SimpleBondV4.test.js --grep "Sequential Challenge Queue|token accounting invariant"` fails with `HHE22` complaining about a non-local Hardhat installation.

Given the current repository state, this ticket should be treated as already satisfied and verification-only.
