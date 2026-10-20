// app/lib/ai/wardrobe-persona-f.test.ts
// Run: node --test --import tsx/esm app/lib/ai/wardrobe-persona-f.test.ts
//
// Persona F — "Buy Less and Wear More": a fully isolated, synthetic QA persona that
// exercises Wardrobe Intelligence's "Buy less" (wardrobe-needs.ts, the "enough" finding)
// and "Pieces worth rediscovering" (wardrobe-intelligence.ts, buildRediscover()) modules
// at the same time, on the same wardrobe.
//
// WHY THIS IS NOT PERSONA A–E'S OWN CONVENTION. Personas A–E are real customer rows
// seeded into the shared staging database (api.seed-staging.jsx, TEST_CUSTOMER_PREFIX
// "test-batch1-") and exercised by clicking through the live app. The task explicitly
// forbids that here (no DB seeding, no shared infrastructure). What this file follows
// instead is the OTHER existing convention — the one wardrobe-intelligence.test.ts and
// wardrobe-needs.test.ts already use for their own certification suites: hand-built
// WardrobeGarment/WardrobePassport fixtures fed straight into the real, pure engine
// functions (computeWardrobeIntelligence / computeWardrobeNeeds / buildWardrobePage).
// No database, no network, no mocked AI call — the engine itself is real throughout.
//
// NO INVENTED WEAR HISTORY. ClosetItem.timesWorn/lastWorn exist in the Prisma schema but
// nothing writes them; WardrobeGarment.observedWear is reserved and the real loader always
// passes null (wardrobe-intelligence.server.ts). This fixture never sets it, and PF-5 below
// asserts the engine's own evidence never claims a wear count or a last-worn date — only
// garmentRelationships (self-reported) and outfitAppearances/savedLookAppearances (real
// nAia-generated-content counts) drive anything here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeWardrobeIntelligence,
  type WardrobeGarment,
  type WardrobePassport,
} from "./wardrobe-intelligence.js";
import { computeWardrobeNeeds } from "./wardrobe-needs.js";
import { computeWardrobeRecommendations } from "./wardrobe-recommendations.js";
import { buildWardrobePage } from "./wardrobe-page.js";

// ── Fixture builders — same convention as wardrobe-intelligence.test.ts ─────

let seq = 0;

function makeGarment(overrides: Partial<WardrobeGarment> = {}): WardrobeGarment {
  seq += 1;
  const base: WardrobeGarment = {
    id: `pf-g${seq}`, name: `Piece ${seq}`, category: "TOPS", subcategory: null, imageUrl: null,
    slot: "top", primaryColor: "Black", colors: [], pattern: "solid", material: "cotton",
    silhouette: "straight", fitProfile: "tailored", formality: "smart-casual", stylePersonality: null,
    occasions: [], seasons: [], analysisStatus: "ready", visualWeight: "medium",
    colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: "neutral-versatile" },
    garmentRelationships: [], intentions: null, intentionsSource: null, intelligenceSource: "derived",
    sleeveLength: "full", necklineCoverage: "crew", hemLength: "n/a", topLength: "hip-length",
    midriffExposed: false, shoulderCoverage: true,
    outfitAppearances: 0, savedLookAppearances: 0, observedWear: null,
  } as WardrobeGarment;
  return { ...base, ...overrides };
}

/** A small, realistic mixed-slot wardrobe — same shape as wardrobe-intelligence.test.ts's
 *  own neutralWardrobe(), kept local so this file stands on its own. */
function neutralWardrobe(): WardrobeGarment[] {
  return [
    makeGarment({ id: "pf-top-black", name: "Black Tailored Shirt", slot: "top", primaryColor: "Black" }),
    makeGarment({ id: "pf-top-cream", name: "Cream Shirt", slot: "top", primaryColor: "Cream" }),
    makeGarment({ id: "pf-bottom-black", name: "Black Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Black" }),
    makeGarment({ id: "pf-bottom-brown", name: "Brown Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Brown" }),
    makeGarment({ id: "pf-outer-black", name: "Black Blazer", category: "OUTERWEAR", slot: "outerwear", primaryColor: "Black" }),
    makeGarment({ id: "pf-dress-black", name: "Black Dress", category: "DRESSES", slot: "dress", primaryColor: "Black" }),
  ];
}

const TOP_SHAPES = [
  { silhouette: "fitted",    fitProfile: "tailored", primaryColor: "Black" },
  { silhouette: "oversized", fitProfile: "loose",    primaryColor: "Navy"  },
  { silhouette: "boxy",      fitProfile: "relaxed",  primaryColor: "Cream" },
  { silhouette: "wrap",      fitProfile: "fitted",   primaryColor: "Green" },
  { silhouette: "column",    fitProfile: "slim",     primaryColor: "Grey"  },
];
const BOTTOM_SHAPES = [
  { silhouette: "straight", fitProfile: "tailored",  primaryColor: "Charcoal" },
  { silhouette: "flared",   fitProfile: "flowy",     primaryColor: "Beige"    },
  { silhouette: "tapered",  fitProfile: "slim",      primaryColor: "Navy"     },
  { silhouette: "a-line",   fitProfile: "relaxed",   primaryColor: "Brown"    },
  { silhouette: "balloon",  fitProfile: "oversized", primaryColor: "Black"    },
];

/** n genuinely different top/bottom shapes — same convention as wardrobe-needs.test.ts's
 *  variedLooks(). Deliberately NOT clones: this is the exact fixture that makes a "near-
 *  duplicate" redundancy claim visibly wrong if the copy ever overclaims visual similarity. */
function variedLooks(formality: string, n: number): WardrobeGarment[] {
  const out: WardrobeGarment[] = [];
  const neutral = { hueFamily: null, wardrobeNeutral: true, lightDark: "dark" as const, energyTier: "neutral-versatile" as const };
  for (let i = 0; i < n; i++) {
    const t = TOP_SHAPES[i % TOP_SHAPES.length];
    const b = BOTTOM_SHAPES[i % BOTTOM_SHAPES.length];
    out.push(makeGarment({ slot: "top", category: "TOPS", formality, topLength: "hip-length", hemLength: "n/a", occasions: ["Weekend"], colourProfile: neutral, ...t }));
    out.push(makeGarment({ slot: "bottom", category: "BOTTOMS", formality, topLength: "n/a", hemLength: "full", occasions: ["Weekend"], colourProfile: neutral, ...b }));
  }
  return out;
}

/**
 * Persona F's full wardrobe:
 *   - neutralWardrobe() (6 items) + variedLooks("casual", 5) (10 items) together give
 *     6-7 everyday-neutral tops and 6-7 everyday-neutral bottoms — past ENOUGH_CLUSTER (5)
 *     and a deep enough everyday register (DEEP_LOOKS, 4) to trigger "Buy less" for BOTH
 *     slots, genuinely (not by inventing a threshold).
 *   - "pf-bottom-black" is tagged rarely-wear (a real, legitimate self-reported signal) and
 *     has well over 3 structurally-compatible partners — a genuine Rediscover candidate.
 *   - "pf-probe-sleeveless-top" is the Style-Passport regression probe: also rarely-wear,
 *     also well-partnered, but sleeveless — qualifies for Rediscover UNLESS the customer's
 *     Passport states arms-covered, in which case classifyUsability() must exclude it (the
 *     fix added to buildRediscover() in wardrobe-intelligence.ts).
 */
function personaFWardrobe(): WardrobeGarment[] {
  const items = [...neutralWardrobe(), ...variedLooks("casual", 5)];
  const bottomBlack = items.find((g) => g.id === "pf-bottom-black")!;
  bottomBlack.garmentRelationships = ["rarely-wear"];
  const probe = makeGarment({
    id: "pf-probe-sleeveless-top", name: "Sleeveless Linen Top", slot: "top", category: "TOPS",
    primaryColor: "White", formality: "casual", sleeveLength: "sleeveless",
    garmentRelationships: ["rarely-wear"],
  });
  return [...items, probe];
}

function personaFPassport(overrides: Partial<WardrobePassport> = {}): WardrobePassport {
  return {
    // "office" is deliberate, not incidental: buildNotAPriority() (wardrobe-recommendations.ts)
    // only produces the real "low-priority"/Buy-Less page block when there is BOTH an "enough"
    // cluster AND a genuinely thinner register elsewhere — "buy less of X, put the energy into
    // Y instead" is a comparison, not a standalone complaint. Persona F has zero work-register
    // garments, so stating "office" here makes work genuinely thin (a real couldUseMore
    // finding), which is what actually surfaces the rendered Buy-Less section (see PF-6).
    lifestyle: ["everyday-casual", "office"], favoriteColors: [], avoidColors: [], stylePersonalities: [],
    silhouette: [], structure: null, fitPreferences: [], styleStruggles: [], styleSupport: [], becoming: [],
    ...overrides,
  } as WardrobePassport;
}

/** Full engine bundle, same three calls + buildWardrobePage the real loader makes. */
function runPersonaF(items: WardrobeGarment[], passport: WardrobePassport | null) {
  const intelligence = computeWardrobeIntelligence({ items, passport, seenCombinations: new Set<string>() });
  const needs = computeWardrobeNeeds({ items, passport, styleMeSessions: null, outcomes: null, styleMeDemandFacts: null });
  const recommendations = computeWardrobeRecommendations({ needs, items, passport });
  const page = buildWardrobePage({
    intelligence, needs, recommendations, closetCount: items.length,
    garmentName: (id) => items.find((g) => g.id === id)?.name ?? null,
    lifestyle: passport?.lifestyle ?? [],
    hasStatedColourPreference: (passport?.favoriteColors?.length ?? 0) > 0,
    contradictedColours: [],
  });
  return { intelligence, needs, recommendations, page };
}

// ── PF-1: Buy Less genuinely triggers, on real counts ───────────────────────

describe("PF-1 — Persona F's wardrobe genuinely triggers Buy Less (the 'enough' finding)", () => {
  const items = personaFWardrobe();
  const { needs } = runPersonaF(items, personaFPassport());

  it("PF-1.1 at least one 'enough' cluster is found for the everyday register", () => {
    assert.ok(needs.enough.length > 0, "Persona F's wardrobe must genuinely trigger Buy Less");
    assert.ok(needs.enough.every((e) => e.register === "everyday"), "this fixture only deepens the everyday register");
  });

  it("PF-1.2 every listed garment id is a real Persona F garment, and the body's own count is at least ENOUGH_CLUSTER (5)", () => {
    for (const finding of needs.enough) {
      assert.ok(finding.garmentIds.length > 0, `${finding.id} must list at least one garment`);
      for (const id of finding.garmentIds) {
        assert.ok(items.some((g) => g.id === id), `${id} in ${finding.id} must be a real Persona F garment, not invented`);
      }
      const countMatch = finding.body.match(/You already have (\d+) /);
      assert.ok(countMatch, `body must state a concrete count; got "${finding.body}"`);
      assert.ok(Number(countMatch![1]) >= 5, "the stated count must actually clear the real ENOUGH_CLUSTER threshold");
    }
  });

  it("PF-1.3 both the tops cluster and the bottoms cluster are found (not just one slot)", () => {
    const titles = needs.enough.map((e) => e.title);
    assert.ok(titles.some((t) => /tops/i.test(t)), `expected a tops cluster; got ${titles.join(", ")}`);
    assert.ok(titles.some((t) => /bottoms/i.test(t)), `expected a bottoms cluster; got ${titles.join(", ")}`);
  });
});

// ── PF-2: the redundancy claim is accurate, not misleading ──────────────────

describe("PF-2 — Buy Less never overclaims visual similarity it never checked", () => {
  const items = personaFWardrobe();
  const { needs } = runPersonaF(items, personaFPassport());

  it("PF-2.1 the 'enough' finding body never claims the pieces look alike", () => {
    for (const finding of needs.enough) {
      assert.doesNotMatch(finding.body, /near-duplicate|duplicate|identical|look(s)? (the )?same/i);
      // The real, accurate claim: a similar one wouldn't add much, not that these
      // specific pieces are copies of each other. variedLooks() deliberately gives
      // this cluster five genuinely different silhouettes (fitted/oversized/boxy/
      // wrap/column) — an "identical" claim would be factually wrong for this fixture.
      assert.match(finding.body, /wouldn't give you many new options|wouldn't add much/);
    }
  });

  it("PF-2.2 Reconsider's per-garment reason for an 'enough' member is the same accurate, non-visual claim", () => {
    const memberId = needs.enough[0].garmentIds[0];
    const entry = needs.reconsider.entries.find((e) => e.garmentId === memberId);
    assert.ok(entry, "a member of an 'enough' cluster must surface in Reconsider");
    assert.doesNotMatch(entry!.reasons.join(" "), /near-duplicate|duplicate|identical/i);
    assert.match(entry!.reasons.join(" "), /already cover this role well/);
  });

  it("PF-2.3 sanity: the cluster's own members are genuinely different shapes, proving the fixture tests something real", () => {
    const cluster = needs.enough.find((e) => /tops/i.test(e.title))!;
    const silhouettes = new Set(items.filter((g) => cluster.garmentIds.includes(g.id)).map((g) => g.silhouette));
    assert.ok(silhouettes.size >= 3, `expected genuinely varied silhouettes in the 'enough' cluster; got ${[...silhouettes].join(", ")}`);
  });
});

// ── PF-3: Wear More / Rediscover genuinely triggers ──────────────────────────

describe("PF-3 — Persona F's wardrobe genuinely triggers Wear More / Rediscover", () => {
  const items = personaFWardrobe();
  const { intelligence } = runPersonaF(items, personaFPassport());

  it("PF-3.1 the rarely-worn bottom is rediscovered, with real compatible partners", () => {
    const piece = intelligence.opportunities.rediscover.find((r) => r.garmentId === "pf-bottom-black");
    assert.ok(piece, "pf-bottom-black must qualify for Rediscover");
    assert.ok(piece!.worksWithIds.length >= 3, "must carry at least 3 real compatible partners");
    assert.ok(piece!.worksWithIds.every((id) => items.some((g) => g.id === id)), "every partner id must be a real Persona F garment");
    assert.match(piece!.body, /rarely reach for/i);
  });

  it("PF-3.2 the evidence behind it cites the real self-reported tag and the real compatibility graph, nothing invented", () => {
    const piece = intelligence.opportunities.rediscover.find((r) => r.garmentId === "pf-bottom-black")!;
    assert.ok(piece.evidence.some((e) => e.signal === "self-reported-wardrobe" && e.field === "garmentRelationships"));
    assert.ok(piece.evidence.some((e) => e.signal === "garment-fact" && e.field === "compatibility graph"));
  });
});

// ── PF-4: Style Passport strict requirements are enforced on Rediscover ─────
//
// Regression proof for the fix added to buildRediscover() (wardrobe-intelligence.ts):
// before it, a piece that structurally qualified for Rediscover but violated a stated
// strict dressing requirement was recommended anyway — classifyUsability() was only ever
// applied to Buy Less (clustersOf()), never to Rediscover. This probe item is designed to
// qualify on every OTHER axis (underuse signal + 3+ partners) so the only thing that can
// exclude it is the Passport gate itself.

describe("PF-4 — Rediscover never contradicts a strict Style Passport requirement", () => {
  const items = personaFWardrobe();

  it("PF-4.1 sanity: WITHOUT a conflicting Passport, the sleeveless probe DOES qualify structurally", () => {
    const { intelligence } = runPersonaF(items, personaFPassport());
    const probe = intelligence.opportunities.rediscover.find((r) => r.garmentId === "pf-probe-sleeveless-top");
    assert.ok(probe, "the probe must be structurally eligible (underused + well-partnered) when nothing restricts it — otherwise this test proves nothing");
  });

  it("PF-4.2 WITH arms-covered stated, the sleeveless probe is excluded from Rediscover entirely", () => {
    const passport = personaFPassport({ dressingPreferences: ["arms-covered"] } as Partial<WardrobePassport>);
    const { intelligence } = runPersonaF(items, passport);
    const probe = intelligence.opportunities.rediscover.find((r) => r.garmentId === "pf-probe-sleeveless-top");
    assert.equal(probe, undefined, "a sleeveless piece must never be recommended to a customer who stated arms-covered");
  });

  it("PF-4.3 the OTHER, genuinely compatible candidate is unaffected by the same Passport restriction", () => {
    const passport = personaFPassport({ dressingPreferences: ["arms-covered"] } as Partial<WardrobePassport>);
    const { intelligence } = runPersonaF(items, passport);
    const bottom = intelligence.opportunities.rediscover.find((r) => r.garmentId === "pf-bottom-black");
    assert.ok(bottom, "the Passport gate must exclude only the piece that actually violates it, not every rediscover candidate");
  });
});

// ── PF-5: no invented wear history anywhere in the output ───────────────────

describe("PF-5 — nothing in Persona F's output claims a wear count or a last-worn date", () => {
  const items = personaFWardrobe();
  const { intelligence, needs } = runPersonaF(items, personaFPassport());

  it("PF-5.1 observedWear stays null on every Persona F garment, exactly like the real loader", () => {
    for (const g of items) assert.equal(g.observedWear, null, `${g.id} must not carry invented wear data`);
  });

  it("PF-5.2 no Rediscover evidence or body text claims a specific wear count or 'last worn'", () => {
    for (const piece of intelligence.opportunities.rediscover) {
      assert.doesNotMatch(piece.body, /\bworn \d+ times?\b|\blast worn\b|\btimes worn\b/i);
      for (const e of piece.evidence) assert.doesNotMatch(e.detail, /\bworn \d+ times?\b|\blast worn\b/i);
    }
  });

  it("PF-5.3 no 'enough' finding claims a wear frequency — only real compatibility/depth facts", () => {
    for (const finding of needs.enough) {
      assert.doesNotMatch(finding.body, /\bworn \d+ times?\b|\blast worn\b|\btimes worn\b/i);
    }
  });
});

// ── PF-6: both modules' garment counts and evidence match reality ───────────

describe("PF-6 — displayed counts and evidence are the real engine output, not approximated", () => {
  const items = personaFWardrobe();
  const { needs, intelligence, page } = runPersonaF(items, personaFPassport());

  it("PF-6.1 page.sections exposes a real 'low-priority' (Buy less) block fed by the real 'enough' cluster", () => {
    const shop = page.sections.find((s) => s.id === "shop");
    assert.ok(shop, "the 'shop' section must exist");
    const lowPriority = shop!.blocks.find((b) => b.id === "low-priority");
    assert.ok(lowPriority, "the Buy-Less block must exist for Persona F");
    assert.equal(lowPriority!.entries[0]?.garmentIds?.length, needs.enough[0].garmentIds.length, "the rendered block's count must equal the real engine finding's count");
  });

  it("PF-6.2 page.sections exposes a real 'worth-trying' (Rediscover) block, one entry per real piece", () => {
    const wear = page.sections.find((s) => s.id === "wear");
    assert.ok(wear, "the 'wear' section must exist");
    const worthTrying = wear!.blocks.find((b) => b.id === "worth-trying");
    assert.ok(worthTrying, "the Rediscover block must exist for Persona F");
    assert.equal(worthTrying!.entries.length, intelligence.opportunities.rediscover.length, "one page entry per real rediscover piece");
  });
});

// ── PF-7: missing-data behaviour — a thin Persona F' variant finds nothing to invent ──

describe("PF-7 — a wardrobe too small for either module says so honestly, rather than inventing a finding", () => {
  it("PF-7.1 three plain, never-marked garments trigger neither Buy Less nor Rediscover", () => {
    const thin = [
      makeGarment({ id: "pf-thin-1", slot: "top" }),
      makeGarment({ id: "pf-thin-2", slot: "bottom", category: "BOTTOMS" }),
      makeGarment({ id: "pf-thin-3", slot: "shoe", category: "SHOES" }),
    ];
    const { needs, intelligence } = runPersonaF(thin, personaFPassport());
    assert.equal(needs.enough.length, 0, "three garments can never be 'enough' — below ENOUGH_CLUSTER");
    assert.equal(intelligence.opportunities.rediscover.length, 0, "nothing is marked underused and nothing has 3+ partners");
  });
});
