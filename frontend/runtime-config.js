window.SIMPLE_BOND_CONFIG = Object.assign(
  {
    // Override these when the static frontend and APIs live on different origins.
    notifyApiBase: "/api/notify",
    // Live Gnosis deployment for bond.futarchy.ai.
    gnosisBondContract: "0x7dF485C013f8671B656d585f1d1411640B1D2776",
    gnosisDeployBlock: 45569363,
    // On-chain public profile registry for judge contracts on Gnosis.
    gnosisJudgeProfileRegistry: "0x5f2000E438533662A689311672a41aca3EDC88DD",
    // Futarchy-curated directory of official judges and supported tokens on Gnosis.
    gnosisOfficialDirectory: null,
  },
  window.SIMPLE_BOND_CONFIG || {}
);
