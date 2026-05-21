# SimpleBond v0.6 Mainnet Release Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `SimpleBondV6` on Ethereum mainnet with sUSDS as the canonical token, repoint `bond.futarchy.ai` (frontend + notification backend) at the new mainnet contracts, retire the legacy Gnosis v0.5 deployment from the live UI, and land it with a green test suite.

**Architecture:** v0.6 keeps the v0.5 core layout (`contracts/core` + `contracts/judges` + `contracts/interfaces` + supporting registries) and adds: versioned claim text, per-challenge concession, per-challenge timing, judge out-of-scope refunds, close/open toggle, `maxChallenges`, hash-with-event metadata, and append-only profile registries for posters and challengers. Bond `deadline` is removed; the bond lifecycle is event-driven. Mainnet uses sUSDS; Sepolia staging uses a `MockSUSDS` ERC-20.

**Tech Stack:** Solidity 0.8.24, Hardhat 2.22+, ethers v6, OpenZeppelin 5, Chai matchers. Node ≥18 for the notification backend. Vanilla JS static frontend (Netlify). Docker + Caddy on GCP for backend.

---

## Source of Truth

This plan implements `SPEC_V06.md`. Any conflict: spec wins, file a task to update the spec.

## File Structure

**New contracts:**
- `contracts/core/SimpleBondV6.sol` — bond core
- `contracts/interfaces/IBondJudgeV6.sol` — judge interface for v0.6
- `contracts/judges/ManualJudgeV6.sol` — manual judge wrapper for v0.6
- `contracts/profiles/PosterProfileRegistry.sol` — append-only poster profiles
- `contracts/profiles/ChallengerProfileRegistry.sol` — append-only challenger profiles
- `contracts/profiles/JudgeProfileRegistryV6.sol` — append-only judge profiles (v0.5 already append-only by convention; v6 makes it explicit + adds entryId snapshotting)
- `contracts/directory/OfficialBondDirectoryV6.sol` — v0.6-aware directory (or extend existing if v0.5's interface is sufficient)
- `contracts/test/MockSUSDS.sol` — Sepolia staging token mock

**Tests:**
- `test/core/v6/SimpleBondV6.test.js` — unit
- `test/core/v6/SimpleBondV6.fuzz.test.js` — fuzz
- `test/core/v6/SimpleBondV6.invariants.test.js` — invariants
- `test/profiles/PosterProfileRegistry.test.js`
- `test/profiles/ChallengerProfileRegistry.test.js`
- `test/profiles/JudgeProfileRegistryV6.test.js`
- `test/directory/OfficialBondDirectoryV6.test.js`
- `test/judges/ManualJudgeV6.test.js`
- `test/integration/v6.endToEnd.test.js`
- `test/helpers/v6/` — fixtures and helpers

**Scripts:**
- `scripts/v6/deploySimpleBondV6.js`
- `scripts/v6/deployProfileRegistries.js`
- `scripts/v6/deployOfficialBondDirectoryV6.js`
- `scripts/v6/deployManualJudgeV6.js`
- `scripts/v6/deployMockSUSDS.js` — Sepolia only
- `scripts/v6/deployAll.js` — orchestrator (calls the above in order, prints config dump)

**Frontend:**
- `frontend/runtime-config.js` — extend with `mainnet*` and `sepolia*` keys
- `frontend/v6/` — new pages for v0.6-specific UI (modifyClaim, close/open, per-challenge concession, registry browsing) OR extend existing files; decided in Phase 6
- `frontend/judges.js` — extend for v0.6 if needed

**Backend:**
- `backend/config.mjs` — add `CHAINS[1]` (mainnet) and `CHAINS[11155111]` (Sepolia)
- `backend/abi/` — v0.6 ABI subset for the watcher

**Docs:**
- `SPEC_V06.md` — already on `spec/v06`
- `PLAN_V06.md` — this file
- `README.md` — updated for v0.6 release in Phase 12
- `AUDIT_SCOPE_V06.md` — new, modeled on `AUDIT_SCOPE.md`

---

## Phase 1 — Contract Core: `SimpleBondV6`

Goal: clean-room v0.6 contract under TDD. Compile + every behavior covered.

### Task 1.1: Scaffold `IBondJudgeV6`

**Files:**
- Create: `contracts/interfaces/IBondJudgeV6.sol`

- [ ] **Step 1: Copy v0.5 interface as starting point**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBondJudgeV6 {
    /// @notice Creation-time term-acceptance probe.
    function validateBond(
        address token,
        uint256 bondAmount,
        uint256 challengeAmount,
        uint256 judgeFee,
        uint256 acceptanceDelay,
        uint256 rulingBuffer,
        uint256 maxChallenges
    ) external view;
}
```

Note: `deadline` removed from signature relative to v0.5; `maxChallenges` added.

- [ ] **Step 2: Compile**

Run: `npx hardhat compile`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add contracts/interfaces/IBondJudgeV6.sol
git commit -m "feat(v6): IBondJudgeV6 interface"
```

### Task 1.2: Scaffold `SimpleBondV6` with `createBond`

**Files:**
- Create: `contracts/core/SimpleBondV6.sol`
- Test: `test/core/v6/SimpleBondV6.test.js`
- Helper: `test/helpers/v6/fixtures.js`

- [ ] **Step 1: Write fixtures helper**

`test/helpers/v6/fixtures.js`:

```js
const { ethers } = require("hardhat");

async function deployMockERC20() {
    const F = await ethers.getContractFactory("MockSUSDS");
    const t = await F.deploy("Mock sUSDS", "msUSDS");
    await t.waitForDeployment();
    return t;
}

async function deployBond() {
    const Bond = await ethers.getContractFactory("SimpleBondV6");
    const b = await Bond.deploy();
    await b.waitForDeployment();
    return b;
}

async function deployJudge() {
    const J = await ethers.getContractFactory("TestAcceptJudgeV6");
    const j = await J.deploy();
    await j.waitForDeployment();
    return j;
}

module.exports = { deployMockERC20, deployBond, deployJudge };
```

- [ ] **Step 2: Write `MockSUSDS` test contract**

`contracts/test/MockSUSDS.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockSUSDS is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
```

- [ ] **Step 3: Write `TestAcceptJudgeV6` test helper contract**

`contracts/test/TestAcceptJudgeV6.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IBondJudgeV6.sol";

contract TestAcceptJudgeV6 is IBondJudgeV6 {
    function validateBond(address,uint256,uint256,uint256,uint256,uint256,uint256) external pure {}
}
```

- [ ] **Step 4: Write failing test for `createBond`**

```js
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployMockERC20, deployBond, deployJudge } = require("../../helpers/v6/fixtures");

describe("SimpleBondV6 createBond", () => {
    it("creates a bond and pulls bondAmount from poster", async () => {
        const [poster] = await ethers.getSigners();
        const token = await deployMockERC20();
        const bond = await deployBond();
        const judge = await deployJudge();

        await token.mint(poster.address, ethers.parseEther("100"));
        await token.connect(poster).approve(await bond.getAddress(), ethers.parseEther("100"));

        const tx = await bond.connect(poster).createBond(
            await token.getAddress(),
            ethers.parseEther("10"),    // bondAmount
            ethers.parseEther("3"),     // challengeAmount
            ethers.parseEther("0.5"),   // judgeFee
            await judge.getAddress(),
            7 * 24 * 3600,              // acceptanceDelay
            7 * 24 * 3600,              // rulingBuffer
            10,                          // maxChallenges
            0,                           // judgeProfileId (0 = none/placeholder for this test)
            "ipfs://hash-of-claim"
        );
        const receipt = await tx.wait();
        const log = receipt.logs.find(l => l.fragment && l.fragment.name === "BondCreated");
        expect(log.args.bondId).to.equal(0n);
        expect(log.args.poster).to.equal(poster.address);
        expect(await token.balanceOf(await bond.getAddress())).to.equal(ethers.parseEther("10"));
    });
});
```

- [ ] **Step 5: Run failing**

Run: `npx hardhat test test/core/v6/SimpleBondV6.test.js`
Expected: fails because contract does not exist.

- [ ] **Step 6: Implement `SimpleBondV6` skeleton + `createBond`**

Key fields (full struct/file in repo):

```solidity
struct Bond {
    address poster;
    address judge;
    address token;
    uint256 bondAmount;
    uint256 challengeAmount;
    uint256 judgeFee;
    uint256 acceptanceDelay;
    uint256 rulingBuffer;
    uint256 maxChallenges;
    bytes32 claimHash;
    uint256 claimVersion;
    uint256 judgeProfileId;
    bool settled;
    bool closed;
}

enum ChallengeStatus { Pending, Won, Lost, Conceded, RejectedByJudge, Refunded }

struct Challenge {
    address challenger;
    ChallengeStatus status;
    uint256 timestamp;
    uint256 challengeAtVersion;
    bytes32 claimHashAtChallenge;
    bytes32 metadataHash;
    bytes32 rulingMetadataHash;
}
```

`createBond` body:
- validate args
- call `judge.validateBond(...)`
- compute `claimHash = keccak256(bytes(claimContent))`
- assign id, store bond, emit `BondCreated`, pull token via `SafeERC20`

- [ ] **Step 7: Run passing**

Run: `npx hardhat test test/core/v6/SimpleBondV6.test.js`
Expected: pass.

- [ ] **Step 8: Add validation tests** (each as a small `it(...)`):
  - `bondAmount == 0` reverts "Zero bond amount"
  - `challengeAmount == 0` reverts
  - `judge == address(0)` reverts
  - `judge.code.length == 0` reverts (EOA judge)
  - `judgeFee > challengeAmount` reverts
  - `maxChallenges == 0` reverts
  - `acceptanceDelay > MAX_ACCEPTANCE_DELAY` reverts
  - `rulingBuffer == 0` reverts
  - `rulingBuffer > MAX_RULING_BUFFER` reverts

- [ ] **Step 9: Commit**

```bash
git add contracts/ test/ 
git commit -m "feat(v6): SimpleBondV6 skeleton + createBond"
```

### Task 1.3: `modifyClaim` and `claimVersion`

- [ ] **Step 1: Test — poster can modify when queue empty, version increments, hash updates, event fires**
- [ ] **Step 2: Test — non-poster reverts**
- [ ] **Step 3: Test — modify reverts while any pending challenge exists**
- [ ] **Step 4: Test — modify reverts after settled**
- [ ] **Step 5: Run failing**
- [ ] **Step 6: Implement `modifyClaim(uint256 bondId, string calldata newContent)`**
- [ ] **Step 7: Run passing**
- [ ] **Step 8: Commit `feat(v6): modifyClaim with version bump`**

### Task 1.4: `challenge` with `expectedVersion` and `maxChallenges`

- [ ] **Step 1: Tests:**
  - happy path: stake transferred, challenge recorded, `Challenged` event emitted with `expectedVersion` and `claimHashAtChallenge`
  - `expectedVersion` mismatch reverts
  - `closed` bond reverts (close path tested separately, but assert here that the gate exists)
  - `maxChallenges` exceeded reverts
  - settled bond reverts
- [ ] **Step 2: Implement `challenge(uint256 bondId, uint256 expectedVersion, string calldata content)`**
- [ ] **Step 3: Run passing**
- [ ] **Step 4: Commit `feat(v6): challenge with version pin and maxChallenges`**

### Task 1.5: Per-challenge `concede`

- [ ] **Step 1: Tests:**
  - poster concedes within `concessionDeadline(i)`: challenger refundable, bond not settled, status `Conceded`
  - non-poster reverts
  - past concession window reverts
  - challenge not `Pending` reverts
  - settled bond reverts
- [ ] **Step 2: Implement `concede(uint256 bondId, uint256 i, string calldata content)`**
- [ ] **Step 3: Run passing**
- [ ] **Step 4: Commit `feat(v6): per-challenge concede`**

### Task 1.6: Per-challenge timing views

- [ ] **Step 1: Tests for `concessionDeadline(bondId, i)` and `rulingDeadline(bondId, i)` math**
- [ ] **Step 2: Implement view helpers**
- [ ] **Step 3: Commit `feat(v6): per-challenge timing views`**

### Task 1.7: `ruleForPoster`

- [ ] **Step 1: Tests:**
  - only judge contract may call
  - reverts before `rulingWindowStart(i)`
  - reverts after `rulingDeadline(i)`
  - reverts if `feeCharged > judgeFee`
  - happy path: challenge status `Lost`, poster receives `challengeAmount - feeCharged`, judge receives `feeCharged`
  - bond stays unsettled, future challenges still possible
- [ ] **Step 2: Implement `ruleForPoster(uint256 bondId, uint256 i, uint256 feeCharged, string calldata content)`**
- [ ] **Step 3: Commit `feat(v6): ruleForPoster`**

### Task 1.8: `ruleForChallenger`

- [ ] **Step 1: Tests:**
  - only judge contract may call
  - ruling-window gates
  - happy path: challenger receives `bondAmount + challengeAmount - feeCharged`, judge receives `feeCharged`, bond `settled = true`
  - all other `Pending` become refundable
- [ ] **Step 2: Implement `ruleForChallenger(...)`**
- [ ] **Step 3: Commit `feat(v6): ruleForChallenger`**

### Task 1.9: `rejectChallenge` (out-of-scope)

- [ ] **Step 1: Tests:**
  - only judge contract
  - callable before `rulingWindowStart(i)`
  - callable after; not gated by ruling window
  - happy path: challenger refundable, bond not settled, status `RejectedByJudge`
  - reverts if challenge not `Pending`
- [ ] **Step 2: Implement `rejectChallenge(...)`**
- [ ] **Step 3: Commit `feat(v6): rejectChallenge for out-of-scope refund`**

### Task 1.10: `rejectBond` (void)

Existing v0.5 behavior plus content param.

- [ ] **Step 1: Tests:**
  - only judge contract
  - happy path: poster refunded full bond, all Pending refundable, bond settled
  - finalized challenges not unwound (set up with one Lost + one Won-via-prior-Won? — actually a Won settles bond; test with prior Lost + current Pending)
- [ ] **Step 2: Implement `rejectBond(uint256 bondId, string calldata content)`**
- [ ] **Step 3: Commit `feat(v6): rejectBond with content`**

### Task 1.11: `closeBond` / `openBond`

- [ ] **Step 1: Tests:**
  - only poster
  - close blocks new `challenge`
  - existing pending continue (concession, ruling work as expected)
  - open re-enables new `challenge`
  - cannot close twice / open while open
  - cannot close/open settled bond
- [ ] **Step 2: Implement `closeBond` and `openBond`**
- [ ] **Step 3: Commit `feat(v6): closeBond/openBond toggle`**

### Task 1.12: `withdrawBond`

- [ ] **Step 1: Tests:**
  - only poster
  - requires `closed && pendingCount == 0`
  - happy path: poster receives full bond, bond settled
  - cannot re-open after withdraw
- [ ] **Step 2: Implement `withdrawBond`**
- [ ] **Step 3: Commit `feat(v6): withdrawBond gated on closed+empty`**

### Task 1.13: `claimTimeout` per-challenge

- [ ] **Step 1: Tests:**
  - any caller may invoke
  - reverts before `rulingDeadline(i)`
  - happy path: poster receives full bond, all Pending refundable, bond settled
  - finalized challenges not unwound
- [ ] **Step 2: Implement `claimTimeout(uint256 bondId, uint256 i)`**
- [ ] **Step 3: Commit `feat(v6): per-challenge claimTimeout`**

### Task 1.14: `claimRefunds` (bounded batch)

- [ ] **Step 1: Tests:**
  - refunds only mark-refundable entries (Pending-at-settlement, Conceded, RejectedByJudge)
  - bounded by `maxCount`
  - idempotent (re-running doesn't double-pay; status becomes Refunded)
  - sums conserve token balance
- [ ] **Step 2: Implement `claimRefunds(uint256 bondId, uint256 maxCount)`**
- [ ] **Step 3: Commit `feat(v6): bounded-batch claimRefunds`**

### Task 1.15: Hash-with-event audit pass

Cross-cutting check: every metadata-bearing function takes raw `content`, computes `keccak256`, stores hash in the appropriate slot, emits event with both.

- [ ] **Step 1: Audit-style test**: for each metadata-bearing function, the event content hash equals `keccak256(content)`
- [ ] **Step 2: Fix any inconsistencies discovered**
- [ ] **Step 3: Commit `chore(v6): metadata hash/event consistency audit`**

### Task 1.16: Invariants suite

- [ ] **Step 1: Invariants:**
  - token balance conservation across any sequence of state transitions
  - `claimVersion` monotonic
  - terminal statuses never regress
  - settled bonds have no remaining `Pending` entries after `claimRefunds` drains
  - `judgeProfileId` immutable after creation

- [ ] **Step 2: Implement using `hardhat-network-helpers` and chai matchers; mirror v0.5 invariants suite**

- [ ] **Step 3: Commit `test(v6): invariants suite`**

### Task 1.17: Fuzz suite

- [ ] **Step 1: Mirror v0.5 fuzz with v0.6 entrypoints**
- [ ] **Step 2: Commit `test(v6): fuzz suite`**

### Task 1.18: Contract size check

- [ ] **Step 1: Run `npm run size`**
- [ ] **Step 2: If `SimpleBondV6` > 24576 bytes, split helpers out (e.g., `SimpleBondV6Views.sol`); re-run; commit**

---

## Phase 2 — Profile Registries

### Task 2.1: `PosterProfileRegistry`

**Files:**
- `contracts/profiles/PosterProfileRegistry.sol`
- `test/profiles/PosterProfileRegistry.test.js`

- [ ] **Step 1: Tests:**
  - `registerProfile(content)` returns monotonic `entryId`
  - `getProfile(entryId)` returns `(owner, contentHash, content)` for any past entry
  - entries are immutable (no setters)
  - multiple entries per owner allowed; each new one gets new id
- [ ] **Step 2: Implement minimal append-only registry**
- [ ] **Step 3: Commit `feat(v6): PosterProfileRegistry`**

### Task 2.2: `ChallengerProfileRegistry`

Identical interface to 2.1.

- [ ] **Step 1: Copy and rename**
- [ ] **Step 2: Tests parallel to 2.1**
- [ ] **Step 3: Commit `feat(v6): ChallengerProfileRegistry`**

### Task 2.3: `JudgeProfileRegistryV6`

Extends v0.5's append-only model with explicit `entryId` snapshotting (so the bond can pin a specific judge profile version).

- [ ] **Step 1: Tests:**
  - same append-only behavior as 2.1
  - entry stores `(owner, judgeContract, contentHash, content)` — extra `judgeContract` field so the bond can verify `judgeProfileId.judge == bond.judge`
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit `feat(v6): JudgeProfileRegistryV6`**

### Task 2.4: Wire `judgeProfileId` into `SimpleBondV6.createBond`

- [ ] **Step 1: Test — `createBond` reverts if `judgeProfileId` doesn't exist in registry, or if entry's `judgeContract != judge` argument**
- [ ] **Step 2: Implement: pass `judgeProfileRegistry` address into `SimpleBondV6` constructor; in `createBond`, fetch entry and assert**
- [ ] **Step 3: Commit `feat(v6): bond pins judgeProfileId at creation`**

---

## Phase 3 — Judge Wrapper + Directory

### Task 3.1: `ManualJudgeV6`

Port `ManualJudge.sol` to v0.6 interface.

- [ ] **Step 1: Tests parallel to v0.5 `ManualJudge` tests, retargeted at v0.6 entrypoints**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Commit `feat(v6): ManualJudgeV6`**

### Task 3.2: `OfficialBondDirectoryV6` (or extension)

Read existing `contracts/directory/OfficialBondDirectory.sol`. If interface is bond-version-agnostic, reuse; otherwise create v6 variant that knows about poster/challenger registries.

- [ ] **Step 1: Decide reuse vs new** based on read
- [ ] **Step 2: Tests for approved-token list (includes sUSDS), approved-judge list, transferable owner/admin**
- [ ] **Step 3: Implement / extend**
- [ ] **Step 4: Commit**

### Task 3.3: Run full Phase 1–3 suite

- [ ] `npx hardhat test` — all green
- [ ] Commit any housekeeping; tag `v0.6.0-rc1`

---

## Phase 4 — Deployment Scripts

### Task 4.1: `scripts/v6/deployMockSUSDS.js`

Sepolia only.

- [ ] **Step 1: Script deploys `MockSUSDS`, mints 1e24 to deployer, prints address**
- [ ] **Step 2: Test by running against `hardhat` local network**
- [ ] **Step 3: Commit**

### Task 4.2: Per-contract deploy scripts

`scripts/v6/deploySimpleBondV6.js`, `deployProfileRegistries.js`, `deployManualJudgeV6.js`, `deployOfficialBondDirectoryV6.js`. Each:

- [ ] Reads env (`PRIVATE_KEY`, `RPC_URL`)
- [ ] Deploys with hardcoded sane defaults
- [ ] Prints address + deploy block + verify command
- [ ] Commit each as its own commit

### Task 4.3: `scripts/v6/deployAll.js`

Orchestrator: profiles → bond → manual judge → directory → wire approved tokens. Prints a config block ready to paste into `frontend/runtime-config.js` and `backend/config.mjs`.

- [ ] **Step 1: Implement, run against `hardhat`**
- [ ] **Step 2: Commit**

### Task 4.4: Hardhat network config

`hardhat.config.js` additions:

- [ ] **Step 1: Add `sepolia` network using `SEPOLIA_RPC_URL` and `PRIVATE_KEY` env vars**
- [ ] **Step 2: Add `mainnet` network using `MAINNET_RPC_URL` and `PRIVATE_KEY` env vars**
- [ ] **Step 3: Add Etherscan key for verification**
- [ ] **Step 4: Commit**

### Task 4.5: `.env.example`

- [ ] **Step 1: Add `SEPOLIA_RPC_URL`, `MAINNET_RPC_URL`, `ETHERSCAN_API_KEY`**
- [ ] **Step 2: Commit**

---

## Phase 5 — Sepolia Staging Deployment

External step (requires deployer key + faucet ETH).

- [ ] **Step 1: Fund deployer wallet with SepoliaETH (recommend ≥ 0.2)**
- [ ] **Step 2: `npx hardhat run scripts/v6/deployMockSUSDS.js --network sepolia`** — record address
- [ ] **Step 3: `npx hardhat run scripts/v6/deployAll.js --network sepolia`** — record all addresses + deploy block
- [ ] **Step 4: Verify on Sepolia Etherscan** for each contract
- [ ] **Step 5: Smoke-test from console: create a bond, challenge, concede, refund**
- [ ] **Step 6: Commit a `deployments/sepolia.json` with addresses + blocks**

---

## Phase 6 — Frontend: Sepolia + Multi-Chain Foundation

Read `frontend/index.html` + `frontend/judges.js` first. Decide minimum changes to support multi-network (Sepolia + Mainnet) without breaking v0.5 Gnosis (kept until Phase 11).

### Task 6.1: Runtime config schema

- [ ] **Step 1: Extend `frontend/runtime-config.js` schema** to hold `chains` array:
  ```js
  window.SIMPLE_BOND_CONFIG = {
      notifyApiBase: "/api/notify",
      chains: {
          11155111: { name: "Sepolia", bondContract: "0x...", deployBlock: 0, judgeProfileRegistry: "0x...", posterProfileRegistry: "0x...", challengerProfileRegistry: "0x...", judgeRegistry: "0x...", officialDirectory: "0x...", explorer: "https://sepolia.etherscan.io", token: "0x..." /* MockSUSDS */ },
          1: { /* mainnet, filled later */ },
      },
      defaultChainId: 11155111
  };
  ```
- [ ] **Step 2: Add backward-compat shim** that maps the old `gnosis*` keys → `chains[100]` so v0.5 UI still loads (until Phase 11 removes it)
- [ ] **Step 3: Commit**

### Task 6.2: Network selector UI

- [ ] **Step 1: Add a small chain-selector dropdown to the header**
- [ ] **Step 2: Wire wallet provider (MetaMask) to request `wallet_switchEthereumChain` when selection changes**
- [ ] **Step 3: Commit**

### Task 6.3: V6 ABI + read paths

- [ ] **Step 1: Generate `frontend/v6/abi.js` from compiled `SimpleBondV6.json` artifact (script + commit the generated file)**
- [ ] **Step 2: Read paths for: bond view, challenge list with statuses, claim version, judgeProfileId resolution**
- [ ] **Step 3: Commit**

### Task 6.4: V6 write paths

- [ ] **Step 1: createBond, modifyClaim, challenge (with `expectedVersion`), concede (per-challenge), closeBond, openBond, withdrawBond**
- [ ] **Step 2: Ruling/reject paths are judge-only — present as buttons in judge view**
- [ ] **Step 3: Commit**

### Task 6.5: Hash-content pattern in UI

- [ ] **Step 1: When sending content, recompute keccak256 client-side and show preview hash**
- [ ] **Step 2: When reading historic content, resolve from event logs (via the notification backend's archive endpoint or by direct RPC `getLogs`); display hash + content with mismatch warning if any**
- [ ] **Step 3: Commit**

### Task 6.6: Profile registry browsing UI

- [ ] **Step 1: Page (or section) listing poster/challenger/judge profiles by entryId**
- [ ] **Step 2: Bond detail page shows linked judgeProfileId (with link to that entry)**
- [ ] **Step 3: Commit**

### Task 6.7: Staging deploy

- [ ] **Step 1: Configure Netlify branch deploy or second site for `staging.bond.futarchy.ai` pointing at this branch**
- [ ] **Step 2: DNS: add `staging.bond.futarchy.ai` CNAME to Netlify (or A record); user action**
- [ ] **Step 3: Verify staging site loads, wallet connects, Sepolia contracts respond**
- [ ] **Step 4: Commit**

---

## Phase 7 — Backend: Sepolia Watcher

### Task 7.1: Add Sepolia + Mainnet to `CHAINS`

- [ ] **Step 1: Add `CHAINS[1]` and `CHAINS[11155111]` to `backend/config.mjs`** with RPC URLs from env
- [ ] **Step 2: Update `CONFIRMATION_BLOCKS` for new chains**
- [ ] **Step 3: Commit**

### Task 7.2: V6 ABI subset

- [ ] **Step 1: Replace `CONTRACT_ABI` with chain-aware lookup; v6 events have new fields (`expectedVersion`, `claimHash`, `metadataHash`, `content`)**
- [ ] **Step 2: Add new events: `ClaimModified`, `ChallengeRejected`, `BondClosed`, `BondOpened`**
- [ ] **Step 3: Update `EVENT_RECIPIENTS` for new events**
- [ ] **Step 4: Commit**

### Task 7.3: Watcher per-chain

- [ ] **Step 1: Make the chain watcher iterate all configured `CHAINS` entries instead of hardcoding 100**
- [ ] **Step 2: SQLite schema migration: add `chain_id` columns where needed**
- [ ] **Step 3: Test against local hardhat node**
- [ ] **Step 4: Commit**

### Task 7.4: Staging backend deploy

- [ ] **Step 1: Second Docker stack on `futarchy-indexers` GCP VM (`bond-notify-staging`) pointed at Sepolia**
- [ ] **Step 2: Caddy block for `api-staging.bond.futarchy.ai`**
- [ ] **Step 3: DNS for `api-staging.bond.futarchy.ai`**
- [ ] **Step 4: Smoke: trigger a Sepolia event, verify the watcher picks it up**
- [ ] **Step 5: Commit**

---

## Phase 8 — Sepolia Integration Verification

End-to-end on the real staging stack.

- [ ] **Step 1: Create a bond on Sepolia via the staging UI**
- [ ] **Step 2: Challenge it from a second wallet**
- [ ] **Step 3: Modify-claim attempt while pending → expect revert in UI**
- [ ] **Step 4: Concede the challenge → verify refund**
- [ ] **Step 5: Open a new challenge, let acceptance pass, rule for poster as the judge operator**
- [ ] **Step 6: Open another, rule for challenger → verify bond settled**
- [ ] **Step 7: Spin a new bond, fill `maxChallenges`, verify next reverts**
- [ ] **Step 8: Spin a new bond, judge calls `rejectChallenge` then `rejectBond` → verify**
- [ ] **Step 9: Spin a new bond, miss ruling window, `claimTimeout` from anyone**
- [ ] **Step 10: Close, open, withdraw flow**
- [ ] **Step 11: Document any UX bugs found; fix; re-test; commit fixes**

---

## Phase 9 — Mainnet Deployment

External step (requires mainnet ETH on `0x69...` wallet).

- [ ] **Step 1: Re-run `npm run size` and `npx hardhat test` — all green on `main` merge of `spec/v06`**
- [ ] **Step 2: Confirm sUSDS mainnet address: `0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD` (verify via Etherscan + sky.money docs — user step)**
- [ ] **Step 3: Confirm deployer wallet `0x69…` balance ≥ 0.05 ETH (sub-1 gwei deploy budget)**
- [ ] **Step 4: Print final gas estimate from `npx hardhat run scripts/v6/deployAll.js --network hardhat` (dry deploy on fork)**
- [ ] **Step 5: USER confirms ready**
- [ ] **Step 6: `npx hardhat run scripts/v6/deployAll.js --network mainnet`**
- [ ] **Step 7: Verify all contracts on Etherscan via `npx hardhat verify --network mainnet <addr> <args>`**
- [ ] **Step 8: Commit `deployments/mainnet.json` with addresses + deploy block**

---

## Phase 10 — Production Cutover

### Task 10.1: Frontend production config

- [ ] **Step 1: Populate `chains[1]` in `frontend/runtime-config.js` with mainnet addresses**
- [ ] **Step 2: Set `defaultChainId = 1`**
- [ ] **Step 3: Smoke test on staging branch with mainnet config (don't sign tx)**
- [ ] **Step 4: Promote to Netlify production (deploy from main)**
- [ ] **Step 5: Verify `bond.futarchy.ai` loads, wallet on mainnet, contract reads work**
- [ ] **Step 6: Commit**

### Task 10.2: Backend production config

- [ ] **Step 1: Set production `BOND_NOTIFY_BASE_URL`, `SIMPLE_BOND_FRONTEND_URL` env**
- [ ] **Step 2: Production Docker stack updated `backend/config.mjs` includes `CHAINS[1]` with mainnet contract + deploy block**
- [ ] **Step 3: Restart container; verify watcher catches new mainnet blocks**
- [ ] **Step 4: Smoke: post a tiny bond on mainnet, see watcher pick it up**
- [ ] **Step 5: Commit**

---

## Phase 11 — Retire Gnosis v0.5

### Task 11.1: Frontend

- [ ] **Step 1: Remove the Gnosis chain from the network selector (or mark deprecated)**
- [ ] **Step 2: Remove `gnosis*` keys from `runtime-config.js`**
- [ ] **Step 3: Drop the back-compat shim**
- [ ] **Step 4: Commit**

### Task 11.2: Backend

- [ ] **Step 1: Stop the Gnosis watcher chain in `CHAINS`**
- [ ] **Step 2: Keep historic DB read-only (do not migrate; just stop indexing)**
- [ ] **Step 3: Commit**

### Task 11.3: README + docs

- [ ] **Step 1: Update `README.md` to reflect v0.6 mainnet as the current line; move v0.5 Gnosis to a "Legacy" section**
- [ ] **Step 2: Refresh address table**
- [ ] **Step 3: Commit**

---

## Phase 12 — Audit + Final PR

### Task 12.1: `AUDIT_SCOPE_V06.md`

- [ ] **Step 1: Mirror `AUDIT_SCOPE.md` structure for the v0.6 set: `SimpleBondV6`, `ManualJudgeV6`, three profile registries, `OfficialBondDirectoryV6`**
- [ ] **Step 2: Commit**

### Task 12.2: Final PR

- [ ] **Step 1: Merge `spec/v06` into `main` via PR with this plan + spec + all phases as the description**
- [ ] **Step 2: Tag `v0.6.0`**

---

## Open Questions Carried From Spec

- `maxChallenges` interpretation: this plan implements **total challenges ever filed** per the spec. If we flip to **pending-only** before Phase 1.4, that's one line in `challenge()` plus the test in Task 1.4 changes shape — flag before starting Task 1.4.
