# sb-009 Analysis: README v4 addresses follow-up

## Summary

The task description matches an older repository state, not the current `futarchy-fleet/Tsb-009` branch.

On this branch, `README.md` already reflects the active `SimpleBondV4` deployment set, uses the current Gnosis and Polygon contract addresses from the frontend config, and notes that `KlerosJudge` is available as an adapter on Gnosis.

This means the implementation requested by sb-009 is already present. The correct action for this branch is to record that finding and avoid making redundant README edits.

## Current Branch State

`README.md` already contains the expected v4 content:

- title: `# SimpleBond v4`
- Gnosis `SimpleBondV4`: `0xCe8799303AeaEC861142470d754F74E09EfD1C45`
- Polygon `SimpleBondV4`: `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
- Gnosis `KlerosJudge`: `0x71e15D42bE15BAE117096E12C9dBA25E67d14C67`
- Gnosis token rows for `sDAI` and `WXDAI`
- note: `KlerosJudge` is available on Gnosis as a deployed judge adapter for `SimpleBondV4`

The task description says the README still mentions `SimpleBond v3` and the old Gnosis address `0x90b8d22456E8b6d8Dea3DDc28E025940335ffC02`, but neither stale value is present in the current README.

## Source Of Truth

The frontend config in `frontend/index.html` is the right source for deployed addresses because it is what the live UI uses:

- `KLEROS_JUDGE[100] = 0x71e15D42bE15BAE117096E12C9dBA25E67d14C67`
- `CHAINS[100].contract = 0xCe8799303AeaEC861142470d754F74E09EfD1C45`
- `CHAINS[137].contract = 0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
- Gnosis default token / wrapped native:
  - `sDAI = 0xaf204776c7245bF4147c2612BF6e5972Ee483701`
  - `WXDAI = 0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d`

`backend/config.mjs` matches the same `SimpleBondV4` Gnosis and Polygon contract addresses, so frontend, backend, and README are aligned.

## Relevant History

This work appears to have already landed before sb-009 analysis started:

- analysis commit: `0c8f52d` (`analysis: update README from SimpleBond v3 to v4`)
- implementation commit: `859c749` (`Update README for SimpleBondV4 deployments`)
- merge commit in current history: `1bd1ad5` (`Merge futarchy-fleet/Tsb-008c`)

So sb-009 is functionally a follow-up to a task that has already been completed and merged into the branch history.

## Recommended Approach

No README change should be made on this branch.

Planned handling:

1. Record that the requested documentation update is already satisfied.
2. Leave `README.md` unchanged to avoid a redundant edit-only commit.
3. If someone needs this fix on a different branch or older base, use commit `859c749` as the implementation reference.

## Verification

Verification for this analysis is a consistency check:

1. Confirm `README.md` title is `SimpleBond v4`.
2. Confirm the README address table matches `frontend/index.html` for:
   - Gnosis `SimpleBondV4`
   - Polygon `SimpleBondV4`
   - Gnosis `KlerosJudge`
3. Confirm the README `sDAI` and `WXDAI` rows still match the frontend token config.
4. Confirm `backend/config.mjs` still matches the frontend contract addresses.

## Scope

Expected change for sb-009 analysis:

- add this analysis note

No contract, frontend, backend, test, or README changes are required on the current branch state.
