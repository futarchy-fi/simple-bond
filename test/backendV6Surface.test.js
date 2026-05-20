const { expect } = require("chai");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

function runNodeWithEnv(scriptSrc, env = {}) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", scriptSrc], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, ...env },
        encoding: "utf8",
    });
    return result;
}

describe("backend v0.6 surface", function () {
    this.timeout(15000);

    it("exposes abiForChain(1)=V6, abiForChain(11155111)=V6, abiForChain(100)=V5 when v0.6 chains are registered", async () => {
        const r = runNodeWithEnv(`
            import { abiForChain, V5_CONTRACT_ABI, V6_CONTRACT_ABI } from './backend/config.mjs';
            const a1 = abiForChain(1) === V6_CONTRACT_ABI;
            const a2 = abiForChain(11155111) === V6_CONTRACT_ABI;
            const a3 = abiForChain(100) === V5_CONTRACT_ABI;
            process.stdout.write(JSON.stringify({a1, a2, a3}));
        `, {
            MAINNET_V6_CONTRACT: "0x0000000000000000000000000000000000000001",
            SEPOLIA_V6_CONTRACT: "0x0000000000000000000000000000000000000002",
        });
        if (r.status !== 0) throw new Error(r.stderr);
        expect(JSON.parse(r.stdout)).to.deep.equal({ a1: true, a2: true, a3: true });
    });

    it("abiForChain falls back to V5 when no v0.6 chain entry is registered", async () => {
        const r = runNodeWithEnv(`
            import { abiForChain, V5_CONTRACT_ABI } from './backend/config.mjs';
            const fallback = abiForChain(1) === V5_CONTRACT_ABI;
            process.stdout.write(JSON.stringify(fallback));
        `, { MAINNET_V6_CONTRACT: "", SEPOLIA_V6_CONTRACT: "" });
        if (r.status !== 0) throw new Error(r.stderr);
        expect(JSON.parse(r.stdout)).to.equal(true);
    });

    it("does not register CHAINS[1] when MAINNET_V6_CONTRACT is unset", async () => {
        const r = runNodeWithEnv(`
            import { CHAINS } from './backend/config.mjs';
            process.stdout.write(JSON.stringify({ has1: !!CHAINS[1], has11155111: !!CHAINS[11155111] }));
        `, {
            // Explicitly clear so a developer's local env doesn't pollute the test.
            MAINNET_V6_CONTRACT: "",
            SEPOLIA_V6_CONTRACT: "",
        });
        if (r.status !== 0) throw new Error(r.stderr);
        expect(JSON.parse(r.stdout)).to.deep.equal({ has1: false, has11155111: false });
    });

    it("registers CHAINS[1] with deploy block when MAINNET_V6_CONTRACT/START_BLOCK are set", async () => {
        const r = runNodeWithEnv(`
            import { CHAINS } from './backend/config.mjs';
            process.stdout.write(JSON.stringify(CHAINS[1] || null));
        `, {
            MAINNET_V6_CONTRACT: "0x0000000000000000000000000000000000000001",
            MAINNET_V6_START_BLOCK: "12345678",
        });
        if (r.status !== 0) throw new Error(r.stderr);
        const c = JSON.parse(r.stdout);
        expect(c).to.not.equal(null);
        expect(c.contract).to.equal("0x0000000000000000000000000000000000000001");
        expect(c.startBlock).to.equal(12345678);
        expect(c.bondVersion).to.equal(6);
    });

    it("registers CHAINS[11155111] with deploy block when SEPOLIA_V6_CONTRACT/START_BLOCK are set", async () => {
        const r = runNodeWithEnv(`
            import { CHAINS } from './backend/config.mjs';
            process.stdout.write(JSON.stringify(CHAINS[11155111] || null));
        `, {
            SEPOLIA_V6_CONTRACT: "0x0000000000000000000000000000000000000002",
            SEPOLIA_V6_START_BLOCK: "5000000",
        });
        if (r.status !== 0) throw new Error(r.stderr);
        const c = JSON.parse(r.stdout);
        expect(c).to.not.equal(null);
        expect(c.contract).to.equal("0x0000000000000000000000000000000000000002");
        expect(c.startBlock).to.equal(5000000);
        expect(c.bondVersion).to.equal(6);
    });

    it("V6_CONTRACT_ABI declares all v0.6 events (BondCreated/ClaimModified/ChallengeRejected/BondClosed/BondOpened)", async () => {
        const r = runNodeWithEnv(`
            import { V6_CONTRACT_ABI } from './backend/config.mjs';
            const joined = V6_CONTRACT_ABI.join('\\n');
            const names = ['BondCreated','ClaimModified','Challenged','ClaimConceded','RuledForPoster','RuledForChallenger','ChallengeRejected','BondRejectedByJudge','BondClosed','BondOpened','BondWithdrawn','BondTimedOut','ChallengeRefunded'];
            process.stdout.write(JSON.stringify(names.every(n => joined.includes('event ' + n))));
        `);
        if (r.status !== 0) throw new Error(r.stderr);
        expect(JSON.parse(r.stdout)).to.equal(true);
    });
});
