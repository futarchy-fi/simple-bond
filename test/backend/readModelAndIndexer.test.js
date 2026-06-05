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
});
