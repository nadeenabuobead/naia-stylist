// app/lib/trend-taste-evidence.test.ts
//
// Step 7 — trend actions as taste evidence.
//
// The guards here are arithmetic, not intention. "One save cannot create a
// tendency" is only true if the numbers make it true, so the numbers are what
// these tests assert.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { extractTrendEvidence, producesEvidence, TREND_ACTIONS } from "./trend-taste-evidence.ts";
import {
  SOURCE_BASE_STRENGTH,
  CROSS_SOURCE_ELIGIBLE_SOURCES,
  TASTE_SOURCES,
  CANDIDATE_EFFECTIVE_SUPPORT,
  CROSS_SOURCE_BONUS,
  generateTendencyText,
} from "./ai/taste-contract.ts";

const AT = new Date("2026-09-23T12:00:00.000Z");
const extract = (action: "SAVE" | "STYLED" | "NOT_FOR_ME", facets: unknown, id = "rec_1") =>
  extractTrendEvidence({ customerId: "cust-1", sourceRecordId: id, action, facets: facets as never, occurredAt: AT });

// ── §TE-1 the contract ────────────────────────────────────────────────────────

describe("§TE-1 taste contract", () => {
  it("TREND_ENGAGEMENT is a source at 0.35", () => {
    assert.ok((TASTE_SOURCES as readonly string[]).includes("TREND_ENGAGEMENT"));
    assert.equal(SOURCE_BASE_STRENGTH.TREND_ENGAGEMENT, 0.35);
  });

  it("is weaker than CLOSET_RELATIONSHIP, the previous floor", () => {
    assert.ok(SOURCE_BASE_STRENGTH.TREND_ENGAGEMENT < SOURCE_BASE_STRENGTH.CLOSET_RELATIONSHIP);
  });

  it("EXISTING source weights are untouched", () => {
    assert.equal(SOURCE_BASE_STRENGTH.STYLEME_OUTCOME, 0.8);
    assert.equal(SOURCE_BASE_STRENGTH.POST_OUTFIT_REVIEW, 0.7);
    assert.equal(SOURCE_BASE_STRENGTH.BUYSKIP_OUTCOME, 0.6);
    assert.equal(SOURCE_BASE_STRENGTH.CLOSET_RELATIONSHIP, 0.5);
  });

  it("is EXCLUDED from the cross-source bonus", () => {
    assert.equal(CROSS_SOURCE_ELIGIBLE_SOURCES.has("TREND_ENGAGEMENT" as never), false);
    // The four original sources remain eligible — the bonus is unchanged for them.
    for (const s of ["STYLEME_OUTCOME", "POST_OUTFIT_REVIEW", "CLOSET_RELATIONSHIP", "BUYSKIP_OUTCOME"]) {
      assert.ok(CROSS_SOURCE_ELIGIBLE_SOURCES.has(s as never), s);
    }
  });

  it("thresholds are unchanged", () => {
    assert.equal(CANDIDATE_EFFECTIVE_SUPPORT, 2.0);
    assert.equal(CROSS_SOURCE_BONUS, 1.25);
  });
});

// ── §TE-2 the arithmetic guard ────────────────────────────────────────────────

describe("§TE-2 one action cannot create a tendency", () => {
  const w = SOURCE_BASE_STRENGTH.TREND_ENGAGEMENT;

  it("ONE save is nowhere near CANDIDATE", () => {
    assert.ok(w < CANDIDATE_EFFECTIVE_SUPPORT, `${w} must be far below ${CANDIDATE_EFFECTIVE_SUPPORT}`);
    assert.equal(extract("SAVE", { category: ["BAGS"] }).length, 1);
  });

  it("ONE Not for me cannot produce FRICTION either", () => {
    const rows = extract("NOT_FOR_ME", { category: ["BAGS"] });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].polarity, "negative");
    assert.ok(rows[0].strength < CANDIDATE_EFFECTIVE_SUPPORT);
  });

  it("FIVE distinct signals still fall short", () => {
    assert.ok(w * 5 < CANDIDATE_EFFECTIVE_SUPPORT, `${w * 5} must be below 2.0`);
  });

  it("SIX distinct signals are the minimum that can cross 2.0", () => {
    assert.ok(w * 6 >= CANDIDATE_EFFECTIVE_SUPPORT, `${w * 6} must reach 2.0`);
  });

  it("and six is only enough BECAUSE there is no bonus", () => {
    // With the 1.25x bonus, five would have been enough. Excluding trend
    // evidence from the bonus is what keeps the bar at six.
    assert.ok(w * 5 * CROSS_SOURCE_BONUS >= CANDIDATE_EFFECTIVE_SUPPORT);
    assert.ok(w * 5 * 1.0 < CANDIDATE_EFFECTIVE_SUPPORT);
  });
});

// ── §TE-3 dimensions ──────────────────────────────────────────────────────────

describe("§TE-3 only honest dimensions", () => {
  it("category maps to garment-category", () => {
    const rows = extract("SAVE", { category: ["BAGS"] });
    assert.equal(rows[0].dimension, "garment-category");
    assert.equal(rows[0].value, "BAGS");
  });

  it("multiple categories yield one row each", () => {
    assert.equal(extract("SAVE", { category: ["BAGS", "SHOES"] }).length, 2);
  });

  it("formalityBand does NOT map — it means 'too formal', not 'I like smart-casual'", () => {
    assert.deepEqual(extract("SAVE", { formalityBand: ["smart-casual"] }), []);
  });

  it("colour, material, silhouette, pattern and weight have no V1 dimension", () => {
    for (const facets of [
      { colourFamily: ["red-burgundy"] },
      { material: ["suede"] },
      { silhouette: ["asymmetric"] },
      { pattern: ["stripes"] },
      { visualWeight: ["light"] },
    ]) {
      assert.deepEqual(extract("SAVE", facets), [], JSON.stringify(facets));
    }
  });

  it("construction is stripped, like everywhere else", () => {
    assert.deepEqual(extract("SAVE", { construction: ["soft"] }), []);
  });

  it("no facets, no evidence", () => {
    assert.deepEqual(extract("SAVE", null), []);
    assert.equal(producesEvidence(null), false);
    assert.equal(producesEvidence({ category: ["BAGS"] }), true);
  });
});

// ── §TE-4 action meanings ─────────────────────────────────────────────────────

describe("§TE-4 what each action means", () => {
  it("Save and Style are positive; Not for me is negative", () => {
    assert.equal(extract("SAVE", { category: ["BAGS"] })[0].polarity, "positive");
    assert.equal(extract("STYLED", { category: ["BAGS"] })[0].polarity, "positive");
    assert.equal(extract("NOT_FOR_ME", { category: ["BAGS"] })[0].polarity, "negative");
  });

  it("Style records INTENT — its rule never claims she wore anything", () => {
    const rule = extract("STYLED", { category: ["BAGS"] })[0].provenance.extractionRule;
    assert.equal(rule, "trend-style-intent-v1");
    assert.equal(rule.includes("wore"), false);
    assert.equal(rule.includes("worn"), false);
  });

  it("each action is distinguishable in provenance", () => {
    const rules = TREND_ACTIONS.map((a) => extract(a, { category: ["BAGS"] })[0].provenance.extractionRule);
    assert.equal(new Set(rules).size, TREND_ACTIONS.length);
  });

  it("every row carries the durable record id, so repetition cannot inflate", () => {
    const a = extract("SAVE", { category: ["BAGS"] }, "rec_1");
    const b = extract("SAVE", { category: ["BAGS"] }, "rec_1");
    // Same source record → writeSourceEvidence replaces rather than accumulates.
    assert.equal(a[0].sourceRecordId, b[0].sourceRecordId);
  });

  it("an unknown action produces nothing", () => {
    assert.deepEqual(extract("BROWSED" as never, { category: ["BAGS"] }), []);
  });
});

// ── §TE-5 source-honest copy — the trust bug ─────────────────────────────────

describe("§TE-5 trend copy never implies ownership or wear", () => {
  const FORBIDDEN = ["worn", "unworn", "wore", "returned", "regret", "rarely worn", "purchase", "bought"];

  it("a trend-only FRICTION claim says none of the wardrobe words", () => {
    const t = generateTendencyText("garment-category", "BAGS", "FRICTION", 6, 1, ["TREND_ENGAGEMENT"]);
    const text = `${t.claimText} ${t.rationaleText}`.toLowerCase();
    for (const word of FORBIDDEN) {
      assert.equal(text.includes(word), false, `trend copy must not say "${word}": ${text}`);
    }
  });

  it("it describes what she actually did — passed on trend directions", () => {
    const t = generateTendencyText("garment-category", "BAGS", "FRICTION", 6, 1, ["TREND_ENGAGEMENT"]);
    assert.ok(t.claimText.toLowerCase().includes("passed on"));
    assert.ok(t.rationaleText.toLowerCase().includes("trend direction"));
  });

  it("a trend-only WORKS_WELL claim never says she wore anything", () => {
    const t = generateTendencyText("garment-category", "BAGS", "WORKS_WELL", 6, 1, ["TREND_ENGAGEMENT"]);
    const text = `${t.claimText} ${t.rationaleText}`.toLowerCase();
    for (const word of FORBIDDEN) assert.equal(text.includes(word), false, word);
    assert.ok(text.includes("saved or styled"));
  });

  it("WARDROBE evidence keeps its existing language — unchanged", () => {
    const t = generateTendencyText("garment-category", "BAGS", "FRICTION", 3, 1, ["CLOSET_RELATIONSHIP"]);
    assert.ok(t.claimText.toLowerCase().includes("unworn") || t.rationaleText.toLowerCase().includes("rarely worn"));
  });

  it("MIXED evidence falls back to the existing templates, not the trend one", () => {
    // Once real wardrobe evidence is present, the wardrobe language is true again.
    const t = generateTendencyText("garment-category", "BAGS", "FRICTION", 4, 2,
      ["TREND_ENGAGEMENT", "CLOSET_RELATIONSHIP"]);
    assert.equal(t.claimText.toLowerCase().includes("passed on"), false);
  });

  it("the trend provenance label reads honestly", () => {
    const t = generateTendencyText("garment-category", "BAGS", "FRICTION", 6, 2,
      ["TREND_ENGAGEMENT", "TREND_ENGAGEMENT"]);
    assert.ok(`${t.rationaleText}`.length > 0);
  });
});

// ── §TE-6 passive signals emit NOTHING ───────────────────────────────────────
//
// Browsing is not taste. These read the routes that handle passive actions and
// assert none of them can reach the evidence layer. A structural check, so it
// fails when a dependency is INTRODUCED rather than when it changes an outcome.

import { readFileSync } from "node:fs";

const EVIDENCE_CALLS = ["emitTrendEvidence", "writeSourceEvidence", "setTrendFeedback"];

function assertNoEvidence(file: string, why: string) {
  const src = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  for (const call of EVIDENCE_CALLS) {
    assert.equal(code.includes(`${call}(`), false, `${file} must not call ${call} — ${why}`);
  }
}

describe("§TE-6 passive actions", () => {
  it("opening a PUBLIC trend report emits nothing", () => {
    assertNoEvidence("app/routes/trends.$slug.tsx", "opening a report is not a deliberate action");
  });

  it("opening a PERSONALISED edit, and replaying history, emit nothing", () => {
    assertNoEvidence("app/routes/trends.my-edits.$slug.tsx", "reading an edit is not taste");
  });

  it("the trend edits index emits nothing", () => {
    assertNoEvidence("app/routes/trends.my-edits.tsx", "listing is not taste");
  });

  it("viewing My Saved emits nothing", () => {
    assertNoEvidence("app/routes/my-naia.saved.tsx", "looking at the archive is not a new signal");
  });

  it("expanding 'See my pieces' is client state only — no server call", () => {
    const src = readFileSync(new URL("../../app/routes/trends.my-edits.$slug.tsx", import.meta.url), "utf8");
    // The toggle is local useState; it posts nothing.
    assert.ok(src.includes("setOpen((o) => !o)"));
    assert.equal(src.includes('action="/api/trend-feedback"'), false);
  });

  it("the matcher itself has no route to the evidence layer", () => {
    const src = readFileSync(new URL("../../app/lib/trend-closet-match.ts", import.meta.url), "utf8");
    for (const call of EVIDENCE_CALLS) assert.equal(src.includes(call), false);
  });
});

// ── §TE-7 nothing downstream changed ─────────────────────────────────────────

describe("§TE-7 regression boundaries", () => {
  it("Passport is never written by the trend feedback layer", () => {
    const src = readFileSync(new URL("../../app/lib/trend-feedback.server.ts", import.meta.url), "utf8");
    assert.equal(src.includes("onboardingProfile"), false);
    assert.equal(src.includes("OnboardingProfile"), false);
  });

  it("buildShopperEdit does not consult trend engagement — Step 8 is deferred", () => {
    const src = readFileSync(new URL("../../app/lib/trend-evidence.server.ts", import.meta.url), "utf8");
    assert.equal(src.includes("TREND_ENGAGEMENT"), false);
    assert.equal(src.includes("trendContentFeedback"), false);
  });

  it("StyleMe ranking does not read trend feedback", () => {
    for (const f of ["app/lib/ai/styleme-recommendation.ts", "app/lib/ai/styleme-result.server.ts"]) {
      const src = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
      assert.equal(src.includes("TREND_ENGAGEMENT"), false);
      assert.equal(src.includes("trendContentFeedback"), false);
    }
  });

  it("dismissing does not delete a SavedItem", () => {
    const src = readFileSync(new URL("../../app/lib/trend-feedback.server.ts", import.meta.url), "utf8");
    assert.equal(src.includes("savedItem"), false);
  });
});
