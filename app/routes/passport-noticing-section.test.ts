// app/routes/passport-noticing-section.test.ts
//
// V1 UX restructure — "What nAia Is Noticing" moved from its own route
// (/my-naia/what-naia-notices) into a section inside Style Passport
// (/passport#noticing).
//
// Executable node:test, source-string based — same convention as
// passport-cta-state.test.ts for this large stateful component, which isn't
// otherwise unit-rendered. Run: node --test --import tsx/esm
// app/routes/passport-noticing-section.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const passportSrc = readFileSync(join(__dirname, "passport.tsx"), "utf8");
const oldRouteSrc = readFileSync(join(__dirname, "my-naia.what-naia-notices.tsx"), "utf8");
const overviewSrc = readFileSync(join(__dirname, "my-naia._index.tsx"), "utf8");

describe("Style Passport renders the Noticing section", () => {
  it("loader loads confirmed tendencies and the Passport snapshot (for the existing contradiction boundary)", () => {
    assert.ok(passportSrc.includes("loadConfirmedTendencies"), "loads confirmed tendencies");
    assert.ok(passportSrc.includes("loadPassportSnapshot"), "loads the Passport snapshot");
    assert.ok(passportSrc.includes("detectPassportContradiction"), "contradiction detection still wired");
    assert.ok(passportSrc.includes("generateObservationText"), "existing contradiction-aware text generator still wired");
  });

  it("generates the new structured interpretation via the existing tendency-copy system, not hard-coded per-customer sentences", () => {
    assert.ok(passportSrc.includes("generateNoticingInterpretation"), "uses a dimension-keyed generator");
    // The two example sentences from the spec must come from the generator
    // (taste-contract.ts), not be duplicated verbatim inside passport.tsx.
    assert.ok(!passportSrc.includes("Comfort is one of your strongest signals"), "comfort copy not hard-coded in the route");
    assert.ok(!passportSrc.includes("Feeling like yourself matters more than novelty"), "self-expression copy not hard-coded in the route");
  });

  it("the section has a stable #noticing anchor for deep-linking from Overview and the old route", () => {
    assert.ok(passportSrc.includes('id="noticing"'), "section has a #noticing anchor");
  });

  it("renders the Noticing section in BOTH overview branches (Rev6 dossier and legacy flat layout), not just one", () => {
    const occurrences = passportSrc.split("<NoticingSection").length - 1;
    assert.ok(occurrences >= 2, `expected the Noticing section rendered in both overview branches, found ${occurrences} usage(s)`);
  });

  it("uses Style Passport's own design-system classes for the section heading, not the oversized standalone-page title treatment", () => {
    const sectionDef = passportSrc.slice(
      passportSrc.indexOf("function NoticingSection"),
      passportSrc.indexOf("function NoticingSection") + 1500,
    );
    assert.ok(sectionDef.includes("sp-refresh-banner"), "reuses the existing banner-card pattern for the section intro");
    assert.ok(!sectionDef.includes("sp-shell-title"), "does not reuse the page-level oversized title class for the section heading");
  });

  it("intro copy matches the product-boundary spec — learned patterns, separate from Passport", () => {
    assert.ok(passportSrc.includes("Patterns nAia is learning from how you rate your looks"), "intro copy present");
    assert.ok(passportSrc.includes("stay separate from your Style Passport"), "separation from Passport stated explicitly");
  });
});

describe("Confirmed tendencies render inside Passport with a useful interpretation, not just raw evidence", () => {
  it("each observation card renders family label, headline, body, and a 'What nAia Is Learning' note", () => {
    const cardDef = passportSrc.slice(
      passportSrc.indexOf("function NoticingObservationCard"),
      passportSrc.indexOf("function NoticingSection"),
    );
    assert.ok(cardDef.includes("CONSISTENTLY WORKS") && cardDef.includes("RECURRING FRICTION"), "family label present");
    assert.ok(cardDef.includes("tendency.headline"), "renders the dimension-specific headline");
    assert.ok(cardDef.includes("tendency.body"), "renders the plain-English body sentence");
    assert.ok(cardDef.includes("What nAia Is Learning"), "renders the learning sub-heading");
    assert.ok(cardDef.includes("tendency.learningNote"), "renders the hedged learning note");
    assert.ok(cardDef.includes("tendency.rationaleText"), "still renders the existing evidence-count rationale");
  });

  it("the learning note is hedged, never claims it already drives StyleMe/WI/Buy-or-Skip recommendations", () => {
    // taste-contract.ts's generateNoticingInterpretation — every learningNote string.
    const contractSrc = readFileSync(join(__dirname, "../lib/ai/taste-contract.ts"), "utf8");
    const fnBlock = contractSrc.slice(contractSrc.indexOf("export function generateNoticingInterpretation"));
    const learningNotes = [...fnBlock.matchAll(/learningNote:\s*(?:`([^`]*)`|"([^"]*)")/g)].map(m => m[1] ?? m[2]);
    assert.ok(learningNotes.length >= 5, "found the dimension-specific learning notes");
    for (const note of learningNotes) {
      assert.ok(/\bmay\b|\bmight\b/i.test(note), `learning note must be hedged ("may"/"might"): "${note}"`);
      assert.ok(
        !/StyleMe|Wardrobe Intelligence|Buy.?(or.?)?Skip|recommend(s|ation)? (is|are) now|already (changes|adjusts)/i.test(note),
        `learning note must not claim a downstream engine already acts on it: "${note}"`,
      );
    }
  });

  it("Accurate / Not quite controls remain available, posting to the existing feedback endpoint", () => {
    const cardDef = passportSrc.slice(
      passportSrc.indexOf("function NoticingObservationCard"),
      passportSrc.indexOf("function NoticingSection"),
    );
    assert.ok(cardDef.includes('"/api/taste-observation-feedback"'), "posts to the existing feedback route");
    assert.ok(cardDef.includes('"accurate"') && cardDef.includes('"not-quite"'), "both feedback values still wired");
    assert.ok(cardDef.includes(">Accurate<") || cardDef.includes("Accurate\n"), "Accurate button rendered");
    assert.ok(cardDef.includes("Not quite"), "Not quite button rendered");
  });
});

describe("Not Quite — first click opens an inline form, does not submit immediately", () => {
  // Starts at the reason-options constant (declared just above the
  // component) through to NoticingSection, so this slice covers both the
  // fixed reason vocabulary and the card component itself.
  const cardDef = passportSrc.slice(
    passportSrc.indexOf("NOT_QUITE_REASON_OPTIONS"),
    passportSrc.indexOf("function NoticingSection"),
  );

  it("the Not quite button only opens the form — no fetcher.submit call on that click", () => {
    const notQuiteButtonBlock = cardDef.slice(
      cardDef.lastIndexOf("Not quite") - 400,
      cardDef.lastIndexOf("Not quite") + 20,
    );
    assert.ok(/onClick=\{\(\)\s*=>\s*setNotQuiteOpen\(true\)\}/.test(notQuiteButtonBlock), "Not quite button only sets notQuiteOpen, it does not submit");
    assert.ok(!/onClick=\{.*submitNotQuite/.test(notQuiteButtonBlock), "Not quite button itself must not call submitNotQuite directly");
  });

  it("the inline form renders only when notQuiteOpen is true", () => {
    assert.ok(cardDef.includes("notQuiteOpen"), "component tracks notQuiteOpen state");
    assert.ok(cardDef.includes("What Feels Off?") || cardDef.includes("What feels off?"), "inline form heading present");
  });

  it("renders all 5 required reason options", () => {
    for (const label of ["Doesn't feel like me", "Only true sometimes", "Depends on the situation", "Used to be true", "Something else"]) {
      assert.ok(cardDef.includes(label), `reason option "${label}" present`);
    }
  });

  it("renders the optional note field with the specified copy", () => {
    assert.ok(cardDef.includes("Anything you want nAia to know?"), "note prompt present");
    assert.ok(cardDef.includes("Optional"), "marked optional");
    assert.ok(cardDef.includes("<textarea"), "a text input for the note exists");
  });

  it("Cancel resets state and closes the form without calling submitNotQuite", () => {
    const cancelFnBody = cardDef.slice(cardDef.indexOf("function cancelNotQuite"), cardDef.indexOf("function cancelNotQuite") + 300);
    assert.ok(!cancelFnBody.includes("submitNotQuite"), "cancelNotQuite must never submit");
    assert.ok(cancelFnBody.includes("setNotQuiteOpen(false)"), "closes the form");
  });

  it("Send Feedback submits not-quite with the selected reason and note", () => {
    assert.ok(cardDef.includes("submitNotQuite({ reason: selectedReason, note })"), "Send Feedback passes the selected reason + note through");
  });

  it("Skip Details submits a plain not-quite with no details", () => {
    assert.ok(cardDef.includes("submitNotQuite()"), "Skip Details calls submitNotQuite with no arguments");
  });

  it("Accurate still submits immediately on click — no gating state involved", () => {
    const accurateButtonBlock = cardDef.slice(cardDef.lastIndexOf("submitAccurate") - 300, cardDef.lastIndexOf("submitAccurate") + 20);
    assert.ok(/onClick=\{submitAccurate\}/.test(accurateButtonBlock), "Accurate button calls submitAccurate directly, unchanged");
  });

  it("successful not-quite still resolves through the existing savedFeedback mechanism — same confirmation branch, new copy", () => {
    assert.ok(cardDef.includes('savedFeedback === "not-quite"'), "reuses the exact same post-submission detection already used before this feature");
    assert.ok(cardDef.includes("Got it — nAia will be more cautious with this observation."), "new confirmation copy present");
    assert.ok(!cardDef.includes("Noted — nAia won't show this again."), "old abrupt copy removed");
  });
});

describe("No confirmed observations → compact Still Learning state, not an empty page", () => {
  it("renders the compact copy inline inside the section, never a separate empty page", () => {
    const sectionDef = passportSrc.slice(
      passportSrc.indexOf("function NoticingSection"),
      passportSrc.indexOf("function NoticingSection") + 2500,
    );
    assert.ok(sectionDef.includes("Still learning") || sectionDef.includes("STILL LEARNING"), "still-learning label present");
    assert.ok(
      sectionDef.includes("Keep rating your looks and telling nAia what worked"),
      "still-learning copy present",
    );
    assert.ok(sectionDef.includes("candidateCount > 0"), "distinguishes the 'accumulating' state from the empty state");
  });
});

describe("Old /my-naia/what-naia-notices route redirects safely, does not duplicate the UI", () => {
  it("loader redirects into Style Passport's Noticing section rather than rendering its own page", () => {
    assert.ok(/redirect\(\s*["']\/passport#noticing["']\s*\)/.test(oldRouteSrc), "redirects to /passport#noticing");
    assert.ok(oldRouteSrc.includes("requireCurrentNaiaCustomer"), "still gated behind the normal session");
  });

  it("no longer imports the taste engine or duplicates the observation UI", () => {
    assert.ok(!oldRouteSrc.includes("loadConfirmedTendencies"), "no longer reads tendency data directly");
    assert.ok(!oldRouteSrc.includes("ObservationCard"), "no longer renders its own observation cards");
  });
});

describe("Overview — Noticing preview kept, heading/CTA updated (Style Passport is the full destination)", () => {
  it("heading reads 'What nAia Is Noticing' (confirmed-only), not the old 'Beginning To Notice' wording", () => {
    assert.ok(overviewSrc.includes("What nAia Is Noticing"), "updated heading present");
    assert.ok(!overviewSrc.includes("What nAia Is Beginning To Notice"), "old heading removed");
  });

  it("exactly one CTA, linking into Style Passport's Noticing section — the old dual CTAs are gone", () => {
    const sectionStart = overviewSrc.indexOf("{/* What nAia Is Noticing");
    const sectionEnd = overviewSrc.indexOf("{/* Latest Trend Edit");
    const section = overviewSrc.slice(sectionStart, sectionEnd);
    const ctaCount = (section.match(/mn-see-link/g) ?? []).length;
    assert.equal(ctaCount, 1, "exactly one CTA in this section");
    assert.ok(section.includes('to="/passport#noticing"'), "CTA links into Style Passport's Noticing section");
    assert.ok(!section.includes("/my-naia/what-naia-notices"), "no remaining link to the old standalone route");
    assert.ok(!section.includes("View all observations"), "redundant second CTA text removed");
  });

  it("no confirmed or candidate observations → the existing compact learning-state copy still renders, not a broken teaser", () => {
    const sectionStart = overviewSrc.indexOf("{/* What nAia Is Noticing");
    const sectionEnd = overviewSrc.indexOf("{/* Latest Trend Edit");
    const section = overviewSrc.slice(sectionStart, sectionEnd);
    assert.ok(section.includes("mn-state-note"), "compact state-note style still used for the empty/accumulating states");
    assert.ok(section.includes("hasCandidates"), "still distinguishes accumulating vs. no-evidence-yet");
  });

  it("uses the same pure interpretation helper Style Passport uses — not a second, divergent generator", () => {
    assert.ok(overviewSrc.includes("generateNoticingInterpretation"), "Overview calls the same taste-contract.ts helper");
    assert.ok(overviewSrc.includes("strongestTendency.headline"), "renders the generated headline");
    assert.ok(overviewSrc.includes("strongestTendency.body"), "renders the generated body");
  });

  it("no longer renders 'Style Intelligence' — ambiguous with Wardrobe Intelligence", () => {
    const sectionStart = overviewSrc.indexOf("{/* What nAia Is Noticing");
    const sectionEnd = overviewSrc.indexOf("{/* Latest Trend Edit");
    const section = overviewSrc.slice(sectionStart, sectionEnd);
    assert.ok(!/style intelligence/i.test(section), "'Style Intelligence' label removed from the teaser");
  });

  it("uses the same observation-family label Passport uses (Consistently Works / Recurring Friction)", () => {
    const sectionStart = overviewSrc.indexOf("{/* What nAia Is Noticing");
    const sectionEnd = overviewSrc.indexOf("{/* Latest Trend Edit");
    const section = overviewSrc.slice(sectionStart, sectionEnd);
    assert.ok(/consistently works/i.test(section), "WORKS_WELL family label present");
    assert.ok(/recurring friction/i.test(section), "FRICTION family label present");
  });

  it("does not render What nAia Is Learning or Accurate/Not quite — those stay in Style Passport only", () => {
    const sectionStart = overviewSrc.indexOf("{/* What nAia Is Noticing");
    const sectionEnd = overviewSrc.indexOf("{/* Latest Trend Edit");
    const section = overviewSrc.slice(sectionStart, sectionEnd);
    assert.ok(!/what na?ia is learning/i.test(section), "no 'What nAia Is Learning' in the Overview preview");
    assert.ok(!section.includes(">Accurate<"), "no Accurate control in the Overview preview");
    assert.ok(!/>Not quite</.test(section), "no Not quite control in the Overview preview");
  });
});
