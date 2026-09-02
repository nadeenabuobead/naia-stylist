// app/routes/buyskip-phase-b.test.ts
// Phase B — Buy/Skip Outcome UX source-contract tests.
//
// Covers tests B, C, D, E, F, J, K, L, N, O from the Phase B spec.
// All checks are static source-reads — no DB, no network, no React render.
//
// Run: node --test --import tsx/esm app/routes/buyskip-phase-b.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readSrc(relPath: string): string {
  return readFileSync(join(__dirname, relPath), "utf8");
}

const resultPage = () => readSrc("buyskip.$id.tsx");
const decisionsPage = () => readSrc("my-naia.buying-decisions.tsx");

// ─── B: No Outcome row created by page view ───────────────────────────────────

describe("B — loader does not auto-create an Outcome", () => {
  it("buyskip.$id.tsx loader does not call buySkipOutcome.create or buySkipOutcome.upsert", () => {
    const src = resultPage();
    // Extract just the loader function — stops before the component
    const loaderStart = src.indexOf("export async function loader");
    const loaderEnd = src.indexOf("\nexport default function", loaderStart);
    const loaderBody = loaderEnd !== -1 ? src.slice(loaderStart, loaderEnd) : src.slice(loaderStart, loaderStart + 3000);
    assert.ok(
      !loaderBody.includes("buySkipOutcome.create") && !loaderBody.includes("buySkipOutcome.upsert"),
      "loader must never create or upsert an Outcome — page views do not generate evidence",
    );
  });

  it("outcome is loaded read-only via nested select, not written", () => {
    const src = resultPage();
    assert.ok(
      src.includes("outcome: {") && src.includes("select: {"),
      "outcome must be loaded via a nested select on the analysis query",
    );
  });
});

// ─── C: bought-it can save without post-purchase outcome ─────────────────────

describe("C — bought-it submittable without postPurchaseOutcome", () => {
  it("handleOutcomeSave only includes postPurchaseOutcome when decision is bought-it AND post is set", () => {
    const src = resultPage();
    assert.ok(
      src.includes('outcomeDecision === "bought-it" && outcomePost'),
      "postPurchaseOutcome is conditionally included — only when both bought-it and a post value exist",
    );
  });

  it("SAVE button disabled only when decision is absent, not when postPurchase is absent", () => {
    const src = resultPage();
    assert.ok(
      src.includes("disabled={!outcomeDecision || isOutcomeSaving}"),
      "SAVE button must be enabled as soon as a decision is selected (postPurchase is optional)",
    );
  });
});

// ─── D: bought-it reveals follow-up ──────────────────────────────────────────

describe("D — bought-it decision reveals post-purchase options", () => {
  it('follow-up is rendered inside {outcomeDecision === "bought-it"} conditional', () => {
    const src = resultPage();
    assert.ok(
      src.includes('outcomeDecision === "bought-it"'),
      'post-purchase follow-up must be gated on outcomeDecision === "bought-it"',
    );
    assert.ok(
      src.includes("AND HOW DID IT WORK OUT"),
      "follow-up label must be 'AND HOW DID IT WORK OUT?'",
    );
  });

  it("all three post-purchase options are present in the follow-up block", () => {
    const src = resultPage();
    assert.ok(src.includes('"love-it"'), "love-it option must be present");
    assert.ok(src.includes('"its-okay"'), "its-okay option must be present");
    assert.ok(src.includes('"returned-it"'), "returned-it option must be present");
  });
});

// ─── E/F: non-bought-it hides post-purchase ──────────────────────────────────

describe("E/F — didnt-buy-it and still-deciding hide post-purchase options", () => {
  it("selecting non-bought-it clears postPurchase state", () => {
    const src = resultPage();
    // When a non-bought-it option is clicked, setOutcomePost(null) is called
    assert.ok(
      src.includes("if (d !== \"bought-it\") setOutcomePost(null)"),
      "selecting a non-bought-it decision must clear postPurchase state",
    );
  });

  it("follow-up block is only inside the bought-it conditional — never unconditional", () => {
    const src = resultPage();
    // bos-outcome-followup must only appear inside the bought-it conditional
    const followupPos = src.indexOf("bos-outcome-followup");
    const boughtItPos = src.lastIndexOf('outcomeDecision === "bought-it"', followupPos);
    assert.ok(
      boughtItPos !== -1 && followupPos > boughtItPos,
      "bos-outcome-followup must appear after the bought-it guard, not unconditionally",
    );
  });
});

// ─── J: Update uses same row (UPSERT) ────────────────────────────────────────

describe("J — outcome update uses UPSERT not a second create", () => {
  it("api.wishlist.jsx uses buySkipOutcome.upsert for all outcome writes", () => {
    const wishlist = readSrc("api.wishlist.jsx");
    assert.ok(
      wishlist.includes("buySkipOutcome.upsert"),
      "all outcome writes use upsert — no separate create path for updates",
    );
    assert.ok(
      !wishlist.includes("buySkipOutcome.create"),
      "buySkipOutcome.create must not exist — upsert handles both first write and updates",
    );
  });
});

// ─── K: Buying Decisions shows outcome label ─────────────────────────────────

describe("K — Buying Decisions shows outcome label when outcome exists", () => {
  it("my-naia.buying-decisions.tsx includes outcome in the select query", () => {
    const src = decisionsPage();
    assert.ok(src.includes("outcome:"), "buying decisions loader must include outcome in select");
    assert.ok(
      src.includes("decision: true") && src.includes("postPurchaseOutcome: true"),
      "outcome select must fetch both decision and postPurchaseOutcome",
    );
  });

  it("buildOutcomeSummary maps all decision types to display strings", () => {
    const src = decisionsPage();
    assert.ok(src.includes("BOUGHT IT"), "BOUGHT IT label required");
    assert.ok(src.includes("DIDN'T BUY IT"), "DIDN'T BUY IT label required");
    assert.ok(src.includes("STILL DECIDING"), "STILL DECIDING label required");
  });

  it("buildOutcomeSummary concatenates post-purchase with middle dot", () => {
    const src = decisionsPage();
    assert.ok(
      src.includes("· ${POST[outcome.postPurchaseOutcome]}") ||
      src.includes("· ${POST"),
      "summary must join decision and post-purchase with ' · ' separator",
    );
  });

  it("outcomeSummary rendered in card when present", () => {
    const src = decisionsPage();
    assert.ok(
      src.includes("d.outcomeSummary") && src.includes("bos-decision-outcome"),
      "card must conditionally render outcomeSummary in bos-decision-outcome element",
    );
  });
});

// ─── L: Buying Decisions shows nothing when no outcome ───────────────────────

describe("L — Buying Decisions shows no label when outcome is absent", () => {
  it("buildOutcomeSummary returns null for null/undefined outcome", () => {
    const src = decisionsPage();
    assert.ok(
      src.includes("if (!outcome) return null"),
      "buildOutcomeSummary must return null immediately when outcome is null/undefined",
    );
  });

  it("outcomeSummary is only rendered conditionally — never unconditionally", () => {
    const src = decisionsPage();
    assert.ok(
      src.includes("{d.outcomeSummary &&"),
      "outcomeSummary must be gated: {d.outcomeSummary && ...}",
    );
  });
});

// ─── M: Verdict is not treated as Outcome ────────────────────────────────────

describe("M — verdict is never treated as outcome", () => {
  it("buying decisions page does not map verdict to outcomeSummary", () => {
    const src = decisionsPage();
    // buildOutcomeSummary must receive outcome, not verdict or analysis.verdict
    assert.ok(
      src.includes("buildOutcomeSummary(a.outcome)"),
      "outcomeSummary must be built from a.outcome, not a.verdict",
    );
    assert.ok(
      !src.includes("buildOutcomeSummary(a.verdict)"),
      "must never pass a.verdict to buildOutcomeSummary",
    );
  });

  it("result page does not derive outcome from displayVerdict", () => {
    const src = resultPage();
    // The outcome section must not reference displayVerdict or analysis.verdict
    const outcomeSection = src.slice(
      src.indexOf("bos-outcome-q"),
      src.indexOf("sp-actions"),
    );
    assert.ok(
      !outcomeSection.includes("displayVerdict"),
      "outcome section must not reference displayVerdict — verdict and outcome are separate",
    );
  });
});

// ─── N: Failed save preserves customer selection ─────────────────────────────

describe("N — failed save preserves customer's selection", () => {
  it("outcomeFetcher error path keeps outcomeDecision in state — not cleared on error", () => {
    const src = resultPage();
    // outcomeSaveError is derived from fetcher.data, not from state reset
    assert.ok(
      src.includes("outcomeSaveError") && src.includes("bos-outcome-error"),
      "save error must be displayed inline without clearing the selected decision",
    );
    // Verify no setOutcomeDecision(null) call on error
    const errorHandling = src.includes("outcomeSaveError");
    assert.ok(errorHandling, "error state must be present");
    // The decision state is never reset to null in response to an error
    const errBlock = src.indexOf("outcomeSaveError");
    const nearbyReset = src.slice(Math.max(0, errBlock - 200), errBlock + 200);
    assert.ok(
      !nearbyReset.includes("setOutcomeDecision(null)"),
      "outcomeSaveError block must not reset decision state",
    );
  });
});

// ─── O: No Profile or Closet mutation in result page ─────────────────────────

describe("O — result page and outcome save do not mutate Profile or Closet", () => {
  it("buyskip.$id.tsx does not import or call any profile/closet write function", () => {
    const src = resultPage();
    assert.ok(!src.includes("onboardingProfile.update"), "result page must not update onboardingProfile");
    assert.ok(!src.includes("closetItem"), "result page must not reference closetItem writes");
    assert.ok(!src.includes("styleProfile.update"), "result page must not update styleProfile");
    assert.ok(!src.includes("prisma.customer.update"), "result page must not update customer record");
  });

  it("my-naia.buying-decisions.tsx loader is read-only", () => {
    const src = decisionsPage();
    assert.ok(!src.includes(".create("), "buying decisions loader must not create any record");
    assert.ok(!src.includes(".update("), "buying decisions loader must not update any record");
    assert.ok(!src.includes(".delete("), "buying decisions loader must not delete any record");
    assert.ok(!src.includes(".upsert("), "buying decisions loader must not upsert any record");
  });
});
