# temporal-fleet-omz-r1 Analysis: `SimpleBondV4` event surface

## Scope

This is a source-inspection pass over:

- `contracts/SimpleBondV4.sol`
- `test/SimpleBondV4.test.js`
- hand-written ABI consumers in `frontend/index.html` and `backend/config.mjs` / `backend/watcher.mjs`

The branch already contains the target lightweight event additions, so the job here is to confirm the resulting lifecycle surface and the compatibility constraints around the overloaded `BondCreated` name.

## Current contract event surface

`SimpleBondV4` now exposes two layers of bond-lifecycle events:

| Lifecycle transition | Detailed / legacy event | Lightweight / normalized event | Notes |
| --- | --- | --- | --- |
| bond creation | `BondCreated(bondId, poster, judge, token, bondAmount, challengeAmount, judgeFee, deadline, acceptanceDelay, rulingBuffer, metadata)` at `contracts/SimpleBondV4.sol:73` and emitted at `contracts/SimpleBondV4.sol:284` | `BondCreated(bondId, poster, token, amount)` at `contracts/SimpleBondV4.sol:87` and emitted at `contracts/SimpleBondV4.sol:290` | both fire on every successful create |
| challenge filed | `Challenged(...)` at `contracts/SimpleBondV4.sol:94` and emitted at `contracts/SimpleBondV4.sol:323` | `BondChallenged(...)` at `contracts/SimpleBondV4.sol:101` and emitted at `contracts/SimpleBondV4.sol:324` | both fire after escrow succeeds |
| poster concedes | `ClaimConceded(...)` at `contracts/SimpleBondV4.sol:108` and emitted at `contracts/SimpleBondV4.sol:359` | `BondConceded(bondId)` at `contracts/SimpleBondV4.sol:114` and emitted at `contracts/SimpleBondV4.sol:360` | both fire after state flips and refunds |
| judge rules for poster | `RuledForPoster(...)` at `contracts/SimpleBondV4.sol:126` and emitted at `contracts/SimpleBondV4.sol:436` | `BondResolved(bondId, 1)` at `contracts/SimpleBondV4.sol:117` and emitted at `contracts/SimpleBondV4.sol:437` | `1` means poster won |
| judge rules for challenger | `RuledForChallenger(...)` at `contracts/SimpleBondV4.sol:119` and emitted at `contracts/SimpleBondV4.sol:399` | `BondResolved(bondId, 2)` at `contracts/SimpleBondV4.sol:117` and emitted at `contracts/SimpleBondV4.sol:400` | `2` means challenger won |

Other bond-state events were already lightweight enough and did not need new wrappers:

- `BondRejectedByJudge(bondId, judge)` is already a terse terminal-state event and is emitted from `rejectBond()` at `contracts/SimpleBondV4.sol:218`.
- `BondWithdrawn(bondId)` is already terse and is emitted from `withdrawBond()` at `contracts/SimpleBondV4.sol:464`.
- `BondTimedOut(bondId)` is already terse and is emitted from `claimTimeout()` at `contracts/SimpleBondV4.sol:492`.
- `ChallengeRefunded(...)` remains a per-challenge side-effect event, not a top-level lifecycle transition.

## Which transitions actually need lightweight emissions

For the bond lifecycle, the lightweight layer is only needed where the existing event was previously metadata-heavy or outcome-specific:

1. `createBond()` needed a normalized companion because the legacy create event is large and the lightweight surface is the stable "new bond exists" signal.
2. `challenge()` needed `BondChallenged` because `Challenged` includes queue index and metadata, while many consumers only need "someone posted the challenge amount".
3. `concede()` needed `BondConceded` because `ClaimConceded` carries poster text, while some consumers only need the state transition.
4. `ruleForPoster()` and `ruleForChallenger()` needed a shared `BondResolved` signal because the legacy events split the terminal ruling by winner.

The repo does not show a need for additional lightweight wrappers on:

- `rejectBond()`
- `withdrawBond()`
- `claimTimeout()`

Those paths already had compact single-purpose event names before this branch, and the test suite treats them that way.

## Test evidence on this branch

The V4 test suite has already been updated to assert the normalized layer directly:

- creation uses explicit signature constants for both `BondCreated` overloads at `test/SimpleBondV4.test.js:15-18`
- creation asserts both create events at `test/SimpleBondV4.test.js:567-586`
- challenge asserts both `Challenged` and `BondChallenged` at `test/SimpleBondV4.test.js:667-675`
- concession asserts both `ClaimConceded` and `BondConceded` at `test/SimpleBondV4.test.js:745-753`
- poster-win ruling asserts `RuledForPoster` plus `BondResolved(..., 1)` at `test/SimpleBondV4.test.js:970-979`
- challenger-win ruling asserts `RuledForChallenger` plus `BondResolved(..., 2)` at `test/SimpleBondV4.test.js:1034-1043`
- reject/timeout continue to assert the existing terse terminal events at `test/SimpleBondV4.test.js:351-355` and `test/SimpleBondV4.test.js:1219-1223`

The important compatibility signal from the tests is the create-path assertion style: once `BondCreated` is overloaded, the tests must disambiguate by full signature string, not by bare event name.

## Hand-written ABI consumer inventory

I found two hand-written consumer surfaces in the repo:

1. Frontend ABI and event queries in `frontend/index.html`
2. Backend watcher ABI and event routing in `backend/config.mjs` and `backend/watcher.mjs`

I did not find any bond-event consumer in Solidity. `contracts/KlerosJudge.sol` only depends on `SimpleBondV4` functions, not `BondCreated` logs.

## `BondCreated` overload compatibility constraints

### 1. The tests are already using the right disambiguation strategy

`test/SimpleBondV4.test.js` avoids bare `"BondCreated"` expectations and instead pins the full signatures in constants at `test/SimpleBondV4.test.js:15-18`.

That is the correct pattern anywhere the code needs to distinguish the detailed create log from the lightweight create log.

### 2. The frontend ABI still only declares the detailed `BondCreated`

`frontend/index.html:1008` includes only the detailed `BondCreated` event in `BOND_ABI`. It does not include the lightweight overload.

That means the current frontend remains compatible only because `createBond()` still emits the legacy detailed log. Today the frontend effectively ignores the lightweight create log.

Implications by call site:

- `frontend/index.html:2268-2273` parses the create receipt and stops on the first parsed log whose `name` is `"BondCreated"`. If the ABI were expanded to include both overloads, this loop would still recover `bondId` because both logs carry it. The code does not, however, distinguish which overload it matched.
- `frontend/index.html:2880-2881` uses `readContract.filters.BondCreated()` to discover all bonds.
- `frontend/index.html:3179-3180` uses `filters.BondCreated(null, userAddr)` and `filters.BondCreated(null, null, userAddr)` for poster and judge views.
- `frontend/index.html:3782-3783` uses `filters.BondCreated(null, null, checksumAddr)` to count bonds assigned to each judge.

Those filter call sites are the real compatibility constraint:

- they are written as name-based `filters.BondCreated(...)` lookups
- the judge-filtered forms rely on the detailed event's third indexed argument being `judge`
- the lightweight overload does not have an indexed `judge` field at all

So:

- if the frontend ABI is updated to include both `BondCreated` signatures, those name-based filter calls should be treated as requiring explicit signature-based event selection
- if the detailed `BondCreated` were ever removed instead of overloaded, the judge-specific queries would no longer be representable as topic filters and would need a different indexing strategy

### 3. The backend watcher also still only declares the detailed `BondCreated`

`backend/config.mjs:58` includes only the detailed `BondCreated` signature in `CONTRACT_ABI`, and `backend/config.mjs:74` routes `BondCreated` notifications by event name.

`backend/watcher.mjs:51-66` parses logs with `iface.parseLog(...)` and then branches on `parsed.name`.

This is currently safe because the backend ABI only knows one `BondCreated` signature, so each create transaction is processed once.

If the backend ABI were expanded to include both `BondCreated` overloads without any other changes, the watcher would parse both logs from a single `createBond()` transaction as the same logical event name, `BondCreated`, and would process both. Since recipient resolution for `BondCreated` comes from `bonds(bondId)` rather than from unique event fields, that would likely produce duplicate create notifications unless the watcher deduped by topic hash or by transaction/log semantics.

## Practical conclusion

The branch's target event surface is coherent:

- keep the detailed events for rich metadata and backwards compatibility
- add lightweight normalized companions only for create, challenge, concede, and judge-ruling outcomes
- leave reject, withdraw, timeout, and refund events as they already were

The overloaded `BondCreated` name is acceptable inside the contract and test suite, but it creates two off-chain constraints:

1. anything that needs to distinguish the two create logs must use full event signatures, not a bare `"BondCreated"` reference
2. any hand-written ABI consumer that adds both overloads must explicitly handle ambiguity and, in the frontend's case, preserve access to the detailed event because judge-indexed filters depend on it

## Verification note

This was a static source-analysis pass. I did not run `npx hardhat test test/SimpleBondV4.test.js` in this workspace because the local Hardhat toolchain is not installed here, so the findings above are based on contract/test/consumer inspection rather than an executed test run.
