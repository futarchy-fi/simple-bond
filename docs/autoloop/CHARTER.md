# SimpleBond Autonomous Improvement Loop — Charter

This file is the constitution for an unattended multi-day improvement loop.
Any context (fresh or resumed) and any workflow agent MUST read this before acting.

## Mission

Push the bond **mechanism to v0.7+** (grounded in `SPEC_V06.md`) **in service of
user experience**, backed by a **solid, RPC-independent backend** on the GCP box.
**User experience is the north star** — mechanism and backend changes are means
to a better UX, not ends in themselves.

## Operating context (why the autonomy is safe)

- **No real users and no real funds** are on the current contracts/site (owner-stated).
- Therefore the loop may deploy freely. The ONLY backstop on quality is the metric
  + adversarial-verification design below — there is no human in the loop.

## Boundaries (hard rules)

- ALLOWED: edit/commit/push frontend, backend, docs, tests, deploy scripts to `main`;
  Netlify auto-deploys frontend; deploy backend to the `futarchy-indexers` GCP VM;
  deploy **new contract versions to Sepolia first**, verify, then cut over mainnet.
- TESTNET-FIRST: any new contract version (v0.7+) ships to Sepolia and must pass its
  full suite + capability tests there before any mainnet deploy.
- NEVER: move real funds; touch unrelated infra; spend beyond the daily token budget;
  leave `main` red; cut over to a contract that hasn't passed Sepolia capability tests.
- Gas: if a mainnet deploy is gas-constrained, stay on Sepolia and log the blocker.

## Objective function (how "progress" is judged without a human)

An iteration counts as PROGRESS only if **all invariant gates stay green** AND at
least one of: a burn-down counter dropped · a new capability test passes · the
adversarial panel confirms a quality improvement with no regression elsewhere.
Cosmetic churn does not count. Gaming a metric is a failure, not a win.

### 1. Invariant gates (floors — never regress)
- `node scripts/lint-guardrails.mjs` exits 0 (G1 baseline never rises; G2/G3/G4 = 0)
- Hardhat tests green (`npx hardhat test`)
- Local Playwright e2e green (`./scripts/e2e-docker.sh --project local`)
- Deploy gate green (`scripts/v6/verifyDeployment.js` on the active network)
- Prod monitor green (`node scripts/monitor.mjs`) after any deploy

### 2. Burn-down counters (finite, uncheatable — lower is better)
- `g1EmptyCatch` (the lint baseline, 42 → 0)
- `rcaOpenGaps` (the RCA open list, 10 → 0; see BACKLOG.md)
- `brokenWikiLinks`, `docDrift`

### 3. Capability tests (behavioral — each green flow is real progress)
Scripted end-to-end journeys on staging (Sepolia): create-bond, become-judge,
challenge → rule, concede, withdraw. New passing journeys are the primary signal.

### 4. Adversarial quality score (for subjective UX/prose)
A panel of independent judge-agents scores against a rubric; a change counts only
if it beats the prior score AND trips no gate. The panel also tries to REFUTE each
change (the verification pattern that replaces human review).

## Loop mechanism

`workflow → evaluate → workflow`, self-paced (ultracode). Each iteration:
1. Read CHARTER + BACKLOG + LOG + run `scripts/scoreboard.mjs`.
2. Pick the highest-value backlog item (or regenerate the backlog if stale).
3. Run an ultracode workflow that implements it AND adversarially verifies it.
4. Gate: if any invariant regresses, revert; else commit + deploy + update metrics.
5. Append an honest entry to LOG.md (what, metric deltas, next). Schedule next wake.

## Stop / safety criteria
- Hard stop after **3 consecutive no-progress iterations** → regenerate the backlog
  with a "what would a skeptical senior eng do next" critic instead of spinning.
- Stop at the run deadline (set in LOG.md iteration 0).
- On any gate that cannot be made green, STOP that line of work, revert, log the
  blocker, and move to the next backlog item — never force-push past a red gate.
