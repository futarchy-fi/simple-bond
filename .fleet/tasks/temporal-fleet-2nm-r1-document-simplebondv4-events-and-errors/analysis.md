# temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors Analysis: add NatSpec to `SimpleBondV4` events and custom error

## Summary

This is a narrow documentation-only Solidity task in [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L1).

The requested change is to document the custom error at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L33) and the currently undocumented event surface at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L73), with special care for the overloaded `BondCreated` events so generated docs clearly distinguish the full-detail emission from the short-form lifecycle emission.

No ABI, storage, behavior, or test logic should need to change. This should be a comment-only patch.

## Current State

- `InsufficientChallengeAmount(uint256 challengeAmount, uint256 judgeFee)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L33) has no NatSpec.
- The broad interface audit in [analysis/temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface.md](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/analysis/temporal-fleet-2nm-r1-audit-simplebondv4-interface-surface.md#L47) already identifies every event with no NatSpec in `SimpleBondV4`.
- The overloaded `BondCreated` declarations are both undocumented:
  - verbose overload at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L73)
  - short-form overload at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L87)
- Other events with no NatSpec today are:
  - `Challenged(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L94)
  - `BondChallenged(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L101)
  - `BondConceded(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L114)
  - `RuledForChallenger(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L119)
  - `RuledForPoster(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L126)
  - `ChallengeRefunded(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L133)
  - `BondWithdrawn(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L139)
  - `BondTimedOut(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L140)
  - `JudgeRegistered(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L143)
  - `JudgeDeregistered(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L144)
  - `JudgeFeeUpdated(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L145)
  - `BondRejectedByJudge(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L146)
- Two events already have partial NatSpec rather than no NatSpec:
  - `ClaimConceded(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L108)
  - `BondResolved(...)` at [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L117)

## Scope Interpretation

There is one small wording ambiguity between the ticket title and description.

Minimal interpretation:

- document `InsufficientChallengeAmount`
- add NatSpec only to events that are fully undocumented today
- leave `ClaimConceded` and `BondResolved` as-is because they already have `@notice`

Safer interpretation:

- document `InsufficientChallengeAmount`
- add full NatSpec blocks to the fully undocumented events
- also finish the partial event docs for `ClaimConceded` and `BondResolved` so the event surface is internally consistent

The safer interpretation is better unless the task owner explicitly wants the smallest possible diff. The title says "events and custom errors", and generated interface docs are usually more useful when every event has both a short description and parameter-level tags.

## Recommended Approach

1. Update only [contracts/SimpleBondV4.sol](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/contracts/SimpleBondV4.sol#L1).
2. Add a NatSpec block above `InsufficientChallengeAmount(...)` that explains the revert condition already enforced in `createBond(...)`: the challenge deposit must be at least as large as the configured judge fee.
3. Add NatSpec to each currently undocumented event, using wording that matches the existing runtime behavior rather than introducing new terminology.
4. For the overloaded `BondCreated` events, use deliberately different `@notice` text:
   - one block should describe the verbose creation event that includes judge, fee, timing, and metadata details
   - the other should describe the short-form summary event emitted alongside it for lightweight lifecycle tracking
5. Add `@param` tags for every event and the custom error. The audit file already lists the missing parameter names and can be followed directly.
6. Prefer concise wording over long prose. These comments are for generated interface docs, not for restating implementation details already obvious from the function bodies.
7. If keeping the patch tight matters, do not rename parameters, reorder declarations, or touch tests.

## Suggested Documentation Targets

- For `InsufficientChallengeAmount(...)`:
  - explain that bond creation reverts when `judgeFee > challengeAmount`
  - describe `challengeAmount` as the proposed challenger deposit
  - describe `judgeFee` as the requested maximum fee for each ruling
- For the verbose `BondCreated(...)` overload:
  - make it explicit that this is the full-detail creation emission
  - mention that it includes the judge, economics, timing windows, and metadata
- For the short-form `BondCreated(...)` overload:
  - make it explicit that this is the compact creation summary
  - refer to `amount` as the posted bond amount so it does not read like a duplicate of the verbose event
- For the state-transition and registry events:
  - use simple action-oriented notices such as "Emitted when..." so the generated docs scan cleanly

## Verification Plan

This should be verified with a compile pass only.

Recommended steps after the NatSpec patch:

1. `npm install`
2. `npm run compile`

Current worktree note:

- [package.json](/tmp/temporal-worktrees/task-temporal-fleet-2nm-r1-document-simplebondv4-events-and-errors/package.json#L1) defines the `compile` script.
- `node_modules/` is currently absent in this checkout, so compile verification is not immediately runnable without installing dependencies first.

## Risk Notes

- The main risk is overshooting a narrow documentation ticket and turning it into a broader interface-doc cleanup. If review scope matters, keep the patch limited to the custom error and event declarations.
- The overloaded `BondCreated` events are the one place where wording quality matters materially. If both notices are too similar, generated docs will still be confusing even though NatSpec exists.
- This task should not change any signatures, event names, indexed fields, or emit sites. Any such change would be a regression for a documentation-only patch.
