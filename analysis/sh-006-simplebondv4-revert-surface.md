# sh-006 Analysis: audit current `SimpleBondV4` revert surface

## Summary

- `contracts/SimpleBondV4.sol` currently has `53` string-based `require(...)` sites covering `28` distinct revert strings.
- There is also one non-string revert in scope for neighboring behavior: `InsufficientChallengeAmount` in `createBond(...)` at `contracts/SimpleBondV4.sol:257`.
- The current V4 test suite asserts `22` of the `28` distinct strings somewhere in `test/SimpleBondV4.test.js`.
- The six distinct strings that are not asserted anywhere today are:
  - `Already conceded`
  - `Claim conceded`
  - `Zero challenge amount`
  - `Zero ruling buffer`
  - `No pending challenge`
  - `Challenge not pending`
- Message-level coverage is broader than exact call-site coverage. Several strings are asserted through one function but not through every site that emits the same message.

## Shared Helper Checks

### `_requireBondExists(uint256 bondId)` at `contracts/SimpleBondV4.sol:543`

Shared revert:

- `Bond does not exist`

Called by:

- `concede(...)` at `contracts/SimpleBondV4.sol:342`
- `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:375`
- `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:415`
- `withdrawBond(...)` at `contracts/SimpleBondV4.sol:454`
- `claimTimeout(...)` at `contracts/SimpleBondV4.sol:475`
- `getChallengeCount(...)` at `contracts/SimpleBondV4.sol:498`
- `getChallenge(...)` at `contracts/SimpleBondV4.sol:505`
- `rulingWindowStart(...)` at `contracts/SimpleBondV4.sol:523`
- `rulingDeadline(...)` at `contracts/SimpleBondV4.sol:531`

Notes:

- `rejectBond(...)` and `challenge(...)` duplicate the same existence check inline instead of using the helper.
- The suite covers every helper-backed external/view call site except `challenge(...)`'s inline existence check.

### `_requireRulingWindow(uint256 bondId)` at `contracts/SimpleBondV4.sol:547`

Shared reverts:

- `Before ruling window`
- `Past ruling deadline`

Called by:

- `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:381`
- `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:421`

Notes:

- Current tests only hit these helper reverts through `ruleForPoster(...)`, not through `ruleForChallenger(...)`.

### `_noPendingChallenges(uint256 bondId)` at `contracts/SimpleBondV4.sol:563`

This helper returns a boolean and is reused with different messages:

- `concede(...)` at `contracts/SimpleBondV4.sol:347` reverts with `No pending challenges` when the helper returns `true`
- `withdrawBond(...)` at `contracts/SimpleBondV4.sol:459` reverts with `Pending challenges` when the helper returns `false`
- `claimTimeout(...)` at `contracts/SimpleBondV4.sol:479` reverts with `No pending challenges` when the helper returns `true`

Notes:

- The suite covers the `concede(...)` and `withdrawBond(...)` uses directly.
- The `claimTimeout(...)` use is currently unasserted at the exact site.

## Revert String Matrix

### `Not registered`

Source sites:

- `deregisterAsJudge(...)` at `contracts/SimpleBondV4.sol:164`
- `setJudgeFee(...)` at `contracts/SimpleBondV4.sol:176`
- `setJudgeFees(...)` at `contracts/SimpleBondV4.sol:188`

Current asserting tests:

- `Judge Registry / reverts deregister if not registered` at `test/SimpleBondV4.test.js:140`
- `Judge Registry / reverts setJudgeFee if not registered` at `test/SimpleBondV4.test.js:146`
- `Judge Registry / batch setJudgeFees reverts if not registered` at `test/SimpleBondV4.test.js:212`

### `Zero token`

Source sites:

- `setJudgeFee(...)` at `contracts/SimpleBondV4.sol:177`
- `setJudgeFees(...)` at `contracts/SimpleBondV4.sol:192`
- `getJudgeMinFee(...)` at `contracts/SimpleBondV4.sol:514`

Current asserting tests:

- `Judge Registry / reverts setJudgeFee for zero token address` at `test/SimpleBondV4.test.js:152`
- `Judge Registry / batch setJudgeFees reverts for zero token address` at `test/SimpleBondV4.test.js:218`
- `View Helpers / getJudgeMinFee reverts for a zero token address` at `test/SimpleBondV4.test.js:513`

### `Length mismatch`

Source site:

- `setJudgeFees(...)` at `contracts/SimpleBondV4.sol:189`

Current asserting test:

- `Judge Registry / batch setJudgeFees reverts on length mismatch` at `test/SimpleBondV4.test.js:198`

### `Empty batch`

Source site:

- `setJudgeFees(...)` at `contracts/SimpleBondV4.sol:190`

Current asserting test:

- `Judge Registry / batch setJudgeFees reverts on empty batch` at `test/SimpleBondV4.test.js:205`

### `Bond does not exist`

Source sites:

- `rejectBond(...)` at `contracts/SimpleBondV4.sol:205`
- `challenge(...)` at `contracts/SimpleBondV4.sol:307`
- `_requireBondExists(...)` at `contracts/SimpleBondV4.sol:544`

Current asserting tests:

- `Reject Bond / bond does not exist reverts` at `test/SimpleBondV4.test.js:434`
- `Invalid Settlement Bond IDs / concede reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:442`
- `Invalid Settlement Bond IDs / ruleForPoster reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:448`
- `Invalid Settlement Bond IDs / ruleForChallenger reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:454`
- `Invalid Settlement Bond IDs / withdrawBond reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:460`
- `Invalid Settlement Bond IDs / claimTimeout reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:466`
- `View Helpers / getChallengeCount reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:474`
- `View Helpers / getChallenge reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:480`
- `View Helpers / rulingWindowStart reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:495`
- `View Helpers / rulingDeadline reverts for a nonexistent bond` at `test/SimpleBondV4.test.js:501`

Notes:

- `challenge(...)`'s inline existence check is not covered directly by a `challenge(unknownBondId)` test.

### `Already settled`

Source sites:

- `rejectBond(...)` at `contracts/SimpleBondV4.sol:206`
- `challenge(...)` at `contracts/SimpleBondV4.sol:308`
- `concede(...)` at `contracts/SimpleBondV4.sol:344`
- `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:377`
- `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:417`
- `withdrawBond(...)` at `contracts/SimpleBondV4.sol:456`
- `claimTimeout(...)` at `contracts/SimpleBondV4.sol:477`

Current asserting tests:

- `Reject Bond / reverts if already settled` at `test/SimpleBondV4.test.js:393`
- `Reject Bond / reverts if already conceded` at `test/SimpleBondV4.test.js:400`
- `Challenges / reverts challenge on settled bond` at `test/SimpleBondV4.test.js:721`
- `Challenges / reverts challenge on conceded bond` at `test/SimpleBondV4.test.js:728`
- `Poster Concession / reverts double concession` at `test/SimpleBondV4.test.js:827`
- `Poster Withdrawal / reverts double withdrawal` at `test/SimpleBondV4.test.js:1202`

Notes:

- The suite directly covers this message on `rejectBond(...)`, `challenge(...)`, `concede(...)`, and `withdrawBond(...)`.
- There is no exact-site assertion for `ruleForChallenger(...)`, `ruleForPoster(...)`, or `claimTimeout(...)` returning `Already settled`.

### `Already conceded`

Source sites:

- `rejectBond(...)` at `contracts/SimpleBondV4.sol:207`
- `concede(...)` at `contracts/SimpleBondV4.sol:345`

Current asserting tests:

- None

Notes:

- This string is currently masked by the earlier `require(!b.settled, "Already settled")` in both functions.
- `concede(...)` is the only code path that sets `b.conceded = true`, and it also sets `b.settled = true` in the same call at `contracts/SimpleBondV4.sol:350-351`.
- The test named `Reject Bond / reverts if already conceded` at `test/SimpleBondV4.test.js:400` confirms the observable revert is still `Already settled`.

### `Only judge`

Source sites:

- `rejectBond(...)` at `contracts/SimpleBondV4.sol:208`
- `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:379`
- `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:419`

Current asserting tests:

- `Reject Bond / reverts if not the judge` at `test/SimpleBondV4.test.js:384`
- `Access Control / only judge can call ruleForPoster` at `test/SimpleBondV4.test.js:1428`
- `Access Control / only judge can call ruleForChallenger` at `test/SimpleBondV4.test.js:1441`
- `Access Control / only judge can reject bond` at `test/SimpleBondV4.test.js:1465`

### `Zero bond amount`

Source site:

- `createBond(...)` at `contracts/SimpleBondV4.sol:252`

Current asserting test:

- `Bond Creation / createBond reverts when bondAmount is 0` at `test/SimpleBondV4.test.js:597`

### `Zero challenge amount`

Source site:

- `createBond(...)` at `contracts/SimpleBondV4.sol:253`

Current asserting tests:

- None

### `Zero judge`

Source sites:

- `createBond(...)` at `contracts/SimpleBondV4.sol:254`
- `getJudgeMinFee(...)` at `contracts/SimpleBondV4.sol:513`

Current asserting tests:

- `View Helpers / getJudgeMinFee reverts for a zero judge address` at `test/SimpleBondV4.test.js:507`

Notes:

- The message is covered somewhere in the suite, but there is no create-site assertion for `createBond(..., judge = address(0), ...)`.

### `Deadline in past`

Source site:

- `createBond(...)` at `contracts/SimpleBondV4.sol:255`

Current asserting test:

- `Bond Creation / reverts on deadline in the past` at `test/SimpleBondV4.test.js:640`

### `Zero ruling buffer`

Source site:

- `createBond(...)` at `contracts/SimpleBondV4.sol:256`

Current asserting tests:

- None

### `Judge not registered`

Source site:

- `createBond(...)` at `contracts/SimpleBondV4.sol:260`

Current asserting tests:

- `Bond Creation — Registry Checks / reverts if judge not registered` at `test/SimpleBondV4.test.js:231`
- `Bond Creation — Registry Checks / deregistered judge cannot be named on new bonds` at `test/SimpleBondV4.test.js:292`

### `Fee below judge minimum`

Source site:

- `createBond(...)` at `contracts/SimpleBondV4.sol:261`

Current asserting tests:

- `Bond Creation — Registry Checks / reverts if fee below judge minimum for that token` at `test/SimpleBondV4.test.js:242`
- `Bond Creation — Registry Checks / judge fee check is per-token: passes for token with no min, fails for token with high min` at `test/SimpleBondV4.test.js:316`

### `Claim conceded`

Source sites:

- `challenge(...)` at `contracts/SimpleBondV4.sol:309`
- `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:378`
- `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:418`
- `withdrawBond(...)` at `contracts/SimpleBondV4.sol:457`
- `claimTimeout(...)` at `contracts/SimpleBondV4.sol:478`

Current asserting tests:

- None

Notes:

- Like `Already conceded`, this message is currently masked by the earlier `Already settled` check in every caller above.
- The existing conceded-state test for `challenge(...)` at `test/SimpleBondV4.test.js:728` observes `Already settled`, not `Claim conceded`.

### `Past deadline`

Source site:

- `challenge(...)` at `contracts/SimpleBondV4.sol:310`

Current asserting test:

- `Challenges / reverts challengeBond after the deadline has passed` at `test/SimpleBondV4.test.js:711`

### `Only poster`

Source sites:

- `concede(...)` at `contracts/SimpleBondV4.sol:346`
- `withdrawBond(...)` at `contracts/SimpleBondV4.sol:458`

Current asserting tests:

- `Poster Concession / reverts if non-poster tries to concede` at `test/SimpleBondV4.test.js:802`
- `Poster Withdrawal / reverts withdrawal by non-poster` at `test/SimpleBondV4.test.js:1196`
- `Access Control / only poster can withdraw` at `test/SimpleBondV4.test.js:1448`
- `Access Control / only poster can concede` at `test/SimpleBondV4.test.js:1456`

### `No pending challenges`

Source sites:

- `concede(...)` at `contracts/SimpleBondV4.sol:347`
- `claimTimeout(...)` at `contracts/SimpleBondV4.sol:479`

Current asserting tests:

- `Poster Concession / reverts concession if no pending challenges` at `test/SimpleBondV4.test.js:809`

Notes:

- The `claimTimeout(...)` site is not directly asserted.

### `Ruling already started`

Source site:

- `concede(...)` at `contracts/SimpleBondV4.sol:348`

Current asserting test:

- `Poster Concession / reverts concession after judge has already ruled on first challenge` at `test/SimpleBondV4.test.js:815`

### `Fee exceeds max`

Source sites:

- `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:380`
- `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:420`

Current asserting tests:

- `Judge Fee Waiver / reverts if feeCharged exceeds max judgeFee` at `test/SimpleBondV4.test.js:1079`

Notes:

- Current coverage only hits `ruleForPoster(...)`. There is no exact-site assertion for `ruleForChallenger(...)`.

### `Before ruling window`

Source site:

- `_requireRulingWindow(...)` at `contracts/SimpleBondV4.sol:551`

Current asserting tests:

- `Acceptance Delay & Ruling Window / judge cannot rule before ruling window opens` at `test/SimpleBondV4.test.js:870`
- `Acceptance Delay & Ruling Window / poster can concede during acceptance delay (before judge can rule)` at `test/SimpleBondV4.test.js:891`

Notes:

- Both assertions hit the helper through `ruleForPoster(...)`.
- There is no exact `ruleForChallenger(...)` assertion for this helper message.

### `Past ruling deadline`

Source site:

- `_requireRulingWindow(...)` at `contracts/SimpleBondV4.sol:552`

Current asserting test:

- `Acceptance Delay & Ruling Window / judge cannot rule after ruling deadline` at `test/SimpleBondV4.test.js:877`

Notes:

- This assertion currently hits the helper through `ruleForPoster(...)`.
- There is no exact `ruleForChallenger(...)` assertion for this helper message.

### `No pending challenge`

Source sites:

- `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:384`
- `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:424`

Current asserting tests:

- None

Notes:

- This appears reachable after all queued challenges have already been resolved for the poster and the judge calls a ruling function again before the poster withdraws.
- It is not currently covered in either ruling function.

### `Challenge not pending`

Source sites:

- `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:386`
- `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:426`

Current asserting tests:

- None

Notes:

- Under the current public state machine this looks like a defensive invariant check rather than a practically reachable revert.
- `currentChallenge` only advances after marking the current challenge lost, and no code path leaves `currentChallenge` pointing at a non-pending challenge while the bond remains unsettled.

### `Pending challenges`

Source site:

- `withdrawBond(...)` at `contracts/SimpleBondV4.sol:459`

Current asserting test:

- `Poster Withdrawal / reverts withdrawal if challenges are pending` at `test/SimpleBondV4.test.js:1189`

### `Before ruling deadline`

Source site:

- `claimTimeout(...)` at `contracts/SimpleBondV4.sol:482`

Current asserting test:

- `Timeout / reverts timeout before ruling deadline` at `test/SimpleBondV4.test.js:1257`

### `Challenge does not exist`

Source site:

- `getChallenge(...)` at `contracts/SimpleBondV4.sol:506`

Current asserting test:

- `View Helpers / getChallenge reverts for an out-of-range challenge index` at `test/SimpleBondV4.test.js:486`

## Site-Specific Blind Spots

These are the source sites most likely to be missed if revert messages change and only the currently-existing assertions are updated:

- `createBond(...)`:
  - `Zero challenge amount` at `contracts/SimpleBondV4.sol:253`
  - `Zero judge` at `contracts/SimpleBondV4.sol:254` is only covered elsewhere through `getJudgeMinFee(...)`
  - `Zero ruling buffer` at `contracts/SimpleBondV4.sol:256`
- `challenge(...)`:
  - inline `Bond does not exist` at `contracts/SimpleBondV4.sol:307`
  - masked `Claim conceded` at `contracts/SimpleBondV4.sol:309`
- `ruleForChallenger(...)`:
  - `Already settled` at `contracts/SimpleBondV4.sol:377`
  - masked `Claim conceded` at `contracts/SimpleBondV4.sol:378`
  - `Fee exceeds max` at `contracts/SimpleBondV4.sol:380`
  - helper-driven `Before ruling window` and `Past ruling deadline` through `_requireRulingWindow(...)`
  - `No pending challenge` at `contracts/SimpleBondV4.sol:384`
  - `Challenge not pending` at `contracts/SimpleBondV4.sol:386`
- `ruleForPoster(...)`:
  - `Already settled` at `contracts/SimpleBondV4.sol:417`
  - masked `Claim conceded` at `contracts/SimpleBondV4.sol:418`
  - `No pending challenge` at `contracts/SimpleBondV4.sol:424`
  - `Challenge not pending` at `contracts/SimpleBondV4.sol:426`
- `withdrawBond(...)`:
  - masked `Claim conceded` at `contracts/SimpleBondV4.sol:457`
- `claimTimeout(...)`:
  - `Already settled` at `contracts/SimpleBondV4.sol:477`
  - masked `Claim conceded` at `contracts/SimpleBondV4.sol:478`
  - `No pending challenges` at `contracts/SimpleBondV4.sol:479`
- `rejectBond(...)`:
  - masked `Already conceded` at `contracts/SimpleBondV4.sol:207`
- `concede(...)`:
  - masked `Already conceded` at `contracts/SimpleBondV4.sol:345`

## Practical Takeaways For Message Changes

- Updating a unique string that is already asserted somewhere is usually straightforward, but duplicate strings need an exact-site review before changing them.
- `Already conceded` and `Claim conceded` are present in source but are not part of the current observable revert surface under normal execution because `Already settled` wins first.
- If the intent is to preserve exact observable behavior, the strings that most need new or updated tests before refactoring are:
  - `Zero challenge amount`
  - `Zero ruling buffer`
  - `Zero judge` on `createBond(...)`
  - `No pending challenge`
  - `Challenge not pending`
  - the `ruleForChallenger(...)` uses of `_requireRulingWindow(...)` and `Fee exceeds max`

## Verification

- Installed the repo's pinned dependencies with `npm ci`
- Ran `npx hardhat test test/SimpleBondV4.test.js`
- Result: `126 passing`
