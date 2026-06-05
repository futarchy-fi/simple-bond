# SimpleBond v0.7 Core Spec

`SimpleBondV7` = `SimpleBondV6` (see `SPEC_V06.md`) plus two UX-motivated mechanism
changes. It is a NEW contract (`contracts/core/SimpleBondV7.sol`); v0.6 stays
deployed until an explicit cutover. Designed by the autonomous loop's v0.7 design
pass (3 lenses + security scoring); ships **testnet-first** (Sepolia) before any
mainnet cutover.

## Changes from v0.6

### C1 — pending-cap `maxChallenges`
`challenge()` gates on the number of **currently-pending** challenges, not total-ever:

```solidity
// v0.6: require(challenges[bondId].length < b.maxChallenges, "Max challenges reached");
require(b.pendingCount < b.maxChallenges, "Max pending challenges reached");
```

The `challenges[]` array stays append-only (`challengeIndex = challenges[bondId].length`),
so per-index event/indexer snapshots are unchanged; only the CAP semantics change —
it now bounds the LIVE set, not lifetime filings. `getChallengeCount` becomes
cumulative and may exceed `maxChallenges`. **Why:** today, once `maxChallenges`
challenges have ever been filed, no one can challenge again even if all were
rejected/resolved — legitimate challengers are permanently locked out by
spam-then-reject. The UI already gates on `pendingCount`, so v0.6 shows the form
then reverts on submit.

Plus a hard ceiling in core `createBond` (the key safety lock for C2's settle loop):

```solidity
uint256 public constant MAX_CHALLENGES_CEILING = 100;
require(maxChallenges <= MAX_CHALLENGES_CEILING, "maxChallenges too large");
```

### C2 — per-address pull-payment credit ledger
Replaces the shared `claimRefunds(bondId, maxCount)` drain with a credit ledger:

- Storage: `mapping(address => mapping(address => uint256)) public credits;` keyed
  `[recipient][token]` (NOT flat — a flat map corrupts cross-token accounting since
  the directory may approve multiple tokens). Remove `refundCursor` / `claimRefunds`.
- Internal effects-only `_credit(token, to, amount, bondId, i)`: accumulates and emits
  `Credited`. No external call, so credit sites need no guard.
- `claim(address token) external nonReentrant` — strict CEI: read balance, require >0,
  **zero before transfer**, emit `Claimed`, then `safeTransfer`. OZ `ReentrancyGuard`
  as belt-and-suspenders on a value contract.
- Outbound value to **untrusted** recipients becomes a credit: `rejectChallenge`,
  `concede`, `ruleForPoster` (poster share), `ruleForChallenger` (winner + all other
  pending losers), `rejectBond` (poster + pending), `claimTimeout` (poster + pending),
  `withdrawBond` (poster). Settlement credits ALL still-pending challengers in a loop
  bounded by `MAX_CHALLENGES_CEILING`.
- **Stays a direct transfer:** inbound `transferFrom` (createBond, challenge); the
  `claim()` payout; and the **judge fee** (inline `safeTransfer(b.judge, feeCharged)` —
  the judge is a vetted contract; crediting it would strand fees and break the deployed
  `ManualJudgeV6.withdrawFees` push model). V7 is honestly "mixed inline + pull."

**Events:** add `Credited(token indexed, recipient indexed, bondId indexed, challengeIndex, amount)`
and `Claimed(token indexed, recipient indexed, amount)`. Remove `ChallengeRefunded`
(superseded). Keep all other v0.6 events.

**Behavioral trade accepted:** conceded/rejected challengers must now call `claim()`
(and pay gas) for money v0.6 pushed automatically — the cost of one source of truth
(`credits()`). The detail-page affordance flips: a conceded challenger now shows a
claimable credit.

## Invariants (all tested)
1. **C1 pending-cap (unsettled scope):** for any unsettled bond, `pendingCount <= maxChallenges`
   and `pendingCount == count of Pending statuses`. After settlement the loop sweeps
   pendingCount to 0.
2. **Per-token conservation (tokens dwell until claimed):**
   `balanceOf(contract, token) == sum(unclaimed credits[*][token]) + sum(live-bond escrows for token) + judge-fees-not-yet-pushed`.
   (The v0.6 "balance == 0 after drain" tests are REWRITTEN, not ported.)
3. **No double-credit:** status flipped to terminal BEFORE `_credit`; settle loops skip
   already-terminal entries.
4. **Timeout liveness preserved:** `claimTimeout` still settles + credits the poster +
   pending, in a bounded loop.
5. **No stranded funds:** every pending challenger at settlement is credited (the bug to
   avoid: deleting `claimRefunds` without crediting leftovers traps funds forever).

## Token assumption
Standard ERC-20: **no fee-on-transfer, no rebasing** (carried from v0.6 and now
ENFORCED — the credit model makes fee-on-transfer more dangerous, surfacing a shortfall
later against a different claimant). Launch gated to whitelisted tokens (sUSDS); a
fee-on-transfer mock test must show clean revert/exclusion.

## Unsafe options to AVOID (from the security lens)
- Crediting the judge fee (strands fees; breaks deployed `ManualJudgeV6`).
- A settle-time loop WITHOUT the core `maxChallenges` ceiling (gas-bomb DoS →
  permanently unsettleable bonds — worse than v0.6).
- A flat `mapping(address=>uint256)` credit ledger (cross-token corruption).
- Adding `bondVersion:7` to a chain without restructuring `abiForChain`
  (`backend/config.mjs` falls through to the V5 ABI → `Credited` never decoded →
  owed-funds emails silently stop).
- Leaving the v0.6 drain card (`computeRefunds` + `claimRefunds`) live on a V7 bond
  (the button calls a nonexistent method and reverts).

## Rollout (testnet-first)
C1 (smallest) implemented + fully tested first, then C2, then a fresh isolated V7
stack deployed on **Sepolia**, capability-verified there (C1 lockout-fix, concede→credit→claim,
multi-pending settle→each claims exactly), then cutover (frontend ABI/runtime-config +
backend indexer ABI/events + the A4 refunds UI → per-address `claim()`). Mainnet is a
separate later gate. See `docs/autoloop/roadmap.json` C1/C2 and the v0.7 plan.
