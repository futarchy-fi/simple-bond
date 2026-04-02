# sb-final Analysis: add `SECURITY.md`

## Summary

This branch does not contain a `SECURITY.md` file or any existing responsible disclosure instructions.

The requested implementation is a small documentation-only change: add a short root-level `SECURITY.md` that tells security researchers how to report vulnerabilities privately and what information to include.

## Current Branch State

- `SECURITY.md` is not tracked in the repository root.
- The repo contains smart contracts, a backend notification service, and a frontend, so the policy should cover the whole repository rather than a single component.
- There is no existing public security policy text in `README.md` or elsewhere.

## Key Constraint

The only material detail missing from the repository is the actual private reporting channel.

Current repo-visible contact signals are not enough for a security policy:

- public domains: `bond.futarchy.ai`, `api.bond.futarchy.ai`
- sender email in config: `noreply@futarchy.ai`

`noreply@futarchy.ai` should not be used as the disclosure address. The implementation should use a confirmed private channel, preferably one of:

1. a dedicated mailbox such as `security@futarchy.ai`, if it exists
2. GitHub private vulnerability reporting / security advisories, if enabled for the repo

## Recommended `SECURITY.md` Shape

Keep the file short and practical. Recommended sections:

1. `Reporting a Vulnerability`
   - ask reporters not to file public GitHub issues for suspected vulnerabilities
   - provide the private reporting channel
2. `What to Include`
   - affected component
   - impact summary
   - reproduction steps or proof of concept
   - chain / network and contract address when relevant
3. `Disclosure Process`
   - acknowledge receipt within a stated timeframe
   - coordinate remediation before public disclosure
   - send status updates during triage

## Content Decisions

- Do not add a supported-versions matrix unless the maintainers actually want to promise version support; this repo currently looks like a single active code line, so a short policy is better.
- Do not over-promise bug bounty rewards or SLA terms that the repository does not already support operationally.
- A README edit is optional, not required for this task. Root-level `SECURITY.md` is sufficient.

## Verification

Verification for the implementation should be limited to:

1. confirm `SECURITY.md` exists at the repository root
2. confirm it contains a private disclosure instruction and avoids public-issue reporting
3. confirm the contact method is real and not `noreply@futarchy.ai`
4. confirm the file remains short and repository-wide in scope

## Implementation Scope

Expected implementation change surface:

- add `SECURITY.md`

No contract, backend, frontend, or test changes should be needed.
