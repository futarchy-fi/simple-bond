// mailer.mjs (Resend) — the sendEmail contract: provider message id on success,
// null on failure OR when disabled, and it must NEVER throw (the email path
// runs inside the watcher tick and API handlers).
//
// Each case runs in an isolated child node process so RESEND_API_KEY and a
// mocked global fetch are controlled per scenario — no real network, and a dev
// box with a real key in the environment can't leak sends out of the suite.

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
        env: { ...process.env, RESEND_API_KEY: "", ...extraEnv },
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
        expect(JSON.parse(r.stdout)).to.deep.equal({ id: "re_test_123", calls: 1 });
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
