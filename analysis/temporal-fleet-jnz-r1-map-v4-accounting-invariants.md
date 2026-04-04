# Analysis: map `SimpleBondV4` accounting invariants to contract flows

## Summary

The accounting assertions in `test/SimpleBondV4.test.js` all reduce to one escrow model in `contracts/SimpleBondV4.sol`:

- `createBond()` escrows exactly one `bondAmount`
- each `challenge()` escrows exactly one additional `challengeAmount`
- each pending challenge is resolved exactly once as either:
  - `won` (`ruleForChallenger()`)
  - `lost` (`ruleForPoster()`)
  - `refunded` (`concede()`, `claimTimeout()`, or `rejectBond()` via `_refundRemaining()`)
- `withdrawBond()`, `concede()`, and `claimTimeout()` are the paths that release the remaining poster bond escrow

Under the same assumptions as the V4 tests, this produces a simple invariant for an active, unsettled bond:

`contract escrow = bondAmount + remainingPendingChallenges * challengeAmount`

where `remainingPendingChallenges = challenges.length - currentChallenge`.

That formula holds because poster-win rulings consume exactly one challenge deposit at a time while leaving the original bond escrow untouched. Terminal flows then empty the rest of the escrow according to who won or who must be refunded.

## Assumptions the tests rely on

- The tests use `contracts/TestToken.sol`, a standard mintable OpenZeppelin ERC-20 with no fee-on-transfer or rebasing behavior.
- `SimpleBondV4` does not normalize weird token semantics. The exact balance assertions therefore only hold for tokens whose `safeTransfer` and `safeTransferFrom` move the requested amount 1:1.
- All storage writes and token transfers happen in the same transaction. If a transfer fails, the whole call reverts, so queue/status changes cannot persist without the matching escrow movement.

## Core accounting model

### 1. Economic parameters are fixed at creation

`createBond()` stores `bondAmount`, `challengeAmount`, and `judgeFee` in the bond struct and those fields are never mutated afterwards.

That is the base for the "Robin's invariant" tests: later flows can only redistribute escrowed tokens, not change the configured economics.

### 2. Each challenge deposit has one terminal disposition

Challenge status moves through a one-way accounting lifecycle:

- `0` = pending
- `1` = won by challenger
- `2` = lost by challenger
- `3` = refunded

The contract never moves a challenge back to `0`, and `_refundRemaining()` only refunds challenges whose status is still `0`. That is what prevents double counting or double refunds of challenge escrow.

### 3. The poster bond is escrowed separately from challenge deposits

The bond escrow is introduced once in `createBond()`. Later:

- `ruleForPoster()` never spends `bondAmount`
- `ruleForChallenger()` pays out the bond exactly once to the winning challenger
- `concede()`, `withdrawBond()`, and `claimTimeout()` refund the poster bond exactly once

So the bond pool either stays fully intact during poster-win rulings, or it is fully released on a terminal path.

## Flow-by-flow map

| Flow | Escrow effect | Payout behavior | Accounting consequence |
| --- | --- | --- | --- |
| `createBond()` | `+ bondAmount` to the contract | none | initializes bond escrow and fixes the economic parameters |
| `challenge()` | `+ challengeAmount` to the contract | none | adds one pending queue entry backed by one full challenge deposit |
| `ruleForPoster(feeCharged)` | `- challengeAmount` from the contract | poster gets `challengeAmount - feeCharged`; judge gets `feeCharged` | the losing challenge deposit is fully consumed, but `bondAmount` stays escrowed |
| `ruleForChallenger(feeCharged)` | `- (bondAmount + current challengeAmount + all later pending challenge amounts)` | current challenger gets `bondAmount + challengeAmount - feeCharged`; judge gets `feeCharged`; later pending challengers are refunded | the winning challenger consumes the poster bond plus the current challenge deposit, then the bond is fully closed |
| `concede()` | `- (bondAmount + all pending challenge amounts)` | poster gets `bondAmount`; every pending challenger gets `challengeAmount`; judge gets nothing | concession is a full unwind of all remaining escrow before any ruling has started |
| `withdrawBond()` | `- bondAmount` | poster gets `bondAmount` | only possible when no pending challenge escrow remains |
| `claimTimeout()` | `- (bondAmount + all still-pending challenge amounts)` | poster gets `bondAmount`; pending challengers get `challengeAmount`; judge gets nothing | timeout unwinds only the unresolved tail of the queue after the ruling window expires |

## Function traces

### `createBond()`

Relevant code: `contracts/SimpleBondV4.sol:241-291`

- validates the economic configuration, including `judgeFee <= challengeAmount`
- writes the bond struct with fixed `bondAmount`, `challengeAmount`, and `judgeFee`
- transfers `bondAmount` from the poster to the contract

This grounds:

- `transfers bondAmount from poster to contract` in `test/SimpleBondV4.test.js:589-595`
- the later constant-threshold assertions, because the stored amounts are never changed after creation

The `judgeFee <= challengeAmount` guard is specifically important for poster-win accounting: it guarantees `ruleForPoster()` can always pay `challengeAmount - feeCharged` to the poster and `feeCharged` to the judge entirely out of the current challenger's deposit.

### `challenge()`

Relevant code: `contracts/SimpleBondV4.sol:305-325`

- appends a new `Challenge` with `status = 0`
- updates `lastChallengeTime`
- transfers `challengeAmount` from the challenger to the contract

This grounds:

- `transfers challengeAmount from challenger to contract` in `test/SimpleBondV4.test.js:678-683`
- `stores challenge metadata on-chain` in `test/SimpleBondV4.test.js:685-690`
- `allows multiple challengers to queue up` in `test/SimpleBondV4.test.js:693-698`
- the conservation check at `test/SimpleBondV4.test.js:1361-1363`, because each new pending challenge contributes one full `challengeAmount` of escrow and nothing else

Accounting-wise, each `challenge()` is just `contract += challengeAmount` plus one more pending queue entry.

### `ruleForPoster()`

Relevant code: `contracts/SimpleBondV4.sol:414-441`

- resolves exactly the current pending challenge
- marks that challenge `lost` (`status = 2`)
- pays `challengeAmount - feeCharged` to the poster
- pays `feeCharged` to the judge
- advances `currentChallenge` by one

The total payout is always exactly one `challengeAmount`, so this call removes one challenge deposit from contract escrow and leaves the poster bond untouched.

That directly grounds:

- `poster receives challengeAmount - feeCharged` in `test/SimpleBondV4.test.js:934-940`
- `judge receives feeCharged` in `test/SimpleBondV4.test.js:942-947`
- `bond pool stays at bondAmount (Robin's invariant)` in `test/SimpleBondV4.test.js:949-953`
- `advances queue to next challenge` in `test/SimpleBondV4.test.js:955-961`
- the multi-challenger step-down in `test/SimpleBondV4.test.js:1147-1156`

This is the key reason the belief thresholds stay constant. A poster win does not compound the pool. It just converts one challenger's escrow into a poster payment plus judge fee, leaving the same original `bondAmount` locked for the next challenger.

### `ruleForChallenger()`

Relevant code: `contracts/SimpleBondV4.sol:374-404`

- resolves exactly the current pending challenge
- marks that challenge `won` (`status = 1`)
- sets `settled = true`
- pays `bondAmount + challengeAmount - feeCharged` to the winning challenger
- pays `feeCharged` to the judge
- refunds all later pending challenges through `_refundRemaining(bondId, idx + 1)`

The current challenger is paid out of:

- the still-escrowed poster bond
- the current challenger's own deposit

Any later challengers are not part of that pot. Their deposits are returned 1:1 by `_refundRemaining()`.

That grounds:

- `challenger receives bondAmount + challengeAmount - feeCharged` in `test/SimpleBondV4.test.js:992-998`
- `judge receives feeCharged from pool` in `test/SimpleBondV4.test.js:1000-1005`
- `contract holds zero tokens after challenger wins` in `test/SimpleBondV4.test.js:1014-1018`
- `refunds remaining challengers when first challenger wins` in `test/SimpleBondV4.test.js:1020-1032`
- `second challenger wins after first loses - remaining refunded` in `test/SimpleBondV4.test.js:1132-1144`
- the final conservation check at `test/SimpleBondV4.test.js:1369-1370`

The anti-gaming behavior in `test/SimpleBondV4.test.js:1324-1341` follows from the same logic: an earlier weak challenge that loses only burns that challenger's own deposit. It does not consume the poster bond or protect the poster from the next queued challenge.

### `concede()`

Relevant code: `contracts/SimpleBondV4.sol:341-360`

- can only happen while `currentChallenge == 0`, so no ruling has started yet
- sets both `conceded = true` and `settled = true`
- refunds the full poster bond
- refunds every pending challenger via `_refundRemaining(bondId, 0)`
- pays the judge nothing

Because concession is only allowed before any ruling, the remaining escrow at that point is always:

`bondAmount + all queued challenge amounts`

and `concede()` empties all of it.

That grounds:

- `concession refunds poster's full bond` in `test/SimpleBondV4.test.js:756-762`
- `concession refunds ALL challengers in the queue` in `test/SimpleBondV4.test.js:764-778`
- `concession leaves zero tokens in contract` in `test/SimpleBondV4.test.js:780-785`
- `judge receives nothing on concession` in `test/SimpleBondV4.test.js:795-800`
- the refund-event checks in `test/SimpleBondV4.test.js:835-842`

### `withdrawBond()`

Relevant code: `contracts/SimpleBondV4.sol:453-465`

- requires `_noPendingChallenges(bondId)`
- sets `settled = true`
- transfers the full `bondAmount` back to the poster

The `_noPendingChallenges()` gate is what makes the withdrawal assertions safe. By the time `withdrawBond()` is callable, every challenge deposit has already been either:

- never posted
- paid out on a poster win
- or refunded/consumed on an earlier terminal path

So only the original bond escrow remains.

That grounds:

- `poster withdraws with no challenges - before deadline` in `test/SimpleBondV4.test.js:1173-1177`
- `poster withdraws after defeating all challengers` in `test/SimpleBondV4.test.js:1179-1187`
- `poster can withdraw after defeating all challengers` with zero post-withdraw balance in `test/SimpleBondV4.test.js:1120-1129`

### `claimTimeout()`

Relevant code: `contracts/SimpleBondV4.sol:474-492`

- requires the bond to still be unsettled with at least one pending challenge
- waits until `block.timestamp > rulingDeadline`
- sets `settled = true`
- refunds the full poster bond
- refunds every still-pending challenger starting at `currentChallenge`
- pays the judge nothing

This is the same unwind shape as concession except that it may occur after some earlier poster-win rulings. In that partial-ruling case:

- earlier losing challengers have already had their deposits paid out through `ruleForPoster()`
- `currentChallenge` points at the first unresolved challenge
- `_refundRemaining(bondId, currentChallenge)` returns only the unresolved tail of the queue

That grounds:

- `timeout refunds poster's bond` in `test/SimpleBondV4.test.js:1226-1231`
- `timeout refunds all pending challengers` in `test/SimpleBondV4.test.js:1233-1242`
- `timeout gives judge nothing` in `test/SimpleBondV4.test.js:1244-1249`
- `timeout leaves zero tokens in contract` in `test/SimpleBondV4.test.js:1251-1255`
- `timeout after partial rulings - only refunds remaining challengers` in `test/SimpleBondV4.test.js:1263-1277`

## How the named invariants map back to flows

### `bond pool stays at bondAmount`

Test: `test/SimpleBondV4.test.js:949-953`

Why it holds:

- `createBond()` introduces the only bond escrow
- `challenge()` adds side escrow in fixed `challengeAmount` increments
- `ruleForPoster()` removes exactly one challenge deposit and never spends `bondAmount`

So after the current challenger loses, the contract still holds the original `bondAmount` and nothing from that challenge.

### `belief thresholds stay constant across all challenges`

Test: `test/SimpleBondV4.test.js:1147-1161`

Why it holds:

- `bondAmount`, `challengeAmount`, and `judgeFee` are stored once in `createBond()` and never changed
- each `ruleForPoster()` consumes exactly one `challengeAmount` of pending challenge escrow
- the poster bond never grows when a challenger loses

So every queued challenger faces the same `bondAmount`, `challengeAmount`, and `judgeFee` as the previous one. The remaining contract balance steps down by whole challenge deposits, but the economic ratios remain unchanged.

### `token accounting invariant: total tokens always balance`

Test: `test/SimpleBondV4.test.js:1344-1370`

Why it holds in the tested environment:

- `createBond()` and `challenge()` only move tokens from users into the contract
- `ruleForPoster()`, `ruleForChallenger()`, `concede()`, `withdrawBond()`, and `claimTimeout()` only move previously escrowed tokens back out
- there is no minting or burning inside `SimpleBondV4`
- every payout sum matches the escrow that had already been posted for that branch of execution

In the specific test sequence:

1. two `challenge()` calls add `2 * challengeAmount` to contract escrow
2. one `ruleForPoster()` removes exactly one `challengeAmount`
3. one `ruleForChallenger()` removes the remaining `bondAmount + challengeAmount`

The participant balances plus contract balance therefore remain equal to the initial total after every step.

## Bottom line

The V4 accounting assertions are all consequences of two design choices in `SimpleBondV4`:

1. `bondAmount`, `challengeAmount`, and `judgeFee` are fixed once at creation.
2. Each challenge deposit is consumed exactly once, either as:
   - a poster-win payout (`challengeAmount`)
   - a challenger-win pot contribution (`challengeAmount` alongside the bond)
   - or a refund (`challengeAmount`)

Everything the tests call an accounting invariant is a direct consequence of those two choices plus the rule that the poster bond stays untouched until a terminal unwind or a challenger win.
