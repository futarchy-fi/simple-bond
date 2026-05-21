// Visual snapshot pass: navigate every major route and save a screenshot
// per project. Manual gut-check tool after deploys; failures are visual
// regressions you'd want a human to look at.

const { test } = require("@playwright/test");

const ROUTES = [
    { hash: "#create", file: "create" },
    { hash: "#browse", file: "browse" },
    { hash: "#judges", file: "judges" },
    { hash: "#my", file: "my-bonds" },
    { hash: "#view", file: "view-empty" },
];

for (const { hash, file } of ROUTES) {
    test(`screenshot ${file}`, async ({ page }, info) => {
        await page.goto("/");
        await page.evaluate((h) => { location.hash = h; }, hash);
        // Let any async render finish.
        await page.waitForTimeout(2500);
        const out = `screenshots/${info.project.name}/${file}.png`;
        await page.screenshot({ path: out, fullPage: true });
        info.annotations.push({ type: "screenshot", description: out });
    });
}
