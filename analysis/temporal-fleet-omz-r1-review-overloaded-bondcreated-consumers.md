# temporal-fleet-omz-r1 Analysis: overloaded `BondCreated` consumers

## Scope

This review checks the off-chain ABI consumers named in the task:

- `frontend/index.html`
- `backend/config.mjs`
- `backend/watcher.mjs` as the runtime that consumes `CONTRACT_ABI`

For contract context, `SimpleBondV4` now defines two overloaded create events:

- detailed: `BondCreated(uint256,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,string)` at `contracts/SimpleBondV4.sol:73`
- lightweight: `BondCreated(uint256,address,address,uint256)` at `contracts/SimpleBondV4.sol:87`

## Findings

### Frontend: no current change required

`frontend/index.html` still declares only the detailed `BondCreated` event in `BOND_ABI` at `frontend/index.html:1008`.

That is not currently a problem, because the live frontend paths are already pinned to the detailed signature instead of resolving `BondCreated` by name:

- `frontend/index.html:1023-1025` defines `DETAILED_BOND_CREATED_SIGNATURE` and `DETAILED_BOND_CREATED_TOPIC`
- `frontend/index.html:3022-3028` only parses receipt or history logs when `topics[0] === DETAILED_BOND_CREATED_TOPIC`
- `frontend/index.html:3031-3040` queries creation history with raw topic filters keyed to `DETAILED_BOND_CREATED_TOPIC`
- those helpers are the only active creation-log consumers I found, including:
  - create receipt handling at `frontend/index.html:2272-2278`
  - all-bonds loading at `frontend/index.html:2885-2902`
  - my-bonds poster/judge discovery at `frontend/index.html:3215-3226`
  - judge bond-count loading at `frontend/index.html:3817`

I did not find any current frontend use of:

- `filters.BondCreated(...)`
- `getEvent("BondCreated")`
- `queryFilter(...)` with a bare `BondCreated` fragment

Conclusion: `frontend/index.html` does not need a change for the current branch. It is already using signature-specific resolution for the detailed create log.

If the frontend later needs to consume the lightweight create log too, it should add a separate lightweight signature/topic helper rather than introducing bare `BondCreated` lookup by name. The detailed path still has to remain available because judge-scoped queries rely on the detailed event's indexed `judge` topic, which the lightweight overload does not expose.

### Backend: safe today, but changes would be required if lightweight `BondCreated` is added to `CONTRACT_ABI`

`backend/config.mjs` currently includes only the detailed `BondCreated` signature in `CONTRACT_ABI` at `backend/config.mjs:58`, and notification routing is keyed by the bare event name `BondCreated` in `EVENT_RECIPIENTS` at `backend/config.mjs:73-74`.

`backend/watcher.mjs` then:

- scans all logs for the contract address, not a pre-filtered create-event topic set, at `backend/watcher.mjs:117-121`
- parses each recognized log through the shared interface at `backend/watcher.mjs:53-55`
- dispatches only on `parsed.name` at `backend/watcher.mjs:61-65`

That remains safe today because the backend ABI only recognizes one `BondCreated` fragment, so each create transaction produces exactly one backend-recognized `BondCreated` log.

If `backend/config.mjs` is changed to include the lightweight overload too, the backend would need follow-up changes. Otherwise the watcher would parse both emitted create logs from a single `createBond()` transaction and treat both as the same logical event name, `BondCreated`. Since recipient resolution and email rendering for `BondCreated` are derived from `bonds(bondId)` rather than overload-specific arguments, that would likely double-send the same judge notification for one bond creation.

Conclusion: `backend/config.mjs` does not need a change as long as the backend is intentionally staying on the detailed create event only. If it must consume the lightweight overload too, the watcher must move from name-based `BondCreated` dispatch to signature-specific or topic-specific routing, or otherwise dedupe the two create logs before notification delivery.

## Answer to the task question

- `frontend/index.html`: no change needed now
- `backend/config.mjs`: no change needed now
- future only if lightweight `BondCreated` must also be consumed:
  - frontend should add a separate lightweight signature/topic path
  - backend must stop treating bare `parsed.name === "BondCreated"` as sufficient for dispatch
