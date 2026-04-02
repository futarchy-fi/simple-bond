# sb-008c Analysis: update `README.md` from v3 to v4

## Summary

`README.md` still presents the project as `SimpleBond v3` and still lists the old Gnosis deployment at `0x90b8d22456E8b6d8Dea3DDc28E025940335ffC02`.

That no longer matches the live app configuration:

- the active bond contract in the frontend is `SimpleBondV4`
- Gnosis uses `0xCe8799303AeaEC861142470d754F74E09EfD1C45`
- Polygon uses `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
- `KlerosJudge` is available on Gnosis at `0x71e15D42bE15BAE117096E12C9dBA25E67d14C67`

This is a documentation-only consistency task.

## Source Of Truth

The safest source for deployed addresses is the current frontend chain config in `frontend/index.html`, because that is what the app actually uses today:

- `CHAINS[100].contract`
  - `0xCe8799303AeaEC861142470d754F74E09EfD1C45`
- `CHAINS[137].contract`
  - `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
- `KLEROS_JUDGE[100]`
  - `0x71e15D42bE15BAE117096E12C9dBA25E67d14C67`

`backend/config.mjs` repeats the same Gnosis and Polygon `SimpleBondV4` addresses, so frontend and backend are already aligned.

## Current README Mismatches

Current stale items in `README.md`:

- the title is `# SimpleBond v3`
- the addresses table still lists:
  - `SimpleBond v3 | Gnosis | 0x90b8...`
  - `SimpleBond v2 | Gnosis | 0xfB36...`
- the addresses table does not mention:
  - Polygon `SimpleBondV4`
  - Gnosis `KlerosJudge`

Items that already match the frontend and do not need changes:

- `sDAI` on Gnosis: `0xaf204776c7245bF4147c2612BF6e5972Ee483701`
- `WXDAI` on Gnosis: `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d`

## Naming Nuance

The frontend header currently displays `SimpleBond v0.4`, while the active on-chain contract is named `SimpleBondV4`.

For the README update, the task language and the contract names both point to a v4 rewrite rather than a UI-version rewrite. The cleanest split is:

- use `# SimpleBond v4` for the README title
- use the exact contract label `SimpleBondV4` in the addresses table

That keeps the README readable while staying precise where deployed contract names matter.

## Recommended README Changes

Update `README.md` in three places.

### 1. Version / active-contract language

Change the title from `SimpleBond v3` to `SimpleBond v4`.

In the deployment/address area, refer to the active contract explicitly as `SimpleBondV4`.

### 2. Addresses table

Replace the stale protocol deployment rows with the current deployments from the frontend config.

Recommended active rows:

- `SimpleBondV4 | Gnosis | 0xCe8799303AeaEC861142470d754F74E09EfD1C45`
- `SimpleBondV4 | Polygon | 0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
- `KlerosJudge | Gnosis | 0x71e15D42bE15BAE117096E12C9dBA25E67d14C67`

Keep the existing token rows that are already correct:

- `sDAI | Gnosis | 0xaf204776c7245bF4147c2612BF6e5972Ee483701`
- `WXDAI | Gnosis | 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d`

The old `SimpleBond v2` row should be removed unless the README is intentionally meant to be a historical deployment ledger. Nothing else in the current README suggests that historical scope, and this task asks for the active deployments used by the frontend.

### 3. Kleros availability note

Add a short note that `KlerosJudge` is now available on Gnosis.

This can be done either:

- as a dedicated row in the addresses table
- or as one short sentence immediately above or below the table

The table row is likely enough on its own, but one short sentence would make the new availability easier to spot.

Suggested wording:

`KlerosJudge` is available on Gnosis as a deployed judge adapter for `SimpleBondV4`.

## Verification Plan

Because this is a docs-only task, verification is a consistency check rather than a test run:

1. Confirm the README title no longer says `v3`.
2. Confirm the Gnosis `SimpleBondV4` address matches `frontend/index.html`.
3. Confirm the Polygon `SimpleBondV4` address matches `frontend/index.html`.
4. Confirm the Gnosis `KlerosJudge` address matches `frontend/index.html`.
5. Confirm the existing Gnosis token rows still match the frontend token config.
6. Optionally cross-check the v4 contract addresses against `backend/config.mjs` to keep frontend/backend parity reflected in the README.

## Scope

Expected implementation change:

- `README.md`

No contract, frontend, backend, or test changes should be required for this task.
