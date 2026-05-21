// Playwright fixture: minimal EIP-1193 mock that handles read methods + the
// connect handshake. Sufficient for B-series flows (connect wallet, switch
// chain, address display). C-series flows that need real contract state
// require a Hardhat-backed variant (see fixtures/wallet-with-node.js TODO).

const { test: base } = require("@playwright/test");

const FAKE_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Hardhat #0

const test = base.extend({
    page: async ({ page }, use) => {
        await page.addInitScript(({ addr }) => {
            // Minimal EIP-1193 — enough to drive the UI's connect/disconnect
            // flow and chain-switch banner. Read-only state on the underlying
            // chain is provided by the page's own read provider (via the
            // chain.rpc URL in runtime-config).
            const provider = {
                isMetaMask: true,
                _listeners: {},
                on(event, fn) { (this._listeners[event] ||= []).push(fn); },
                removeListener(event, fn) {
                    const a = this._listeners[event] || [];
                    const i = a.indexOf(fn);
                    if (i >= 0) a.splice(i, 1);
                },
                async request({ method }) {
                    switch (method) {
                        case "eth_chainId":
                            return "0x1"; // mainnet so the network-mismatch banner stays hidden
                        case "eth_accounts":
                        case "eth_requestAccounts":
                            return [addr];
                        case "wallet_switchEthereumChain":
                            return null;
                        default:
                            // No backend writes; reject so the UI surfaces a clean error.
                            throw new Error(`mock provider does not implement ${method}`);
                    }
                },
            };
            Object.defineProperty(window, "ethereum", {
                value: provider,
                writable: true,
                configurable: true,
            });
        }, { addr: FAKE_ADDR });

        await use(page);
    },
});

module.exports = { test, expect: base.expect, FAKE_ADDR };
