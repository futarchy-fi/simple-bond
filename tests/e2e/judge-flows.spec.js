// FLOWS.md section E — judge wallet-driven flows.
// Uses the canonical ManualJudgeV6 deployed by the worker fixture.
// The judgeOperator key (KEYS.judgeOperator) was set as that wrapper's operator
// at fixture-setup time, so this test signs ruling calls with that key.

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { ethers } = require("ethers");
const {
    createBondViaUI,
    gotoBondDetail,
    gotoMyBonds,
    readBond,
    readChallenge,
    timeTravel,
    syncDateToChain,
} = require("./fixtures/helpers");

async function asOperator(page, deployed, switchAccount, key = KEYS.judgeOperator) {
    await switchAccount(key);
    // Register the canonical judge contract in localStorage so the UI marks
    // this wallet as the judge operator on the bond detail page.
    await page.evaluate(
        ({ judge, chainId, addr }) => {
            const key = `myJudgeContract:${chainId}:${addr.toLowerCase()}`;
            localStorage.setItem(key, judge);
        },
        {
            judge: deployed.manualJudgeV6,
            chainId: deployed.chainId,
            addr: new ethers.Wallet(key).address,
        }
    );
}

async function asChallenger(page, switchAccount, key) {
    await switchAccount(key);
}

async function asPoster(page, switchAccount) {
    await switchAccount(KEYS.poster);
}

// Set up: create a bond, file a challenge, advance past acceptance window so
// rulings are allowed. Returns the bondId.
async function bondWithPendingChallenge(page, deployed, switchAccount) {
    const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 600 });
    await asChallenger(page, switchAccount, KEYS.challenger1);
    await page.reload();
    await gotoBondDetail(page, id);
    await page.fill("#chContent", "judge-flow test");
    await page.locator("#challengeBtn").click();
    // Wait for the challenge.
    const start = Date.now();
    while (Date.now() - start < 30_000) {
        const b = await readBond(deployed, id);
        if (b.pendingCount === 1n) break;
        await new Promise((r) => setTimeout(r, 500));
    }
    // Advance past acceptance.
    await timeTravel(deployed, 120, page);
    return id;
}

test.describe("E — judge flows", () => {
    test("E1 — register a profile pointing at the canonical ManualJudgeV6", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(60_000);
        await page.goto("/#judges");
        await switchAccount(KEYS.judgeOperator);
        await page.reload();
        // The judge-offering UI lives inside a collapsed <details> so it
        // doesn't distract people who just want to browse profiles.
        await page.locator("#judgeOfferDetails > summary").click();
        await page.waitForSelector("#jp-addr");
        // The "Use default judge" button on the judges side was removed —
        // pointing a profile at a judge you don't control is nonsense.
        // For this test we register a second profile pointing at the same
        // canonical judge as the fixture's seed (operator is fine to register
        // multiple profiles); paste the address manually.
        await page.fill("#jp-addr", deployed.manualJudgeV6);
        await page.fill("#jp-content", "e2e canonical profile");
        await page.locator("#jp-go").click();
        // The global tx modal appears while the registration tx is pending and
        // flips to a confirmed state once mined.
        await expect(page.locator("#txModal")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator("#txModal")).toContainText(/confirmed/i, { timeout: 60_000 });
        // The page renders the static heading "Registered judge profiles"
        // unconditionally, so wait specifically for the log line that
        // includes "entryId=" — that only appears after the tx confirms.
        await page.waitForFunction(
            () => /entryId=\d+/i.test(document.body.innerText),
            null,
            { timeout: 60_000 }
        );
        // Bonus: read entryCount via chain to confirm a new entry was added
        // beyond the fixture's pre-seeded one.
        const provider = new ethers.JsonRpcProvider(deployed.rpc);
        const reg = new ethers.Contract(
            deployed.judgeProfileRegistry,
            ["function entryCount() view returns (uint256)"],
            provider
        );
        const n = await reg.entryCount();
        expect(n).toBeGreaterThan(1n);
    });

    test("E1b — My Bonds lists the bond under 'As Judge' for the judge operator", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(120_000);
        // Poster creates a bond judged by the canonical ManualJudgeV6.
        const id = await createBondViaUI(page);
        // Become that judge's operator (marks myJudgeContract in localStorage).
        await asOperator(page, deployed, switchAccount);
        // As the operator, the bond must populate under "As Judge"...
        // gotoMyBonds re-navigates until the CONNECTED role sections render
        // (order-independent under full-suite load).
        await gotoMyBonds(page);
        await expect(
            page.locator(`#myJudge .bond-list-item[data-bondid="${id}"]`)
        ).toBeVisible({ timeout: 20_000 });
        // ...and NOT under "As Poster" (the operator neither posted nor challenged it).
        await expect(
            page.locator(`#myPoster .bond-list-item[data-bondid="${id}"]`)
        ).toHaveCount(0);
    });

    test("E2 — deploy a fresh ManualJudgeV6 (caller becomes operator)", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(120_000);
        // Use a separate key so we don't conflict with the fixture's canonical operator.
        await page.goto("/#judges");
        await switchAccount(KEYS.challenger2);
        await page.reload();
        await page.locator("#judgeOfferDetails > summary").click();
        await page.waitForSelector("#jp-deploy-new");
        // Capture the post-deploy address from #jp-addr (the helper auto-fills it).
        await page.locator("#jp-deploy-new").click();
        const deployedAddr = await page.waitForFunction(
            () => {
                const v = document.getElementById("jp-addr")?.value || "";
                return /^0x[0-9a-fA-F]{40}$/.test(v) ? v : null;
            },
            null,
            { timeout: 90_000 }
        );
        const judgeAddr = await deployedAddr.jsonValue();
        expect(judgeAddr).toMatch(/^0x[0-9a-fA-F]{40}$/);
        // Verify on-chain: the contract is at that address, has bytecode, and
        // its operator is the wallet that deployed it.
        const provider = new ethers.JsonRpcProvider(deployed.rpc);
        const code = await provider.getCode(judgeAddr);
        expect(code).not.toBe("0x");
        const judge = new ethers.Contract(
            judgeAddr,
            [
                "function operator() view returns (address)",
                "function active() view returns (bool)",
            ],
            provider
        );
        const op = await judge.operator();
        const expected = new ethers.Wallet(KEYS.challenger2).address;
        expect(op.toLowerCase()).toBe(expected.toLowerCase());
        const active = await judge.active();
        expect(active).toBe(true);
    });

    test("E3 — judge operator rules for the poster", async ({ page, deployed, switchAccount }) => {
        test.setTimeout(180_000);
        const id = await bondWithPendingChallenge(page, deployed, switchAccount);
        // Become judge operator + register canonical judge in storage.
        await asOperator(page, deployed, switchAccount);
        await page.reload();
        await syncDateToChain(deployed, page);
        await page.reload();
        await gotoBondDetail(page, id);
        // Set the fee to 0 so we don't have to fund the bond contract's fee balance.
        await page.fill('input[id="fee-0"]', "0");
        await page.fill('textarea[id="rule-0"]', "challenger argument was unsound");
        await page.locator('button[data-act="ruleForPoster"][data-i="0"]').click();
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            const c = await readChallenge(deployed, id, 0);
            if (c.status === 2n /* Lost */) {
                const b = await readBond(deployed, id);
                expect(b.settled).toBe(false); // bond continues
                expect(b.pendingCount).toBe(0n);
                return;
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        const c = await readChallenge(deployed, id, 0);
        expect(c.status).toBe(2n);
    });

    test("E4 — judge operator rules for the challenger (settles bond)", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        const id = await bondWithPendingChallenge(page, deployed, switchAccount);
        await asOperator(page, deployed, switchAccount);
        await page.reload();
        await syncDateToChain(deployed, page);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill('input[id="fee-0"]', "0");
        await page.fill('textarea[id="rule-0"]', "challenger was right");
        await page.locator('button[data-act="ruleForChallenger"][data-i="0"]').click();
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            const c = await readChallenge(deployed, id, 0);
            if (c.status === 1n /* Won */) {
                const b = await readBond(deployed, id);
                expect(b.settled).toBe(true);
                return;
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        const c = await readChallenge(deployed, id, 0);
        expect(c.status).toBe(1n);
    });

    test("E5 — judge operator rejects a challenge as out-of-scope", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        const id = await createBondViaUI(page);
        await asChallenger(page, switchAccount, KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill("#chContent", "spam");
        await page.locator("#challengeBtn").click();
        // Wait
        const cstart = Date.now();
        while (Date.now() - cstart < 30_000) {
            const b = await readBond(deployed, id);
            if (b.pendingCount === 1n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        await asOperator(page, deployed, switchAccount);
        await page.reload();
        await syncDateToChain(deployed, page);
        await page.reload();
        await gotoBondDetail(page, id);
        // Reject button — could be in either of two rendered shapes depending
        // on whether we're inside the ruling window. Either way, the button
        // with data-act="rejectChallenge" exists.
        await page.locator('button[data-act="rejectChallenge"][data-i="0"]').first().click();
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            const c = await readChallenge(deployed, id, 0);
            if (c.status === 4n /* RejectedByJudge */) {
                const b = await readBond(deployed, id);
                expect(b.settled).toBe(false);
                expect(b.pendingCount).toBe(0n);
                return;
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        const c = await readChallenge(deployed, id, 0);
        expect(c.status).toBe(4n);
    });

    // HIGH-1: a judge earns feeCharged on every ruling (the bond contract transfers
    // it to the judge CONTRACT). The v6 frontend previously had ZERO callers of
    // withdrawFees and never read the judge contract's balance, so those earnings
    // were invisible AND unwithdrawable. This test rules a challenge with a NON-ZERO
    // fee, asserts the #judges "Your judge contract" card shows the charged fee as
    // claimable, clicks Withdraw, and asserts the judge contract balance drops to 0,
    // the operator wallet rises by the fee, and the UI then shows $0.00 claimable.
    test("E7 — judge operator sees claimable fees and withdraws them", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        const provider = new ethers.JsonRpcProvider(deployed.rpc);
        const token = new ethers.Contract(
            deployed.approvedToken,
            ["function balanceOf(address) view returns (uint256)"],
            provider
        );
        // Default wizard bond: bondAmount 10, challengeAmount 3, judgeFee 0.5 (USD;
        // 1:1 mock rate, 18 decimals => 0.5e18). Rule for the poster charging the
        // full 0.5 fee so the judge contract accrues exactly 0.5e18.
        const id = await bondWithPendingChallenge(page, deployed, switchAccount);
        await asOperator(page, deployed, switchAccount);
        await page.reload();
        await syncDateToChain(deployed, page);
        await page.reload();
        await gotoBondDetail(page, id);
        // Leave the rendered default fee (0.5) — do NOT zero it. Rule for poster.
        await page.fill('textarea[id="rule-0"]', "challenger argument was unsound");
        await page.locator('button[data-act="ruleForPoster"][data-i="0"]').click();
        // Wait until the challenge resolves Lost and the judge contract is funded.
        const expectedFee = ethers.parseEther("0.5");
        let start = Date.now();
        while (Date.now() - start < 60_000) {
            const c = await readChallenge(deployed, id, 0);
            if (c.status === 2n /* Lost */) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        // On-chain truth: the judge contract now holds exactly the charged fee.
        const judgeBalBefore = await token.balanceOf(deployed.manualJudgeV6);
        expect(judgeBalBefore).toBe(expectedFee);

        // Visit the Judges tab as the operator — the hoisted "Your judge contract"
        // status card surfaces the claimable fees WITHOUT expanding the accordion.
        await page.goto("/#judges");
        await page.reload();
        await page.waitForSelector("#judgeStatusCard #judgeFeesAmount", { timeout: 30_000 });
        // The claimable-fees figure shows the charged fee ($0.50).
        await expect(page.locator("#judgeFeesAmount")).toHaveText("$0.50", { timeout: 20_000 });
        // And the Withdraw button is offered to the operator.
        await expect(page.locator("#withdrawFeesBtn")).toBeVisible({ timeout: 20_000 });

        const opAddr = new ethers.Wallet(KEYS.judgeOperator).address;
        const opBalBefore = await token.balanceOf(opAddr);

        // Withdraw.
        await page.locator("#withdrawFeesBtn").click();
        // Wait for the on-chain effect: judge contract balance drains to 0.
        start = Date.now();
        while (Date.now() - start < 60_000) {
            const bal = await token.balanceOf(deployed.manualJudgeV6);
            if (bal === 0n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        const judgeBalAfter = await token.balanceOf(deployed.manualJudgeV6);
        expect(judgeBalAfter).toBe(0n);
        // The operator wallet rose by exactly the fee.
        const opBalAfter = await token.balanceOf(opAddr);
        expect(opBalAfter - opBalBefore).toBe(expectedFee);

        // The UI now shows $0.00 claimable (and no Withdraw button).
        await expect(page.locator("#judgeFeesAmount")).toHaveText("$0.00", { timeout: 20_000 });
        await expect(page.locator("#withdrawFeesBtn")).toHaveCount(0);
    });

    // MED-6: the My-Bonds "As Judge" row hint said "Pending challenges to rule"
    // whenever pendingCount>0, even during the concession window (nothing to rule
    // yet). The fix makes the hint phase-aware. In the CONCESSION window the hint
    // must NOT say "to rule"; once the RULING window opens it must say "to rule".
    test("E8 — As-Judge row hint is phase-aware (concession: not 'to rule'; ruling: 'to rule')", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        // Long acceptanceDelay so the challenge sits in its concession window.
        const id = await createBondViaUI(page, { acceptanceDelay: 3600, rulingBuffer: 600 });
        await asChallenger(page, switchAccount, KEYS.challenger1);
        await page.reload();
        await gotoBondDetail(page, id);
        await page.fill("#chContent", "med6-concession");
        await page.locator("#challengeBtn").click();
        let cstart = Date.now();
        while (Date.now() - cstart < 30_000) {
            if ((await readBond(deployed, id)).pendingCount === 1n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        expect((await readBond(deployed, id)).pendingCount).toBe(1n);

        // Become the judge operator and open My Bonds — the challenge is still in its
        // concession window (we have NOT advanced time), so the hint must not say
        // "to rule".
        await asOperator(page, deployed, switchAccount);
        await gotoMyBonds(page);
        const row = page.locator(`#myJudge .bond-list-item[data-bondid="${id}"]`);
        await expect(row).toBeVisible({ timeout: 20_000 });
        const concessionHint = row.locator(".role-hint");
        await expect(concessionHint).toBeVisible({ timeout: 20_000 });
        await expect(concessionHint).not.toContainText("to rule");
        await expect(concessionHint).toContainText("ruling window not open yet");

        // Advance into the RULING window (past acceptanceDelay) and reload My Bonds —
        // now the hint must say "to rule".
        await timeTravel(deployed, 3600 + 60, page);
        await gotoMyBonds(page);
        const row2 = page.locator(`#myJudge .bond-list-item[data-bondid="${id}"]`);
        await expect(row2).toBeVisible({ timeout: 20_000 });
        await expect(row2.locator(".role-hint")).toContainText("Pending challenges to rule", {
            timeout: 20_000,
        });
    });

    // MED-5: loadJudgeEntries rendered a SILENT BLANK list when entryCount > 0 but
    // every getProfile read failed (an empty entries[] mapped to ""). The fix shows
    // the error + Retry banner instead. We arm the fixture RPC fault to fail ONLY
    // getProfile (selector 0xf08f4f64) while entryCount (the fixture pre-seeds 1
    // profile) still succeeds, then assert the Retry banner — not a blank list.
    test("E9 — entryCount>0 but every getProfile fails -> error+Retry banner, not a blank list", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(60_000);
        // Load the page FIRST so the init script defines window.__setMockAccount,
        // then switch the signing account.
        await page.goto("/#judges");
        await switchAccount(KEYS.judgeOperator);
        // Fail every getProfile (0xf08f4f64) read; entryCount (0x0cbb0f83) still works.
        page.injectRpcFault({ bodyIncludes: "f08f4f64", status: 500 });
        await page.reload();
        // The error+Retry banner must appear (NOT the "No judge profiles" empty state
        // and NOT a silently blank list).
        const list = page.locator("#judgesList");
        await expect(list.locator("#judgesRetryBtn")).toBeVisible({ timeout: 30_000 });
        await expect(list).toContainText(/Couldn't load profiles/i, { timeout: 30_000 });
        await expect(list).not.toContainText("No judge profiles registered yet");

        // Clearing the fault and clicking Retry recovers the list (the pre-seeded
        // canonical profile renders), proving the banner is a live recovery path.
        page.clearRpcFault();
        await list.locator("#judgesRetryBtn").click();
        await expect(page.locator("#judgesList .judge-item").first()).toBeVisible({ timeout: 30_000 });
    });

    test("E6 — judge operator voids the entire bond (rejectBond)", async ({
        page,
        deployed,
        switchAccount,
    }) => {
        test.setTimeout(180_000);
        const id = await createBondViaUI(page);
        await asOperator(page, deployed, switchAccount);
        await page.reload();
        await syncDateToChain(deployed, page);
        await page.reload();
        await gotoBondDetail(page, id);
        // The rejectBond button (id=rejectBondBtn) is in the judge void card.
        // Auto-accept the confirm dialog.
        page.once("dialog", (d) => d.accept());
        await page.locator("#rejectBondBtn").click();
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            const b = await readBond(deployed, id);
            if (b.settled) return;
            await new Promise((r) => setTimeout(r, 500));
        }
        const b = await readBond(deployed, id);
        expect(b.settled).toBe(true);
    });
});
