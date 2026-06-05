![Tests](https://img.shields.io/badge/tests-passing-green)
# SimpleBond

A truth-machine bond contract. Make a claim, back it with money, and let the world challenge you. Designed by Robin Hanson, built by Futarchy.

## Repository Status

**`v0.6` is live on Ethereum mainnet and is what [bond.futarchy.ai](https://bond.futarchy.ai) serves.** It was merged to `main` and deployed in May 2026: sUSDS-collateralized bonds, evolving claims, per-challenge concession, judge out-of-scope refunds, close/open, append-only profile registries. The mainnet addresses ship in `frontend/runtime-config.js` (`chains[1]`, `bondVersion: 6`). See `SPEC_V06.md`, `PLAN_V06.md`, `RELEASE_V06.md`, `CHANGELOG.md`.

**Staging / Sepolia (chain 11155111) has been cut over to `v0.7` (`SimpleBondV7`, `bondVersion: 7`)** — this is what `staging.bond.futarchy.*` serves. `SimpleBondV7` is `v0.6` plus two UX-motivated mechanism changes: **C1** a pending-cap `maxChallenges` (the cap now bounds the live, currently-pending set instead of lifetime filings, so spam-then-reject can no longer permanently lock out challengers, with a hard `MAX_CHALLENGES_CEILING`) and **C2** a per-address pull-payment credit ledger with `claim(token)` (refunds become claimable credits instead of pushed transfers). The staging addresses ship in `frontend/runtime-config.js` (`chains[11155111]`) and `deployments/sepolia-v7.json`. See `SPEC_V07.md` for the full spec. **The mainnet `v0.7` cutover is NOT done** — it is a separate later gate; mainnet stays on `v0.6` until then.

The previous `v0.5` line (Gnosis Chain, the original audit target) has been **retired from the live UI** — bond.futarchy.ai no longer points at Gnosis. Its contracts remain deployed on Gnosis but are not surfaced by the app. The notes below about Gnosis deployment are historical, kept for reference.

- current (live) core line: `contracts/core/SimpleBondV6.sol`
- current judge wrapper: `contracts/judges/ManualJudgeV6.sol`
- current profile registries: `contracts/profiles/JudgeProfileRegistryV6.sol`, `PosterProfileRegistry.sol`, `ChallengerProfileRegistry.sol`
- current `v0.6` docs: `SPEC_V06.md`, `AUDIT_SCOPE_V06.md`, `RELEASE_V06.md`, `CHANGELOG.md`
- staging-only `v0.7` line (Sepolia, not yet on mainnet): `contracts/core/SimpleBondV7.sol`, docs `SPEC_V07.md`
- previous `v0.5` line (Gnosis, retired from UI): `contracts/core/SimpleBondV5.sol`, `contracts/judges/ManualJudge.sol`, docs `SPEC.md` / `AUDIT_SCOPE.md`
- legacy contract lines and the Kleros adapter: `contracts/legacy/`

## Repository Layout

- `contracts/core/` - current core contracts
- `contracts/judges/` - current judge implementations and wrappers
- `contracts/interfaces/` - shared interfaces
- `contracts/legacy/` - older contract generations and legacy adapters
- `contracts/test/` - test-only Solidity contracts
- `test/core/v6/` - active `v0.6` test suites (live line)
- `test/helpers/v6/` - active `v0.6` test helpers
- `test/core/v5/` - `v0.5` test suites (retired Gnosis line)
- `test/helpers/v5/` - `v0.5` test helpers
- `test/legacy/` - legacy regression suites for older contract lines
- `test/frontend/` - frontend/backend consumer and helper tests
- `test/tooling/` - deploy and repository-tooling tests

## How It Works

1. **Poster** creates a bond — locks tokens and asserts a claim (e.g., "My article has no significant errors")
2. **Challengers** can dispute the claim by depositing a challenge amount
3. **Poster** gets an acceptance delay to publicly **concede** (admit they're wrong) — everyone is refunded, no judge needed
4. If the poster doesn't concede, a **Judge** rules on the dispute after the deadline
5. If the judge doesn't rule in time, anyone can trigger a **timeout** — everyone is refunded

The key output isn't money — it's the **public concession**. The mechanism makes honest signaling cheap and lying expensive.

## Belief Thresholds

The ratio between bond, challenge, and judge fee amounts reveals implied beliefs:

```
net_pot = bondAmount + challengeAmount - judgeFee

Challenger threshold = challengeAmount / net_pot
  → "I believe there's at least X% chance the poster is wrong"

Poster threshold = 1 - bondAmount / net_pot
  → "I'd concede only if >Y% chance I'm wrong"
```

**Example**: Bond = $10K, Challenge = $3K, Judge Fee = $0.5K

```
net_pot = $10K + $3K - $0.5K = $12.5K
Challenger signals: >24% belief poster is wrong  (3/12.5)
Poster signals:     <20% belief they're wrong     (1 - 10/12.5)
```

For a 20% poster threshold: `bondAmount = 4 × (challengeAmount - judgeFee)`

## Lifecycle

```
Bond Created ("I claim X")
  │
  ├─ No challenges → Poster withdraws anytime. Claim stood.
  │
  └─ Challenger arrives → Acceptance delay starts
       │
       ├─ Poster CONCEDES → Claim marked wrong on-chain.
       │    Everyone refunded. Bond done.
       │
       └─ Poster doesn't concede → Judge rules (after deadline)
            │
            ├─ POSTER wins → Judge gets fee, poster gets remainder.
            │    Bond stays active for more challenges.
            │
            └─ CHALLENGER wins → Judge gets fee from pool,
                 challenger gets rest. Remaining challengers refunded. Done.
```

Amounts stay fixed throughout — failed challengers don't grow the pool. Each challenger faces the same odds.

## Features

### Poster Concession
The poster can publicly admit their claim is wrong by calling `concede()` with an on-chain explanation. All parties are refunded. The `ClaimConceded` event creates a permanent on-chain record.

### Acceptance Delay
After a challenge, the poster has a configurable window (set at bond creation) to concede before the judge can rule. The judge's ruling window opens at `max(deadline, lastChallengeTime + acceptanceDelay)`.
The judge may still call `rejectBond()` at any time before settlement; only merits rulings wait for the ruling window.

### Challenge Metadata
Challengers attach their reasoning when challenging — explains *why* they think the poster is wrong. Stored on-chain.

### Judge Fee Waiver
The judge can charge anywhere from 0 to the max fee per ruling. Allows judges to waive their fee for pro-bono rulings or reduce it at their discretion.

### Multiple Challengers
Challenges form a FIFO queue. When a challenger loses, the judge fee comes from their stake and the remainder goes to the poster. The bond pool stays at its original amount. If a challenger wins, the bond is settled and remaining challengers are refunded.

### Timeout Protection
If the judge doesn't rule by the ruling deadline, anyone can call `claimTimeout()` to refund everyone. The judge gets nothing (punished for inaction).

## Contract Interface

```solidity
// Create a bond asserting a claim
createBond(token, bondAmount, challengeAmount, judgeFee, judge, deadline, acceptanceDelay, rulingBuffer, metadata) → bondId

// Challenge a bond (deposit challengeAmount)
challenge(bondId, metadata)

// Poster concedes the claim is wrong (everyone refunded)
concede(bondId, metadata)

// Judge rules (feeCharged = 0..judgeFee for fee waiver)
ruleForChallenger(bondId, feeCharged)
ruleForPoster(bondId, feeCharged)

// Poster withdraws when no pending challenges
withdrawBond(bondId)

// Anyone triggers timeout if judge missed deadline
claimTimeout(bondId)

// Views
rulingWindowStart(bondId) → timestamp
rulingDeadline(bondId) → timestamp
getChallengeCount(bondId) → count
getChallenge(bondId, index) → (challenger, status, metadata)
```

## Deploy

The live `v0.6` stack deploys in one script. `scripts/v6/deployAll.js` deploys the
profile registries, `SimpleBondV6`, `ManualJudgeV6`, and the OfficialBondDirectory,
writes `deployments/<network>.json`, and prints a runtime-config block ready to paste
into `frontend/runtime-config.js` and `backend/config.mjs`.

```bash
cp .env.example .env  # add PRIVATE_KEY and ETH_RPC_URL
npx hardhat compile

# Ethereum mainnet — pass sUSDS as the approved token
APPROVED_TOKEN=0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD \
  npx hardhat run scripts/v6/deployAll.js --network ethereum

# Sepolia testnet — deploy a MockSUSDS first, then pass its address
npx hardhat run scripts/v6/deployMockSUSDS.js --network sepolia
APPROVED_TOKEN=<mock-susds-addr> \
  npx hardhat run scripts/v6/deployAll.js --network sepolia
```

After deploy, `scripts/v6/syncConfigFromDeployment.js` writes the addresses into the
frontend/backend config, and `scripts/v6/verifyDeployment.js` sanity-checks the live
wiring. The legacy `v0.5` Gnosis scripts (`scripts/deploy.js` → `SimpleBondV5`,
`scripts/deployJudgeProfileRegistry.js`, etc.) remain in the repo for the retired
Gnosis line but are not used for the live deployment.

## Frontend Runtime Config

The frontend is a static site; chain addresses and the notification API base are configured at runtime in `frontend/runtime-config.js`.

**Live config (Ethereum mainnet, v0.6)** — see `frontend/runtime-config.js` `chains[1]` for the authoritative, current values:

```js
window.SIMPLE_BOND_CONFIG = {
  notifyApiBase: "https://api.bond.futarchy.ai/api/notify",
  chains: {
    1: {                       // Ethereum mainnet — the live chain
      name: "Ethereum",
      bondContract: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      approvedToken: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD", // sUSDS
      bondVersion: 6,
      // judgeProfileRegistry / posterProfileRegistry / challengerProfileRegistry / rpcs …
    },
    11155111: { /* Sepolia testnet (staging) — cut over to v0.7 (SimpleBondV7), bondVersion 7 */ },
  },
  defaultChainId: 1,
};
```

Hostname routing in `runtime-config.js` selects the chain: `bond.futarchy.ai`/`.fi` → mainnet only; `staging.bond.futarchy.*` → Sepolia only; localhost → both. The old Gnosis `v0.5` addresses (`0x7dF485…`) are no longer shipped. The frontend is hosted on Netlify and points `notifyApiBase` at the public API origin (`https://api.bond.futarchy.ai/api/notify`).

## Notification Deploy

The notification subsystem now has three entrypoints:

- `npm run notify` - compatibility mode, starts the API and worker in one process
- `npm run notify:api` - HTTP API only
- `npm run notify:worker` - chain watcher / email worker only

For a split deployment, set:

- `BOND_NOTIFY_BASE_URL` to the public API origin, for example `https://api.bond.futarchy.ai`
- `SIMPLE_BOND_FRONTEND_URL` to the frontend origin, for example `https://bond.futarchy.ai`
- `backend/config.mjs` `CHAINS[1].contract` to the deployed `SimpleBondV6` address
- `backend/config.mjs` `CHAINS[1].startBlock` to the deployed `SimpleBondV6` block

The live email/notification worker target is Ethereum mainnet and watches:

- `CHAINS[1].contract = 0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
- `CHAINS[1].startBlock = 25139967`

### Current deployment (GCP)

The frontend is hosted on **Netlify** at `https://bond.futarchy.ai`. The
notification backend runs in **combined mode** (`backend/server.mjs`, API +
watcher in one process, one SQLite DB) as a Docker container on the
`futarchy-indexers` GCP VM, fronted by host Caddy for TLS at
`https://api.bond.futarchy.ai`:

```bash
# on the VM, repo cloned at /opt/simple-bond
cp deploy/bond-notify.env.example deploy/bond-notify.env   # set BOND_NOTIFY_HMAC_SECRET
docker compose -p bond-notify -f deploy/docker-compose.yml up -d --build
```

See `Dockerfile`, `deploy/docker-compose.yml`, and `deploy/Caddyfile`.

> Email is currently stubbed (`backend/mailer.mjs` is a logged no-op) because
> the original AWS SES account was decommissioned in the GCP migration. The API
> and watcher run fully; only outbound notification emails are disabled until a
> new provider is wired in.

Sample (legacy) systemd units also live in `deploy/systemd/`:

- `deploy/systemd/bond-notify-api.service`
- `deploy/systemd/bond-notify-worker.service`

## Addresses

**Live `v0.6` deployment — Ethereum mainnet (chainId 1).** These are what
[bond.futarchy.ai](https://bond.futarchy.ai) uses; the authoritative copy lives in
`frontend/runtime-config.js` `chains[1]`.

| Asset | Chain | Address |
|-------|-------|---------|
| SimpleBond v0.6 (`SimpleBondV6`) | Ethereum | `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43` |
| JudgeProfileRegistryV6 | Ethereum | `0x8fee829120b8823899372Ac3d39f77746192b407` |
| PosterProfileRegistry | Ethereum | `0x4eF9cF61B2480B3D9474B767193B9E56bFE34813` |
| ChallengerProfileRegistry | Ethereum | `0xf3cC75bDC99CfEa05De04C13F270B4D39423FE69` |
| ManualJudgeV6 (default test judge) | Ethereum | `0xd5C580e86535C4D66238eB2B9C4270b9a129993e` |
| OfficialBondDirectory | Ethereum | `0xAB3f30129c66c139ceBCD424359E7D953f4f7455` |
| sUSDS (canonical bond token) | Ethereum | `0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD` |

Deploy block: `25139967`.

**Staging `v0.7` deployment — Sepolia (chainId 11155111).** This is what
`staging.bond.futarchy.*` serves; the authoritative copy lives in
`frontend/runtime-config.js` `chains[11155111]` and `deployments/sepolia-v7.json`.
Sepolia was cut over to `SimpleBondV7` (`bondVersion: 7`); the registries, judge,
directory and `MockSUSDS` token were reused from the earlier Sepolia `v0.6` stack.
Mainnet (chain 1) stays on `v0.6` — its `v0.7` cutover is a separate later gate.

| Asset | Chain | Address |
|-------|-------|---------|
| SimpleBond v0.7 (`SimpleBondV7`) | Sepolia | `0x71e15D42bE15BAE117096E12C9dBA25E67d14C67` |
| JudgeProfileRegistryV6 (reused) | Sepolia | `0x5C182867862c061a32C7621c0e3529FF682bbF22` |
| PosterProfileRegistry (reused) | Sepolia | `0x7644dfE83B1e1e9E466644557606Ff28916fCc15` |
| ChallengerProfileRegistry (reused) | Sepolia | `0xA6c22430CB34AC5403D6f2a01BecD90c91e09C23` |
| ManualJudgeV6 (reused) | Sepolia | `0x25E749d42EE4AD0afBEF5c92Bede672784AbDBa9` |
| OfficialBondDirectory (reused) | Sepolia | `0xe93B0E8fd59FA1dbfa3441559616ADBD3344395F` |
| MockSUSDS (staging bond token) | Sepolia | `0x8983aebdA1D5f2b406144D7AAa4f50df4ec8A837` |

SimpleBondV7 deploy block: `10992602`. See `SPEC_V07.md` for the C1 + C2 mechanism
changes.

<details>
<summary>Retired <code>v0.5</code> / legacy deployment (Gnosis — no longer served by the app)</summary>

| Asset | Chain | Address |
|-------|-------|---------|
| SimpleBond v0.5 (`SimpleBondV5`) | Gnosis | `0x7dF485C013f8671B656d585f1d1411640B1D2776` |
| JudgeProfileRegistry | Gnosis | `0x5f2000E438533662A689311672a41aca3EDC88DD` |
| JudgeRegistry | Gnosis | `0xf2F50455D3E1956EF4DF8BBA9a93CeDaF4aE9A3D` |
| OfficialBondDirectory | Gnosis | `0xb32263E363f668f97137D53baF69CF7Fb388c343` |
| SimpleBondV4 | Gnosis | `0xCe8799303AeaEC861142470d754F74E09EfD1C45` |
| KlerosJudge (adapter for `SimpleBondV4`) | Gnosis | `0x71e15D42bE15BAE117096E12C9dBA25E67d14C67` |
| sDAI | Gnosis | `0xaf204776c7245bF4147c2612BF6e5972Ee483701` |
| WXDAI | Gnosis | `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d` |

</details>

Judge profile registry control:

- owner: `0x645A3D9208523bbFEE980f7269ac72C61Dd3b552`
- admin: `0x693E3FB46Bb36eE43C702FE94f9463df0691b43d`

Judge registry control:

- owner: `0x645A3D9208523bbFEE980f7269ac72C61Dd3b552`
- admin: `0x693E3FB46Bb36eE43C702FE94f9463df0691b43d`

Official bond directory control:

- owner: `0x645A3D9208523bbFEE980f7269ac72C61Dd3b552`
- admin: `0x693E3FB46Bb36eE43C702FE94f9463df0691b43d`

## License

MIT
