# temporal-fleet-0ft-r1 Analysis: define the `SimpleBondV4` replacement error-message catalog

## Summary

- `contracts/SimpleBondV4.sol` currently has `28` distinct string revert messages, plus the existing `InsufficientChallengeAmount(uint256 challengeAmount, uint256 judgeFee)` custom error.
- The main wording problems are consistency, not coverage:
  - several messages are terse and subjectless (`Only judge`, `Already settled`, `Zero token`)
  - the same `b.conceded` condition uses two different strings today (`Already conceded` and `Claim conceded`)
  - time-window checks are not phrased as a clean pair (`Before ruling window`, `Past ruling deadline`, `Before ruling deadline`)
- The lowest-risk catalog is to standardize the wording without changing check order. In particular, the `settled` checks must stay ahead of the `conceded` checks everywhere they do today, so the conceded-state messages remain defined in source even though they are masked in normal post-concession execution.
- `InsufficientChallengeAmount(...)` should remain exactly as-is and should not be replaced with a string revert.

## Recommended wording rules

- Use sentence case with no trailing punctuation.
- Use explicit subjects for access control and state checks.
- Use `must` / `cannot` for invalid caller-supplied inputs.
- Use `is already ...` for terminal state.
- Use `has passed` / `has not ...` for time gates.
- Reuse the same final wording for the same semantic condition whether the check is inline or helper-backed.

## Final catalog

All source-site numbers below refer to `contracts/SimpleBondV4.sol`.

| Current string(s) | Final wording | Source sites | Notes |
| --- | --- | --- | --- |
| `Not registered` | `Caller is not a registered judge` | `164`, `176`, `188` | Applies to `deregisterAsJudge`, `setJudgeFee`, `setJudgeFees`. |
| `Zero token` | `Token address cannot be zero` | `177`, `192`, `514` | Shared across registry setters and `getJudgeMinFee`. |
| `Length mismatch` | `Token and minimum fee array lengths must match` | `189` | Batch setter only. |
| `Empty batch` | `At least one token fee entry is required` | `190` | Batch setter only. |
| `Bond does not exist` | `Bond does not exist` | `205`, `307`, `544` | Already explicit; keep unchanged across inline and helper-backed sites. |
| `Already settled` | `Bond is already settled` | `206`, `308`, `344`, `377`, `417`, `456`, `477` | Must stay earlier than the conceded checks to preserve current behavior. |
| `Already conceded`, `Claim conceded` | `Claim is already conceded` | `207`, `309`, `345`, `378`, `418`, `457`, `478` | Collapse both current variants into one phrase. All currently remain masked by the earlier settled check in normal post-concession flows. |
| `Only judge` | `Caller is not the judge for this bond` | `208`, `379`, `419` | Shared across rejection and ruling flows. |
| `Zero bond amount` | `Bond amount must be greater than zero` | `252` | `createBond(...)` only. |
| `Zero challenge amount` | `Challenge amount must be greater than zero` | `253` | `createBond(...)` only. |
| `Zero judge` | `Judge address cannot be zero` | `254`, `513` | Shared across `createBond(...)` and `getJudgeMinFee(...)`. |
| `Deadline in past` | `Challenge deadline must be in the future` | `255` | `createBond(...)` only. |
| `Zero ruling buffer` | `Ruling buffer must be greater than zero` | `256` | `createBond(...)` only. |
| `InsufficientChallengeAmount(...)` | Unchanged custom error | `257` | Keep `InsufficientChallengeAmount(challengeAmount, judgeFee)` exactly as-is. |
| `Judge not registered` | `Selected judge is not registered` | `260` | `createBond(...)` only. Keep separate from the caller-registration message above. |
| `Fee below judge minimum` | `Judge fee is below the selected judge's minimum for this token` | `261` | `createBond(...)` only. |
| `Past deadline` | `Challenge deadline has passed` | `310` | `challenge(...)` only. |
| `Only poster` | `Caller is not the poster for this bond` | `346`, `458` | Shared across `concede(...)` and `withdrawBond(...)`. |
| `No pending challenges` | `Bond has no pending challenges` | `347`, `479` | Shared by `concede(...)` and `claimTimeout(...)`. |
| `Ruling already started` | `Ruling has already started` | `348` | `concede(...)` only. |
| `Fee exceeds max` | `Fee charged exceeds the bond's maximum judge fee` | `380`, `420` | Shared across both ruling functions. |
| `Before ruling window` | `Ruling window has not opened` | `551` | Emitted through `_requireRulingWindow(...)` for both ruling functions. |
| `Past ruling deadline` | `Ruling deadline has passed` | `552` | Emitted through `_requireRulingWindow(...)` for both ruling functions. |
| `No pending challenge` | `No pending challenge to rule on` | `384`, `424` | Shared across both ruling functions. Mostly reachable only after all queued challenges have already been resolved for the poster. |
| `Challenge not pending` | `Current challenge is not pending` | `386`, `426` | Shared across both ruling functions. This remains a defensive invariant check. |
| `Pending challenges` | `Bond still has pending challenges` | `459` | `withdrawBond(...)` only. Intentionally the opposite of `Bond has no pending challenges`. |
| `Before ruling deadline` | `Ruling deadline has not passed` | `482` | `claimTimeout(...)` only. |
| `Challenge does not exist` | `Challenge does not exist` | `506` | Already explicit; keep unchanged. |

## Validation-order constraints to preserve

- Keep `Bond does not exist` first anywhere it already appears before later state or access-control checks:
  - inline in `rejectBond(...)` and `challenge(...)`
  - through `_requireBondExists(...)` everywhere else
- Keep `Bond is already settled` ahead of `Claim is already conceded` in:
  - `rejectBond(...)`
  - `challenge(...)`
  - `concede(...)`
  - `ruleForChallenger(...)`
  - `ruleForPoster(...)`
  - `withdrawBond(...)`
  - `claimTimeout(...)`
- Keep `_requireRulingWindow(...)` wording identical for both ruling entrypoints.
- Keep the `_noPendingChallenges(...)`-based messages intentionally contextual:
  - `Bond has no pending challenges` when the caller requires at least one pending challenge
  - `Bond still has pending challenges` when the caller requires none
- Keep `InsufficientChallengeAmount(challengeAmount, judgeFee)` unchanged and in the same position between the `rulingBuffer` check and the judge-registry checks in `createBond(...)`.

## Practical impact on future implementation

- The implementation can update revert strings mechanically once this catalog is accepted.
- The only semantic collapse recommended here is the conceded-state pair:
  - `Already conceded`
  - `Claim conceded`
  - both should become `Claim is already conceded`
- No helper extraction or validation reordering is required by this catalog.
- If the later implementation wants every final string to be directly test-covered, it should add exact-site assertions for the currently unasserted cases identified in `analysis/sh-006-simplebondv4-revert-surface.md`, especially:
  - `Challenge amount must be greater than zero`
  - `Ruling buffer must be greater than zero`
  - `No pending challenge to rule on`
  - `Current challenge is not pending`
  - the `ruleForChallenger(...)` sites that currently rely on coverage through `ruleForPoster(...)`

## Verification

- Ran `npm ci`
- Ran `npx hardhat test test/SimpleBondV4.test.js`
- Result: `126 passing`
