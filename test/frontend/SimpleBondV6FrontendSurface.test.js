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
const ASYNC_UTIL = resolve(__dirname, "..", "..", "frontend", "async-util.js");
const CHALLENGE_CAPACITY = resolve(__dirname, "..", "..", "frontend", "challenge-capacity.js");
const CREDITS_BANNER = resolve(__dirname, "..", "..", "frontend", "credits-banner.js");

describe("SimpleBond v0.6 frontend surface", function () {
    const v6html = readFileSync(V6_HTML, "utf8");
    const v6abi = readFileSync(V6_ABI, "utf8");
    const v6smoke = readFileSync(V6_SMOKE, "utf8");
    const runtimeConfig = readFileSync(RUNTIME_CONFIG, "utf8");
    const mainHtml = readFileSync(MAIN_HTML, "utf8");
    const contractProbe = readFileSync(CONTRACT_PROBE, "utf8");
    const allowanceKeySrc = readFileSync(ALLOWANCE_KEY, "utf8");
    const asyncUtilSrc = readFileSync(ASYNC_UTIL, "utf8");
    const challengeCapacitySrc = readFileSync(CHALLENGE_CAPACITY, "utf8");
    const creditsBannerSrc = readFileSync(CREDITS_BANNER, "utf8");

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

        // Per-challenge + bond status labels are produced by the pure helper
        // frontend/bond-status.js (challengeStatusLabel / bondStatus), wired into
        // BOTH mirrors. The helper renders unambiguous labels — "Won"/"Lost" become
        // "Challenger won"/"Challenger lost", "RejectedByJudge" becomes a human
        // "Dismissed (out of scope)", and a settled bond fans out into
        // Cancelled / Withdrawn / Settled (timed out) / Challenge upheld — so the
        // raw enum identifiers no longer leak to users.
        for (const [label, html] of [["frontend/index.html", mainHtml], ["frontend/v6/index.html", v6html]]) {
            expect(html, `${label} must load bond-status.js`).to.match(/bond-status\.js/);
            expect(html, `${label} must use challengeStatusLabel`).to.include("challengeStatusLabel(");
            expect(html, `${label} must use bondStatus`).to.include("bondStatus(");
            expect(html, `${label} must NOT hardcode the old STATUS_NAMES enum array`).to.not.include('["Pending", "Won", "Lost"');
        }
        const bondStatusSrc = readFileSync(resolve(__dirname, "..", "..", "frontend", "bond-status.js"), "utf8");
        for (const friendly of ["Challenger won", "Challenger lost", "Dismissed (out of scope)", "Cancelled", "Withdrawn", "Challenge upheld"]) {
            expect(bondStatusSrc, `bond-status.js must define label "${friendly}"`).to.include(friendly);
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
                    // (handler became async when the stale-signer rebuild was added,
                    // which sits between the definition and the clear loop — hence 2000)
                    expect(html()).to.match(
                        /_accountsHandler = async \(accounts\) =>[\s\S]{0,2000}for \(const k of Object\.keys\(allowanceCache\)\) delete allowanceCache\[k\];[\s\S]{0,300}_chainHandler =/
                    );
                });
            });
        }
    });

    // RCA gap #3 — a timeout/error masquerades as "empty". withTimeout(promise,
    // ms, fallback) silently resolves to the fallback on timeout, so a timed-out
    // LIST read returned 0n / [] and the UI rendered a misleading "no bonds"
    // empty state instead of a VISIBLE, retryable error. The fix is a pure
    // helper (frontend/async-util.js) exporting withTimeoutResult(promise, ms)
    // that returns a TAGGED {status:'ok'|'error'|'timeout'} object, wired into
    // the THREE list-DETERMINING reads (BROWSE nextBondId, MY BONDS event
    // fallbacks, BONDS JUDGED event fallback) so a non-ok status routes to an
    // error state, NOT the empty state. These assertions lock the wiring in BOTH
    // the canonical frontend/index.html and the mirror frontend/v6/index.html,
    // and are written so reverting any single change turns this test RED.
    describe("timeout-vs-empty distinction (RCA gap #3) wiring", function () {
        it("frontend/async-util.js exports the pure helper with the dual-export idiom", function () {
            // Dual export (window + module.exports), mirroring phase.js /
            // contract-probe.js / allowance-key.js.
            expect(asyncUtilSrc).to.include("module.exports");
            expect(asyncUtilSrc).to.include("root.withTimeoutResult");
            expect(asyncUtilSrc).to.match(/function withTimeoutResult\s*\(/);
            // All three tagged statuses exist in the helper.
            for (const s of ["ok", "error", "timeout"]) {
                expect(asyncUtilSrc, `missing status ${s}`).to.include(`'${s}'`);
            }
        });

        // The old browse path used `withTimeout(bc.nextBondId(), 10000, 0n)`,
        // collapsing a timeout into a bare 0n fallback. This regex matches
        // exactly that legacy shape, so it MUST be absent now and was present on
        // the old code (guaranteeing the next assertions are non-vacuous).
        const LEGACY_NEXTID_RE = /withTimeout\(\s*bc\.nextBondId\(\),\s*10000,\s*0n\s*\)/;
        // The old fallback shape for the My-Bonds / Bonds-judged event scans.
        const LEGACY_FALLBACK_RE = /withTimeout\(\s*queryFilterChunked\([^)]*\)[^,]*,\s*25000,\s*\[\]\s*\)/;

        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            describe(label, function () {
                it("loads async-util.js as a script", function () {
                    expect(html()).to.match(/<script src="\.{1,2}\/async-util\.js"><\/script>/);
                });

                it("BROWSE: routes a non-ok nextBondId into a { rows: [], error } cache entry (NOT a bare 0n fallback)", function () {
                    // The browse path must call withTimeoutResult for nextBondId.
                    // Reverting to withTimeout(..., 10000, 0n) fails the next line.
                    expect(html()).to.match(/withTimeoutResult\(\s*bc\.nextBondId\(\),\s*10000\s*\)/);
                    // The legacy bare-0n fallback shape must be GONE.
                    expect(LEGACY_NEXTID_RE.test(html()), "found legacy withTimeout(nextBondId, 10000, 0n)").to.equal(false);
                    // A non-ok status writes an ERROR cache entry and returns —
                    // it does NOT fall through to enumeration (which would render
                    // the empty state). Require the status check, the rows:[]+error
                    // cache write, and the timeout copy in close proximity.
                    expect(html()).to.match(
                        /const r = await withTimeoutResult\(\s*bc\.nextBondId\(\),\s*10000\s*\);[\s\S]{0,120}r\.status !== 'ok'[\s\S]{0,400}bondListCache\[bondListKey\(\)\] = \{ rows: \[\], error \}/
                    );
                    expect(html()).to.include("The network timed out while loading bonds — please retry.");
                    // A genuine ok-0 still proceeds to enumeration (normal empty
                    // state): the value is taken from r.value only on ok.
                    expect(html()).to.match(/const nextId = Number\(r\.value\)/);
                });

                it("MY BONDS: the three event fallbacks use withTimeoutResult and feed renderMySection a per-role error", function () {
                    // No legacy `withTimeout(queryFilterChunked(...), 25000, [])`
                    // fallback survives (covers My-Bonds + Bonds-judged).
                    expect(LEGACY_FALLBACK_RE.test(html()), "found legacy withTimeout(queryFilterChunked, 25000, [])").to.equal(false);
                    // All three roles thread a per-role error into renderMySection.
                    // Per-role error threaded in; trailing args (idxBonds, sharedRate
                    // for the indexer-payload fast path) may follow the error param.
                    expect(html()).to.match(/renderMySection\('myPoster', 'myPosterCount', posterIds, 'poster', posterErr[^)]*\)/);
                    expect(html()).to.match(/renderMySection\('myChallenger', 'myChallengerCount', challengerIds, 'challenger', challengerErr[^)]*\)/);
                    expect(html()).to.match(/renderMySection\('myJudge', 'myJudgeCount', judgeIds, 'judge', judgeErr[^)]*\)/);
                    // Each fallback branch only fills ids on ok, else records the
                    // per-role error (so a timeout can't leave ids silently empty).
                    expect(html()).to.match(/const r = await withTimeoutResult\(queryFilterChunked\(bc, filter, fromBlock\), 25000\);[\s\S]{0,160}posterErr = fallbackErr\(r\)/);
                    expect(html()).to.match(/challengerErr = fallbackErr\(r\)/);
                    expect(html()).to.match(/judgeErr = fallbackErr\(r\)/);
                });

                it("MY BONDS: renderMySection has an error branch DISTINCT from the empty-state hint", function () {
                    // renderMySection takes the loadError param and, when set,
                    // renders a retryable msg-error INSTEAD of the empty hint.
                    // Core params pinned; trailing optional params (idxBonds, sharedRate
                    // for the indexer-payload fast path) may follow loadError.
                    expect(html()).to.match(/async function renderMySection\(containerId, countId, ids, role, loadError[^)]*\)/);
                    // The error branch is checked BEFORE the ids.length === 0 empty
                    // branch and renders the retryable copy via msg-error. Deleting
                    // the branch (falling back to the empty hint) fails this.
                    expect(html()).to.match(
                        /if \(loadError\) \{[\s\S]{0,300}Couldn’t load your \$\{role\} bonds — please retry\.[\s\S]{0,200}msg msg-error[\s\S]{0,120}return;\s*\}[\s\S]{0,120}if \(ids\.length === 0\)/
                    );
                });

                it("BONDS JUDGED: the fallback uses withTimeoutResult and surfaces a retryable error instead of the empty state", function () {
                    // The judged fallback now branches on status and records
                    // judgedErr on a non-ok outcome.
                    expect(html()).to.match(/const r = await withTimeoutResult\(queryFilterChunked\(bc, bc\.filters\.BondCreated\(null, null, entry\.judgeContract\), fromBlock\), 25000\)/);
                    expect(html()).to.include("The network timed out while loading bonds judged — please retry.");
                    // The render shows the error (msg-error) when judgedErr is set,
                    // ahead of the "No bonds yet point to this judge contract."
                    // empty hint — so a failure can't masquerade as "no bonds".
                    expect(html()).to.match(
                        /\$\{judgedErr[\s\S]{0,120}msg msg-error[\s\S]{0,200}No bonds yet point to this judge contract\./
                    );
                });
            });
        }
    });

    // A2-followup — all-zero timing must not be misclassified as
    // timeout-claimable. phase.js gained PHASE.TIMING_UNAVAILABLE for a PENDING
    // challenge whose timing reads failed to load (all-zero). The per-challenge
    // render must (a) reference that phase string so the timing-unavailable state
    // is handled (no timeline step highlighted), and (b) gate the claimTimeout
    // button behind a POSITIVE rulingDeadline so it can never render when
    // rulingDeadline == 0 (which `now > rulingEnd` alone would wrongly allow).
    // Locked in BOTH the canonical frontend/index.html and the v6 mirror; written
    // so reverting either change turns the test RED.
    describe("timing-unavailable phase + positive-rulingDeadline claimTimeout gate (A2-followup) wiring", function () {
        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            describe(label, function () {
                it("the per-challenge render references PHASE.TIMING_UNAVAILABLE", function () {
                    // The render branches on the timing-unavailable phase (so it can
                    // suppress timeline highlighting). Deleting that handling fails this.
                    expect(html()).to.include("PHASE.TIMING_UNAVAILABLE");
                    // It is used in a phase comparison off the phaseFor() result.
                    expect(html()).to.match(/ph\.phase === PHASE\.TIMING_UNAVAILABLE/);
                });

                it("does NOT highlight a timeline step when timing is unavailable", function () {
                    // The `active` flag for each timeline step must exclude the
                    // timing-unavailable case (same as resolved). Removing the
                    // `!timingUnavailable` guard fails this.
                    expect(html()).to.match(/const timingUnavailable = ph\.phase === PHASE\.TIMING_UNAVAILABLE/);
                    expect(html()).to.match(/const active = !resolved && !timingUnavailable && ph\.activeWindow === st\.key/);
                });

                it("claimTimeout button gating requires a POSITIVE rulingDeadline (rulingEnd > 0)", function () {
                    // The claimTimeout button must be gated on rulingEnd > 0 AND
                    // now > rulingEnd. Removing the positive-rulingDeadline
                    // precondition (so it keys off `now > rulingEnd` alone) fails
                    // this assertion: we require both conjuncts in the guard that
                    // immediately precedes the claimTimeout button push.
                    expect(html()).to.match(
                        /if \(rulingEnd > 0 && now > rulingEnd\) \{[\s\S]{0,160}data-act="claimTimeout"/
                    );
                    // And the legacy precondition-free form (now > rulingEnd as the
                    // SOLE gate) must be absent so a revert is caught.
                    expect(html()).to.not.match(/if \(now > rulingEnd\) \{[\s\S]{0,160}data-act="claimTimeout"/);
                });
            });
        }
    });

    // backlog #1 — challenge-capacity gate is wrong on the LIVE mainnet v6 chain.
    // The two contracts cap challenge() DIFFERENTLY:
    //   - SimpleBondV6.sol (LIVE on mainnet): challenges[bondId].length <
    //     b.maxChallenges — caps on TOTAL-EVER filed.
    //   - SimpleBondV7.sol (Sepolia): b.pendingCount < b.maxChallenges — caps on
    //     the LIVE pending set.
    // The frontend used to gate BOTH on pendingCount (`Number(b.pendingCount) <
    // Number(b.maxChallenges) && Number(b.pendingCount) <= 100`), so on a v6 bond
    // where maxChallenges had already been filed-and-resolved (pendingCount back
    // to 0, challenges[].length == maxChallenges) the UI STILL showed the full
    // Challenge card and the user wasted real gas on a reverting challenge() tx.
    // The fix routes the capacity check through window.hasChallengeCapacity({...})
    // (pure helper in frontend/challenge-capacity.js): version-aware so v6 uses
    // challengeCount (total-ever) and v7 uses pendingCount, and the dead `<= 100`
    // conjunct is dropped. It also makes the create-form maxChallenges label
    // version-aware. These assertions lock the wiring in BOTH the canonical
    // frontend/index.html and the mirror frontend/v6/index.html, and are written
    // so reverting any single change turns this test RED.
    describe("challenge-capacity gate (backlog #1) wiring", function () {
        it("frontend/challenge-capacity.js exports the pure helper with the dual-export idiom", function () {
            // Dual export (window + module.exports), mirroring phase.js /
            // async-util.js / allowance-key.js.
            expect(challengeCapacitySrc).to.include("module.exports");
            expect(challengeCapacitySrc).to.include("root.hasChallengeCapacity");
            expect(challengeCapacitySrc).to.match(/function hasChallengeCapacity\s*\(/);
            // The version split is present: v7 keys off pendingCount, v6 off
            // challengeCount, both against maxChallenges.
            expect(challengeCapacitySrc).to.match(/bondVersion\)\s*===\s*7/);
            expect(challengeCapacitySrc).to.match(/pendingCount\)\s*<\s*max/);
            expect(challengeCapacitySrc).to.match(/challengeCount\)\s*<\s*max/);
        });

        // The OLD account-/version-less capacity gate was
        // `Number(b.pendingCount) < Number(b.maxChallenges) && Number(b.pendingCount) <= 100`.
        // This regex matches exactly that legacy shape, so it MUST be absent now
        // and MUST have been present on the old code (guaranteeing non-vacuous
        // assertions). The `<= 100` dead conjunct is matched separately too.
        const LEGACY_GATE_RE = /Number\(b\.pendingCount\)\s*<\s*Number\(b\.maxChallenges\)\s*&&\s*Number\(b\.pendingCount\)\s*<=\s*100/;
        const DEAD_CEILING_RE = /Number\(b\.pendingCount\)\s*<=\s*100/;

        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            describe(label, function () {
                it("loads challenge-capacity.js as a script", function () {
                    expect(html()).to.match(/<script src="\.{1,2}\/challenge-capacity\.js"><\/script>/);
                });

                it("computes canChallenge via window.hasChallengeCapacity({...}) with version + both counts", function () {
                    // The capacity check routes through the pure helper, fed the
                    // active chain's bondVersion AND both pendingCount (v7) and
                    // challengeCount (v6) so the gate is version-correct.
                    // (`!claimMismatch` was inserted by the H3 claim-hash gate; the
                    // capacity check is hoisted to `_hasCapacity` — reused by the H1
                    // capacity-exhausted notice — and canChallenge references it.)
                    expect(html()).to.match(
                        /const _hasCapacity = window\.hasChallengeCapacity\(\{[^}]*\}\)/
                    );
                    expect(html()).to.match(
                        /const canChallenge = isNonPoster && bondOpen && !claimMismatch && _hasCapacity/
                    );
                    // The single call site passes bondVersion, pendingCount,
                    // challengeCount and maxChallenges.
                    const call = (html().match(/window\.hasChallengeCapacity\(\{[^}]*\}\)/) || [])[0] || "";
                    expect(call, `call missing bondVersion: ${call}`).to.match(/bondVersion/);
                    expect(call, `call missing pendingCount: ${call}`).to.match(/pendingCount/);
                    expect(call, `call missing challengeCount: ${call}`).to.match(/challengeCount/);
                    expect(call, `call missing maxChallenges: ${call}`).to.match(/maxChallenges/);
                });

                it("NO LONGER contains the account-less pendingCount-only capacity gate or the `<= 100` conjunct (the bug)", function () {
                    // Reverting canChallenge to the old
                    // `Number(b.pendingCount) < Number(b.maxChallenges) && Number(b.pendingCount) <= 100`
                    // re-introduces this legacy shape and fails the test.
                    expect(LEGACY_GATE_RE.test(html()), "found legacy pendingCount-only capacity gate").to.equal(false);
                    // The dead `<= 100` ceiling must be gone entirely.
                    expect(DEAD_CEILING_RE.test(html()), "found dead `Number(b.pendingCount) <= 100` conjunct").to.equal(false);
                });

                it("renders the create-form maxChallenges label version-conditionally (distinct v7 vs v6 strings)", function () {
                    // The label is conditional on the active chain bondVersion: a v7
                    // string ('Max challenges pending at once') distinct from the v6
                    // string ('Max challenges (total ever filed)'). Reverting to the
                    // static v6-only label fails this.
                    expect(html()).to.match(
                        /<label for="cb-max">\$\{chain\(\) && chain\(\)\.bondVersion === 7 \? 'Max challenges pending at once' : 'Max challenges \(total ever filed\)'\}<\/label>/
                    );
                    // Both distinct strings are present and are NOT equal.
                    expect(html()).to.include("Max challenges pending at once");
                    expect(html()).to.include("Max challenges (total ever filed)");
                });
            });
        }
    });

    // backlog #2 — v0.7 pull-payment is undiscoverable. On SimpleBondV7 (Sepolia)
    // the C2 change replaced PUSHED refunds with a PULL ledger: every refund/payout
    // is credited to credits[recipient][token] and drained by claim(token). Because
    // nothing is pushed any more, a user owed credit otherwise only discovers it on
    // the exact per-bond detail page while connected (and the email prompt is
    // stubbed). The fix adds a GLOBAL claimable-credits banner to the My Bonds page
    // for v0.7 chains: loadMyBonds, AFTER the existing Promise.all, gates on
    // bondVersion === 7 + account, reads credits(account, chain().approvedToken),
    // and fills a #myCreditsBanner via the pure myCreditsBannerHtml helper, wired to
    // a My-Bonds-scoped doClaimCreditMyBonds(token) handler (claim(token) +
    // renderMyBonds re-render). On v0.6 NONE of this runs (no extra RPC, no banner)
    // — behaviour byte-identical. These assertions lock the wiring in BOTH the
    // canonical frontend/index.html and the mirror frontend/v6/index.html, and are
    // written so reverting any single change turns the test RED.
    describe("My-Bonds global claimable-credits banner (backlog #2) wiring", function () {
        it("frontend/credits-banner.js exports the pure helper with the dual-export idiom", function () {
            // Dual export (window + module.exports), mirroring phase.js /
            // async-util.js / allowance-key.js / challenge-capacity.js.
            expect(creditsBannerSrc).to.include("module.exports");
            expect(creditsBannerSrc).to.include("root.myCreditsBannerHtml");
            expect(creditsBannerSrc).to.match(/function myCreditsBannerHtml\s*\(/);
            // It returns "" when there is nothing claimable (credit <= 0).
            expect(creditsBannerSrc).to.match(/creditWei[\s\S]{0,200}<=\s*0n[\s\S]{0,40}return ''/);
            // The positive branch carries the success styling + the claim button id.
            expect(creditsBannerSrc).to.include("msg-success");
            expect(creditsBannerSrc).to.include("myCreditsClaimBtn");
        });

        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            describe(label, function () {
                it("loads credits-banner.js as a script", function () {
                    expect(html()).to.match(/<script src="\.{1,2}\/credits-banner\.js"><\/script>/);
                });

                it("renderMyBonds adds an (initially empty) #myCreditsBanner ABOVE the three my-section blocks", function () {
                    // The banner container is rendered in renderMyBonds, before the
                    // poster section. Deleting the container fails this. Requiring it
                    // ahead of the first my-section div proves the ordering.
                    expect(html()).to.match(
                        /<div id="myCreditsBanner"><\/div>[\s\S]{0,120}<div class="my-section">/
                    );
                });

                it("loadMyBonds reads credits(account, chain().approvedToken) GUARDED behind bondVersion === 7, AFTER the Promise.all", function () {
                    // The v7 gate. Reverting it (so the read runs on v6 too) or
                    // deleting it fails this. The gate + account guard appear AFTER
                    // the renderMySection('myJudge', ...) Promise.all member that
                    // renders the third role section, and BEFORE the credits read.
                    expect(html()).to.match(
                        /renderMySection\('myJudge', 'myJudgeCount'[\s\S]{0,1200}const isV7 = chain\(\)\?\.bondVersion === 7;[\s\S]{0,80}if \(isV7 && account\)/
                    );
                    // Reads the connected account's credit for the chain canonical token.
                    expect(html()).to.match(
                        /const token = chain\(\)\.approvedToken;[\s\S]{0,400}bondReadContract\(\)\.credits\(account, token\)/
                    );
                });

                it("wraps the credits read in try/catch so an RPC hiccup never blanks My Bonds", function () {
                    // The read is wrapped so a failure leaves credit at 0n (no banner),
                    // never a crash. Removing the try/catch fails this.
                    expect(html()).to.match(
                        /try \{ credit = await bondReadContract\(\)\.credits\(account, token\); \}\s*catch \(_\) \{ credit = 0n; \}/
                    );
                });

                it("fills #myCreditsBanner via the pure myCreditsBannerHtml helper and wires the My-Bonds-scoped claim button", function () {
                    // The banner markup decision routes through the pure helper.
                    expect(html()).to.match(/window\.myCreditsBannerHtml\(\{[\s\S]{0,200}creditWei: credit/);
                    // The button binds to the My-Bonds-scoped handler (NOT doClaimCredit).
                    expect(html()).to.match(
                        /\$\('myCreditsClaimBtn'\)\?\.addEventListener\('click', \(\) => doClaimCreditMyBonds\(token\)\)/
                    );
                    // A zero credit clears the banner (no stale banner left behind).
                    expect(html()).to.match(/if \(credit > 0n\)[\s\S]{0,600}\} else \{[\s\S]{0,80}banner\.innerHTML = ''/);
                });

                it("defines a My-Bonds-scoped claim handler that calls claim(token) and re-renders renderMyBonds() (NOT the bond-detail doClaimCredit)", function () {
                    // The handler is distinct from the bond-detail doClaimCredit: it
                    // writes to the My-Bonds message slot and re-renders the My Bonds
                    // page (clearing the banner) on success.
                    expect(html()).to.match(/async function doClaimCreditMyBonds\(token\)/);
                    // It calls claim(token) through the sanctioned write factory.
                    expect(html()).to.match(
                        /async function doClaimCreditMyBonds\(token\)[\s\S]{0,600}bondWriteContract\(\)\.claim\(token\)/
                    );
                    // On success it re-renders the My Bonds page (so the banner clears),
                    // NOT a specific bond detail.
                    expect(html()).to.match(
                        /async function doClaimCreditMyBonds\(token\)[\s\S]{0,900}renderMyBonds\(\)/
                    );
                    expect(html()).to.match(
                        /async function doClaimCreditMyBonds\(token\)[\s\S]{0,900}\$\('myCreditsMsg'\)|const msg = \$\('myCreditsMsg'\)/
                    );
                });
            });
        }

        // The v6 (mainnet) PATH must be unaffected: there is no credits()/claim()
        // read OUTSIDE the v7-guarded blocks. We don't ban the strings outright
        // (they legitimately appear in the v7-guarded My-Bonds block and the
        // v7-guarded bond-detail block), but the My-Bonds credits read MUST be
        // gated behind bondVersion === 7 — proven by the gate assertion above. Here
        // we additionally assert the My-Bonds credits read never appears without its
        // v7 guard, i.e. there is no UNguarded credits(account, token) on the
        // My-Bonds path.
        it("v6 path is unaffected: the My-Bonds credits read only exists under the bondVersion === 7 guard", function () {
            // The ONLY My-Bonds-context credits read is the guarded one. The bond
            // detail read uses credits(account, b.token); the My-Bonds read uses
            // credits(account, token). The My-Bonds read must be preceded (within
            // the same loadMyBonds body) by the isV7 gate.
            for (const html of [mainHtml, v6html]) {
                const myBondsReadCount = (html.match(/bondReadContract\(\)\.credits\(account, token\)/g) || []).length;
                expect(myBondsReadCount, "expected exactly one My-Bonds credits(account, token) read").to.equal(1);
                // And it lives after an isV7 gate.
                expect(html).to.match(/const isV7 = chain\(\)\?\.bondVersion === 7;[\s\S]{0,400}bondReadContract\(\)\.credits\(account, token\)/);
            }
        });
    });

    // backlog #8 — dispute actions used a jarring native alert() on failure and
    // gave no in-context success. EVERY dispute handler now surfaces start /
    // success / failure through the inline message slot CONTEXTUALLY ADJACENT to
    // its button on the bond-detail card — poster-card actions (concede,
    // closeBond, openBond, withdrawBond, claimTimeout) route to #posterMsg; judge
    // -card actions (rule, rejectChallenge, rejectBond) route to #judgeMsg — using
    // the same `msg.innerHTML = msg-info|msg-success|msg-error` pattern the working
    // write paths use (doChallenge / doClaimCredit). The on-chain calls are
    // unchanged. These assertions lock the wiring in BOTH the canonical
    // frontend/index.html and the mirror frontend/v6/index.html, and are written so
    // reverting ANY single handler back to alert() turns the test RED.
    describe("dispute-action inline messaging (no native alert) (backlog #8) wiring", function () {
        // Map each dispute handler -> the inline slot it MUST write to (the slot
        // adjacent to where its button renders on the bond-detail card).
        const POSTER = "posterMsg";
        const JUDGE = "judgeMsg";
        const HANDLERS = [
            { fn: "doConcede", slot: POSTER },
            { fn: "doCloseBond", slot: POSTER },
            { fn: "doOpenBond", slot: POSTER },
            { fn: "doWithdrawBond", slot: POSTER },
            { fn: "doClaimTimeout", slot: POSTER },
            { fn: "doRule", slot: JUDGE },
            { fn: "doRejectChallenge", slot: JUDGE },
            { fn: "doRejectBond", slot: JUDGE },
        ];

        // Extract one handler's body: from `async function <fn>(` up to (but not
        // including) the next `async function ` (handlers are declared
        // back-to-back). Returns "" if not found so the assertions fail loudly.
        function handlerBody(html, fn) {
            const start = html.indexOf(`async function ${fn}(`);
            if (start === -1) return "";
            const after = html.indexOf("async function ", start + 1);
            return html.slice(start, after === -1 ? html.length : after);
        }

        for (const [label, getHtml] of [
            ["frontend/index.html", () => mainHtml],
            ["frontend/v6/index.html", () => v6html],
        ]) {
            describe(label, function () {
                it("contains NO native alert( anywhere (the bug)", function () {
                    // Reverting ANY single handler's failure branch back to
                    // alert(friendlyError(err)) re-introduces this token and fails.
                    expect(getHtml(), "found a native alert( call").to.not.match(/\balert\(/);
                });

                for (const { fn, slot } of HANDLERS) {
                    describe(fn, function () {
                        it(`binds its inline slot via $('${slot}') and writes a msg-error on the failure path`, function () {
                            const body = handlerBody(getHtml(), fn);
                            expect(body, `handler ${fn} not found`).to.not.equal("");
                            // The handler captures the contextually-correct slot.
                            expect(body, `${fn} must read const msg = $('${slot}')`).to.include(
                                `const msg = $('${slot}')`
                            );
                            // The catch block writes the friendly error to that slot
                            // as a msg-error (the OLD behaviour was alert(...)).
                            expect(body, `${fn} must NOT call alert(`).to.not.match(/\balert\(/);
                            expect(
                                body,
                                `${fn} must write a msg-error with friendlyError(err) to the inline slot on failure`
                            ).to.match(
                                /catch \(err\) \{[\s\S]*msg\.innerHTML = `<div class="msg msg-error">\$\{escapeHtml\(friendlyError\(err\)\)\}<\/div>`/
                            );
                            // It also surfaces start + success inline (same pattern
                            // as the working write paths) — non-vacuous proof the
                            // slot is actually wired, not just declared.
                            expect(body, `${fn} must show an inline msg-info start line`).to.match(
                                /msg\.innerHTML = `<div class="msg msg-info"><span class="spinner"><\/span>/
                            );
                            expect(body, `${fn} must show an inline msg-success confirmation`).to.match(
                                /msg\.innerHTML = `<div class="msg msg-success">/
                            );
                            // The existing log(...) call on the error path is kept.
                            expect(body, `${fn} must keep its log(... 'err') call`).to.match(
                                /log\(`[^`]*failed: \$\{friendlyError\(err\)\}`, 'err'\)/
                            );
                        });
                    });
                }
            });
        }
    });

    // MED-3 — doRule parsed the ruling fee with a HARDCODED 18 decimals while the
    // input was rendered with the token's real decimals (tokenDec), corrupting the
    // on-chain amount for any non-18-decimal token. The fix routes the parse through
    // the pure parseRuleFee (frontend/rule-fee.js) using the token's real decimals.
    // Locked in BOTH the canonical file and the v6 mirror.
    describe("ruling fee parse uses the token decimals via parseRuleFee (MED-3) wiring", function () {
        it("frontend/rule-fee.js exports the pure helper with the dual-export idiom", function () {
            const src = readFileSync(resolve(__dirname, "..", "..", "frontend", "rule-fee.js"), "utf8");
            expect(src).to.include("module.exports");
            expect(src).to.include("root.parseRuleFee");
            expect(src).to.match(/function parseRuleFee\s*\(/);
            // It clamps to judgeFee and uses an INJECTED parseUnits (no bundled ethers).
            expect(src).to.match(/if \(fee > judgeFee\) fee = judgeFee/);
            expect(src).to.include("requires an injected ethers.parseUnits");
        });

        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            describe(label, function () {
                it("loads rule-fee.js as a script", function () {
                    expect(html()).to.match(/<script src="\.{1,2}\/rule-fee\.js"><\/script>/);
                });
                it("doRule reads the token decimals and parses the fee via parseRuleFee (NOT a hardcoded 18)", function () {
                    const start = html().indexOf("async function doRule(");
                    expect(start, "doRule not found").to.not.equal(-1);
                    const after = html().indexOf("async function ", start + 1);
                    const body = html().slice(start, after === -1 ? html().length : after);
                    // It fetches the token's real decimals.
                    expect(body).to.match(/tokenMeta\(b\.token\)\)\.decimals/);
                    // It routes the parse + clamp through the pure helper with the
                    // token decimals and ethers.parseUnits (NOT parseUnits(feeStr, 18)).
                    expect(body).to.match(/window\.parseRuleFee\(\{[\s\S]{0,200}tokenDec[\s\S]{0,120}parseUnits: ethers\.parseUnits/);
                    // The OLD hardcoded-18 parse must be gone.
                    expect(body).to.not.match(/ethers\.parseUnits\(feeStr, 18\)/);
                    expect(body).to.not.match(/ethers\.formatUnits\(b\.judgeFee, 18\)/);
                });
            });
        }
    });

    // HIGH-1 + MED-7 — the judge operator's accrued fees were invisible and
    // unwithdrawable (withdrawFees had ZERO frontend callers), and the "Your judge
    // contract" status was buried inside the collapsed "Offer judging services"
    // accordion. The fix hoists a compact #judgeStatusCard ABOVE the profiles list
    // (outside the accordion) that reads the judge contract's claimable token balance
    // and offers a Withdraw button wired to manualJudgeContract(judge,true)
    // .withdrawFees(token, account, balance). Locked in BOTH files.
    describe("hoisted judge status card + claimable fees / withdraw (HIGH-1 + MED-7) wiring", function () {
        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            describe(label, function () {
                it("renders the #judgeStatusCard container ABOVE the Registered judge profiles list, OUTSIDE the accordion", function () {
                    // The hoisted card appears before the profiles heading + list, and
                    // before the <details id="judgeOfferDetails"> accordion.
                    expect(html()).to.match(
                        /<div id="judgeStatusCard"><\/div>[\s\S]{0,200}<h3[^>]*>Registered judge profiles<\/h3>/
                    );
                    expect(html()).to.match(
                        /<div id="judgeStatusCard"><\/div>[\s\S]{0,400}<details class="card" id="judgeOfferDetails"/
                    );
                });
                it("refreshOnboarding keeps the hoisted card in sync via renderJudgeStatusCard", function () {
                    expect(html()).to.match(/renderJudgeStatusCard\(myJudge\)/);
                });
                it("renderJudgeStatusCard reads the judge contract's token balance and offers a Withdraw button (HIGH-1)", function () {
                    const start = html().indexOf("async function renderJudgeStatusCard(");
                    expect(start, "renderJudgeStatusCard not found").to.not.equal(-1);
                    const after = html().indexOf("async function ", start + 1);
                    const body = html().slice(start, after === -1 ? html().length : after);
                    // Reads the claimable fees = the judge contract's ERC-20 balance.
                    expect(body).to.match(/erc20Contract\(token, false\)\.balanceOf\(myJudge\)/);
                    // Renders the amount through the canonical USD formatter.
                    expect(body).to.match(/susdsBigIntToUsdString\(balance, rate\)/);
                    // Only offers Withdraw when there is a balance AND the viewer is the operator.
                    expect(body).to.match(/balance > 0n && isOperator/);
                    expect(body).to.include("withdrawFeesBtn");
                    expect(body).to.match(/doWithdrawJudgeFees\(myJudge, token, balance\)/);
                    // MED-4 null-first branch is mirrored here too (no false "Active").
                    expect(body).to.match(/if \(isActive === null\)[\s\S]{0,120}Could not read judge state/);
                });
                it("doWithdrawJudgeFees calls withdrawFees(token, account, amount) through the manualJudgeContract write factory", function () {
                    const start = html().indexOf("async function doWithdrawJudgeFees(");
                    expect(start, "doWithdrawJudgeFees not found").to.not.equal(-1);
                    const after = html().indexOf("async function ", start + 1);
                    const body = html().slice(start, after === -1 ? html().length : after);
                    expect(body).to.match(/manualJudgeContract\(judgeAddr, true\)/);
                    expect(body).to.match(/withdrawFees\(token, account, amount\)/);
                    expect(body).to.match(/await waitForTx\(tx\)/);
                    // Refreshes the card so the zeroed balance + button disappear.
                    expect(body).to.match(/renderJudgeStatusCard\(getMyJudgeContract\(\)\)/);
                });
            });
        }
    });

    // MED-4 — the in-accordion "Your judge contract" status labelled an UNKNOWN
    // judge state (active() RPC read returned null) as "Active". The fix branches on
    // isActive === null FIRST. Locked in BOTH files.
    describe("refreshOnboarding null judge state (MED-4) wiring", function () {
        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            it(`${label}: refreshOnboarding branches on isActive === null first -> retry (not Active)`, function () {
                const start = html().indexOf("async function refreshOnboarding(");
                expect(start, "refreshOnboarding not found").to.not.equal(-1);
                const after = html().indexOf("async function ", start + 1);
                const body = html().slice(start, after === -1 ? html().length : after);
                // The null branch comes BEFORE the isActive === false / Active branches.
                expect(body).to.match(/if \(isActive === null\) \{[\s\S]{0,120}Could not read judge state — retry\.[\s\S]{0,200}\} else if \(isActive === false\)/);
            });
        }
    });

    // MED-6 — the My-Bonds "As Judge" row hint said "Pending challenges to rule"
    // regardless of phase. The fix gates the "to rule" wording on the pending
    // challenge being in its ruling window (reusing phaseFor). Locked in BOTH files.
    describe("My-Bonds As-Judge hint is phase-aware (MED-6) wiring", function () {
        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            it(`${label}: the judge-role hint is derived via phaseFor, not an unconditional 'to rule'`, function () {
                // The old unconditional string must be gone from the my-row hint path.
                expect(html()).to.not.include("hint = 'Pending challenges to rule'");
                // The judge-role hint now consults phaseFor on the pending challenges.
                expect(html()).to.match(/judgeRowHint/);
            });
        }
    });

    // Security hardening (H2 untrusted-indexer XSS, H3 claim-text↔on-chain hash,
    // H4 fake-sUSDS USDS approval). Pinned in BOTH mirrors so a regression in
    // either file is caught. H4 has no e2e (mainnet-USDS only), so this is its
    // primary guard.
    describe("security hardening wiring (H2/H3/H4)", function () {
        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            it(`${label}: H3 — loads claim-verify.js, gates actions + warns on a claim-hash mismatch`, function () {
                expect(html()).to.match(/claim-verify\.js/);
                expect(html()).to.include("window.claimVerification(");
                expect(html()).to.include("!claimMismatch");           // challenge + judge controls suppressed on mismatch
                expect(html()).to.match(/Unverified claim text/);      // visible warning banner
            });
            it(`${label}: H2 — addressLink escapes attributes + only links a valid address`, function () {
                expect(html()).to.include('title="${escapeHtml(checksummed)}"'); // was raw title="${addr}"
                expect(html()).to.include("window.ethers.isAddress(s)");
            });
            it(`${label}: H4 — doSusdsDeposit only approves USDS for the canonical sUSDS vault`, function () {
                expect(html()).to.match(/String\(tokenAddr\)\.toLowerCase\(\) !== MAINNET_SUSDS/);
                expect(html()).to.include("only available for the canonical sUSDS vault");
            });
        }
    });

    // Stale-signer regression (mainnet incident 2026-06-10): the accountsChanged
    // handler re-rendered the role-gated UI for the new account but kept the OLD
    // signer (an ethers JsonRpcSigner is pinned to the address it was created
    // with), so writes were sent FROM the previous account and reverted with the
    // other account's role error ("Only operator"). The handler must rebuild
    // provider+signer, exactly like the chainChanged handler always has.
    // Behavior is covered end-to-end by tests/e2e/account-switch-signer.spec.js.
    // Release hardening (2026-06-11): M5 SRI on the ethers CDN tag, M6 ruling-
    // window advisory, H1 capacity-exhausted transparency notice.
    describe("release hardening (M5 SRI / M6 timing / H1 capacity) wiring", function () {
        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            it(`${label}: M5 — ethers CDN tag carries SRI integrity + crossorigin`, function () {
                expect(html()).to.match(/cdn\.jsdelivr\.net\/npm\/ethers@6\.16\.0[^>]*integrity="sha384-[A-Za-z0-9+/]+"/);
                expect(html()).to.match(/ethers@6\.16\.0[^>]*crossorigin="anonymous"/);
            });
            it(`${label}: M6 — loads timing-warn.js and wires the live ruling-window advisory`, function () {
                expect(html()).to.match(/<script src="\.{1,2}\/timing-warn\.js"><\/script>/);
                expect(html()).to.include("window.timingWarning(");
                expect(html()).to.include('id="cb-timing-warn"');
            });
            it(`${label}: H1 — renders the capacity-exhausted "can no longer be challenged" notice`, function () {
                expect(html()).to.include("challengeCapacityFull");
                expect(html()).to.include("This claim can no longer be challenged");
            });
        }
    });

    describe("accountsChanged rebinds the signer (stale-signer regression) wiring", function () {
        // Old (buggy) shape: a SYNC handler that never touches the signer.
        const LEGACY_SYNC_HANDLER_RE = /_accountsHandler = \(accounts\) =>/;
        // Fixed shape: async handler that re-pins the signer to the new account.
        const REBIND_RE = /_accountsHandler = async \(accounts\)[\s\S]{0,900}?getSigner\(account\)/;

        for (const [label, html] of [["frontend/index.html", () => mainHtml], ["frontend/v6/index.html", () => v6html]]) {
            it(`${label}: accountsChanged handler is async and re-pins the signer to the new account`, function () {
                expect(html()).to.match(REBIND_RE);
                expect(html()).to.not.match(LEGACY_SYNC_HANDLER_RE);
            });
        }
    });
});
