![Tests](https://img.shields.io/badge/tests-passing-green)
# SimpleBond

A truth-machine bond contract. Make a claim, back it with money, and let the world challenge you. Designed by Robin Hanson, built by Futarchy.

## Repository Status

The repository now contains both legacy deployed lines and the current `V5` core audit target.

- current core line: `contracts/core/SimpleBondV5.sol`
- current minimal judge wrapper: `contracts/judges/ManualJudge.sol`
- current `V5` audit docs: `AUDIT_SCOPE.md` and `SPEC.md`
- legacy contract lines and the current Kleros adapter: `contracts/legacy/`

## Repository Layout

- `contracts/core/` - current core contracts
- `contracts/judges/` - current judge implementations and wrappers
- `contracts/interfaces/` - shared interfaces
- `contracts/legacy/` - older contract generations and legacy adapters
- `contracts/test/` - test-only Solidity contracts
- `test/core/v5/` - active `V5` test suites
- `test/helpers/v5/` - active `V5` test helpers
- `test/legacy/` - legacy regression suites for older contract lines
- `test/frontend/` - frontend/backend consumer and helper tests
- `test/tooling/` - deploy and repository-tooling tests

## How It Works

1. **Poster** creates a bond — locks tokens and asserts a claim (e.g., "My article has no significant errors")
2. **Challengers** can dispute the claim by depositing a challenge amount
3. **Poster** gets an acceptance delay to publicly **concede** (admit they're wrong) — everyone is refunded, no judge needed
4. If the poster doesn't concede, a **Judge** rules on the dispute after the deadline
5. If the judge doesn't rule in time, anyone can trigger a **timeout** — everyone is refunded

The key output isn't money — it's the **public concession**. The mechanism makes honest signaling cheap and lying expensive.

## Belief Thresholds

The ratio between bond, challenge, and judge fee amounts reveals implied beliefs:

```
net_pot = bondAmount + challengeAmount - judgeFee

Challenger threshold = challengeAmount / net_pot
  → "I believe there's at least X% chance the poster is wrong"

Poster threshold = 1 - bondAmount / net_pot
  → "I'd concede only if >Y% chance I'm wrong"
```

**Example**: Bond = $10K, Challenge = $3K, Judge Fee = $0.5K

```
net_pot = $10K + $3K - $0.5K = $12.5K
Challenger signals: >24% belief poster is wrong  (3/12.5)
Poster signals:     <20% belief they're wrong     (1 - 10/12.5)
```

For a 20% poster threshold: `bondAmount = 4 × (challengeAmount - judgeFee)`

## Lifecycle

```
Bond Created ("I claim X")
  │
  ├─ No challenges → Poster withdraws anytime. Claim stood.
  │
  └─ Challenger arrives → Acceptance delay starts
       │
       ├─ Poster CONCEDES → Claim marked wrong on-chain.
       │    Everyone refunded. Bond done.
       │
       └─ Poster doesn't concede → Judge rules (after deadline)
            │
            ├─ POSTER wins → Judge gets fee, poster gets remainder.
            │    Bond stays active for more challenges.
            │
            └─ CHALLENGER wins → Judge gets fee from pool,
                 challenger gets rest. Remaining challengers refunded. Done.
```

Amounts stay fixed throughout — failed challengers don't grow the pool. Each challenger faces the same odds.

## Features

### Poster Concession
The poster can publicly admit their claim is wrong by calling `concede()` with an on-chain explanation. All parties are refunded. The `ClaimConceded` event creates a permanent on-chain record.

### Acceptance Delay
After a challenge, the poster has a configurable window (set at bond creation) to concede before the judge can rule. The judge's ruling window opens at `max(deadline, lastChallengeTime + acceptanceDelay)`.

### Challenge Metadata
Challengers attach their reasoning when challenging — explains *why* they think the poster is wrong. Stored on-chain.

### Judge Fee Waiver
The judge can charge anywhere from 0 to the max fee per ruling. Allows judges to waive their fee for pro-bono rulings or reduce it at their discretion.

### Multiple Challengers
Challenges form a FIFO queue. When a challenger loses, the judge fee comes from their stake and the remainder goes to the poster. The bond pool stays at its original amount. If a challenger wins, the bond is settled and remaining challengers are refunded.

### Timeout Protection
If the judge doesn't rule by the ruling deadline, anyone can call `claimTimeout()` to refund everyone. The judge gets nothing (punished for inaction).

## Contract Interface

```solidity
// Create a bond asserting a claim
createBond(token, bondAmount, challengeAmount, judgeFee, judge, deadline, acceptanceDelay, rulingBuffer, metadata) → bondId

// Challenge a bond (deposit challengeAmount)
challenge(bondId, metadata)

// Poster concedes the claim is wrong (everyone refunded)
concede(bondId, metadata)

// Judge rules (feeCharged = 0..judgeFee for fee waiver)
ruleForChallenger(bondId, feeCharged)
ruleForPoster(bondId, feeCharged)

// Poster withdraws when no pending challenges
withdrawBond(bondId)

// Anyone triggers timeout if judge missed deadline
claimTimeout(bondId)

// Views
rulingWindowStart(bondId) → timestamp
rulingDeadline(bondId) → timestamp
getChallengeCount(bondId) → count
getChallenge(bondId, index) → (challenger, status, metadata)
```

## Deploy

```bash
cp .env.example .env  # add PRIVATE_KEY and RPC_URL
npx hardhat compile
npx hardhat run scripts/deploy.js --network gnosis
```

## Frontend Runtime Config

The frontend is still a static site, but the notification API base is now configurable at runtime in `frontend/runtime-config.js`.

Default:

```js
window.SIMPLE_BOND_CONFIG = {
  notifyApiBase: "/api/notify",
};
```

That keeps the current same-origin deployment working. If the frontend moves to Netlify or any other static host, point `notifyApiBase` at the public API origin instead, for example:

```js
window.SIMPLE_BOND_CONFIG = {
  notifyApiBase: "https://api.bond.futarchy.ai/api/notify",
};
```

## Notification Deploy

The notification subsystem now has three entrypoints:

- `npm run notify` - compatibility mode, starts the API and worker in one process
- `npm run notify:api` - HTTP API only
- `npm run notify:worker` - chain watcher / email worker only

For a split deployment, set:

- `BOND_NOTIFY_BASE_URL` to the public API origin, for example `https://api.bond.futarchy.ai`
- `SIMPLE_BOND_FRONTEND_URL` to the frontend origin, for example `https://bond.futarchy.ai`

Sample systemd units live in `deploy/systemd/`:

- `deploy/systemd/bond-notify-api.service`
- `deploy/systemd/bond-notify-worker.service`

## Addresses

`KlerosJudge` is available on Gnosis as a deployed judge adapter for `SimpleBondV4`.

| Asset | Chain | Address |
|-------|-------|---------|
| SimpleBondV4 | Gnosis | `0xCe8799303AeaEC861142470d754F74E09EfD1C45` |
| SimpleBondV4 | Polygon | `0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43` |
| KlerosJudge | Gnosis | `0x71e15D42bE15BAE117096E12C9dBA25E67d14C67` |
| sDAI | Gnosis | `0xaf204776c7245bF4147c2612BF6e5972Ee483701` |
| WXDAI | Gnosis | `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d` |

## License

MIT
