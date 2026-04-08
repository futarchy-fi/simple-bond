# Security Policy

## Reporting a Vulnerability

Please do not report suspected vulnerabilities in public GitHub issues, pull
requests, or discussions.

Report them privately through this repository's GitHub Security Advisory flow:

https://github.com/futarchy-fi/simple-bond/security/advisories/new

## What to Include

Please include:

- the affected component or file
- a short impact summary
- clear reproduction steps or a proof of concept
- chain, network, and contract address when relevant

## Scope

This policy covers security issues affecting the main repository components,
including:

- `contracts/SimpleBondV4.sol`
- `contracts/KlerosJudge.sol`
- frontend assets under `frontend/`
- notification backend services under `backend/`

## Response Expectations

We aim to acknowledge new reports within 3 business days. After initial triage,
we aim to provide a follow-up status update within 7 business days, even if a
full fix is still in progress.

For valid reports that require longer remediation, we will continue to share
periodic status updates privately until a fix or mitigation is ready for
release.

## Audit Status

This project has not undergone a formal third-party security audit. Reporters
and users should not assume any contract, frontend, or backend component is
audited.
