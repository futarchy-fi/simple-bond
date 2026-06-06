// phase.js — PURE, importable challenge-phase logic shared by the SimpleBond v0.6
// frontend (frontend/index.html and frontend/v6/index.html).
//
// Why this file exists: the per-challenge action buttons in challengeHtml() are
// gated on timing + role. When none match (e.g. you're a bystander in the
// concession window, or a judge before the ruling window opens), NOTHING used to
// render — a silent dead-end with no explanation of WHY there's no button or
// WHEN that changes. phaseFor() turns the raw on-chain timing + ChallengeStatus
// into a phase timeline + a plain-English reason sentence so the UI can always
// say where the challenge is and why an action is or isn't available.
//
// It is deliberately DOM-free and chain-free (no reads, no Date.now) so it can be
// unit-tested directly from node. It is loaded as a plain <script> in the browser
// (exposing window.phaseFor) and required() in tests (module.exports).
//
// ChallengeStatus enum — MUST mirror contracts/core/SimpleBondV6.sol:
//   0 Pending, 1 Won, 2 Lost, 3 Conceded, 4 RejectedByJudge, 5 Refunded
// Note the poster/challenger framing: ruleForChallenger() => Won (challenger
// won), ruleForPoster() => Lost (challenger lost).
//
// CONTRACT TIMING TRUTH (verified against SimpleBondV6.sol):
//   concessionDeadline(b,i) == rulingWindowStart(b,i) == ts + acceptanceDelay.
// They are ALWAYS equal — call that instant T0. So the pending timeline has only
// TWO adjacent sub-phases meeting at T0 (concession [.., T0) then ruling
// [T0, rulingDeadline]) and then a timeout-claimable zone (> rulingDeadline).
// There is NO gap phase between concession and ruling.
//
// BOUNDARY CHOICE at now == T0: classified as RULING (not concession). Rationale
// matching the on-chain gates: concede requires now <= concessionDeadline, while
// ruleFor* require now >= rulingWindowStart; at exactly T0 BOTH gates pass, so
// the ruling window is open and we surface ruling as the phase. The poster can
// still concede at that single instant — the poster-facing reason below says so
// explicitly so the label and the (still-present) concede button never conflict.
//
// JUDGE OUT-OF-SCOPE TRUTH: rejectChallenge(b,i) has NO timing gate — only
// (judge, !settled, status==Pending). So the judge operator may reject a
// challenge as out-of-scope at ANY point while it is Pending: during concession,
// during ruling, AND after rulingDeadline (until a timeout claim settles it).
// Reasons must NOT imply the only mover is the poster/judge-by-window.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../phase.js')
  }
  if (root) {
    root.phaseFor = api.phaseFor;    // browser: window.phaseFor(...)
    root.PHASE = api.PHASE;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // The two pending sub-phases (chronological), the timeout zone, and terminal.
  // TIMING_UNAVAILABLE is a PENDING challenge whose on-chain timing reads failed
  // to load (all-zero timing): we cannot know which sub-phase it is in, so we
  // refuse to classify it (and in particular never call it timeout-claimable).
  const PHASE = Object.freeze({
    PENDING_CONCESSION: 'pending-concession',
    PENDING_RULING: 'pending-ruling',
    TIMEOUT_CLAIMABLE: 'timeout-claimable',
    TIMING_UNAVAILABLE: 'timing-unavailable',
    RESOLVED: 'resolved',
  });

  // Format a unix-seconds timestamp into a human string. Pure; mirrors the look
  // of the frontend's fmtTime but without depending on it (kept local so the
  // module stays standalone and node-importable). Falsy/zero => an em-dash.
  function fmtAt(unix) {
    const n = Number(unix);
    if (!n || !Number.isFinite(n)) return '—';
    return new Date(n * 1000).toLocaleString();
  }

  // Sub-label + reason for each resolved (terminal) ChallengeStatus.
  // index aligns with the enum; 0/Pending is handled by the timed branch.
  const RESOLVED_INFO = {
    1: { sub: 'ruled for challenger', reason: 'Resolved: the judge ruled for the challenger; the bond is settled.' },
    2: { sub: 'ruled for poster', reason: 'Resolved: the judge ruled for the poster; this challenge was dismissed.' },
    3: { sub: 'conceded', reason: 'Resolved: the poster conceded this challenge; the challenger was refunded.' },
    4: { sub: 'rejected as out-of-scope', reason: 'Resolved: the judge rejected this challenge as out-of-scope; the challenger was refunded.' },
    5: { sub: 'refunded', reason: 'Resolved: this challenge was refunded after the bond settled.' },
  };

  const ROLES = Object.freeze({ POSTER: 'poster', CHALLENGER: 'challenger', JUDGE: 'judge', BYSTANDER: 'bystander' });

  // The judge may reject-as-out-of-scope at ANY pending instant — phrase reused
  // so every viewer's reason carries the caveat where it matters.
  const JUDGE_REJECT_CAVEAT = 'the judge may also reject this challenge as out-of-scope at any time while it is pending';

  // Build the concession-phase reason (now < T0) for a given viewer role.
  function concessionReason(role, T0, rulingDeadline) {
    const until = fmtAt(T0);
    switch (role) {
      case ROLES.POSTER:
        return `In the concession window until ${until}; you (the poster) can concede this challenge now to refund the challenger. `
          + `If you don't, the judge ruling window opens ${until}.`;
      case ROLES.CHALLENGER:
        return `In the concession window until ${until}; the poster may concede (refunding you) until then, and ${JUDGE_REJECT_CAVEAT}. `
          + `You have no action here; if neither happens the judge ruling window opens ${until}.`;
      case ROLES.JUDGE:
        return `In the concession window until ${until}; the poster may concede until then, and you (the judge) can reject this challenge as out-of-scope at any time while it is pending. `
          + `You cannot rule for either side until the ruling window opens ${until}.`;
      default: // bystander / unknown — role-agnostic but accurate (no false exclusivity)
        return `In the concession window until ${until}; only the poster can concede before then, and ${JUDGE_REJECT_CAVEAT}. `
          + `If neither happens, the judge ruling window opens ${until}.`;
    }
  }

  // Build the ruling-phase reason (T0 <= now <= rulingDeadline). At exactly T0 the
  // poster can still concede (now <= concessionDeadline), so the poster reason is
  // split on posterCanConcede to stay consistent with the still-present button.
  function rulingReason(role, T0, rulingDeadline, posterCanConcede) {
    const until = fmtAt(rulingDeadline);
    switch (role) {
      case ROLES.POSTER:
        if (posterCanConcede) {
          return `The concession deadline is this instant (${fmtAt(T0)}) — your last moment to concede this challenge. `
            + `The judge ruling window is now open until ${until}, and the judge may also reject this challenge as out-of-scope while it is pending.`;
        }
        return `The concession window closed ${fmtAt(T0)}; you (the poster) can no longer concede. `
          + `The judge now rules (or may reject as out-of-scope) until ${until}; if no ruling lands, anyone can claim the timeout refund after that.`;
      case ROLES.CHALLENGER:
        return `In the judge ruling window until ${until}; the judge may rule for either side or reject this challenge as out-of-scope. `
          + `You have no action here; if no ruling lands, anyone can claim the timeout refund after ${until}.`;
      case ROLES.JUDGE:
        return `In the ruling window until ${until}; you (the judge) can rule for the poster or the challenger, or reject this challenge as out-of-scope. `
          + `If no ruling lands, anyone can claim the timeout refund after that.`;
      default: // bystander / unknown
        return `In the ruling window until ${until}; only the assigned judge can rule (and the judge may instead reject this challenge as out-of-scope). `
          + `If no ruling lands, anyone can claim the timeout refund after that.`;
    }
  }

  // Build the timeout-claimable reason (now > rulingDeadline). The judge can STILL
  // reject-as-out-of-scope here (no timing gate) until a timeout claim settles it.
  function timeoutReason(role, rulingDeadline) {
    const passed = fmtAt(rulingDeadline);
    switch (role) {
      case ROLES.POSTER:
        return `Ruling window passed ${passed} with no ruling; anyone (including you) can now claim the timeout refund to settle the bond. `
          + `The judge can still reject this challenge as out-of-scope until a timeout claim settles the bond.`;
      case ROLES.CHALLENGER:
        return `Ruling window passed ${passed} with no ruling; anyone (including you) can now claim the timeout refund. `
          + `The judge can still reject this challenge as out-of-scope until a timeout claim settles the bond.`;
      case ROLES.JUDGE:
        return `Ruling window passed ${passed}, so you can no longer rule; but you (the judge) can still reject this challenge as out-of-scope while it is pending. `
          + `Otherwise anyone can claim the timeout refund to settle the bond.`;
      default: // bystander / unknown
        return `Ruling window passed ${passed} with no ruling; anyone can now claim the timeout refund to settle the bond. `
          + `The judge may still reject this challenge as out-of-scope until then.`;
    }
  }

  /**
   * Pure phase classifier for a single challenge.
   *
   * @param {object} timing   { concessionDeadline, rulingWindowStart, rulingDeadline } (unix seconds; numbers or bigints).
   *                          concessionDeadline === rulingWindowStart on-chain (== T0).
   * @param {number} status   numeric ChallengeStatus (0..5)
   * @param {number} now      current time in unix seconds
   * @param {string} [viewerRole] one of 'poster' | 'challenger' | 'judge' | 'bystander'
   *                          (default 'bystander'). Tailors the reason to what THAT
   *                          viewer can/cannot do and when, so it never contradicts
   *                          the buttons gated for that viewer.
   * @returns {{ phase: string, subLabel: string, label: string, reason: string, activeWindow: string }}
   *   - phase: one of PHASE.* (the timeline bucket).
   *   - label: short human phase label for the badge/timeline.
   *   - subLabel: resolved kind ('' while pending).
   *   - reason: a full sentence — what state it's in and, when no action is
   *     available to the viewer, WHY and WHEN it changes.
   *   - activeWindow: which timeline step to highlight (same vocabulary as the
   *     pending phases; '' once resolved so no step is highlighted).
   */
  function phaseFor(timing, status, now, viewerRole) {
    const s = Number(status);
    const t = timing || {};
    const concessionDeadline = Number(t.concessionDeadline || 0);
    // T0: concessionDeadline === rulingWindowStart on-chain. Prefer
    // concessionDeadline; fall back to rulingWindowStart if only it was provided.
    const T0 = concessionDeadline || Number(t.rulingWindowStart || 0);
    const rulingDeadline = Number(t.rulingDeadline || 0);
    const n = Number(now);
    const role = (viewerRole === ROLES.POSTER || viewerRole === ROLES.CHALLENGER || viewerRole === ROLES.JUDGE)
      ? viewerRole : ROLES.BYSTANDER;

    // Terminal states first — timing no longer drives anything.
    if (s !== 0) {
      const info = RESOLVED_INFO[s] || { sub: 'unknown', reason: 'Resolved: this challenge is no longer pending.' };
      return {
        phase: PHASE.RESOLVED,
        label: 'Resolved',
        subLabel: info.sub,
        reason: info.reason,
        activeWindow: '',
      };
    }

    // Pending, but the per-challenge timing reads did not load. For a REAL
    // challenge T0 == ts + acceptanceDelay > 0 and rulingDeadline == T0 +
    // rulingBuffer > 0 ALWAYS (and rulingDeadline >= T0), so a non-positive T0 /
    // rulingDeadline (or rulingDeadline < T0) can only mean the timing is
    // UNAVAILABLE — not that any window has passed. Without timing we cannot tell
    // concession from ruling from timeout, so we MUST NOT fall through to the
    // (now > rulingDeadline) timeout-claimable branch below, which with
    // rulingDeadline == 0 would falsely declare the timeout refund claimable and
    // could push the viewer into a claimTimeout that reverts on-chain. Bail out
    // with an honest, role-independent "timing not loaded; retry" reason that
    // claims no window has passed and no action is available.
    if (!(T0 > 0) || !(rulingDeadline > 0) || rulingDeadline < T0) {
      return {
        phase: PHASE.TIMING_UNAVAILABLE,
        label: 'Pending',
        subLabel: '',
        reason: 'This challenge is still pending, but its on-chain timing could not be loaded, '
          + 'so the current phase and which actions are available cannot be determined right now — '
          + 'please refresh or retry. No window has expired and no timeout refund is available based on this view.',
        activeWindow: '',
      };
    }

    // Pending. Exactly two adjacent sub-phases meeting at T0, then timeout.
    // concession: [.., T0)  ruling: [T0, rulingDeadline]  timeout: (rulingDeadline, ..).
    // now == T0 is RULING (see boundary note at top). There is no gap phase.
    if (n < T0) {
      return {
        phase: PHASE.PENDING_CONCESSION,
        label: 'Concession',
        subLabel: '',
        reason: concessionReason(role, T0, rulingDeadline),
        activeWindow: PHASE.PENDING_CONCESSION,
      };
    }

    if (n <= rulingDeadline) {
      // posterCanConcede mirrors the on-chain concede gate (now <= concessionDeadline);
      // only true at exactly T0, where the concede button is still rendered.
      const posterCanConcede = n <= concessionDeadline;
      return {
        phase: PHASE.PENDING_RULING,
        label: 'Ruling',
        subLabel: '',
        reason: rulingReason(role, T0, rulingDeadline, posterCanConcede),
        activeWindow: PHASE.PENDING_RULING,
      };
    }

    // now > rulingDeadline — the judge missed the ruling window.
    return {
      phase: PHASE.TIMEOUT_CLAIMABLE,
      label: 'Timeout',
      subLabel: '',
      reason: timeoutReason(role, rulingDeadline),
      activeWindow: PHASE.TIMEOUT_CLAIMABLE,
    };
  }

  return { phaseFor, PHASE, ROLES };
});
