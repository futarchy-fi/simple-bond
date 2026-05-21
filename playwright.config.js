// Playwright config for SimpleBond v0.6 end-to-end tests.
// Tests live under `tests/e2e/`. Three "projects":
//   - live-mainnet: hits bond.futarchy.fi (read-only flows on Ethereum)
//   - live-sepolia: hits staging.bond.futarchy.fi (read-only + wallet on Sepolia)
//   - local: hits a local static server serving frontend/ (full coverage with mocked wallet)
const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
    testDir: "./tests/e2e",
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? "github" : "list",

    use: {
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },

    projects: [
        {
            name: "local",
            use: {
                ...devices["Desktop Chrome"],
                baseURL: "http://localhost:8765",
            },
            // Local fixture launches a Hardhat node + a static server; see fixtures.
        },
        {
            name: "live-mainnet",
            use: {
                ...devices["Desktop Chrome"],
                baseURL: "https://bond.futarchy.fi",
            },
        },
        {
            name: "live-sepolia",
            use: {
                ...devices["Desktop Chrome"],
                baseURL: "https://staging.bond.futarchy.fi",
            },
        },
    ],
});
