# sb-005 Analysis: 60-day minimum ruling window for `KlerosJudge`

## Summary

The bond creation UI in `frontend/index.html` currently stores the ruling window as the global preset value `rulingBufferDays`, with preset buttons for 7, 14, and 30 days.

The requested behavior is frontend-only:

- when the selected judge is `KlerosJudge`, the ruling window must be at least 60 days
- other judges should keep the existing behavior
- the form should show a note explaining why Kleros needs the longer window

There is one important mismatch in the current codebase:

- Kleros is currently filtered out of the judge dropdown
- selecting the Kleros adapter address manually is rejected at submit time with `"The Kleros judge integration is temporarily unavailable."`

So this task is not just a validation tweak. The frontend currently prevents the Kleros selection path that the task refers to.

## Current Code Path

Relevant frontend areas:

- `frontend/index.html`
  - `buildJudgeSelect()`
    - currently excludes the deployed Kleros adapter from the create-bond judge dropdown
  - `loadJudgeSelectOnCreate()`
    - also skips Kleros when loading judges from on-chain events
  - `onJudgeSelectChange()`
    - updates the judge hint and the ruling-window preset state
    - currently shows `"The Kleros judge integration is temporarily unavailable."` if the selected option is Kleros
  - `resolveJudgeEns()`
    - handles the custom judge-address input but does not currently apply any Kleros-specific ruling-window behavior
  - `smartCreateBond()`
    - currently hard-rejects Kleros with:
      - `if (isKlerosJudge(judgeAddr)) { showMsg(...); return; }`
    - derives `rulingBuffer` from `rulingBufferDays`

Relevant contract context:

- `contracts/SimpleBondV4.sol`
  - only requires `rulingBuffer > 0`
  - does not enforce any Kleros-specific minimum
- `contracts/KlerosJudge.sol`
  - already assumes Kleros disputes may need longer timing
- `test/KlerosJudge.test.js`
  - uses a `RULING_BUFFER` of `90 * 86400`

This means the 60-day minimum in this task is a UI invariant, not an on-chain invariant.

## Historical Context

The original Kleros frontend integration commit (`703b21a`, `Add Kleros Court integration as decentralized judge option`) already had special create-form handling:

- Kleros was added as a dedicated top-level judge option
- selecting it auto-set the ruling window to 90 days
- lower ruling presets were disabled while Kleros was selected

That behavior was later removed or gated off. This task is effectively a narrower restoration of that special-case flow, but with a 60-day minimum instead of the historical 90-day lock.

## Recommended Change

Implement the rule in two layers:

1. UI-state enforcement
2. submit-time validation

### 1. UI-state enforcement

Adjust the create-bond judge/ruling-window flow so Kleros selection is actually reachable again and updates the form state immediately.

Recommended changes:

- Re-introduce Kleros as a selectable judge in `buildJudgeSelect()` when `KLEROS_JUDGE[activeChainId]` exists.
- Stop filtering Kleros out in `loadJudgeSelectOnCreate()`.
- Add a dedicated Kleros note near the ruling-window controls.
- Add a 60-day ruling preset button so the enforced minimum is selectable in the existing preset-only UI.
- When Kleros is selected:
  - if `rulingBufferDays < 60`, set it to `60`
  - disable preset buttons below 60 days
  - show the explanatory note
- When any non-Kleros judge is selected:
  - re-enable all ruling presets
  - hide the Kleros-specific note

Because the form has no freeform ruling-window input today, adding the 60-day preset is the cleanest way to express the minimum without inventing a new input model.

### 2. Submit-time validation

Keep a hard validation in `smartCreateBond()`:

- after resolving the effective `judgeAddr`
- before calling `createBond(...)`

If the effective judge is Kleros and `rulingBufferDays < 60`, reject submission with a clear error.

This protects against:

- stale session-restored form state
- custom-address entry of the Kleros adapter
- DOM manipulation or partial UI regressions

## Custom Address Handling

The implementation should not rely only on the dropdown option.

If the user chooses `Custom address...` and enters the deployed Kleros adapter address, the same minimum should apply. That likely means factoring the judge-dependent ruling-window UI into a small helper that can be called from both:

- `onJudgeSelectChange()`
- `resolveJudgeEns()` or another custom-address change handler

Without that, the dropdown path and the custom-address path will diverge.

## Note Copy

The note should explain the reason, not just the rule.

Expected content:

- Kleros disputes can take longer because arbitration and juror review happen off the SimpleBond contract timeline
- therefore bonds using `KlerosJudge` need at least a 60-day ruling window

Exact wording can stay concise; it just needs to make the policy understandable in the form.

## Test / Verification Plan

There is no dedicated frontend test harness in this repository. `package.json` only exposes Hardhat tests for contracts.

Implementation-phase verification should therefore be manual:

1. Load the create-bond form on Gnosis, where `KLEROS_JUDGE[100]` is configured.
2. Select Kleros from the judge dropdown.
3. Confirm the ruling window is forced up to at least 60 days.
4. Confirm lower presets are blocked while Kleros is selected.
5. Confirm the explanatory note appears.
6. Switch back to a normal judge and confirm the lower presets become available again.
7. Try the custom-address path with the Kleros adapter address and confirm the same behavior.
8. Attempt submission with a stale sub-60 state and confirm `smartCreateBond()` rejects it.

## Risk Notes

- Because the invariant is only enforced in the frontend, direct contract calls can still create Kleros bonds with shorter ruling windows.
- If a stronger guarantee is desired later, the minimum should move into the contract layer, likely in `SimpleBondV4.createBond(...)` or in a Kleros-specific wrapper path.
- The current task scope does not require that contract change.

## Implementation Scope

Expected files:

- `frontend/index.html`

No contract or Hardhat test changes should be necessary for this task as written.
