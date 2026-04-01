# sb-002 Analysis: deadline check for `requestArbitration`

## Summary

`KlerosJudge.requestArbitration(uint256 bondId)` currently allows a caller to open a Kleros dispute even after the corresponding `SimpleBondV4` ruling deadline has already passed.

That creates a dead-end payment path:

- `requestArbitration()` accepts ETH/xDAI, creates the Kleros dispute, and stores it.
- `executeRuling()` later checks `simpleBond.rulingDeadline(bondId)` and reverts with `"Past ruling deadline"` if the bond is already past deadline.
- `SimpleBondV4.claimTimeout()` remains available after that deadline, so the bond can be refunded while the Kleros dispute can never be executed on-chain.

This matches the audit context in `~/shared/docs/simple-bond-pro-audit.txt`: users can pay arbitration cost into a dispute that is impossible to execute.

## Current Code Path

Relevant locations:

- `contracts/KlerosJudge.sol:142`
  - `requestArbitration()` validates pending challenge / caller, prevents duplicate disputes, checks arbitration fee, then creates the Kleros dispute.
- `contracts/KlerosJudge.sol:214`
  - `executeRuling()` already enforces `block.timestamp <= simpleBond.rulingDeadline(bondId)`.
- `contracts/SimpleBondV4.sol:474`
  - `rulingDeadline(bondId)` exposes the deadline used by `executeRuling()`.
- `test/KlerosJudge.test.js:718`
  - Existing timeout fallback test already demonstrates that arbitration can be requested and the bond can still later timeout.

## Recommended Change

Add the requested guard in `KlerosJudge.requestArbitration()`:

```solidity
require(block.timestamp <= simpleBond.rulingDeadline(bondId), "Bond past ruling deadline");
```

### Preferred placement

Place it:

1. After `_validateAndGetChallenge(bondId)`, so the function still fails early for invalid bond state / no pending challenge / unauthorized caller.
2. After the duplicate-dispute check, to preserve the existing `"Dispute already exists"` revert for that case.
3. Before `arbitrationCost()` and `createDispute(...)`, so no arbitration fee lookup or dispute creation happens for a dead bond.

That yields this effective order:

1. validate bond/challenge/caller
2. reject duplicate dispute
3. reject past-deadline dispute request
4. compute cost and create dispute

## Test Plan

Add one regression test under `describe("requestArbitration", ...)` in `test/KlerosJudge.test.js`:

- create default bond
- challenge it
- advance past `bond.rulingDeadline(bondId)` using the existing `advancePastRulingDeadline(bondId)` helper
- expect `requestArbitration()` to revert with:
  - `"Bond past ruling deadline"`

This is the minimal test needed to cover the new requirement.

## Compatibility / Risk Notes

- This is a narrow behavior change.
- It does not affect successful arbitration requests during the valid ruling period.
- It aligns `requestArbitration()` with the deadline assumptions already enforced by `executeRuling()`.
- It prevents users from paying into disputes that cannot be executed against `SimpleBondV4`.

## Implementation Scope

Expected code change surface:

- `contracts/KlerosJudge.sol`
- `test/KlerosJudge.test.js`

No interface changes are required because `ISimpleBondV4` already exposes `rulingDeadline(uint256)`.
