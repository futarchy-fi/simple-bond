# SimpleBond v3

A truth-machine bond contract. Make a claim, back it with money, and let the world challenge you. Designed by Robin Hanson, built by Futarchy.

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

## Addresses

| Asset | Chain | Address |
|-------|-------|---------|
| SimpleBond v3 | Gnosis | `0x90b8d22456E8b6d8Dea3DDc28E025940335ffC02` |
| SimpleBond v2 | Gnosis | `0xfB3623bd169E5D3dB275BB0644219a5aBA73108D` |
| sDAI | Gnosis | `0xaf204776c7245bF4147c2612BF6e5972Ee483701` |
| WXDAI | Gnosis | `0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d` |

## License

MIT
