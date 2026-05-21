// SIMPLE_BOND_CONFIG schema:
//   notifyApiBase: backend API origin.
//   chains: chainId -> { name, bondContract, deployBlock, judgeProfileRegistry,
//                        posterProfileRegistry, challengerProfileRegistry,
//                        manualJudgeV6, officialDirectory, approvedToken,
//                        explorer, bondVersion }
//   defaultChainId: which chain the UI selects first.
window.SIMPLE_BOND_CONFIG = Object.assign(
  {
    // Frontend (Netlify) and notification API (GCP VM behind Caddy) live on
    // different origins, so this points at the absolute API base. The API
    // sends Access-Control-Allow-Origin: * so cross-origin fetches work.
    notifyApiBase: "https://api.bond.futarchy.ai/api/notify",

    chains: {
      1: {
        name: "Ethereum",
        // FallbackProvider walks this list in order — publicnode has been
        // intermittently dropping connections in some browsers, so we lead
        // with a more reliable endpoint.
        rpc: "https://eth.drpc.org",
        rpcs: [
          "https://eth.drpc.org",
          "https://rpc.ankr.com/eth",
          "https://ethereum-rpc.publicnode.com",
          "https://cloudflare-eth.com",
        ],
        bondContract: "0x6B24380B1980db3e2DfDd2b62f5ed3E7E88DFA43",
        deployBlock: 25139967,
        judgeProfileRegistry: "0x8fee829120b8823899372Ac3d39f77746192b407",
        posterProfileRegistry: "0x4eF9cF61B2480B3D9474B767193B9E56bFE34813",
        challengerProfileRegistry: "0xf3cC75bDC99CfEa05De04C13F270B4D39423FE69",
        manualJudgeV6: "0xd5C580e86535C4D66238eB2B9C4270b9a129993e",
        officialDirectory: "0xAB3f30129c66c139ceBCD424359E7D953f4f7455",
        approvedToken: "0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD",
        explorer: "https://etherscan.io",
        bondVersion: 6,
      },
      11155111: {
        name: "Sepolia",
        rpc: "https://ethereum-sepolia-rpc.publicnode.com",
        bondContract: "0xEeEB10a05b4D819d736DB7A130eaC0f36626F583",
        deployBlock: 10888612,
        judgeProfileRegistry: "0x5C182867862c061a32C7621c0e3529FF682bbF22",
        posterProfileRegistry: "0x7644dfE83B1e1e9E466644557606Ff28916fCc15",
        challengerProfileRegistry: "0xA6c22430CB34AC5403D6f2a01BecD90c91e09C23",
        manualJudgeV6: "0x25E749d42EE4AD0afBEF5c92Bede672784AbDBa9",
        officialDirectory: "0xe93B0E8fd59FA1dbfa3441559616ADBD3344395F",
        approvedToken: "0x8983aebdA1D5f2b406144D7AAa4f50df4ec8A837",
        explorer: "https://sepolia.etherscan.io",
        bondVersion: 6,
      },
    },

    defaultChainId: 1,
  },
  window.SIMPLE_BOND_CONFIG || {}
);

// Hostname-based chain filtering:
//   staging.bond.futarchy.* → testnet only (Sepolia)
//   bond.futarchy.fi/ai     → mainnet only
//   localhost / other       → both chains visible (development)
(function () {
  const h = (typeof location !== "undefined" && location.hostname) || "";
  const cfg = window.SIMPLE_BOND_CONFIG;
  if (!cfg || !cfg.chains) return;
  if (/^staging\.bond\.futarchy\./.test(h)) {
    delete cfg.chains[1];
    cfg.defaultChainId = 11155111;
    cfg.siteRole = "testnet";
  } else if (/^bond\.futarchy\.(fi|ai)$/.test(h)) {
    delete cfg.chains[11155111];
    cfg.defaultChainId = 1;
    cfg.siteRole = "mainnet";
  } else {
    cfg.siteRole = "dev";
  }
})();
