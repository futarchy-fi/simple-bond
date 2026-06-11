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
    // RESEND_API_KEY is force-emptied: these tests assert the email-DISABLED
    // honesty path, and a dev box with a real key must never make them send.
    env: { ...process.env, RESEND_API_KEY: "", BOND_NOTIFY_DB_PATH: dbPath, ...extraEnv },
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

  // ─── END-TO-END ROLE MAPPING (headline gap) ────────────────────────────────
  // The existing list/filter test SEEDS the DB directly (db.upsertBond /
  // db.upsertChallenge). That proves the read-model QUERY, but it does NOT prove
  // the WATCHER writes each role into the right column. The "My Bonds (as
  // challenger / as judge)" tabs rely on the live indexer-first path:
  //   real Challenged log  →  iface.parseLog  →  parsed.args.challenger  →  the
  //   challenger COLUMN  →  GET /api/bonds?challenger=… .
  // This test drives a REAL BondCreated log AND a REAL Challenged log THROUGH
  // indexChain/indexLogs (NOT db seeding), then asserts the api-server serves the
  // bond by EACH role. Distinct addresses P/J/C make it non-vacuous: if indexLogs
  // mis-mapped the Challenged role (e.g. wrote the poster or judge into the
  // challenger column, or wrote the wrong address), ?challenger=C would return
  // nothing and the test FAILS.
  it("E2E: a real BondCreated + Challenged through the watcher are served by role (poster/judge/challenger)", () => {
    const src = `
      import { ethers } from 'ethers';
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      import { V6_CONTRACT_ABI, CHAINS } from './backend/config.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 1;
      const iface = new ethers.Interface(V6_CONTRACT_ABI);
      // THREE DISTINCT addresses so a role swap is detectable.
      const P = '0x'+'11'.repeat(20); // poster
      const J = '0x'+'22'.repeat(20); // judge
      const C = '0x'+'cc'.repeat(20); // challenger (distinct from P and J)
      const TOK = '0x'+'33'.repeat(20);
      const bondId = 5n;

      // Encode the REAL v6 BondCreated + Challenged logs the way indexLogs parses
      // them. BondCreated carries poster/judge as indexed topics + claimContent in
      // data; Challenged carries the indexed challenger + content. indexLogs reads
      // parsed.args.challenger for the Challenged event and snapshots the bond
      // (poster/judge from bonds()) for BondCreated.
      const encB = iface.encodeEventLog(iface.getEvent('BondCreated'),
        [bondId, P, J, 0n, TOK, 1000n, 500n, 0n, 1n, 1n, 5n, '0x'+'ab'.repeat(32), 'role-map claim text']);
      const encC = iface.encodeEventLog(iface.getEvent('Challenged'),
        [bondId, 0n, C, 1n, '0x'+'ab'.repeat(32), '0x'+'00'.repeat(32), 'the challenge content']);
      const mk = (enc, bn, li) => ({ address: CHAINS[chainId].contract, topics: enc.topics, data: enc.data,
        blockNumber: bn, blockHash:'0x'+'cc'.repeat(32), transactionHash:'0x'+'dd'.repeat(32),
        transactionIndex:0, logIndex:li, removed:false });
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        // getLogs returns BOTH logs in the one window (ordered BondCreated then Challenged).
        getLogs: async () => [ mk(encB, CHAINS[chainId].startBlock+5, 0), mk(encC, CHAINS[chainId].startBlock+6, 1) ],
      };
      // bonds() supplies the poster/judge snapshot (the struct only has a claimHash).
      // getChallengeCount returns 0 so indexBondState's challenge-refresh loop is a
      // no-op: the challenger column can ONLY be populated by the Challenged event
      // handler in indexLogs (parsed.args.challenger). That isolates the mapping.
      const bondStruct = { poster:P, judge:J, token:TOK, bondAmount:1000n, challengeAmount:500n,
        judgeFee:0n, acceptanceDelay:1n, rulingBuffer:1n, maxChallenges:5n, claimHash:'0x'+'ab'.repeat(32),
        claimVersion:0n, judgeProfileId:0n, pendingCount:1n, settled:false, closed:false };
      const contract = {
        bonds: async (id) => { if (Number(id) !== 5) throw new Error('snapshot read wrong bondId '+id); return bondStruct; },
        getChallengeCount: async () => 0n,
        getChallenge: async () => { throw new Error('unused'); },
      };

      // Drive the REAL watcher pass (indexChain → scanWindowRecovering → indexLogs).
      await indexChain(chainId, provider, contract, iface, { sleep: async()=>{} });
      assert(db.getIndexCheckpoint(chainId) !== null, 'checkpoint advanced (window indexed)');

      // Now serve it over HTTP and assert every role resolves.
      const srv = startApiServer({ port: 3394, host: '127.0.0.1', onListen: async () => {
        const j = async (p) => (await fetch('http://127.0.0.1:3394'+p)).json();
        // Poll each POSITIVE role query until the watcher-written row is queryable.
        // The spawned child can be CPU-starved under full-suite load, making the
        // first read transiently empty; retry to a deadline so the test is
        // deterministic. A genuine mis-map never satisfies has5 → the assert below
        // still FAILS after the deadline (non-vacuity preserved), and the NEGATIVE
        // checks (P/J not in the challenger column) remain single, direct reads.
        const jPoll = async (p, ok) => { let r; for (let i=0;i<50;i++){ try { r = await j(p); if (ok(r)) return r; } catch(_){} await new Promise(x=>setTimeout(x,200)); } return r; };
        const has5 = (r) => !!(r && r.bonds && r.bonds.length===1 && r.bonds[0].bondId===5);
        const byPoster = await jPoll('/api/bonds?chainId=1&poster='+P, has5);
        assert(has5(byPoster), 'poster P serves bond 5 (got '+JSON.stringify((byPoster.bonds||[]).map(b=>b.bondId))+')');
        const byJudge = await jPoll('/api/bonds?chainId=1&judge='+J, has5);
        assert(has5(byJudge), 'judge J serves bond 5 (got '+JSON.stringify((byJudge.bonds||[]).map(b=>b.bondId))+')');
        // The crux: ?challenger=C must serve the bond — proving Challenged.args.challenger
        // landed in the challenger column (the live My-Bonds-as-challenger path).
        const byChal = await jPoll('/api/bonds?chainId=1&challenger='+C, has5);
        assert(has5(byChal), 'challenger C serves bond 5 (got '+JSON.stringify((byChal.bonds||[]).map(b=>b.bondId))+')');
        // NON-VACUITY: the challenger filter keyed on the POSTER or the JUDGE must
        // NOT return the bond — i.e. the watcher did not write P or J into the
        // challenger column. (If it had mis-mapped, one of these would be non-empty.)
        const chalIsPoster = await j('/api/bonds?chainId=1&challenger='+P);
        assert(chalIsPoster.bonds.length===0, 'poster P is NOT in the challenger column');
        const chalIsJudge = await j('/api/bonds?chainId=1&challenger='+J);
        assert(chalIsJudge.bonds.length===0, 'judge J is NOT in the challenger column');
        // And the claim text from the BondCreated event was snapshotted too.
        assert(byPoster.bonds[0].claimContent==='role-map claim text', 'claim text from BondCreated event');
        console.log('OK e2e role mapping P/J/C all resolve'); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  // The Challenged row written by indexLogs must carry the RIGHT challenger AND
  // be linked to the RIGHT bondId — i.e. it appears under /api/bonds/<id> with
  // the event's challenger + content, at the event's challengeIndex. This proves
  // the bond linkage of the challenge written on the live indexer path (not just
  // that the challenger column is queryable, but that it hangs off the correct
  // bond detail view the UI renders).
  it("E2E: the watcher-written Challenge is linked to the correct bond with the right challenger + content", () => {
    const src = `
      import { ethers } from 'ethers';
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      import { V6_CONTRACT_ABI, CHAINS } from './backend/config.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 1;
      const iface = new ethers.Interface(V6_CONTRACT_ABI);
      const P = '0x'+'aa'.repeat(20), J = '0x'+'bb'.repeat(20), C = '0x'+'dd'.repeat(20), TOK = '0x'+'ee'.repeat(20);
      // TWO bonds: only bond 8 is challenged. Asserting the challenge lands under
      // bond 8 (and NOT under the other bond) proves the bondId linkage.
      const encB7 = iface.encodeEventLog(iface.getEvent('BondCreated'),
        [7n, P, J, 0n, TOK, 1n, 1n, 0n, 1n, 1n, 5n, '0x'+'a7'.repeat(32), 'bond seven']);
      const encB8 = iface.encodeEventLog(iface.getEvent('BondCreated'),
        [8n, P, J, 0n, TOK, 1n, 1n, 0n, 1n, 1n, 5n, '0x'+'a8'.repeat(32), 'bond eight']);
      // Challenge bond 8 at challengeIndex 0 with a distinct content.
      const encC = iface.encodeEventLog(iface.getEvent('Challenged'),
        [8n, 0n, C, 1n, '0x'+'a8'.repeat(32), '0x'+'00'.repeat(32), 'linked challenge content']);
      const mk = (enc, bn, li) => ({ address: CHAINS[chainId].contract, topics: enc.topics, data: enc.data,
        blockNumber: bn, blockHash:'0x'+'cc'.repeat(32), transactionHash:'0x'+'dd'.repeat(32),
        transactionIndex:0, logIndex:li, removed:false });
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async () => [ mk(encB7, CHAINS[chainId].startBlock+5, 0), mk(encB8, CHAINS[chainId].startBlock+5, 1), mk(encC, CHAINS[chainId].startBlock+6, 2) ],
      };
      const struct = (claimHash) => ({ poster:P, judge:J, token:TOK, bondAmount:1n, challengeAmount:1n,
        judgeFee:0n, acceptanceDelay:1n, rulingBuffer:1n, maxChallenges:5n, claimHash,
        claimVersion:0n, judgeProfileId:0n, pendingCount:0n, settled:false, closed:false });
      const contract = {
        bonds: async (id) => struct(Number(id)===7 ? '0x'+'a7'.repeat(32) : '0x'+'a8'.repeat(32)),
        getChallengeCount: async () => 0n,
        getChallenge: async () => { throw new Error('unused'); },
      };
      await indexChain(chainId, provider, contract, iface, { sleep: async()=>{} });
      const srv = startApiServer({ port: 3395, host: '127.0.0.1', onListen: async () => {
        const j = async (p) => (await fetch('http://127.0.0.1:3395'+p)).json();
        // Poll until the watcher-written challenge is queryable (tolerate the
        // load-starved child's transient empty read; a true linkage bug never
        // satisfies the predicate and the asserts below still FAIL after the deadline).
        const jPoll = async (p, ok) => { let r; for (let i=0;i<50;i++){ try { r = await j(p); if (ok(r)) return r; } catch(_){} await new Promise(x=>setTimeout(x,200)); } return r; };
        const one8 = await jPoll('/api/bonds/8?chainId=1', r=>!!(r && r.bond && r.bond.bondId===8 && (r.challenges||[]).length===1));
        assert(one8.bond && one8.bond.bondId===8, 'bond 8 served');
        assert(one8.challenges.length===1, 'bond 8 has exactly one challenge (got '+one8.challenges.length+')');
        assert(one8.challenges[0].idx===0, 'challenge at the event challengeIndex 0');
        assert(one8.challenges[0].challenger===C.toLowerCase(), 'challenge carries the event challenger C (got '+one8.challenges[0].challenger+')');
        assert(one8.challenges[0].content==='linked challenge content', 'challenge carries the event content');
        // Linkage: the OTHER bond (7) must have NO challenge — the challenge is
        // bound to bondId 8, not leaked onto a sibling bond.
        const one7 = await j('/api/bonds/7?chainId=1');
        assert(one7.bond && one7.bond.bondId===7, 'bond 7 served');
        assert(one7.challenges.length===0, 'bond 7 has NO challenge (linkage is per-bondId; got '+one7.challenges.length+')');
        // And the challenger filter returns ONLY bond 8.
        const byChal = await j('/api/bonds?chainId=1&challenger='+C);
        assert(byChal.bonds.length===1 && byChal.bonds[0].bondId===8, 'challenger C → only bond 8 (got '+JSON.stringify(byChal.bonds.map(b=>b.bondId))+')');
        console.log('OK challenge linkage to bond 8 only'); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  // LIST META + LIMIT + ORDERING. Asserts the ACTUAL contract of
  // handleBondsList / db.listBonds (read from the source, not invented):
  //   • meta.blocksBehindHead = chain_heads.head − index_checkpoints.last_block.
  //   • `limit` clamps the row COUNT on the all/poster/judge paths (SQL LIMIT ?,
  //     itself capped at 500 by Math.min in handleBondsList).
  //   • ordering is deterministic by bond_id DESC.
  //   • REAL-BEHAVIOR NOTE (asserted as-is, not a wish): the CHALLENGER filter
  //     path in db.listBonds does NOT apply `limit` — it maps every DISTINCT
  //     bond_id from the challenges table. We assert that real behavior so the
  //     test documents it and would catch a silent change either way.
  it("attaches meta.blocksBehindHead and honors the limit/ordering contract (challenger path ignores limit — asserted as-is)", () => {
    const src = `
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 1;
      const base = { token:'0xtok', bond_amount:'1', challenge_amount:'1', judge_fee:'0',
        acceptance_delay:1, ruling_buffer:1, max_challenges:5, claim_hash:'0x', claim_version:0,
        pending_count:0, challenge_count:0, settled:false, closed:false, created_block:1 };
      const P = '0x'+'77'.repeat(20);   // shared poster across all bonds
      const C = '0x'+'99'.repeat(20);   // shared challenger across all bonds
      // 6 bonds, each by poster P and challenged by C, so the count clamp and the
      // ordering are observable on every path.
      for (let i = 0; i < 6; i++) {
        db.upsertBond({ ...base, chain_id:chainId, bond_id:i, poster:P, judge:'0xj'+i, judge_profile_id:i, claim_content:'b'+i });
        db.upsertChallenge({ chain_id:chainId, bond_id:i, idx:0, challenger:C, status:0, content:'x'+i });
      }
      // Indexer lag: head 1500, indexed-through 1490 => blocksBehindHead = 10.
      db.setIndexCheckpoint(chainId, 1490);
      db.setChainHead(chainId, 1500);

      const srv = startApiServer({ port: 3396, host: '127.0.0.1', onListen: async () => {
        const j = async (p) => (await fetch('http://127.0.0.1:3396'+p)).json();

        // --- meta.blocksBehindHead lag, relative to chain_heads vs checkpoint ---
        const all = await j('/api/bonds?chainId='+chainId);
        assert(all.meta, 'list attaches meta');
        assert(all.meta.chainId===chainId, 'meta.chainId');
        assert(all.meta.headBlock===1500, 'meta.headBlock=1500 (got '+all.meta.headBlock+')');
        assert(all.meta.indexedThroughBlock===1490, 'meta.indexedThroughBlock=1490 (got '+all.meta.indexedThroughBlock+')');
        assert(all.meta.blocksBehindHead===10, 'meta.blocksBehindHead = head-indexed = 10 (got '+all.meta.blocksBehindHead+')');

        // --- ordering: deterministic by bondId DESC ---
        assert(all.bonds.length===6, 'all 6 bonds with no limit (got '+all.bonds.length+')');
        const ids = all.bonds.map(b=>b.bondId);
        assert(JSON.stringify(ids)===JSON.stringify([5,4,3,2,1,0]), 'ordering is bondId DESC (got '+JSON.stringify(ids)+')');

        // --- limit clamps the COUNT on the all path ---
        const lim2 = await j('/api/bonds?chainId='+chainId+'&limit=2');
        assert(lim2.bonds.length===2, 'limit=2 clamps all-path count to 2 (got '+lim2.bonds.length+')');
        assert(JSON.stringify(lim2.bonds.map(b=>b.bondId))===JSON.stringify([5,4]), 'limit keeps the DESC head (got '+JSON.stringify(lim2.bonds.map(b=>b.bondId))+')');

        // --- limit clamps the COUNT on the poster path too ---
        const posLim2 = await j('/api/bonds?chainId='+chainId+'&poster='+P+'&limit=2');
        assert(posLim2.bonds.length===2, 'limit=2 clamps poster-path count to 2 (got '+posLim2.bonds.length+')');

        // --- limit clamps the COUNT on the challenger path too (audit AUDIT-v7 §6 B5:
        // this branch USED to ignore limit and return everything; now it sorts
        // bondId DESC first and caps, like every other branch). ---
        const chalLim2 = await j('/api/bonds?chainId='+chainId+'&challenger='+C+'&limit=2');
        assert(chalLim2.bonds.length===2, 'limit=2 clamps challenger-path count to 2 (got '+chalLim2.bonds.length+')');
        assert(JSON.stringify(chalLim2.bonds.map(b=>b.bondId))===JSON.stringify([5,4]), 'challenger path keeps the DESC head (got '+JSON.stringify(chalLim2.bonds.map(b=>b.bondId))+')');
        // unlimited challenger query still returns everything, DESC.
        const chalAll = await j('/api/bonds?chainId='+chainId+'&challenger='+C);
        assert(JSON.stringify(chalAll.bonds.map(b=>b.bondId))===JSON.stringify([5,4,3,2,1,0]), 'challenger path ordered bondId DESC (got '+JSON.stringify(chalAll.bonds.map(b=>b.bondId))+')');

        console.log('OK meta lag + limit clamp + ordering (challenger honors limit)'); srv.close(); process.exit(0);
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

describe("health endpoint honesty (overall status, not hardcoded ok)", function () {
  this.timeout(20000);

  // ── Pure helper unit tests: healthFromIndexer maps injected indexerStatus()
  // entries to an overall { status, indexer } WITHOUT a server, so the status
  // logic is provable in isolation. Each case is non-vacuous: it constructs the
  // single offending field and asserts both the per-entry healthy flag/reason
  // and the overall status. The old hardcoded "ok" would FAIL every degraded/
  // down case below.
  it("UNIT helper: healthy chain (fresh head, small lag, 0 dead-letters, fresh tick) => ok + entry.healthy true", () => {
    const src = `
      import { healthFromIndexer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const { status, indexer } = healthFromIndexer(
        [{ chainId:1, indexedThroughBlock:1490, headBlock:1500, blocksBehindHead:10, headUpdatedAt:'x', headAgeSeconds:5, deadLetters:0, blockedFromBlock:null }],
        { lagThreshold:200, tickThreshold:180 });
      assert(status==='ok', 'overall ok (got '+status+')');
      assert(indexer.length===1, 'one entry');
      assert(indexer[0].healthy===true, 'entry.healthy true');
      assert(Array.isArray(indexer[0].reasons) && indexer[0].reasons.length===0, 'no reasons');
      // additive, not destructive: existing fields preserved.
      assert(indexer[0].chainId===1 && indexer[0].blocksBehindHead===10 && indexer[0].deadLetters===0 && indexer[0].headAgeSeconds===5, 'existing fields preserved');
      console.log('OK'); process.exit(0);
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("UNIT helper: lag > threshold => degraded + entry.healthy false (head present, ticked)", () => {
    const src = `
      import { healthFromIndexer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const { status, indexer } = healthFromIndexer(
        [{ chainId:1, indexedThroughBlock:1000, headBlock:1500, blocksBehindHead:500, headUpdatedAt:'x', headAgeSeconds:5, deadLetters:0, blockedFromBlock:null }],
        { lagThreshold:200, tickThreshold:180 });
      assert(status==='degraded', 'overall degraded (got '+status+')');
      assert(indexer[0].healthy===false, 'entry unhealthy');
      assert(indexer[0].reasons.some(r=>/lag 500/.test(r)), 'reason names the lag (got '+JSON.stringify(indexer[0].reasons)+')');
      console.log('OK'); process.exit(0);
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("UNIT helper: deadLetters > 0 => degraded (THE bug: a dead-letter must not read as ok)", () => {
    const src = `
      import { healthFromIndexer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // Lag small, fresh tick, head present — ONLY the dead-letter is wrong, so
      // this isolates that a poison range alone flips ok -> degraded.
      const { status, indexer } = healthFromIndexer(
        [{ chainId:1, indexedThroughBlock:1490, headBlock:1500, blocksBehindHead:10, headUpdatedAt:'x', headAgeSeconds:5, deadLetters:1, blockedFromBlock:123 }],
        { lagThreshold:200, tickThreshold:180 });
      assert(status==='degraded', 'overall degraded on a dead-letter (got '+status+') — must NOT be ok');
      assert(indexer[0].healthy===false, 'entry unhealthy');
      assert(indexer[0].reasons.some(r=>/dead-letter/.test(r) && /123/.test(r)), 'reason names the dead-letter + blockedFromBlock (got '+JSON.stringify(indexer[0].reasons)+')');
      console.log('OK'); process.exit(0);
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("UNIT helper: stale tick (headAgeSeconds > threshold) => degraded (frozen-indexer signal; lag stays small)", () => {
    const src = `
      import { healthFromIndexer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // The real frozen-indexer shape: head+checkpoint froze together (RPC 429)
      // so lag is small AND no dead-letter yet, but the tick has aged out far
      // past the threshold. ONLY headAgeSeconds is the signal here.
      const { status, indexer } = healthFromIndexer(
        [{ chainId:1, indexedThroughBlock:1500, headBlock:1500, blocksBehindHead:0, headUpdatedAt:'old', headAgeSeconds:18000, deadLetters:0, blockedFromBlock:null }],
        { lagThreshold:200, tickThreshold:180 });
      assert(status==='degraded', 'overall degraded on a stale tick (got '+status+')');
      assert(indexer[0].healthy===false, 'entry unhealthy on stale tick');
      assert(indexer[0].reasons.some(r=>/stale tick/.test(r) && /18000/.test(r)), 'reason names the stale tick age (got '+JSON.stringify(indexer[0].reasons)+')');
      console.log('OK'); process.exit(0);
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("UNIT helper: never-ticked entry (headAgeSeconds null) => down; and NO entries => down", () => {
    const src = `
      import { healthFromIndexer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // Never ticked: no head timestamp and lag unknown.
      const a = healthFromIndexer(
        [{ chainId:1, indexedThroughBlock:null, headBlock:null, blocksBehindHead:null, headUpdatedAt:null, headAgeSeconds:null, deadLetters:0, blockedFromBlock:null }],
        { lagThreshold:200, tickThreshold:180 });
      assert(a.status==='down', 'never-ticked => down (got '+a.status+')');
      assert(a.indexer[0].healthy===false, 'never-ticked entry unhealthy');
      assert(a.indexer[0].reasons.some(r=>/never ticked/.test(r)), 'reason names never-ticked (got '+JSON.stringify(a.indexer[0].reasons)+')');
      // No entries at all => down (the indexer is not even registered).
      const b = healthFromIndexer([], { lagThreshold:200, tickThreshold:180 });
      assert(b.status==='down', 'no entries => down (got '+b.status+')');
      assert(b.indexer.length===0, 'no indexer entries');
      console.log('OK'); process.exit(0);
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  // ── FULL ENDPOINT (wiring) tests: start the real api-server, GET the real
  // /api/notify/health route, and assert the JSON status — so handleHealth's use
  // of the helper + the db.indexerStatus() read are covered, not just the helper.
  // These seed the DB through db.* so the indexerStatus() shape is exercised.
  it("ENDPOINT: a healthy chain serves status 'ok' over real /api/notify/health (HTTP 200)", () => {
    const src = `
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // Fresh head (datetime('now') via setChainHead) + tiny lag + no dead-letters.
      db.setIndexCheckpoint(1, 1499);
      db.setChainHead(1, 1500);
      const srv = startApiServer({ port: 3397, host: '127.0.0.1', onListen: async () => {
        // Poll-until-expected (positive check) so a CPU-starved child is deterministic.
        let resp, body;
        for (let i=0;i<50;i++){
          try { resp = await fetch('http://127.0.0.1:3397/api/notify/health'); body = await resp.json(); if (body.status==='ok') break; } catch(_){}
          await new Promise(x=>setTimeout(x,200));
        }
        assert(resp.status===200, 'HTTP 200 for ok (got '+resp.status+')');
        assert(body.status==='ok', 'overall status ok (got '+body.status+')');
        const e = body.indexer.find(x=>x.chainId===1);
        assert(e && e.healthy===true, 'chain-1 entry healthy');
        // Existing fields the monitor/frontend read are still present.
        assert(e.blocksBehindHead===1, 'blocksBehindHead preserved (got '+e.blocksBehindHead+')');
        assert(typeof e.headAgeSeconds==='number', 'headAgeSeconds preserved');
        assert(body.thresholds && body.thresholds.lagThreshold===200 && body.thresholds.tickThreshold===180, 'thresholds reported');
        console.log('OK endpoint ok'); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("ENDPOINT: a dead-letter makes /api/notify/health report 'degraded' (no longer lies), still HTTP 200", () => {
    const src = `
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // Fresh head + tiny lag, but a recorded dead-letter (the real bug we hit:
      // a poison range was served as status:"ok"). It must now read degraded.
      db.setIndexCheckpoint(1, 1499);
      db.setChainHead(1, 1500);
      db.recordDeadLetter(1, 1234, 1234, 'RPC 429 poison range');
      assert(db.getDeadLetters(1).length===1, 'dead-letter seeded');
      const srv = startApiServer({ port: 3398, host: '127.0.0.1', onListen: async () => {
        let resp, body;
        for (let i=0;i<50;i++){
          try { resp = await fetch('http://127.0.0.1:3398/api/notify/health'); body = await resp.json(); if (body.status==='degraded') break; } catch(_){}
          await new Promise(x=>setTimeout(x,200));
        }
        assert(body.status==='degraded', 'overall degraded on a dead-letter (got '+body.status+') — NOT ok');
        assert(resp.status===200, 'HTTP 200 kept for degraded so r.ok consumers still work (got '+resp.status+')');
        const e = body.indexer.find(x=>x.chainId===1);
        assert(e && e.healthy===false, 'chain-1 entry unhealthy');
        assert(e.deadLetters===1 && e.blockedFromBlock===1234, 'dead-letter fields preserved on the entry');
        assert(e.reasons.some(r=>/dead-letter/.test(r)), 'reason mentions the dead-letter (got '+JSON.stringify(e.reasons)+')');
        console.log('OK endpoint degraded'); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("ENDPOINT: a frozen indexer (stale tick) makes /api/notify/health report 'degraded' (HTTP 200)", () => {
    const src = `
      import db from './backend/db.mjs';
      import Database from 'better-sqlite3';
      import { DB_PATH } from './backend/config.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // The frozen-indexer shape: seed head=checkpoint (lag 0, no dead-letter),
      // then push chain_heads.updated_at far into the past so the tick is stale.
      // On an RPC outage head+checkpoint freeze together so lag stays small —
      // headAgeSeconds is the only honest signal, and it must flip to degraded.
      db.setIndexCheckpoint(1, 1500);
      db.setChainHead(1, 1500);
      const raw = new Database(DB_PATH);
      raw.prepare("UPDATE chain_heads SET updated_at = datetime('now','-18000 seconds') WHERE chain_id=1").run();
      raw.close();
      const s = db.indexerStatus().find(x=>x.chainId===1);
      assert(s.blocksBehindHead===0, 'lag is 0 (frozen together) so lag would NOT catch it');
      assert(s.deadLetters===0, 'no dead-letter so dead-letter would NOT catch it either');
      assert(s.headAgeSeconds>180, 'tick aged out (got '+s.headAgeSeconds+') — the real signal');
      const srv = startApiServer({ port: 3399, host: '127.0.0.1', onListen: async () => {
        let resp, body;
        for (let i=0;i<50;i++){
          try { resp = await fetch('http://127.0.0.1:3399/api/notify/health'); body = await resp.json(); if (body.status==='degraded') break; } catch(_){}
          await new Promise(x=>setTimeout(x,200));
        }
        assert(body.status==='degraded', 'frozen indexer => degraded (got '+body.status+')');
        assert(resp.status===200, 'HTTP 200 kept for degraded (got '+resp.status+')');
        const e = body.indexer.find(x=>x.chainId===1);
        assert(e && e.healthy===false && e.reasons.some(r=>/stale tick/.test(r)), 'entry unhealthy with stale-tick reason (got '+JSON.stringify(e.reasons)+')');
        console.log('OK endpoint frozen->degraded'); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });

  it("ENDPOINT: no indexer entries (never started) => status 'down' over real /api/notify/health (HTTP 503)", () => {
    const src = `
      import { startApiServer } from './backend/api-server.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      // Isolated temp DB with NO chain heads/checkpoints/dead-letters => the
      // indexer never started; the endpoint must say 'down', not 'ok'.
      const srv = startApiServer({ port: 3400, host: '127.0.0.1', onListen: async () => {
        let resp, body;
        for (let i=0;i<50;i++){
          try { resp = await fetch('http://127.0.0.1:3400/api/notify/health'); body = await resp.json(); if (body.status==='down') break; } catch(_){}
          await new Promise(x=>setTimeout(x,200));
        }
        assert(body.status==='down', 'no entries => down (got '+body.status+')');
        assert(resp.status===503, 'HTTP 503 only on overall down (got '+resp.status+')');
        assert(Array.isArray(body.indexer) && body.indexer.length===0, 'indexer array empty but present');
        console.log('OK endpoint down'); srv.close(); process.exit(0);
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
        // Status-page contract: delivery state is reported honestly (this suite
        // runs with RESEND_API_KEY force-emptied, so enabled must be false).
        assert(h.email && h.email.enabled === false, 'health.email.enabled false when no provider key');
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

  // The settle REASON is not on the struct or in the BondCreated snapshot — the
  // watcher must record it from the settle EVENT so the read model (and thus
  // Browse / My-Bonds / detail) can label the bond Cancelled instead of a bare
  // "Settled". Drives a real BondCreated + BondRejectedByJudge through
  // indexChain → indexLogs and asserts both the DB row and the API expose it.
  it("E2E: BondRejectedByJudge tags settleReason='cancelled' in the DB + API (list and detail)", () => {
    const src = `
      import { ethers } from 'ethers';
      import { indexChain } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      import { startApiServer } from './backend/api-server.mjs';
      import { V6_CONTRACT_ABI, CHAINS } from './backend/config.mjs';
      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 1;
      const iface = new ethers.Interface(V6_CONTRACT_ABI);
      const P = '0x'+'11'.repeat(20), J = '0x'+'22'.repeat(20), TOK = '0x'+'33'.repeat(20);
      const bondId = 7n;
      const encB = iface.encodeEventLog(iface.getEvent('BondCreated'),
        [bondId, P, J, 0n, TOK, 1000n, 500n, 0n, 1n, 1n, 5n, '0x'+'ab'.repeat(32), 'void test claim']);
      const encR = iface.encodeEventLog(iface.getEvent('BondRejectedByJudge'),
        [bondId, J, '0x'+'ab'.repeat(32), 'voided as out-of-scope']);
      const mk = (enc, bn, li) => ({ address: CHAINS[chainId].contract, topics: enc.topics, data: enc.data,
        blockNumber: bn, blockHash:'0x'+'cc'.repeat(32), transactionHash:'0x'+'dd'.repeat(32),
        transactionIndex:0, logIndex:li, removed:false });
      const provider = {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 20,
        getLogs: async () => [ mk(encB, CHAINS[chainId].startBlock+5, 0), mk(encR, CHAINS[chainId].startBlock+6, 1) ],
      };
      // After rejectBond the struct reads settled=true (poster refunded, 0 pending).
      const bondStruct = { poster:P, judge:J, token:TOK, bondAmount:1000n, challengeAmount:500n,
        judgeFee:0n, acceptanceDelay:1n, rulingBuffer:1n, maxChallenges:5n, claimHash:'0x'+'ab'.repeat(32),
        claimVersion:0n, judgeProfileId:0n, pendingCount:0n, settled:true, closed:false };
      const contract = {
        bonds: async () => bondStruct,
        getChallengeCount: async () => 0n,
        getChallenge: async () => { throw new Error('unused'); },
      };
      await indexChain(chainId, provider, contract, iface, { sleep: async()=>{} });
      const row = db.getBond(chainId, 7);
      assert(row && row.settled === 1, 'db: bond 7 settled');
      assert(row.settle_reason === 'cancelled', 'db: settle_reason=cancelled (got '+row.settle_reason+')');
      // Non-vacuity: an OPEN bond (no settle event) stays untagged.
      const encB0 = iface.encodeEventLog(iface.getEvent('BondCreated'),
        [8n, P, J, 0n, TOK, 1000n, 500n, 0n, 1n, 1n, 5n, '0x'+'ab'.repeat(32), 'open bond']);
      const open = { ...bondStruct, settled:false };
      await indexChain(chainId, {
        getBlockNumber: async () => CHAINS[chainId].startBlock + 40,
        getLogs: async () => [ mk(encB0, CHAINS[chainId].startBlock+25, 0) ],
      }, { bonds: async()=>open, getChallengeCount: async()=>0n, getChallenge: async()=>{throw new Error('x')} }, iface, { sleep: async()=>{} });
      const row8 = db.getBond(chainId, 8);
      assert(row8 && !row8.settle_reason, 'db: open bond 8 has NO settle_reason (got '+(row8&&row8.settle_reason)+')');

      const srv = startApiServer({ port: 3398, host: '127.0.0.1', onListen: async () => {
        const j = async (p) => (await fetch('http://127.0.0.1:3398'+p)).json();
        const jPoll = async (p, ok) => { let r; for (let i=0;i<50;i++){ try { r = await j(p); if (ok(r)) return r; } catch(_){} await new Promise(x=>setTimeout(x,200)); } return r; };
        const one = await jPoll('/api/bonds/7?chainId=1', (r)=>r && r.bond && r.bond.settleReason==='cancelled');
        assert(one.bond.settled === true, 'API detail: bond 7 settled');
        assert(one.bond.settleReason === 'cancelled', 'API detail: settleReason=cancelled (got '+(one.bond&&one.bond.settleReason)+')');
        const list = await jPoll('/api/bonds?chainId=1', (r)=>r && r.bonds && r.bonds.some(b=>b.bondId===7 && b.settleReason==='cancelled'));
        assert(list.bonds.some(b=>b.bondId===7 && b.settleReason==='cancelled'), 'API list: bond 7 settleReason=cancelled');
        const b8 = (list.bonds||[]).find(b=>b.bondId===8);
        assert(b8 && b8.settleReason===null, 'API list: open bond 8 settleReason=null');
        console.log('OK settle reason cancelled in DB + API (list + detail)'); srv.close(); process.exit(0);
      }});
    `;
    const r = runEsm(src, {
      MAINNET_V6_CONTRACT: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
      MAINNET_V6_START_BLOCK: "100",
    });
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });
});
