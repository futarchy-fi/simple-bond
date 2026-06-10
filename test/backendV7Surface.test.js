// Backend v0.7 surface tests (cutover prep for SimpleBondV7). These assert the
// backend learned the V7 ABI + indexing WITHOUT registering a live v7 chain:
//   • abiForChain switches on bondVersion with an explicit 7→V7, 6→V6, else V5
//     ladder (NOT the old binary `v===6 ? V6 : V5` ternary that would have
//     silently dropped a v7 chain to the V5 ABI — SPEC_V07 "the trap to avoid").
//   • V7_CONTRACT_ABI declares the new C2 ledger events (Credited/Claimed) and
//     drops ChallengeRefunded, while keeping the v6 lifecycle events.
//   • The indexer ingests a synthetic v7 BondCreated + Credited + Claimed batch
//     through indexLogs without crashing and writes the bond row.
//
// Each case runs in an isolated child node process. The v7 chain is injected
// into the in-memory CHAINS map AT RUNTIME (CHAINS is a mutable exported object)
// so no v7 chain is ever registered in the real config / live deployment.
const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");

function runEsm(src, extraEnv = {}) {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bond-v7-")), "t.db");
  return spawnSync(process.execPath, ["--input-type=module", "-e", src], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, BOND_NOTIFY_DB_PATH: dbPath, ...extraEnv },
  });
}

describe("backend v0.7 surface", function () {
  this.timeout(20000);

  it("abiForChain(7) returns V7 (NOT V5/V6) when a bondVersion:7 chain is present", () => {
    const r = runEsm(`
      import { abiForChain, CHAINS, V5_CONTRACT_ABI, V6_CONTRACT_ABI, V7_CONTRACT_ABI } from './backend/config.mjs';
      // Inject a v7 chain at runtime — does not touch the live config registration.
      CHAINS[424242] = { name:'V7Test', rpcs:['x'], rpc:'x', contract:'0x71e15D42bE15BAE117096E12C9dBA25E67d14C67', startBlock:0, explorer:'', bondVersion:7 };
      const out = {
        isV7: abiForChain(424242) === V7_CONTRACT_ABI,
        notV6: abiForChain(424242) !== V6_CONTRACT_ABI,
        notV5: abiForChain(424242) !== V5_CONTRACT_ABI,
      };
      process.stdout.write(JSON.stringify(out));
    `);
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    expect(JSON.parse(r.stdout)).to.deep.equal({ isV7: true, notV6: true, notV5: true });
  });

  it("abiForChain(6) still V6 and abiForChain(100) still V5 — no regression from the ladder restructure", () => {
    const r = runEsm(`
      import { abiForChain, V5_CONTRACT_ABI, V6_CONTRACT_ABI } from './backend/config.mjs';
      const out = {
        six: abiForChain(1) === V6_CONTRACT_ABI,        // mainnet v6 registered via env
        gnosis: abiForChain(100) === V5_CONTRACT_ABI,   // Gnosis stays v5
        unknown: abiForChain(999999) === V5_CONTRACT_ABI, // unregistered chain defaults to v5
      };
      process.stdout.write(JSON.stringify(out));
    `, {
      MAINNET_V6_CONTRACT: "0x0000000000000000000000000000000000000001",
    });
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    expect(JSON.parse(r.stdout)).to.deep.equal({ six: true, gnosis: true, unknown: true });
  });

  it("MAINNET_V7_CONTRACT env flips chain 1 to bondVersion 7 + the V7 ABI (cutover gate)", () => {
    const r = runEsm(`
      import { CHAINS, abiForChain, V7_CONTRACT_ABI } from './backend/config.mjs';
      const c = CHAINS[1] || {};
      const out = {
        contract: c.contract,
        bondVersion: c.bondVersion,
        startBlock: c.startBlock,
        v7abi: abiForChain(1) === V7_CONTRACT_ABI,
      };
      process.stdout.write(JSON.stringify(out));
    `, {
      // v6 env ALSO set: the v7 gate must take precedence, mirroring Sepolia.
      MAINNET_V6_CONTRACT: "0x0000000000000000000000000000000000000001",
      MAINNET_V7_CONTRACT: "0x0000000000000000000000000000000000000007",
      MAINNET_V7_START_BLOCK: "12345",
    });
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    expect(JSON.parse(r.stdout)).to.deep.equal({
      contract: "0x0000000000000000000000000000000000000007",
      bondVersion: 7,
      startBlock: 12345,
      v7abi: true,
    });
  });

  it("without MAINNET_V7_CONTRACT, mainnet stays the v6 entry (no accidental cutover)", () => {
    const r = runEsm(`
      import { CHAINS } from './backend/config.mjs';
      const c = CHAINS[1] || {};
      process.stdout.write(JSON.stringify({ contract: c.contract, bondVersion: c.bondVersion }));
    `, {
      MAINNET_V6_CONTRACT: "0x0000000000000000000000000000000000000001",
    });
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    expect(JSON.parse(r.stdout)).to.deep.equal({
      contract: "0x0000000000000000000000000000000000000001",
      bondVersion: 6,
    });
  });

  it("V7_CONTRACT_ABI declares Credited + Claimed and does NOT declare ChallengeRefunded", () => {
    const r = runEsm(`
      import { V7_CONTRACT_ABI } from './backend/config.mjs';
      const joined = V7_CONTRACT_ABI.join('\\n');
      const out = {
        hasCredited: joined.includes('event Credited('),
        hasClaimed: joined.includes('event Claimed('),
        noChallengeRefunded: !joined.includes('event ChallengeRefunded('),
      };
      process.stdout.write(JSON.stringify(out));
    `);
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    expect(JSON.parse(r.stdout)).to.deep.equal({ hasCredited: true, hasClaimed: true, noChallengeRefunded: true });
  });

  it("V7_CONTRACT_ABI keeps the v6 lifecycle events the watcher/indexer rely on", () => {
    const r = runEsm(`
      import { V7_CONTRACT_ABI } from './backend/config.mjs';
      const joined = V7_CONTRACT_ABI.join('\\n');
      const names = ['BondCreated','ClaimModified','Challenged','ClaimConceded','RuledForPoster','RuledForChallenger','ChallengeRejected','BondRejectedByJudge','BondClosed','BondOpened','BondWithdrawn','BondTimedOut'];
      const hasAllEvents = names.every(n => joined.includes('event ' + n + '('));
      const hasViews = ['function bonds(','function getChallengeCount(','function getChallenge('].every(v => joined.includes(v));
      process.stdout.write(JSON.stringify({ hasAllEvents, hasViews }));
    `);
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    expect(JSON.parse(r.stdout)).to.deep.equal({ hasAllEvents: true, hasViews: true });
  });

  it("the V6 ABI is untouched: abiForChain(6) decodes a v6 BondCreated identically", () => {
    // A v7 chain being present must not perturb the v6 ABI object/identity.
    const r = runEsm(`
      import { ethers } from 'ethers';
      import { abiForChain, CHAINS, V6_CONTRACT_ABI } from './backend/config.mjs';
      CHAINS[424242] = { name:'V7Test', rpcs:['x'], rpc:'x', contract:'0x71e15D42bE15BAE117096E12C9dBA25E67d14C67', startBlock:0, explorer:'', bondVersion:7 };
      const same = abiForChain(1) === V6_CONTRACT_ABI;
      const iface = new ethers.Interface(abiForChain(1));
      const frag = iface.getEvent('BondCreated');
      process.stdout.write(JSON.stringify({ same, decodes: !!frag }));
    `, { MAINNET_V6_CONTRACT: "0x0000000000000000000000000000000000000001" });
    if (r.status !== 0) throw new Error(r.stdout + r.stderr);
    expect(JSON.parse(r.stdout)).to.deep.equal({ same: true, decodes: true });
  });

  it("indexer ingests a synthetic v7 BondCreated + Credited + Claimed batch: bond row written, no crash on Credited/Claimed", () => {
    // Feed real encoded v7 logs through indexLogs against a fake contract whose
    // bonds()/getChallengeCount return a v7-shaped snapshot. Asserts:
    //   • BondCreated indexes the bond row (claim text from the event).
    //   • Credited (indexed bondId) re-snapshots the bond without crashing.
    //   • Claimed (NO bondId) is skipped cleanly (the bondId==null guard).
    const r = runEsm(`
      import { ethers } from 'ethers';
      import { indexLogs } from './backend/watcher.mjs';
      import db from './backend/db.mjs';
      import { V7_CONTRACT_ABI } from './backend/config.mjs';

      const assert = (c,m)=>{ if(!c){ console.error('FAIL', m); process.exit(2);} };
      const chainId = 11155111;
      const iface = new ethers.Interface(V7_CONTRACT_ABI);

      const token = '0x'+'33'.repeat(20);
      const poster = '0x'+'11'.repeat(20);
      const judge = '0x'+'22'.repeat(20);
      const challenger = '0x'+'44'.repeat(20);

      const mkLog = (frag, args) => {
        const enc = iface.encodeEventLog(iface.getEvent(frag), args);
        return { address:'0x0', topics: enc.topics, data: enc.data };
      };

      const logs = [
        // v7 BondCreated bondId=7
        mkLog('BondCreated', [7n, poster, judge, 0n, token, 1000n, 500n, 0n, 1n, 1n, 5n, '0x'+'ab'.repeat(32), 'v7 claim text']),
        // v7 Credited (indexed bondId=7) — must re-snapshot bond 7, no crash
        mkLog('Credited', [token, challenger, 7n, 0n, 500n]),
        // v7 Claimed (NO bondId) — must be skipped cleanly
        mkLog('Claimed', [token, challenger, 500n]),
      ];

      let bondsCalls = 0;
      const contract = {
        bonds: async () => { bondsCalls++; return { poster, judge, token, bondAmount:1000n, challengeAmount:500n,
          judgeFee:0n, acceptanceDelay:1n, rulingBuffer:1n, maxChallenges:5n, claimHash:'0x'+'ab'.repeat(32),
          claimVersion:1n, judgeProfileId:0n, pendingCount:0n, settled:false, closed:false }; },
        getChallengeCount: async () => 0n,
        getChallenge: async () => { throw new Error('unused'); },
      };

      await indexLogs(contract, chainId, logs, iface);

      const row = db.getBond(chainId, 7);
      assert(row, 'bond row written from v7 BondCreated');
      assert(row.claim_content === 'v7 claim text', 'claim text from event (got '+ (row && row.claim_content) +')');
      // BondCreated + Credited each re-snapshot via bonds(); Claimed is skipped (no extra call).
      assert(bondsCalls === 2, 'bonds() called for BondCreated + Credited only, Claimed skipped (got '+bondsCalls+')');
      console.log('OK v7 index bondsCalls='+bondsCalls); process.exit(0);
    `);
    expect(r.status, r.stdout + r.stderr).to.equal(0);
  });
});
