// Status-label coverage — verifies frontend/bond-status.js AS RENDERED across
// every way a v0.6 bond can settle, plus the unambiguous per-challenge labels.
//
// The v0.6 struct only carries a `settled` bool, so the precise badge is derived
// from the settle EVENTS (deriveSettleReason → queryFilterChunked). These tests
// drive each settle path on-chain (settle actions via direct contract calls as
// the correct signer; bond creation + challenges via the UI, which handles token
// approval) and then assert the rendered detail-page badge.
//
// Bond-level badges (header): Cancelled / Withdrawn / Settled (timed out) /
// Challenge upheld — each uses a bond-only CSS class so the locator is exact.
// Challenge-level badges: "Challenger won/lost" (never a bare "Won"/"Lost" that a
// poster would misread) and "Dismissed (out of scope)" (no CamelCase leak).

const { test, expect, KEYS } = require("./fixtures/wallet-with-node");
const { ethers } = require("ethers");
const {
  createBondViaUI, gotoBondDetail, gotoMyBonds, readBond, readChallenge, getChallengeCount, timeTravel, rpc,
} = require("./fixtures/helpers");

const JUDGE_ABI = [
  "function ruleForChallenger(address bondContract, uint256 bondId, uint256 i, uint256 feeCharged, string content)",
  "function ruleForPoster(address bondContract, uint256 bondId, uint256 i, uint256 feeCharged, string content)",
  "function rejectChallenge(address bondContract, uint256 bondId, uint256 i, string content)",
  "function rejectBond(address bondContract, uint256 bondId, string content)",
];
const BOND_W_ABI = [
  "function closeBond(uint256 bondId)",
  "function withdrawBond(uint256 bondId)",
  "function claimTimeout(uint256 bondId, uint256 i)",
];

const wallet = (deployed, key) => new ethers.Wallet(key, rpc(deployed));
const judge = (deployed) => new ethers.Contract(deployed.manualJudgeV6, JUDGE_ABI, wallet(deployed, KEYS.judgeOperator));
const bondW = (deployed, key) => new ethers.Contract(deployed.bondContract, BOND_W_ABI, wallet(deployed, key));

// Poll an on-chain predicate until true (or fail loudly after `ms`).
async function until(fn, ms = 45_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return true; } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return fn();
}

// File a challenge through the UI (handles ERC20 approval), wait until it lands.
async function challengeViaUI(page, switchAccount, deployed, bondId, key, reason) {
  await switchAccount(key);
  await page.reload();
  await gotoBondDetail(page, bondId);
  await page.fill("#chContent", reason);
  await page.locator("#challengeBtn").click();
  await until(async () => (await getChallengeCount(deployed, bondId)) >= 1n);
  expect(await getChallengeCount(deployed, bondId)).toBe(1n);
}

// Reload the detail page (RPC path runs deriveSettleReason) and return the
// bond-level header badge — located by its bond-only CSS class.
async function showDetail(page, bondId) {
  await page.reload();
  await gotoBondDetail(page, bondId);
}

test.describe("status-label badges — every settle path + challenge labels", () => {
  test("rejectBond → header badge 'Cancelled'", async ({ page, deployed }) => {
    test.setTimeout(120_000);
    const id = await createBondViaUI(page); // poster = KEYS.poster, judge = manualJudgeV6
    await (await judge(deployed).rejectBond(deployed.bondContract, id, "voided as a test")).wait();
    await until(async () => (await readBond(deployed, id)).settled);
    expect((await readBond(deployed, id)).settled).toBe(true);
    await showDetail(page, id);
    await expect(page.locator(".status-badge.status-cancelled")).toContainText("Cancelled", { timeout: 25_000 });
  });

  test("My-Bonds row derives + shows the precise label ('Cancelled') for the poster", async ({ page, deployed }) => {
    // Covers the My-Bonds derivation path (renderMySection → deriveSettleReason →
    // myRowHtml/bondStatus): the poster's row must read 'Cancelled', not 'Settled'.
    test.setTimeout(120_000);
    const id = await createBondViaUI(page); // poster = KEYS.poster (the connected/default wallet)
    await (await judge(deployed).rejectBond(deployed.bondContract, id, "voided from my-bonds test")).wait();
    await until(async () => (await readBond(deployed, id)).settled);
    await gotoMyBonds(page);
    await expect(
      page.locator(`#myPoster .bond-list-item[data-bondid="${id}"] .status-badge.status-cancelled`)
    ).toContainText("Cancelled", { timeout: 25_000 });
  });

  test("closeBond + withdrawBond → header badge 'Withdrawn'", async ({ page, deployed }) => {
    test.setTimeout(120_000);
    const id = await createBondViaUI(page);
    await (await bondW(deployed, KEYS.poster).closeBond(id)).wait();
    await until(async () => (await readBond(deployed, id)).closed);
    await (await bondW(deployed, KEYS.poster).withdrawBond(id)).wait();
    await until(async () => (await readBond(deployed, id)).settled);
    await showDetail(page, id);
    await expect(page.locator(".status-badge.status-withdrawn")).toContainText("Withdrawn", { timeout: 25_000 });
  });

  test("claimTimeout → header badge 'Settled (timed out)'", async ({ page, deployed, switchAccount }) => {
    test.setTimeout(180_000);
    const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 60 });
    await challengeViaUI(page, switchAccount, deployed, id, KEYS.challenger1, "timeout test");
    await timeTravel(deployed, 200, page); // past acceptance + ruling windows
    await (await bondW(deployed, KEYS.poster).claimTimeout(id, 0)).wait();
    await until(async () => (await readBond(deployed, id)).settled);
    await showDetail(page, id);
    await expect(page.locator(".status-badge.status-settled")).toContainText("timed out", { timeout: 25_000 });
  });

  test("ruleForChallenger → header 'Challenge upheld' + challenge 'Challenger won'", async ({ page, deployed, switchAccount }) => {
    test.setTimeout(180_000);
    const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 600 });
    await challengeViaUI(page, switchAccount, deployed, id, KEYS.challenger1, "I dispute this");
    await timeTravel(deployed, 120, page); // open the ruling window
    await (await judge(deployed).ruleForChallenger(deployed.bondContract, id, 0, 0, "upheld")).wait();
    await until(async () => (await readBond(deployed, id)).settled);
    expect((await readChallenge(deployed, id, 0)).status).toBe(1n); // Won
    await showDetail(page, id);
    await expect(page.locator(".status-badge.status-upheld")).toContainText("Challenge upheld", { timeout: 25_000 });
    await expect(page.locator("#ch-0 .status-badge")).toContainText("Challenger won");
  });

  test("ruleForPoster → challenge badge 'Challenger lost' (no bare 'Won/Lost')", async ({ page, deployed, switchAccount }) => {
    test.setTimeout(180_000);
    const id = await createBondViaUI(page, { acceptanceDelay: 60, rulingBuffer: 600 });
    await challengeViaUI(page, switchAccount, deployed, id, KEYS.challenger1, "weak challenge");
    await timeTravel(deployed, 120, page);
    await (await judge(deployed).ruleForPoster(deployed.bondContract, id, 0, 0, "dismissed on merits")).wait();
    await until(async () => (await readChallenge(deployed, id, 0)).status === 2n); // Lost
    await showDetail(page, id);
    await expect(page.locator("#ch-0 .status-badge")).toContainText("Challenger lost", { timeout: 25_000 });
    await expect(page.locator("#ch-0 .status-badge")).not.toHaveText(/^Lost$/);
  });

  test("rejectChallenge → challenge badge 'Dismissed (out of scope)' (no CamelCase leak)", async ({ page, deployed, switchAccount }) => {
    test.setTimeout(180_000);
    const id = await createBondViaUI(page);
    await challengeViaUI(page, switchAccount, deployed, id, KEYS.challenger1, "off-topic");
    await (await judge(deployed).rejectChallenge(deployed.bondContract, id, 0, "out of scope")).wait();
    await until(async () => (await readChallenge(deployed, id, 0)).status === 4n); // RejectedByJudge
    await showDetail(page, id);
    await expect(page.locator("#ch-0 .status-badge")).toContainText("Dismissed (out of scope)", { timeout: 25_000 });
    await expect(page.locator("#ch-0 .status-badge")).not.toContainText("RejectedByJudge");
  });
});
