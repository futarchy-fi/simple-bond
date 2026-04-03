# temporal-fleet-0ft-r1 Analysis: align `SimpleBondV4` revert tests with the new messages

## Summary

This is a narrow follow-on test task against [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/test/SimpleBondV4.test.js#L1). The source of truth for the replacement wording is already defined in [`analysis/temporal-fleet-0ft-r1-simplebondv4-message-catalog.md`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/analysis/temporal-fleet-0ft-r1-simplebondv4-message-catalog.md#L1), and this task should only update the test suite's exact-string `revertedWith(...)` expectations to match that catalog.

The current test file contains `54` exact-string revert assertions and `1` `revertedWithCustomError(...)` assertion. Based on the approved catalog:

- `43` exact-string assertions need new expected text
- `11` exact-string assertions stay unchanged
- the custom-error assertion for `InsufficientChallengeAmount(...)` stays unchanged

Because this task depends on the contract-side message rewrite, the safe implementation order is:

1. land the `require(...)` string updates in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L1)
2. then update the test expectations in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/test/SimpleBondV4.test.js#L1)

## Current Test Surface

Current exact-string assertion counts in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/test/SimpleBondV4.test.js#L1):

| Current expected string | Count | Planned result |
| --- | ---: | --- |
| `Bond does not exist` | 10 | unchanged |
| `Challenge does not exist` | 1 | unchanged |
| `Already settled` | 6 | update |
| `Before ruling deadline` | 1 | update |
| `Before ruling window` | 2 | update |
| `Deadline in past` | 1 | update |
| `Empty batch` | 1 | update |
| `Fee below judge minimum` | 2 | update |
| `Fee exceeds max` | 1 | update |
| `Judge not registered` | 2 | update |
| `Length mismatch` | 1 | update |
| `No pending challenges` | 1 | update |
| `Not registered` | 3 | update |
| `Only judge` | 8 | update |
| `Only poster` | 5 | update |
| `Past deadline` | 1 | update |
| `Past ruling deadline` | 1 | update |
| `Pending challenges` | 1 | update |
| `Ruling already started` | 1 | update |
| `Zero bond amount` | 1 | update |
| `Zero judge` | 1 | update |
| `Zero token` | 3 | update |

The unchanged expectations are exactly the assertions for:

- `Bond does not exist`
- `Challenge does not exist`

The custom-error assertion at [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/test/SimpleBondV4.test.js#L616) should remain as `revertedWithCustomError(bond, "InsufficientChallengeAmount")`.

## Replacement Mapping

The approved replacements from [`analysis/temporal-fleet-0ft-r1-simplebondv4-message-catalog.md`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/analysis/temporal-fleet-0ft-r1-simplebondv4-message-catalog.md#L24) that matter to the current tests are:

| Current expected string | New expected string |
| --- | --- |
| `Not registered` | `Caller is not a registered judge` |
| `Zero token` | `Token address cannot be zero` |
| `Length mismatch` | `Token and minimum fee array lengths must match` |
| `Empty batch` | `At least one token fee entry is required` |
| `Already settled` | `Bond is already settled` |
| `Only judge` | `Caller is not the judge for this bond` |
| `Zero bond amount` | `Bond amount must be greater than zero` |
| `Zero judge` | `Judge address cannot be zero` |
| `Deadline in past` | `Challenge deadline must be in the future` |
| `Judge not registered` | `Selected judge is not registered` |
| `Fee below judge minimum` | `Judge fee is below the selected judge's minimum for this token` |
| `Past deadline` | `Challenge deadline has passed` |
| `Only poster` | `Caller is not the poster for this bond` |
| `No pending challenges` | `Bond has no pending challenges` |
| `Ruling already started` | `Ruling has already started` |
| `Before ruling window` | `Ruling window has not opened` |
| `Past ruling deadline` | `Ruling deadline has passed` |
| `Fee exceeds max` | `Fee charged exceeds the bond's maximum judge fee` |
| `Pending challenges` | `Bond still has pending challenges` |
| `Before ruling deadline` | `Ruling deadline has not passed` |

## Ordering Constraints To Preserve

The main risk in this task is not the string replacement itself. It is accidentally changing which failure the tests are supposed to observe when multiple preconditions are false.

The implementation should preserve the same first-failing-condition expectations that the suite relies on today:

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L205) and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L342) check `!b.settled` before `!b.conceded`.
- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L307), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L377), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L417), [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L456), and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L477) also check `settled` before `conceded`.
- Since `concede(...)` sets both flags together at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L350), post-concession calls still surface the settled message first.

That means these tests should continue to expect the renamed settled message, not the new conceded message:

- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/test/SimpleBondV4.test.js#L400) `Reject Bond / reverts if already conceded`
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/test/SimpleBondV4.test.js#L728) `Challenges / reverts challenge on conceded bond`
- [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/test/SimpleBondV4.test.js#L827) `Poster Concession / reverts double concession`

Other ordering-sensitive checks that should stay aligned with the existing guard order:

- `setJudgeFees(...)` still prefers caller registration before array-shape validation at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L187)
- `concede(...)` still prefers caller authorization before `No pending challenges` and `Ruling already started` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L341)
- `withdrawBond(...)` still prefers caller authorization before `Pending challenges` at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L453)
- both ruling functions still prefer access-control and fee checks before the shared ruling-window checks at [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L374) and [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/contracts/SimpleBondV4.sol#L414)

## Recommended Implementation Plan

1. Use the final catalog in [`analysis/temporal-fleet-0ft-r1-simplebondv4-message-catalog.md`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/analysis/temporal-fleet-0ft-r1-simplebondv4-message-catalog.md#L24) as the only source of truth for replacement text.
2. Update the `43` changed `revertedWith(...)` literals in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-temporal-fleet-0ft-r1-update-simplebondv4-revert-tests/test/SimpleBondV4.test.js#L1).
3. Leave the `11` unchanged exact-string assertions alone:
   - all `Bond does not exist` expectations
   - the single `Challenge does not exist` expectation
4. Leave the `InsufficientChallengeAmount(...)` custom-error assertion untouched.
5. Do not add new coverage in this task unless explicitly requested. The current suite still does not directly assert the message sites for:
   - `Challenge amount must be greater than zero`
   - `Ruling buffer must be greater than zero`
   - `No pending challenge to rule on`
   - `Current challenge is not pending`
   - `Claim is already conceded`
6. Run the targeted V4 suite after the contract-side message rewrite and test update.

## Verification Notes

I attempted to run:

```bash
npx hardhat test test/SimpleBondV4.test.js
```

That did not execute in this worktree because Hardhat is not installed locally:

```text
Error HHE22: Trying to use a non-local installation of Hardhat, which is not supported.
```

So the verification step for the eventual implementation should assume dependencies need to be installed first, or should run in an environment where the repository already has its local Hardhat toolchain available.
