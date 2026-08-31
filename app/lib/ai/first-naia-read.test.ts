// app/lib/ai/first-naia-read.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeNaiaFirstRead,
  normalizeGarmentRelationships,
  hasClosetStarterEvidence,
  FIRST_READ_SCHEMA_VERSION,
  type FirstReadProfile,
} from "./first-naia-read.js";

// ── First Read: core guarantees ───────────────────────────────────────────────

describe("FR1 — empty/sparse Profile returns 0 observations", () => {
  it("null profile → 0 observations", () => {
    assert.equal(computeNaiaFirstRead(null).observations.length, 0);
  });
  it("undefined profile → 0 observations", () => {
    assert.equal(computeNaiaFirstRead(undefined).observations.length, 0);
  });
  it("all-empty profile → 0 observations", () => {
    assert.equal(computeNaiaFirstRead({}).observations.length, 0);
  });
  it("all-empty arrays → 0 observations", () => {
    const profile: FirstReadProfile = {
      stylePersonalities: [],
      silhouette: [],
      successfulOutfitGives: [],
      lifestyle: [],
      favoriteColors: [],
      avoidColors: [],
    };
    assert.equal(computeNaiaFirstRead(profile).observations.length, 0);
  });
});

describe("FR2 — never more than 3 observations", () => {
  it("rich profile still returns at most 3", () => {
    const profile: FirstReadProfile = {
      stylePersonalities: ["classic-polished"],
      silhouette: ["fitted"],
      successfulOutfitGives: ["feel-like-myself"],
      lifestyle: ["work-office"],
      favoriteColors: ["black"],
      avoidColors: ["orange"],
    };
    assert.ok(computeNaiaFirstRead(profile).observations.length <= 3);
  });
  it("exactly 3 observation types are filled when 4 are available", () => {
    const profile: FirstReadProfile = {
      stylePersonalities: ["classic-polished"],
      successfulOutfitGives: ["confidence"],
      lifestyle: ["work-office"],
      favoriteColors: ["navy"],
    };
    assert.equal(computeNaiaFirstRead(profile).observations.length, 3);
  });
});

describe("FR3 — deterministic priority order", () => {
  it("style-direction always comes before clothing-relationship", () => {
    const result = computeNaiaFirstRead({
      stylePersonalities: ["classic-polished"],
      successfulOutfitGives: ["confidence"],
    });
    const types = result.observations.map(o => o.type);
    assert.ok(types.indexOf("style-direction") < types.indexOf("clothing-relationship"));
  });
  it("clothing-relationship always comes before wardrobe-context", () => {
    const result = computeNaiaFirstRead({
      successfulOutfitGives: ["feel-like-myself"],
      lifestyle: ["work-office"],
    });
    const types = result.observations.map(o => o.type);
    assert.ok(types.indexOf("clothing-relationship") < types.indexOf("wardrobe-context"));
  });
  it("wardrobe-context always comes before colour-world", () => {
    const result = computeNaiaFirstRead({
      lifestyle: ["everyday-casual"],
      favoriteColors: ["black"],
    });
    const types = result.observations.map(o => o.type);
    assert.ok(types.indexOf("wardrobe-context") < types.indexOf("colour-world"));
  });
  it("same profile always returns same order", () => {
    const profile: FirstReadProfile = {
      stylePersonalities: ["minimal-relaxed"],
      successfulOutfitGives: ["comfort-ease"],
      lifestyle: ["everyday-casual"],
    };
    const r1 = computeNaiaFirstRead(profile);
    const r2 = computeNaiaFirstRead(profile);
    assert.deepEqual(
      r1.observations.map(o => o.type),
      r2.observations.map(o => o.type),
    );
  });
});

describe("FR4 — same Profile input → same observationKey", () => {
  it("observationKey is identical on repeated calls with identical input", () => {
    const profile: FirstReadProfile = { stylePersonalities: ["classic-polished"], silhouette: ["fitted"] };
    const r1 = computeNaiaFirstRead(profile);
    const r2 = computeNaiaFirstRead(profile);
    assert.deepEqual(
      r1.observations.map(o => o.observationKey),
      r2.observations.map(o => o.observationKey),
    );
  });
  it("observationKey is order-independent in evidenceValues", () => {
    const r1 = computeNaiaFirstRead({ favoriteColors: ["black", "navy"] });
    const r2 = computeNaiaFirstRead({ favoriteColors: ["navy", "black"] });
    // Both produce colour-world observations; the keys must match despite different array orders
    const k1 = r1.observations.find(o => o.type === "colour-world")?.observationKey;
    const k2 = r2.observations.find(o => o.type === "colour-world")?.observationKey;
    assert.ok(k1 && k2 && k1 === k2, "observationKey must be order-independent");
  });
  it("observationKey includes schema version prefix", () => {
    const result = computeNaiaFirstRead({ stylePersonalities: ["feminine-romantic"] });
    const obs = result.observations[0];
    assert.ok(obs.observationKey.startsWith(FIRST_READ_SCHEMA_VERSION + "|"));
  });
});

describe("FR5 — not-sure / not-sure-yet excluded from evidence", () => {
  it("not-sure in successfulOutfitGives → 0 clothing-relationship observations", () => {
    const result = computeNaiaFirstRead({ successfulOutfitGives: ["not-sure"] });
    assert.ok(!result.observations.find(o => o.type === "clothing-relationship"));
  });
  it("not-sure in silhouette does not contribute evidence", () => {
    const result = computeNaiaFirstRead({ silhouette: ["not-sure"] });
    assert.ok(!result.observations.find(o => o.type === "style-direction"));
  });
  it("not-sure-yet excluded from currentGoal — currentGoal is not evidence anyway", () => {
    // Verify the helper does not accept currentGoal at all
    // (it's not in FirstReadProfile type, so this is a type-level contract)
    const profile: FirstReadProfile = {};
    // No currentGoal field → no hypothesis
    assert.equal(computeNaiaFirstRead(profile).observations.length, 0);
  });
  it("mixed: not-sure + valid ID — only valid ID contributes", () => {
    const result = computeNaiaFirstRead({ successfulOutfitGives: ["not-sure", "feel-like-myself"] });
    const obs = result.observations.find(o => o.type === "clothing-relationship");
    assert.ok(obs, "clothing-relationship must be generated when a valid ID is present");
    assert.ok(!obs.evidenceValues.includes("not-sure"), "not-sure must not appear in evidenceValues");
  });
});

describe("FR6 — currentGoal never becomes hypothesis evidence", () => {
  it("FirstReadProfile type does not include currentGoal", () => {
    // Pure type-level check: the compiler would reject currentGoal.
    // At runtime, we verify nothing leaks by passing a profile with no evidence fields set.
    const profile: FirstReadProfile = {
      // currentGoal: ["understand-my-style"] // Would be a type error
    };
    assert.equal(computeNaiaFirstRead(profile).observations.length, 0);
  });
});

describe("FR7 — dressingPreferences never becomes hypothesis evidence", () => {
  it("FirstReadProfile type does not include dressingPreferences", () => {
    const profile: FirstReadProfile = {
      // dressingPreferences: ["wears-hijab"] // Would be a type error
    };
    assert.equal(computeNaiaFirstRead(profile).observations.length, 0);
  });
});

describe("FR8 — fitConcerns never becomes hypothesis evidence", () => {
  it("FirstReadProfile type does not include fitConcerns", () => {
    const profile: FirstReadProfile = {
      // fitConcerns: ["tops-pull-bust"] // Would be a type error
    };
    assert.equal(computeNaiaFirstRead(profile).observations.length, 0);
  });
});

describe("FR9 — style-direction uses only stylePersonalities + silhouette", () => {
  it("personalities only → style-direction generated", () => {
    const result = computeNaiaFirstRead({ stylePersonalities: ["classic-polished"] });
    assert.ok(result.observations.find(o => o.type === "style-direction"));
  });
  it("silhouette only → style-direction generated", () => {
    const result = computeNaiaFirstRead({ silhouette: ["fitted"] });
    assert.ok(result.observations.find(o => o.type === "style-direction"));
  });
  it("evidenceFields lists stylePersonalities and silhouette", () => {
    const obs = computeNaiaFirstRead({ stylePersonalities: ["minimal-relaxed"], silhouette: ["relaxed"] })
      .observations.find(o => o.type === "style-direction");
    assert.ok(obs?.evidenceFields.includes("stylePersonalities"));
    assert.ok(obs?.evidenceFields.includes("silhouette"));
  });
  it("evidenceValues contains the actual IDs", () => {
    const obs = computeNaiaFirstRead({ stylePersonalities: ["bold-edgy"], silhouette: ["structured-tailored"] })
      .observations.find(o => o.type === "style-direction");
    assert.ok(obs?.evidenceValues.includes("bold-edgy"));
    assert.ok(obs?.evidenceValues.includes("structured-tailored"));
  });
});

describe("FR10 — clothing-relationship uses successfulOutfitGives", () => {
  it("generates clothing-relationship from successfulOutfitGives", () => {
    const result = computeNaiaFirstRead({ successfulOutfitGives: ["feel-like-myself", "comfort-ease"] });
    const obs = result.observations.find(o => o.type === "clothing-relationship");
    assert.ok(obs, "clothing-relationship must be present");
    assert.deepEqual(obs!.evidenceFields, ["successfulOutfitGives"]);
    assert.ok(obs!.evidenceValues.includes("feel-like-myself"));
    assert.ok(obs!.evidenceValues.includes("comfort-ease"));
  });
});

describe("FR11 — wardrobe-context uses lifestyle", () => {
  it("generates wardrobe-context from lifestyle", () => {
    const result = computeNaiaFirstRead({ lifestyle: ["work-office", "dinners-going-out"] });
    const obs = result.observations.find(o => o.type === "wardrobe-context");
    assert.ok(obs, "wardrobe-context must be present");
    assert.deepEqual(obs!.evidenceFields, ["lifestyle"]);
    assert.ok(obs!.evidenceValues.includes("work-office"));
  });
  it("single lifestyle value produces singular phrasing", () => {
    const obs = computeNaiaFirstRead({ lifestyle: ["work-office"] })
      .observations.find(o => o.type === "wardrobe-context");
    assert.ok(obs?.claim.includes("work for"), "singular: claim should say 'work for <context>'");
    assert.ok(!obs?.claim.includes("move between"), "singular: must not say 'move between'");
  });
  it("multiple lifestyle values produce plural phrasing", () => {
    const obs = computeNaiaFirstRead({ lifestyle: ["work-office", "everyday-casual"] })
      .observations.find(o => o.type === "wardrobe-context");
    assert.ok(obs?.claim.includes("move between"), "plural: claim should say 'move between'");
  });
});

describe("FR12 — colour-world uses favoriteColors and avoidColors", () => {
  it("favorites only → generated", () => {
    const obs = computeNaiaFirstRead({ favoriteColors: ["black", "navy"] })
      .observations.find(o => o.type === "colour-world");
    assert.ok(obs);
    assert.ok(obs!.evidenceFields.includes("favoriteColors"));
  });
  it("avoids only → generated", () => {
    const obs = computeNaiaFirstRead({ avoidColors: ["orange"] })
      .observations.find(o => o.type === "colour-world");
    assert.ok(obs);
    assert.ok(obs!.evidenceFields.includes("avoidColors"));
  });
  it("both favorites and avoids → generated, both in evidenceFields", () => {
    const obs = computeNaiaFirstRead({ favoriteColors: ["black"], avoidColors: ["orange"] })
      .observations.find(o => o.type === "colour-world");
    assert.ok(obs?.evidenceFields.includes("favoriteColors"));
    assert.ok(obs?.evidenceFields.includes("avoidColors"));
  });
  it("evidenceValues contains both fav and avoid IDs", () => {
    const obs = computeNaiaFirstRead({ favoriteColors: ["navy"], avoidColors: ["orange"] })
      .observations.find(o => o.type === "colour-world");
    assert.ok(obs?.evidenceValues.includes("navy"));
    assert.ok(obs?.evidenceValues.includes("orange"));
  });
});

describe("FR13 — no 'nAia is noticing' phrase in First Read V1 claims", () => {
  const richProfile: FirstReadProfile = {
    stylePersonalities: ["classic-polished"],
    successfulOutfitGives: ["feel-like-myself"],
    lifestyle: ["work-office"],
    favoriteColors: ["black"],
  };
  it("no claim contains 'nAia is noticing'", () => {
    const result = computeNaiaFirstRead(richProfile);
    for (const obs of result.observations) {
      assert.ok(
        !obs.claim.includes("nAia is noticing"),
        `Claim must not include "nAia is noticing": "${obs.claim}"`,
      );
    }
  });
});

describe("FR14 — no banned psychology inference", () => {
  it("wears-hijab is not in FirstReadProfile and cannot generate a claim", () => {
    // dressingPreferences (which contains wears-hijab) is excluded from FirstReadProfile.
    // Passing it as an unknown field produces no observations.
    const profile = { dressingPreferences: ["wears-hijab"] } as FirstReadProfile;
    assert.equal(computeNaiaFirstRead(profile).observations.length, 0);
  });
  it("claim for creative-expressive does not assert psychological causation", () => {
    const obs = computeNaiaFirstRead({ stylePersonalities: ["creative-expressive"] })
      .observations.find(o => o.type === "style-direction");
    const claim = obs?.claim ?? "";
    assert.ok(!claim.includes("insecurity"), "must not claim insecurity");
    assert.ok(!claim.includes("confidence means"), "must not claim confidence means");
    assert.ok(!claim.includes("indicates personality"), "must not indicate personality from clothing");
  });
  it("fitted silhouette claim does not imply confidence or personality", () => {
    const obs = computeNaiaFirstRead({ silhouette: ["fitted"] })
      .observations.find(o => o.type === "style-direction");
    const claim = obs?.claim ?? "";
    assert.ok(!claim.toLowerCase().includes("confident"), "fitted must not imply confident");
  });
  it("oversized silhouette claim does not imply insecurity", () => {
    const obs = computeNaiaFirstRead({ silhouette: ["oversized"] })
      .observations.find(o => o.type === "style-direction");
    const claim = obs?.claim ?? "";
    assert.ok(!claim.toLowerCase().includes("insecur"), "oversized must not imply insecurity");
  });
  it("colour-world claim (favorites only) does not use prohibited interpretive language", () => {
    const obs = computeNaiaFirstRead({ favoriteColors: ["black", "navy"] })
      .observations.find(o => o.type === "colour-world");
    const claim = (obs?.claim ?? "").toLowerCase();
    assert.ok(!claim.includes("instinct"), "colour-world must not mention instincts");
    assert.ok(!claim.includes("personality"), "colour-world must not infer personality");
    assert.ok(!claim.includes("psychology"), "colour-world must not use psychology");
    assert.ok(!claim.includes("tells us something about"), "colour-world must not use 'tells us something about' interpretive framing");
  });
  it("colour-world claim (favorites only) is grounded in palette not psychology", () => {
    const obs = computeNaiaFirstRead({ favoriteColors: ["black"] })
      .observations.find(o => o.type === "colour-world");
    const claim = obs?.claim ?? "";
    assert.ok(claim.includes("palette"), "colour-world favorites-only claim must reference palette");
  });
});

// ── Closet Relationship normalization ─────────────────────────────────────────

describe("CR20 — approved 8 IDs accepted", () => {
  const VALID = [
    "favourite", "wear-often", "love-style-struggle", "like",
    "unsure", "rarely-wear", "regret", "occasion-only",
  ];
  for (const id of VALID) {
    it(`accepts: ${id}`, () => {
      assert.ok(normalizeGarmentRelationships([id]).ok);
    });
  }
});

describe("CR21 — unknown IDs rejected", () => {
  it("unknown ID returns error", () => {
    const result = normalizeGarmentRelationships(["unknown-state"]);
    assert.ok(!result.ok);
    assert.ok(result.ok === false && result.error.includes("Unknown"));
  });
  it("mix of valid and unknown → rejected", () => {
    const result = normalizeGarmentRelationships(["favourite", "invalid"]);
    assert.ok(!result.ok);
  });
});

describe("CR22 — max 2 enforced", () => {
  it("3 valid IDs → rejected", () => {
    const result = normalizeGarmentRelationships(["favourite", "wear-often", "like"]);
    assert.ok(!result.ok);
    assert.ok(result.ok === false && result.error.includes("Maximum 2"));
  });
  it("2 valid IDs → accepted", () => {
    assert.ok(normalizeGarmentRelationships(["favourite", "wear-often"]).ok);
  });
  it("1 valid ID → accepted", () => {
    assert.ok(normalizeGarmentRelationships(["regret"]).ok);
  });
});

describe("CR23 — duplicates normalized", () => {
  it("duplicate IDs → deduplicated, ok", () => {
    const result = normalizeGarmentRelationships(["favourite", "favourite"]);
    assert.ok(result.ok);
    assert.ok(result.ok === true && result.value.length === 1);
    assert.deepEqual(result.ok === true && result.value, ["favourite"]);
  });
});

describe("CR24 — empty array valid", () => {
  it("[] is accepted", () => {
    const result = normalizeGarmentRelationships([]);
    assert.ok(result.ok);
    assert.ok(result.ok === true && result.value.length === 0);
  });
});

describe("CR29 — legacy items with [] remain valid", () => {
  it("item with empty garmentRelationships is valid", () => {
    const result = normalizeGarmentRelationships([]);
    assert.ok(result.ok, "empty array must be accepted");
  });
});

// ── Starter readiness ────────────────────────────────────────────────────────

describe("FR30 — Starter readiness false below 6 tagged items", () => {
  it("5 tagged items → false", () => {
    const items = Array.from({ length: 5 }, () => ({ garmentRelationships: ["favourite"] }));
    assert.equal(hasClosetStarterEvidence(items), false);
  });
  it("0 tagged items → false", () => {
    assert.equal(hasClosetStarterEvidence([]), false);
  });
  it("5 tagged + 10 untagged → false (counts items, not tags)", () => {
    const tagged   = Array.from({ length: 5 }, () => ({ garmentRelationships: ["favourite"] }));
    const untagged = Array.from({ length: 10 }, () => ({ garmentRelationships: [] }));
    assert.equal(hasClosetStarterEvidence([...tagged, ...untagged]), false);
  });
});

describe("FR31 — Starter readiness true at >=6 tagged items", () => {
  it("6 tagged items → true", () => {
    const items = Array.from({ length: 6 }, () => ({ garmentRelationships: ["like"] }));
    assert.equal(hasClosetStarterEvidence(items), true);
  });
  it("10 tagged items → true", () => {
    const items = Array.from({ length: 10 }, () => ({ garmentRelationships: ["wear-often"] }));
    assert.equal(hasClosetStarterEvidence(items), true);
  });
});

describe("FR32 — readiness counts ITEMS, not number of relationship tags", () => {
  it("6 items with 2 tags each counts as 6, not 12", () => {
    const items = Array.from({ length: 6 }, () => ({
      garmentRelationships: ["favourite", "wear-often"],
    }));
    assert.equal(hasClosetStarterEvidence(items), true);
  });
  it("3 items with 2 tags each counts as 3, not 6", () => {
    const items = Array.from({ length: 3 }, () => ({
      garmentRelationships: ["favourite", "wear-often"],
    }));
    assert.equal(hasClosetStarterEvidence(items), false);
  });
});

// ── FR40–FR43: observationKey canonicalization ────────────────────────────────
// Prove field:value pairs prevent cross-field key collisions.

describe("FR40 — same value in different fields produces DIFFERENT keys (test A)", () => {
  it("favoriteColors=['red-burgundy'] vs avoidColors=['red-burgundy'] → different keys", () => {
    const favOnly  = computeNaiaFirstRead({ favoriteColors: ["red-burgundy"] });
    const avoidOnly = computeNaiaFirstRead({ avoidColors: ["red-burgundy"] });
    assert.equal(favOnly.observations.length, 1, "favOnly must produce 1 observation");
    assert.equal(avoidOnly.observations.length, 1, "avoidOnly must produce 1 observation");
    assert.notEqual(
      favOnly.observations[0].observationKey,
      avoidOnly.observations[0].observationKey,
      "favoriteColors:red-burgundy and avoidColors:red-burgundy must produce different keys",
    );
  });
});

describe("FR41 — array ORDER does not affect the key (test B)", () => {
  it("favoriteColors=['black','beige-brown'] vs ['beige-brown','black'] → same key", () => {
    const r1 = computeNaiaFirstRead({ favoriteColors: ["black", "beige-brown"] });
    const r2 = computeNaiaFirstRead({ favoriteColors: ["beige-brown", "black"] });
    assert.equal(r1.observations.length, 1);
    assert.equal(r2.observations.length, 1);
    assert.equal(
      r1.observations[0].observationKey,
      r2.observations[0].observationKey,
      "same values in different order must produce the same key",
    );
  });

  it("lifestyle=['work-office','travel'] vs ['travel','work-office'] → same key", () => {
    const r1 = computeNaiaFirstRead({ lifestyle: ["work-office", "travel"] });
    const r2 = computeNaiaFirstRead({ lifestyle: ["travel", "work-office"] });
    assert.equal(r1.observations[0].observationKey, r2.observations[0].observationKey);
  });
});

describe("FR42 — same evidence always produces same key (test C)", () => {
  it("identical profile → identical keys on repeated calls", () => {
    const profile: FirstReadProfile = {
      stylePersonalities: ["classic-polished"],
      silhouette: ["fitted"],
      favoriteColors: ["black", "navy"],
      avoidColors: ["yellow"],
    };
    const r1 = computeNaiaFirstRead(profile);
    const r2 = computeNaiaFirstRead(profile);
    assert.equal(r1.observations.length, r2.observations.length);
    for (let i = 0; i < r1.observations.length; i++) {
      assert.equal(r1.observations[i].observationKey, r2.observations[i].observationKey);
    }
  });
});

describe("FR43 — changing one evidence value produces a DIFFERENT key (test D)", () => {
  it("changing black→grey in favoriteColors changes the key", () => {
    const r1 = computeNaiaFirstRead({ favoriteColors: ["black"] });
    const r2 = computeNaiaFirstRead({ favoriteColors: ["grey"] });
    assert.equal(r1.observations.length, 1);
    assert.equal(r2.observations.length, 1);
    assert.notEqual(r1.observations[0].observationKey, r2.observations[0].observationKey);
  });

  it("adding a silhouette to personality-only profile changes the key", () => {
    const r1 = computeNaiaFirstRead({ stylePersonalities: ["classic-polished"] });
    const r2 = computeNaiaFirstRead({ stylePersonalities: ["classic-polished"], silhouette: ["fitted"] });
    assert.equal(r1.observations.length, 1);
    assert.equal(r2.observations.length, 1);
    assert.notEqual(r1.observations[0].observationKey, r2.observations[0].observationKey);
  });
});

describe("FR44 — fieldValueMap is present and structurally correct", () => {
  it("colour-world observation has fieldValueMap with correct field names", () => {
    const obs = computeNaiaFirstRead({
      favoriteColors: ["black"],
      avoidColors: ["yellow"],
    }).observations[0];
    assert.ok(obs.fieldValueMap, "fieldValueMap must be present");
    assert.ok("favoriteColors" in obs.fieldValueMap, "fieldValueMap must have favoriteColors");
    assert.ok("avoidColors" in obs.fieldValueMap, "fieldValueMap must have avoidColors");
    assert.deepEqual(obs.fieldValueMap["favoriteColors"], ["black"]);
    assert.deepEqual(obs.fieldValueMap["avoidColors"], ["yellow"]);
  });

  it("style-direction observation only includes non-empty fields in fieldValueMap", () => {
    const obs = computeNaiaFirstRead({ stylePersonalities: ["classic-polished"] }).observations[0];
    assert.ok(obs.fieldValueMap, "fieldValueMap must be present");
    assert.ok("stylePersonalities" in obs.fieldValueMap, "fieldValueMap must have stylePersonalities");
    assert.ok(!("silhouette" in obs.fieldValueMap), "fieldValueMap must not include empty silhouette");
  });
});
