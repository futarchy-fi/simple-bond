# Self-hosted email — overnight experiment (2026-06-11)

**Question:** can bond.futarchy.ai send notification email from our own infra
(farol), avoiding a third-party provider, while landing in the inbox?

**Setup (real, not simulated):**
- DKIM 2048-bit keypair generated; published `farol._domainkey.mail.futarchy.ai`.
- Aligned SPF `v=spf1 ip4:179.111.200.44 ~all` on `mail.futarchy.ai`; DMARC `p=none`.
- nodemailer direct-to-MX (`aspmx.l.google.com:25`), DKIM-signed, EHLO `mail.futarchy.ai`.
- Recipient: kelvin@futarchy.fi (Google Workspace — the real target).

**Result: HARD FAIL at the connection layer.** Google rejected before DATA:
```
550-5.7.1 [179.111.200.44] The IP you're using to send mail is not authorized to
550-5.7.1 send email directly to our servers. Please use the SMTP relay at your
550 5.7.1  service provider instead.  (NotAuthorizedError)
```
This is not a spam-folder/reputation outcome we could warm up past — Google
refuses the SMTP transaction outright because the sender is a residential DSL
IP (rDNS `179-111-200-44.dsl.telesp.net.br`). Outbound :25 is open from farol,
but the receiving side blocks it. The GCP indexer VM is worse: GCP hard-blocks
outbound :25 entirely.

**Conclusion:** self-hosting an MTA for this product is not viable. The DSL IP
has no PTR/reputation and is explicitly refused; a clean static IP + warmup is
weeks of work for a notification trickle. Use a relay.

**Recommendation (unchanged, now evidence-backed):** route SMTP through an
authenticated relay. Cheapest path with NO new vendor: Google Workspace
(`smtp.gmail.com:587` + app password) — same account that already hosts
kelvin@futarchy.fi. The mailer already supports this: set `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`. Resend/SES remain alternatives.

Experiment DNS records (`mail.futarchy.ai` SPF/DKIM/DMARC) were removed after
the test; private key discarded.
