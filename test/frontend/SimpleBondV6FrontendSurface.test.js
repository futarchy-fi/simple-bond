const { expect } = require("chai");
const { readFileSync } = require("fs");
const { resolve } = require("path");

const V6_HTML = resolve(__dirname, "..", "..", "frontend", "v6", "index.html");
const V6_ABI = resolve(__dirname, "..", "..", "frontend", "v6", "abi.js");
const V6_SMOKE = resolve(__dirname, "..", "..", "frontend", "v6", "smoke.html");
const RUNTIME_CONFIG = resolve(__dirname, "..", "..", "frontend", "runtime-config.js");
const MAIN_HTML = resolve(__dirname, "..", "..", "frontend", "index.html");
const CONTRACT_PROBE = resolve(__dirname, "..", "..", "frontend", "contract-probe.js");
const ALLOWANCE_KEY = resolve(__dirname, "..", "..", "frontend", "allowance-key.js");

describe("SimpleBond v0.6 frontend surface", function () {
    const v6html = readFileSync(V6_HTML, "utf8");
    const v6abi = readFileSync(V6_ABI, "utf8");
    const v6smoke = readFileSync(V6_SMOKE, "utf8");
    const runtimeConfig = readFileSync(RUNTIME_CONFIG, "utf8");
    const mainHtml = readFileSync(MAIN_HTML, "utf8");
    const contractProbe = readFileSync(CONTRACT_PROBE, "utf8");
    const allowanceKeySrc = readFileSync(ALLOWANCE_KEY, "utf8");

    it("v6/abi.js exports every v0.6 entrypoint the UI calls", function () {
        // Reads
        expect(v6abi).to.include("function nextBondId() view returns (uint256)");
        expect(v6abi).to.include("function bonds(uint256)");
        expect(v6abi).to.include("claimVersion");
        expect(v6abi).to.include("judgeProfileId");
        expect(v6abi).to.include("pendingCount");
        expect(v6abi).to.include("function getChallengeCount(uint256 bondId)");
        expect(v6abi).to.include("function getChallenge(uint256 bondId, uint256 index)");
        expect(v6abi).to.include("function concessionDeadline(uint256 bondId, uint256 i)");
        expect(v6abi).to.include("function rulingWindowStart(uint256 bondId, uint256 i)");
        expect(v6abi).to.include("function rulingDeadline(uint256 bondId, uint256 i)");
        expect(v6abi).to.include("function refundCursor(uint256)");
        expect(v6abi).to.include("function judgeProfileRegistry()");

        // Writes (every v0.6 entrypoint)
        expect(v6abi).to.include("function createBond(");
        expect(v6abi).to.include("function modifyClaim(uint256 bondId, string calldata newContent)");
        expect(v6abi).to.include("function challenge(uint256 bondId, uint256 expectedVersion, string calldata content)");
        expect(v6abi).to.include("function concede(uint256 bondId, uint256 i, string calldata content)");
        expect(v6abi).to.include("function closeBond(uint256 bondId)");
        expect(v6abi).to.include("function openBond(uint256 bondId)");
        expect(v6abi).to.include("function withdrawBond(uint256 bondId)");
        expect(v6abi).to.include("function claimTimeout(uint256 bondId, uint256 i)");
        expect(v6abi).to.include("function claimRefunds(uint256 bondId, uint256 maxCount)");

        // Events
        for (const name of [
            "BondCreated",
            "ClaimModified",
            "Challenged",
            "ClaimConceded",
            "RuledForPoster",
            "RuledForChallenger",
            "ChallengeRejected",
            "BondRejectedByJudge",
            "BondClosed",
            "BondOpened",
            "BondWithdrawn",
            "BondTimedOut",
            "ChallengeRefunded",
        ]) {
            expect(v6abi, `missing event ${name}`).to.include(`event ${name}`);
        }

        // Registry ABIs
        expect(v6abi).to.include("SIMPLE_BOND_V6_REGISTRY_ABI");
        expect(v6abi).to.include("SIMPLE_BOND_V6_JUDGE_REGISTRY_ABI");
        expect(v6abi).to.include("function registerProfile(address judgeContract, string calldata content)");
        expect(v6abi).to.include("SIMPLE_BOND_V6_MANUAL_JUDGE_ABI");
        expect(v6abi).to.include("function acceptOperatorRole()");
    });

    it("v6/index.html wires the v0.6 action set into the UI", function () {
        // Loads runtime-config + v6 ABI.
        expect(v6html).to.include('src="../runtime-config.js"');
        expect(v6html).to.include('src="./abi.js"');

        // Iterates runtime-config.chains for the v0.6 selector.
        expect(v6html).to.include("cfg.chains");
        // The chain filter now uses the positive form
        // `!c.bondVersion || c.bondVersion === 6` since the dropdown is
        // hidden entirely on single-chain hosts.
        expect(v6html).to.match(/bondVersion(\s*===\s*6|\s*!==\s*6)/);

        // Wallet + network switch via MetaMask.
        expect(v6html).to.include("window.ethereum");
        expect(v6html).to.include("wallet_switchEthereumChain");
        expect(v6html).to.include("BrowserProvider");

        // All v0.6 write paths are reachable from the UI (method names appear in tx calls).
        expect(v6html).to.include(".createBond(");
        expect(v6html).to.include(".modifyClaim(");
        expect(v6html).to.match(/\.challenge\(\s*bondId/);
        expect(v6html).to.match(/\.concede\(\s*bondId/);
        expect(v6html).to.include(".closeBond(bondId");
        expect(v6html).to.include(".openBond(bondId");
        expect(v6html).to.include(".withdrawBond(bondId");
        expect(v6html).to.include(".claimRefunds(bondId");
        expect(v6html).to.include(".claimTimeout(bondId");

        // Per-challenge timing surfaced to user.
        expect(v6html).to.include("concessionDeadline");
        expect(v6html).to.include("rulingDeadline");

        // Profile registries reachable (judge registry surfaced; bond pins judgeProfileId).
        expect(v6html).to.include("registerProfile");
        expect(v6html).to.include("judgeProfileRegistry");

        // Hash+content pattern visible: status badges named after ChallengeStatus enum.
        for (const s of ["Pending", "Won", "Lost", "Conceded", "RejectedByJudge", "Refunded"]) {
            expect(v6html, `missing status name ${s}`).to.include(s);
        }
    });

    it("v6/smoke.html provides a read-only verification page", function () {
        expect(v6smoke).to.include("readNext");
        expect(v6smoke).to.include("readBond");
        expect(v6smoke).to.include("SIMPLE_BOND_V6_ABI");
    });

    it("runtime-config exposes the chains[] schema with mainnet + sepolia entries and defaults to mainnet", function () {
        expect(runtimeConfig).to.include("chains:");
        expect(runtimeConfig).to.include("defaultChainId: 1");
        expect(runtimeConfig).to.match(/1:\s*\{[\s\S]*bondVersion:\s*6/);
        // Sepolia (staging) was cut over to SimpleBondV7 (bondVersion 7);
        // mainnet (chain 1) stays on v0.6 above.
        expect(runtimeConfig).to.match(/11155111:\s*\{[\s\S]*bondVersion:\s*7/);
        // Gnosis legacy entry + gnosis* keys retired at v0.6 cutover.
        expect(runtimeConfig).to.not.include("gnosisBondContract:");
        expect(runtimeConfig).to.not.match(/100:\s*\{/);
    });

    // RCA gap #6 — getCode page-chain probe. The frontend must verify the
    // configured bondContract actually has bytecode on the active chain BEFORE
    // the first bond LIST read, classify the result, and fail CLOSED on genuine
    // absence (block writes + surface a clear message) while staying soft on a
    // flaky-RPC 'unknown'. These assertions lock the wiring so it can't silently
    // regress. We assert it in BOTH the canonical frontend/index.html and the
    // mirror frontend/v6/index.html (their existing tests keep them in sync).
    describe("contract-presence probe (getCode fail-closed) wiring", function () {
        it("frontend/contract-probe.js exports the pure helpers with the dual-export idiom", function () {
            // Dual export (window + module.exports), mirroring phase.js.
            expect(contractProbe).to.include("module.exports");
            expect(contractProbe).to.include("root.classifyContractCode");
            expect(contractProbe).to.include("root.contractPresenceMessage");
            // Both exported functions are defined.
            expect(contractProbe).to.match(/function classifyContractCode\s*\(/);
            expect(contractProbe).to.match(/function contractPresenceMessage\s*\(/);
            // The three presence states exist.
            for (const s of ["present", "absent", "unknown"]) {
                expect(contractProbe, `missing state ${s}`).to.include(`'${s}'`);
            }
        });

        // Run the same wiring assertions against each index.html so neither the
        // canonical file nor the v6 mirror can drift out of sync.
        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            describe(label, function () {
                it("loads contract-probe.js as a script", function () {
                    expect(html()).to.match(/<script src="\.{1,2}\/contract-probe\.js"><\/script>/);
                });
                it("calls getCode on the read path and uses the pure classifier + message", function () {
                    // getCode probe via the EXISTING read provider, bound INSIDE
                    // probeContractPresence so a pre-existing getCode elsewhere
                    // (linkJudge / deploy-verify / judge-code probe) can't satisfy
                    // this — deleting the new probe's getCode line fails it.
                    expect(html()).to.match(/async function probeContractPresence\(\)[\s\S]{0,700}readProvider\(\)\.getCode\(/);
                    // References the pure helpers from contract-probe.js.
                    expect(html()).to.include("classifyContractCode");
                    expect(html()).to.include("contractPresenceMessage");
                    // The probe is actually INVOKED (awaited call, distinct from its
                    // `async function` definition) on the LIST read path, and an
                    // 'absent' verdict short-circuits the reads. Deleting the call
                    // site in loadBrowseData fails both of these.
                    expect(html()).to.match(/async function loadBrowseData\(\)[\s\S]{0,1500}await probeContractPresence\(\)/);
                    expect(html()).to.match(/await probeContractPresence\(\)[\s\S]{0,200}=== 'absent'/);
                });
                it("fails CLOSED on absence: blocks writes at the wallet-chain guard and surfaces the message in browse", function () {
                    // Write choke-point blocks when the contract is confirmed absent.
                    expect(html()).to.include("isContractConfirmedAbsent");
                    expect(html()).to.match(/function requireWalletOnActiveChain\(\)[\s\S]{0,900}isContractConfirmedAbsent\(\)/);
                    // Browse render shows a prominent fail-closed banner on absence.
                    expect(html()).to.include("contractAbsent");
                });
                it("stays SOFT on 'unknown' transport: does not set a sticky absent verdict (flaky RPC must not brick a real deployment)", function () {
                    // The 'unknown' branch must assign the transient transport
                    // message (= msg, NOT = null) and then early-return BEFORE the
                    // sticky verdict cache write. Requiring `= msg;` then `return
                    // state;` excludes the later `_contractTransportMsg = null;`
                    // reset, so deleting the real assignment or the early return
                    // (which would let 'unknown' fall through to the sticky cache)
                    // fails this assertion.
                    expect(html()).to.match(/state === 'unknown'[\s\S]{0,300}_contractTransportMsg = msg;[\s\S]{0,80}return state;/);
                    // Sticky verdict cache exists and is keyed per chain+address.
                    expect(html()).to.include("_contractProbeVerdict");
                });
            });
        }
    });

    // RCA gap #5 — allowanceCache not keyed by account. The ERC-20 allowance
    // cache used to be keyed only by `${token}:${spender}` (no account, no
    // chainId). Because allowance() is read PER ACCOUNT on-chain, connecting
    // account A (approved) then switching to account B (not approved) served A's
    // allowance under the shared key, SKIPPED the Approve step, and B's
    // createBond/challenge REVERTED. The fix routes every cache key through
    // window.allowanceKey({chainId,account,token,spender}) (pure helper in
    // frontend/allowance-key.js) AND clears the cache on accountsChanged. These
    // assertions lock the wiring in BOTH the canonical frontend/index.html and
    // the mirror frontend/v6/index.html, and are written to FAIL on the old
    // account-less code so reverting any single part turns this test RED.
    describe("allowance cache account-keying (RCA gap #5) wiring", function () {
        it("frontend/allowance-key.js exports the pure helper with the dual-export idiom", function () {
            // Dual export (window + module.exports), mirroring phase.js / contract-probe.js.
            expect(allowanceKeySrc).to.include("module.exports");
            expect(allowanceKeySrc).to.include("root.allowanceKey");
            expect(allowanceKeySrc).to.match(/function allowanceKey\s*\(/);
            // Key shape includes account AND chainId (not just token:spender).
            expect(allowanceKeySrc).to.match(/\$\{chainId\}:\$\{account\}:\$\{token\}:\$\{spender\}/);
        });

        // The old account-less key was built with a bare two-segment template of
        // the form `${X.toLowerCase()}:${Y.toLowerCase()}` indexing
        // allowanceCache (token:spender / token:bondContract). This regex matches
        // exactly that legacy shape, so it MUST be absent now and MUST have been
        // present on the old code (guaranteeing a non-vacuous assertion).
        const LEGACY_KEY_RE = /allowanceCache\[`\$\{[^`]*\.toLowerCase\(\)\}:\$\{[^`]*\.toLowerCase\(\)\}`\]/;
        // The legacy ensureApproval key (inline const, not indexing the cache).
        const LEGACY_ENSURE_KEY_RE = /const key = `\$\{tokenAddr\.toLowerCase\(\)\}:\$\{spender\.toLowerCase\(\)\}`/;

        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            describe(label, function () {
                it("loads allowance-key.js as a script", function () {
                    expect(html()).to.match(/<script src="\.{1,2}\/allowance-key\.js"><\/script>/);
                });
                it("builds EVERY allowance-cache key through window.allowanceKey({...account...})", function () {
                    // All three cache sites (ensureApproval, createBond preflight,
                    // challenge preflight) call the account-keyed helper. There are
                    // at least 3 such calls; each passes chainId + account.
                    const calls = html().match(/window\.allowanceKey\(\{[^}]*\}\)/g) || [];
                    expect(calls.length, "expected >=3 window.allowanceKey({...}) call sites").to.be.at.least(3);
                    for (const call of calls) {
                        expect(call, `allowanceKey call missing account: ${call}`).to.match(/account/);
                        expect(call, `allowanceKey call missing chainId: ${call}`).to.match(/chainId/);
                    }
                    // The cache is indexed via the helper at both preflight sites
                    // and ensureApproval reads its key from the helper too.
                    expect(html()).to.match(/allowanceCache\[window\.allowanceKey\(/);
                    expect(html()).to.match(/const key = window\.allowanceKey\(/);
                });
                it("NO LONGER contains an account-less allowance-cache key (the bug)", function () {
                    // Reverting any single call site back to `${token}:${spender}`
                    // re-introduces this legacy shape and fails the test.
                    expect(LEGACY_KEY_RE.test(html()), "found legacy account-less allowanceCache[`...:...`] key").to.equal(false);
                    expect(LEGACY_ENSURE_KEY_RE.test(html()), "found legacy account-less ensureApproval key").to.equal(false);
                });
                it("clears the allowance cache in the accountsChanged handler", function () {
                    // The _accountsHandler must drop cached allowances on an account
                    // switch so a stale entry can never be served. Deleting the
                    // clear loop fails this. We require the clear to live INSIDE the
                    // accountsChanged handler body (between its definition and the
                    // chainChanged handler) so an unrelated clear elsewhere can't
                    // satisfy it.
                    expect(html()).to.match(
                        /_accountsHandler = \(accounts\) =>[\s\S]{0,700}for \(const k of Object\.keys\(allowanceCache\)\) delete allowanceCache\[k\];[\s\S]{0,300}_chainHandler =/
                    );
                });
            });
        }
    });
});
