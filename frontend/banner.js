// banner.js — PURE, importable BOND-level lifecycle/role banner shared by the
// SimpleBond v0.6 frontend (frontend/index.html and frontend/v6/index.html).
//
// Why this file exists: the bond-detail page renders a stack of action cards
// (poster controls, judge controls, the challenge form, the refunds affordance)
// each gated on the SAME derived flags — isPoster, isJudgeOperator, canChallenge
// — plus the bond's lifecycle fields (settled, closed, pendingCount). A visitor
// had to infer the bond's state and THEIR available moves by scanning those raw
// fields and scattered cards. bondBanner() collapses that into ONE plain-language
// sentence at the top of the page: what lifecycle the bond is in (open / disputed
// / closed / settled) and what the viewer can do next.
//
// SINGLE SOURCE OF TRUTH: bondBanner() takes the ALREADY-COMPUTED gating flags as
// inputs — it does NOT recompute role or state any differently than the cards do.
// Pass it the very same isPoster / isJudgeOperator / canChallenge and the bond's
// { settled, closed, pendingCount } that gate the buttons below. Because the
// headline is derived from those identical inputs, the banner can never claim an
// action the cards would not render (e.g. it never says "you can challenge" unless
// canChallenge is true, never says "rule or reject" unless isJudgeOperator is true
// on a non-settled bond, and a settled bond never advertises any pending move).
//
// It is deliberately DOM-free and chain-free (no reads, no Date.now, no ethers) so
// it can be unit-tested directly from node. It is loaded as a plain <script> in the
// browser (exposing window.bondBanner) and required() in tests (module.exports),
// mirroring frontend/phase.js and frontend/refunds.js.
//
// LIFECYCLE TRUTH (verified against SimpleBondV6.sol + renderBondDetailRpc):
//   - settled === true  -> the bond is resolved; NO new challenges, NO poster/judge
//     moves render (poster + judge cards are gated on `!settled`). Terminal.
//   - closed === true (and not settled) -> the poster closed the bond: no NEW
//     challenges can be filed (canChallenge requires !closed), but any challenges
//     already pending STILL resolve. Crucially the judge keeps FULL power on a
//     closed bond: ruleForPoster/ruleForChallenger during the ruling window and
//     rejectChallenge (out-of-scope) at ANY time while a challenge is Pending —
//     none of those are gated on !closed, only on !settled + Pending. So a CLOSED
//     bond with pendingCount > 0 still renders the judge's per-challenge rule/reject
//     buttons (frontend/index.html challengeHtml gates them on isJudgeOperator, NOT
//     on !closed) and the Judge-controls card (gated on isJudgeOperator && !settled).
//   - pendingCount > 0 (open, not closed) -> "disputed": challenges are in flight.
//   - otherwise -> "open": accepting challenges, none yet.
// The poster card lets the poster modify the claim (only when pendingCount === 0)
// and open/close the bond while !settled; canChallenge already encodes
// !isPoster && !settled && !closed && pendingCount < maxChallenges, so the
// challenger-eligible viewerRole derives straight from it.
//
// CRITICAL: the lifecycle LABEL (the data-state badge) uses the precedence
// settled > closed > disputed > open, so a closed bond with pending challenges is
// labelled "closed" (matching the badge). But the viewer's NEXT-MOVE clause must
// NOT be keyed off that label — it must be keyed off ACTUAL ACTIONABILITY (the
// same flags + pendingCount the cards key off), so a CLOSED bond with pending
// challenges still tells the judge they can rule/reject. The next-move clause is
// true IFF the corresponding card/button renders.
//
// TIMING-AWARENESS (the per-challenge cards are gated on the ruling window, so the
// banner must be too): the judge's Rule buttons render ONLY when a Pending
// challenge is inside [rulingWindowStart, rulingDeadline]; reject-as-out-of-scope
// renders at ANY pending instant. The caller computes judgeCanRuleSomePending
// (true iff ANY pending challenge is rulable now) from the SAME timing the cards
// read, and passes it in. The judge clause then says "rule or reject…" only when
// some challenge is rulable, and "reject … out-of-scope (the ruling window is not
// open right now)" when challenges are pending but none is rulable (concession
// window OR past the ruling deadline) — never over-claiming "rule". Likewise the
// bystander "anyone can challenge" line is gated on hasChallengeCapacity so a
// capacity-full (but still-labelled-open) v6 bond does not advertise a challenge
// the (hidden) Challenge card refuses.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;            // node: require('.../banner.js')
  }
  if (root) {
    root.bondBanner = api.bondBanner;   // browser: window.bondBanner(...)
    root.BANNER_STATE = api.BANNER_STATE;
    root.BANNER_ROLE = api.BANNER_ROLE;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  // The four mutually-exclusive lifecycle states, derived from the SAME
  // settled/closed/pendingCount the status badge and action cards use.
  const BANNER_STATE = Object.freeze({
    OPEN: 'open',
    DISPUTED: 'disputed',
    CLOSED: 'closed',
    SETTLED: 'settled',
  });

  // The viewer's role, derived from the SAME isPoster/isJudgeOperator/canChallenge
  // the cards key off. Priority poster > judge > challenger-eligible > bystander,
  // matching the viewerRole precedence used for the per-challenge phase reasons.
  const BANNER_ROLE = Object.freeze({
    POSTER: 'poster',
    JUDGE: 'judge',
    CHALLENGER_ELIGIBLE: 'challenger-eligible',
    BYSTANDER: 'bystander',
  });

  // Coerce a possibly-bigint / string count to a plain non-negative Number.
  function countOf(x) {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  // Lifecycle classification — IDENTICAL precedence to renderBondDetailRpc's
  // statusName: settled wins, then closed, then pendingCount>0 (disputed), else open.
  function classifyState(settled, closed, pendingCount) {
    if (settled) return BANNER_STATE.SETTLED;
    if (closed) return BANNER_STATE.CLOSED;
    if (pendingCount > 0) return BANNER_STATE.DISPUTED;
    return BANNER_STATE.OPEN;
  }

  // Viewer-role classification — straight from the already-computed flags, same
  // precedence the detail view uses (poster first, then judge, then a viewer who
  // can challenge, else a bystander). canChallenge already encodes
  // !isPoster && !settled && !closed && room-for-more, so a SETTLED or CLOSED bond
  // can never yield challenger-eligible here.
  function classifyRole(isPoster, isJudgeOperator, canChallenge) {
    if (isPoster) return BANNER_ROLE.POSTER;
    if (isJudgeOperator) return BANNER_ROLE.JUDGE;
    if (canChallenge) return BANNER_ROLE.CHALLENGER_ELIGIBLE;
    return BANNER_ROLE.BYSTANDER;
  }

  // The lifecycle clause — one phrase describing the bond's state, role-agnostic.
  function lifecycleClause(state, pendingCount) {
    switch (state) {
      case BANNER_STATE.SETTLED:
        return 'Settled — this bond is resolved.';
      case BANNER_STATE.CLOSED:
        return 'Closed — no new challenges; existing disputes still resolve.';
      case BANNER_STATE.DISPUTED:
        return `Disputed — ${pendingCount} challenge${pendingCount === 1 ? '' : 's'} pending.`;
      case BANNER_STATE.OPEN:
      default:
        return 'Open — no challenges yet.';
    }
  }

  // The viewer next-move clause — what THIS viewer can ACTUALLY do, derived from
  // the raw actionability flags + pendingCount (NOT from the state LABEL). Returns
  // '' when the viewer has no bond-level move, so the headline is just the lifecycle
  // clause. Each branch is true IFF the corresponding card/button renders.
  //
  // Why this takes the raw flags rather than the state label: the label uses the
  // precedence settled > closed > disputed > open, so a closed bond that still has
  // pending challenges is labelled "closed" — but the judge's rule/reject buttons
  // STILL render on it (gated on isJudgeOperator + Pending, not on !closed). Keying
  // the clause off the label would (and previously DID) tell the judge of a closed
  // bond "no challenges are pending to rule on", which is false and contradicts the
  // lifecycle clause "existing disputes still resolve". So we key off actionability.
  //
  // @param {string}  state          the lifecycle LABEL (only used for poster/bystander
  //                                  wording, never to suppress an available action)
  // @param {string}  role           the viewer's role (the SAME precedence the cards use)
  // @param {object}  act            actionability derived from the SAME inputs the cards use
  // @param {boolean} act.settled    terminal — no controls render for anyone
  // @param {number}  act.pendingCount pending challenges in flight
  // @param {boolean} act.canChallenge SAME flag that gates the challenge card
  // @param {boolean} act.judgeCanRuleSomePending  TRUE iff at least one Pending
  //   challenge is currently in its ruling window (now in [rulingWindowStart,
  //   rulingDeadline]) — the SAME timing gate the per-challenge Rule buttons use.
  //   When false but pendingCount > 0, the judge can ONLY reject-as-out-of-scope
  //   (no Rule buttons render), so the banner must not over-claim "rule".
  // @param {boolean} act.hasChallengeCapacity  SAME version-aware gate (frontend/
  //   challenge-capacity.js) that decides whether ANOTHER challenge may be filed.
  //   When false on an OPEN bond, capacity is full and the Challenge card is hidden,
  //   so the bystander banner must not claim "anyone can challenge".
  function nextMoveClause(state, role, act) {
    // Terminal: a settled bond renders no poster/judge/challenge controls at all,
    // so NO role gets a next-move clause — the banner cannot advertise a move the
    // cards refuse to render. (Belt-and-braces: the per-role branches below also
    // never fire once settled, but classifyState already maps settled -> SETTLED.)
    if (act.settled) return '';

    const pendingCount = act.pendingCount;

    switch (role) {
      case BANNER_ROLE.POSTER:
        // Poster card is gated on !settled and renders on open/closed/disputed.
        // OPEN: poster can modify the claim (pendingCount === 0) or close it.
        if (state === BANNER_STATE.OPEN) {
          return 'Your bond is open; you can modify the claim or close it.';
        }
        // CLOSED: poster can reopen (reopen requires pendingCount === 0; with
        // pending challenges the card still shows close/reopen affordances, and the
        // pending disputes resolve below). We phrase the durable affordance + the
        // fact that pending disputes still resolve.
        if (state === BANNER_STATE.CLOSED) {
          if (pendingCount > 0) {
            return `You closed this bond; ${pendingCount} pending challenge${pendingCount === 1 ? '' : 's'} still resolve${pendingCount === 1 ? 's' : ''} below.`;
          }
          return 'You closed this bond; you can reopen it.';
        }
        // DISPUTED (open + pending): the poster can close the bond or wait.
        return `Your bond has ${pendingCount} pending challenge${pendingCount === 1 ? '' : 's'}; close the bond or wait for each to resolve below.`;
      case BANNER_ROLE.JUDGE:
        // The judge's per-challenge moves are TIMING-AWARE — exactly like the
        // per-challenge cards. A Rule button renders ONLY when a Pending challenge
        // is inside its ruling window (now in [rulingWindowStart, rulingDeadline]);
        // reject-as-out-of-scope renders at ANY pending instant (no timing gate).
        // So the banner must mirror that, NOT just say "rule" whenever pending>0:
        //   - judgeCanRuleSomePending -> at least one challenge is rulable now:
        //     "rule or reject each pending challenge below".
        //   - else, pending>0 (concession window OR past the ruling deadline): the
        //     ONLY judge move is reject-out-of-scope; do NOT promise "rule".
        //   - else (nothing pending): no per-challenge move at all.
        // This is keyed off ACTUAL ACTIONABILITY (timing + pendingCount), still
        // REGARDLESS of the closed label (rejectChallenge ignores !closed).
        if (pendingCount > 0) {
          if (act.judgeCanRuleSomePending) {
            return `You are the judge; rule or reject each pending challenge below.`;
          }
          return 'You are the judge; reject pending challenges as out-of-scope (the ruling window is not open right now).';
        }
        // Nothing pending (open or closed with 0 pending): no per-challenge ruling
        // to do — the per-challenge buttons render only for Pending challenges.
        return 'You are the judge; no challenges are pending.';
      case BANNER_ROLE.CHALLENGER_ELIGIBLE:
        // canChallenge is true only on a non-closed, non-settled bond with room —
        // i.e. exactly OPEN or DISPUTED here. The challenge card IS rendered.
        return 'You can challenge this claim.';
      case BANNER_ROLE.BYSTANDER:
      default:
        // A non-eligible onlooker. On an open bond anyone (other than the poster)
        // could in principle challenge — BUT only when there is still capacity.
        // On a v6 bond at its TOTAL-EVER maxChallenges cap (pendingCount may be 0,
        // so the state label is still "open"), the Challenge card is hidden, so the
        // banner must NOT claim "anyone can challenge". Gate on the SAME version-
        // aware hasChallengeCapacity the card uses (BONUS, same class as the JUDGE
        // over-claim). When capacity is full, fall through to no next-move clause.
        if (state === BANNER_STATE.OPEN && act.hasChallengeCapacity) return 'Anyone can challenge this claim.';
        return '';
    }
  }

  /**
   * Pure bond-level lifecycle/role banner.
   *
   * @param {object} input
   * @param {boolean} input.settled          bond.settled (terminal once true)
   * @param {boolean} input.closed           bond.closed (poster closed it)
   * @param {number}  input.pendingCount     bond.pendingCount (challenges in flight)
   * @param {boolean} input.isPoster         SAME flag that gates the poster card
   * @param {boolean} input.isJudgeOperator  SAME flag that gates the judge controls
   * @param {boolean} input.canChallenge     SAME flag that gates the challenge card
   * @param {boolean} [input.judgeCanRuleSomePending]  TRUE iff at least one Pending
   *   challenge is currently rulable (now in its [rulingWindowStart, rulingDeadline]
   *   window) — the SAME timing gate the per-challenge Rule buttons use. Default
   *   false. When pending>0 but this is false, the judge can ONLY reject-as-out-of-
   *   scope, so the banner says so instead of promising "rule".
   * @param {boolean} [input.hasChallengeCapacity]  TRUE iff another challenge may be
   *   filed under the active chain's rule (the SAME version-aware gate the Challenge
   *   card uses). Default true (back-compat: callers that don't pass it keep the old
   *   "Anyone can challenge" wording). On an OPEN-but-capacity-full bond, pass false
   *   so the bystander banner does not claim "anyone can challenge".
   * @returns {{ state: string, viewerRole: string, headline: string }}
   *   - state: one of BANNER_STATE.* (the lifecycle bucket; identical mapping to
   *     the status badge).
   *   - viewerRole: one of BANNER_ROLE.* (derived from the gating flags, same
   *     precedence as the cards).
   *   - headline: one plain-language sentence = lifecycle clause + (when the
   *     viewer has a bond-level move) the viewer's next-move clause. Never names
   *     an action the cards would not render for this state/viewer.
   */
  function bondBanner(input) {
    const s = input || {};
    const settled = !!s.settled;
    const closed = !!s.closed;
    const pendingCount = countOf(s.pendingCount);
    const isPoster = !!s.isPoster;
    const isJudgeOperator = !!s.isJudgeOperator;
    const canChallenge = !!s.canChallenge;
    const judgeCanRuleSomePending = !!s.judgeCanRuleSomePending;
    // hasChallengeCapacity defaults to TRUE for back-compat: a caller that omits it
    // keeps the legacy "Anyone can challenge" wording on an open bond. Only an
    // explicit false (capacity full) suppresses it.
    const hasChallengeCapacity = s.hasChallengeCapacity === undefined ? true : !!s.hasChallengeCapacity;

    const state = classifyState(settled, closed, pendingCount);
    const viewerRole = classifyRole(isPoster, isJudgeOperator, canChallenge);

    const lifecycle = lifecycleClause(state, pendingCount);
    // The next-move clause is derived from ACTUAL ACTIONABILITY (settled +
    // pendingCount + ruling-window timing + canChallenge + capacity), NOT from the
    // state label, so a closed bond with pending challenges still tells the judge
    // they can rule/reject. `state` is passed only for poster/bystander phrasing,
    // never to suppress an available move.
    const nextMove = nextMoveClause(state, viewerRole, {
      settled,
      pendingCount,
      canChallenge,
      judgeCanRuleSomePending,
      hasChallengeCapacity,
    });
    const headline = nextMove ? `${lifecycle} ${nextMove}` : lifecycle;

    return { state, viewerRole, headline };
  }

  return { bondBanner, BANNER_STATE, BANNER_ROLE };
});
