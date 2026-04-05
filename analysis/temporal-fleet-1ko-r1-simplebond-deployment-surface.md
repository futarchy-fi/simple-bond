# temporal-fleet-1ko-r1 Analysis: SimpleBond deployment surface

## Summary

The current product-wired `SimpleBondV4` surface is narrower than the deploy tooling surface.

- End-to-end live networks today are Gnosis (`100`) and Polygon (`137`).
- Ethereum (`1`) is partially wired in the frontend, but the UI explicitly treats it as not deployed yet.
- Base (`8453`) is only present in Hardhat deploy config; it is not wired into the frontend, backend watcher, or README addresses.

That means a successful contract deployment is not enough on its own. A post-deploy checklist has to cover frontend chain maps, backend watcher/indexer settings, runtime API origins, and public docs in addition to the on-chain deploy itself.

## Current Deployment Surface

### `scripts/deploy.js`

`scripts/deploy.js:3-14` deploys `SimpleBondV4` with no constructor arguments, waits for mining, and prints:

- deployed contract address
- deploy transaction hash
- mined block number

It does not:

- verify the contract
- write the new address into any config file
- update frontend/backend chain maps

So the deploy script only handles the on-chain step.

### `hardhat.config.js`

`hardhat.config.js:78-100` defines these deploy targets:

- `gnosis` (`chainId: 100`) via `RPC_URL`
- `base` (`chainId: 8453`) via `BASE_RPC_URL`
- `polygon` (`chainId: 137`) via `POLYGON_RPC_URL`
- `ethereum` (`chainId: 1`) via `ETH_RPC_URL`

All of them reuse the same `PRIVATE_KEY`.

This is the broadest network surface in the inspected files, but it is only deploy tooling. It does not mean those networks are product-wired.

### `README.md`

`README.md:112-118` still documents deployment as:

```bash
cp .env.example .env  # add PRIVATE_KEY and RPC_URL
npx hardhat compile
npx hardhat run scripts/deploy.js --network gnosis
```

So the documented operator flow is Gnosis-first and does not mention the extra RPC env names needed for Polygon, Base, or Ethereum.

`README.md:158-168` publishes only these current addresses:

- `SimpleBondV4` on Gnosis: `0xCe8799303AeaEC861142470d754F74E09EfD1C45`
- `SimpleBondV4` on Polygon: `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
- `KlerosJudge` on Gnosis: `0x71e15D42bE15BAE117096E12C9dBA25E67d14C67`

That matches the live product surface better than the Hardhat config does.

`README.md:120-152` also documents notification deployment and runtime config, but it only calls out `notifyApiBase`. The frontend now consumes both `notifyApiBase` and `judgeApiBase`, so the README is incomplete as a downstream deployment checklist.

### `frontend/index.html`

The frontend exposes three chains in the selector (`frontend/index.html:437-440`):

- Gnosis
- Polygon
- Ethereum

But the actual chain config in `frontend/index.html:896-960` shows:

- Gnosis has a live contract address `0xCe8799303AeaEC861142470d754F74E09EfD1C45`
- Polygon has a live contract address `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
- Ethereum has `contract: null`

The UI behavior in `frontend/index.html:490-493` and `frontend/index.html:1371-1383` confirms that Ethereum is intentionally treated as unavailable:

- it shows a "Not Available on This Chain" screen
- it tells users to switch to Gnosis or Polygon

The frontend also hardcodes deployment block numbers that matter for chain reads:

- Gnosis `deployBlock: 44921914` (`frontend/index.html:902`)
- Polygon `deployBlock: 83608546` (`frontend/index.html:925`)

Gnosis has extra chain-specific product wiring that does not exist on Polygon or Ethereum:

- `KLEROS_JUDGE[100] = 0x71e15D42bE15BAE117096E12C9dBA25E67d14C67` (`frontend/index.html:877-881`)
- Gnosis default token is `sDAI`
- Gnosis wrapping logic depends on `sDAI` and `WXDAI` addresses (`frontend/index.html:968-970`, `frontend/index.html:1218-1237`, `frontend/index.html:1317-1325`)

Judge registry support is also limited to deployed chains. `getJudgeRegistryChainIds()` in `frontend/index.html:3603-3607` only includes chains whose `CHAINS[chainId].contract` is truthy, which currently means Gnosis and Polygon only.

Frontend runtime/API config comes from:

- `frontend/index.html:4231-4232`
- `frontend/runtime-config.js:1-8`

Those files show two downstream runtime touchpoints:

- `notifyApiBase`
- `judgeApiBase`

The page also contains a hardcoded `WEB3AUTH_CLIENT_ID` in `frontend/index.html:966`, so Web3Auth is a frontend deployment dependency but not a runtime-configured one.

### `backend/config.mjs`

`backend/config.mjs:39-54` only watches two chains:

- Gnosis (`100`)
- Polygon (`137`)

Current watcher/indexer config is:

- Gnosis:
  - contract `0xCe8799303AeaEC861142470d754F74E09EfD1C45`
  - `startBlock: 44921914`
- Polygon:
  - contract `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43`
  - `startBlock: 83608546`

`backend/config.mjs:34` also defines `CONFIRMATION_BLOCKS` only for `100` and `137`, so adding another live chain would require more than just a new `CHAINS[...]` entry.

For off-chain deployment topology, the same config file defines:

- `BOND_NOTIFY_HOST` / `BOND_NOTIFY_PORT` (`backend/config.mjs:17-18`)
- `BOND_NOTIFY_HMAC_SECRET` (`backend/config.mjs:20`)
- `BOND_NOTIFY_FROM` (`backend/config.mjs:21`)
- `BOND_NOTIFY_BASE_URL` (`backend/config.mjs:28`)
- `SIMPLE_BOND_FRONTEND_URL` (`backend/config.mjs:29`)

Two details matter for a real deployment checklist:

- `HMAC_SECRET` falls back to `change-me-in-production`, so production must override it.
- `NOTIFY_BASE_URL` and `FRONTEND_BASE_URL` both default to `https://bond.futarchy.ai`, which only fits a same-origin deployment. Split frontend/API hosting needs explicit env overrides.

The downstream reason `judgeApiBase` matters is that the backend API server exposes both notification and judge-profile routes:

- `/api/notify/*`
- `/api/judges/*`

as shown in `backend/api-server.mjs:354-371`.

## Networks Actually Wired Into The Product

### Fully wired today

- Gnosis (`100`)
  - present in README addresses
  - present in frontend chain selector and live chain map
  - present in backend watcher config
  - has Kleros adapter wiring
  - has Gnosis-specific token UX (`sDAI` / `WXDAI`)
- Polygon (`137`)
  - present in README addresses
  - present in frontend chain selector and live chain map
  - present in backend watcher config
  - no Kleros adapter wiring yet

### Partially wired / placeholder only

- Ethereum (`1`)
  - present in Hardhat config
  - present in frontend selector and URL mapping
  - `contract: null` in frontend
  - explicitly shown as "not deployed yet" in the UI
  - absent from README addresses
  - absent from backend watcher config

### Not wired into the product

- Base (`8453`)
  - present in Hardhat config only
  - absent from frontend selector
  - absent from frontend `CHAINS`
  - absent from backend watcher config
  - absent from README addresses

## Post-Deploy Checklist Implied By The Current Repo

For any deployment that is supposed to become part of the shipped product, the current repo requires all of the following:

1. Deploy `SimpleBondV4` and capture:
   - contract address
   - deploy tx hash
   - mined block number
2. Update `frontend/index.html`:
   - `CHAINS[chainId].contract`
   - `CHAINS[chainId].deployBlock`
   - chain selector / availability copy if the chain is newly live
   - `KLEROS_JUDGE[chainId]` if an adapter is deployed on that chain
   - chain-specific token defaults if the UX depends on them
3. Update `backend/config.mjs`:
   - `CHAINS[chainId].contract`
   - `CHAINS[chainId].startBlock`
   - `CONFIRMATION_BLOCKS[chainId]`
   - RPC endpoint if backend reads should use a specific provider
4. Confirm frontend runtime API wiring:
   - `frontend/runtime-config.js` `notifyApiBase`
   - `frontend/runtime-config.js` `judgeApiBase`
   - reverse proxy rules if the static frontend keeps same-origin API paths
5. Confirm backend public-origin/env wiring:
   - `BOND_NOTIFY_BASE_URL`
   - `SIMPLE_BOND_FRONTEND_URL`
   - non-default `BOND_NOTIFY_HMAC_SECRET`
6. Update public docs:
   - README deploy instructions if the operational path is not Gnosis-only anymore
   - README address table
   - README runtime-config docs so they mention `judgeApiBase` alongside `notifyApiBase`
   - Kleros availability notes if that adapter exists on the new chain
7. Validate product behavior on the target chain:
   - frontend no longer falls into the "not deployed" state
   - judge registry reads include the chain if expected
   - backend notifications/judge-profile APIs work against that chain

## Key Mismatch To Carry Forward

The important distinction is:

- deployable networks from Hardhat: Gnosis, Base, Polygon, Ethereum
- product-live networks from frontend + backend + README: Gnosis and Polygon only

Ethereum is only a frontend placeholder today, and Base is not wired into the product at all.

Any future deployment is incomplete until the frontend and backend chain maps are updated with the new address and deployment block, and the runtime/API/docs layer is updated to match.
