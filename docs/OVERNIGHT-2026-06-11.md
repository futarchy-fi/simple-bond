# Overnight work — 2026-06-11 (release prep)

All work committed + pushed to `main` (HEAD `e2b57a3`); full suite **1161 passing**,
lint within baseline; live surfaces verified.

## Shipped & live
1. **Email — real delivery, provider-agnostic.** `sendEmail()` now sends through
   either SMTP (nodemailer) or Resend, env-selected (`SMTP_HOST…` wins, else
   `RESEND_API_KEY`, else honest no-op). Deployed to the VM (still a no-op until a
   key/host is set — behaviour unchanged for now). Removed the dead AWS SES SDK.
2. **Heartbeat — all bond services monitored.** status.futarchy.fi now has
   **Bond Email Delivery** (degraded until a provider is configured; alerts on
   email-cursor stall) and **Bond Frontend** (marker check, not bare 200). The
   @azhermes bot alerts on any transition automatically — no bot change needed.
   Backend `/api/notify/health` exposes `email.enabled`.
3. **Release hardening:** M5 SRI pinned the ethers CDN tag (verified the page
   still loads in a real browser); M6 live ruling-window advisory in the create
   form (errors below 1h, warns 1h–6h); H1 explicit "this claim can no longer be
   challenged" notice when capacity is exhausted (was silently hidden).
4. **DNS hygiene (futarchy.fi):** added the **missing SPF** (`include:_spf.google.com`)
   and a monitoring-mode **DMARC** (`p=none`, reports to kelvin@futarchy.fi).
   This improves deliverability of ALL your Google Workspace mail, not just bonds.
5. **v0.7 archived** in-repo (README banner, audit-doc status, deployment-record
   `archiveStatus`). Code/tests/tooling kept as a future-cutover candidate.

## Evidence: self-hosting email is NOT viable (you asked "we do the hosting")
Ran a real experiment — generated DKIM, published aligned SPF/DKIM/DMARC on
`mail.futarchy.ai`, sent DKIM-signed direct-to-MX to Google. **Google rejected at
the SMTP layer:** `550-5.7.1 … not authorized to send email directly … use the
SMTP relay at your service provider` — because farol's IP is residential DSL. The
GCP VM is worse (outbound :25 hard-blocked). Full writeup:
`docs/email/SELF-HOST-EXPERIMENT-2026-06-11.md`. **Recommendation: authenticated
relay.** Cheapest with no new vendor = Google Workspace SMTP (you already host
kelvin@futarchy.fi there) — set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`,
`SMTP_USER`, `SMTP_PASS` (an app password). The mailer already supports it.

## Contract verification — DONE keyless (corrected from the earlier "parked")
I had wrongly parked this on an Etherscan key. **Sourcify is keyless** and
Etherscan displays its results, so I enabled it and verified **full_match**:
- SimpleBondV7 **mainnet** `0x2e23a8…1759` ✅
- SimpleBondV7 **sepolia** `0xA2aAD4…4276` ✅

Not done: **SimpleBondV6 mainnet** `0x6B24…` — its on-chain bytecode diverges
from the deploy-commit source at offset 3078 (a real code diff, not a
key/tooling issue), so it needs the exact as-deployed May source. Full handoff:
`docs/CONTRACT-VERIFICATION-2026-06-11.md`.

## Parked on you (1 item, can't be done autonomously)
- **Email delivery decision + credential.** Either a Google Workspace app password
  (recommended, no new vendor) or a Resend key. Drop into the secrets file; I do
  DNS/verify/deploy/live-test and the heartbeat goes green.

## Observed, not mine to fix
- 5 `read-only.spec.js` e2e cases fail on `--project local` — confirmed
  **pre-existing** (fail identically on a clean tree; Rabby-modal / hostname-routing
  env quirks, unrelated to tonight's changes).
