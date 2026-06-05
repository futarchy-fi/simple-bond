// Tier (b) backend unit tests: the bonds read-model API (zero coverage before)
// and the indexer's resilience (retry, no-clobber, no-skip). Each test runs in
// a child node process with an isolated temp DB (BOND_NOTIFY_DB_PATH).
const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..", "..");

function runEsm(src, extraEnv = {}) {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bond-rm-")), "t.db");
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, BOND_NOTIFY_DB_PATH: dbPath, ...extraEnv },
  });
  return r;
}

describe("bonds read-model API", function () {
  this.timeout(20000);

  it("serves list + filters (poster/judge/challenger) and single bond with challenges", () => {
    const src = `
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      const base = { token:'0xtok', bond_amount:'1', challenge_amount:'1', judge_fee:'0',
        acceptance_delay:1, ruling_buffer:1, max_challenges:5, claim_hash:'0x', claim_version:0,
        pending_count:0, challenge_count:0, settled:false, closed:false, created_block:1 };
      db.upsertBond({ ...base, chain_id:1, bond_id:0, poster:'0xPoster', judge:'0xJudgeA', judge_profile_id:0, claim_content:'zero' });
      db.upsertBond({ ...base, chain_id:1, bond_id:1, poster:'0xPoster', judge:'0xJudgeB', judge_profile_id:1, claim_content:'one' });
      db.upsertChallenge({ chain_id:1, bond_id:1, idx:0, challenger:'0xChal', status:0, content:'bad' });
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const srv = startApiServer({ port: 3391, host: '127.0.0.1', onListen: async () => {
        const j = async (p) => (await fetch('http://127.0.0.1:3391'+p)).json();
        const all = await j('/api/bonds?chainId=1');
        assert(all.bonds.length===2, 'list count');
        assert(all.bonds[0].bondId===1, 'desc order');
        assert(all.bonds.find(b=>b.bondId===1).claimContent==='one', 'claim text');
        const byJudge = await j('/api/bonds?chainId=1&judge=0xJudgeB');
        assert(byJudge.bonds.length===1 && byJudge.bonds[0].bondId===1, 'judge filter');
        const byPoster = await j('/api/bonds?chainId=1&poster=0xPoster');
        assert(byPoster.bonds.length===2, 'poster filter');
        const byChal = await j('/api/bonds?chainId=1&challenger=0xChal');
        assert(byChal.bonds.length===1 && byChal.bonds[0].bondId===1, 'challenger filter');
        const one = await j('/api/bonds/1?chainId=1');
        assert(one.bond.claimContent==='one' && one.challenges.length===1, 'single bond');
        const missingResp = await fetch('http://127.0.0.1:3391/api/bonds/999?chainId=1');
        assert(missingResp.status===404, '404 missing');
        const badChain = await fetch('http://127.0.0.1:3391/api/bonds');
        assert(badChain.status===400, '400 no chainId');
        console.log('OK'); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });
});

describe("notify register (email-honesty)", function () {
  this.timeout(20000);

  it("does NOT claim an email was sent when email delivery is disabled (mailer no-op)", () => {
    // EMAIL_ENABLED is false in backend/mailer.mjs, so sendEmail returns null and
    // no message id is logged. handleRegister must then return an HONEST message
    // — it must NOT say a verification email was sent; it must say the
    // subscription was recorded and delivery is not yet enabled (A6 honesty).
    const src = `
      import { ethers } from 'ethers';
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const wallet = ethers.Wallet.createRandom();
      const email = 'honest@example.com';
      const chainId = 1;
      const timestamp = Math.floor(Date.now()/1000);
      const message = 'Enable SimpleBond notifications for '+email+' on chain '+chainId+'. Timestamp: '+timestamp;
      const signature = await wallet.signMessage(message);
      const srv = startApiServer({ port: 3393, host: '127.0.0.1', onListen: async () => {
        const resp = await fetch('http://127.0.0.1:3393/api/notify/register', {
          method: 'POST', headers: { 'Content-Type':'application/json' },
          body: JSON.stringify({ address: wallet.address, email, chainId, signature, timestamp }),
        });
        const body = await resp.json();
        assert(resp.status === 200, 'register 200 (got '+resp.status+')');
        assert(body.ok === true, 'ok:true');
        // Must NOT falsely claim an email was sent.
        assert(!/email sent/i.test(body.message), 'must NOT claim email sent (got: '+body.message+')');
        // Must say the subscription was recorded AND delivery not yet enabled.
        assert(/recorded/i.test(body.message), 'mentions recorded (got: '+body.message+')');
        assert(/not (yet )?enabled/i.test(body.message), 'mentions not-yet-enabled (got: '+body.message+')');
        // Subscription was actually persisted.
        const sub = db.getSubscription(wallet.address, chainId);
        assert(sub && sub.email === email.toLowerCase(), 'subscription persisted');
        console.log('OK message='+JSON.stringify(body.message)); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });
});

describe("indexer resilience", function () {
  this.timeout(20000);

  it("retries a transient getLogs window and still advances to head", () => {
    const src = `
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      // v6 chain must be registered for indexChain to run.
      process.env.MAINNET_V6_CONTRACT; // (set via env below)
      const { CHAINS } = await import('./backend/config.mjs');
      const chainId = 1;
      // One getLogs failure then success — assert the retry absorbs it.
      let calls = 0;
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 5, // 1 small window after confirmations
        getLogs: async () => { calls++; if (calls === 1) throw new Error('408 timeout'); return []; },
      };
      const contract = {}; const iface = {};
      await indexChain(chainId, provider, contract, iface, { sleep: async()=>{} });
      const cp = db.getIndexCheckpoint(chainId);
      if (cp === null) { console.error('FAIL checkpoint did not advance'); process.exit(2); }
      console.log('OK calls='+calls+' cp='+cp); process.exit(0);
    `;
    // safeBlock = startBlock+5-12 < startBlock → nothing to scan. Use a higher head so 1 window exists.
    const r = runEsm(src.replace("startBlock + 5", "startBlock + 20"), {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("does NOT advance the checkpoint past a permanently-failing window (no data skipped)", () => {
    const src = `
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      const { CHAINS } = await import('./backend/config.mjs');
      const chainId = 1;
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async () => { throw new Error('persistent 500'); },
      };
      await indexChain(chainId, provider, {}, {}, { sleep: async()=>{} });
      const cp = db.getIndexCheckpoint(chainId);
      // Must remain unset (null) — the failed first window was never committed.
      if (cp !== null) { console.error('FAIL checkpoint advanced to', cp); process.exit(2); }
      console.log('OK checkpoint preserved'); process.exit(0);
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("reports indexer lag via indexerStatus + /health (stalled indexer is visible)", () => {
    const src = `
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      db.setIndexCheckpoint(1, 1000);
      db.setChainHead(1, 1500);
      const s = db.indexerStatus().find(x => x.chainId === 1);
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      assert(s.indexedThroughBlock === 1000, 'indexed');
      assert(s.headBlock === 1500, 'head');
      assert(s.blocksBehindHead === 500, 'lag '+s.blocksBehindHead);
      const srv = startApiServer({ port: 3392, host: '127.0.0.1', onListen: async () => {
        const h = await (await fetch('http://127.0.0.1:3392/api/notify/health')).json();
        assert(Array.isArray(h.indexer), 'health.indexer array');
        assert(h.indexer.find(x=>x.chainId===1).blocksBehindHead === 500, 'health lag');
        console.log('OK'); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("fails over a dead RPC to a healthy one (row comes from provider[1]) and advances the checkpoint", () => {
    // A real ethers.FallbackProvider (quorum:1) over two JsonRpcProvider fakes:
    // provider[0]'s eth_blockNumber + eth_getLogs throw, provider[1] returns a
    // head and a single v6 BondCreated log. The bond row landing in the DB can
    // only have come from provider[1], proving failover (RCA gap #1).
    const src = `
      import { ethers } from 'ethers';
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      import { V6_CONTRACT_ABI, CHAINS } from './backend/config.mjs';

      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 1;
      const net = ethers.Network.from(chainId);
      const iface = new ethers.Interface(V6_CONTRACT_ABI);

      // Encode a real v6 BondCreated log (bondId 42) that only provider[1] serves.
      const frag = iface.getEvent('BondCreated');
      const enc = iface.encodeEventLog(frag, [
        42n, '0x'+'11'.repeat(20), '0x'+'22'.repeat(20), 0n, '0x'+'33'.repeat(20),
        1000n, 500n, 0n, 1n, 1n, 5n, '0x'+'ab'.repeat(32), 'failover claim text',
      ]);
      const head = CHAINS[chainId].startBlock + 20;
      const logObj = {
        address: CHAINS[chainId].contract, topics: enc.topics, data: enc.data,
        blockNumber: CHAINS[chainId].startBlock + 5, blockHash: '0x'+'cc'.repeat(32),
        transactionHash: '0x'+'dd'.repeat(32), transactionIndex: 0, logIndex: 0, removed: false,
      };

      // JsonRpcProvider subclass whose JSON-RPC sender is stubbed per behavior.
      class FakeJsonRpc extends ethers.JsonRpcProvider {
        constructor(name, b) { super('http://localhost:0', net, { staticNetwork: net, batchMaxCount: 1 }); this._name=name; this._b=b; }
        async _send(payload) {
          const reqs = Array.isArray(payload) ? payload : [payload];
          return reqs.map(req => {
            if (req.method === 'eth_blockNumber') {
              if (this._b.headThrow) return { id:req.id, error:{ code:-32000, message:this._name+' head boom' } };
              return { id:req.id, result: ethers.toQuantity(this._b.head) };
            }
            if (req.method === 'eth_getLogs') {
              if (this._b.logsThrow) return { id:req.id, error:{ code:-32000, message:this._name+' logs boom' } };
              return { id:req.id, result: this._b.logs || [] };
            }
            if (req.method === 'eth_chainId') return { id:req.id, result: ethers.toQuantity(Number(net.chainId)) };
            return { id:req.id, error:{ code:-32601, message:'unsupported '+req.method } };
          });
        }
      }

      const p0 = new FakeJsonRpc('p0', { headThrow:true, logsThrow:true });
      const p1 = new FakeJsonRpc('p1', { head, logs: [logObj] });
      const provider = new ethers.FallbackProvider([
        { provider: p0, priority: 1, stallTimeout: 200, weight: 1 },
        { provider: p1, priority: 2, stallTimeout: 200, weight: 1 },
      ], net, { quorum: 1 });

      // Contract resolves bond state from chain (also via failover in prod). Here
      // the bond struct is returned directly so indexBondState can write the row.
      const contract = {
        bonds: async () => ({ poster:'0x'+'11'.repeat(20), judge:'0x'+'22'.repeat(20), token:'0x'+'33'.repeat(20),
          bondAmount:1000n, challengeAmount:500n, judgeFee:0n, acceptanceDelay:1n, rulingBuffer:1n,
          maxChallenges:5n, claimHash:'0x'+'ab'.repeat(32), claimVersion:0n, judgeProfileId:0n,
          pendingCount:0n, settled:false, closed:false }),
        getChallengeCount: async () => 0n,
        getChallenge: async () => { throw new Error('unused'); },
      };

      await indexChain(chainId, provider, contract, iface, { sleep: async()=>{} });

      const row = db.getBond(chainId, 42);
      assert(row, 'bond row written via failover (provider[1])');
      assert(row.claim_content === 'failover claim text', 'claim text came from provider[1] log');
      const cp = db.getIndexCheckpoint(chainId);
      assert(cp !== null, 'checkpoint advanced after failover');
      console.log('OK failover row+checkpoint cp='+cp); process.exit(0);
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("does NOT advance the checkpoint when the window fails on ALL providers (no-skip invariant)", () => {
    // FallbackProvider over two fakes that BOTH throw on eth_getLogs: the head
    // is readable (so a window exists) but every endpoint fails the scan, so the
    // checkpoint must stay unset — no data is silently skipped.
    const src = `
      import { ethers } from 'ethers';
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      import { CHAINS } from './backend/config.mjs';

      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 1;
      const net = ethers.Network.from(chainId);
      const head = CHAINS[chainId].startBlock + 20;

      class FakeJsonRpc extends ethers.JsonRpcProvider {
        constructor(name, b) { super('http://localhost:0', net, { staticNetwork: net, batchMaxCount: 1 }); this._name=name; this._b=b; }
        async _send(payload) {
          const reqs = Array.isArray(payload) ? payload : [payload];
          return reqs.map(req => {
            if (req.method === 'eth_blockNumber') return { id:req.id, result: ethers.toQuantity(this._b.head) };
            if (req.method === 'eth_getLogs') return { id:req.id, error:{ code:-32000, message:this._name+' logs boom' } };
            if (req.method === 'eth_chainId') return { id:req.id, result: ethers.toQuantity(Number(net.chainId)) };
            return { id:req.id, error:{ code:-32601, message:'unsupported '+req.method } };
          });
        }
      }

      const p0 = new FakeJsonRpc('p0', { head });
      const p1 = new FakeJsonRpc('p1', { head });
      const provider = new ethers.FallbackProvider([
        { provider: p0, priority: 1, stallTimeout: 200, weight: 1 },
        { provider: p1, priority: 2, stallTimeout: 200, weight: 1 },
      ], net, { quorum: 1 });

      await indexChain(chainId, provider, {}, {}, { sleep: async()=>{} });
      const cp = db.getIndexCheckpoint(chainId);
      assert(cp === null, 'checkpoint must NOT advance when all providers fail the window (got '+cp+')');
      console.log('OK no-skip preserved across all providers'); process.exit(0);
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("sub-chunks a window that fails large but succeeds halved, advances to head, no permanent dead-letter", () => {
    const src = `
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      const { CHAINS } = await import('./backend/config.mjs');
      const chainId = 1;
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // head startBlock+20, confirmations 12 => safeBlock = startBlock+8, a single
      // ~9-block window. Provider THROWS when (to-from) > 4 (too-large) but returns
      // [] for any smaller sub-range — so the window only succeeds once sub-chunked.
      const K = 4;
      let throws = 0, succeeds = 0;
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async ({ fromBlock, toBlock }) => {
          if ((toBlock - fromBlock) > K) { throws++; throw new Error('query returned more than limit / too large'); }
          succeeds++; return [];
        },
      };
      await indexChain(chainId, provider, {}, {}, { sleep: async()=>{} });
      const safe = CHAINS[chainId].startBlock + 8;
      const cp = db.getIndexCheckpoint(chainId);
      assert(cp === safe, 'checkpoint advanced to head/safe (got '+cp+', want '+safe+')');
      assert(throws > 0, 'large window actually failed first (throws='+throws+')');
      assert(succeeds > 0, 'sub-ranges succeeded (succeeds='+succeeds+')');
      const dls = db.getDeadLetters(chainId);
      assert(dls.length === 0, 'no permanent dead-letter recorded (got '+dls.length+')');
      console.log('OK sub-chunk recovery throws='+throws+' succeeds='+succeeds+' cp='+cp); process.exit(0);
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("dead-letters a true 1-block poison and does NOT advance the checkpoint (no-skip at floor)", () => {
    const src = `
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      const { CHAINS } = await import('./backend/config.mjs');
      const chainId = 1;
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // getLogs ALWAYS throws, even at the 1-block floor => true poison block.
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async () => { throw new Error('always poison 500'); },
      };
      await indexChain(chainId, provider, {}, {}, { sleep: async()=>{} });
      const cp = db.getIndexCheckpoint(chainId);
      assert(cp === null, 'checkpoint must NOT advance past the poison window (got '+cp+')');
      const dls = db.getDeadLetters(chainId);
      assert(dls.length >= 1, 'a dead_letter row was recorded (got '+dls.length+')');
      // The recorded range must start at the cursor start (startBlock) — the
      // 1-block floor of the first window.
      assert(dls[0].from_block === CHAINS[chainId].startBlock, 'dead-letter from_block at window floor (got '+dls[0].from_block+')');
      assert(dls[0].from_block === dls[0].to_block, 'dead-letter is a 1-block range (got '+dls[0].from_block+'-'+dls[0].to_block+')');
      console.log('OK poison dead-lettered from='+dls[0].from_block+' to='+dls[0].to_block+' cp='+cp); process.exit(0);
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("re-attempts a dead-lettered range on a later tick, indexes it, advances, and clears the dead-letter", () => {
    const src = `
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      const { CHAINS } = await import('./backend/config.mjs');
      const chainId = 1;
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const safe = CHAINS[chainId].startBlock + 8;
      // Tick 1: always-poison => dead-letter recorded, checkpoint held.
      let poison = true;
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async () => { if (poison) throw new Error('transient poison'); return []; },
      };
      await indexChain(chainId, provider, {}, {}, { sleep: async()=>{} });
      assert(db.getIndexCheckpoint(chainId) === null, 'tick1 checkpoint held');
      assert(db.getDeadLetters(chainId).length >= 1, 'tick1 dead-letter recorded');
      // Tick 2: poison cleared (infra recovered). The dead-letter retry + cursor
      // scan now succeed => range indexed, checkpoint advances, dead-letter gone.
      poison = false;
      await indexChain(chainId, provider, {}, {}, { sleep: async()=>{} });
      const cp = db.getIndexCheckpoint(chainId);
      assert(cp === safe, 'tick2 checkpoint advanced to head/safe (got '+cp+', want '+safe+')');
      assert(db.getDeadLetters(chainId).length === 0, 'tick2 dead-letter cleared (got '+db.getDeadLetters(chainId).length+')');
      console.log('OK dead-letter retried+cleared cp='+cp); process.exit(0);
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("exposes a correct UTC headAgeSeconds and flags a stale tick (freshness/liveness SLO)", () => {
    // (a) An OLD chain_heads.updated_at (~1h ago) written via the db (so the UTC
    // handling is exercised) must yield a large headAgeSeconds and read as stale.
    // (c) A db-written datetime('now') read back immediately must be within a few
    // seconds of 0 — proving no timezone skew of hours.
    const src = `
      import db from './backend/db.mjs';
      import Database from 'better-sqlite3';
      import { DB_PATH } from './backend/config.mjs';
      import { isTickStale } from './scripts/monitor.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };

      // --- (a) OLD timestamp written through the db (SQLite datetime, UTC, no suffix). ---
      // Seed via setChainHead (now), then rewrite updated_at to ~1h ago using the
      // same datetime() function the watcher relies on, so the UTC path is real.
      db.setChainHead(1, 1500);
      const raw = new Database(DB_PATH);
      raw.prepare("UPDATE chain_heads SET updated_at = datetime('now','-3600 seconds') WHERE chain_id=1").run();
      raw.close();
      const sOld = db.indexerStatus().find(x => x.chainId === 1);
      assert(sOld.headUpdatedAt != null, 'headUpdatedAt still present');
      assert(Math.abs(sOld.headAgeSeconds - 3600) <= 30, 'old age ~3600 (got '+sOld.headAgeSeconds+')');
      assert(isTickStale(sOld.headAgeSeconds, 180) === true, 'old tick flagged stale');

      // --- (c) FRESH db-written timestamp read back immediately => ~0, no skew. ---
      db.setChainHead(2, 2500);
      const sFresh = db.indexerStatus().find(x => x.chainId === 2);
      assert(sFresh.headAgeSeconds != null, 'fresh age present');
      assert(sFresh.headAgeSeconds < 10, 'fresh age ~0, no tz skew of hours (got '+sFresh.headAgeSeconds+')');
      assert(isTickStale(sFresh.headAgeSeconds, 180) === false, 'fresh tick not stale');

      // --- never-ticked chain (no head row) => age null and treated as stale. ---
      assert(isTickStale(null, 180) === true, 'never-ticked flagged stale');
      assert(isTickStale(undefined, 180) === true, 'undefined age flagged stale');

      console.log('OK old='+sOld.headAgeSeconds+' fresh='+sFresh.headAgeSeconds); process.exit(0);
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("headAgeSeconds is computed as UTC (no local-time skew) from a known timestamp", () => {
    // Pure-function check of the UTC parse: a timestamp 1h in the past, in the
    // SQLite "YYYY-MM-DD HH:MM:SS" (UTC, no suffix) shape, must be ~3600s old
    // regardless of the host timezone. We pin TZ to a non-UTC zone to prove the
    // parser does not interpret the string as local time.
    const src = `
      import { headAgeSeconds } from './backend/db.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const now = Date.now();
      // Build a UTC timestamp 3600s ago in the exact SQLite datetime('now') shape.
      const past = new Date(now - 3600*1000).toISOString().slice(0,19).replace('T',' ');
      const age = headAgeSeconds(past, now);
      assert(Math.abs(age - 3600) <= 2, 'UTC age ~3600 under TZ='+process.env.TZ+' (got '+age+')');
      assert(headAgeSeconds(null, now) === null, 'null timestamp => null age');
      console.log('OK utc age='+age+' tz='+process.env.TZ); process.exit(0);
    `;
    const r = runEsm(src, { TZ: "America/Sao_Paulo" });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("does not clobber challenge_count to 0 when getChallengeCount fails", () => {
    const src = `
      import { indexBondState } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      const chainId = 1, bondId = 7;
      // Seed a bond that already has 3 challenges recorded.
      db.upsertBond({ chain_id:chainId, bond_id:bondId, poster:'0xP', judge:'0xJ', judge_profile_id:0,
        token:'0xt', bond_amount:'1', challenge_amount:'1', judge_fee:'0', acceptance_delay:1, ruling_buffer:1,
        max_challenges:5, claim_hash:'0x', claim_content:'x', claim_version:0, pending_count:1,
        challenge_count:3, settled:false, closed:false, created_block:1 });
      // A contract whose bonds() succeeds but getChallengeCount throws.
      const contract = {
        bonds: async () => ({ poster:'0xP', judge:'0xJ', token:'0xt', bondAmount:1n, challengeAmount:1n,
          judgeFee:0n, acceptanceDelay:1n, rulingBuffer:1n, maxChallenges:5n, claimHash:'0x', claimVersion:0n,
          judgeProfileId:0n, pendingCount:1n, settled:false, closed:false }),
        getChallengeCount: async () => { throw new Error('rpc blip'); },
        getChallenge: async () => { throw new Error('unused'); },
      };
      await indexBondState(contract, chainId, bondId, undefined);
      const row = db.getBond(chainId, bondId);
      if (row.challenge_count !== 3) { console.error('FAIL clobbered to', row.challenge_count); process.exit(2); }
      console.log('OK preserved challenge_count=3'); process.exit(0);
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("does NOT silently drop a bond on a transient bonds() read failure; retries it on a later tick (no skip)", () => {
    // A real BondCreated log is served by getLogs, but contract.bonds() throws on
    // tick 1 (transient RPC miss). The old code swallowed this and advanced past
    // the window, leaving the bond unindexed until a later event re-triggered it.
    // Now the miss must SURFACE and HOLD the checkpoint (no-skip) so the next tick
    // re-reads the same window and indexes the bond once bonds() recovers.
    const src = `
      import { ethers } from 'ethers';
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      import { V6_CONTRACT_ABI, CHAINS } from './backend/config.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 1;
      const iface = new ethers.Interface(V6_CONTRACT_ABI);
      const frag = iface.getEvent('BondCreated');
      const enc = iface.encodeEventLog(frag, [
        7n, '0x'+'11'.repeat(20), '0x'+'22'.repeat(20), 0n, '0x'+'33'.repeat(20),
        1000n, 500n, 0n, 1n, 1n, 5n, '0x'+'ab'.repeat(32), 'transient bond text',
      ]);
      const logObj = { address: CHAINS[chainId].contract, topics: enc.topics, data: enc.data,
        blockNumber: CHAINS[chainId].startBlock + 5, blockHash: '0x'+'cc'.repeat(32),
        transactionHash: '0x'+'dd'.repeat(32), transactionIndex: 0, logIndex: 0, removed: false };
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async () => [logObj],
      };
      let bondsThrow = true;
      const goodBond = { poster:'0x'+'11'.repeat(20), judge:'0x'+'22'.repeat(20), token:'0x'+'33'.repeat(20),
        bondAmount:1000n, challengeAmount:500n, judgeFee:0n, acceptanceDelay:1n, rulingBuffer:1n,
        maxChallenges:5n, claimHash:'0x'+'ab'.repeat(32), claimVersion:0n, judgeProfileId:0n,
        pendingCount:0n, settled:false, closed:false };
      const contract = {
        bonds: async () => { if (bondsThrow) throw new Error('transient bonds() rpc miss'); return goodBond; },
        getChallengeCount: async () => 0n,
        getChallenge: async () => { throw new Error('unused'); },
      };
      // Tick 1: bonds() throws => must NOT advance the checkpoint and must NOT
      // write a (clobbered/empty) row; the miss is surfaced + held, not lost.
      await indexChain(chainId, provider, contract, iface, { sleep: async()=>{} });
      assert(db.getIndexCheckpoint(chainId) === null, 'tick1 checkpoint held (bonds() miss not skipped)');
      assert(db.getBond(chainId, 7) == null, 'tick1 wrote no bond row');
      // It must NOT be misclassified as a poison block / dead-lettered.
      assert(db.getDeadLetters(chainId).length === 0, 'tick1 no dead-letter for an index-layer (bonds) miss');
      // Tick 2: bonds() recovers => the SAME window is re-read and the bond lands.
      bondsThrow = false;
      await indexChain(chainId, provider, contract, iface, { sleep: async()=>{} });
      const row = db.getBond(chainId, 7);
      assert(row, 'tick2 bond indexed after retry (not lost)');
      assert(row.claim_content === 'transient bond text', 'tick2 claim text indexed');
      assert(db.getIndexCheckpoint(chainId) !== null, 'tick2 checkpoint advanced');
      console.log('OK transient bonds() miss retried, not silently dropped'); process.exit(0);
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("distinguishes a getLogs failure (sub-chunk/dead-letter) from an indexLogs/DB error (surface, NOT poison-block)", () => {
    // B2 over-broad-catch fix: only a getLogs-layer failure is eligible for
    // sub-chunk + dead-letter recovery. An indexLogs/DB-layer error (here a
    // contract.bonds() failure during indexLogs) is NOT helped by halving the
    // block range, so it must surface and hold the checkpoint WITHOUT being
    // dead-lettered as a poison block.
    const src = `
      import { ethers } from 'ethers';
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      import { V6_CONTRACT_ABI, CHAINS } from './backend/config.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 1;
      const iface = new ethers.Interface(V6_CONTRACT_ABI);
      const frag = iface.getEvent('BondCreated');
      const enc = iface.encodeEventLog(frag, [
        9n, '0x'+'11'.repeat(20), '0x'+'22'.repeat(20), 0n, '0x'+'33'.repeat(20),
        1000n, 500n, 0n, 1n, 1n, 5n, '0x'+'ab'.repeat(32), 'db-error bond',
      ]);
      const logObj = { address: CHAINS[chainId].contract, topics: enc.topics, data: enc.data,
        blockNumber: CHAINS[chainId].startBlock + 5, blockHash: '0x'+'cc'.repeat(32),
        transactionHash: '0x'+'dd'.repeat(32), transactionIndex: 0, logIndex: 0, removed: false };

      // --- Case A: getLogs ALWAYS fails (true poison) => dead-lettered. ---
      const poisonProvider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async () => { throw new Error('always poison 500 from getLogs'); },
      };
      await indexChain(chainId, poisonProvider, {}, {}, { sleep: async()=>{} });
      assert(db.getIndexCheckpoint(chainId) === null, 'A: getLogs poison holds checkpoint');
      assert(db.getDeadLetters(chainId).length >= 1, 'A: getLogs poison IS dead-lettered (sub-chunked to floor)');
      const dlA = db.getDeadLetters(chainId)[0];
      assert(dlA.from_block === dlA.to_block, 'A: dead-letter is the 1-block floor (sub-chunking happened)');
      // Clear so case B starts clean.
      for (const dl of db.getDeadLetters(chainId)) db.clearDeadLetter(chainId, dl.from_block, dl.to_block);

      // --- Case B: getLogs SUCCEEDS but indexLogs (bonds() read) fails => an
      // index/DB-layer error: must surface + hold, but NOT be dead-lettered. ---
      let getLogsCalls = 0;
      const dbErrProvider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async () => { getLogsCalls++; return [logObj]; },
      };
      const badContract = {
        bonds: async () => { throw new Error('DB/read layer failure during indexLogs'); },
        getChallengeCount: async () => 0n,
        getChallenge: async () => { throw new Error('unused'); },
      };
      await indexChain(chainId, dbErrProvider, badContract, iface, { sleep: async()=>{} });
      assert(db.getIndexCheckpoint(chainId) === null, 'B: index/DB error holds checkpoint (no-skip)');
      assert(db.getDeadLetters(chainId).length === 0, 'B: index/DB error is NOT dead-lettered as a poison block');
      // It must NOT have sub-chunked: a single getLogs call for the one window
      // (no halving), proving it was not misclassified as a too-large getLogs.
      assert(getLogsCalls === 1, 'B: no sub-chunking on an index/DB error (getLogsCalls='+getLogsCalls+')');
      assert(db.getBond(chainId, 9) == null, 'B: no bond row written on the DB-layer failure');
      console.log('OK getLogs-failure dead-lettered; index/DB-failure surfaced, not poison-blocked'); process.exit(0);
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });
});
