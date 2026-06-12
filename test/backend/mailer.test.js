// mailer.mjs — provider-agnostic sendEmail. Contract: provider message id on
// success, null on failure OR when disabled, and it must NEVER throw (the
// email path runs inside the watcher tick and API handlers). Provider
// selection: SMTP_HOST -> smtp; else RESEND_API_KEY -> resend; else disabled.
//
// Each case runs in an isolated child node process so the provider envs and a
// mocked global fetch / transport factory are controlled per scenario — no real
// network, and a dev box with real keys can't leak sends out of the suite.

const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function runMailer(fetchImpl, extraEnv) {
    const src = `
      ${fetchImpl}
      const { sendEmail } = await import('./backend/mailer.mjs');
      const id = await sendEmail('user@example.test', 'subject', '<b>body</b>');
      process.stdout.write(JSON.stringify({ id, calls: globalThis.__fetchCalls }));
    `;
    return spawnSync(process.execPath, ["--input-type=module", "-e", src], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, RESEND_API_KEY: "", SMTP_HOST: "", ...extraEnv },
    });
}

describe("mailer (Resend) sendEmail contract", function () {
    this.timeout(20000);

    it("without RESEND_API_KEY: returns null and never touches the network (honest no-op)", () => {
        const r = runMailer(`
          globalThis.__fetchCalls = 0;
          globalThis.fetch = async () => { globalThis.__fetchCalls++; return { ok: true, json: async () => ({ id: 'x' }) }; };
        `);
        if (r.status !== 0) throw new Error(r.stdout + r.stderr);
        expect(JSON.parse(r.stdout)).to.deep.equal({ id: null, calls: 0 });
    });

    it("with a key: returns the provider message id on 200", () => {
        const r = runMailer(`
          globalThis.__fetchCalls = 0;
          globalThis.fetch = async (url, opts) => {
            globalThis.__fetchCalls++;
            const body = JSON.parse(opts.body);
            if (!url.includes('api.resend.com') || !opts.headers.Authorization.startsWith('Bearer ')) throw new Error('bad request shape');
            if (!body.to || body.to[0] !== 'user@example.test') throw new Error('bad recipient');
            return { ok: true, status: 200, json: async () => ({ id: 're_test_123' }) };
          };
        `, { RESEND_API_KEY: "re_fake_key" });
        if (r.status !== 0) throw new Error(r.stdout + r.stderr);
        expect(JSON.parse(r.stdout.trim().split("\n").pop())).to.deep.equal({ id: "re_test_123", calls: 1 });
    });

    it("with a key: provider 4xx returns null (no throw)", () => {
        const r = runMailer(`
          globalThis.__fetchCalls = 0;
          globalThis.fetch = async () => {
            globalThis.__fetchCalls++;
            return { ok: false, status: 422, json: async () => ({ name: 'validation_error', message: 'bad from' }) };
          };
        `, { RESEND_API_KEY: "re_fake_key" });
        if (r.status !== 0) throw new Error(r.stdout + r.stderr);
        expect(JSON.parse(r.stdout)).to.deep.equal({ id: null, calls: 1 });
    });

    it("with a key: network failure returns null (no throw — watcher tick must survive)", () => {
        const r = runMailer(`
          globalThis.__fetchCalls = 0;
          globalThis.fetch = async () => { globalThis.__fetchCalls++; throw new Error('ECONNRESET'); };
        `, { RESEND_API_KEY: "re_fake_key" });
        if (r.status !== 0) throw new Error(r.stdout + r.stderr);
        expect(JSON.parse(r.stdout)).to.deep.equal({ id: null, calls: 1 });
    });
});

describe("mailer provider selection (SMTP / Resend / disabled)", function () {
    this.timeout(20000);

    function runSelect(extraEnv) {
        const src = `
      const m = await import('./backend/mailer.mjs');
      process.stdout.write(JSON.stringify({ provider: m.providerInUse(), enabled: m.emailEnabled() }));
    `;
        return spawnSync(process.execPath, ["--input-type=module", "-e", src], {
            cwd: ROOT,
            encoding: "utf8",
            env: { ...process.env, RESEND_API_KEY: "", SMTP_HOST: "", ...extraEnv },
        });
    }

    it("neither env -> disabled", () => {
        const r = runSelect({});
        expect(JSON.parse(r.stdout)).to.deep.equal({ provider: null, enabled: false });
    });

    it("RESEND_API_KEY alone -> resend", () => {
        const r = runSelect({ RESEND_API_KEY: "re_x" });
        expect(JSON.parse(r.stdout)).to.deep.equal({ provider: "resend", enabled: true });
    });

    it("SMTP_HOST alone -> smtp; SMTP wins over a stray Resend key (explicit infra beats vendor key)", () => {
        expect(JSON.parse(runSelect({ SMTP_HOST: "mail.internal" }).stdout))
            .to.deep.equal({ provider: "smtp", enabled: true });
        expect(JSON.parse(runSelect({ SMTP_HOST: "mail.internal", RESEND_API_KEY: "re_x" }).stdout))
            .to.deep.equal({ provider: "smtp", enabled: true });
    });

    it("SMTP path: message id from the transport on success; null + no throw on transport failure", () => {
        const src = `
      const m = await import('./backend/mailer.mjs');
      let calls = 0;
      m._setTransportFactoryForTests(async () => ({
        sendMail: async (opts) => {
          calls++;
          if (!opts.to || !opts.from.includes('ClaimBond')) throw new Error('bad envelope');
          return { messageId: '<smtp-test-1@mail.internal>' };
        },
      }));
      const ok = await m.sendEmail('user@example.test', 's', '<b>b</b>');
      m._setTransportFactoryForTests(async () => ({
        sendMail: async () => { calls++; throw new Error('connect ETIMEDOUT'); },
      }));
      const fail = await m.sendEmail('user@example.test', 's', '<b>b</b>');
      process.stdout.write(JSON.stringify({ ok, fail, calls }));
    `;
        const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], {
            cwd: ROOT,
            encoding: "utf8",
            env: { ...process.env, RESEND_API_KEY: "", SMTP_HOST: "mail.internal" },
        });
        if (r.status !== 0) throw new Error(r.stdout + r.stderr);
        // last stdout line: the success path logs '[mailer] sent via …' above it.
        expect(JSON.parse(r.stdout.trim().split("\n").pop())).to.deep.equal({
            ok: "<smtp-test-1@mail.internal>",
            fail: null,
            calls: 2,
        });
    });
});
