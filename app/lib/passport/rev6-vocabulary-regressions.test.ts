// app/lib/passport/rev6-vocabulary-regressions.test.ts
//
// Regression suite for three pre-existing defects, all the same root cause:
// code that was written against the V2 style/lifestyle vocabulary and never
// updated when Rev 6 introduced the V3 archetype and lifestyle IDs. Each one
// silently degraded to a no-op for every modern customer.
//
//   1. trend-evidence REGISTER_CLUSTER_IDS   — V2 IDs only → always "neutral"
//   2. trend-evidence resolveWorkContext     — V2 IDs only → always "none"
//   3. styleme-anchor raw-substring matching — hyphenated IDs never matched
//
// These are NOT Rev 7 changes; Rev 7 only made them easier to see.
//
// Run: node --test --import tsx/esm app/lib/passport/rev6-vocabulary-regressions.test.ts

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { styleTagMatchesArchetype, scoreClosetItemForSession } from "../ai/styleme-anchor.server.js";

const TREND = readFileSync("app/lib/trend-evidence.server.ts", "utf8");

// ── 1. Style register covers every shipped style vocabulary ──────────────────

describe("VR.1 — style register recognises V3 and Rev 7 style IDs", () => {
  const clusters = TREND.slice(
    TREND.indexOf("const REGISTER_CLUSTER_IDS"),
    TREND.indexOf("function resolveStyleRegister"),
  );

  it("still recognises every V2 ID it always did", () => {
    for (const id of ["old-money", "corporate-chic", "minimal", "effortlessly-chic",
                      "romantic", "casual-cool", "feminine", "artsy", "edgy", "trendy"]) {
      assert.ok(clusters.includes(`"${id}"`), `V2 ID ${id} must still be clustered`);
    }
  });

  it("recognises the five V3 archetypes (Rev 6)", () => {
    for (const id of ["classic-polished", "minimal-relaxed", "feminine-romantic",
                      "bold-edgy", "creative-expressive"]) {
      assert.ok(clusters.includes(`"${id}"`), `V3 archetype ${id} must be clustered`);
    }
  });

  it("recognises the Rev 7 style directions that have an aesthetic register", () => {
    for (const id of ["polished-refined", "clean-minimal", "soft-romantic", "relaxed-easy",
                      "bold-statement", "creative-individual", "street-contemporary"]) {
      assert.ok(clusters.includes(`"${id}"`), `Rev 7 direction ${id} must be clustered`);
    }
  });

  it("leaves sporty-functional unclustered on purpose, and says why", () => {
    assert.ok(!clusters.includes('"sporty-functional"'),
      "sporty-functional is a functional register, not one of the three aesthetic ones");
    assert.ok(TREND.includes("sporty-functional is intentionally absent"),
      "the omission must be documented so it does not read as an oversight");
  });

  it("each style ID belongs to exactly one cluster", () => {
    const ids = [...clusters.matchAll(/"([a-z0-9-]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, "a style ID must not appear in two clusters");
  });

  it("the register is fed by whichever style field the customer actually answered", () => {
    assert.ok(TREND.includes("profile.styleDirections?.length"),
      "a Rev 7 customer's styleDirections must reach the register, not an empty legacy row");
    assert.ok(TREND.includes("styleDirections: true"),
      "styleDirections must be selected from the database");
  });
});

// ── 2. Work context covers every shipped lifestyle vocabulary ────────────────

describe("VR.2 — work context recognises V3 and Rev 7 lifestyle IDs", () => {
  const work = TREND.slice(
    TREND.indexOf("const WORK_LIFESTYLE_IDS"),
    TREND.indexOf("function resolveWorkContext"),
  );

  it("still recognises the V2 IDs", () => {
    for (const id of ["office", "hybrid", "events"]) {
      assert.ok(work.includes(`"${id}"`), `V2 lifestyle ${id} must still be recognised`);
    }
  });

  it("recognises the V3 / Rev 7 work IDs", () => {
    for (const id of ["work-office", "creative-flexible-work"]) {
      assert.ok(work.includes(`"${id}"`), `${id} must count as a work context`);
    }
  });

  it("recognises the V3 / Rev 7 event IDs", () => {
    for (const id of ["events-special-occasions", "dinners-going-out"]) {
      assert.ok(work.includes(`"${id}"`), `${id} must count as an event context`);
    }
  });

  it("no longer hard-codes a bare V2-only comparison", () => {
    assert.ok(!TREND.includes('l === "office" || l === "hybrid"'),
      "the V2-only equality check must be replaced by the shared ID sets");
  });
});

// ── 3. Style tag matching is word-level, not raw substring ───────────────────

describe("VR.3 — styleTagMatchesArchetype", () => {
  it("matches a compound archetype against either component word", () => {
    assert.ok(styleTagMatchesArchetype("classic", "classic-polished"));
    assert.ok(styleTagMatchesArchetype("polished", "classic-polished"));
    assert.ok(styleTagMatchesArchetype("bold", "bold-edgy"));
    assert.ok(styleTagMatchesArchetype("edgy", "bold-edgy"));
  });

  it("matches Rev 7 direction tokens too", () => {
    assert.ok(styleTagMatchesArchetype("minimal", "clean-minimal"));
    assert.ok(styleTagMatchesArchetype("romantic", "soft-romantic"));
    assert.ok(styleTagMatchesArchetype("sporty", "sporty-functional"));
  });

  it("preserves the legacy single-word prefix behaviour customers rely on", () => {
    assert.ok(styleTagMatchesArchetype("minimalist", "minimal"),
      '"minimal" matched the tag "minimalist" before this fix and must keep doing so');
  });

  it("matches on an exact identical string", () => {
    assert.ok(styleTagMatchesArchetype("classic-polished", "classic-polished"));
  });

  it("is case and whitespace insensitive", () => {
    assert.ok(styleTagMatchesArchetype("  Classic  ", "CLASSIC-POLISHED"));
  });

  it("matches a word inside a multi-word tag", () => {
    assert.ok(styleTagMatchesArchetype("smart classic", "classic-polished"));
    assert.ok(styleTagMatchesArchetype("date night / romantic", "soft-romantic"));
  });

  it("does not match an unrelated tag", () => {
    assert.ok(!styleTagMatchesArchetype("sporty", "classic-polished"));
    assert.ok(!styleTagMatchesArchetype("casual", "bold-edgy"));
  });

  it("does not match a tag that merely contains the word mid-string", () => {
    assert.ok(!styleTagMatchesArchetype("unbold", "bold-edgy"),
      "matching must be word-anchored, not a raw substring test");
  });

  it("handles empty input safely", () => {
    assert.ok(!styleTagMatchesArchetype("", "classic-polished"));
    assert.ok(!styleTagMatchesArchetype("classic", ""));
    assert.ok(!styleTagMatchesArchetype("   ", "classic-polished"));
  });
});

// ── 3b. The fix is observable through the real scorer ────────────────────────

describe("VR.3b — a V3 archetype now earns its style-tag point", () => {
  const item = {
    occasions: [], styleTags: ["classic"], category: "TOPS",
    colors: [], primaryColor: null,
  };
  const signals = { occasion: "work", moods: [] as string[], desiredFeelings: [] as string[] };

  it("scores a V3 archetype against a matching tag", () => {
    const withArchetype = scoreClosetItemForSession(item, signals, { stylePersonalities: ["classic-polished"] });
    const withNothing   = scoreClosetItemForSession(item, signals, { stylePersonalities: [] });
    assert.equal(withArchetype - withNothing, 1,
      "a V3 archetype must earn the same +1 a V2 ID always did");
  });

  it("scores a Rev 7 direction through its projection", () => {
    const withDirection = scoreClosetItemForSession(item, signals, { styleDirectionArchetypes: ["classic-polished"] });
    const withNothing   = scoreClosetItemForSession(item, signals, { stylePersonalities: [] });
    assert.equal(withDirection - withNothing, 1);
  });

  it("still awards nothing when no tag corresponds", () => {
    const unrelated = { ...item, styleTags: ["sporty"] };
    assert.equal(
      scoreClosetItemForSession(unrelated, signals, { stylePersonalities: ["classic-polished"] }),
      scoreClosetItemForSession(unrelated, signals, { stylePersonalities: [] }),
    );
  });

  it("awards the point at most once, however many tags match", () => {
    const many = { ...item, styleTags: ["classic", "polished", "classic-polished"] };
    const withArchetype = scoreClosetItemForSession(many, signals, { stylePersonalities: ["classic-polished"] });
    const withNothing   = scoreClosetItemForSession(many, signals, { stylePersonalities: [] });
    assert.equal(withArchetype - withNothing, 1, "the style-tag bonus must not stack");
  });
});
