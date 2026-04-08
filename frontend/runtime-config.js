window.SIMPLE_BOND_CONFIG = Object.assign(
  {
    // Override these when the static frontend and APIs live on different origins.
    notifyApiBase: "/api/notify",
    // Provide the deployed SimpleBondV5 address and creation block for Gnosis.
    gnosisBondContract: null,
    gnosisDeployBlock: 0,
    // Optional on-chain public profile registry for judge contracts on Gnosis.
    gnosisJudgeProfileRegistry: null,
  },
  window.SIMPLE_BOND_CONFIG || {}
);
