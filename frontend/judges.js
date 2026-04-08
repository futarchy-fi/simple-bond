(function (root) {
  function dedupeJudgesByAddress(entries) {
    const merged = new Map();
    for (const entry of entries || []) {
      if (!entry || !entry.address) continue;
      const key = entry.address.toLowerCase();

      if (!merged.has(key)) {
        merged.set(key, {
          address: entry.address,
          bondCount: entry.bondCount || 0,
          kind: entry.kind || "generic",
          operator: entry.operator || null,
          active: typeof entry.active === "boolean" ? entry.active : null,
        });
        continue;
      }

      const current = merged.get(key);
      current.bondCount = Math.max(current.bondCount, entry.bondCount || 0);
      if (current.kind === "generic" && entry.kind) {
        current.kind = entry.kind;
      }
      if (!current.operator && entry.operator) {
        current.operator = entry.operator;
      }
      if (current.active == null && typeof entry.active === "boolean") {
        current.active = entry.active;
      }
    }

    return [...merged.values()];
  }

  function getJudgeSelectEntries(judges) {
    return dedupeJudgesByAddress(judges).map((judge) => ({
      address: judge.address,
      judge,
    }));
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
