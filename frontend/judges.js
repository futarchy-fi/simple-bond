(function (root) {
  function normalizeTokenFees(tokenFees) {
    const normalized = new Map();
    for (const [tokenAddr, fee] of (tokenFees || new Map()).entries()) {
      normalized.set(tokenAddr.toLowerCase(), fee);
    }
    return normalized;
  }

  function dedupeJudgesByAddress(entries) {
    const merged = new Map();
    for (const entry of entries || []) {
      if (!entry || !entry.address) continue;
      const key = entry.address.toLowerCase();
      const normalizedFees = normalizeTokenFees(entry.tokenFees);

      if (!merged.has(key)) {
        merged.set(key, {
          address: entry.address,
          tokenFees: normalizedFees,
          bondCount: entry.bondCount || 0,
        });
        continue;
      }

      const current = merged.get(key);
      current.bondCount = Math.max(current.bondCount, entry.bondCount || 0);
      for (const [tokenAddr, fee] of normalizedFees.entries()) {
        current.tokenFees.set(tokenAddr, fee);
      }
    }

    return [...merged.values()];
  }

  function getJudgeSelectEntries(judges, klerosAddr) {
    const deduped = new Map();

    if (klerosAddr) {
      deduped.set(klerosAddr.toLowerCase(), {
        address: klerosAddr,
        kind: "kleros",
      });
    }

    for (const judge of judges || []) {
      if (!judge || !judge.address) continue;
      const key = judge.address.toLowerCase();
      if (deduped.has(key)) continue;
      deduped.set(key, {
        address: judge.address,
        kind: "judge",
        judge,
      });
    }

    return [...deduped.values()];
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      dedupeJudgesByAddress,
      getJudgeSelectEntries,
    };
  }

  root.dedupeJudgesByAddress = dedupeJudgesByAddress;
  root.getJudgeSelectEntries = getJudgeSelectEntries;
})(typeof window !== "undefined" ? window : globalThis);
