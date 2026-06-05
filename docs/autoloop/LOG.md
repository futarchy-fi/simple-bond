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

## Iteration 8 — 2026-06-04 — A4 refunds-aware UX (PROGRESS, spec self-corrected)
- Drain control now renders ONLY when refundableSlots>0; viewer sees "You are owed ~$X (N slots)".
- The implementer CORRECTED the spec from contract truth: Conceded(3)/RejectedByJudge(4) are refunded
  INLINE at concede/reject time, so the ONLY drainable status is settled+Pending(0) — counting the others
  would resurrect the no-op claimRefunds this change removes. Corroborated by SimpleBondV6.resolution.test.js:290.
- Found+fixed 2 real bugs during e2e: ethers v6 Result `in`-operator false-negative; refundCursor scans the
  index SPAN not the count (maxCount default fixed so D2 stays green).
- New frontend/refunds.js (pure computeRefunds) + computeRefunds.test.js (18 cases) + refunds-affordance.spec.js
  (3 e2e: no-refundable→no-control; conceded→no-control; settled+pending→owed→drain→gone+balance moved).
  3/3 verdicts pass; full hardhat 703 + local e2e 49 passed; v6 in sync; lint G1=41.
- Next: iteration 9 = A5 one-line lifecycle/role banner on bond detail.

## Iteration 9 (+9b) — 2026-06-04 — A5 lifecycle/role banner (PROGRESS, with a fix sub-iteration)
- One-line banner at top of bond detail, derived from the SAME isPoster/isJudgeOperator/canChallenge/
  settled/closed/pendingCount the cards use (single source of truth — can't contradict the buttons).
- Adversarial panel CAUGHT a real bug (again from contract truth): closeBond only blocks NEW challenges;
  a closed bond with pending challenges still lets the judge rule/reject — but the banner said "no challenges
  pending to rule on". 9b fixed it (next-move clause derives from actual actionability, not the state label;
  tests parametrize pendingCount independently). 3/3 verdicts pass.
- New frontend/banner.js (pure bondBanner) + bondBanner.test.js (43) + bond-banner.spec.js (5 e2e incl.
  judge-of-closed-with-pending). Independently re-ran docker e2e: 5/5 banner + full local 54 passed; v6 in sync.
- This run has now caught 2 subtle contract-semantics bugs (A2 phantom gap, A5 closed+pending) that green tests alone would have shipped.
- Next: iteration 10 = A6 wire the opt-in notification flow (reuse /api/notify; honest copy, EMAIL_ENABLED=false).

## Iteration 10 — 2026-06-04 — A6 opt-in notifications (PROGRESS)
- Dead notify bell → working subscribe control wired to the real /api/notify contract (register: signed
  fixed message {address,email,chainId,signature,timestamp}; status reflection; graceful degrade when
  notifyApiBase unreachable). HONEST copy — email is stubbed (EMAIL_ENABLED=false) so UI never promises a
  sent email (says "recorded / delivery coming soon"); deliberately does NOT echo the backend's misleading
  "Verification email sent" 200 message.
- New frontend/notify.js (pure helpers) + notifyHelpers.test.js (10) + notify-bell.spec.js (4 e2e).
  3/3 verdicts pass; independently re-ran docker e2e: full local 58 passed; v6 in sync; lint G1=41.
- Backend follow-up logged: handleRegister returns "Verification email sent" while EMAIL_ENABLED=false —
  backend copy itself should be honest (the UI already compensates). Non-blocking.
- Next: iteration 11 = B2 indexer dead-letter + sub-chunk recovery for poison log windows.

## Iteration 11 — 2026-06-05 — B2 indexer dead-letter + sub-chunk recovery (PROGRESS)
- Poison-window resilience: a window failing after B1 retry is recovered by recursive halving to a 1-block
  floor; only a true 1-block poison is dead-lettered, checkpoint NEVER advances past it (no-skip), re-attempted
  + cleared on later ticks. /health + monitor surface a dead-letter count (M5 probe). 3/3 verdicts pass
  (proven with independent provider probes); 14 backend tests; deployed to VM — dead-letters 0, lag 12, monitor green.
- Follow-ups logged: (i) over-broad catch may misclassify a DB/indexLogs error as a poison block (no data loss,
  just wasted rescans); (ii) pre-existing indexBondState swallows contract.bonds() failure (latent RC1-class gap).
- Next: iteration 12 = B4 last-tick-age health SLO (page within minutes if the watcher wedges/crashes).

## Iteration 12 — 2026-06-05 — B4 last-tick-age liveness SLO (PROGRESS)
- db.indexerStatus() exposes UTC-correct headAgeSeconds; monitor M6 alerts when the watcher hasn't ticked
  within TICK_AGE_THRESHOLD (default 180s) or never ticked. UTC verified across 5 timezones. 3/3 verdicts pass.
- Deployed to VM: tick age 9s, all 4 probes green (lag/bonds/dead-letters/tick-age).
- BACKEND-RELIABILITY LAYER COMPLETE: B1 failover + B2 dead-letter recovery + B4 liveness + B3 indexer-first FE.
- Next phase: v0.7 CONTRACTS (C1 pending-cap maxChallenges, C2 pull-payment credit ledger) — design first,
  then implement+test, then SEPOLIA deploy, then capability-verify, then (only after) cutover.

## v0.7 design — 2026-06-05 — SimpleBondV7 spec + sequenced plan
- 7-agent design pass (contract/security/migration lenses → scored → plan). Wrote SPEC_V07.md + docs/autoloop/v07-plan.md.
- Locked safety calls: hard MAX_CHALLENGES_CEILING=100 in core createBond (prevents settle-loop gas-bomb DoS);
  [recipient][token] credit ledger; claim() CEI + nonReentrant; judge fee stays inline (crediting strands it);
  abiForChain must be restructured before bondVersion:7 (else V5-ABI fallthrough drops Credited).
- Plan order: C1 (pending-cap, smallest) → C2 (credit ledger) → Sepolia deploy → capability-verify → cutover. V6 stays live.
- Next: STEP 0+1 = scaffold SimpleBondV7.sol from V6 + implement C1 + tests (test/core/v7/).
