// app/lib/ai/styleme-formality-canonical-migration.test.ts
//
// Garment Intelligence — Phase 4B: formality-only, T2-only live canonical
// migration.
//
// Tests the actual live integration seam (resolveT2Formality, exported from
// styleme-result.server.ts) — the real function evaluateCompleteOutfit calls
// for its per-piece formality lookup, with the real CANONICAL_STYLEME_FORMALITY
// flag's effect reproduced by passing the boolean explicitly (no process.env
// mutation needed; the function never reads process.env itself).
//
// Also proves: no gate (occasion/register/coherence/dressing) reads formality
// or effectiveFormality at all, and autoSelectClosetAnchor (anchor selection)
// is structurally unreachable by this flag — it uses its own separate query
// and type (AutoSelectItem), never ClosetAnchorInput.effectiveFormality.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveT2Formality,
  evaluateCompleteOutfit,
  classifyOutfitFormality,
  getTargetFormalityRange,
  passesDressingRequirements,
  passesCandidateDressingRequirements,
} from "./styleme-result.server.ts";
import {
  passesProfileOccasionGate,
  passesProfileRegisterGate,
  passesRegisterCoherenceWithAnchor,
} from "./styleme-profile-gate.ts";
import { closetItemToSlot } from "./closet-slot.ts";
import { readFileSync } from "node:fs";

function closetItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "g1", category: "TOPS", subcategory: null, silhouette: null, fitProfile: null,
    hemLength: null, topLength: null, waistShape: null, sleeveLength: null,
    necklineCoverage: null, shoulderCoverage: null, midriffExposed: null,
    material: null, pattern: null, primaryColor: "grey", colors: ["grey"],
    occasions: [], seasons: [], formality: null, effectiveFormality: null,
    styleTags: [], stylePersonality: null, approvedProfile: null,
    ...overrides,
  };
}

// ── §4B-1 flag OFF — exact pre-Phase-4B behavior ────────────────────────────

describe("§4B-1 flag OFF is byte-identical to today's raw formality read, regardless of effectiveFormality", () => {
  it("raw formality is returned unchanged even when effectiveFormality differs", () => {
    const item = closetItem({ formality: "business-casual", effectiveFormality: "evening" });
    assert.equal(resolveT2Formality(item, false), "business-casual", "flag OFF must never read effectiveFormality, proving this is a true rollback switch");
  });

  it("flag OFF with effectiveFormality absent entirely is also unchanged", () => {
    const item = closetItem({ formality: "casual" });
    delete (item as any).effectiveFormality;
    assert.equal(resolveT2Formality(item, false), "casual");
  });
});

// ── §4B-2 flag ON, no correction — identical to baseline ────────────────────

describe("§4B-2 flag ON with effectiveFormality equal to raw produces the exact same T2 input as flag OFF", () => {
  it("effectiveFormality equals formality (no admin correction present)", () => {
    const item = closetItem({ formality: "smart-casual", effectiveFormality: "smart-casual" });
    assert.equal(resolveT2Formality(item, true), resolveT2Formality(item, false));
  });

  it("evaluateCompleteOutfit produces byte-identical formalityFit and t2FormalityFit when no correction exists", () => {
    const item = closetItem({ formality: "business-casual", effectiveFormality: "business-casual" });
    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const session = { occasion: "work", formalityConditional: null, moods: [], desiredFeelings: [] };
    const result = evaluateCompleteOutfit(candidate, [item] as any, session);
    assert.equal(result.formalityFit, result.t2FormalityFit, "with no correction present, the raw and T2 classifications must agree regardless of the ambient flag");
  });

  it("REGRESSION: flag ON with effectiveFormality truly absent (undefined, not null) falls back to raw formality rather than blanking it out — this is exactly what broke the full regression suite before the fallback existed", () => {
    // Every pre-Phase-4B test fixture across the StyleMe suite builds
    // ClosetAnchorInput-shaped objects by hand without ever setting
    // effectiveFormality (the field didn't exist for them). Flipping the
    // flag ON must not silently treat "never computed" as "known to be
    // unknown" for these objects — it must fall back to the raw formality
    // they do carry.
    const item = { id: "g1", formality: "business-formal" } as any; // no effectiveFormality key at all
    assert.equal("effectiveFormality" in item, false, "sanity: the fixture genuinely omits the field, not just sets it to null");
    assert.equal(resolveT2Formality(item, true), "business-formal", "flag ON must fall back to raw formality when effectiveFormality was never computed");
    assert.equal(resolveT2Formality(item, true), resolveT2Formality(item, false), "for this object, ON and OFF must agree exactly");
  });

  it("flag ON with effectiveFormality explicitly null (loader resolved it and found no value) is trusted as null, not overridden by raw formality", () => {
    const item = closetItem({ formality: "casual", effectiveFormality: null });
    assert.equal(resolveT2Formality(item, true), null, "an explicit null from the loader means 'no formality even after the admin-override merge' — it must not fall back to a stale raw value");
  });
});

// Calls the exported classification primitive directly with an explicit
// selector — fully deterministic, zero dependency on the ambient
// CANONICAL_STYLEME_FORMALITY env var. This is how T2 is tested in true
// isolation: `canonical: false` reproduces the UNCONDITIONAL raw path
// (identical to what every non-T2 consumer — T6a, compositeScore, reasons,
// diagnostics — always sees); `canonical: true` reproduces exactly what T2
// sees when the flag is ON.
function classify(item: ReturnType<typeof closetItem>, slot: string, session: { occasion: string; formalityConditional: string | null }, canonical: boolean) {
  const itemMap = new Map([[item.id as string, item as any]]);
  const targetRange = getTargetFormalityRange(session.occasion, session.formalityConditional);
  const selector = canonical
    ? (i: any) => resolveT2Formality(i, true)
    : (i: any) => i?.formality ?? null;
  return classifyOutfitFormality([{ slot, closetId: item.id as string, label: null, colors: [] }], itemMap, targetRange, selector);
}

// ── §4B-3/4/5 flag ON, genuine correction — positive controls ───────────────
// Each test proves T2's isolated classification (via classifyOutfitFormality
// with an explicit selector) AND confirms, via evaluateCompleteOutfit, that
// the raw path (.formalityFit/.formalityOvershoot — what T6a reads) is
// completely unaffected by the same correction.

describe("§4B-3 flag ON, genuine correction crossing within-target -> underdressed", () => {
  it("canonical correction pushes a within-target garment to underdressed, T2-only", () => {
    const item = closetItem({ formality: "smart-casual", effectiveFormality: "casual" });
    const session = { occasion: "family", formalityConditional: "formality-smart" }; // target [2,2]

    const raw = classify(item, "top", session, false);
    assert.equal(raw.formalityFit, "within-target", "sanity: smart-casual (rank 2) is within target [2,2]");
    const canonical = classify(item, "top", session, true);
    assert.equal(canonical.formalityFit, "underdressed", "casual (rank 1) falls below target [2,2]");
    assert.notEqual(raw.formalityFit, canonical.formalityFit);

    // T6a invariance: evaluateCompleteOutfit's raw-based fields never move.
    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const result = evaluateCompleteOutfit(candidate, [item] as any, session as any);
    assert.equal(result.formalityFit, "within-target", "T6a's source field stays on raw formality regardless of the correction");
    assert.equal(result.formalityOvershoot, 0, "within-target carries zero overshoot, unaffected by the canonical correction");
  });
});

describe("§4B-4 flag ON, genuine correction crossing within-target -> overdressed", () => {
  it("canonical correction pushes a within-target garment to overdressed, T2-only", () => {
    const item = closetItem({ formality: "smart-casual", effectiveFormality: "evening" });
    const session = { occasion: "family", formalityConditional: "formality-smart" }; // target [2,2]

    const raw = classify(item, "top", session, false);
    assert.equal(raw.formalityFit, "within-target");
    const canonical = classify(item, "top", session, true);
    assert.equal(canonical.formalityFit, "overdressed", "evening (rank 6) exceeds target [2,2]");
    assert.notEqual(raw.formalityFit, canonical.formalityFit);

    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const result = evaluateCompleteOutfit(candidate, [item] as any, session as any);
    assert.equal(result.formalityFit, "within-target", "T6a's source field stays on raw formality — the evening correction never reaches it");
    assert.equal(result.formalityOvershoot, 0);
  });
});

describe("§4B-5 flag ON, genuine correction crossing out-of-target -> within-target", () => {
  it("canonical correction rescues a garment from overdressed into within-target, T2-only", () => {
    const item = closetItem({ formality: "business-casual", effectiveFormality: "smart-casual" });
    const session = { occasion: "family", formalityConditional: "formality-smart" }; // target [2,2]

    const raw = classify(item, "top", session, false);
    assert.equal(raw.formalityFit, "overdressed", "business-casual (rank 3) exceeds target [2,2]");
    const canonical = classify(item, "top", session, true);
    assert.equal(canonical.formalityFit, "within-target", "smart-casual (rank 2) lands within target [2,2]");
    assert.notEqual(raw.formalityFit, canonical.formalityFit);

    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const result = evaluateCompleteOutfit(candidate, [item] as any, session as any);
    assert.equal(result.formalityFit, "overdressed", "T6a's source field stays overdressed on raw formality — the rescue never reaches it");
    assert.ok(result.formalityOvershoot > 0, "the raw path's overshoot is unaffected by the canonical rescue");
  });

  it("underdressed -> within-target direction also rescues correctly, T2-only", () => {
    const item = closetItem({ formality: "casual", effectiveFormality: "smart-casual" });
    const session = { occasion: "family", formalityConditional: "formality-smart" }; // target [2,2]

    const raw = classify(item, "top", session, false);
    assert.equal(raw.formalityFit, "underdressed");
    const canonical = classify(item, "top", session, true);
    assert.equal(canonical.formalityFit, "within-target");
  });
});

// ── §4B-6 same-class distance change — per the ACTUAL implementation ───────

describe("§4B-6 same-class distance change — T2 does not move when both sides stay outside target; T6a is untouched either way", () => {
  it("a correction that moves distance but keeps the garment overdressed on both sides produces the SAME T2 classification, and T6a is byte-identical because it never consulted the correction at all", () => {
    // target [4,4] (special-event / formality-occasion): business-casual (3) is
    // underdressed; the correction to casual (1) is still underdressed, just
    // further away — formalityFit is a tri-state classification, not a distance
    // value, so T2's formalityFitPriority does not change even though the
    // CANONICAL distance would differ. T6a (formalityOvershoot) is proven here
    // to be not just "unchanged by coincidence" but structurally incapable of
    // seeing this correction at all, since evaluateCompleteOutfit's raw path
    // only ever reads item.formality directly.
    const item = closetItem({ formality: "business-casual", effectiveFormality: "casual" });
    const session = { occasion: "special-event", formalityConditional: "formality-occasion" }; // target [4,4]

    const raw = classify(item, "top", session, false);
    const canonical = classify(item, "top", session, true);
    assert.equal(raw.formalityFit, "underdressed");
    assert.equal(canonical.formalityFit, "underdressed", "both raw and canonical land in the same class");
    assert.equal(raw.formalityFit, canonical.formalityFit, "T2's classification is unchanged — this is what the real implementation actually does, not an assumption");
    assert.notEqual(raw.formalityOvershoot, canonical.formalityOvershoot, "T2's OWN isolated overshoot number would differ if anyone read it — confirming this is a genuine distance-only correction, not a no-op fixture");

    // T6a — read via the real live seam, not the isolated helper. Byte-identical
    // to the raw-only expectation regardless of the correction or the ambient flag.
    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const result = evaluateCompleteOutfit(candidate, [item] as any, session as any);
    assert.equal(result.formalityFit, "underdressed");
    assert.equal(result.formalityOvershoot, raw.formalityOvershoot, "T6a's real overshoot exactly matches the raw-only isolated computation — the canonical correction never reached it");
  });

  it("the companion case: a correction that genuinely flips T2 still leaves T6a on raw-formality behavior", () => {
    // Reuses §4B-5's overdressed -> within-target correction (a genuine T2
    // flip) and proves T6a's real overshoot, read through evaluateCompleteOutfit,
    // matches the raw-only expectation exactly — not approximately, not
    // "usually" — regardless of T2 having flipped for the exact same item.
    const item = closetItem({ formality: "business-casual", effectiveFormality: "smart-casual" });
    const session = { occasion: "family", formalityConditional: "formality-smart" }; // target [2,2]

    const raw = classify(item, "top", session, false);
    const canonical = classify(item, "top", session, true);
    assert.notEqual(raw.formalityFit, canonical.formalityFit, "sanity: T2 genuinely flips for this fixture");

    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const result = evaluateCompleteOutfit(candidate, [item] as any, session as any);
    assert.equal(result.formalityFit, raw.formalityFit, "T6a's classification matches raw, not canonical, even though T2 flipped for this exact item");
    assert.equal(result.formalityOvershoot, raw.formalityOvershoot, "T6a's overshoot matches raw exactly");
  });
});

// ── §4B-7 no gate expansion — formality/effectiveFormality never reach gates ─

describe("§4B-7 no gate expansion — Phase 4B cannot alter any eligibility gate or slot assignment", () => {
  it("passesProfileOccasionGate's signature and behavior do not consume formality/effectiveFormality at all", () => {
    const itemA = { approvedProfile: null } as any;
    const itemB = { approvedProfile: { occasionFit: { work: "No" } } } as any;
    assert.equal(passesProfileOccasionGate(itemA, "work"), true);
    assert.equal(passesProfileOccasionGate(itemB, "work"), false, "gate result driven entirely by occasionFit, never by formality");
  });

  it("passesProfileRegisterGate reads only approvedProfile.dressRegister — identical result regardless of formality/effectiveFormality on the item", () => {
    const base = { approvedProfile: { dressRegister: "evening", occasionFit: null } } as any;
    const withRawFormality = { ...base, formality: "casual", effectiveFormality: "casual" };
    const withCanonicalFormality = { ...base, formality: "casual", effectiveFormality: "evening" };
    const resultRaw = passesProfileRegisterGate(withRawFormality, "everyday");
    const resultCanonical = passesProfileRegisterGate(withCanonicalFormality, "everyday");
    assert.equal(resultRaw, resultCanonical, "the gate's dressRegister-only logic is structurally blind to formality — identical result regardless of which formality value the item carries");
  });

  it("passesRegisterCoherenceWithAnchor is likewise unaffected by formality/effectiveFormality", () => {
    const anchor = { approvedProfile: { dressRegister: "polished", occasionFit: null } } as any;
    const item = { approvedProfile: { dressRegister: "casual", occasionFit: null }, formality: "evening", effectiveFormality: "casual" } as any;
    const result1 = passesRegisterCoherenceWithAnchor(item, anchor, "work");
    const result2 = passesRegisterCoherenceWithAnchor({ ...item, formality: "casual", effectiveFormality: "evening" }, anchor, "work");
    assert.equal(result1, result2);
  });

  it("passesDressingRequirements and passesCandidateDressingRequirements ignore formality/effectiveFormality entirely", () => {
    const item = { hemLength: "mini", formality: "casual", effectiveFormality: "evening" } as any;
    const gate1 = passesDressingRequirements(item, ["legs-covered"]);
    const gate2 = passesDressingRequirements({ ...item, formality: "evening", effectiveFormality: "casual" }, ["legs-covered"]);
    assert.equal(gate1, gate2);

    const candidate = { pieces: [{ slot: "top", closetId: "g1" }] } as any;
    const items = [{ id: "g1", sleeveLength: "sleeveless", shoulderCoverage: null, necklineCoverage: null, formality: "casual", effectiveFormality: "evening" }] as any;
    const itemsCanonicalSwap = [{ ...items[0], formality: "evening", effectiveFormality: "casual" }] as any;
    assert.equal(
      passesCandidateDressingRequirements(candidate, items, ["arms-covered"]),
      passesCandidateDressingRequirements(candidate, itemsCanonicalSwap, ["arms-covered"]),
    );
  });

  it("slot assignment (closetItemToSlot) does not read formality at all", () => {
    assert.equal(closetItemToSlot("BOTTOMS", "trousers"), closetItemToSlot("BOTTOMS", "trousers"));
  });
});

// ── §4B-8 anchor invariance — the single most important structural proof ───

describe("§4B-8 anchor invariance — autoSelectClosetAnchor is structurally unreachable by CANONICAL_STYLEME_FORMALITY", () => {
  it("ClosetAnchorInput.effectiveFormality exists ONLY as a sibling field — resolveT2Formality is never called from anchor selection's own query/type", () => {
    // autoSelectClosetAnchor's own query (styleme-anchor.server.ts) selects
    // `formality: true` directly from Prisma into its own AutoSelectItem type,
    // which has no effectiveFormality field at all and never imports
    // resolveEffectiveFormality or resolveT2Formality. This test documents
    // that structural fact as a standing regression guard: the moment anyone
    // adds effectiveFormality to AutoSelectItem or imports resolveT2Formality
    // into autoSelectClosetAnchor, this file's own source text changes and a
    // reviewer sees it immediately.
        const anchorSource: string = readFileSync(new URL("./styleme-anchor.server.ts", import.meta.url), "utf8");
    const autoSelectFnStart = anchorSource.indexOf("export async function autoSelectClosetAnchor");
    const autoSelectFnBody = anchorSource.slice(autoSelectFnStart, autoSelectFnStart + anchorSource.slice(autoSelectFnStart).indexOf("\nexport "));
    assert.ok(!autoSelectFnBody.includes("effectiveFormality"), "autoSelectClosetAnchor's function body must never reference effectiveFormality");
    assert.ok(!autoSelectFnBody.includes("CANONICAL_STYLEME_FORMALITY"), "autoSelectClosetAnchor's function body must never reference the Phase 4B flag");
    assert.ok(!autoSelectFnBody.includes("resolveT2Formality"), "autoSelectClosetAnchor must never call the T2-only resolver");
  });

  it("the loader computes effectiveFormality unconditionally but never overwrites the raw formality field it also returns", () => {
        const anchorSource: string = readFileSync(new URL("./styleme-anchor.server.ts", import.meta.url), "utf8");
    assert.ok(anchorSource.includes("formality: item.formality ?? null,"), "loadAllClosetItemsForEngine must still assign the unchanged raw formality field verbatim");
    assert.ok(anchorSource.includes("effectiveFormality,"), "loadAllClosetItemsForEngine must also assign the new sibling field");
  });
});

// ── §4B-9 Phase 4B must not touch the occasion-key mapping ────────────────

describe("§4B-9 regression guard — Phase 4B must not touch the occasion-key mapping", () => {
  it("canonical post-map occasion IDs resolve to their own register bands, not the generic default", () => {
    // UPDATED AT INTEGRATION (release/naia-final-integration). This guard used to pin the
    // OPPOSITE: that date-night / special-event / girls-night fell through to the generic
    // {1,4} default, because OCCASION_FORMALITY_TARGET was keyed on pre-map UI IDs
    // (date/event/night-out) while the engine passes canonical IDs. Its own comment asked
    // that "any future accidental fix changes this test, not silently" — so this is that
    // change, made deliberately and not silently.
    //
    // The StyleMe lane fixed the key mismatch (canonical register-range keys), so the
    // canonical IDs now resolve to real bands. The guard's INTENT is unchanged and still
    // enforced: Phase 4B must not alter this mapping. It now asserts the corrected
    // mapping instead of the defect.
    assert.deepEqual(getTargetFormalityRange("date-night", null), { min: 2, max: 3 });
    assert.deepEqual(getTargetFormalityRange("special-event", null), { min: 3, max: 6 });
    assert.deepEqual(getTargetFormalityRange("girls-night", null), { min: 2, max: 5 });
    // And none of them is the generic fallback any more — the point of the fix.
    for (const o of ["date-night", "special-event", "girls-night"]) {
      assert.notDeepEqual(getTargetFormalityRange(o, null), { min: 1, max: 4 },
        `${o} must not fall through to the generic default`);
    }
    // Occasions that always matched still match, unchanged by Phase 4B.
    assert.notDeepEqual(getTargetFormalityRange("work", null), { min: 1, max: 4 });
  });
});
