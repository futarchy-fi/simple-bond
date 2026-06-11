# SimpleBond / bond.futarchy.ai — system architecture

Canonical map of the live system: API, backend, tests, monitoring. Last verified
2026-06-11. Frontend and backend are **separate origins** (Netlify vs GCP VM).

```
 Browser ── https://bond.futarchy.ai ─────────────► Netlify (static frontend/)
    │
    └─ XHR ─ https://api.bond.futarchy.ai/api/* ───► Caddy (TLS) ─► bond-notify :3200
                                                       on GCP VM futarchy-indexers
                                                       (API + chain watcher + heartbeat, SQLite)
 status.futarchy.fi/api/status ◄─ reads /api/notify/health ─┘
    ▲
 @azhermes Telegram bot (VM systemd timer, 15 min) ─ reads status + pulls /api/notify/events
```

Mainnet runs **SimpleBondV6** (`0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`,
chain 1, `bondVersion: 6`). SimpleBondV7 is deployed but **archived/dormant** —
mainnet was never cut over (so existing bonds + judges are preserved). Sepolia
staging runs V7.

---

## 1. API — `https://api.bond.futarchy.ai`

A zero-framework Node `http` server (`backend/api-server.mjs`), CORS-open,
read-only + notification endpoints. Backed by the SQLite read-model the watcher
populates.

### Bonds (indexer read-model)
- `GET /api/bonds?chainId=<id>&poster=|judge=|challenger=<addr>&limit=<n>` — list
  bonds for a role. **This is the indexer-first source the UI should render rows
  from** — each bond already carries `settled`, `settleReason`, `bondAmount`,
  `token`, `pendingCount`, `claimContent`, `challengeCount`, etc.
- `GET /api/bonds/{id}?chainId=<id>` — one bond + its challenges.

### Judges
- `GET /api/judges/profile?address=&chainId=` · `GET /api/judges/profiles?...`
- `POST | PUT /api/judges/profile` — upsert a judge's statement/link.

### Notifications + health
- `POST /api/notify/register` · `GET /api/notify/verify` · `GET /api/notify/status`
  · `GET | DELETE /api/notify/unsubscribe` — email subscription lifecycle
  (HMAC-token verified).
- `GET /api/notify/health` — honest health: per-chain indexer lag
  (`blocksBehindHead`), `headAgeSeconds` (tick freshness), `deadLetters`, plus:
  - `email { enabled, provider, lastSendAgeSeconds, lastHeartbeatAgeSeconds,
    freshnessThresholdSeconds }`
  - `notify { lastSeq, perChain[{ chainId, lastNotifiedBlock, headBlock,
    notifyLagBlocks }] }`
  - HTTP 200 for ok/degraded, 503 only when fully down.
- `GET /api/notify/events?since=<seq>&limit=<n>&chains=<csv>` — append-only
  notification feed (the Telegram bot pulls the delta each tick).

---

## 2. Backend — GCP VM `futarchy-indexers`

- **Host:** `futarchy-indexers` (project `futarchy-prod`, zone `europe-north1-a`,
  ext IP `34.88.170.88`). SSH:
  `gcloud compute ssh futarchy-indexers --project futarchy-prod --zone europe-north1-a`.
  Co-located with the Futarchy subgraph indexers + the RPC proxy.
- **Process:** Docker container `bond-notify`, built from `/opt/simple-bond`
  (`backend/server.mjs`), binds `127.0.0.1:3200`. One combined process:
  - **API server** (`api-server.mjs`)
  - **chain watcher / indexer** (`watcher.mjs`) — polls chains, snapshots bonds +
    challenges into the read-model, writes the notification outbox, and sends
    event emails
  - **email heartbeat** (`heartbeat.mjs`) — a real send every 6h
- **Edge:** host **Caddy** (`/etc/caddy/Caddyfile`) terminates TLS for
  `api.bond.futarchy.ai` → `reverse_proxy 127.0.0.1:3200` (auto Let's Encrypt).
- **Storage:** **SQLite** (WAL) in Docker volume `bond-notify-data:/app/data`
  (`backend/db.mjs`). Tables: `bonds`, `challenges`, `subscriptions`, `email_log`,
  `notify_events` (append-only notification index), `checkpoints` /
  `index_checkpoints` / `chain_heads` / `dead_letters`, `judge_profiles`.
- **Secrets:** `/opt/simple-bond/deploy/bond-notify.env` (gitignored) —
  `BOND_NOTIFY_HMAC_SECRET`, `RESEND_API_KEY`, RPC URLs. Never committed.
- **Frontend** is separate: static `frontend/` published by **Netlify** (site
  `zippy-halva-280c00`) at `bond.futarchy.ai`; talks to the API cross-origin.

### Deploy
- **Backend:** `cd /opt/simple-bond && git fetch origin main &&
  git merge --ff-only FETCH_HEAD && docker compose -p bond-notify -f
  deploy/docker-compose.yml up -d --build`. (Gotchas: ensure the repo dir is owned
  by the SSH user before `git fetch`; use the explicit `git fetch origin main`.)
- **Frontend:** Netlify auto-deploys `main`, but **gated on CI** — see §4.
- **Email provider:** Resend, sending from `noreply@futarchy.ai` (domain verified;
  DKIM/SPF/MX in the Cloudflare `futarchy.ai` zone). Heartbeat target
  `bond-heartbeat@futarchy.ai` (CF catch-all drops it — no bounce, no inbox noise).

---

## 3. Tests

### Hardhat suite — `npx hardhat test` (1169 passing)
72 files: contract unit/fuzz/invariant/audit (V4/V5/V6/V7), backend unit
(`db`/indexer/`mailer`/`heartbeat`/health/config), frontend **helper modules**
(refunds, banner, bond-status, timing-warn, credits, challenge-capacity, …,
each `require`d and exercised), the `*FrontendSurface` text-guards, and the
**inline-script parse gate** (`test/frontend/inlineScriptParse.test.js`).

### Playwright e2e — `scripts/e2e-docker.sh --project local` (87 passing / 4 skipped)
29 specs under `tests/e2e/`: real-browser poster/challenger/judge journeys,
My-Bonds, chain-guards, security-hardening (XSS/claim-hash), status-labels,
indexer-first paint, fault injection. Runs in the
`mcr.microsoft.com/playwright:v1.60.0-noble` image with a `python -m http.server
8765` serving `frontend/`. Live-mainnet smoke (`--project live-mainnet`) guards a
few shipped fixes against real-chain regression.

### Standalone gates
- **Parse gate** — `node scripts/check-inline-scripts.mjs`: `node --check`s every
  inline `<script>` in `index.html` + `v6/index.html`. Catches the load-time
  SyntaxError class (e.g. a duplicate `const` that blanks the page) in ms.
- **Render smoke** — `node scripts/render-smoke.mjs` (`npm run e2e:smoke:docker`):
  headless browser loads the page, asserts the app shell mounts + no load-time
  error. Both gates are proven RED on the regression, GREEN on the fix.
- **Lint guardrails** — `scripts/lint-guardrails.mjs`: static checks (RC1 silent
  fallback, RC4 unguarded writes, RC2 browser getLogs) against a baseline.
- **Deploy-gate** — `scripts/v6/verifyDeployment.js`: every address in the
  committed mainnet deployment record must have bytecode on-chain.
- **Scoreboard** — `scripts/scoreboard.mjs`: live-recomputes lint, reads the heavy
  gates from `docs/autoloop/metrics.json`, and **refuses to report green when that
  cache is stale** (source changed after it was written) — so a fossil gate can
  never read as a live pass.

### CI + branch protection
`.github/workflows/ci.yml`: `lint` (+ fast parse gate) → `test` (hardhat) → `e2e`
(playwright local + live) → `verify-deployment`. `main` is **branch-protected**:
PR required, and `Guardrail lint` + `Hardhat tests` + `Playwright e2e (local +
live)` must pass before merge (no admin bypass). Netlify deploys `main`, so
production only ever serves CI-green code. PR **Deploy Previews** are ungated
(reviewers still get the Netlify preview comment).

---

## 4. Status monitoring

- **`https://status.futarchy.fi/api/status`** — the `futarchy-status` **Cloud Run**
  service (project `futarchy-prod`, region `europe-north1`; source
  `infra/lambda/futarchy-telegram-bot/`: `server.js` + `lib/checker.js`
  `checkAllSystems()`). Deploy:
  `gcloud run deploy futarchy-status --source . --region europe-north1`.
  Bond components, all derived from `api.bond.futarchy.ai/api/notify/health`:
  - `bond_1`, `bond_11155111` — per-chain indexer (lag / tick-age / dead-letters)
  - **`bond_email`** — green **only** if a real or heartbeat email was
    provider-accepted within the freshness window (8h), NOT "a key is configured"
  - **`bond_notify`** — notification-outbox liveness (`lastSeq` + per-chain
    `notifyLagBlocks` vs head) → no silent failure
  - `bond_frontend` — HTTP marker check
- **`@azhermes` Telegram bot** — VM systemd `futarchy-status-bot.timer`
  (`OnCalendar=*:0/15`) → `futarchy-status-bot.service` (`/opt/futarchy-status-bot`,
  state in `state.json`). Reads the status page, alerts on any component
  transition, posts a silent 6h heartbeat + an RPC-health line, and **pulls
  `/api/notify/events`** to post new bonds/judges/challenges.
- **Liveness guarantees:** the 6h email heartbeat makes `bond_email` green ⇒ mail
  is actually flowing; the `notify_events` index + `notifyLagBlocks` make a stalled
  notifier visible rather than silent.

---

## 5. Known issues / improvements

- **My-Bonds re-reads rows from RPC instead of the API (slow load).**
  `renderMySection` (`frontend/index.html`) gets the bond-id *list* indexer-first,
  but then per row calls `bonds(id)` + a per-row sUSDS rate + (for settled bonds)
  `deriveSettleReason`, which does a chunked `getLogs` scan from the deploy block —
  over the browser's free-tier RPC. The API already returns `settleReason`,
  `bondAmount`, `token`, `pendingCount`, etc. **Fix:** render rows from the indexer
  payload, fetch the sUSDS rate once and share it, keep RPC only as fallback.
- **`*FrontendSurface` tests are string-grep** (assert HTML text, never execute) —
  kept as cheap text guards, now backstopped by the parse gate + render smoke.
- **`SimpleBondV6` mainnet source is unverified** on Etherscan/Sourcify (on-chain
  bytecode diverges from the deploy-commit source; needs the original May build).
