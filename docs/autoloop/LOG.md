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
