# temporal-fleet-2nm Analysis: add interface documentation to `SimpleBondV4`

## Summary

This is a documentation-only Solidity task in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L1).

`SimpleBondV4` already has a contract-level NatSpec block and decent coverage on the core mutating entrypoints, but the public ABI surface is still inconsistent. Several generated getters have no NatSpec at all, multiple explicit public/view functions are missing `@param` and `@return` tags, and most events and the custom error remain undocumented.

The safest interpretation of "interface documentation" is: document every externally consumed ABI item in this contract without changing behavior, storage, or signatures.

## Current State

- [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L7) already has a strong top-level contract summary that explains the v4 model and its major differences from v3.
- The main write entrypoints already have at least partial NatSpec:
  - [`registerAsJudge()`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L154)
  - [`deregisterAsJudge()`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L163)
  - [`setJudgeFee(address,uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L175)
  - [`setJudgeFees(address[],uint256[])`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L187)
  - [`rejectBond(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L203)
  - [`createBond(...)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L241)
  - [`challenge(uint256,string)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L305)
  - [`concede(uint256,string)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L341)
  - [`ruleForChallenger(uint256,uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L374)
  - [`ruleForPoster(uint256,uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L414)
- That said, several of those blocks are incomplete as interface docs:
  - [`createBond(...)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L241) names its return value in the signature but does not include an explicit `@return bondId`.
  - [`withdrawBond(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L453) has a `@notice` and `@dev`, but no `@param bondId`.
  - [`claimTimeout(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L474) has a `@notice`, but no `@param bondId`.
- The view/read surface is the largest gap:
  - [`getChallengeCount(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L497) has no NatSpec.
  - [`getChallenge(uint256,uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L502) has no NatSpec.
  - [`getJudgeMinFee(address,address)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L512) has only a one-line `@notice`, with no `@param` or `@return`.
  - [`rulingWindowStart(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L522) has a `@notice`, but no `@param` or `@return`.
  - [`rulingDeadline(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L530) has a `@notice`, but no `@param` or `@return`.
- Public state variables that generate ABI getters are also underdocumented:
  - [`nextBondId`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L64)
  - [`bonds`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L65)
  - [`challenges`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L66)
  - [`judges`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L67)
  - [`judgeMinFees`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L69) has a brief notice already, but could be made consistent with the rest of the getter surface.
- The event and error surface is inconsistent:
  - [`InsufficientChallengeAmount(uint256,uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L33) has no NatSpec.
  - Only [`ClaimConceded`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L108) and [`BondResolved`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L117) currently have event comments.
  - The overloaded [`BondCreated`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L73) and [`BondCreated`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L87) events are especially worth documenting distinctly so generated docs do not collapse them into ambiguous duplicates.

## Scope Interpretation

There is one small ambiguity in the ticket wording.

Minimal interpretation:

- add NatSpec only to explicit public/external functions and maybe fill missing tags on partially documented ones

Safer interpretation:

- treat "interface documentation" as the whole externally consumed ABI surface
- add NatSpec to explicit public/external functions
- add `/// @notice` comments to public state variables that generate getters
- document events and the custom error where they are still undocumented

The safer interpretation is the better fit for this contract. `SimpleBondV4` is consumed both directly and through adapters/frontends, and the undocumented generated getters are part of the interface just as much as the explicit functions are.

## Recommended Approach

1. Update [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L1) only. No tests, frontend files, or deployment artifacts should need changes.
2. Add concise NatSpec to the public getter surface:
   - add `/// @notice` comments to [`nextBondId`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L64), [`bonds`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L65), [`challenges`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L66), and [`judges`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L67).
   - keep [`judgeMinFees`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L69) aligned with the same style.
3. Complete the explicit function NatSpec where tags are missing:
   - add `@return bondId` to [`createBond(...)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L241)
   - add `@param bondId` to [`withdrawBond(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L453) and [`claimTimeout(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L474)
   - add full `@notice` / `@param` / `@return` blocks to [`getChallengeCount(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L497), [`getChallenge(uint256,uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L502), [`getJudgeMinFee(address,address)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L512), [`rulingWindowStart(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L522), and [`rulingDeadline(uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L530).
4. Document the remaining ABI declarations that wallets, indexers, and generated docs consume:
   - add a NatSpec block for [`InsufficientChallengeAmount(uint256,uint256)`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L33)
   - add short `@notice` comments to the currently undocumented events, especially both [`BondCreated`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L73) overloads
5. Keep the wording tightly aligned with the actual semantics already encoded in the contract:
   - bonds are revocable until challenged
   - challenge queues are FIFO
   - judges can waive part of their fee
   - timeout refunds both poster and pending challengers
   - `judges(...)` returns registration state, not broader reputation or configuration data

## Verification Plan

This should be a compile-only verification pass. NatSpec changes should not require test changes unless a linter or doc-generation check exists elsewhere.

Recommended verification after the documentation patch lands:

1. `npm install`
2. `npm run compile`

Current worktree note:

- [`package.json`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/package.json#L1) defines a `compile` script.
- `node_modules/` is currently absent in this checkout, so compile verification is not immediately runnable without installing dependencies first.

## Risk Notes

- The main risk is scope drift: mixing a NatSpec pass with behavioral cleanups would make review noisier for no benefit.
- Generated getter documentation needs to be precise. For example, [`judges`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L67) exposes only the `JudgeInfo.registered` flag, and [`challenges`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L66) exposes indexed queue entries rather than aggregate challenge history.
- The overloaded [`BondCreated`](/tmp/temporal-worktrees/task-temporal-fleet-2nm/contracts/SimpleBondV4.sol#L73) events need distinct wording so the short-form lifecycle event and the full-form event remain understandable in generated docs.
- No ABI or storage changes are needed here. If any signature or visibility changes appear in the implementation diff, that would be a regression for a documentation-only task.
