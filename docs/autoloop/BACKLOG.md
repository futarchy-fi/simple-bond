# Autoloop Backlog (prioritized; regenerated when stale)

Iteration 1 (a design workflow) will expand the v0.7/backend/UX sections into
concrete, sequenced, testable items. The RCA gaps below are ready to pick up now.

## A. RCA open gaps (burn-down: rcaOpenGaps = 10)
1. Backend watcher uses a single RPC — add FallbackProvider + staticNetwork + batchMaxCount (watcher.mjs:269).
2. Frontend doesn't consume the `/api/bonds` freshness `meta` — show a staleness banner + threshold fallback.
3. `withTimeout(promise, ms, [])` silent empty fallbacks — make them distinguish error vs empty (8+ sites).
4. My-Bonds judge section keys off localStorage — index `judgeOperator`, serve `GET /api/bonds?judgeOperator=`.
5. `allowanceCache` not keyed by account — stale allowance across wallet switches.
6. `getCode`/identity probe runs on page chain, not wallet chain (I4 residual).
7. README/CHANGELOG prose-drift test (live-vs-retired claims), beyond address checks.
8. `indexBondState` per-`getChallenge` loop swallows errors — preserve prior on failure.
9. Browse/detail claim previews still issue browser getLogs even on indexer success — serve from indexer.
10. `config.mjs` silently swallows the secrets-path read; hardcoded `/home/ubuntu/...` path.

## B. Backend reliability (RPC-independent, on the GCP box)
- Promote the indexer to the authoritative read+point-read backend; reduce browser→RPC to near-zero.
- FallbackProvider/keyed-RPC, reorg handling, dead-letter for permanently-failed windows, health SLOs.
- (S1) DONE 2026-06-04: keyed Alchemy RPC wired backend-only on the VM (MAINNET_RPC); preflight
  warning cleared for chain 1; lint G5 now blocks any keyed URL leaking into frontend/. Sepolia
  still on free publicnode (provide a Sepolia key to close).

## C. v0.7 mechanism (grounded in SPEC_V06.md, motivated by UX)
- To be designed by iteration 1: identify the smallest mechanism changes that most improve UX
  (e.g. clearer lifecycle, fewer dead-ends, better defaults), spec them, ship to Sepolia first.

## D. UX (north star)
- End-to-end journey tests (create/judge/challenge/rule/concede/withdraw) as capability gates.
- Remove dead-ends, clarify states, onboarding, accessibility, the funding flow.

## E. Wiki / docs
- Accurate, complete docs that match deployed reality (doc-as-test); zero broken links.
