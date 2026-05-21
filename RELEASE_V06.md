# SimpleBond v0.6 Release Runbook

Operator-side steps to take the v0.6 work on `spec/v06` from "code-complete"
to "shipped on mainnet, bond.futarchy.ai repointed, Gnosis v0.5 retired."

All code, tests, deploy scripts, ABIs, and frontend / backend wiring are
already on the `spec/v06` branch. 604 tests passing as of this writing.
What's left needs your hands on the keys, DNS, Netlify, and the GCP VM.

## Prerequisites

- Deployer wallet (`0x69…`) funded:
  - **Sepolia:** ≥ 0.2 SepoliaETH from a faucet (PoW or Infura).
  - **Mainnet:** ≥ 0.05 ETH at current sub-1 gwei gas; round up if gas spikes.
- `.env` populated with `PRIVATE_KEY`, `SEPOLIA_RPC_URL` (optional, default
  public node), `ETH_RPC_URL` (optional), `ETHERSCAN_API_KEY`.

## Phase 5 — Sepolia staging deploy

```bash
# 1. Deploy mock sUSDS (Sepolia only — refuses on mainnet).
npx hardhat run scripts/v6/deployMockSUSDS.js --network sepolia
# Note the printed MockSUSDS address.

# 2. Deploy the v0.6 stack against that token.
APPROVED_TOKEN=<MockSUSDS address from step 1> \
  npx hardhat run scripts/v6/deployAll.js --network sepolia

# 3. Patch the frontend config from the deployment record.
node scripts/v6/syncConfigFromDeployment.js sepolia

# 4. Verify each contract on Etherscan (commands printed by deployAll).
npx hardhat verify --network sepolia <JudgeProfileRegistryV6 address>
# ... etc for the other contracts.

# 5. Commit the deployment record + patched config.
git add deployments/sepolia.json frontend/runtime-config.js
git commit -m "ops(v6): record Sepolia deployment"
git push
```

## Phase 6/7 — staging infra

### DNS

Add two records pointing at your existing infra:

- `staging.bond.futarchy.ai` → Netlify (CNAME).
- `api-staging.bond.futarchy.ai` → the GCP VM IP (A record).

### Netlify

Either:
- Create a second Netlify site connected to the `spec/v06` branch, custom
  domain `staging.bond.futarchy.ai`.
- Or use a Netlify branch deploy on the existing site mapped to that subdomain.

The site's published directory stays `frontend/`. The v0.6 UI is at
`frontend/v6/index.html`; for staging you can either set Netlify's
publish path to `frontend/v6/`, or add a `_redirects` entry mapping `/` to
`/v6/`.

### Backend (GCP VM)

```bash
# On the VM, repo cloned at /opt/simple-bond, branch spec/v06.
git pull origin spec/v06

# Add env entries (in deploy/bond-notify.env or whatever your env file is):
SEPOLIA_V6_CONTRACT=<address from deployments/sepolia.json contracts.simpleBondV6.address>
SEPOLIA_V6_START_BLOCK=<from same file>
# Optionally: SEPOLIA_RPC=https://...

# Stack: bring up a second container pointed at the staging env.
docker compose -p bond-notify-staging -f deploy/docker-compose.yml up -d --build

# Add a Caddy block for api-staging.bond.futarchy.ai pointing at the new
# container's port (mirror the existing block for api.bond.futarchy.ai).
```

## Phase 8 — Sepolia integration verification

Drive the v0.6 UI at `staging.bond.futarchy.ai` end-to-end:

- [ ] Connect wallet on Sepolia.
- [ ] Register a judge profile (`/v6/#profiles` → judge form).
- [ ] Mint test sUSDS to your wallet (`MockSUSDS.mint` via Etherscan).
- [ ] Approve the bond contract for at least `bondAmount`.
- [ ] Create a bond (`/v6/#create`).
- [ ] Verify the bond appears at `/v6/#list`.
- [ ] From a second wallet, challenge the bond.
- [ ] Try to modify the claim while the challenge is pending → should revert.
- [ ] Concede the challenge → verify refund happens.
- [ ] Open a new challenge; let acceptance window pass; rule for poster via
      ManualJudgeV6 (call from the operator wallet via Etherscan or a script).
- [ ] Open another challenge; rule for challenger → verify bond settles.
- [ ] On a fresh bond, fill `maxChallenges` and assert next reverts.
- [ ] Test `rejectChallenge` then `rejectBond` from the judge.
- [ ] On a fresh bond, miss the ruling window and call `claimTimeout` from
      any address.
- [ ] Test close → withdraw → check refund.

Fix any UX issues found; commit on `spec/v06`; redeploy staging.

## Phase 9 — mainnet deploy

```bash
# 0. Sanity: ensure the branch is green and the size report looks sane.
npx hardhat test
npm run size

# 1. Dry-run on a mainnet fork to confirm gas estimate.
# (Skipped here; the deployment is small and gas is sub-1 gwei.)

# 2. Confirm sUSDS mainnet address: 0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD
# Verify on Etherscan + sky.money docs before signing.

# 3. Deploy.
APPROVED_TOKEN=0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD \
  npx hardhat run scripts/v6/deployAll.js --network ethereum

# 4. Patch runtime-config + commit.
node scripts/v6/syncConfigFromDeployment.js mainnet
git add deployments/mainnet.json frontend/runtime-config.js
git commit -m "ops(v6): record mainnet deployment"
git push

# 5. Verify each contract on Etherscan (commands printed by deployAll).
```

## Phase 10 — production cutover

### Frontend

```bash
# Option A (cleanest): replace index.html with the v0.6 page.
cp frontend/v6/index.html frontend/index.html
# Move ABI imports if needed (index.html now references ./v6/abi.js).

# Option B (lighter): add a _redirects rule on Netlify
#   /          /v6/   200
# so existing bond.futarchy.ai links resolve to the v0.6 UI.

# Set defaultChainId: 1 in runtime-config.js. Confirm chains[1] is present.

git commit -am "ops(v6): promote v0.6 UI to bond.futarchy.ai"
git push
# Netlify auto-builds.
```

### Backend (GCP VM, production container)

```bash
# Add to deploy/bond-notify.env:
MAINNET_V6_CONTRACT=<address from deployments/mainnet.json>
MAINNET_V6_START_BLOCK=<from same file>
# MAINNET_RPC if you don't want the default llamarpc.

# Restart.
docker compose -p bond-notify -f deploy/docker-compose.yml up -d --build

# Tail logs to confirm the watcher picks up chain 1.
docker logs -f bond-notify-bond-notify-1
```

Smoke: create a tiny bond on mainnet from `bond.futarchy.ai`, confirm the
notification backend picks up the `BondCreated` event.

## Phase 11 — retire Gnosis v0.5

Once mainnet has been live for a comfortable period (say a week with no
issues), retire the legacy line from the live surfaces:

```bash
# frontend/runtime-config.js: drop the `100` entry from chains{} and the
# `gnosis*` keys from the top level.
# backend/config.mjs: drop the hardcoded CHAINS[100] entry. Keep the V5
# ABI export (other places may import it) but remove the chain registration.
# README.md: move v0.5 Gnosis addresses to a "Legacy" section.

git commit -am "ops(v6): retire Gnosis v0.5 from live UI and watcher"
git push
```

Do NOT touch the deployed v0.5 contract on Gnosis; it stays immutable on
chain forever. The decision is purely about what the live UI shows and
what the watcher emails about.

## Phase 12 — PR + tag

```bash
# Open the PR from spec/v06 -> main.
gh pr create --base main --head spec/v06 \
  --title "v0.6 — SimpleBondV6 on Ethereum mainnet" \
  --body "$(cat <<'EOF'
## Summary
- SimpleBondV6 on Ethereum mainnet at <address>.
- bond.futarchy.ai repointed at mainnet; staging.bond.futarchy.ai runs the same UI against Sepolia.
- Gnosis v0.5 retired from the live UI (contract stays on chain).
- Implements SPEC_V06.md; per PLAN_V06.md.

## Test plan
- [x] 604 hardhat tests passing on this branch
- [x] Sepolia staging used end-to-end for at least <date range>
- [x] mainnet deployment verified on Etherscan
- [x] Notification backend watching chain 1
EOF
)"

# Tag once merged.
git tag -a v0.6.0 -m "SimpleBond v0.6 — mainnet"
git push --tags
```

## Rollback

If anything goes wrong post-cutover:

- **Frontend:** revert the commit that promoted v0.6 to index.html; Netlify
  redeploys the previous v0.5 UI within minutes.
- **Backend:** unset `MAINNET_V6_CONTRACT` env, restart container. Watcher
  reverts to Gnosis-only.
- **On-chain:** the v0.6 contracts are immutable. There is no rollback of
  the deployment itself, only of the UI/backend pointing at them. The
  legacy Gnosis v0.5 contract is untouched and remains the fallback.
