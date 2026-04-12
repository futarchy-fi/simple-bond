(function (root) {
  function getJudgeDisplayName(judge) {
    if (!judge) return "";
    return judge.officialDisplayName || judge.profile?.displayName || "";
  }

  function getJudgeStatement(judge) {
    if (!judge) return "";
    return judge.officialStatement || judge.profile?.statement || "";
  }

  function getJudgeExternalLink(judge) {
    if (!judge) return null;
    return judge.officialLinkURI || judge.profile?.linkURI || null;
  }

  function dedupeJudgesByAddress(entries) {
    const merged = new Map();
    for (const entry of entries || []) {
      if (!entry || !entry.address) continue;
      const key = entry.address.toLowerCase();

      if (!merged.has(key)) {
        merged.set(key, {
          address: entry.address,
          bondCount: entry.bondCount || 0,
          judgedCount: entry.judgedCount || 0,
          kind: entry.kind || "generic",
          operator: entry.operator || null,
          active: typeof entry.active === "boolean" ? entry.active : null,
          profile: entry.profile || null,
          official: !!entry.official,
          officialSortOrder: Number.isFinite(entry.officialSortOrder) ? entry.officialSortOrder : null,
          officialDisplayName: entry.officialDisplayName || "",
          officialStatement: entry.officialStatement || "",
          officialLinkURI: entry.officialLinkURI || "",
        });
        continue;
      }

      const current = merged.get(key);
      current.bondCount = Math.max(current.bondCount, entry.bondCount || 0);
      current.judgedCount = Math.max(current.judgedCount, entry.judgedCount || 0);
      if (current.kind === "generic" && entry.kind) {
        current.kind = entry.kind;
      }
      if (!current.operator && entry.operator) {
        current.operator = entry.operator;
      }
      if (current.active == null && typeof entry.active === "boolean") {
        current.active = entry.active;
      }
      if (!current.profile && entry.profile) {
        current.profile = entry.profile;
      }
      if (!current.official && entry.official) {
        current.official = true;
      }
      if (current.officialSortOrder == null && Number.isFinite(entry.officialSortOrder)) {
        current.officialSortOrder = entry.officialSortOrder;
      }
      if (!current.officialDisplayName && entry.officialDisplayName) {
        current.officialDisplayName = entry.officialDisplayName;
      }
      if (!current.officialStatement && entry.officialStatement) {
        current.officialStatement = entry.officialStatement;
      }
      if (!current.officialLinkURI && entry.officialLinkURI) {
        current.officialLinkURI = entry.officialLinkURI;
      }
    }

    return [...merged.values()];
  }

  function compareJudges(a, b) {
    const aOfficial = !!a?.official;
    const bOfficial = !!b?.official;
    if (aOfficial !== bOfficial) return aOfficial ? -1 : 1;

    if (aOfficial && bOfficial) {
      const aOrder = a.officialSortOrder == null ? Number.MAX_SAFE_INTEGER : a.officialSortOrder;
      const bOrder = b.officialSortOrder == null ? Number.MAX_SAFE_INTEGER : b.officialSortOrder;
      if (aOrder !== bOrder) return aOrder - bOrder;
    }

    const judgedDelta = (b?.judgedCount || 0) - (a?.judgedCount || 0);
    if (judgedDelta !== 0) return judgedDelta;

    const bondDelta = (b?.bondCount || 0) - (a?.bondCount || 0);
    if (bondDelta !== 0) return bondDelta;

    const aName = getJudgeDisplayName(a).toLowerCase();
    const bName = getJudgeDisplayName(b).toLowerCase();
    if (aName !== bName) return aName.localeCompare(bName);

    return (a?.address || "").toLowerCase().localeCompare((b?.address || "").toLowerCase());
  }

  function getJudgeSelectEntries(judges) {
    return dedupeJudgesByAddress(judges).sort(compareJudges).map((judge) => ({
      address: judge.address,
      judge,
    }));
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      compareJudges,
      dedupeJudgesByAddress,
      getJudgeDisplayName,
      getJudgeExternalLink,
      getJudgeSelectEntries,
      getJudgeStatement,
    };
  }

  root.compareJudges = compareJudges;
  root.dedupeJudgesByAddress = dedupeJudgesByAddress;
  root.getJudgeDisplayName = getJudgeDisplayName;
  root.getJudgeExternalLink = getJudgeExternalLink;
  root.getJudgeSelectEntries = getJudgeSelectEntries;
  root.getJudgeStatement = getJudgeStatement;
})(typeof window !== "undefined" ? window : globalThis);
