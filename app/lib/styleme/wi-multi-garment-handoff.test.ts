// app/lib/styleme/wi-multi-garment-handoff.test.ts
//
// "Style This Look" used to transfer only the first garment of a Wardrobe
// Intelligence combination — the rest were silently dropped
// (api.wi-style-this.tsx used to send only look.garmentIds[0]). This file
// pins the fix: every garment in a WI combination ("companions") must
// survive, validated, into every candidate the engine can produce — never
// silently dropped, never silently swapped, and never exempt from the same
// strict eligibility gates the single anchor has always gone through.
//
// THE CORE CLAIM, tested exhaustively below: for a session carrying
// closetCompanionIds, NO candidate among A, B, C, D or E ever omits a
// companion UNLESS the whole candidate is correctly excluded for being
// unable to preserve it (Candidate C/D with the companion as the only
// outerwear) — never a silent drop.

// Side-effect import, evaluated before the session.server import below — see
// ensure-session-secret.server.ts. A plain statement here (as this file used
// to have) does not actually run first under ESM's import hoisting — static
// imports are evaluated ahead of a module's own top-level statements
// regardless of source position, not the other way around. That didn't
// matter while session.server.ts fell back to "default-secret-change-me"
// when unset; it does now that it fails closed instead.
import "../ensure-session-secret.server";

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildNaiaOutfitCandidates,
  computeNaiaResultDirections,
  computeStyleMeResult,
  buildDbPayload,
} from "../ai/styleme-result.server.js";
import { parseClosetCompanionIds, getSession, commitSession } from "../session.server.js";
import { dedupeGarmentIds, findConflictingSlot } from "~/routes/api.wi-style-this";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ClosetAnchorInput, NormalizedClosetAnchor, StyleMeSessionInput, OutfitCandidate,
} from "../ai/styleme-recommendation.types.js";

// ── fixture builders (same convention as candidate-swap-pool-gating.test.ts) ──

const prof = (dressRegister: string, occasionFit: Record<string, string>) =>
  ({ dressRegister, occasionFit }) as unknown as ClosetAnchorInput["approvedProfile"];

function g(o: Partial<ClosetAnchorInput> & { id: string; category: string }): ClosetAnchorInput {
  return {
    type: "closet", name: o.id, subcategory: null, colors: ["black"], primaryColor: "black",
    pattern: null, material: null, styleTags: [], occasions: [],
    imageUrl: null, garmentRelationships: [], formality: "business-casual", fitProfile: null,
    waistShape: null, sleeveLength: null, necklineCoverage: null, hemLength: null, topLength: null,
    shoulderCoverage: null, midriffExposed: null, silhouette: null, stylePersonality: null,
    approvedProfile: null, ...o,
  } as ClosetAnchorInput;
}

const S = (occasion: string, formalityConditional: string | null, bodyNeeds = ["nothing-specific"]): StyleMeSessionInput => ({
  moods: [], desiredFeelings: [], bodyNeeds, coverageConditional: null,
  occasion, formalityConditional, todayColours: { preferred: [], avoid: [] },
  practicalIds: [], source: "my-closet", state: "nothing-in-particular", intentions: [],
} as unknown as StyleMeSessionInput);

const A = (id: string, slot: string) => ({
  type: "closet", id, slot, label: id, colors: ["black"], material: null, styleTags: [], imageUrl: null,
} as unknown as NormalizedClosetAnchor);

const build = (
  anchor: NormalizedClosetAnchor, sess: StyleMeSessionInput, items: ClosetAnchorInput[], companionIds?: string[],
) =>
  buildNaiaOutfitCandidates(anchor, sess, items, undefined, undefined, undefined, companionIds)
    .filter((c): c is OutfitCandidate => c !== null);

const allPieces = (cands: OutfitCandidate[]) =>
  cands.flatMap((c) => c.pieces.map((p) => ({ cand: c.id, id: p.closetId, slot: p.slot })));

// A realistic WI "top + bottom" combination plus enough closet depth that B/C/D/E
// actually have alternatives to explore — otherwise every assertion here would
// pass trivially because only candidate A ever gets produced.
function wiCloset() {
  return [
    g({ id: "wi-top", category: "TOPS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "wi-bottom", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    // Alternatives so B/E have something to explore away from A.
    g({ id: "alt-shoe-1", category: "SHOES", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "alt-shoe-2", category: "SHOES", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "alt-bag", category: "BAGS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    // Discretionary outerwear — makes candidates C/D exist in the base case.
    g({ id: "wi-layer", category: "OUTERWEAR", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
  ];
}

// ── WMG-A: every candidate preserves the full companion set ──────────────────

describe("WMG-A — candidate A always carries the anchor and every companion", () => {
  const items = wiCloset();
  const sess = S("dinner", "formality-smart");
  const anchor = A("wi-top", "top");

  test("WMG-A.1 candidate A's pieces include both the anchor and the companion", () => {
    const [candidateA] = build(anchor, sess, items, ["wi-bottom"]);
    const ids = candidateA.pieces.map((p) => p.closetId);
    assert.ok(ids.includes("wi-top"), "anchor must be present");
    assert.ok(ids.includes("wi-bottom"), "companion must be present, not dropped");
  });

  test("WMG-A.2 a three-garment combination (layer + top + bottom) all survive in A", () => {
    const [candidateA] = build(anchor, sess, items, ["wi-bottom", "wi-layer"]);
    const ids = candidateA.pieces.map((p) => p.closetId);
    assert.deepEqual(
      new Set(ids.filter((id) => ["wi-top", "wi-bottom", "wi-layer"].includes(id))),
      new Set(["wi-top", "wi-bottom", "wi-layer"]),
      `all three selected garments must be present; got ${ids.join(",")}`,
    );
  });

  test("WMG-A.3 nothing else is auto-selected into the companion's own slot", () => {
    const [candidateA] = build(anchor, sess, items, ["wi-bottom"]);
    const bottoms = candidateA.pieces.filter((p) => p.slot === "bottom");
    assert.equal(bottoms.length, 1, "exactly one bottom — the companion, not a second auto-picked one");
    assert.equal(bottoms[0].closetId, "wi-bottom");
  });
});

describe("WMG-B — no candidate (A–E) ever silently drops a companion", () => {
  const items = wiCloset();
  const sess = S("dinner", "formality-smart");
  const anchor = A("wi-top", "top");

  test("WMG-B.1 every produced candidate's pieces include the companion", () => {
    const cands = build(anchor, sess, items, ["wi-bottom"]);
    assert.ok(cands.length > 0, "sanity: candidates must be produced");
    const offenders = cands.filter((c) => !c.pieces.some((p) => p.closetId === "wi-bottom"));
    assert.deepEqual(
      offenders.map((c) => c.id), [],
      `candidate(s) ${offenders.map((c) => c.id).join(",")} dropped the required companion`,
    );
  });

  test("WMG-B.2 candidate B never swaps the companion's slot for an alternative", () => {
    const cands = build(anchor, sess, items, ["wi-bottom"]);
    const b = cands.find((c) => c.id === "B");
    if (!b) return; // B is not always produced; nothing to assert when absent
    const bottom = b.pieces.find((p) => p.slot === "bottom");
    assert.equal(bottom?.closetId, "wi-bottom", "B must keep the companion's slot locked, exactly like the anchor's");
  });

  test("WMG-B.3 candidate E's slot-swap exploration never touches the companion's slot", () => {
    // E needs a Step 3 or intention signal to run at all.
    const sessWithIntent = S("dinner", "formality-smart", ["still-want-shape"]);
    const cands = build(anchor, sessWithIntent, items, ["wi-bottom"]);
    const e = cands.find((c) => c.id === "E");
    if (!e) return; // E is conditional; nothing to assert when absent
    const bottom = e.pieces.find((p) => p.slot === "bottom");
    assert.equal(bottom?.closetId, "wi-bottom", "E must never swap away the companion's slot");
  });
});

// ── WMG-C: Candidate C/D exclusion, not silent stripping ─────────────────────

describe("WMG-C — a companion that is the removable outerwear excludes C/D instead of dropping it", () => {
  const items = wiCloset();
  const sess = S("dinner", "formality-smart");
  const anchor = A("wi-top", "top");

  test("WMG-C.1 with the layer as a companion, candidate C is never produced", () => {
    const cands = build(anchor, sess, items, ["wi-bottom", "wi-layer"]);
    const c = cands.find((cand) => cand.id === "C");
    assert.equal(c, undefined, "C would have to drop the required-companion layer to exist, so it must not be produced");
  });

  test("WMG-C.2 with the layer as a companion, candidate D is never produced", () => {
    const cands = build(anchor, sess, items, ["wi-bottom", "wi-layer"]);
    const d = cands.find((cand) => cand.id === "D");
    assert.equal(d, undefined, "D (B minus the same outerwear) must also be excluded");
  });

  test("WMG-C.3 baseline sanity: WITHOUT the layer as a companion, C still exists as before (single-anchor behaviour unchanged)", () => {
    const cands = build(anchor, sess, items, ["wi-bottom"]); // layer NOT a companion this time
    const c = cands.find((cand) => cand.id === "C");
    assert.ok(c, "C should still be produced when the removable outerwear is not a required companion");
    assert.ok(!c!.pieces.some((p) => p.closetId === "wi-layer"), "C correctly has no outerwear when it's just auto-selected, not required");
  });
});

// ── WMG-D: eligibility — a companion is checked exactly like the anchor ─────

describe("WMG-D — an ineligible companion invalidates the whole candidate set, same as an ineligible anchor", () => {
  const sess = S("dinner", "formality-smart");
  const anchor = A("wi-top", "top");

  test("WMG-D.1 a companion with an approved occasionFit of 'No' produces zero candidates", () => {
    const items = [
      g({ id: "wi-top", category: "TOPS", occasions: ["dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
      g({ id: "wi-bottom-rejected", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "No" }) }),
    ];
    const cands = build(anchor, sess, items, ["wi-bottom-rejected"]);
    assert.deepEqual(cands, [], "an ineligible companion must empty the candidate set entirely — never a partial, silently-missing-the-bad-one outfit");
  });

  test("WMG-D.2 an otherwise-fine combination still produces candidates when every piece is eligible", () => {
    const items = wiCloset();
    const cands = build(anchor, sess, items, ["wi-bottom"]);
    assert.ok(cands.length > 0, "sanity: a genuinely eligible combination must still work");
  });

  test("WMG-D.3 a companion id that doesn't resolve against the closet pool also invalidates the set", () => {
    const items = wiCloset();
    const cands = build(anchor, sess, items, ["this-id-does-not-exist"]);
    assert.deepEqual(cands, [], "an unresolvable companion id must fail closed, never silently ignored");
  });

  // Gap found during final acceptance (Step 3 — styling priorities / Style Passport):
  // WMG-D.1 only proved the OCCASION branch of evaluateAnchorEligibility rejects a bad
  // companion. The other branch — classifyAnchorCoverageConflict, the actual Style Passport
  // strict-requirement check (legs-covered / no-cropped-tops) — had never been exercised for
  // a companion specifically, only for a manually-picked single anchor elsewhere in the
  // suite. Both branches feed the same evaluateAnchorEligibility call this file already
  // relies on (see the file header), so this closes the one untested branch rather than
  // re-proving the whole gate.
  test("WMG-D.4 a companion that violates a stated strict dressing requirement (legs-covered) also invalidates the set", () => {
    const items = [
      g({ id: "wi-top", category: "TOPS", occasions: ["dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
      g({ id: "wi-mini-skirt", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
          hemLength: "mini", approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    ];
    const profile = { dressingPreferences: ["legs-covered"] } as unknown as Parameters<typeof buildNaiaOutfitCandidates>[3];
    const cands = buildNaiaOutfitCandidates(anchor, sess, items, profile, undefined, undefined, ["wi-mini-skirt"])
      .filter((c): c is OutfitCandidate => c !== null);
    assert.deepEqual(
      cands, [],
      "a companion that sits outside a stated strict dressing requirement must invalidate the whole set, exactly like the occasion branch already does",
    );
  });
});

// ── WMG-E: piece-count budget accounts for companions ─────────────────────────

describe("WMG-E — MAX_OUTFIT_PIECES accounting includes every companion", () => {
  test("WMG-E.1 candidate A never exceeds 5 total pieces even with 2 companions", () => {
    const items = [
      ...wiCloset(),
      g({ id: "alt-accessory", category: "ACCESSORIES", occasions: ["dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
      g({ id: "alt-jewelry", category: "JEWELRY", occasions: ["dinner"], formality: "smart-casual",
          approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    ];
    const sess = S("dinner", "formality-smart");
    const anchor = A("wi-top", "top");
    const [candidateA] = build(anchor, sess, items, ["wi-bottom", "wi-layer"]);
    assert.ok(candidateA.pieces.length <= 5, `expected at most 5 pieces (anchor + 2 companions + up to 2 more); got ${candidateA.pieces.length}`);
    // The required three must always be among them, regardless of the cap.
    const ids = candidateA.pieces.map((p) => p.closetId);
    assert.ok(["wi-top", "wi-bottom", "wi-layer"].every((id) => ids.includes(id)), "the cap must never be met by dropping a required piece");
  });
});

// ── WMG-F: Rev 3 direction cards preserve AND display every companion ───────
//
// Two distinct claims, both required by "every direction offered as a styling of the
// selected look must preserve and display ALL required garments":
//   F.1  never offers a companion's slot to a different, swapped-in garment (preserve)
//   F.2  every companion actually appears in the direction's own outfitPieces (display)
// F.2 used to fail: companions were excluded from the swap pool but never re-added to
// outfitPieces, so a direction's displayed pieces silently omitted them. Fixed by
// appending companionOutfitPieces to every direction unconditionally (see
// computeNaiaResultDirections) — safe because a companion's slot is never scored as an
// alternative, so it can never collide with what buildOutfit already chose.

describe("WMG-F — computeNaiaResultDirections preserves and displays every companion", () => {
  test("WMG-F.1 no MOST LIKE ME / FRESH / PUSH ME direction suggests swapping the companion's slot", () => {
    const items = wiCloset();
    const directions = computeNaiaResultDirections(
      items, "wi-top", { occasion: "dinner", moods: [], desiredFeelings: [] }, undefined, undefined, ["wi-bottom"],
    );
    for (const d of directions) {
      const bottom = (d.outfitPieces ?? []).find((p) => p.slot === "bottom");
      assert.ok(
        !bottom || bottom.id === "wi-bottom",
        `direction "${d.label}" offered a different bottom (${bottom?.id}) instead of leaving the companion's slot alone`,
      );
    }
  });

  test("WMG-F.2 every direction's outfitPieces explicitly includes the companion", () => {
    const items = wiCloset();
    const directions = computeNaiaResultDirections(
      items, "wi-top", { occasion: "dinner", moods: [], desiredFeelings: [] }, undefined, undefined, ["wi-bottom"],
    );
    assert.ok(directions.length > 0, "sanity: at least one direction must be produced");
    for (const d of directions) {
      const ids = (d.outfitPieces ?? []).map((p) => p.id);
      assert.ok(
        ids.includes("wi-bottom"),
        `direction "${d.label}" must display the required companion wi-bottom; got ${ids.join(",")}`,
      );
    }
  });

  test("WMG-F.3 a two-companion combination displays BOTH companions in every direction", () => {
    const items = wiCloset();
    const directions = computeNaiaResultDirections(
      items, "wi-top", { occasion: "dinner", moods: [], desiredFeelings: [] }, undefined, undefined,
      ["wi-bottom", "wi-layer"],
    );
    assert.ok(directions.length > 0, "sanity: at least one direction must be produced");
    for (const d of directions) {
      const ids = (d.outfitPieces ?? []).map((p) => p.id);
      assert.ok(ids.includes("wi-bottom"), `direction "${d.label}" dropped companion wi-bottom`);
      assert.ok(ids.includes("wi-layer"), `direction "${d.label}" dropped companion wi-layer`);
    }
  });

  test("WMG-F.4 with no companions, outfitPieces is unaffected (no regression for the single-anchor path)", () => {
    const items = wiCloset();
    const withCompanions = computeNaiaResultDirections(
      items, "wi-top", { occasion: "dinner", moods: [], desiredFeelings: [] },
    );
    const withEmpty = computeNaiaResultDirections(
      items, "wi-top", { occasion: "dinner", moods: [], desiredFeelings: [] }, undefined, undefined, [],
    );
    assert.deepEqual(
      withCompanions.map((d) => d.outfitPieces),
      withEmpty.map((d) => d.outfitPieces),
      "an absent companion list and an empty one must produce identical direction pieces",
    );
  });
});

// ── WMG-G: single-garment "Style this in StyleMe" is unaffected ─────────────

describe("WMG-G — the pre-existing single-anchor path is byte-identical when no companions are passed", () => {
  test("WMG-G.1 omitting closetCompanionIds behaves exactly as before this feature existed", () => {
    const items = wiCloset();
    const sess = S("dinner", "formality-smart");
    const anchor = A("wi-top", "top");
    const withUndefined = build(anchor, sess, items);
    const withEmptyArray = build(anchor, sess, items, []);
    assert.deepEqual(
      withUndefined.map((c) => c.pieces.map((p) => p.closetId)),
      withEmptyArray.map((c) => c.pieces.map((p) => p.closetId)),
      "an absent companion list and an empty one must produce identical candidates",
    );
  });
});

// ── WMG-H: parseClosetCompanionIds fails closed, never throws ───────────────

describe("WMG-H — parseClosetCompanionIds is defensive against a malformed cookie value", () => {
  test("WMG-H.1 a well-formed JSON array round-trips", () => {
    assert.deepEqual(parseClosetCompanionIds(JSON.stringify(["a", "b"])), ["a", "b"]);
  });
  test("WMG-H.2 undefined, empty string and malformed JSON all fail closed to []", () => {
    assert.deepEqual(parseClosetCompanionIds(undefined), []);
    assert.deepEqual(parseClosetCompanionIds(""), []);
    assert.deepEqual(parseClosetCompanionIds("{not json"), []);
  });
  test("WMG-H.3 a non-array JSON value fails closed to []", () => {
    assert.deepEqual(parseClosetCompanionIds(JSON.stringify({ not: "an array" })), []);
  });
  test("WMG-H.4 non-string entries are filtered out rather than throwing", () => {
    assert.deepEqual(parseClosetCompanionIds(JSON.stringify(["real-id", 42, null, ""])), ["real-id"]);
  });
});

// ── WMG-I: the DISPLAYED result shows every companion, not just the anchor ──
//
// "Every garment transferred from Wardrobe Intelligence must remain visible and
// identifiable as part of the customer's selected look" on the StyleMe result page. The
// page does not render candidate.pieces directly — it renders suggestion.items, which is
// built by buildDbPayload(result) from result.rawRecommendation.selectedClosetGarments.
// WMG-A/B already proved companions survive at the CANDIDATE level; this drives the full
// pipeline end-to-end (computeStyleMeResult -> buildDbPayload) through the same DI seams
// candidate-swap-pool-gating.test.ts's CSG-D uses, so no database or network is touched,
// and proves the DISPLAY layer specifically.

describe("WMG-I — buildDbPayload shows the anchor and every companion as separate, labelled items", () => {
  const anchorItem: ClosetAnchorInput = g({
    id: "wi-top", category: "TOPS", occasions: ["dinner"], formality: "smart-casual",
    approvedProfile: prof("smart-casual", { dinner: "Strong" }),
  });
  const items = [
    anchorItem,
    g({ id: "wi-bottom", category: "BOTTOMS", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "wi-layer", category: "OUTERWEAR", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
    g({ id: "alt-shoe", category: "SHOES", occasions: ["dinner"], formality: "smart-casual",
        approvedProfile: prof("smart-casual", { dinner: "Strong" }) }),
  ];

  const runWithCompanions = async (companionIds: string[]) => {
    const mock = (async (candidates: OutfitCandidate[]) => {
      const chosen = candidates[0];
      return {
        candidate: chosen,
        wording: {
          outfitName: "Test Look", whyThisWorks: "Mocked for the display-layer test.",
          confidenceBoost: "Mocked.", perfumeNote: null,
        },
        perPieceNotes: new Map(chosen.pieces.map((p) => [p.closetId, `note ${p.slot}`])),
      };
    }) as unknown as Parameters<typeof computeStyleMeResult>[5];

    const result = await computeStyleMeResult(
      {
        session: S("dinner", "formality-smart"), anchor: anchorItem, mode: "naia",
        recentlyShownClosetIds: [], closetCompanionIds: companionIds,
      } as unknown as Parameters<typeof computeStyleMeResult>[0],
      undefined, undefined, false,
      async () => items,
      mock,
    );
    return buildDbPayload(result, "dinner");
  };

  test("WMG-I.1 a two-garment combination (anchor + 1 companion): both appear as displayed closet items", async () => {
    const payload = await runWithCompanions(["wi-bottom"]);
    const closetIds = payload.items.filter((i) => i.closetItemId).map((i) => i.closetItemId);
    assert.ok(closetIds.includes("wi-top"), `anchor must be a displayed item; got ${closetIds.join(",")}`);
    assert.ok(closetIds.includes("wi-bottom"), `companion must be a displayed item; got ${closetIds.join(",")}`);
  });

  test("WMG-I.2 a three-garment combination (anchor + 2 companions): all three appear", async () => {
    const payload = await runWithCompanions(["wi-bottom", "wi-layer"]);
    const closetIds = payload.items.filter((i) => i.closetItemId).map((i) => i.closetItemId);
    assert.deepEqual(
      new Set(closetIds.filter((id) => ["wi-top", "wi-bottom", "wi-layer"].includes(id!))),
      new Set(["wi-top", "wi-bottom", "wi-layer"]),
      `all three selected garments must be displayed; got ${closetIds.join(",")}`,
    );
  });

  test("WMG-I.3 each displayed companion carries its own label, not a blank/generic placeholder", async () => {
    const payload = await runWithCompanions(["wi-bottom", "wi-layer"]);
    const bottom = payload.items.find((i) => i.closetItemId === "wi-bottom");
    const layer = payload.items.find((i) => i.closetItemId === "wi-layer");
    assert.equal(bottom?.productTitle, "wi-bottom", "companion must show its own identifying label");
    assert.equal(layer?.productTitle, "wi-layer", "companion must show its own identifying label");
  });

  test("WMG-I.4 with no companions, the display is identical to omitting closetCompanionIds entirely (no regression)", async () => {
    // The pre-existing single-anchor path auto-selects complementary closet garments
    // (wi-bottom, alt-shoe here) same as it always has — an empty companion list must not
    // change that baseline in any way, which this proves by comparing against the
    // genuinely-undefined case rather than asserting a hand-guessed item list.
    const withEmpty = await runWithCompanions([]);

    const mock = (async (candidates: OutfitCandidate[]) => {
      const chosen = candidates[0];
      return {
        candidate: chosen,
        wording: { outfitName: "Test Look", whyThisWorks: "Mocked.", confidenceBoost: "Mocked.", perfumeNote: null },
        perPieceNotes: new Map(chosen.pieces.map((p) => [p.closetId, `note ${p.slot}`])),
      };
    }) as unknown as Parameters<typeof computeStyleMeResult>[5];
    const resultUndefined = await computeStyleMeResult(
      { session: S("dinner", "formality-smart"), anchor: anchorItem, mode: "naia", recentlyShownClosetIds: [] } as unknown as Parameters<typeof computeStyleMeResult>[0],
      undefined, undefined, false, async () => items, mock,
    );
    const withUndefined = buildDbPayload(resultUndefined, "dinner");

    assert.deepEqual(
      withEmpty.items.map((i) => i.closetItemId),
      withUndefined.items.map((i) => i.closetItemId),
      "an empty companion list must display exactly the same items as no companion list at all",
    );
  });
});

// ── WMG-J: session persistence through refresh, regeneration, and manual override ──

describe("WMG-J — companions survive refresh/regeneration and never leak onto an unrelated later pick", () => {
  test("WMG-J.1 companions round-trip through a committed-then-reloaded cookie (refresh/navigation)", async () => {
    const session = await getSession(null);
    session.set("styleMeClosetAnchorId", "wi-top");
    session.set("styleMeClosetCompanionIds", JSON.stringify(["wi-bottom", "wi-layer"]));
    const cookieHeader = (await commitSession(session)).split(";")[0];

    // A fresh request carrying only the Cookie header — simulates a page refresh or
    // navigating away and back, which is all a cookie-backed session has to survive.
    const reloaded = await getSession(cookieHeader);
    assert.equal(reloaded.get("styleMeClosetAnchorId"), "wi-top");
    assert.deepEqual(
      parseClosetCompanionIds(reloaded.get("styleMeClosetCompanionIds")),
      ["wi-bottom", "wi-layer"],
      "companions must survive a refresh/navigation round-trip exactly as set",
    );
  });

  test("WMG-J.2 regeneration reads companions from the same key the handoff and generate actions wrote to", async () => {
    // result.tsx's regenerate branch reads styleMeClosetCompanionIds via
    // parseClosetCompanionIds from the request's own cookie (regenCookieSession) — the
    // same key and the same parser as the generate branch and the WI handoff. Proven here
    // as a direct round trip through the real session storage, not re-derived.
    const session = await getSession(null);
    session.set("styleMeClosetCompanionIds", JSON.stringify(["wi-bottom"]));
    const cookieHeader = (await commitSession(session)).split(";")[0];
    const onRegenerate = await getSession(cookieHeader);
    assert.deepEqual(parseClosetCompanionIds(onRegenerate.get("styleMeClosetCompanionIds")), ["wi-bottom"]);
  });

  test("WMG-J.3 picking a new anchor manually clears stale companions from an abandoned WI combination", async () => {
    // Reproduces the exact clear-then-set mechanism source.tsx's manual "set-anchor"
    // success branch uses (session.unset("styleMeClosetCompanionIds") alongside setting
    // the new anchor) to prove the MECHANISM itself is sound. WMG-K.1 below separately
    // proves every real call site in source.tsx/occasion.tsx actually contains that call.
    const session = await getSession(null);
    session.set("styleMeClosetAnchorId", "wi-top");
    session.set("styleMeClosetCompanionIds", JSON.stringify(["wi-bottom", "wi-layer"]));

    // She abandons that WI look and manually picks a completely unrelated garment.
    session.set("styleMeClosetAnchorId", "some-other-closet-item");
    session.set("styleMeAnchorProvenance", "MANUAL");
    session.unset("styleMeClosetCompanionIds");

    const cookieHeader = (await commitSession(session)).split(";")[0];
    const after = await getSession(cookieHeader);
    assert.equal(after.get("styleMeClosetAnchorId"), "some-other-closet-item");
    assert.equal(
      after.get("styleMeClosetCompanionIds"), undefined,
      "stale companions from the abandoned WI look must not attach to the new manual pick",
    );
  });
});

// ── WMG-K: completeness guard + the route's own pure submission-shape logic ──

describe("WMG-K — every anchor-mutation site in source.tsx/occasion.tsx clears companions", () => {
  // Source-regex, not behavioral — by design, for the same reason WIF-A.1 (which this
  // mirrors) is: this is a claim about code structure across every call site, not about
  // one input's runtime behaviour. WMG-J.3 above already proves the clear mechanism itself
  // is correct; this proves it is actually applied everywhere the anchor changes outside
  // the WI handoff's own deliberate set (which is the one place companions are SUPPOSED to
  // survive). Exact counts, not just "at least one" — so a new 11th/2nd site added without
  // the matching clear makes the counts diverge and fails loudly, rather than passing by
  // coincidence.
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  test("WMG-K.1 source.tsx: every styleMeClosetAnchorId set/unset site has a matching companion clear", () => {
    const src = read("app/routes/style-me/source.tsx");
    const anchorSites = (src.match(/session\.(set|unset)\("styleMeClosetAnchorId"/g) ?? []).length;
    const companionClears = (src.match(/session\.unset\("styleMeClosetCompanionIds"\)/g) ?? []).length;
    assert.equal(
      companionClears, anchorSites,
      `source.tsx has ${anchorSites} anchor-mutation sites but only ${companionClears} companion clears — a new site may have forgotten to clear stale companions`,
    );
  });

  test("WMG-K.2 occasion.tsx: the pending-anchor promotion site has a matching companion clear", () => {
    const src = read("app/routes/style-me/occasion.tsx");
    const anchorSites = (src.match(/session\.(set|unset)\("styleMeClosetAnchorId"/g) ?? []).length;
    const companionClears = (src.match(/session\.unset\("styleMeClosetCompanionIds"\)/g) ?? []).length;
    assert.equal(companionClears, anchorSites, `occasion.tsx has ${anchorSites} anchor-mutation sites but only ${companionClears} companion clears`);
  });
});

describe("WMG-L — api.wi-style-this.tsx's own submission-shape logic: invalid/duplicate/conflicting ids fail safely", () => {
  // resolveClosetAnchor's ownership/existence check is DB-integration-only in this
  // codebase's convention (see wi-handoff-fresh-session.test.ts and
  // styleme-anchor.test.ts) — not mockable without a database, so "does this id belong to
  // this customer" stays unverified here and is covered instead by WIF-B.6 (every id is
  // looped through the real check) and WMG-D.3 (an unresolvable id invalidates the whole
  // candidate set at the engine layer). What IS extracted and genuinely behavioral here is
  // the pure submission-shape logic the route runs before that DB call: dedup and
  // same-slot-conflict detection.

  test("WMG-L.1 dedupeGarmentIds collapses a duplicate submission, preserving first-seen order", () => {
    assert.deepEqual(
      dedupeGarmentIds(["a", "b", "a", "c", "b"]),
      ["a", "b", "c"],
      "the same garment id submitted twice must become one entry, not its own duplicate companion",
    );
  });

  test("WMG-L.2 dedupeGarmentIds drops non-string/empty form values without throwing", () => {
    assert.deepEqual(dedupeGarmentIds(["real-id", "", "real-id"]), ["real-id"]);
    assert.deepEqual(dedupeGarmentIds([]), []);
  });

  test("WMG-L.3 findConflictingSlot detects two garments claiming the same clothing slot", () => {
    const items = [
      { category: "TOPS", subcategory: null },
      { category: "TOPS", subcategory: null },
    ];
    assert.equal(findConflictingSlot(items), "top", "two tops must be reported as a conflict on the top slot");
  });

  test("WMG-L.4 findConflictingSlot returns null when every garment occupies a distinct slot", () => {
    const items = [
      { category: "TOPS", subcategory: null },
      { category: "BOTTOMS", subcategory: null },
      { category: "SHOES", subcategory: null },
    ];
    assert.equal(findConflictingSlot(items), null, "a genuinely compatible combination must not be rejected");
  });

  test("WMG-L.5 findConflictingSlot on a single item never conflicts with itself", () => {
    assert.equal(findConflictingSlot([{ category: "TOPS", subcategory: null }]), null);
  });
});
