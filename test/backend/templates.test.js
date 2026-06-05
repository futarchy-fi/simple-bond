// Backlog #7: every event in EVENT_RECIPIENTS is something we actually notify a
// user about, so each MUST have friendly copy in templates.eventEmail() — never
// the bare "Event: <Name>" fallback. Before this, ClaimModified / ChallengeRejected
// / BondClosed / BondOpened were notified but undescribed, so subscribers (once
// email is enabled) would have received "Event: ChallengeRejected" etc. This test
// pins the invariant: no notified event may render the fallback.
//
// Both modules are ESM (.mjs); load them via dynamic import (same pattern as
// processGuards.test.js).
const { expect } = require("chai");

let templates, config;
before(async () => {
  templates = await import("../../backend/templates.mjs");
  config = await import("../../backend/config.mjs");
});

describe("backend email templates — every notified event has friendly copy (backlog #7)", function () {
  const BOND_ID = 42;
  const CHAIN_ID = 1; // mainnet, present in CHAIN_NAMES
  const METADATA = "Our Q2 report contains no material misstatements.";
  const ADDRESS = "0x1111111111111111111111111111111111111111";

  it("EVENT_RECIPIENTS is a non-empty map (sanity)", function () {
    expect(config.EVENT_RECIPIENTS).to.be.an("object");
    expect(Object.keys(config.EVENT_RECIPIENTS).length).to.be.greaterThan(0);
  });

  it("no notified event renders the bare 'Event: <Name>' fallback", function () {
    const offenders = [];
    for (const eventType of Object.keys(config.EVENT_RECIPIENTS)) {
      const { subject, html } = templates.eventEmail(eventType, BOND_ID, CHAIN_ID, METADATA, ADDRESS);
      // The fallback is `Event: ${eventType}` injected into the <p> description.
      // The word "Event" legitimately appears in the details table label, so we
      // specifically forbid the description-fallback string for this event.
      if (html.includes(`Event: ${eventType}`)) offenders.push(eventType);
      expect(subject, `subject for ${eventType}`).to.include(String(BOND_ID));
    }
    expect(offenders, `events still using the bare fallback: ${offenders.join(", ")}`).to.deep.equal([]);
  });

  it("the four previously-undescribed events now have specific copy", function () {
    for (const eventType of ["ClaimModified", "ChallengeRejected", "BondClosed", "BondOpened"]) {
      const { html } = templates.eventEmail(eventType, BOND_ID, CHAIN_ID, METADATA, ADDRESS);
      expect(html, `${eventType} must not use the fallback`).to.not.include(`Event: ${eventType}`);
      // Each carries a real, human <strong>-emphasised phrase in the description.
      expect(html, `${eventType} should have an emphasised description`).to.include("<strong>");
    }
  });

  it("rendered emails carry the View Bond link and an unsubscribe link", function () {
    const { html } = templates.eventEmail("ChallengeRejected", BOND_ID, CHAIN_ID, METADATA, ADDRESS);
    expect(html).to.include(`bond=${BOND_ID}`);
    expect(html).to.include("View Bond");
    expect(html).to.include("unsubscribe");
  });
});
