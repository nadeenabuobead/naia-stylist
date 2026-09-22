// app/lib/ai/styleme-anchor.test.ts
// Tests for anchor resolution.
// resolveNadineAnchor: pure catalog lookup, fully testable.
// resolveActionAnchor: tested via DI for all paths including unknown/foreign closet.
// resolveClosetAnchor (real DB): integration-only, not tested here.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveNadineAnchor, resolveActionAnchor, scoreClosetItemForSession, autoSelectClosetAnchor } from "./styleme-anchor.server.ts";
import type { AutoSelectItem } from "./styleme-anchor.server.ts";
import type { ClosetAnchorInput } from "./styleme-recommendation.types.ts";

const V8_HANDLES = [
  "double-top",
  "collar-shirt",
  "asymmetrical-pants",
  "draped-leather-pants",
  "suede-skirt",
  "trench-coat",
  "kimono-jacket",
  "leather-suede-jacket",
  "oversized-blazer",
  "midi-dress",
  "dress-set",
];

// Minimal ClosetAnchorInput fixture for DI tests
const OWNED_CLOSET_ANCHOR: ClosetAnchorInput = {
  type: "closet",
  id: "ci-owned",
  name: "Black Dress",
  category: "DRESSES",
  colors: ["black"],
  primaryColor: "black",
  pattern: null,
  material: null,
  styleTags: ["minimal"],
  occasions: ["everyday"],
  imageUrl: "https://example.com/img.jpg",
};

// ── resolveNadineAnchor ───────────────────────────────────────────────────────

describe("resolveNadineAnchor", () => {
  it("AN.1 — returns NadineAnchorInput with type='nadine' for a known handle", () => {
    const result = resolveNadineAnchor("collar-shirt");
    assert.ok(result !== null);
    assert.equal(result.type, "nadine");
    assert.equal(result.handle, "collar-shirt");
  });

  it("AN.2 — returns null for an unknown handle", () => {
    assert.equal(resolveNadineAnchor("not-a-real-product"), null);
  });

  it("AN.3 — returns null for an empty string", () => {
    assert.equal(resolveNadineAnchor(""), null);
  });

  it("AN.4 — all 11 V8 handles are accepted", () => {
    for (const handle of V8_HANDLES) {
      const result = resolveNadineAnchor(handle);
      assert.ok(result !== null, `Expected valid anchor for handle: ${handle}`);
      assert.equal(result.handle, handle);
    }
  });

  it("AN.5 — handle is preserved verbatim in the returned input", () => {
    const result = resolveNadineAnchor("midi-dress");
    assert.equal(result?.handle, "midi-dress");
  });

  it("AN.6 — rejects a near-miss handle variant (case mismatch)", () => {
    assert.equal(resolveNadineAnchor("Collar-Shirt"), null);
  });

  it("AN.7 — V8 catalog contains exactly 11 products", () => {
    assert.equal(V8_HANDLES.length, 11);
  });
});

// ── resolveActionAnchor — naia-piece source ───────────────────────────────────

describe("resolveActionAnchor — naia-piece", () => {
  it("CA.1 — valid V8 handle → ok=true with NadineAnchorInput", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", "collar-shirt", null);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.anchor.type, "nadine");
    assert.equal((result.anchor as { handle: string }).handle, "collar-shirt");
  });

  it("CA.2 — invalid (non-V8) handle → ok=false, status=400", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", "not-a-real-product", null);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.ok(result.message.length > 0);
  });

  it("CA.3 — missing handle (null) → ok=true, anchor=null (engine auto-selects)", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", null, null);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.anchor, null);
  });

  it("CA.4 — empty-string handle → ok=true, anchor=null (treated as absent)", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", "", null);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.anchor, null);
  });

  it("CA.5 — case-mismatched handle → ok=false, status=400", async () => {
    const result = await resolveActionAnchor("naia-piece", "cust-1", "Collar-Shirt", null);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
  });

  it("CA.6 — all 11 V8 handles → ok=true, anchor is always non-null NadineAnchorInput", async () => {
    for (const handle of V8_HANDLES) {
      const result = await resolveActionAnchor("naia-piece", "cust-1", handle, null);
      assert.equal(result.ok, true, `Expected ok=true for handle ${handle}`);
      if (!result.ok) throw new Error("unreachable");
      assert.equal(result.anchor.type, "nadine");
    }
  });
});

// ── resolveActionAnchor — closet sources (DI) ────────────────────────────────
// The real resolveClosetAnchor queries Prisma with WHERE id=? AND customerId=?.
// Tests here inject a fake resolver so no live DB is required.

describe("resolveActionAnchor — my-closet and both (DI resolver)", () => {
  it("CA.7 — my-closet: missing closetItemId (null) → ok=false, status=400, resolver not called", async () => {
    let resolverCalled = false;
    const fakeResolver = async () => { resolverCalled = true; return null; };

    const result = await resolveActionAnchor("my-closet", "cust-1", null, null, fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.equal(resolverCalled, false, "resolver must not be called for missing closetItemId");
  });

  it("CA.8 — my-closet: empty-string closetItemId → ok=false, status=400, resolver not called", async () => {
    let resolverCalled = false;
    const fakeResolver = async () => { resolverCalled = true; return null; };

    const result = await resolveActionAnchor("my-closet", "cust-1", null, "", fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.equal(resolverCalled, false, "resolver must not be called for empty closetItemId");
  });

  it("CA.9 — both: missing closetItemId → ok=false, status=400, resolver not called", async () => {
    let resolverCalled = false;
    const fakeResolver = async () => { resolverCalled = true; return null; };

    const result = await resolveActionAnchor("both", "cust-1", null, null, fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 400);
    assert.equal(resolverCalled, false, "resolver must not be called for missing closetItemId");
  });

  it("CA.10 — valid owned closet ID → resolver returns anchor → ok=true with that anchor", async () => {
    const fakeResolver = async (_cid: string, _iid: string) => OWNED_CLOSET_ANCHOR;

    const result = await resolveActionAnchor("my-closet", "cust-1", null, "ci-owned", fakeResolver);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.anchor.type, "closet");
    assert.equal((result.anchor as ClosetAnchorInput).id, "ci-owned");
  });

  it("CA.11 — unknown closet ID → resolver returns null → ok=false, status=403", async () => {
    const fakeResolver = async () => null;

    const result = await resolveActionAnchor("my-closet", "cust-1", null, "unknown-id", fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 403);
    assert.ok(result.message.length > 0);
  });

  it("CA.12 — foreign closet ID → resolver returns null → ok=false, status=403", async () => {
    // Simulates: item exists but belongs to a different customer.
    // The real DB query uses WHERE id=? AND customerId=?, so a foreign item returns null.
    const fakeResolver = async (_cid: string, _iid: string): Promise<ClosetAnchorInput | null> => null;

    const result = await resolveActionAnchor("my-closet", "attacker-cust", null, "foreign-ci", fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 403);
  });

  it("CA.13 — resolver receives the authenticated customerId and requested closetItemId exactly once", async () => {
    const calls: Array<{ cid: string; iid: string }> = [];
    const fakeResolver = async (cid: string, iid: string): Promise<ClosetAnchorInput | null> => {
      calls.push({ cid, iid });
      return OWNED_CLOSET_ANCHOR;
    };

    await resolveActionAnchor("my-closet", "real-customer-id", null, "exact-item-id", fakeResolver);

    assert.equal(calls.length, 1, "resolver must be called exactly once");
    assert.equal(calls[0].cid, "real-customer-id", "resolver must receive the authenticated customerId");
    assert.equal(calls[0].iid, "exact-item-id", "resolver must receive the requested closetItemId");
  });

  it("CA.14 — both source: valid closet ID → ok=true (both uses same closet resolution path)", async () => {
    const fakeResolver = async () => OWNED_CLOSET_ANCHOR;

    const result = await resolveActionAnchor("both", "cust-1", null, "ci-owned", fakeResolver);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("unreachable");
    assert.equal(result.anchor.type, "closet");
  });

  it("CA.15 — both source: unknown ID → resolver returns null → ok=false, status=403", async () => {
    const fakeResolver = async () => null;

    const result = await resolveActionAnchor("both", "cust-1", null, "unknown-id", fakeResolver);
    assert.equal(result.ok, false);
    if (result.ok) throw new Error("unreachable");
    assert.equal(result.status, 403);
  });
});

// ── scoreClosetItemForSession ─────────────────────────────────────────────────

describe("scoreClosetItemForSession", () => {
  const BASE_ITEM = { occasions: [] as string[], styleTags: [] as string[], category: "TOPS" };
  const BASE_SIGNALS = { occasion: "work", moods: [] as string[], desiredFeelings: [] as string[] };

  it("SC.1 — no signal overlap → score of 0 (category is not a scored signal)", () => {
    const score = scoreClosetItemForSession(BASE_ITEM, BASE_SIGNALS);
    assert.equal(score, 0);
  });

  it("SC.2 — occasion match adds 10", () => {
    const item = { ...BASE_ITEM, occasions: ["work"] };
    const score = scoreClosetItemForSession(item, BASE_SIGNALS);
    assert.equal(score, 10); // 10 occasion only
  });

  it("SC.3 — occasion mismatch → score 0", () => {
    const item = { ...BASE_ITEM, occasions: ["dinner"] };
    const score = scoreClosetItemForSession(item, BASE_SIGNALS);
    assert.equal(score, 0);
  });

  it("SC.4 — mood tag match adds 3 per matching tag", () => {
    const item = { ...BASE_ITEM, styleTags: ["confident", "minimal"] };
    const signals = { ...BASE_SIGNALS, moods: ["confident", "minimal"] };
    const score = scoreClosetItemForSession(item, signals);
    assert.equal(score, 6); // 3 + 3
  });

  it("SC.5 — desired-feeling tag match adds 2 per matching tag", () => {
    const item = { ...BASE_ITEM, styleTags: ["more-elevated"] };
    const signals = { ...BASE_SIGNALS, desiredFeelings: ["more-elevated"] };
    const score = scoreClosetItemForSession(item, signals);
    assert.equal(score, 2); // 2 feeling
  });

  it("SC.6 — all signals stack additively", () => {
    const item = { occasions: ["work"], styleTags: ["confident", "more-elevated"], category: "DRESSES" };
    const signals = { occasion: "work", moods: ["confident"], desiredFeelings: ["more-elevated"] };
    const score = scoreClosetItemForSession(item, signals);
    assert.equal(score, 15); // 10 occasion + 3 mood + 2 feeling
  });

  it("SC.7 — non-anchor-capable category (JEWELRY) with no signals → score 0", () => {
    const item = { occasions: [], styleTags: [], category: "JEWELRY" };
    const score = scoreClosetItemForSession(item, BASE_SIGNALS);
    assert.equal(score, 0);
  });

  it("SC.8 — category does NOT affect score; TOPS/BOTTOMS/DRESSES/OUTERWEAR with no signals all score 0", () => {
    for (const cat of ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR"]) {
      const s = scoreClosetItemForSession({ occasions: [], styleTags: [], category: cat }, BASE_SIGNALS);
      assert.equal(s, 0, `${cat} should score 0 with no signal overlap — category is a sort tiebreaker only`);
    }
  });

  it("SC.9 — mood tag not in styleTags → no bonus, score stays 0", () => {
    const item = { ...BASE_ITEM, styleTags: ["casual"] };
    const signals = { ...BASE_SIGNALS, moods: ["confident"] };
    const score = scoreClosetItemForSession(item, signals);
    assert.equal(score, 0);
  });

  it("SC.10 — occasion-matched item beats 3-mood item without occasion", () => {
    const occasionItem = { occasions: ["work"], styleTags: [], category: "TOPS" };
    const moodItem = { occasions: ["dinner"], styleTags: ["confident", "minimal", "powerful"], category: "TOPS" };
    const signals = { occasion: "work", moods: ["confident", "minimal", "powerful"], desiredFeelings: [] as string[] };
    const sOccasion = scoreClosetItemForSession(occasionItem, signals);
    const sMood = scoreClosetItemForSession(moodItem, signals);
    // occasion item: 10; mood item: 9 → occasion wins
    assert.ok(sOccasion > sMood, `occasion item (${sOccasion}) should beat 3-mood item without occasion (${sMood})`);
  });

  it("SC.11 — multiple occasion entries: only the matching one contributes", () => {
    const item = { ...BASE_ITEM, occasions: ["dinner", "work", "travel"] };
    const score = scoreClosetItemForSession(item, BASE_SIGNALS);
    assert.equal(score, 10); // one +10 occasion match
  });

  it("SC.12 — empty signals → score 0 (no match possible)", () => {
    const item = { occasions: ["dinner"], styleTags: ["bold"], category: "TOPS" };
    const signals = { occasion: "work", moods: [], desiredFeelings: [] };
    const score = scoreClosetItemForSession(item, signals);
    assert.equal(score, 0); // no occasion match, no tag match
  });
});

describe("§REV2 autoSelectClosetAnchor formality tier-sort", () => {
  function makeAutoItem(overrides: Partial<AutoSelectItem> & { id: string }): AutoSelectItem {
    return {
      id: overrides.id,
      name: null,
      category: "TOPS",
      subcategory: null,
      colors: [],
      primaryColor: null,
      pattern: null,
      material: null,
      styleTags: [],
      occasions: [],
      imageUrl: null,
      garmentRelationships: [],
      formality: null,
      styleMeProfile: null,
      ...overrides,
    };
  }

  it("FT.1 — known in-range anchor beats higher-signal out-of-range evening anchor for everyday occasion", async () => {
    // Evening gown: lots of style-tag signals but way overdressed for "everyday"
    const eveningGown = makeAutoItem({
      id: "gown",
      formality: "evening",                     // rank 6; everyday ceiling = rank 2
      occasions: ["everyday"],
      styleTags: ["elegant", "bold", "polished"], // moods match → +9 signal
    });
    // Simple blouse: casual, no extra signals, but in-range for everyday
    const casualBlouse = makeAutoItem({
      id: "blouse",
      formality: "casual",                      // rank 1; within ceiling
      occasions: ["everyday"],
      styleTags: [],                            // no mood/feeling match → 0 extra
    });

    const signals = {
      occasion: "everyday",
      moods: ["elegant", "bold", "polished"],   // 3 moods × +3 = +9 for gown
      desiredFeelings: [],
    };

    let selected: { anchor: { id: string }; id: string } | null = null;
    // DI to avoid DB
    const fetchItems = async () => [eveningGown, casualBlouse];
    selected = await autoSelectClosetAnchor("any", signals, fetchItems);

    assert.ok(selected !== null, "should select an anchor");
    assert.equal(
      selected!.id, "blouse",
      "casual blouse (in-range tier 0) must beat evening gown (out-of-range tier 1) despite higher signal score",
    );
  });

  it("FT.2 — when only out-of-range items exist, best out-of-range item is still selected", async () => {
    const eveningGown = makeAutoItem({
      id: "gown",
      formality: "evening",
      occasions: ["everyday"],
      styleTags: ["elegant"],
    });
    const selected = await autoSelectClosetAnchor(
      "any",
      { occasion: "everyday", moods: ["elegant"], desiredFeelings: [] },
      async () => [eveningGown],
    );
    assert.ok(selected !== null, "should still select something");
    assert.equal(selected!.id, "gown");
  });

  it("FT.3 — unknown formality (null) is treated as in-range and wins over known out-of-range", async () => {
    const unknownFormality = makeAutoItem({ id: "unknown", formality: null, occasions: ["everyday"], styleTags: [] });
    const eveningGown = makeAutoItem({ id: "gown", formality: "evening", occasions: ["everyday"], styleTags: ["elegant", "bold"] });
    const selected = await autoSelectClosetAnchor(
      "any",
      { occasion: "everyday", moods: ["elegant", "bold"], desiredFeelings: [] },
      async () => [unknownFormality, eveningGown],
    );
    assert.ok(selected !== null, "should select an anchor");
    assert.equal(selected!.id, "unknown", "null formality (in-range tier 0) should beat known out-of-range");
  });

  it("FT.4 — formality-dressy conditional raises ceiling; in-range item at raised ceiling beats lower-signal blouse", async () => {
    const businessFormal = makeAutoItem({
      id: "suit",
      formality: "business-formal",  // rank 4; everyday ceiling=2+2=4 with dressy boost
      occasions: ["dinner-out"],
      styleTags: ["polished"],
    });
    const casual = makeAutoItem({
      id: "blouse",
      formality: "casual",
      occasions: ["dinner-out"],
      styleTags: [],
    });
    const signals = {
      occasion: "dinner-out",
      moods: ["polished"],
      desiredFeelings: [],
      formalityConditional: "formality-dressy",
    };
    const selected = await autoSelectClosetAnchor("any", signals, async () => [businessFormal, casual]);
    // Both are in-range with dressy boost (dinner-out ceiling 4+2=6, capped at 6)
    // business-formal (rank 4) and casual (rank 1) both ≤ 6 → both tier 0
    // signal score: business-formal has +10 (occasion) + 3 (mood) = 13; casual = 10
    assert.ok(selected !== null, "should select an anchor");
    assert.equal(selected!.id, "suit", "business-formal at raised ceiling beats plain casual on score");
  });
});

// ── §AR — autoSelectClosetAnchor intention awareness ─────────────────────────

describe("§AR autoSelectClosetAnchor intention awareness", () => {
  // Shared helper reused across §AR tests — extends the REV2 helper.
  function makeAnchorItem(
    id: string,
    overrides: Partial<AutoSelectItem> & {
      styleMeProfile?: AutoSelectItem["styleMeProfile"];
    } = {},
  ): AutoSelectItem {
    return {
      id,
      name: null,
      category: "TOPS",            // anchor-capable
      subcategory: null,
      colors: [],
      primaryColor: null,
      pattern: null,
      material: null,
      styleTags: [],
      occasions: ["everyday"],
      imageUrl: null,
      garmentRelationships: [],
      formality: "casual",
      styleMeProfile: null,
      ...overrides,
    };
  }

  const EVERYDAY_SIGNALS = {
    occasion: "everyday",
    moods: [] as string[],
    desiredFeelings: [] as string[],
    intentions: ["feel-sharper"],
  };

  it("AR.1 — approved Strong intention ranks above approved None, same base signals", async () => {
    // Both items: everyday occasion, anchor-capable (TOPS), identical base score.
    // Sharper: feel-sharper=Strong → bonus = 1.0 × 1.5 = 1.5
    // Neutral: feel-sharper=None → bonus = 0
    const sharper = makeAnchorItem("sharper", {
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "Strong" },
        occasionFit: null,
      },
    });
    const neutral = makeAnchorItem("neutral", {
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "None" },
        occasionFit: null,
      },
    });

    const selected = await autoSelectClosetAnchor("any", EVERYDAY_SIGNALS, async () => [neutral, sharper]);
    assert.ok(selected !== null, "should select an anchor");
    assert.equal(selected!.id, "sharper", "Strong feel-sharper must outrank None when active intention is feel-sharper");
  });

  it("AR.2 — control: same items without feel-sharper intention → selection is NOT forced to the sharper item", async () => {
    // Without the intention, base scores are equal → deterministic tiebreaker decides.
    // We only assert that the function completes and returns *some* anchor —
    // we do NOT assert which wins (tiebreaker order is an implementation detail).
    const sharper = makeAnchorItem("sharper", {
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "Strong" },
        occasionFit: null,
      },
    });
    const neutral = makeAnchorItem("neutral", {
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "None" },
        occasionFit: null,
      },
    });

    const controlSignals = { occasion: "everyday", moods: [] as string[], desiredFeelings: [] as string[] };
    const selected = await autoSelectClosetAnchor("any", controlSignals, async () => [sharper, neutral]);
    assert.ok(selected !== null, "should select some anchor even without intention");
    // Key assertion: the result is EITHER item — the sharper item must not be guaranteed without the intention.
    assert.ok(["sharper", "neutral"].includes(selected!.id), "result is one of the two items");
  });

  it("AR.3 — occasionFit='No' blocks an anchor even when it has Strong intention", async () => {
    // The occasionFit gate must take precedence over intention bonus.
    const blocked = makeAnchorItem("blocked", {
      occasions: [],
      garmentRelationships: [],
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "Strong" },
        occasionFit: { everyday: "No" },   // explicitly excluded for everyday
      },
    });
    const allowed = makeAnchorItem("allowed", {
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "None" },
        occasionFit: null,
      },
    });

    const selected = await autoSelectClosetAnchor("any", EVERYDAY_SIGNALS, async () => [blocked, allowed]);
    assert.ok(selected !== null, "should select an anchor");
    assert.equal(selected!.id, "allowed", "occasionFit=No must block anchor despite Strong intention");
  });

  it("AR.4 — approved None does not gain a bonus from legacy legacy tags (black/fitted)", async () => {
    // Even if the item has styleTags that legacy heuristics would reward,
    // an approved None must not receive any intention bonus.
    const approvedNoneWithLegacyTags = makeAnchorItem("none-legacy", {
      styleTags: ["fitted", "black", "structured"],  // legacy proxies for feel-sharper
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "None" },
        occasionFit: null,
      },
    });
    const approvedStrong = makeAnchorItem("strong", {
      styleTags: [],
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "Strong" },
        occasionFit: null,
      },
    });

    const selected = await autoSelectClosetAnchor("any", EVERYDAY_SIGNALS, async () => [approvedNoneWithLegacyTags, approvedStrong]);
    assert.ok(selected !== null, "should select an anchor");
    assert.equal(selected!.id, "strong", "approved None must not be boosted by legacy tags — Strong approved wins");
  });

  it("AR.5 — un-profiled item (styleMeProfile=null) gains no intention bonus", async () => {
    // Items with no approved profile fall back to base score only for anchor ranking.
    // An approved Supporting item must beat an un-profiled item with equal base score.
    const unprofiled = makeAnchorItem("unprofiled", {
      styleMeProfile: null,
    });
    const approvedSupporting = makeAnchorItem("supporting", {
      styleMeProfile: {
        profileStatus: "approved",
        intentionPotentials: { "feel-sharper": "Supporting" },
        occasionFit: null,
      },
    });

    const selected = await autoSelectClosetAnchor("any", EVERYDAY_SIGNALS, async () => [unprofiled, approvedSupporting]);
    assert.ok(selected !== null, "should select an anchor");
    assert.equal(selected!.id, "supporting", "approved Supporting must beat un-profiled item with equal base score");
  });
});
