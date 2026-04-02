# tc-2809 Analysis: fix judge registration status detection

## Summary

The task report points to a broken `isJudgeRegistered()` check in [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2809/frontend/index.html), but the current branch does not actually contain a helper with that name.

Instead, the current code performs four direct reads of `readContract.judges(...)` and treats the return value as a plain boolean. That is a brittle assumption because the contract getter comes from a public mapping of a struct in [`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-tc-2809/contracts/SimpleBondV4.sol#L56), so browser-side `ethers` decoding can surface the result either as a bare boolean or as a tuple-like object such as `{ registered: true }` or `[true]`.

The safest interpretation of the bug is therefore: judge registration detection in the frontend is not normalized before use, so the UI can misclassify judge status depending on the return shape produced by the active runtime.

## Current State

The raw `judges(...)` getter result is consumed directly in four places:

1. [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2809/frontend/index.html#L3613)
   `findRegisteredJudgeChains()` uses `await readContract.judges(address) ? chainId : null` while scanning other chains.

2. [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2809/frontend/index.html#L3675)
   `refreshJudgeRegistrationUi()` uses the getter to decide whether to show the "You are registered as a judge" state or the registration form.

3. [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2809/frontend/index.html#L3779)
   `loadJudges()` filters the discovered `JudgeRegistered` event addresses by current on-chain registration status before rendering the judges tab.

4. [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2809/frontend/index.html#L3963)
   `loadJudgeSelectOnCreate()` performs the same status filter before populating the create-bond judge dropdown.

Those are the functional equivalents of an `isJudgeRegistered()` helper on this branch.

## Root Cause

[`contracts/SimpleBondV4.sol`](/tmp/temporal-worktrees/task-tc-2809/contracts/SimpleBondV4.sol#L56) defines:

```solidity
struct JudgeInfo {
    bool registered;
}

mapping(address => JudgeInfo) public judges;
```

That getter is ABI-compatible with a one-field tuple, not just a primitive `bool`.

The frontend currently assumes:

```js
const registered = await readContract.judges(addr);
if (registered) { ... }
```

That assumption is unstable across call environments. The code should first normalize the getter result into a real boolean and only then branch on it.

There is also a useful repo-history signal: `HEAD` on this branch is `0356f30`, and this branch does not contain commit `7d4585b` (`Fix judge registration status detection`). That historical fix adds a small normalization helper and routes these four call sites through it, which matches the failure mode above.

## Recommended Approach

Implement the smallest possible frontend-only fix in [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2809/frontend/index.html):

1. Add a helper near the judge registry utilities that converts the raw getter result into a boolean.
2. Accept all currently plausible shapes:
   - primitive `boolean`
   - object with `.registered`
   - tuple-like object or array with `[0]`
3. Return `false` for any unexpected value instead of letting truthiness decide behavior.
4. Replace all four direct `readContract.judges(...)` truthiness checks with the normalized helper result.

The narrow implementation shape is:

```js
function parseJudgeRegistration(value) {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object") {
    if (typeof value.registered === "boolean") return value.registered;
    if (typeof value[0] === "boolean") return value[0];
  }
  return false;
}
```

Then use:

```js
const registered = parseJudgeRegistration(await readContract.judges(addr));
```

## Verification Plan

Because the affected logic feeds multiple UI surfaces, verification should cover all four consumers:

1. Connect with an address already registered on the active chain and confirm the judges tab shows the registered-status panel instead of the registration form.
2. Connect with an address registered on a different deployed chain and confirm the cross-chain note still appears.
3. Confirm the public judges list includes currently registered judges and excludes deregistered judges.
4. Confirm the create-bond judge dropdown includes registered judges and excludes deregistered judges.

## Testing Notes

The current repo has contract tests for `bond.judges(...)` in [`test/SimpleBondV4.test.js`](/tmp/temporal-worktrees/task-tc-2809/test/SimpleBondV4.test.js#L87), but no automated frontend test coverage for the getter-shape normalization itself.

For this task, manual verification is likely sufficient because the code change is very small and local to one HTML file.

If automated coverage is desired later, the cleanest follow-up would be to move the normalization helper into a small testable JS module rather than leaving it embedded in the inline script.

## Risk Notes

- The fix should stay frontend-only; the contract and ABI are already consistent with a public struct getter.
- The helper must be reused at every registration read site. Fixing only the wallet-status panel would leave the judges list or create dropdown inconsistent.
- Defaulting unknown shapes to `false` is safer than relying on JS truthiness, but it also means any future ABI shape change should update this helper explicitly.
