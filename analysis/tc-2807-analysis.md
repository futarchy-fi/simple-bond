# tc-2807 Analysis: dedupe duplicate registered judges in the create-bond dropdown

## Summary

The reported bug is that the judge dropdown in [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3914) can show the same judge twice when one address exists in both a hardcoded dropdown source and the on-chain `JudgeRegistered` event scan.

After reviewing the current branch state, the requested behavior already appears to be implemented:

- event-derived judge entries are normalized by lowercase address in [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3707)
- the dropdown renderer also tracks seen lowercase addresses before appending options in [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3921)
- the hardcoded Kleros judge option is inserted first and added to that same `seen` set in [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3923)
- on-chain Kleros entries are additionally filtered out during judge list construction in [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3797) and [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3986)

`HEAD` (`6e0dec4`) already contains commit `983d9b1` (`Fix duplicate registered judges rendering`), so this task looks stale relative to the checked-out branch.

## Current State

Relevant code paths:

1. [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3744) `loadJudges()`
   Builds the judges tab data from `JudgeRegistered` and `JudgeFeeUpdated` events, then stores `judgesList = normalizeJudges(nextJudges)`.

2. [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3955) `loadJudgeSelectOnCreate()`
   Performs the create-form lazy load and also stores `judgesList = normalizeJudges(nextJudges)`.

3. [`frontend/index.html`](/tmp/temporal-worktrees/task-tc-2807/frontend/index.html#L3914) `buildJudgeSelect()`
   Starts from the hardcoded Kleros option, then skips any later `judgesList` entry whose lowercase address is already in `seen`.

This means the branch currently has both:

- data-level deduplication for event-derived entries
- render-level deduplication for the final dropdown option list

That is stronger than the task requirement of deduplicating by address before rendering.

## Recommended Approach

No new code change is currently justified on this branch unless the issue can still be reproduced in the running app.

If the bug is still visible outside this checkout, the likely next checks are:

1. Verify the deployed frontend is actually serving code at or after commit `983d9b1`.
2. Reproduce with a judge address that is both hardcoded and emitted by `JudgeRegistered` on the active chain.
3. Confirm whether the duplicate is in the create-bond dropdown only, or in some other judge UI that bypasses `buildJudgeSelect()`.
4. If a new static judge source was introduced elsewhere, route that source through the same lowercase-address merge logic used here.

If a follow-up implementation ever becomes necessary, the narrowest fix remains:

1. Merge all judge sources into one map keyed by `address.toLowerCase()`.
2. Preserve the canonical display address and richer metadata from the first or preferred source.
3. Render `<option>` elements only from that deduplicated collection.

## Verification

For the current branch, verification should focus on confirming the existing fix rather than changing code:

1. Open the create bond form on a chain where the hardcoded Kleros judge address is registered on-chain.
2. Confirm the dropdown shows exactly one Kleros entry.
3. Confirm repeated `JudgeRegistered` history for the same address still yields a single dropdown option.
4. Confirm the displayed fee remains correct for the selected token after deduplication.

## Risk Notes

- Deduplicating by lowercase address is correct for EVM addresses, but the surviving entry should keep a checksummed display address.
- If two sources carry different metadata for the same address, the merge policy matters. The current code keeps the first address casing and merges token fees and max bond count.
- If the reported duplicate is coming from a deployed bundle that predates this branch, code changes here will not fix production until that bundle is redeployed.
