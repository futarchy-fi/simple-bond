I now have full confirmation of every surface. I have everything needed to synthesize the deliverables.

---

# SimpleBondV7 — Lead Synthesis

All file paths under `/home/kelvin/repos/futarchy-fi/simple-bond/`. Verified against actual code: V6 line numbers, `ManualJudgeV6.withdrawFees` push-model, `abiForChain` binary ternary, `resolveRecipients` role-only resolution, runtime-config chain entries.

## Locked design decisions (resolving the open questions)

The three lenses agree on direction; the scorers flagged the same blocking conditions. I am locking these calls:

1. **Judge fee stays an inline push** (NOT credited). `ManualJudgeV6.withdrawFees` (ManualJudgeV6.sol:55-60) transfers the judge contract's *own* balance and has no `claim()` path. Crediting the fee strands all fees and forces a judge redeploy. Keep `IERC20(b.token).safeTransfer(b.judge, feeCharged)` inline (judge is a vetted contract via `validateBond`). **This means V7 is "mixed inline + pull," not a single exit — state it honestly; do not claim one transfer site.**
2. **Enforce a hard `maxChallenges` ceiling in CORE `createBond`** (`MAX_CHALLENGES_CEILING = 100`), NOT delegated to `validateBond` (which the deployed `ManualJudgeV6` ignores entirely — it checks only `active`). This makes the settle-time credit loop provably gas-bounded. Without it, a poster setting `maxChallenges = 10^6` bricks `ruleForChallenger`/`rejectBond`/`claimTimeout` — a liveness failure *worse* than v0.6. This is the single most important safety lock.
3. **Credit ledger is keyed `[recipient][token]`** — `mapping(address => mapping(address => uint256)) public credits;` — and `claim(address token)`. A flat `mapping(address=>uint256)` silently mixes tokens across bonds (OfficialBondDirectory can approve multiple tokens). Non-negotiable for correctness.
4. **Uniform pull for all OUTBOUND value to untrusted recipients**: rejectChallenge, concede, ruleForPoster(poster share), ruleForChallenger(winner + losers), rejectBond(poster + pending), claimTimeout(poster + pending), withdrawBond(poster) all become credits. Only INBOUND `transferFrom` (createBond, challenge), the OUTBOUND `claim()` transfer, and the inline judge-fee push remain as direct transfers.
5. **Settle-time credit loop** (bounded by the ceiling), NOT a deferred batch drain. `rejectBond`/`claimTimeout`/`ruleForChallenger` credit ALL still-Pending challengers at settlement. Delete `claimRefunds` and `refundCursor`. This eliminates the two-step UX and the no-skip cursor logic. (A bounded `creditPending(bondId,maxCount)` fallback is the documented Plan B *only if* the ceiling cannot be enforced — but the ceiling makes it unnecessary.)
6. **`claim()` uses strict CEI + `nonReentrant`** (OZ ReentrancyGuard; it's in node_modules and V6 has none today). CEI alone is sufficient; the guard is cheap defense-in-depth on a value contract.
7. **Conservation invariant restated for V7** (tokens dwell until claimed): `balanceOf(bond, token) == sum(unclaimed credits[*][token]) + sum(live-bond escrows for token) + judge-fees-not-yet-pushed`. The V6 "balance == 0 after drain" tests must be *rewritten*, not ported.
8. **Behavioral note to accept**: routing concede/rejectChallenge through credits means a conceded/rejected challenger must now call `claim()` (and pay gas) for money V6 pushed automatically. This is a deliberate UX trade for one source of truth (`credits()`); the A4 affordance flips (a conceded challenger now shows a claimable credit where V6 showed nothing). Accept it for uniformity.

**Unsafe options to AVOID:**
- Crediting the judge fee (strands fees, breaks deployed ManualJudgeV6).
- Settle-time loop WITHOUT the core-level `maxChallenges` ceiling (gas-bomb DoS, permanently unsettleable bonds).
- Flat `mapping(address=>uint256)` credit ledger (cross-token accounting corruption).
- Adding `bondVersion:7` to a chain without restructuring `abiForChain` (config.mjs:149-151 silently falls through to V5 ABI → Credited never decoded → owed-funds emails silently stop).
- Leaving the V6 drain card (`computeRefunds` + `claimRefunds`) live on a V7 bond (button calls a nonexistent method, reverts).

---

## (1) SPEC_V07 outline

Create `SPEC_V07.md` (clone `SPEC_V06.md`, resolve its Open-Question line in favor of pending-cap). Mechanism:

**C1 — pending-cap gate.** `challenge()` gate changes from `challenges[bondId].length < b.maxChallenges` to `b.pendingCount < b.maxChallenges`. The `challenges[]` array stays append-only (`challengeIndex = challenges[bondId].length`), so indexer per-index snapshots are unaffected; only the CAP semantics change (now bounds the live set, not lifetime filings). `getChallengeCount` becomes cumulative and can exceed `maxChallenges`.
- **Invariant (scoped):** for any UNSETTLED bond, `pendingCount <= maxChallenges` and `pendingCount == count of Pending statuses`. (After settlement, V7 zeroes pendingCount as the loop sweeps, so it reaches 0 — stronger than V6 which left it stale. Tests must assert the unsettled scope.)

**C2 — credit ledger + claim().**
- Storage: `mapping(address => mapping(address => uint256)) public credits;` ([recipient][token]). REMOVE `refundCursor` and `claimRefunds`.
- Internal `_credit(address token, address to, uint256 amount, uint256 bondId, uint256 i)`: `if (amount>0){ credits[to][token]+=amount; emit Credited(token,to,bondId,i,amount); }` — storage-only, no external call, so credit sites need no guard.
- `claim(address token) external nonReentrant returns (uint256 amount)`: `amount = credits[msg.sender][token]; require(amount>0,"Nothing to claim"); credits[msg.sender][token]=0; emit Claimed(token,msg.sender,amount); IERC20(token).safeTransfer(msg.sender, amount);` — zero-before-transfer CEI.
- Flows that credit: rejectChallenge(challenger), concede(challenger), ruleForPoster(poster=challengeAmount-fee; judge fee INLINE), ruleForChallenger(winner=bondAmount+challengeAmount-fee; judge fee INLINE; then loop credits all other Pending losers challengeAmount each), rejectBond(poster=bondAmount; loop credits all Pending challengers), claimTimeout(poster=bondAmount; loop credits all Pending challengers), withdrawBond(poster=bondAmount).
- `maxChallenges` ceiling: `require(maxChallenges <= MAX_CHALLENGES_CEILING, "maxChallenges too large")` in createBond (`MAX_CHALLENGES_CEILING = 100`).

**Events:** ADD `event Credited(address indexed token, address indexed recipient, uint256 indexed bondId, uint256 challengeIndex, uint256 amount)` and `event Claimed(address indexed token, address indexed recipient, uint256 amount)`. REMOVE `ChallengeRefunded` (superseded by Credited). Keep all other V6 events. Credited carries bondId+challengeIndex so per-bond attribution survives in logs (the stored balance is per-token aggregate).

**Invariants (all tested):** (a) C1 pending-cap scoped to unsettled bonds; (b) per-token conservation as restated above; (c) no-double-credit — credit gated on `c.status == Pending`, status flipped to terminal BEFORE `_credit`, settle loop skips already-terminal entries; (d) timeout liveness preserved (claimTimeout still settles + credits poster, bounded loop); (e) no stranded funds — every Pending challenger at settlement is credited (the bug to avoid: deleting claimRefunds without crediting leftovers traps funds permanently).

**Reentrancy approach:** pull pattern + strict CEI in `claim()` + OZ `nonReentrant` belt-and-suspenders. `_credit` is effects-only. Settle loops do all effects (status, pendingCount--, credit accumulate) with zero external calls — strictly more reentrancy-safe than V6's per-iteration `safeTransfer` in `claimRefunds`. **Token assumption (carry from SPEC_V06 + ENFORCE):** standard ERC-20, NO fee-on-transfer / NO rebasing. The credit model makes fee-on-transfer MORE dangerous (shortfall surfaces later against a different claimant). Gate launch to whitelisted tokens (sUSDS) and add a fee-on-transfer mock test asserting clean revert or exclusion. **Yield note:** credited-but-unclaimed sUSDS appreciates to the contract, not the creditor (same as V6 pre-drain).

---

## (2) Sequenced, testable plan for the autonomous loop

**Order: C1 first (smallest, lowest risk, full tests) → C2 → Sepolia deploy → capability-verify → cutover.**

- **STEP 0 — scaffold.** Copy `contracts/core/SimpleBondV6.sol` → `contracts/core/SimpleBondV7.sol`, rename `contract SimpleBondV7`, keep imports (`IBondJudgeV6`, `JudgeProfileRegistryV6`) so registries/ManualJudgeV6 are REUSED. Clone `test/helpers/v6/fixtures.js` → `test/helpers/v7/fixtures.js` (swap `getContractFactory("SimpleBondV6")`→`"SimpleBondV7"`). Done-when: V7 compiles, cloned fixtures deploy.

- **STEP 1 — C1 (specified in full below).** Implement the one-line gate change + the new `MAX_CHALLENGES_CEILING` in `SimpleBondV7.sol` and write `test/core/v7/SimpleBondV7.challenge.test.js`. Done-when: all C1 tests green; full existing-suite-cloned-to-v7 still green.

- **STEP 2 — C2.** Add credits mapping, `_credit`, `claim()`, OZ ReentrancyGuard; convert all OUTBOUND flows to credits (judge fee stays inline); add settle-time loops; delete `claimRefunds`/`refundCursor`/`ChallengeRefunded`. Tests: clone+rewrite `invariants` and `resolution` to credit/claim model; add reentrant-token mock (`contracts/test/MockReentrantToken.sol` — none exists), fee-on-transfer mock (`MockFeeToken.sol`), per-token conservation, no-stranded-funds, no-double-credit, idempotent-double-claim, claim-reverts-on-zero. Done-when: all green; conservation identity holds across every lifecycle.

- **STEP 3 — Sepolia deploy.** Clone `scripts/v6/{deployAll,verifyDeployment,syncConfigFromDeployment}.js` → `scripts/v7/`. Deploy a fresh isolated V7 stack on Sepolia (reuse registries/ManualJudgeV6 on mainnet later). `verifyDeployment` adds a `credits(deployer,token)==0` callable check and asserts `claimRefunds` selector is GONE (else it passes against a V6 contract = false confidence). Write `deployments/sepolia-v7.json`. Done-when: deployed, Etherscan-verified, verify script green.

- **STEP 4 — capability-verify on Sepolia.** Run the capability aggregator + e2e journeys against the new address: (a) fill maxChallenges with pending, reject one, confirm a NEW challenge now succeeds (C1 fix); (b) concede → credit appears → claim() pays you; (c) settle with multiple pending → each owed party claims exactly challengeAmount, double-claim no-ops. Point e2e fixture `tests/e2e/fixtures/wallet-with-node.js:127` at the V7 artifact. Done-when: capability aggregate green.

- **STEP 5 — cutover.** Only after Step 4 green: repoint frontend `runtime-config.js` Sepolia entry + backend Sepolia env to V7, soak on staging. Mainnet deploy + repoint is a SEPARATE later gate. V6 stays live throughout.

### STEP 1 specified in full (C1 in SimpleBondV7)

**Exact Solidity change** in `contracts/core/SimpleBondV7.sol`:

In `createBond` (add a new constant + ceiling check near the other requires, after `require(maxChallenges > 0, "Zero maxChallenges");`):
```solidity
uint256 public constant MAX_CHALLENGES_CEILING = 100;   // top of contract, with the other constants
// ...in createBond:
require(maxChallenges <= MAX_CHALLENGES_CEILING, "maxChallenges too large");
```
In `challenge()`, replace the V6:266 line:
```solidity
// before: require(challenges[bondId].length < b.maxChallenges, "Max challenges reached");
require(b.pendingCount < b.maxChallenges, "Max pending challenges reached");
```
Everything else in `challenge()` unchanged: `challengeIndex = challenges[bondId].length` (append-only), `b.pendingCount += 1` after push. The gate reads pre-increment pendingCount, so the invariant `pendingCount <= maxChallenges` holds (the +1 is blocked once equal).

**Test file:** `test/core/v7/SimpleBondV7.challenge.test.js` (clone the V6 file, swap fixtures to `helpers/v7`). Cases:
1. happy path (port V6): stake transferred, challenge recorded, `Challenged` emitted, `pendingCount == 1`.
2. appends multiple in order (port V6).
3. reverts on stale claim version (port V6).
4. **REPLACES** the V6 `"Max challenges reached"` test → **C1 core test**: `setupWithBond({ maxChallenges: 2 })`; file 2 (pendingCount==2); 3rd `challenge` reverts `"Max pending challenges reached"`. Then have the judge `rejectChallenge` index 0 (pendingCount→1, status RejectedByJudge); a 3rd `challenge` now SUCCEEDS (the V6 lockout bug is fixed). Assert `getChallengeCount == 3` while `pendingCount == 2` (length exceeds maxChallenges — cumulative semantics).
5. **C1 invariant test**: spam-then-reject-then-refile loop; assert `bonds(0).pendingCount <= maxChallenges` at every step and `== Pending count`.
6. **Ceiling test**: `createBond` with `maxChallenges = 101` reverts `"maxChallenges too large"`; `100` succeeds.
7. reverts on unknown bond id (port V6).

Note for the loop: the existing V6 test at challenge.test.js:89-96 asserting `"Max challenges reached"` MUST be rewritten (the revert string and semantics changed) — it is a guard test, migrate don't delete.

**Done-when (Step 1):** `npx hardhat test test/core/v7/SimpleBondV7.challenge.test.js` green; the C1 fix (refile-after-reject succeeds) and ceiling both proven; `pendingCount <= maxChallenges` invariant holds in the loop test; full v7 cloned suite still compiles and passes with C1 in place (C2 not yet added).

---

## (3) Migration checklist

| # | Surface | File | Change |
|---|---|---|---|
| 1 | Contract | `contracts/core/SimpleBondV7.sol` (NEW) | C1 gate + ceiling; C2 credits ledger, `_credit`, `claim()`, OZ ReentrancyGuard; convert OUTBOUND flows to credits (judge fee INLINE); settle-time loops; delete claimRefunds/refundCursor/ChallengeRefunded; add Credited/Claimed events. |
| 2 | Test mocks | `contracts/test/MockReentrantToken.sol`, `MockFeeToken.sol` (NEW) | None exist today. Reentrant token re-enters claim()/concede(); fee-on-transfer token for conservation-shortfall test. |
| 3 | Core tests | `test/core/v7/*` + `test/helpers/v7/fixtures.js` (NEW) | Clone+rewrite; add C1, claim()-CEI/reentrancy, per-token conservation, no-stranded-funds, no-double-credit, idempotent claim. Rewrite (don't port) V6 zero-balance conservation. |
| 4 | Deploy scripts | `scripts/v7/{deployAll,verifyDeployment,syncConfigFromDeployment}.js` (NEW) + `test/tooling/v7DeployFlow.test.js` | Record key `simpleBondV7`; write `deployments/sepolia-v7.json`; verify adds `credits()==0` check + asserts `claimRefunds` gone; sync sets `bondVersion:7`. |
| 5 | Frontend ABI | `frontend/v7/abi.js` (NEW, fork — keep v6 readable in overlap) | Remove `refundCursor`/`claimRefunds`/`ChallengeRefunded`; add `credits(address,address) view`, `claim(address token)`, Credited/Claimed events. |
| 6 | Frontend refunds | `frontend/refunds.js` + `frontend/v6/index.html` A4 card (~3493-3505 render, ~3787-3802 `doDrainRefunds`) | Replace status-scanning `computeRefunds` with `credits(bond.token, viewer)` read → "You are owed $X" → single `claim(token)` button. Remove maxCount input. Rewrite `test/frontend/computeRefunds.test.js` + e2e `refunds-affordance.spec.js` (conceded challenger now HAS a claimable credit). |
| 7 | Runtime config | `frontend/runtime-config.js` (chains[11155111], line 40-52) | After Sepolia verify: patch Sepolia entry to V7 `bondContract`/`deployBlock`/`bondVersion:7`. mainnet (chains[1]) stays v6 until separate cutover. Relax `SimpleBondV6FrontendSurface.test.js` bondVersion assertions or fork to v7 surface test. |
| 8 | Backend ABI/version map | `backend/config.mjs` | Add `V7_CONTRACT_ABI` (V6 events minus ChallengeRefunded + Credited/Claimed + `credits()` view). **Restructure `abiForChain` (line 149-151) from binary ternary to a version map** — else v7 falls through to V5. Add `SEPOLIA_V7_CONTRACT`/`_START_BLOCK` env handling; set chain bondVersion 7. |
| 9 | Backend event recipients | `backend/config.mjs:161` EVENT_RECIPIENTS + `backend/watcher.mjs:248` resolveRecipients | Add `Credited: ['recipient']`, `Claimed: []`. **Implement a NEW `recipient` resolver branch** extracting `parsedLog.args.recipient` directly (current resolver is role-only: poster/judge/challenger/challengers from the bond struct). Remove ChallengeRefunded handling on v7 chains. Missing this = owed-funds emails silently stop. |
| 10 | Backend surface test | `test/backendV7Surface.test.js` (NEW, mirror `backendV6Surface.test.js`) | Assert Credited/Claimed in V7 ABI + EVENT_RECIPIENTS, `abiForChain(sepolia)==V7_CONTRACT_ABI`, `credits()` view present. |
| 11 | e2e fixture | `tests/e2e/fixtures/wallet-with-node.js:127` | Hardcodes `SimpleBondV6.json` artifact path — point at V7 artifact (or parameterize) or e2e deploys v6 and claim tests pass vacuously. |
| 12 | Release doc | `RELEASE_V07.md` (NEW, clone `RELEASE_V06.md`) | Phase-5 Sepolia deploy reusing/fresh stack; Phase-8: replace drain steps with concede→credit→claim, C1 refile-after-reject, multi-pending settle→each claims exactly challengeAmount. Cutover gate: Sepolia capability aggregate green BEFORE repointing config/backend; mainnet separate. |

**Known launch-scope trade (document, don't silently lose):** backend option (a) = frontend reads `credits()` directly from chain, defer Credited indexing/email → means NO "you are owed" email at credit time (a notification regression vs V6's ChallengeRefunded email). Acceptable testnet-first; flag as the mainnet follow-up.

**Cutover gate:** Sepolia capability aggregate green → repoint runtime-config + backend Sepolia → staging soak → mainnet is a separate later gate. V6 addresses stay live the entire time.