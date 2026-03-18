window.SIMPLE_BOND_CONFIG = Object.assign(
  {
    // Override this when the static frontend and notify API live on different origins.
    notifyApiBase: "/api/notify",
  },
  window.SIMPLE_BOND_CONFIG || {}
);
