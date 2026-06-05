# Autoloop Log

## Iteration 0 — 2026-06-04 — baseline established
- Charter, scoreboard, metrics, backlog committed. Run deadline 2026-06-09.
- Baseline gates ALL GREEN: lint, hardhat, e2e(local), deploy-gate, monitor.
- Burn-down: g1EmptyCatch=42, rcaOpenGaps=10, docDrift=0.
- Capabilities: none recorded yet (iteration 1 establishes the staging journey harness).
- Next: iteration 1 = design workflow — produce the v0.7-for-UX + backend-reliability
  roadmap and a sequenced, testable backlog; do not write contracts yet.

## Iteration 0.1 — 2026-06-04 — S1 keyed RPC (owner-provided, out of band)
- Alchemy eth-mainnet wired BACKEND-ONLY (VM MAINNET_RPC). Preflight RPC warning cleared for chain 1.
- Added lint G5 (zero-tolerance): a keyed provider URL in any frontend/ file fails the build — key stays backend-only.
- Monitor green post-change (rate 0.91, lag 12, 2 bonds). Sepolia still free publicnode (open).

## Iteration 1 — 2026-06-04 — design workflow (31 agents) → roadmap
- Output: 13-item ranked backlog (docs/autoloop/roadmap.json + BACKLOG.md), sequenced
  backend-reliability + capability-harness first, UX next, v0.7 contracts (C1 pending-cap
  maxChallenges, C2 pull-payment credit ledger) last — each UX-motivated, testnet-first.
- First two specced: B1 (watcher multi-RPC FallbackProvider, closes RCA gap #1) and
  H1 (capabilities map into scoreboard — makes working-journeys the headline metric).
- PROGRESS: design deliverable produced (no gate regressions). Next: iteration 2 implements B1.

## Iteration 2 — 2026-06-04 — B1 watcher multi-RPC FallbackProvider (PROGRESS)
- Implemented + adversarially verified (4/4 skeptic checks incl. mutation tests killing the impl → tests fail).
- Gates: lint G5 clean, 18 backend tests green (new failover + all-fail no-skip), monitor green.
- Deployed to VM with MAINNET_RPCS = Alchemy primary + publicnode backup (failover live); lag 12 (healthy).
- Burn-down: rcaOpenGaps 10 → 9 (gap #1 closed). Next: iteration 3 = H1 capability-journey harness.

## Iteration 3 — 2026-06-04 — H1 capability-journey harness (PROGRESS)
- aggregate-capabilities.mjs: sole writer of capability flags from the Playwright JSON report;
  skipped/failed/missing NEVER yield true (7 unit tests + 10 adversarial mutation probes). 3/3 verdicts pass.
- Ran real local e2e (38 passed) → aggregator populated ALL 7 capability flags true:
  createBond, becomeJudge, challengeAndRule, concede, withdraw, drainRefunds, claimTimeout.
- The loop now has a gaming-resistant headline metric (CHARTER §3). Next: iteration 4 = A1 staleness banner (RCA gap #2).

## Iteration 4 — 2026-06-04 — A1 staleness banner + threshold fallback (PROGRESS)
- Browse consumes /api/bonds meta.blocksBehindHead; STALE_THRESHOLD=50 (> ~12 confirmation margin).
  Below: indexer rows, no banner. Above: banner + transparent direct-RPC fallback (no new getLogs, G4 clean).
- 3/3 verdicts pass (behavior proven with mutation tests killing both branches); new browse-staleness.spec.js
  (2 tests) + full local e2e 40 passed; mirrored to v6.
- Bonus: refactor removed an empty catch → G1 baseline 42 → 41 (locked). rcaOpenGaps 9 → 8 (gap #2 closed).
- Next: iteration 5 = B3 (bond detail loads from indexer point-read; depends B1 ✓).

## Iteration 5 — 2026-06-04 — B3 bond-detail indexer-first paint (PROGRESS)
- renderBondDetail now paints claim text + per-challenge rows instantly from GET /api/bonds/:id, then
  enriches live timing/roles via eth_call; removed the detail-page claim-text getLogs (gap #9). Indexer
  unavailable → graceful RPC fallback. 3/3 verdicts pass (paint proven by racing a 1.5s-delayed RPC; getLogs=0).
- New bond-detail-indexer-first.spec.js (2 branches) + full local e2e 42 passed; mirrored to v6; lint G1=41.
- rcaOpenGaps 8 → 7 (gap #9 closed). Next: iteration 6 = A2 per-challenge status timeline (why-no-action sentences).

## Iteration 6 — 2026-06-04 — A2 per-challenge phase timeline (PROGRESS, with a fix sub-iteration)
- A2 first pass implemented phaseFor() + reason sentences; adversarial panel CAUGHT 2 real bugs the
  30 unit + 45 e2e missed: (1) modeled a non-existent concession→ruling gap (contract makes
  concessionDeadline == rulingWindowStart); (2) role-agnostic reasons wrong for the judge, who can
  rejectChallenge throughout the pending lifetime (no timing gate). NOT committed.
- Iteration 6b fixed both (adjacent two-phase model at T0; role-aware reasons via viewerRole) and
  re-verified: 3/3 verdicts pass, phaseFor 41 unit tests, full local e2e 45 passed, files in sync.
- New frontend/phase.js (pure phaseFor) + test/frontend/phaseFor.test.js + challenge-phase-timeline.spec.js.
- Loop-quality note: green tests alone did NOT earn a commit — the adversarial panel did. Working as designed.
- Minor follow-up logged (non-blocking): all-zero timing (RPC degradation) → phase vs button-guard mismatch.
- Next: iteration 7 = A3 USD consistency (same bond reads identically across Browse/My-Bonds/detail).

## Iteration 7 — 2026-06-04 — A3 USD consistency (PROGRESS)
- The same bond now reads the identical USD amount across Browse, My-Bonds, and detail; risk/reward
  card agrees with the belief card. Switched My-Bonds rows + risk/reward from raw fmtUnits to the
  canonical susdsBigIntToUsdString; funding-card wallet balances + judge-fee write-input left out of scope.
- 3/3 verdicts pass; new usdConsistency.test.js (non-1:1 rate, 6 tests) + usd-consistency.spec.js
  (identical-string e2e across 3 views); full local e2e 46 passed; v6 in sync; lint G1=41.
- Next: iteration 8 = A4 refunds-aware UX (owed $X / N slots; drain control only when refundable).
