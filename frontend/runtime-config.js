window.SIMPLE_BOND_CONFIG = Object.assign(
  {
    // Override these when the static frontend and APIs live on different origins.
    notifyApiBase: "/api/notify",
    judgeApiBase: "/api/judges",
  },
  window.SIMPLE_BOND_CONFIG || {}
);
