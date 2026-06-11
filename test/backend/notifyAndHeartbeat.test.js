// P1 — notification outbox + email-delivery liveness + heartbeat.
//
// "Green ⟺ a real send happened recently" (not "a key is configured"), an
// append-only notification index that survives a re-scan, and a /events feed for
// the Telegram bot. Each case runs in an isolated child node process with its own
// temp DB (BOND_NOTIFY_DB_PATH); RESEND_API_KEY is force-emptied so a dev box key
// can't make these actually send.

const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..", "..");

function runEsm(src, extraEnv = {}) {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bond-nh-")), "t.db");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, RESEND_API_KEY: "", SMTP_HOST: "", BOND_NOTIFY_DB_PATH: dbPath, ...extraEnv },
  });
  return r;
}

// Parse the LAST stdout line as JSON (success paths log above it).
function lastJson(r) {
  if (r.status !== 0) throw new Error(r.stdout + r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

describe("notification outbox (notify_events)", function () {
  this.timeout(20000);

  it("records events with a monotonic seq and is idempotent on (chain, tx, logIndex)", () => {
    const r = runEsm(`
      const { default: db } = await import('./backend/db.mjs');
      db.recordNotifyEvent({ chain_id:1, block_number:100, tx_hash:'0xaa', log_index:0, event_type:'BondCreated', bond_id:0, summary:'Bond #0 created on Ethereum' });
      db.recordNotifyEvent({ chain_id:1, block_number:101, tx_hash:'0xbb', log_index:0, event_type:'Challenged', bond_id:0, summary:'Bond #0 challenged on Ethereum' });
      // Replay the first event (reorg / re-scan): must NOT create a duplicate.
      db.recordNotifyEvent({ chain_id:1, block_number:100, tx_hash:'0xaa', log_index:0, event_type:'BondCreated', bond_id:0, summary:'dup' });
      const all = db.getNotifyEventsSince(0, { limit: 50 });
      const status = db.notifyStatus();
      process.stdout.write(JSON.stringify({
        count: all.length,
        types: all.map(e => e.event_type),
        seqsAscending: all.every((e,i)=> i===0 || e.seq > all[i-1].seq),
        lastSeq: status.lastSeq,
        lastBlock1: status.lastNotifiedBlockByChain[1],
      }));
    `);
    expect(lastJson(r)).to.deep.equal({
      count: 2,
      types: ["BondCreated", "Challenged"],
      seqsAscending: true,
      lastSeq: 2,
      lastBlock1: 101,
    });
  });

  it("getNotifyEventsSince paginates by cursor and filters by chain", () => {
    const r = runEsm(`
      const { default: db } = await import('./backend/db.mjs');
      db.recordNotifyEvent({ chain_id:1, block_number:1, tx_hash:'0x1', log_index:0, event_type:'BondCreated', bond_id:0 });
      db.recordNotifyEvent({ chain_id:11155111, block_number:2, tx_hash:'0x2', log_index:0, event_type:'BondCreated', bond_id:0 });
      db.recordNotifyEvent({ chain_id:1, block_number:3, tx_hash:'0x3', log_index:0, event_type:'Challenged', bond_id:0 });
      const firstPage = db.getNotifyEventsSince(0, { limit: 2 });
      const afterCursor = db.getNotifyEventsSince(firstPage[firstPage.length-1].seq, { limit: 10 });
      const mainnetOnly = db.getNotifyEventsSince(0, { limit: 10, chains: [1] });
      process.stdout.write(JSON.stringify({
        firstPageSeqs: firstPage.map(e=>e.seq),
        afterCursorSeqs: afterCursor.map(e=>e.seq),
        mainnetChains: [...new Set(mainnetOnly.map(e=>e.chain_id))],
      }));
    `);
    expect(lastJson(r)).to.deep.equal({
      firstPageSeqs: [1, 2],
      afterCursorSeqs: [3],
      mainnetChains: [1],
    });
  });
});

describe("email delivery liveness (emailDeliveryStatus)", function () {
  this.timeout(20000);

  it("null ages when nothing has ever sent; fresh ages after a real and a heartbeat send", () => {
    const r = runEsm(`
      const { default: db, HEARTBEAT_EVENT_TYPE } = await import('./backend/db.mjs');
      const empty = db.emailDeliveryStatus();
      // An organic event email and a heartbeat both count as "a real send".
      db.logEmail('0xwallet', 1, 5, 'BondCreated', 'msg-organic-1');
      db.logEmail('__heartbeat__', 0, null, HEARTBEAT_EVENT_TYPE, 'msg-heartbeat-1');
      const after = db.emailDeliveryStatus();
      process.stdout.write(JSON.stringify({
        emptySend: empty.lastSendAgeSeconds,
        emptyHb: empty.lastHeartbeatAgeSeconds,
        afterSendFresh: after.lastSendAgeSeconds != null && after.lastSendAgeSeconds < 120,
        afterHbFresh: after.lastHeartbeatAgeSeconds != null && after.lastHeartbeatAgeSeconds < 120,
      }));
    `);
    expect(lastJson(r)).to.deep.equal({
      emptySend: null,
      emptyHb: null,
      afterSendFresh: true,
      afterHbFresh: true,
    });
  });
});

describe("heartbeat (heartbeatOnce)", function () {
  this.timeout(20000);

  it("disabled (no provider): returns null, sends nothing, logs nothing → stays not-fresh", () => {
    const r = runEsm(`
      const { heartbeatOnce } = await import('./backend/heartbeat.mjs');
      const { default: db } = await import('./backend/db.mjs');
      const id = await heartbeatOnce();
      const after = db.emailDeliveryStatus();
      process.stdout.write(JSON.stringify({ id, lastSendAge: after.lastSendAgeSeconds }));
    `);
    expect(lastJson(r)).to.deep.equal({ id: null, lastSendAge: null });
  });

  it("enabled (SMTP stub): sends a real email, logs it, and delivery goes fresh", () => {
    const r = runEsm(`
      const mailer = await import('./backend/mailer.mjs');
      mailer._setTransportFactoryForTests(async () => ({
        sendMail: async (opts) => {
          if (!opts.to || !opts.from.includes('SimpleBond')) throw new Error('bad envelope');
          return { messageId: '<hb-test-1@mail.internal>' };
        },
      }));
      const { heartbeatOnce } = await import('./backend/heartbeat.mjs');
      const { default: db } = await import('./backend/db.mjs');
      const id = await heartbeatOnce('2026-06-11T00:00:00.000Z');
      const after = db.emailDeliveryStatus();
      process.stdout.write(JSON.stringify({
        id,
        heartbeatLogged: after.lastHeartbeatAgeSeconds != null,
        sendFresh: after.lastSendAgeSeconds != null,
      }));
    `, { SMTP_HOST: "mail.internal" });
    expect(lastJson(r)).to.deep.equal({
      id: "<hb-test-1@mail.internal>",
      heartbeatLogged: true,
      sendFresh: true,
    });
  });
});

describe("notifyHealthFrom (pure health builder)", function () {
  this.timeout(20000);

  it("computes per-chain notifyLagBlocks from head − lastNotifiedBlock; null when head/cursor missing", () => {
    const r = runEsm(`
      const { notifyHealthFrom } = await import('./backend/api-server.mjs');
      const notify = { lastSeq: 7, lastNotifiedBlockByChain: { 1: 1000, 11155111: 50 } };
      const indexer = [ { chainId: 1, headBlock: 1005 }, { chainId: 11155111, headBlock: null } ];
      process.stdout.write(JSON.stringify(notifyHealthFrom(notify, indexer)));
    `);
    expect(lastJson(r)).to.deep.equal({
      lastSeq: 7,
      perChain: [
        { chainId: 1, lastNotifiedBlock: 1000, headBlock: 1005, notifyLagBlocks: 5 },
        { chainId: 11155111, lastNotifiedBlock: 50, headBlock: null, notifyLagBlocks: null },
      ],
    });
  });
});

describe("/api/notify/events + /api/notify/health (HTTP surface)", function () {
  this.timeout(20000);

  it("serves the feed with a cursor and exposes email+notify blocks on health", () => {
    const r = runEsm(`
      const { default: db } = await import('./backend/db.mjs');
      const { startApiServer } = await import('./backend/api-server.mjs');
      db.recordNotifyEvent({ chain_id:1, block_number:100, tx_hash:'0xaa', log_index:0, event_type:'BondCreated', bond_id:0, summary:'Bond #0 created on Ethereum' });
      db.recordNotifyEvent({ chain_id:1, block_number:101, tx_hash:'0xbb', log_index:0, event_type:'Challenged', bond_id:0, summary:'Bond #0 challenged on Ethereum' });
      db.setChainHead(1, 200);
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      startApiServer({ port: 3394, host: '127.0.0.1', onListen: async () => {
        const j = async (p) => (await fetch('http://127.0.0.1:3394'+p)).json();
        const feed = await j('/api/notify/events?since=0&limit=10');
        assert(feed.events.length === 2, 'two events');
        assert(feed.lastSeq === 2, 'cursor lastSeq=2');
        assert(feed.events[0].summary.includes('created'), 'summary present');
        const page2 = await j('/api/notify/events?since=' + feed.lastSeq);
        assert(page2.events.length === 0, 'no events past cursor');
        const h = await j('/api/notify/health');
        assert(h.email && h.email.enabled === false, 'email.enabled honest false');
        assert(h.email.lastSendAgeSeconds === null, 'no send yet');
        assert(typeof h.email.freshnessThresholdSeconds === 'number', 'freshness threshold present');
        assert(h.notify && h.notify.lastSeq === 2, 'health notify lastSeq=2');
        const c1 = h.notify.perChain.find(x=>x.chainId===1);
        assert(c1 && c1.notifyLagBlocks === 99, 'notifyLag = 200 - 101 (max notified block)');
        process.stdout.write(JSON.stringify({ ok: true }));
        process.exit(0);
      }});
    `);
    expect(lastJson(r)).to.deep.equal({ ok: true });
  });
});
