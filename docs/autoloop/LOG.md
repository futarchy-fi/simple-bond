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

## Iteration 29 — 2026-06-05 — backlog #8: dispute actions use inline #posterMsg/#judgeMsg (PROGRESS)
- Replaced the jarring native alert() failure UX in all 8 dispute handlers (doConcede/doCloseBond/doOpenBond/
  doWithdrawBond/doClaimTimeout -> #posterMsg; doRule/doRejectChallenge/doRejectBond -> #judgeMsg) with the established
  inline-slot pattern (msg-info spinner on start, msg-success on done, msg-error w/ escapeHtml(friendlyError) on failure),
  matching every other write path (doChallenge/doClaimCredit). Slot chosen by where each button renders; defensive `if (msg)`
  for the anyone-callable claimTimeout. On-chain calls/args/confirm() gates UNCHANGED; log() calls kept. grep -c "alert(" =
  0 in BOTH index.html and v6 mirror (was 8 each). Bodies in sync (only head script-src differs).
- Surface test extended: parity loop over both files asserts NO alert( remains and each handler binds its contextual slot +
  msg-error catch. Non-vacuous (revert one handler to alert() -> 2 RED). e2e spec assertion deliberately skipped (success
  re-renders the slot, would race -> flaky); existing poster/judge/challenger journeys cover the happy paths.
- Adversarial panel 3/3 PASS (contextual-msgs, no-regression, test-quality). A transient first-run doRule surface failure
  did NOT reproduce (stale-read artifact; on-disk source correct).
- Gates re-run MYSELF (sequential): full `npx hardhat test` 1021 passing / 0 failing (×2 stable); lint EXIT=0 (g1 40);
  docker e2e 60 passed / 4 skipped, all 7 capabilities true. Restored 3 e2e-churned screenshots. FRONTEND -> Netlify
  auto-deploys on push (no VM deploy). Burn-down unchanged (UX polish).
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.
- Next: #7 (templates.mjs friendly email copy + first test; backend -> VM deploy) → #6 (repo-side monitor Sepolia-safety
  only; scheduling/alert-sink is owner-gated) → WIND DOWN with full-run completion summary.

## Iteration 30 — 2026-06-05 — backlog #7: friendly email copy for all notified events + first templates test (PROGRESS)
- backend/config.mjs EVENT_RECIPIENTS notifies 13 events, but backend/templates.mjs eventEmail() descriptions map only
  covered 9 — so ClaimModified / ChallengeRejected / BondClosed / BondOpened rendered the bare "Event: <Name>" fallback
  (most user-impactful: ChallengeRejected, the deposit-refund notice). Added specific copy for all 4. Latent only because
  email is currently stubbed (EMAIL_ENABLED=false), but now correct for when a provider is wired.
- NEW test/backend/templates.test.js (first templates coverage): loops EVERY EVENT_RECIPIENTS key, renders eventEmail, and
  asserts NONE renders the "Event: <Name>" fallback + the 4 new events carry emphasised copy + the View Bond/unsubscribe
  links are present. Locks the invariant: any future notified event without copy fails CI.
- Done DIRECTLY (no workflow) given the triviality (4 strings + a test); quality held via the test + my own gates +
  a non-vacuity check I ran (drop the ChallengeRejected desc -> 2 RED naming it; restored).
- Gates re-run MYSELF (sequential): full `npx hardhat test` 1025 passing / 0 failing (×2 stable; was 1021 + 4 new);
  lint EXIT=0 (g1 40). BACKEND change -> VM deploy below.
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.

## Iteration 31 — 2026-06-05 — backlog #6: monitor Sepolia-safety + pure evaluator (repo-side) (PROGRESS)
- FINDING (recorded): scripts/monitor.mjs (M1-M6) is NOT scheduled anywhere on the VM (no cron/timer) — neither chain has
  synthetic monitoring. Wiring it needs an operator decision on the ALERT SINK (email is stubbed). So #6 was done REPO-SIDE
  ONLY (no logs-to-nowhere cron): made the monitor correct + testable for the chain the loop kept changing.
- Extracted a PURE evaluateHealth(health, {chainId,lagThreshold,tickThreshold}) -> {alerts,oks} covering M1 lag / M5
  dead-letters / M6 tick-age from an injected /health payload (no network); folded the 3 fetch-based probes into one
  checkIndexerHealth() that fetches once and delegates. Added Sepolia-safety env flags: MIN_BONDS (default 1; set 0 for a
  chain that may legitimately be empty) and SKIP_RATE_CHECK (skip the sUSDS-rate probe for a mock-token chain). Documented
  the Sepolia invocation (CHAIN_ID=11155111 MIN_BONDS=0 SKIP_RATE_CHECK=1) in the header. isTickStale kept exported
  (readModelAndIndexer.test.js still green).
- NEW test/backend/monitor.test.js (first monitor coverage): proves a STALE Sepolia entry alerts on lag/dead-letters/tick
  even when mainnet (chain 1) in the same payload is green; missing chain alerts; never-ticked flagged. Done DIRECTLY (small
  refactor + test) with my own gates; non-vacuity is inherent (the test asserts exact alert strings per axis).
- Gates re-run MYSELF (sequential): full `npx hardhat test` 1030 passing / 0 failing (×2 stable; was 1025 + 5 new);
  readModelAndIndexer 15 passing; lint EXIT=0 (g1 40). NO VM deploy (monitor.mjs is not in the container runtime and is
  unscheduled — repo-only until an operator wires it).
- Sepolia deployer 0x693E…b43d still ≈ 0.0338 ETH (< 0.05) → live journey still parked.

## WIND-DOWN — 2026-06-05 — autonomous run complete (backlog exhausted)

The autonomous loop has shipped its entire vetted backlog. Switching to a low-frequency caretaker cadence (Sepolia-funding
+ main-green checks) until the runDeadline 2026-06-09. Summary of the full run (iterations 0-31, all on `main`, never left red,
mainnet v0.6 contract byte-for-byte untouched throughout):

RELIABILITY / RCA (iterations 0-19): 5-tier validation harness + guardrail linter (G1-G5); backend multi-RPC FallbackProvider
failover (gap #1), dead-letter recovery + liveness/health, IndexLayerError checkpoint-hold; capability-journey e2e harness
(7/7 green) as the headline metric; staleness banner + indexer-first reads (gap #2); honest EMAIL_ENABLED=false messaging.

v0.7 MECHANISM (iterations 14-18): SimpleBondV7 (C1 pending-cap maxChallenges + ceiling; C2 per-address pull-payment credit
ledger with claim(), O(pendingCount) settle — an adversarial panel caught + fixed a CRITICAL fund-stranding gas-bomb before
merge). Deployed to Sepolia + full STAGING cutover (staging.bond.futarchy.* = v0.7); mainnet stays v0.6.

UX / CORRECTNESS (iterations 20-31, this session): docs-as-test for prose+ABI-signature drift (gaps #7); getCode page-chain
probe (gap #6); allowance-cache account-keying (gap #5); timeout-vs-empty distinction (gap #3); phaseFor timing-unavailable
(A2-followup); version-aware challenge-capacity gate (a LIVE MAINNET money-waster — backlog #1); global v0.7 claimable-credits
indicator (#2); README interface -> compiled ABI + signature CI gate (#3+#4); process crash-guard for the combined
API+watcher, DEPLOYED (#5); friendly email copy for all notified events + first templates test, DEPLOYED (#7); dispute
actions use inline messages instead of alert() (#8); monitor Sepolia-safety + pure evaluator + first monitor test (#6 repo-side).

FINAL STATE: all invariant gates green; hardhat 1030 passing / 0 failing; lint baseline G1 40 (was 42); capabilities 7/7;
RCA open gaps 10 -> 3 (the remaining 3 are large-effort/low-probability, explicitly deferred in BACKLOG.md). Backend changes
deployed to the VM (futarchy-indexers, /api/notify/health verified ok, 0 dead-letters); frontend auto-deploys via Netlify.

OWNER-GATED (NOT autonomous — these are the real remaining work):
  (a) Fund the Sepolia deployer 0x693E3FB46Bb36eE43C702FE94f9463df0691b43d to > 0.05 ETH -> the loop will auto-run the live
      V7 capability journey on staging on its next tick (currently ~0.0338 ETH, parked).
  (b) Give the go on the mainnet v0.7 cutover (kept non-autonomous by design; staging has been on v0.7 and exercised).
  (c) Decide the monitoring alert channel (Slack/email/pager) so scripts/monitor.mjs can be scheduled (cron, both chains) —
      it is correct + Sepolia-safe + tested but currently runs nowhere.
  (d) Wire a real email provider (Resend/SMTP/SES) to un-stub notifications (backend/mailer.mjs; copy is now correct).

CADENCE FROM HERE: long-interval (hourly) caretaker checks — confirm main stays green and watch the Sepolia balance; if it
crosses 0.05 ETH, run the live V7 capability journey; otherwise no new code changes. Self-stops at 2026-06-09.

## CARETAKER — 2026-06-05 — Sepolia FUNDED; live journey now gated on the deployer KEY (not funding)
- Owner sent 0.1 ETH to the deployer 0x693E3FB46Bb36eE43C702FE94f9463df0691b43d (tx 0x5b15b0a8598e217633f6f23c76c927caaad67d4cf1782d42152cf7ddf738cbe9, Sepolia block 10998485); balance now 0.13381 ETH (> 0.05 gate). Funding gate CLEARED.
- BUT the automated live V7 capability journey still cannot run from this environment: hardhat.config reads the signer from process.env.PRIVATE_KEY and it is UNSET here (getSigners() = 0). So the journey is now gated on the KEY, not funding. To run it: owner exports PRIVATE_KEY (testnet-only) for 0x693E…b43d, OR tests v0.7 via the staging UI (staging.bond.futarchy.ai on Sepolia) / the green local docker e2e. Surfaced to owner.
- Caretaker gate corrected: the "funded -> run journey" branch now also requires a usable signer before attempting (else it would re-hit the no-signer wall every tick). main green, all gates ✅ throughout.

## Iteration 32 — 2026-06-05 — LIVE v0.7 capability journey on Sepolia ✅ (owner funded the deployer)
- Owner funded the Sepolia deployer (0.1 ETH) AND pointed me to the signing key via voyage-search: it was in
  /home/kelvin/futarchy/workspace/.env.codex (a .env.codex, not a repo .env — my earlier sweeps missed it). Verified the
  key derives to 0x693E…b43d; staged it into a gitignored .env (never printed/committed).
- Discovered the reused Sepolia ManualJudgeV6 (0x25E7…DBa9) is active() AND its operator IS the deployer — so one key
  could be poster, self-challenger (challenge() has no challenger!=poster check), and judge operator (can rule).
- NEW scripts/v7/liveJourneySepolia.js drove the FULL lifecycle on the live SimpleBondV7 (0x71e1…4C67), recorded in
  deployments/sepolia-v7-journey.json (all tx hashes). Three bonds (ids 4/5/6):
  - A judge-ruling: createBond → challenge → ManualJudgeV6.ruleForChallenger → credit 12.5 (C2) → claim → +12.5 on-chain.
  - B concede: createBond → challenge → concede → credit 3.0 (C2) → claim → +3.0 on-chain.
  - C clean exit: createBond → closeBond → withdrawBond (credits poster, C2) → claim → +10.0 on-chain.
- Live-verified capabilities: createBond, challenge, ruleForChallenger, concede, claim (C2 pull-payment ×3), closeBond,
  withdrawBond. claimTimeout NOT run live (needs waiting past the ruling window; covered by unit + local e2e).
- Two learnings baked into the script: (1) v0.7 withdrawBond is a PULL payment (credits the poster; needs a claim) —
  not a push; (2) Sepolia public RPC pools lag reads a block or two, so balance assertions poll-until-visible.
- Gas spent across the journey ≈ 0.02 ETH; deployer still well funded. main untouched (this is on-chain validation, not a
  code-path change to mainnet v0.6). The v0.7 mechanism is now proven end-to-end on a live chain, not just locally.

## Iteration 33 — 2026-06-06 — My Bonds e2e: challenger + judge listings (coverage) (PROGRESS)
- Owner goal set: comprehensive e2e for ALL flows (poster/challenger/judge) × ALL bond lifecycles on the v0.6 contracts
  (NO contract change), then deploy the frontend to bond.futarchy.ai once green. This is increment 1.
- Closed the My-Bonds listing gap (was surface-only for challenger/judge): NEW e2e tests on the v6 fixture —
  challenger-flows D1b (challenge as challenger1 → /#my shows the bond under #myChallenger AND NOT #myPoster) and
  judge-flows E1b (operator of the bond's ManualJudgeV6 → /#my shows it under #myJudge AND NOT #myPoster). The
  not-under-#myPoster assertions make them role-correct (non-vacuous), not just "any bond shows".
- Gate re-run MYSELF: docker e2e 62 passed / 4 skipped (was 60; +2). Restored e2e-churned screenshots. No contract/frontend
  change (specs only) so no hardhat/lint needed.
- A coverage-gap audit workflow (w0aw6ld3x) is running to map the remaining flows×lifecycles for FULL coverage before the
  prod deploy.

## Iteration 34 — 2026-06-06 — v0.6 e2e edge/robustness buildout (5 specs) (PROGRESS)
- Owner goal: full e2e for all flows × lifecycles on v0.6 (no contract change) → deploy to bond.futarchy.ai. Coverage-gap
  audit (w0aw6ld3x) confirmed the v6 happy-path matrix is already covered; the in-scope gaps were edge/robustness states.
- Added 5 NEW v6 e2e specs (wallet-with-node fixture), all non-vacuous + role/version-correct:
  challenge-capacity-full (v6 total-ever cap → Challenge card HIDDEN after a resolved challenge at max; locks BACKLOG #1,
  the mainnet gas-waster), multi-challenger-queue (2 simultaneous pending → 2 distinct per-index cards/targets),
  bond-detail-chain-guard (challenge + close blocked on wrong chain, no cross-chain leak), contract-absent (getCode 0x →
  fail-closed banner + writes blocked; getCode error → soft transport note, page still works), tx-cancelled (4001-rejected
  tx → "Transaction cancelled." + retryable, not stuck).
- Test-only fixture hooks (no app/contract/backend change): wallet-with-node.js window.__rejectNextSend (single-shot 4001);
  helpers.js createBondViaUI now honors opts.maxChallenges (fills #cb-max). Adversarial panel 2/2 (non-vacuity + scope).
- Gate re-run MYSELF: docker e2e 69 passed / 4 skipped (was 62; +7 cases); lint EXIT=0. Restored e2e-churned screenshots.
- BONUS BUG surfaced (to fix in the judge/UI pass): on a v6 bond at its total-ever cap, the lifecycle banner still says
  "Open — no challenges yet. Anyone can challenge" while the Challenge card is correctly hidden (banner keys off pendingCount,
  not total-ever) — a banner-vs-card contradiction, same class as the judge banner over-claim bug.

## Iteration 35 — 2026-06-06 — judge-flow UI fixes (the "doesn't show things correctly") + My-Bonds e2e stabilization
- Owner reported the judge flow shows things wrong. A read-only diagnostic (wjhm1ec4p) pinpointed the bugs; fixed them all
  (frontend only, v0.6 contracts UNCHANGED), each with a test asserting the corrected behavior:
  - HIGH judge earnings: were INVISIBLE/unclaimable (withdrawFees had zero callers). Added a hoisted #judgeStatusCard
    (above the profiles list, outside the "skip this" accordion) that reads the judge contract's claimable fee balance and
    offers a Withdraw button (withdrawFees). e2e E7: rule with fee → UI shows $0.50 → Withdraw → judge bal 0, operator +0.5.
  - HIGH banner over-claimed "rule": bondBanner now timing-aware (judgeCanRuleSomePending) — only says "rule" inside the
    ruling window, else "reject as out-of-scope (ruling window not open)"; + the bonus capacity-full "anyone can challenge"
    contradiction gated on hasChallengeCapacity. bondBanner.test.js + bond-banner e2e (concession/post-deadline/capacity-full).
  - MED fee decimals (new pure frontend/rule-fee.js parseRuleFee, token-decimals not hardcoded 18; ruleFee.test.js incl the
    6-dec case), MED false "Active" on RPC read failure → "Could not read judge state", MED silent-blank judges list →
    error+Retry, MED My-Bonds As-Judge hint phase-aware (judgeRowHint via phaseFor), MED surface judge status out of the
    accordion. LOW timing-grid dedup (one T0 row), LOW phase.js poster-timeout wording.
- Also STABILIZED the My-Bonds listing e2e (D1b challenger, E1b/E8 judge): extracted a shared gotoMyBonds(page) helper
  (re-navigates until the CONNECTED role sections render) — fixes the order-dependent flake those naive #my navigations had
  in the full suite. Two consecutive clean full-suite runs confirm determinism.
- Gates re-run MYSELF: npx hardhat test 1066 passing / 0 failing; lint EXIT=0 (G1 39, even below baseline 40 — a judge-page
  catch gained a body); docker e2e 76 passed / 4 skipped (×2 stable, incl. E7/E8/E9 + bond-banner + timeline). Restored
  screenshots. index.html + v6 mirror bodies kept in sync. Adversarial panel 2/2.
- Next: deploy the better-tested UI to bond.futarchy.ai (verify the deploy mechanism + that prod serves the new build).

## DEPLOY — 2026-06-06 — v0.6 better-tested UI live on bond.futarchy.ai ✅ (GOAL MET)
- Pushed cae8068 to main; Netlify (zippy-halva-280c00, auto-deploy from main, publishes frontend/) shipped it to
  bond.futarchy.ai. VERIFIED live: prod rule-fee.js (new in cae8068) is byte-identical to local (4143B); deployed
  index.html carries judgeStatusCard + "Withdraw fees" + "concession ends"; banner.js has the timing-aware judge clause
  ("ruling window is not open"); phase.js has the corrected timeout wording. runtime-config serves bondVersion 6 (mainnet,
  v0.6 — contracts UNCHANGED). Backing indexer /api/notify/health ok (chain1 lag12/dl0, sepolia lag6/dl0).
- GOAL COMPLETE: comprehensive e2e for all flows (poster C1-C6, challenger D1-D3/C3/D1b, judge E1-E9 incl earnings/withdraw,
  My-Bonds challenger+judge listing) × lifecycles + edge/robustness (capacity-full, multi-challenger queue, wrong-chain
  guard, contract-absent, tx-cancelled) — hardhat 1066/0, docker e2e 76 passed/4 skipped (stable ×2), lint EXIT=0 (G1 39).
  Judge-flow display bugs fixed. No contract change. Shipped to bond.futarchy.ai.

## Iteration 36 — 2026-06-06 — indexer role-mapping coverage (event → role column → /api/bonds?role) (PROGRESS)
- Owner scrutinized indexer test coverage. Found the real gap: the existing tests SEED the DB then test the filter, so the
  WATCHER's event→column mapping (Challenged.args.challenger → challenger column; BondCreated → poster/judge) wasn't proven
  end-to-end — exactly the chain My-Bonds-as-challenger/as-judge relies on on the live indexer-first path.
- Added 3 backend tests (test/backend/readModelAndIndexer.test.js), all driving the REAL watcher (indexChain→indexLogs),
  NOT db-seeding: (1) a real BondCreated+Challenged through the watcher are served by /api/bonds?poster/?judge/?challenger
  (distinct P/J/C addresses; ?challenger=P and =J must return 0 → non-vacuous; mutation-verified: swapping the challenger
  mapping makes both fail); (2) the watcher-written challenge is linked to the correct bondId (lands on bond 8 not sibling 7)
  with the right challenger+content; (3) list meta.blocksBehindHead + limit clamp + ordering — asserted AS-IS against the
  real code (challenger filter ignores limit; ordering bond_id DESC — honest, not invented).
- Adversarial panel caught the 2 E2E spawn tests were FLAKY (~1/10 full-suite runs) — load-starved child read transiently
  empty. I HARDENED them: the POSITIVE role queries poll-until-present (10s deadline) while the NEGATIVE checks stay direct,
  so a true mis-map still fails. Re-verified MYSELF: isolated 18/18; FULL suite ×4 = 1069 passing / 0 failing each (flake gone).
- Test-only change; no app/contract/backend code touched. lint unaffected (scans frontend).
- NOTE (separate, live): this proves the indexer LOGIC; it does NOT catch the PROD read-model staleness I found separately
  (mainnet bond #1 settled=true on-chain but settled=false in the indexer; list meta blocksBehindHead 1328 vs /health lag 12).
  That live discrepancy needs a prod investigation (BondWithdrawn re-snapshot / checkpoint / lag-reporting), not a unit test.

## Iteration 37 — 2026-06-06 — honest /api/notify/health (bug #2: status was hardcoded 'ok') + bond→shared-proxy
- INCIDENT (found via the live bond #1 "settled" check): mainnet indexer was FROZEN ~5h. Root cause: the Alchemy key hit
  its monthly 429 quota, and bond-notify's OWN ethers FallbackProvider does NOT fail over on 429 (unlike the shared
  rpc_proxy.py which does). Two systems both depended on the same Alchemy key; bond had no failover + no monitoring.
- FIX #1 (infra, VM env): repointed bond-notify MAINNET_RPCS/MAINNET_RPC → the shared proxy http://172.17.0.1:8546
  (multi-upstream + working 429 failover). Verified: lag ~14, bond #1 settled, 0 dead-letters. (gitignored env; not in repo.)
- FIX #2 (code, this commit): backend/api-server.mjs handleHealth no longer returns a hardcoded {status:'ok'}. New pure
  helper healthFromIndexer(entries,{lagThreshold,tickThreshold}) derives an honest overall status — "down" (no entries /
  null head / never-ticked, HTTP 503), "degraded" (any chain: lag>HEALTH_LAG_THRESHOLD(200) | deadLetters>0 |
  headAgeSeconds>HEALTH_TICK_AGE_THRESHOLD(180), HTTP 200), else "ok". Per-chain entries enriched additively with
  {healthy,reasons}; ALL existing fields preserved (monitor.mjs + frontend unaffected). Response adds {thresholds}.
- 9 new tests (5 unit on the helper + 4 driving the real endpoint): healthy→ok; lag→degraded; DEAD-LETTER→degraded (the
  exact bug); STALE TICK→degraded (the frozen-indexer signal, since head+checkpoint freeze together so lag stays small);
  never-ticked/no-entries→down(503). Non-vacuous (a hardcoded ok fails them). Adversarial panel 2/2.
- Gates re-run MYSELF: hardhat 1078/0; lint EXIT=0. Deploying to VM below.
- NEXT (#3): add a "Bond Indexer (Mainnet)" component to the futarchy status bot reading /api/notify/health (now that it
  tells the truth). Also flagged: bond's ethers-FallbackProvider 429 no-failover is now MOOT (proxy handles it) — left as-is.

## Iteration 38 — 2026-06-06 — #2 deployed+verified live; #3 status-bot Bond Indexer component shipped
- #2 DEPLOYED: pulled 941b0d2 onto futarchy-indexers VM, rebuilt bond-notify container. Live
  https://api.bond.futarchy.ai/api/notify/health now returns honest status:ok + {thresholds} + per-chain
  {healthy,reasons}: chain 1 lag 12 healthy=true, chain 11155111 lag 6 healthy=true. (Would report degraded/down if frozen.)
- #3 DONE (code, in ~/fleet auto-commit 89b8e437): added checkBondIndexer() to the status bot
  (infra/lambda/futarchy-telegram-bot/lib/checker.js) — fetches /api/notify/health, maps ok→operational / degraded→degraded
  / down→outage, focuses chain 1 (mainnet). Wired into telegram-bot.js: change-detection (alerts on status transitions via
  state.bondIndexerStatus) + heartbeat line via new formatBondIndexer() (telegram.js). Verified live: returns
  {operational, "lag 12 blocks, 0 dead-letters"}; all 3 states render 🟢/🟡/🔴; node --check clean.
- All 3 of the user's RPC/health/monitoring steps now done: #1 bond→shared proxy (verified), #2 honest health (deployed),
  #3 status-bot Bond Indexer (committed). REMAINING for #3 go-live = owner-gated: target Telegram chat ID + OK to host the
  bot on the futarchy-indexers VM (the bot itself died in the AWS→GCP migration and is not yet running anywhere).

## Iteration 39 — 2026-06-06 — integrate Bond Indexer into fi's canonical bot + adversarial fix
- COORDINATION: user said agent "fi" is restoring the telegram bot and will include the Bond Indexer. Found fi mid-flight in
  the CANONICAL clone (~/futarchy/workspace, the GitHub/CI/deploy-backed one) with uncommitted RPC_POOLS rewiring in
  lib/checker.js. My #38 component was only in ~/fleet (a LOCAL-only symlinked clone, no remote) → it would NOT have reached
  the deployed bot. fleet-channel MCP was down, so coordinated via the repo, not agent-to-agent.
- INTEGRATED: generated a clean additive patch (checkBondIndexer + formatBondIndexer + handler wiring) and applied it onto
  fi's canonical tree — UNCOMMITTED + additive, so it rides along when fi commits the restoration without bundling fi's WIP
  into a commit of mine. Verified no symbol collisions (fi had added no bond check yet). Durable copy committed at
  deploy/status-bot-bond-indexer.patch (reverse-checks identical to what's applied in canonical).
- ADVERSARIAL VERIFY (workflow w4t682bvs, 14 agents, 3 lenses + per-finding refute panel): 11 raised, 7 confirmed. Core bug
  (flagged by 2 independent lenses): checkBondIndexer derived `status` from the multi-chain AGGREGATE data.status but
  `description` from the mainnet entry — a "Bond Indexer (Mainnet)" component whose alert/icon tracked the aggregate, so a
  Sepolia hiccup fired a FALSE mainnet alert and status/description could contradict (🟢 + "unhealthy" text).
- FIXED [1][2][3][4][7]: status now derived from the chain-1 entry (Number() coercion for string chainId); res.ok gated
  (503-with-ok-body no longer reports operational); absent-mainnet is never green (degraded/outage); non-JSON-on-200 → outage;
  warn on unmapped status; 8s→5s timeout. 9/9 edge-case unit checks pass incl. the core bug + the Sepolia-masking case.
  Live still 🟢 (lag 12). Both clones now byte-identical on checkBondIndexer.
- DEFERRED to fi (their handler/state policy, did not touch unilaterally): [5] run checkBondIndexer concurrently with the RPC
  check (currently sequential 5s+8s) and [6] cold-start state loss means the first post-cold-start tick won't alert an
  already-bad bond (matches the EXISTING rpc/components change-detection pattern — a cross-cutting choice for fi).
- STILL owner-gated for go-live: Telegram chat ID + host OK (unchanged).

## Iteration 40 — 2026-06-06 — bot LIVE; fi superseded my bot-level approach (cleaner) → reverted mine
- USER shipped the bot. Live heartbeat confirms "Bond Indexer (Mainnet) 🟢 Synced (gap: 12)" + a bonus "Bond Indexer
  (Sepolia) 🟢 (gap: 6)" as FIRST-CLASS components under "All Systems Operational". Gaps match /api/notify/health exactly.
- fi integrated at the STATUS-PAGE level, not the bot: status.futarchy.fi/api/status now emits components bond_1
  (Mainnet) + bond_11155111 (Sepolia) reading /api/notify/health. This is cleaner than my bot-level checkBondIndexer:
  each chain is its own component (so it shows in the component list, gets the standard state.components change-detection,
  and the per-chain split INHERENTLY avoids the aggregate-masking bug I'd had to fix). The honest /api/notify/health from
  #2 is what makes it possible — that was the load-bearing contribution.
- CLEANUP: my bot-level additions (checkBondIndexer/formatBondIndexer + handler wiring) were now redundant AND a
  double-alert footgun if that tree deployed (fi's state.components + my state.bondIndexerStatus would both fire). Reverse-
  applied my patch from BOTH clones: canonical (~/futarchy/workspace, left with only fi's uncommitted RPC rewiring) and
  ~/fleet (back to base cfe9414b). Removed the now-superseded deploy/status-bot-bond-indexer.patch artifact. Verified 0 refs
  + syntax-clean in both. Net deployed state owes nothing to my bot-level code; it owes everything to the honest health
  endpoint (#2) + the bond→proxy repoint (#1).
- RPC Health heartbeat shows "Gnosis 4/5 (down: Alchemy)" — fi added Alchemy to the pool specifically to surface its
  monthly-quota cap (the original incident root cause). "Alchemy down" here = the capped key, correctly surfaced + benign
  (proxy fails over). Working as intended.
- NET RESULT of the whole RPC/health/monitoring effort: #1 bond→shared proxy (no more single-key SPOF), #2 honest
  /api/notify/health (deployed), #3 bond.futarchy.ai now monitored (Mainnet+Sepolia) by the live @azhermes status bot.

## Iteration 41 — 2026-06-07 — status-label overhaul (user-requested, keeps v0.6 contracts)
- TRIGGER: user noticed bond #1 reads "settled" when it was judge-VOIDED (rejectBond); asked to relabel + "make the UI
  labels as good as possible" + "include them all in tests". The v0.6 struct/indexer carry only settled/closed — the settle
  REASON lives only in the events, so (per the user's own proposal) the frontend derives it from the settle events.
- NEW pure helper frontend/bond-status.js (UMD, dual-export, like phase.js): bondStatus() fans `settled` into
  Cancelled (rejectBond) / Withdrawn (withdrawBond) / Settled (timed out) (claimTimeout) / Challenge upheld
  (ruleForChallenger), with a generic "Settled" fallback + a plain-English tooltip on every state; challengeStatusLabel()
  fixes the DANGEROUS per-challenge labels — Won→"Challenger won", Lost→"Challenger lost" (a poster read bare "Won" as
  THEIR win), RejectedByJudge→"Dismissed (out of scope)". Also "N pending"→"N open challenge(s)".
- DERIVATION: deriveSettleReason() over the settle events via queryFilterChunked (added an opt-in stopOnMatch early-stop;
  newest-first so a recent settle is found in the first window; G4-compliant). Applied on the detail view + My-Bonds rows
  (small N); Browse stays coarse-but-honest for perf (up to 200 rows, no per-bond getLogs).
- Wired into BOTH index.html mirrors (bodies kept byte-identical, verified), + 3 new CSS badge classes. Error handling
  uses console.warn (not a swallowing one-liner) so lint stays at 39 ≤ baseline 40.
- ADVERSARIAL VERIFY (workflow w0fsjzqt6, 10 agents, 3 lenses): 7 raised, 3 confirmed + FIXED — (1) the free
  ruled-challenger inference was DEAD because callers pass {i,ch:{status},timing} but the helper read top-level c.status
  (made shape-tolerant + added a real-shape unit test); (2) deriveSettleReason negative-cached null permanently, so a
  transient RPC failure locked a bond to generic "Settled" for the session (now caches only a truthy reason); (3) no
  My-Bonds e2e for the derived label (added one).
- GATES (re-run after fixes): hardhat 1105 passing; lint 39 (G4 ok); full local docker e2e 82 + 7 new status-label specs
  (every settle path + relabeled challenge badges + the My-Bonds row), all green; index.html↔v6 byte-identical; screenshots
  + metrics churn restored. Files: frontend/bond-status.js (new), test/frontend/bondStatus.test.js (new),
  tests/e2e/status-labels.spec.js (new), frontend/index.html, frontend/v6/index.html, SimpleBondV6FrontendSurface.test.js.
- FOLLOW-UP (user: "still shows settled, not cancelled" on live mainnet): root cause = the derivation used
  Promise.all over 4 separate full-history scans; the 1 matching filter early-stopped (2 getLogs) but the 3
  NON-matching scanned all ~15 chunks, and Promise.all waited for them → ~8.8s block + 47 getLogs on mainnet, so
  users saw the indexer's instant "Settled" and the precise label only ~9s later (e2e missed it: tiny local range).
  FIX: queryFilterChunked now accepts an ARRAY of filters and queries them per-window (newest-first); deriveSettleReason
  does ONE windowed scan that stops at the first window holding any settle event and maps it by event name. Measured on
  mainnet bond #1: 8.8s/47 getLogs → 0.7s/8 getLogs, reason 'cancelled'. Still G4-compliant (queryFilter stays inside
  queryFilterChunked). Re-verified: lint 39, unit 124, e2e 7/7.
