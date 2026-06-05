// Playwright fixture: worker-scoped Hardhat node + deployed v0.7 contracts,
// page-scoped EIP-1193 proxy that signs locally and forwards to the node.
//
// This is the v0.7 sibling of wallet-with-node.js. It reuses the SAME deploy
// recipe (JudgeProfileRegistryV6 / Poster+Challenger registries / ManualJudgeV6 /
// MockSUSDS, the canonical judge profile, generous mints) but swaps the bond core
// for SimpleBondV7 and sets the page's runtime-config chain to bondVersion:7 so
// the version-aware frontend uses the credits()/claim() refund UI.
//
// Usage:
//   const { test, expect, KEYS } = require('./fixtures/wallet-with-node-v7');

const { test: base } = require("@playwright/test");
const { spawn } = require("node:child_process");
const { ethers } = require("ethers");
const path = require("node:path");
const fs = require("node:fs");

const CHAIN_ID = 31337;

// Hardhat's deterministic default accounts (mirrors wallet-with-node.js).
const KEYS = {
    deployer:    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // #0
    poster:      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // #1
    challenger1: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // #2
    challenger2: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // #3
    judgeOperator: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // #4
};

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function loadArtifact(relativePath) {
    const p = path.join(REPO_ROOT, "artifacts", relativePath);
    if (!fs.existsSync(p)) {
        throw new Error(
            `Artifact not found: ${p}. Run \`npx hardhat compile\` first.`
        );
    }
    return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function deployArtifact(deployer, artifactPath, args = []) {
    const a = loadArtifact(artifactPath);
    const factory = new ethers.ContractFactory(a.abi, a.bytecode, deployer);
    const c = await factory.deploy(...args);
    const tx = c.deploymentTransaction();
    const receipt = await tx.wait();
    return { address: receipt.contractAddress, abi: a.abi };
}

async function startHardhatNode(port) {
    const node = spawn(
        path.join(REPO_ROOT, "node_modules", ".bin", "hardhat"),
        ["node", "--port", String(port), "--hostname", "127.0.0.1"],
        {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                FORCE_COLOR: "0",
                NODE_OPTIONS: "",
                CHOKIDAR_USEPOLLING: "1",
                CHOKIDAR_INTERVAL: "5000",
            },
            stdio: ["ignore", "pipe", "pipe"],
        }
    );
    let stderrBuf = "";
    node.stderr.on("data", (b) => {
        stderrBuf += b.toString();
        process.stderr.write("[hardhat:" + port + "] " + b.toString());
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            try { node.kill("SIGKILL"); } catch (_) {}
            reject(new Error(`hardhat node didn't start in 45s. stderr:\n${stderrBuf}`));
        }, 45_000);
        node.stdout.on("data", (b) => {
            const s = b.toString();
            if (s.includes("Started HTTP")) {
                clearTimeout(timer);
                resolve();
            }
        });
        node.on("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`hardhat node exited ${code}. stderr:\n${stderrBuf}`));
        });
    });
    return node;
}

async function deployStack(rpcUrl) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const deployer = new ethers.NonceManager(new ethers.Wallet(KEYS.deployer, provider));

    const judgeProfileRegistry = await deployArtifact(
        deployer,
        "contracts/profiles/JudgeProfileRegistryV6.sol/JudgeProfileRegistryV6.json"
    );
    const posterProfileRegistry = await deployArtifact(
        deployer,
        "contracts/profiles/PosterProfileRegistry.sol/PosterProfileRegistry.json"
    );
    const challengerProfileRegistry = await deployArtifact(
        deployer,
        "contracts/profiles/ChallengerProfileRegistry.sol/ChallengerProfileRegistry.json"
    );
    // The ONLY difference from the v6 fixture: deploy SimpleBondV7 as the bond core.
    const simpleBondV7 = await deployArtifact(
        deployer,
        "contracts/core/SimpleBondV7.sol/SimpleBondV7.json",
        [judgeProfileRegistry.address]
    );

    // Canonical judge: operator is judgeOperator (key #4).
    const judgeOperatorAddr = new ethers.Wallet(KEYS.judgeOperator).address;
    const manualJudgeV6 = await deployArtifact(
        deployer,
        "contracts/judges/ManualJudgeV6.sol/ManualJudgeV6.json",
        [judgeOperatorAddr]
    );

    const operatorWallet = new ethers.NonceManager(new ethers.Wallet(KEYS.judgeOperator, provider));
    const judgeAbi = loadArtifact(
        "contracts/judges/ManualJudgeV6.sol/ManualJudgeV6.json"
    ).abi;
    const judgeAsOperator = new ethers.Contract(manualJudgeV6.address, judgeAbi, operatorWallet);
    await (await judgeAsOperator.acceptOperatorRole()).wait();

    const jpAbi = loadArtifact(
        "contracts/profiles/JudgeProfileRegistryV6.sol/JudgeProfileRegistryV6.json"
    ).abi;
    const jpAsOperator = new ethers.Contract(
        judgeProfileRegistry.address,
        jpAbi,
        operatorWallet
    );
    await (await jpAsOperator.registerProfile(
        manualJudgeV6.address,
        "canonical e2e judge"
    )).wait();

    const mockToken = await deployArtifact(
        deployer,
        "contracts/test/MockSUSDS.sol/MockSUSDS.json",
        ["Mock sUSDS", "msUSDS"]
    );
    const tokenAbi = loadArtifact(
        "contracts/test/MockSUSDS.sol/MockSUSDS.json"
    ).abi;
    const tokenAsDeployer = new ethers.Contract(mockToken.address, tokenAbi, deployer);
    const amount = ethers.parseEther("1000000");
    for (const k of Object.values(KEYS)) {
        const addr = new ethers.Wallet(k).address;
        await (await tokenAsDeployer.mint(addr, amount)).wait();
    }

    return {
        chainId: CHAIN_ID,
        rpc: rpcUrl,
        bondContract: simpleBondV7.address,
        judgeProfileRegistry: judgeProfileRegistry.address,
        posterProfileRegistry: posterProfileRegistry.address,
        challengerProfileRegistry: challengerProfileRegistry.address,
        manualJudgeV6: manualJudgeV6.address,
        approvedToken: mockToken.address,
        deployerAddress: deployer.address,
        judgeOperatorAddress: judgeOperatorAddr,
        canonicalJudgeProfileId: 0,
    };
}

const test = base.extend({
    _hardhat: [
        async ({}, use, workerInfo) => {
            const port = 8545 + workerInfo.workerIndex;
            const node = await startHardhatNode(port);
            try {
                await use({ node, port });
            } finally {
                try { node.kill("SIGTERM"); } catch (_) {}
                setTimeout(() => { try { node.kill("SIGKILL"); } catch (_) {} }, 500);
            }
        },
        { scope: "worker", auto: true },
    ],

    deployed: [
        async ({ _hardhat }, use) => {
            const rpc = `http://127.0.0.1:${_hardhat.port}`;
            const addresses = await deployStack(rpc);
            await use(addresses);
        },
        { scope: "worker" },
    ],

    page: async ({ page, deployed }, use) => {
        await page.addInitScript(
            ({ deployed, defaultKey }) => {
                Object.defineProperty(window, "SIMPLE_BOND_CONFIG", {
                    value: {
                        notifyApiBase: "/api/notify",
                        chains: {
                            [deployed.chainId]: {
                                name: "Hardhat",
                                rpc: deployed.rpc,
                                bondContract: deployed.bondContract,
                                deployBlock: 0,
                                judgeProfileRegistry: deployed.judgeProfileRegistry,
                                posterProfileRegistry: deployed.posterProfileRegistry,
                                challengerProfileRegistry: deployed.challengerProfileRegistry,
                                manualJudgeV6: deployed.manualJudgeV6,
                                officialDirectory: deployed.bondContract,
                                approvedToken: deployed.approvedToken,
                                explorer: "http://localhost",
                                // v0.7 chain — selects the credits()/claim() refund UI.
                                bondVersion: 7,
                            },
                        },
                        defaultChainId: deployed.chainId,
                        siteRole: "dev",
                    },
                    writable: true,
                    configurable: true,
                });

                window.__mockKey = (typeof localStorage !== "undefined" &&
                                    localStorage.getItem("__mockKey")) || defaultKey;
                window.__mockChainId = deployed.chainId;
                window.__mockRpc = deployed.rpc;

                const offsetKey = "__dateOffsetSec";
                const origNow = Date.now.bind(Date);
                Date.now = () => {
                    let off = 0;
                    try {
                        off = parseInt(localStorage.getItem(offsetKey) || "0", 10) || 0;
                    } catch (_) {}
                    return origNow() + off * 1000;
                };
                window.__addDateOffset = (sec) => {
                    try {
                        const cur = parseInt(localStorage.getItem(offsetKey) || "0", 10) || 0;
                        localStorage.setItem(offsetKey, String(cur + sec));
                    } catch (_) {}
                };

                const listeners = {};
                const waitForEthers = () => new Promise((resolve) => {
                    if (window.ethers) return resolve();
                    const t = setInterval(() => {
                        if (window.ethers) {
                            clearInterval(t);
                            resolve();
                        }
                    }, 25);
                });

                const provider = {
                    isMetaMask: true,
                    on(event, fn) { (listeners[event] ||= []).push(fn); },
                    removeListener(event, fn) {
                        const a = listeners[event] || [];
                        const i = a.indexOf(fn);
                        if (i >= 0) a.splice(i, 1);
                    },
                    async request({ method, params }) {
                        await waitForEthers();
                        const wallet = new window.ethers.Wallet(window.__mockKey);
                        const addr = wallet.address;
                        switch (method) {
                            case "eth_chainId":
                                return "0x" + window.__mockChainId.toString(16);
                            case "eth_accounts":
                            case "eth_requestAccounts":
                                return [addr];
                            case "wallet_switchEthereumChain":
                                return null;
                            case "personal_sign": {
                                const data = (params || [])[0];
                                return wallet.signMessage(window.ethers.getBytes(data));
                            }
                            case "eth_signTypedData_v4": {
                                const [, typed] = params;
                                const t = JSON.parse(typed);
                                return wallet.signTypedData(t.domain, t.types, t.message);
                            }
                            case "eth_sendTransaction": {
                                const [tx] = params;
                                const rpc = new window.ethers.JsonRpcProvider(window.__mockRpc);
                                const connected = wallet.connect(rpc);
                                const clone = { ...tx };
                                delete clone.from;
                                if (typeof clone.value === "string" && clone.value.startsWith("0x")) {
                                    clone.value = BigInt(clone.value);
                                }
                                if (typeof clone.gas === "string") {
                                    clone.gasLimit = BigInt(clone.gas);
                                    delete clone.gas;
                                }
                                const sent = await connected.sendTransaction(clone);
                                return sent.hash;
                            }
                            default: {
                                const rpc = new window.ethers.JsonRpcProvider(window.__mockRpc);
                                return rpc.send(method, params || []);
                            }
                        }
                    },
                };

                window.__setMockAccount = (privKey) => {
                    window.__mockKey = privKey;
                    try { localStorage.setItem("__mockKey", privKey); } catch (_) {}
                    const wallet = new window.ethers.Wallet(privKey);
                    for (const fn of (listeners.accountsChanged || [])) {
                        fn([wallet.address]);
                    }
                };
                window.__fireChainChanged = (chainIdNum) => {
                    window.__mockChainId = chainIdNum;
                    const hex = "0x" + chainIdNum.toString(16);
                    for (const fn of (listeners.chainChanged || [])) {
                        fn(hex);
                    }
                };

                Object.defineProperty(window, "ethereum", {
                    value: provider,
                    writable: true,
                    configurable: true,
                });
            },
            { deployed, defaultKey: KEYS.poster }
        );

        const faultRef = { rule: null };
        await page.route(deployed.rpc, async (route) => {
            const rule = faultRef.rule;
            if (rule) {
                const body = route.request().postData() || "";
                if (!rule.bodyIncludes || body.includes(rule.bodyIncludes)) {
                    return route.fulfill({
                        status: rule.status || 500,
                        contentType: "application/json",
                        body: JSON.stringify({ error: "injected RPC fault" }),
                    });
                }
            }
            return route.continue();
        });
        page.injectRpcFault = (rule) => { faultRef.rule = rule; };
        page.clearRpcFault = () => { faultRef.rule = null; };

        await use(page);
    },

    switchAccount: async ({ page }, use) => {
        await use(async (privKey) => {
            await page.evaluate((k) => window.__setMockAccount(k), privKey);
        });
    },
});

module.exports = { test, expect: base.expect, KEYS, CHAIN_ID };
