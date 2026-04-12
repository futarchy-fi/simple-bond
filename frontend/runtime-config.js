window.SIMPLE_BOND_CONFIG = Object.assign(
  {
    // Override these when the static frontend and APIs live on different origins.
    notifyApiBase: "/api/notify",
    // Live Gnosis deployment for bond.futarchy.ai.
    gnosisBondContract: "0x7dF485C013f8671B656d585f1d1411640B1D2776",
    gnosisDeployBlock: 45569363,
    // On-chain public profile registry for judge contracts on Gnosis.
    gnosisJudgeProfileRegistry: "0x5f2000E438533662A689311672a41aca3EDC88DD",
    // Canonical operator-to-judge mapping on Gnosis.
    gnosisJudgeRegistry: "0xf2F50455D3E1956EF4DF8BBA9a93CeDaF4aE9A3D",
    // Futarchy-curated directory of official judges and supported tokens on Gnosis.
    gnosisOfficialDirectory: "0xb32263E363f668f97137D53baF69CF7Fb388c343",
  },
  window.SIMPLE_BOND_CONFIG || {}
);
