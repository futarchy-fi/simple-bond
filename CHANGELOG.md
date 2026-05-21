# Changelog

## v0.6 — Ethereum mainnet (sUSDS)

**Status:** code complete on `spec/v06`, awaiting mainnet deploy. See `RELEASE_V06.md` for the operator runbook.

### Mechanism changes

- **Bond `deadline` removed.** Lifecycle is event-driven (`closed` / `withdrawn` / `settled`).
- **Per-challenge concession.** `concede(bondId, i, content)` refunds the targeted challenger only, money-neutral for the poster, bond continues. The bond-wide `concede(bondId)` from v0.5 is gone.
- **Versioned claim text.** Poster can `modifyClaim(bondId, newContent)` when no challenges are pending. Each modification bumps `claimVersion`. Every `challenge` pins an `expectedVersion`; mismatch reverts (front-run-safe).
- **Judge can dismiss individual challenges.** `rejectChallenge(bondId, i, content)` refunds one challenger as out-of-scope without settling the bond. Callable any time before settlement, including before the concession window for the targeted challenge.
- **Judge can rule challenges in any order.** No more `currentChallenge` pointer. First `ruleForChallenger` settles the bond regardless of position. `rejectBond` voids the bond and leaves finalized rulings unwound.
- **Per-challenge timing.** Each challenge stores its own timestamp; `concessionDeadline(i)`, `rulingWindowStart(i)`, `rulingDeadline(i)` are per-challenge.
- **Poster close/open toggle.** `closeBond` blocks new challenges; pending challenges continue. `openBond` re-enables them. `withdrawBond` requires `closed && pendingCount == 0`.
- **`maxChallenges` cap.** Hard cap on total challenges ever filed, set at bond creation.
- **Hash-with-event metadata.** Claim, challenge, ruling, concession, rejection metadata is `bytes32 keccak256(content)` in storage; raw content emitted in events. ~32 bytes storage per metadata write instead of an unbounded string.
- **Append-only profile registries.** New `PosterProfileRegistry` and `ChallengerProfileRegistry`; `JudgeProfileRegistryV6` adds `judgeContract` pinning per entry. Bond snapshots `judgeProfileId` at creation so judges can't retroactively change their stated criteria.
- **`ManualJudgeV6`** wraps the v0.5 wrapper for the new interface (per-challenge arg + content).

### Infra changes

- Canonical chain: **Ethereum mainnet (chain id 1)**.
- Canonical token: **sUSDS** at `0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD`. Yield accrual is implicit via sUSDS share appreciation.
- Hardhat `viaIR` enabled (`SimpleBondV6.createBond` exceeds the stack budget without it).
- Sepolia network added for staging.
- `staging.bond.futarchy.ai` runs the same UI against Sepolia with a `MockSUSDS` ERC-20 stand-in.
- Backend `CHAINS[1]` and `CHAINS[11155111]` registered only when `MAINNET_V6_CONTRACT` / `SEPOLIA_V6_CONTRACT` env vars are set. v0.5 Gnosis stays hardcoded until Phase 11 retirement.
- Per-version ABI via `abiForChain(chainId)`; v0.5 and v0.6 events coexist in the watcher.

### New tooling

- `scripts/v6/deployMockSUSDS.js` (testnets only).
- `scripts/v6/deployAll.js` orchestrates the full v0.6 stack and writes `deployments/<network>.json`.
- `scripts/v6/syncConfigFromDeployment.js` patches `frontend/runtime-config.js` from the deployment record (idempotent).

### Tests

604 hardhat tests passing on `spec/v06`. Highlights:
- 21 v0.6 contract unit tests for `createBond` + validation
- per-action suites for `modifyClaim`, `challenge`, `concede`, `ruleForPoster`, `ruleForChallenger`, `rejectChallenge`, `rejectBond`, `closeBond`/`openBond`, `withdrawBond`, `claimTimeout`, `claimRefunds`
- 8-property invariant suite (balance conservation, monotonic version, terminal-status idempotence, settled-bond freeze, judgeProfileId immutability, `pendingCount` consistency, refund drain)
- profile registry append-only tests
- `ManualJudgeV6` wrapper tests
- backend v0.6 surface tests (env-gated chains, per-version ABI)
- `syncConfigFromDeployment` patch + idempotence tests

### Docs

- `SPEC_V06.md` — design spec
- `PLAN_V06.md` — 12-phase implementation plan
- `AUDIT_SCOPE_V06.md` — audit scope
- `RELEASE_V06.md` — operator runbook for mainnet rollout

## v0.5 (legacy line on Gnosis)

See `SPEC.md` and `AUDIT_SCOPE.md`. Deployed at:

- `SimpleBondV5` Gnosis: `0x7dF485C013f8671B656d585f1d1411640B1D2776`

Retiring from the live UI in Phase 11 of the v0.6 rollout. On-chain contract remains immutable.
