# temporal-fleet-9wi-r1 Analysis: identify gas-sensitive comment targets in `SimpleBondV4`

## Summary

After reviewing `contracts/SimpleBondV4.sol`, the non-obvious gas tradeoffs worth documenting are concentrated in four places:

1. `setJudgeFees(...)` at `contracts/SimpleBondV4.sol:187-195`
2. `ruleForPoster(...)` at `contracts/SimpleBondV4.sol:414-440`
3. `ruleForChallenger(...)` at `contracts/SimpleBondV4.sol:374-403`
4. `_refundRemaining(...)` and its terminal callers at `contracts/SimpleBondV4.sol:203-218`, `341-357`, `474-490`, and `576-586`

The important distinction is between:

- repeated judge-ruling paths that should stay cheap per step
- one-shot cleanup paths that deliberately accept linear cost in the remaining queue length

That O(1) versus O(n) split is the main gas story in V4. Small local choices like caching `currentChallenge` in `idx` matter less than the higher-level control-flow shape.

## Confirmed Comment Targets

### 1. `setJudgeFees(...)`

This is a good comment target.

Why it is non-obvious:

- batching saves fixed transaction overhead and avoids paying the registration check in separate transactions
- total work still scales linearly with `tokens.length`
- each batch entry still does its own zero-address validation, storage write, and `JudgeFeeUpdated` event emission

The useful comment here is not "this is a loop." It is that batching amortizes call overhead, but does not make large batches cheap. That helps future readers avoid over-interpreting the function as a general gas optimization rather than an administrative convenience.

### 2. `ruleForPoster(...)`

This is the highest-value ruling-path comment target.

Why it is non-obvious:

- in multi-challenge bonds, this is the path that can run repeatedly
- it only resolves the current challenge, pays the poster/judge, and increments `currentChallenge`
- it does not walk or refund the remaining queue

That shape keeps each poster-win ruling effectively O(1) in the number of remaining challengers. The subtle design choice is that the contract postpones tail cleanup until a terminal path, rather than charging every poster-win ruling for future challengers it has not reached yet.

If only one ruling function gets a dedicated gas note, it should be this one.

### 3. `ruleForChallenger(...)`

This is also worth documenting, but mainly as the asymmetric counterpart to `ruleForPoster(...)`.

Why it is non-obvious:

- once the current challenger wins, the bond is terminal
- the function immediately settles the bond and then calls `_refundRemaining(bondId, idx + 1)`
- gas therefore scales with the number of later pending challengers

The tradeoff is intentional: the contract keeps the repeated poster-win path cheap, then pays the queue-walk cost once when the bond reaches a terminal challenger-win outcome. That asymmetry is not obvious from the function summary alone and is worth one short comment.

### 4. `_refundRemaining(...)` and its callers

This is the main shared gas-scaling hotspot in the contract.

The existing comment on `_refundRemaining(...)` is directionally correct, but it does not fully connect the helper back to the external flows that inherit its cost:

- `rejectBond(...)`
- `concede(...)`
- `ruleForChallenger(...)`
- `claimTimeout(...)`

What is worth documenting explicitly:

- the helper is intentionally O(n) in the remaining queue length
- each refunded challenger adds both an ERC-20 transfer and a `ChallengeRefunded` log
- the expensive queue walk is centralized in terminal or escape-hatch flows instead of being spread across repeated rulings

The helper is still the best place for the main explanation. A short call-site note on the external functions would also be justified because those entrypoints otherwise look deceptively simple.

## Lower-Value Targets

These paths do not look worth additional gas comments:

- `setJudgeFee(...)`: constant work; the batch variant is where the real tradeoff starts
- `challenge(...)`: ordinary append-plus-transfer cost, with no especially subtle gas behavior
- `withdrawBond(...)`: simple terminal transfer with no queue walk
- `_noPendingChallenges(...)`: tiny helper, already obvious from the code
- `_rulingWindowStartFor(...)`, `_requireRulingWindow(...)`, and `_rulingDeadlineFor(...)`: timing helpers, not meaningful gas tradeoff surfaces

I would also avoid adding comments that focus only on `uint256 idx = b.currentChallenge;` or the `if (feeCharged > 0)` branch. Those are valid micro-optimizations, but by themselves they are too small and too obvious to be the main documentation target. They are worth mentioning only inside a broader note about why the ruling paths are structured differently.

## Recommended Comment Placement

If the follow-on implementation wants the smallest useful comment set, the best three locations are:

1. `setJudgeFees(...)`
2. `ruleForPoster(...)`
3. `_refundRemaining(...)`

If there is room for a fourth note, add it to `ruleForChallenger(...)` to make the asymmetry with `ruleForPoster(...)` explicit.

For `rejectBond(...)`, `concede(...)`, and `claimTimeout(...)`, a short inline note such as "terminal path accepts the shared refund-loop cost" is enough; the full explanation belongs on `_refundRemaining(...)`.

## Conclusion

The comment targets are real, but they are clustered rather than widespread.

The strongest documentation value comes from explaining that V4 deliberately keeps repeated poster-win rulings cheap and pushes queue-length-sensitive cleanup into shared terminal paths. That is the non-obvious gas tradeoff future readers are most likely to miss.
