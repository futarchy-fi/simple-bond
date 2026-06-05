# Autoloop Backlog — refreshed 2026-06-05 (iteration 24 re-prioritization audit)

Source: skeptical multi-surface audit (frontend / backend / v0.7 contract / docs-tests) +
senior-eng synthesis (workflow weqmdjkdl). Every load-bearing claim verified against source.
Cosmetic/busywork items were deliberately DROPPED (see "Dropped" below).
(The original iteration-1 design backlog is preserved in docs/autoloop/roadmap.json.)

**Verdict:** `windDownRecommended = false` — ranks 1-4 are clearly shippable high-value work
today (frontend/docs only, no mainnet, no funding). Do ranks 1-4, optionally 5-8, then wind
down toward the 2026-06-09 deadline. The real remaining work — the **live Sepolia capability
journey** and the **mainnet v0.7 cutover** — is gated on deployer funding
(`0x693E3FB46Bb36eE43C702FE94f9463df0691b43d`, ~0.0338 ETH, needs >0.05) and the owner's
cutover go, NOT on more code.

## High value (do these)

1. **[high/small] Version-aware `canChallenge` gate + `maxChallenges` label.**
   On mainnet (v6) `canChallenge` gates on `pendingCount < maxChallenges` (index.html:3532) but
   the v6 contract gates `challenge()` on `challenges[].length < maxChallenges` (TOTAL-ever,
   SimpleBondV6.sol:266) -> a much-challenged mainnet bond shows a live Challenge card that costs
   a real approve tx + a reverting challenge tx. v7 (pendingCount) is correct, but the create
   label "Max challenges (total ever filed)" (index.html:2961) is wrong for the v0.7 pending-cap.
   Fix: `isV7 ? pendingCount<max : challengeCount<max` (challengeCount already read at 3476); drop
   the dead `<=100` conjunct; make the label version-aware. Mirror to v6/index.html.

2. **[high/medium] Global "you have claimable credits" indicator for v0.7 pull-payments.**
   v0.7 C2 made refunds pull-only (`credits[recipient][token]`), but `claim()` is surfaced only on
   the per-bond detail card (index.html:3553,3682); an owed user must revisit the exact bond page.
   Email prompt is stubbed. Fix: in renderMySection batch-read `credits(account,token)` and show a
   top-of-list "You have ~$X claimable - Claim" banner wired to doClaimCredit; guard behind isV7
   (v6 byte-identical). e2e: extend refunds-affordance-v7.spec.js.

3. **[high/small] Fix README "Contract Interface" — documents retired v0.5 signatures under a
   "v0.6 is live" banner** (README.md:117-142). Every signature is wrong vs SimpleBondV6.sol:158-168
   (createBond missing maxChallenges/judgeProfileId/claimContent + a removed deadline; concede/
   ruleFor*/claimTimeout/getChallenge/rulingWindowStart omit the per-challenge index `i`).
   Integrators/AI write reverting calls. Rewrite to match the deployed ABI exactly.

4. **[high/medium] Extend docsAccuracy.test.js to assert README function names/arity vs the V6 ABI.**
   The current prose-drift guard checks version/address/anti-overclaim but NOT signatures - which is
   how #3 survived 24 iterations. Parse the README solidity block, load the V6 ABI, assert each
   documented function exists with matching input arity. Pairs with #3 (locks it from recurring).

## Medium value (optional, 1-2 more iterations)

5. **[medium/small] Top-level uncaughtException/unhandledRejection guard** on the combined
   API+watcher process (backend/server.mjs) - one unhandled rejection currently kills the whole
   process (blanks the site AND freezes the indexer). Add `registerProcessGuards()` (testable).

6. **[medium/small] Sepolia (11155111) monitor invocation** - scripts/monitor.mjs is hardwired to
   one CHAIN_ID (default 1), so the v0.7 staging chain the loop keeps changing has NO synthetic
   monitoring. Add a second CHAIN_ID=11155111 invocation (shallower thresholds).

7. **[medium/small] Friendly email copy for the 4 notified-but-undescribed events** (ChallengeRejected,
   ClaimModified, BondClosed, BondOpened) in backend/templates.mjs (config.mjs:226-240 notifies them;
   templates descriptions map 67-78 has no entry -> bare "Event: <Name>"). Add the first templates.mjs
   test (assert no rendered output contains "Event: "). Latent only because email is stubbed.

8. **[medium/small] Replace alert() with the existing inline #posterMsg/#judgeMsg slots** for the
   dispute actions (doConcede/doRule/doRejectChallenge/etc., index.html:3941-4078) - the highest-stakes
   actors get an out-of-place OS alert on failure and no inline success; every other write path uses a
   styled inline card. Mirror to v6/index.html.

## Dropped (cosmetic / busywork / gated — explicitly NOT doing)

- Per-bond credit-aggregation copy wart (low; subsumed by #2's global view).
- Multi-token credit enumeration (latent; launch is single-token, pre-cutover).
- Mobile/a11y restyle (medium-effort polish, flagged closest-to-busywork by the frontend audit).
- Ruling-fee raw-units display (harmless on 18-dec sUSDS).
- Whole-file twin-diff guard (per-feature parity already enforced — busywork).
- api.mjs preflight gap (defense-in-depth for an unused deploy layout).
- Generic "raise coverage %" iterations.
- Deep reorg/rollback handling (real but large-effort, lowest-probability; staging is Sepolia).
- FLOWS.md / SECURITY.md prose refresh (low; batch opportunistically with #3, not standalone).
- Live Sepolia capability journey + mainnet v0.7 cutover — GATED on funding + owner-go, not autonomous.
