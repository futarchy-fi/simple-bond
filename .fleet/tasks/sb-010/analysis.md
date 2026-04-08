# sb-010 Analysis: expand `SECURITY.md` vulnerability policy

## Summary

This repository already contains a root `SECURITY.md`, added in commit `9aacb12` (`docs: add security policy`), so the task is no longer a true file-creation task on this branch.

The remaining work is to revise the existing policy so it matches the audit requirement exactly: add explicit scope coverage, add response timeline expectations, and add a note that the project has not had a formal audit.

## Current State

The current [`SECURITY.md`](../../../SECURITY.md) already covers two of the core policy elements:

- private reporting through the repository's GitHub Security Advisory flow
- guidance on what reporters should include in a report

What it does not yet include:

- explicit scope for `SimpleBondV4`, `KlerosJudge`, the frontend, and the notification backend
- concrete response-timeline expectations
- a statement that the project has not undergone a formal audit

## Relevant Repository Surface

The requested scope maps cleanly to the current repo layout:

- `contracts/SimpleBondV4.sol`
- `contracts/KlerosJudge.sol`
- `frontend/`
- `backend/`

That means the policy should stay repository-wide, but it should name those components directly so there is no ambiguity about what is covered.

## Implementation Plan

1. Update the existing root `SECURITY.md` instead of replacing it from scratch.
2. Keep the current private-reporting instruction and GitHub Security Advisory URL unless maintainers provide a preferred alternative channel.
3. Add a short `Scope` section that explicitly lists:
   - `SimpleBondV4` smart contract
   - `KlerosJudge` smart contract
   - frontend assets under `frontend/`
   - notification backend services under `backend/`
4. Expand `Disclosure Process` into timeline language with clear expectations, for example:
   - acknowledgement within a small fixed window
   - follow-up after initial triage
   - periodic updates while remediation is in progress
5. Add a brief note that the project has not had a formal audit and that reporters/users should not assume the system is audited.

## Recommended Content Shape

The final file should remain short and operational. A practical structure is:

1. `Reporting a Vulnerability`
2. `Scope`
3. `What to Include`
4. `Response Expectations`
5. `Audit Status`

This keeps the document easy to scan while satisfying the audit finding.

## Risks and Assumptions

- The current GitHub Security Advisory URL is assumed to be the intended reporting channel because it is already published in `SECURITY.md`.
- I found no repository-local evidence of a completed formal audit, so the requested "not formally audited" note is consistent with the current visible state.
- This should remain a documentation-only change; no contract, frontend, backend, or test files need modification.

## Verification Plan

Verification for the implementation should be limited to a content review:

1. Confirm `SECURITY.md` still exists at the repository root.
2. Confirm it tells reporters not to disclose vulnerabilities publicly.
3. Confirm it explicitly names the required in-scope components.
4. Confirm it contains concrete response-timeline expectations.
5. Confirm it states that the project has not had a formal audit.
