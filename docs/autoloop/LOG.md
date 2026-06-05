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

## Iteration 13 — 2026-06-05 — v0.7 STEP 0+1: SimpleBondV7 scaffold + C1 (PROGRESS)
- contracts/core/SimpleBondV7.sol = V6 fork (V6 byte-for-byte UNCHANGED, still live), reusing registries/ManualJudgeV6.
- C1: challenge() gate now require(pendingCount < maxChallenges) (pre-increment → invariant holds); hard
  MAX_CHALLENGES_CEILING=100 in createBond (the settle-loop gas-bomb safety lock).
- Tests test/core/v7/SimpleBondV7.challenge.test.js: lockout-fix proven (cap=2, file 2, 3rd reverts, judge
  rejects 1, refile SUCCEEDS, getChallengeCount==3 while pendingCount==2), invariant loop, ceiling 101-revert/100-ok.
- 3/3 verdicts pass incl. an adversarial search finding NO path to inflate pendingCount. Full hardhat 769 passing; lint G1=41.
- Next: STEP 2 = C2 credit ledger ([recipient][token] credits, claim() CEI+nonReentrant, settle loops, delete
  claimRefunds/refundCursor/ChallengeRefunded; reentrancy + fee-on-transfer mocks; rewrite invariants/resolution tests).

## Iteration 14 (+ C2b fix) — 2026-06-05 — v0.7 STEP 2: C2 credit ledger (PROGRESS, critical bug caught+fixed)
- C2: per-address credits[recipient][token] + claim() (CEI + nonReentrant); all outbound-to-untrusted →
  credits; judge fee stays inline; settle loops credit all pending; deleted claimRefunds/refundCursor/ChallengeRefunded.
  Mocks: MockReentrantToken, MockFeeToken. Rewrote invariants/resolution tests to the credit model.
- SECURITY PANEL CAUGHT A CRITICAL EXPLOIT (verdict FAILED, commit blocked): the settle loop scanned the FULL
  cumulative challenges[] array (C1 makes it unbounded via O(1)-capital spam→reject→refile). Ceiling bounds
  pendingCount, NOT array length → ~8.7k entries makes EVERY settle path exceed block gas → bond unsettleable →
  ALL funds stranded forever. The 44 tests missed it (N=4-6 only). This is the #1 unsafe option SPEC_V07 named.
- C2b FIX: pendingIds[bondId] live-set + pendingPos for O(1) swap-pop; every settle loop now iterates the live
  pending set (≤ ceiling), independent of array length. Numeric proof: 1203-entry settle 184,577 gas vs 3-entry
  186,577 (0.989×). New SimpleBondV7.settleLoopBound.test.js (4 cases). 3/3 security verdicts pass on re-verify.
- Gates: V6 UNCHANGED; compile clean; full hardhat 809 passing; lint G1=41. Cleaned verifier probe files.
- This is the marquee example of the adversarial-verification design: green tests would have shipped a fund-loss bug.
- Next: STEP 3 = clone scripts/v7 deploy + Sepolia deploy (testnet-first; stop at deploy if gas/funds-blocked).

## Iteration 15 — 2026-06-05 — v0.7 STEP 3: SimpleBondV7 deployed to Sepolia + verified
- Deployed SimpleBondV7 to Sepolia at 0x71e15D42bE15BAE117096E12C9dBA25E67d14C67 (block 10992602),
  reusing the existing v6 registries/judge/token (constructor takes judgeProfileRegistry). Guarded deploy
  script scripts/v7/deploySimpleBondV7.js (refuses if balance < est*1.15). Actual cost 0.041 ETH.
- Read-only verify: MAX_CHALLENGES_CEILING=100, credits() ledger readable, judgeProfileRegistry wired,
  refundCursor GONE (confirms it's V7 not V6). deployments/sepolia-v7.json written.
- STEP 4 (live multi-actor capability JOURNEY on Sepolia) is FUND-CONSTRAINED: deployer has ~0.019 ETH left
  and a full poster/challengers/judge journey needs more Sepolia ETH + MockSUSDS distribution. The mechanism
  behavior is exhaustively covered by the hardhat suite (809 tests incl. lockout-fix, concede→credit→claim,
  multi-pending settle, conservation, reentrancy, settle-loop-bound). EXTERNAL BLOCKER: fund 0x693E…b43d with
  Sepolia ETH to run the live journey.
- STEP 5 (cutover) pending: backend abiForChain restructure for bondVersion 7 (+ Credited/Claimed indexing),
  frontend abi.js + runtime-config Sepolia→V7, A4 drain card → per-address claim(). Next tractable iterations.

## Iteration 16 — 2026-06-05 — v0.7 STEP 5a: backend indexer V7 support (PROGRESS)
- config.mjs: V7_CONTRACT_ABI (v6 events − ChallengeRefunded + Credited/Claimed; same bonds()/getChallenge views);
  abiForChain restructured to an explicit ladder (v7→V7, v6→V6, else V5) — closes the SPEC_V07 binary-fallthrough trap.
- watcher.mjs: indexChain gate widened to bondVersion 6 OR 7; Credited re-snapshots the bond, Claimed (no bondId)
  skipped cleanly — no crash. EVENT_RECIPIENTS keeps ChallengeRefunded for the still-live v6 path.
- NO v7 chain registered yet (repoint is a later step) → live behavior unchanged. 3/3 verdicts pass; full hardhat 815;
  new test/backendV7Surface.test.js (6). Deployed to VM (indexer now V7-ready); monitor green.
- Next: STEP 5b = frontend abi.js V7 ABI + A4 refunds UI (drain card → per-address claim() + owed/claim affordance).

## Iteration 17 — 2026-06-05 — v0.7 STEP 5b: frontend version-aware claim UI (PROGRESS)
- bondAbi() selects V7 ABI iff chain bondVersion===7, else V6 (default); bondReadContract/bondWriteContract use it.
  v6 chains BYTE-IDENTICAL in behavior (mainnet safe). v7 bonds: detail reads credits(account,token), shows
  "You are owed ~$X" + Claim button → claim(token) via the guarded write factory (G3/G4 respected).
- New SIMPLE_BOND_V7_ABI (credits/claim/Credited/Claimed; no claimRefunds). v7 e2e fixture + refunds-affordance-v7.spec.js
  (concede→owed→claim→balance moves+clears) green; v6 drain spec still green. 3/3 verdicts pass; full local e2e 59; v6 in sync.
- Next: STEP 5c = repoint Sepolia (runtime-config bondVersion:7 + V7 addr; backend Sepolia env → V7) so staging runs v0.7. Mainnet stays v6.

## Iteration 18 — 2026-06-05 — v0.7 STEP 5c: repoint Sepolia to v0.7 (CUTOVER, staging)
- frontend/runtime-config.js Sepolia → SimpleBondV7 (0x71e15D42…C67, deployBlock 10992602, bondVersion:7), reusing
  registries/judge/token. config.mjs: SEPOLIA_V7_CONTRACT env flips the Sepolia indexer entry to bondVersion:7 (V7 ABI).
- MAINNET (chain 1) UNCHANGED — still v6. Mainnet cutover is a separate later gate, never autonomous.
- Verified: config flip → Sepolia v7 + Credited/Claimed ABI; mainnet entry untouched. Gates green (16 surface tests).
- Deploying to VM with SEPOLIA_V7_CONTRACT set; reset Sepolia index cursor to the V7 deploy; cleared stale v6-Sepolia rows.
- v0.7 cutover on STAGING (staging.bond.futarchy.ai) COMPLETE. Mainnet stays v6 pending the owner's go + the live capability journey.

## Iteration 19 — 2026-06-05 — backend follow-ups burn-down + 5c regression repair (PROGRESS)
- 3 follow-ups done: (1) handleRegister honest message when EMAIL_ENABLED=false ("Subscription recorded… not yet
  enabled"); (2) indexBondState bonds() failure now throws IndexLayerError → holds checkpoint + retries next tick
  (no silent loss); (3) indexChain distinguishes a getLogs failure (sub-chunk/dead-letter) from an indexLogs/DB
  error (IndexLayerError, surfaced, checkpoint held — not misclassified as poison). 3/3 verdicts pass; 15 backend tests.
- SELF-CAUGHT REGRESSION: STEP 5c (Sepolia→v7) made SimpleBondV6FrontendSurface.test.js fail (it asserted Sepolia
  bondVersion:6). I had run only a surface subset after 5c and missed it (full hardhat went red on push). Fixed the
  assertion to expect Sepolia v7 (intended cutover). Full hardhat now 818 passing / 0 failing — main green again.
- Process note: run the FULL `npx hardhat test` (not a subset) after any runtime-config/contract change.

## Iteration 20 — 2026-06-05 — docs accuracy post-v0.7 cutover + doc-as-test (PROGRESS)
- Closed RCA gap #7 (I11 prose-drift): the README implied v0.6 everywhere and was stale after the
  Sepolia v0.7 cutover. Rewrote Repository Status + addresses to the true state — mainnet=v0.6
  (what bond.futarchy.ai serves), staging/Sepolia=v0.7 (SimpleBondV7, bondVersion 7) with a one-line
  C1 (pending-cap) + C2 (pull-payment credit ledger) summary; mainnet v0.7 cutover explicitly NOT done
  (separate later gate). Dated CHANGELOG v0.7 staging entry (states mainnet stays v0.6).
- NEW doc-as-test test/tooling/docsAccuracy.test.js (12 assertions): docs must agree with BOTH
  frontend/runtime-config.js (loaded in a vm sandbox) AND deployments/*.json — bondVersion per chain,
  bondContract === deployment record address; anti-overclaim guard FAILS on any premature v0.7-on-mainnet
  claim; address/version-drift guard. Both required failure modes negative-tested (perturb → fail → restore).
- 3/3 verdicts pass (docs-accurate, test-catches-drift, no-regress). Gates re-run MYSELF (per the iter-19
  process rule): full `npx hardhat test` 830 passing / 0 failing; lint EXIT=0 (g1 baseline 41).
- Burn-down: rcaOpenGaps 7 → 6; docDrift 0 (now actually enforced by a test, not assumed). Committed 3bb2b1e.
- Sepolia deployer 0x693E…b43d ≈ 0.0338 ETH (< 0.05 gate) → live capability journey still parked.
- Next: funded → live V7 capability journey; else next polish (RCA gap #3 withTimeout empty-vs-error,
  #5 allowanceCache account-keying, #6 getCode page-chain probe, or A2-followup all-zero-timing state).

## Iteration 21 — 2026-06-05 — A6/gap #6: getCode page-chain probe (PROGRESS)
- Closed RCA gap #6 (the "No contract code at 0x… on Ethereum" incident class TGGP hit). New pure helper
  frontend/contract-probe.js (dual-export like phase.js): classifyContractCode(code) → 'absent' for resolved
  empty code (null/''/'0x'/'0X'/'0x0', trimmed/case-insensitive), 'present' for real bytecode, 'unknown' ONLY for
  a non-string (the thrown/timeout sentinel); contractPresenceMessage({state,address,chainName}) → fail-closed
  "No SimpleBond contract found at <addr> on <chain>…" / transport note / "".
- Wired into frontend/index.html + frontend/v6/index.html (kept in sync): probeContractPresence() calls the EXISTING
  readProvider().getCode (no new keyed provider — G5 safe; getCode ≠ getLogs — G4 safe) at the top of loadBrowseData,
  cached per (chainId,address). 'absent' → short-circuits reads, renders #contractAbsantBanner, and blocks writes via
  isContractConfirmedAbsent() inside requireWalletOnActiveChain() (the central write choke-point). 'unknown' (getCode
  threw / 10s timeout) → soft transient note, NOT sticky, never blocks (a flaky RPC can't brick a real deployment).
  Mainnet v6 + Sepolia v7 both have code → 'present' → no banner, all actions enabled (happy path untouched).
- Adversarial panel 3/3 PASS (no-regression, probe-correct, test-quality). The test-quality lens flagged two VACUOUS
  surface assertions (W1: getCode/probe-invocation not uniquely tied to the new code since 3 pre-existing getCode calls
  exist; W2: the 'unknown'-soft window also caught the later `= null` reset). I TIGHTENED both myself: bound getCode
  inside probeContractPresence, bound the awaited call to loadBrowseData + the `=== 'absent'` short-circuit, and made
  the unknown assertion require `= msg;` then `return state;`. Negative-tested all three perturbations → NOMATCH.
- Gates re-run MYSELF: full `npx hardhat test` 864 passing / 0 failing; lint EXIT=0; docker e2e 59 passed / 4 skipped,
  all 7 capabilities re-confirmed true. Burn-down: rcaOpenGaps 6 → 5.
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- Next: funded → live V7 journey; else RCA gap #5 (allowanceCache not keyed by account) or #3 (withTimeout empty-vs-error).

## Iteration 22 — 2026-06-05 — gap #5: allowanceCache account-keying (PROGRESS)
- Closed RCA gap #5 (money-path correctness): the ERC-20 allowance cache was keyed `${token}:${spender}` with NO
  account/chainId, so connecting account A (approved) then switching MetaMask to B (not approved) served A's allowance
  under the shared key → UI SKIPPED the Approve step → B's createBond/challenge REVERTED (insufficient allowance).
- New pure helper frontend/allowance-key.js (dual-export like phase.js/contract-probe.js): allowanceKey({chainId,
  account,token,spender}) → `${chainId}:${account}:${token}:${spender}` (addresses lowercased, chainId stringified,
  null account → 'noaccount' sentinel, never throws, pure). Wired into all 3 cache sites in index.html + the v6 mirror
  (ensureApproval, createBond preflight, challenge preflight), reusing the SAME account var the allowance() read uses so
  write/lookup stay consistent. accountsChanged handler now clears allowanceCache (belt-and-suspenders).
  Same-account happy path unchanged (still caches + skips redundant approves).
- Adversarial panel 3/3 PASS with explicit non-vacuous negative tests (revert each part → exact surface/unit failure
  counts 4/2/1/1). A stale TS "chainId/account never read" diagnostic appeared — I read the file: line 72 returns the
  4-part key and both vars ARE read; the diagnostic was captured during the verifier's transient token:spender revert.
- Gates re-run MYSELF: full `npx hardhat test` 882 passing / 0 failing; lint EXIT=0; docker e2e 59 passed / 4 skipped,
  all 7 capabilities true. Burn-down: rcaOpenGaps 5 → 4.
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- Next: funded → live V7 journey; else RCA gap #3 (withTimeout empty-array vs error distinction).

## Iteration 23 — 2026-06-05 — gap #3: timeout-vs-empty distinction (PROGRESS)
- Closed RCA gap #3 (a timed-out/errored read masquerading as "no bonds"). New pure helper frontend/async-util.js:
  withTimeoutResult(promise, ms) → tagged {status:'ok',value} / {status:'error',error} / {status:'timeout'}, never
  rejects (resolve/reject mapped to a non-rejecting wrapper raced against a timer; the promise outcome wins when it
  settles first). Wired into the THREE list-DETERMINING reads in index.html + v6 mirror: BROWSE nextBondId (was the
  silent 0n fallback → now {rows:[],error} + retry message), MY BONDS poster/challenger/judge RPC fallbacks (per-role
  error threaded into a new renderMySection error branch, checked BEFORE the empty hint), BONDS JUDGED fallback. A
  GENUINE empty (ok-0 / empty list) still shows the friendly empty state — verified it does not over-fire. Best-effort
  reads (claim-preview logs, getCode, safeRead) left on the old withTimeout.
- Adversarial panel: fixes-bug ✅, test-quality ✅, no-regression ❌ — the no-regress lens caught a FLAKY test
  (asyncUtil.test.js ~1/5 failures under full-suite event-loop saturation; both this and the iter-22 verifier observed
  CONCURRENT hardhat processes from the parallel verifier agents starving real timers). Impl itself was correct.
  QUARANTINE-THEN-FIX: I made the timer-dependent "WINS" assertions deterministic (already-settled promises beat any
  setTimeout via microtask ordering — robust under load), then confirmed stability MYSELF: full `npx hardhat test`
  ×3 = 902 passing/0 failing each; isolated asyncUtil ×3 = 9/9 each.
- Bonus: G1 empty-catch 41 → 40 (the bonds-judged catch now has a body); tightened scripts/.lint-baseline.json to 40
  to lock the gain. Restored a screenshot png that earlier e2e runs had byte-churned (kept the commit clean).
- Gates re-run MYSELF: hardhat 902 passing / 0 failing (×3 stable); lint EXIT=0 (baseline 40); docker e2e 59 passed /
  4 skipped, all 7 capabilities true. Burn-down: rcaOpenGaps 4 → 3; g1 41 → 40.
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- Next: funded → live V7 journey; else A2-followup (phaseFor all-zero-timing → 'timing unavailable'), then UX niceties.

## Iteration 24 — 2026-06-05 — A2-followup: phaseFor timing-unavailable state (PROGRESS)
- Fixed a misleading-state bug (same family as gap #3): when a Pending challenge's on-chain timing reads failed to load
  (all-zero timing), phaseFor fell through to TIMEOUT_CLAIMABLE and told the viewer "ruling window passed; claim the
  timeout refund" — false, and could push a reverting claimTimeout. Added PHASE.TIMING_UNAVAILABLE and a guard (after
  the terminal branch, before concession): if !(T0>0) || !(rulingDeadline>0) || rulingDeadline<T0 → return an honest
  "timing not loaded; refresh/retry; no window has expired" state. Valid timing byte-for-byte unchanged (strict
  rulingDeadline<T0 so the rd==T0 edge stays concession/ruling, no over-fire).
- Wired into index.html + v6 mirror: timing-unavailable shows the reason, highlights no timeline step; the claimTimeout
  button gate reordered to lead with rulingEnd>0 (it already had the conjunct; locked it + the absence of the legacy
  precondition-free form with non-vacuous surface assertions). Mainnet v6 behavior safe (real bonds always have timing).
- Adversarial panel 3/3 PASS (fixes-bug, no-regression, test-quality) with explicit non-vacuity (disabling the guard →
  phaseFor.test.js RED reproducing the exact bug). A stale TS "unreachable code at phase.js:210" + "rulingDeadline
  never read" diagnostic appeared — verified against the real file: line-210 was the verifier's transient `if(false)`
  mutation (restored), and line-91 is a pre-existing unused param in concessionReason; both non-issues.
- Gates re-run MYSELF (sequential): full `npx hardhat test` 938 passing / 0 failing (×2 stable); lint EXIT=0 (g1 40);
  docker e2e 59 passed / 4 skipped, all 7 capabilities true. Burn-down unchanged (rcaOpenGaps 3, g1 40) — this is a
  UX-correctness fix, not an RCA-gap closure.
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- NOTE: the high-value tractable RCA gaps (#3/#5/#6/#7) + this A2-followup are now done. Next tick: if no clearly
  high-value UX/correctness item remains, run a skeptical-senior-eng critic to re-prioritize rather than manufacture
  cosmetic churn; the real remaining work (live Sepolia journey, mainnet v0.7 cutover) is gated on funding/owner-go.

## Iteration 25 — 2026-06-05 — backlog #1: version-aware challenge-capacity gate (PROGRESS)
- Fixed a LIVE MAINNET money-waster surfaced by the iter-24 re-prioritization audit: the frontend gated the Challenge
  card on pendingCount<maxChallenges for BOTH versions, but v6 (mainnet) caps challenge() on challenges[].length
  (TOTAL-ever, SimpleBondV6.sol:266) while v7 caps on pendingCount (SimpleBondV7.sol:391). So a much-challenged v6
  bond (pendingCount back to 0, total filings == max) still showed a Challenge card → user paid a real approve + a
  reverting challenge() tx. New pure helper frontend/challenge-capacity.js: hasChallengeCapacity({bondVersion,
  pendingCount,challengeCount,maxChallenges}) → v7: pending<max; v6/default: challengeCount<max; fail-closed on
  missing/0 max. Wired into canChallenge in index.html + v6 mirror (challengeCount already read at 3477; dropped the
  dead <=100 conjunct). Create-form maxChallenges label now version-aware (v7 "pending at once" vs v6 "total ever filed").
- Adversarial panel 3/3 PASS with the exact production-bug regression locked: {v6,pending:0,challengeCount:3,max:3}→false
  (card hidden), {v7,pending:1,challengeCount:9,max:3}→true. Non-vacuity re-verified (revert→RED→restore). No-regression
  lens confirmed challengeCount is genuinely in scope (else v6 would hide ALL challenges — a worse bug).
- Gates re-run MYSELF (sequential): full `npx hardhat test` 973 passing / 0 failing (×2 stable); lint EXIT=0 (g1 40);
  docker e2e 59 passed / 4 skipped, all 7 capabilities true. Burn-down unchanged (this is a UX-correctness fix, not an
  RCA-gap closure). Committed.
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- Next (per refreshed BACKLOG.md): #2 global v0.7 claimable-credits indicator → #3 README interface fix → #4 docs-as-test
  ABI-signature assertion → optionally #5-#8 → then wind down.

## Iteration 26 — 2026-06-05 — backlog #2: global v0.7 claimable-credits indicator (PROGRESS)
- Fixed the central push->pull discoverability regression: v0.7 C2 made refunds pull-only (credits[recipient][token],
  drained by claim(token)), but claim() was surfaced ONLY on the per-bond detail card — an owed user had to revisit the
  exact bond page. Added a GLOBAL "You have ~$X claimable across your bonds" banner to the My Bonds page. New pure helper
  frontend/credits-banner.js (myCreditsBannerHtml; "" for <=0, never throws). loadMyBonds, gated behind isV7 && account,
  reads credits(account, chain().approvedToken) in a try/catch (RPC error -> no banner, never blanks My Bonds) and fills
  #myCreditsBanner; new My-Bonds-scoped doClaimCreditMyBonds(token) calls claim(token) and re-renders renderMyBonds so the
  banner clears. Amount derived from the real credits() value (no fabrication; '—' on rate miss).
- v6/mainnet BYTE-IDENTICAL at runtime: the whole block is bondVersion===7-gated, so v6 makes no extra credits() RPC and
  shows no banner. index.html + v6 mirror in sync (modulo script-path).
- Adversarial panel 3/3 PASS, non-vacuity re-verified (mutate helper -> unit RED; git checkout the feature -> 13 surface
  assertions RED across both files; restored). The "first-run 13 failing" caveat was the verifier's OWN revert test, not a
  real failure.
- Gates re-run MYSELF (sequential): full `npx hardhat test` 996 passing / 0 failing (×2 stable); lint EXIT=0 (g1 40);
  docker e2e 60 passed / 4 skipped (incl. new test #52: concede -> My-Bonds banner -> Claim pulls it + clears), all 7
  capabilities true. Restored the e2e-churned my-bonds.png. Burn-down unchanged (UX feature, not an RCA-gap closure).
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- Next (BACKLOG.md): #3 README Contract Interface -> deployed V6 ABI (docs) → #4 docs-as-test ABI-signature assertion →
  optionally #5-#8 (backend crash-guard, Sepolia monitor, email copy, alert->inline) → then wind down.

## Iteration 27 — 2026-06-05 — backlog #3+#4: README interface -> compiled ABI + signature docs-as-test (PROGRESS)
- Closed the signature-drift class that survived 24 iterations. #3: the README "## Contract Interface" documented RETIRED
  v0.5 signatures under a "v0.6 is live" banner (createBond had a removed `deadline` + omitted maxChallenges/judgeProfileId/
  claimContent; concede/ruleFor*/claimTimeout/getChallenge/ruling*Deadline omitted the per-challenge index `i`). Rewrote it
  into two grouped solidity blocks — SimpleBond core (SimpleBondV6) and the ManualJudgeV6 ruling wrapper (bondContract-first
  args) — with signatures matching the COMPILED ABIs exactly, plus a V7-only note (claim(token)/credits(recipient,token),
  pending-set maxChallenges). Anti-overclaim/"mainnet stays v0.6" framing kept intact.
- #4: extended test/tooling/docsAccuracy.test.js — parses the README Contract Interface solidity fences, routes ruleFor*/
  reject* to the ManualJudgeV6 ABI and the rest to SimpleBondV6, and asserts each documented function EXISTS and its param
  COUNT matches the compiled ABI input count (ABI read via hardhat artifacts.readArtifact, the authoritative source — not
  prose/abi.js). Non-vacuity proven: dropping `i` from concede in the README -> RED "concede: README documents 2 arg(s) but
  SimpleBondV6 ABI has 3"; restored -> green.
- Adversarial panel 3/3 PASS. A transient TS diagnostic flagged a verifier scratch file (_verify_abis.js) — checked git
  status myself: already cleaned, tree is only README.md + docsAccuracy.test.js.
- Gates re-run MYSELF (sequential): full `npx hardhat test` 999 passing / 0 failing (×2 stable); docsAccuracy 15 passing
  (12 original + 3 new); lint EXIT=0 (g1 40). No docker e2e (docs+test only, no frontend change). docDrift now also guards
  signatures, not just version/address. Burn-down: docDrift stays 0 but its coverage widened.
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- All 4 HIGH-value backlog items (#1-#4) now DONE. Next: optional medium items #5 (backend crash-guard) → #6 (Sepolia
  monitor) → #7 (templates email copy) → #8 (alert->inline), then WIND DOWN to funding/main-green checks until 2026-06-09.

## Iteration 28 — 2026-06-05 — backlog #5: process crash-guard for the combined API+watcher (PROGRESS)
- Closed an outsized-blast-radius reliability hole: prod runs backend/server.mjs as ONE process serving the API AND the
  indexer; there was NO unhandledRejection/uncaughtException guard, so a single stray async rejection (Node ≥15 default)
  terminated BOTH the live site and indexing until external restart. New backend/process-guards.mjs: registerProcessGuards()
  (idempotent) — unhandledRejection → log + KEEP SERVING (transient fire-and-forget errors must not kill the service);
  uncaughtException → log loudly + onFatal (default process.exit(1)). Confirmed deploy/docker-compose.yml service bond-notify
  has `restart: unless-stopped`, so exit-on-uncaught lets the supervisor restart cleanly (verified by both impl + verifier).
  onFatal injectable so the fatal path is tested without killing the test process. Wired at the very top of server.mjs.
- New test/backend/processGuards.test.js (4 cases): listeners attached, unhandledRejection logs + no exit, uncaughtException
  logs + onFatal once, idempotency. afterEach removes only listeners it added → no leak into the rest of the suite.
- Adversarial panel 3/3 PASS (guard-correct, no-leak, test-quality) with non-vacuity (mutate handler → RED). Minor
  non-blocking note: a redundant 2nd registerProcessGuards call rebinds closures but keeps the 1st listeners live — harmless
  for the single real call site.
- Gates re-run MYSELF (sequential): full `npx hardhat test` 1003 passing / 0 failing (×2 stable); lint EXIT=0 (g1 40).
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- DEPLOYED to VM futarchy-indexers (/opt/simple-bond → dcaeb8a, `docker compose -p bond-notify up -d --build`):
  /api/notify/health "ok", chain 1 lag 12 / Sepolia lag 6, headAgeSeconds 10, 0 dead-letters, guard registered at boot.
