# SimpleBond v0.6 — User Flows

Authoritative catalogue of every user-facing flow in the v0.6 UI. Each flow
is the target of at least one Playwright test in `tests/e2e/`. Read this
alongside `SPEC_V06.md` (mechanism truth) and `PLAN_V06.md` (build plan).

## Conventions

- **Roles:** `Poster` creates a bond. `Challenger` disputes it. `Judge`
  contract resolves disputes (operated by a human via `ManualJudgeV6`).
  `Observer` is any read-only visitor.
- **Network:** chain selector at the top of the page determines which chain
  every action targets. The dropdown is filtered by hostname (mainnet on
  `bond.futarchy.fi`/`.ai`, Sepolia on `staging.bond.futarchy.fi`, both
  visible on `localhost`).
- **Wallet:** any EIP-1193 injected wallet (MetaMask, Rabby, etc.). The UI
  attempts `wallet_switchEthereumChain` to match the selected chain.

---

## A — Read-only flows (no wallet required)

### A1. Open the site

**Steps:** Visit `bond.futarchy.fi`. UI loads. Chain selector shows
"Ethereum (1)". "Bonds" tab is selected. Log panel reads `(no output)`.

**Pass:** page returns 200, title is "SimpleBond v0.6", chain selector and
nav are visible.

### A2. Browse bonds list

**Steps:** Click "Bonds" (or load `/#list`). UI calls `bondContract.nextBondId()`
via the chain's RPC and iterates the last 50 bond ids. Each card shows
poster, judge, claim hash, claim version, amounts, pending count, and
overall status badge (`open` / `closed` / `settled`).

**Pass:** no decode errors in console; cards render with addresses + amounts.

### A3. Open a bond's detail view

**Steps:** Click a bond id (or load `/#detail-0`). UI calls `bondContract.bonds(id)`
and `getChallenge(id, i)` for each challenge. Renders full bond struct
table + per-challenge cards with status badge, timestamps, concession
and ruling deadlines.

**Pass:** all fields render. Status badges use the v0.6 colour palette
(white surface, accent border).

### A4. Browse a judge's profile

**Steps:** Click a judge profile id (or load `/#judge-N`). UI calls
`judgeProfileRegistry.getProfile(entryId)` and shows owner, judgeContract,
contentHash, and content.

**Pass:** profile content rendered as pre-formatted text; address has an
Etherscan link.

### A5. Smoke page

**Steps:** Visit `/v6/smoke.html`. Click "Read nextBondId" and "Read bond #".

**Pass:** values appear in the output panel. Useful when the main UI is
suspected of being broken.

---

## B — Wallet flows

### B1. Connect wallet

**Steps:** Click "Connect" in the header. Wallet prompts for account.
UI requests `wallet_switchEthereumChain` to match the selected chain id.
Header shows truncated address. `signer` is set; write actions become
enabled.

**Pass:** address visible; log entry `Connected 0x…`.

### B2. Approve token to the bond contract

**Steps:** Open a bond detail. In the actions card, enter an amount in
"approve token amount". Click "Approve token". Wallet prompts; sign.

**Pass:** ERC-20 `Approval` event fires; future challenge/createBond
succeeds without revert.

---

## C — Poster flows

### C1. Create a bond

**Steps:** Click "Create bond" (`/#create`). The form is pre-filled with
the chain's `approvedToken` and the **default** values (10 / 3 / 0.5 sUSDS,
7-day acceptance + 7-day ruling, maxChallenges 10, judgeProfileId 0).
Fill claim content. Click "Create bond". Wallet prompts for `createBond`
tx. On confirm, log shows `created bond, tx 0x…` and routes to `/#list`.

**Pass:** `BondCreated` event emitted on-chain; new bond appears at the
top of the list.

### C2. Modify claim text

**Steps:** Open own bond detail. In the "Modify claim" row, enter new
text and click "Modify claim". Wallet prompts. On confirm, the `claimVersion`
field on the detail card increments and `claimHash` updates.

**Pass:** `ClaimModified` event; UI shows the new claim. Requires
`pendingCount == 0` (else the contract reverts with `"Pending challenges"`).

### C3. Concede a specific challenge

**Steps:** Open own bond detail with at least one pending challenge.
In the challenge's card, fill the concession textarea and click
"Concede this challenge". Wallet prompts. On confirm, the challenge
status flips to **Conceded**, the challenger's stake is returned, and
`pendingCount` decrements.

**Pass:** `ClaimConceded(bondId, i, poster, contentHash, content)` event.
Other challenges and the bond itself remain active.

### C4. Close the bond

**Steps:** Own bond, not settled, currently open. Click "Close bond".
On confirm, status badge flips to **closed**; new challenges revert.

**Pass:** `BondClosed` event; "Open bond" button now shown instead.

### C5. Open a closed bond

**Steps:** Mirror of C4. Click "Open bond". Status badge flips back to
**open**.

**Pass:** `BondOpened` event.

### C6. Withdraw the bond

**Steps:** Own bond, `closed` and `pendingCount == 0`. Click "Withdraw".
Wallet prompts. On confirm, the bond is `settled`, poster receives
`bondAmount`.

**Pass:** `BondWithdrawn` event; further actions on the bond revert.

---

## D — Challenger flows

### D1. Challenge a bond

**Steps:** Open bond detail with second wallet. Fill "reason for challenge".
Click "Challenge (vN)" where N is the current `claimVersion`. The tx pins
`expectedVersion = N`; if poster modifies the claim in the meantime, the
challenge reverts (which is the intended race-condition guard).

**Pass:** `Challenged(bondId, index, challenger, expectedVersion, …)`
event; new challenge card appears with status **Pending**.

### D2. Claim refund after a bond-wide settlement

**Steps:** After `ruleForChallenger` / `rejectBond` / `claimTimeout` on
a bond that had multiple pending challenges, click "Drain refunds" on
the detail page. UI calls `claimRefunds(bondId, 10)` in batches until
no more pending entries remain.

**Pass:** every refundable challenge ends with status **Refunded**;
challengers' balances increased by `challengeAmount`.

### D3. Trigger timeout when the judge is inactive

**Steps:** On a bond where a challenge has been pending past
`rulingDeadline(i)`, anyone clicks "Claim timeout" on that challenge.

**Pass:** `BondTimedOut(bondId, i)` event; bond is settled; refunds
are now claimable via D2.

---

## E — Judge flows

### E1. Use the canonical ManualJudgeV6

**Steps:** Go to `/#profiles` → "Judge profile" section → click "Use
canonical ManualJudgeV6". Address field is pre-filled with the chain's
configured `manualJudgeV6` address. Write your judging-criteria text.
Click "Register judge profile".

**Pass:** `ProfileRegistered(entryId, owner, judgeContract, …)` event.
Log shows the resulting `entryId` for use as `judgeProfileId` when
creating a bond.

### E2. Deploy a fresh ManualJudgeV6

**Steps:** Same page → click "Deploy a fresh ManualJudgeV6 (I'll be
operator)". Wallet prompts to deploy the contract (uses inlined
bytecode from `frontend/v6/manualJudgeV6.bytecode.js`). On confirm,
the UI immediately calls `acceptOperatorRole()` and pre-fills the
new address in the judge form.

**Pass:** two transactions land (deploy + accept). Address field
populated.

### E3. Rule for the poster

**Steps:** Operator wallet connects. Open bond detail. After the
acceptance window (`now > challenge[i].timestamp + acceptanceDelay`)
but before the ruling deadline, the judge wrapper exposes a "Rule for
poster" affordance (initially via a low-level call panel; full UI in
Phase 2 of the rebuild).

**Pass:** `RuledForPoster` event. Challenge status flips to **Lost**.
Poster receives `challengeAmount − feeCharged`; judge contract receives
`feeCharged`.

### E4. Rule for the challenger

**Steps:** Same prerequisites as E3 but operator clicks "Rule for
challenger". On confirm, `bond.settled = true`, challenger receives
`bondAmount + challengeAmount − feeCharged`, other pending challenges
become refundable via D2.

**Pass:** `RuledForChallenger` event; bond settled.

### E5. Reject a challenge as out-of-scope

**Steps:** Operator clicks "Reject challenge" on any pending challenge.
Refunds that single challenger immediately without consuming a ruling.

**Pass:** `ChallengeRejected` event. Challenge status flips to
**RejectedByJudge**. Bond continues.

### E6. Reject (void) the entire bond

**Steps:** Operator clicks "Void bond". On confirm, poster is refunded,
bond is settled, any remaining pending challenges become refundable
via D2. Already-finalised rulings are not unwound.

**Pass:** `BondRejectedByJudge` event.

---

## F — Profile registry flows

### F1. Register a poster profile

**Steps:** `/#profiles` → "Poster profile" → fill content → click
"Register poster profile". Wallet prompts.

**Pass:** `ProfileRegistered(entryId, owner, …)` on `PosterProfileRegistry`.

### F2. Register a challenger profile

**Steps:** Mirror of F1 for `ChallengerProfileRegistry`.

**Pass:** equivalent event on the challenger registry.

---

## G — Notification flows (out of scope for v0.6.0)

Email subscription UI from v0.5 was disabled when AWS SES was decommissioned.
The notification backend on `api.bond.futarchy.ai` runs (watcher picks
up chains 1, 100, 11155111) but `sendEmail()` is a no-op. Re-enabling
is a separate task — out of scope here.

---

## H — Multi-chain / hostname behaviour

### H1. Mainnet site shows only Ethereum

**Steps:** Visit `bond.futarchy.fi`. The chain selector contains only
"Ethereum (1)". Sepolia is filtered out by the hostname rule in
`runtime-config.js`.

**Pass:** Sepolia option not present.

### H2. Staging site shows only Sepolia

**Steps:** Visit `staging.bond.futarchy.fi`. The chain selector contains
only "Sepolia (11155111)". Mainnet is filtered out.

**Pass:** Ethereum option not present; bonds on Sepolia load.

### H3. Local dev shows both

**Steps:** Run a static server locally (`python3 -m http.server 8765`).
Visit `localhost:8765`. The selector exposes both chains.

**Pass:** both options present; switching dropdown re-renders the list.

---

## Playwright coverage

Each section above maps to a file in `tests/e2e/`:

| Section | Test file |
|---|---|
| A1–A5 | `tests/e2e/read-only.spec.js` |
| B1–B2 | `tests/e2e/wallet-connect.spec.js` |
| C1–C6 | `tests/e2e/poster-flows.spec.js` |
| D1–D3 | `tests/e2e/challenger-flows.spec.js` |
| E1–E6 | `tests/e2e/judge-flows.spec.js` |
| F1–F2 | `tests/e2e/profile-flows.spec.js` |
| H1–H3 | `tests/e2e/hostname-routing.spec.js` |

Wallet-driven tests use a Hardhat-backed mock `window.ethereum` provider so
the suite is deterministic and offline; the read-only and hostname-routing
tests hit the live deploy.
