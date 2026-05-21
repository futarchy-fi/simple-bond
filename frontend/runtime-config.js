// SIMPLE_BOND_CONFIG schema:
//   notifyApiBase: backend API origin.
//   chains: chainId -> { name, bondContract, deployBlock, judgeProfileRegistry,
//                        posterProfileRegistry, challengerProfileRegistry,
//                        officialDirectory, approvedToken, explorer, bondVersion }
//   defaultChainId: which chain the UI selects first.
//
// Legacy `gnosis*` keys are kept for back-compat with the v0.5 UI until Phase 11.
window.SIMPLE_BOND_CONFIG = Object.assign(
  {
    // Override these when the static frontend and APIs live on different origins.
    notifyApiBase: "/api/notify",

    chains: {
      11155111: {
            "name": "Sepolia",
            "bondContract": "0xEeEB10a05b4D819d736DB7A130eaC0f36626F583",
            "deployBlock": 10888612,
            "judgeProfileRegistry": "0x5C182867862c061a32C7621c0e3529FF682bbF22",
            "posterProfileRegistry": "0x7644dfE83B1e1e9E466644557606Ff28916fCc15",
            "challengerProfileRegistry": "0xA6c22430CB34AC5403D6f2a01BecD90c91e09C23",
            "manualJudgeV6": "0x25E749d42EE4AD0afBEF5c92Bede672784AbDBa9",
            "officialDirectory": "0xe93B0E8fd59FA1dbfa3441559616ADBD3344395F",
            "approvedToken": "0x8983aebdA1D5f2b406144D7AAa4f50df4ec8A837",
            "explorer": "https://sepolia.etherscan.io",
            "bondVersion": 6
      },
      // 1 (Ethereum mainnet) — populated by scripts/v6/deployAll.js output.
      // 11155111 (Sepolia) — populated by scripts/v6/deployAll.js output for
      //   staging.bond.futarchy.ai.

      // Legacy Gnosis v0.5 (retired at Phase 11).
      100: {
        name: "Gnosis",
        bondContract: "0x7dF485C013f8671B656d585f1d1411640B1D2776",
        deployBlock: 45569363,
        judgeProfileRegistry: "0x5f2000E438533662A689311672a41aca3EDC88DD",
        judgeRegistry: "0xf2F50455D3E1956EF4DF8BBA9a93CeDaF4aE9A3D",
        officialDirectory: "0xb32263E363f668f97137D53baF69CF7Fb388c343",
        explorer: "https://gnosisscan.io",
        bondVersion: 5,
      },
    },

    // Default chain the UI loads on first visit. Set to 1 after mainnet cutover.
    defaultChainId: 100,

    // --- Back-compat (legacy v0.5 UI reads these directly) ---
    gnosisBondContract: "0x7dF485C013f8671B656d585f1d1411640B1D2776",
    gnosisDeployBlock: 45569363,
    gnosisJudgeProfileRegistry: "0x5f2000E438533662A689311672a41aca3EDC88DD",
    gnosisJudgeRegistry: "0xf2F50455D3E1956EF4DF8BBA9a93CeDaF4aE9A3D",
    gnosisOfficialDirectory: "0xb32263E363f668f97137D53baF69CF7Fb388c343",
  },
  window.SIMPLE_BOND_CONFIG || {}
);
