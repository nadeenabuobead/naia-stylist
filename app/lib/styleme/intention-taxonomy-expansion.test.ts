// app/lib/styleme/intention-taxonomy-expansion.test.ts
//
// StyleMe intention taxonomy expansion, 12 → 16 (2026-09).
//
// Four genuine new dimensions of CLOSET garment truth — feel-elevated,
// stand-out, feel-fun, feel-powerful — for standalone nAia. These are not NADINE
// product fields and not Wardrobe Intelligence fields.
//
// The three properties these tests exist to protect:
//   1. The original 12 IDs and their approved values are untouched.
//   2. An unreviewed new dimension is NOT approved "None" and NOT positive
//      evidence. Absence of a key means nobody has looked yet.
//   3. Nothing derives the new dimensions from a heuristic. Tailored is not
//      powerful, black is not stand-out, polished is not elevated, casual is
//      not fun — only a human rating counts.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  STYLEME_INTENTION_OPTIONS,
  STYLEME_INTENTION_LABELS,
  STYLEME_NEW_INTENTION_IDS,
  STYLEME_ORIGINAL_INTENTION_IDS,
  STYLEME_STATE_OPTIONS,
  STYLEME_FIT_COMFORT_OPTIONS,
} from "./session-vocabulary.js";
import {
  INTENTION_IDS,
  ORIGINAL_INTENTION_IDS,
  NEW_INTENTION_IDS,
  INTENTION_RATINGS,
  getIntentionReviewState,
} from "../admin/styleme-garment-profile.vocab.js";
import {
  validateStyleMeProfileInput,
  checkApprovalCompleteness,
} from "../admin/styleme-garment-profile.server.js";
import {
  getProfileIntentionScore,
  computeItemIntentionWeight,
  computeHybridIntentionFit,
} from "../ai/styleme-profile-gate.js";
import { computeIntentionFit } from "../ai/styleme-result.server.js";
import { ANSWER_REGISTRY, SESSION_QUESTIONS, SESSION_QUESTION_IDS as SQ } from "../ai/signal-contract.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClosetAnchorInput, OutfitCandidate } from "../ai/styleme-recommendation.types.js";

const NEW_IDS = ["feel-elevated", "stand-out", "feel-fun", "feel-powerful"] as const;

// Rules 18-27 live in a local systemPrompt inside callClaudeForNaiaSelection and
// are not exported, so they are asserted from source — the same approach the
// existing V2-RG3 guards use.
const RESULT_SERVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../ai/styleme-result.server.ts"),
  "utf8",
);

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A full set of approved ratings for the original 12 — the state of all 79 garments. */
function originalTwelve(rating: "Strong" | "Supporting" | "None" = "Supporting"): Record<string, string> {
  return Object.fromEntries(ORIGINAL_INTENTION_IDS.map((id) => [id, rating]));
}

function makeItem(
  id: string,
  intentionPotentials: Record<string, string> | null,
  extra: Partial<NonNullable<ClosetAnchorInput["approvedProfile"]>> = {},
): ClosetAnchorInput {
  return {
    type: "closet",
    id,
    name: `Item ${id}`,
    category: "TOPS",
    colors: [],
    styleTags: [],
    occasions: [],
    approvedProfile: {
      exactSlot: "top",
      intentionPotentials,
      ...extra,
    } as NonNullable<ClosetAnchorInput["approvedProfile"]>,
  } as unknown as ClosetAnchorInput;
}

function makeCandidate(ids: string[]): OutfitCandidate {
  return {
    id: "A",
    pieces: ids.map((cid, i) => ({
      closetId: cid,
      slot: i === 0 ? "top" : i === 1 ? "bottom" : "shoe",
      label: `Item ${cid}`,
      colors: [],
    })),
  } as unknown as OutfitCandidate;
}

// ── 1-3. The questionnaire exposes exactly 16 canonical, unique intentions ────

describe("TX.1 — the Step 2 questionnaire exposes exactly 16 intentions", () => {
  it("there are 16 options", () => {
    assert.equal(STYLEME_INTENTION_OPTIONS.length, 16);
  });

  it("the IDs are unique", () => {
    const ids = STYLEME_INTENTION_OPTIONS.map((o) => o.id);
    assert.equal(new Set(ids).size, 16);
  });

  it("the customer vocabulary and the garment taxonomy are the same 16 IDs", () => {
    assert.deepEqual(
      [...STYLEME_INTENTION_OPTIONS.map((o) => o.id)].sort(),
      [...INTENTION_IDS].sort(),
    );
  });

  it("the original 12 survive unchanged and in order", () => {
    const first12 = STYLEME_INTENTION_OPTIONS.slice(0, 12).map((o) => o.id);
    assert.deepEqual(first12, [...STYLEME_ORIGINAL_INTENTION_IDS]);
    assert.deepEqual([...ORIGINAL_INTENTION_IDS], [...STYLEME_ORIGINAL_INTENTION_IDS]);
  });

  it("the four additions are exactly the approved new dimensions", () => {
    assert.deepEqual([...STYLEME_NEW_INTENTION_IDS], [...NEW_IDS]);
    assert.deepEqual([...NEW_INTENTION_IDS], [...NEW_IDS]);
  });

  it("max selection is still 2", () => {
    const intentionQ = SESSION_QUESTIONS.find((x) => x.id === SQ.INTENTIONS);
    assert.ok(intentionQ, "the INTENTIONS session question must exist");
    assert.equal(intentionQ!.maxSelections, 2, "the expansion must not change the 2-pick cap");
  });

  it("every intention is registered as an INTENTIONS answer", () => {
    for (const option of STYLEME_INTENTION_OPTIONS) {
      const entry = ANSWER_REGISTRY.find((m) => m.id === option.id && m.questionId === SQ.INTENTIONS);
      assert.ok(entry, `ANSWER_REGISTRY must register "${option.id}"`);
    }
  });

  it("the four new intentions carry no ranking weight of their own — they score via approved profiles", () => {
    for (const intentionId of NEW_IDS) {
      const entry = ANSWER_REGISTRY.find((m) => m.id === intentionId && m.questionId === SQ.INTENTIONS);
      assert.ok(entry);
      assert.equal(entry!.rankingWeight, "none");
      assert.deepEqual(entry!.activatedFields, [], "no direct product-field activation");
    }
  });
});

// ── 4. The central vocabulary returns the four new labels ────────────────────

describe("TX.2 — the four new customer-facing labels", () => {
  const EXPECTED: Record<string, string> = {
    "feel-elevated": "Help me feel elevated",
    "stand-out":     "Let me stand out",
    "feel-fun":      "Make it feel fun",
    "feel-powerful": "Help me feel powerful",
  };

  for (const [id, label] of Object.entries(EXPECTED)) {
    it(`"${id}" displays as "${label}"`, () => {
      assert.equal(STYLEME_INTENTION_LABELS[id], label);
    });
    it(`"${label}" resolves back to "${id}"`, () => {
      assert.equal(STYLEME_INTENTION_OPTIONS.find((o) => o.label === label)?.id, id);
    });
  }

  it("feel-fun is a separate dimension from express-myself", () => {
    assert.notEqual(STYLEME_INTENTION_LABELS["feel-fun"], STYLEME_INTENTION_LABELS["express-myself"]);
    assert.ok(STYLEME_INTENTION_OPTIONS.some((o) => o.id === "express-myself"));
    assert.ok(STYLEME_INTENTION_OPTIONS.some((o) => o.id === "feel-fun"));
  });
});

// ── 7-8. State and Fit/Comfort must not activate the new intentions ──────────

describe("TX.3 — State stays context, never an intention", () => {
  for (const stateId of STYLEME_STATE_OPTIONS.map((o) => o.id)) {
    it(`State "${stateId}" is not an intention ID`, () => {
      assert.equal(STYLEME_INTENTION_OPTIONS.some((o) => o.id === stateId), false);
    });
  }

  const MUST_NOT_ACTIVATE: Array<[string, string[]]> = [
    ["feel-confident", ["confidence", "feel-powerful"]],
    ["feel-energised", ["give-energy", "feel-fun"]],
    ["feel-social",    ["stand-out", "feel-fun"]],
    ["feel-calm",      ["feel-softer"]],
    ["feel-good",      ["feel-elevated", "feel-powerful"]],
  ];

  for (const [stateId, intentions] of MUST_NOT_ACTIVATE) {
    for (const intentionId of intentions) {
      it(`State "${stateId}" does not activate intention "${intentionId}"`, () => {
        const asState = ANSWER_REGISTRY.find((m) => m.id === stateId && m.questionId === SQ.STATE);
        assert.ok(asState, `${stateId} must be a registered State`);
        assert.equal(asState!.rankingWeight, "none", "State carries no ranking weight");
        assert.notEqual(stateId, intentionId);
        assert.equal(
          ANSWER_REGISTRY.some((m) => m.id === stateId && m.questionId === SQ.INTENTIONS),
          false,
          `${stateId} must never be registered as an intention`,
        );
      });
    }
  }
});

describe("TX.4 — Fit/Comfort body needs stay distinct from the new intentions", () => {
  const MUST_STAY_SEPARATE: Array<[string, string]> = [
    ["softer-easier-fabrics", "feel-softer"],
    ["structured-shape",      "feel-powerful"],
    ["waist-definition",      "feel-elevated"],
    ["loose-comfortable",     "feel-fun"],
  ];

  for (const [bodyNeedId, intentionId] of MUST_STAY_SEPARATE) {
    it(`body need "${bodyNeedId}" is not intention "${intentionId}"`, () => {
      assert.ok(STYLEME_FIT_COMFORT_OPTIONS.some((o) => o.id === bodyNeedId));
      assert.ok(STYLEME_INTENTION_OPTIONS.some((o) => o.id === intentionId));
      assert.equal(STYLEME_FIT_COMFORT_OPTIONS.some((o) => o.id === intentionId), false);
      assert.equal(STYLEME_INTENTION_OPTIONS.some((o) => o.id === bodyNeedId), false);
    });
  }
});

// ── 9-12. Ranking: Strong > Supporting > None, and unreviewed is not evidence ─

describe("TX.5 — Strong > Supporting > None for each new intention", () => {
  for (const intentionId of NEW_IDS) {
    it(`${intentionId}: approved ratings score 1.0 / 0.5 / 0.0`, () => {
      const strong = makeItem("s", { ...originalTwelve(), [intentionId]: "Strong" });
      const supporting = makeItem("p", { ...originalTwelve(), [intentionId]: "Supporting" });
      const none = makeItem("n", { ...originalTwelve(), [intentionId]: "None" });
      assert.equal(getProfileIntentionScore(strong, intentionId), 1.0);
      assert.equal(getProfileIntentionScore(supporting, intentionId), 0.5);
      assert.equal(getProfileIntentionScore(none, intentionId), 0.0);
    });

    it(`${intentionId}: the ordering holds through computeItemIntentionWeight`, () => {
      const strong = computeItemIntentionWeight(makeItem("s", { ...originalTwelve(), [intentionId]: "Strong" }), intentionId);
      const supporting = computeItemIntentionWeight(makeItem("p", { ...originalTwelve(), [intentionId]: "Supporting" }), intentionId);
      const none = computeItemIntentionWeight(makeItem("n", { ...originalTwelve(), [intentionId]: "None" }), intentionId);
      assert.ok(strong > supporting, "Strong must outrank Supporting");
      assert.ok(supporting > none, "Supporting must outrank None");
      assert.equal(none, 0.0, "approved None is a hard zero");
    });

    it(`${intentionId}: an explicit selection changes outfit-level ranking`, () => {
      const items = [
        makeItem("strong-piece", { ...originalTwelve(), [intentionId]: "Strong" }),
        makeItem("none-piece", { ...originalTwelve(), [intentionId]: "None" }),
      ];
      const strongCandidate = makeCandidate(["strong-piece"]);
      const noneCandidate = makeCandidate(["none-piece"]);
      const strongFit = computeIntentionFit([intentionId], strongCandidate, strongCandidate, items, undefined);
      const noneFit = computeIntentionFit([intentionId], noneCandidate, noneCandidate, items, undefined);
      assert.ok(strongFit > noneFit, `${intentionId}=Strong must outrank ${intentionId}=None at outfit level`);
    });

    it(`${intentionId}: one Strong accessory can carry the outfit above an all-None outfit`, () => {
      const items = [
        makeItem("plain-top", { ...originalTwelve(), [intentionId]: "None" }),
        makeItem("plain-bottom", { ...originalTwelve(), [intentionId]: "None" }),
        makeItem("statement-piece", { ...originalTwelve(), [intentionId]: "Strong" }, { exactSlot: "accessory" }),
        makeItem("plain-shoe", { ...originalTwelve(), [intentionId]: "None" }),
      ];
      const withAccessory = computeHybridIntentionFit(
        intentionId, makeCandidate(["plain-top", "plain-bottom", "statement-piece"]), items,
      );
      const without = computeHybridIntentionFit(
        intentionId, makeCandidate(["plain-top", "plain-bottom", "plain-shoe"]), items,
      );
      assert.ok(withAccessory !== null && without !== null);
      assert.ok(withAccessory! > without!, "a single Strong accessory must lift outfit-level fulfilment");
    });
  }
});

describe("TX.6 — an unreviewed new dimension is not approved evidence", () => {
  for (const intentionId of NEW_IDS) {
    it(`${intentionId}: a missing rating is null, not 0.0 and not a rating`, () => {
      const unreviewed = makeItem("u", originalTwelve());
      assert.equal(
        getProfileIntentionScore(unreviewed, intentionId), null,
        "missing must be distinguishable from an approved None",
      );
    });

    it(`${intentionId}: unreviewed never scores as Supporting or Strong`, () => {
      const unreviewed = computeItemIntentionWeight(makeItem("u", originalTwelve()), intentionId);
      assert.ok(unreviewed < 0.5, "unreviewed must score below Supporting");
      assert.ok(unreviewed < 1.0, "unreviewed must score below Strong");
    });

    it(`${intentionId}: an approved Strong beats an unreviewed garment`, () => {
      const strong = computeItemIntentionWeight(makeItem("s", { ...originalTwelve(), [intentionId]: "Strong" }), intentionId);
      const unreviewed = computeItemIntentionWeight(makeItem("u", originalTwelve()), intentionId);
      assert.ok(strong > unreviewed);
    });

    it(`${intentionId}: an approved None is stronger negative evidence than unreviewed`, () => {
      const none = computeItemIntentionWeight(makeItem("n", { ...originalTwelve(), [intentionId]: "None" }), intentionId);
      const unreviewed = computeItemIntentionWeight(makeItem("u", originalTwelve()), intentionId);
      assert.equal(none, 0.0);
      assert.ok(unreviewed > none, "a human 'None' is a real negative; unreviewed is merely absent");
    });
  }

  it("no garment characteristic derives feel-powerful", () => {
    const tailoredBlack = makeItem("t", originalTwelve(), {
      construction: "tailored", visualWeight: "heavy", dressRegister: "polished",
    } as never);
    const softLight = makeItem("s", originalTwelve(), {
      construction: "soft", visualWeight: "light", dressRegister: "casual",
    } as never);
    assert.equal(
      computeItemIntentionWeight(tailoredBlack, "feel-powerful"),
      computeItemIntentionWeight(softLight, "feel-powerful"),
      "tailored/heavy/polished must not derive powerful",
    );
  });

  it("no garment characteristic derives feel-elevated, stand-out or feel-fun", () => {
    const polished = makeItem("p", originalTwelve(), { dressRegister: "polished", statementLevel: "statement" } as never);
    const casual = makeItem("c", originalTwelve(), { dressRegister: "casual", statementLevel: "quiet" } as never);
    for (const intentionId of ["feel-elevated", "stand-out", "feel-fun"]) {
      assert.equal(
        computeItemIntentionWeight(polished, intentionId),
        computeItemIntentionWeight(casual, intentionId),
        `${intentionId} must not be derived from register or statement level`,
      );
    }
  });

  it("getIntentionReviewState separates reviewed, pending-new and missing-original", () => {
    const legacyApproved = getIntentionReviewState(originalTwelve());
    assert.deepEqual(legacyApproved.missingOriginal, []);
    assert.deepEqual([...legacyApproved.pendingNew].sort(), [...NEW_IDS].sort());
    assert.equal(legacyApproved.isFullyReviewed, false);

    const partly = getIntentionReviewState({ ...originalTwelve(), "feel-fun": "None" });
    assert.equal(partly.reviewed.includes("feel-fun"), true, "an explicit None counts as reviewed");
    assert.equal(partly.pendingNew.includes("feel-fun"), false);
    assert.equal(partly.pendingNew.length, 3);

    const complete = getIntentionReviewState({
      ...originalTwelve(),
      ...Object.fromEntries(NEW_IDS.map((id) => [id, "None"])),
    });
    assert.equal(complete.isFullyReviewed, true);
    assert.deepEqual(complete.pendingNew, []);

    const empty = getIntentionReviewState(null);
    assert.equal(empty.missingOriginal.length, 12);
    assert.equal(empty.pendingNew.length, 4);
  });
});

// ── 17-18. The 79 approved profiles survive the expansion untouched ──────────

describe("TX.7 — the expansion does not disturb existing approved profiles", () => {
  it("a profile approved under the old taxonomy still passes approval validation", () => {
    const errs = checkApprovalCompleteness({
      exactSlot: "top", outfitFunction: "base", styleFamilyPrimary: "classic",
      dressRegister: "polished", construction: "structured",
      fabricBehaviour: ["crisp"], silhouetteCharacter: ["straight"],
      visualWeight: "medium", stylingEffort: "easy", layeringBehaviour: "standalone",
      waistComfort: "N/A", statementLevel: "quiet",
      occasionFit: Object.fromEntries(
        ["everyday","work","dinner","date","event","night-out","family","travel","active"].map((o) => [o, "Strong"]),
      ),
      intentionPotentials: originalTwelve(),
    } as never);
    const intentionErrs = errs.filter((e) => e.field === "intentionPotentials");
    assert.deepEqual(intentionErrs, [], "the four new dimensions must not block approval");
  });

  it("a missing ORIGINAL intention still blocks approval", () => {
    const partial = originalTwelve();
    delete partial["confidence"];
    const errs = checkApprovalCompleteness({
      exactSlot: "top", outfitFunction: "base", styleFamilyPrimary: "classic",
      dressRegister: "polished", construction: "structured",
      fabricBehaviour: ["crisp"], silhouetteCharacter: ["straight"],
      visualWeight: "medium", stylingEffort: "easy", layeringBehaviour: "standalone",
      waistComfort: "N/A", statementLevel: "quiet",
      occasionFit: Object.fromEntries(
        ["everyday","work","dinner","date","event","night-out","family","travel","active"].map((o) => [o, "Strong"]),
      ),
      intentionPotentials: partial,
    } as never);
    assert.ok(errs.some((e) => e.field === "intentionPotentials" && e.message.includes("confidence")));
  });

  it("the four new IDs are accepted by input validation with the same three ratings", () => {
    for (const intentionId of NEW_IDS) {
      for (const rating of INTENTION_RATINGS) {
        assert.doesNotThrow(() =>
          validateStyleMeProfileInput({ intentionPotentials: { [intentionId]: rating } } as never),
        );
      }
    }
  });

  it("an unknown intention ID is still rejected", () => {
    assert.throws(() =>
      validateStyleMeProfileInput({ intentionPotentials: { "have-fun": "Strong" } } as never),
    );
  });

  it("an invalid rating is still rejected for a new intention", () => {
    assert.throws(() =>
      validateStyleMeProfileInput({ intentionPotentials: { "feel-powerful": "Maybe" } } as never),
    );
  });

  it("existing approved values are preserved verbatim through validation", () => {
    const approved = { ...originalTwelve("Strong"), "give-energy": "None", "feel-softer": "Supporting" };
    const out = validateStyleMeProfileInput({ intentionPotentials: approved } as never);
    assert.deepEqual(out.intentionPotentials, approved, "no key may be rewritten or defaulted");
  });

  it("nothing writes a default value for an unreviewed new dimension", () => {
    const approved = originalTwelve();
    const out = validateStyleMeProfileInput({ intentionPotentials: approved } as never);
    for (const intentionId of NEW_IDS) {
      assert.equal(
        (out.intentionPotentials as Record<string, string>)[intentionId], undefined,
        `${intentionId} must stay absent — a backfill would destroy the unreviewed distinction`,
      );
    }
  });
});

// ── 13-15. Session truth: the model may only echo what was selected ──────────

describe("TX.8 — session-truth protection covers the new intentions", () => {
  it("rule 26 names the four new intentions as requiring rating evidence", () => {
    for (const intentionId of NEW_IDS) {
      assert.ok(
        RESULT_SERVER_SRC.includes(intentionId),
        `rule 26 must name ${intentionId}`,
      );
    }
  });

  it("rule 26 still forbids treating an unrated intention as positive evidence", () => {
    assert.ok(RESULT_SERVER_SRC.includes("treat it as unrated, not as positive evidence"));
  });

  it("rule 27 forbids attributing the new aesthetics to the customer unprompted", () => {
    for (const aesthetic of ["elevated", "distinctive", "playful", "powerful"]) {
      assert.ok(
        RESULT_SERVER_SRC.includes(aesthetic),
        `rule 27 must cover the "${aesthetic}" aesthetic`,
      );
    }
    assert.ok(RESULT_SERVER_SRC.includes("a powerful impression you're aiming for"));
    assert.ok(RESULT_SERVER_SRC.includes("the elevated feel you asked for"));
    assert.ok(RESULT_SERVER_SRC.includes("the standout look you wanted"));
    assert.ok(RESULT_SERVER_SRC.includes("the fun you were after"));
  });

  it("rule 27 still permits stating an aesthetic factually from metadata", () => {
    assert.ok(
      RESULT_SERVER_SRC.includes("may be stated factually when supported by metadata"),
      "a garment may still be described as distinctive or refined on the evidence",
    );
  });

  it("the brief only carries an intention the customer actually selected", () => {
    // TODAY'S BRIEF is built from session.intentions; nothing infers them.
    for (const intentionId of NEW_IDS) {
      const asState = ANSWER_REGISTRY.find((m) => m.id === intentionId && m.questionId === SQ.STATE);
      assert.equal(asState, undefined, `${intentionId} must not exist as a State`);
    }
  });
});

// ── Boundaries: NADINE and CI V2 stay out of this ────────────────────────────

describe("TX.9 — the expansion is confined to StyleMe closet garment truth", () => {
  it("Phase 3C derived garment intelligence still covers only the original 12", async () => {
    const { ALL_INTENTIONS } = await import("../admin/garment-intelligence-v1.server.js");
    assert.equal(
      ALL_INTENTIONS.length, 12,
      "CI V2 derived intelligence must not auto-derive the new dimensions",
    );
    for (const intentionId of NEW_IDS) {
      assert.equal(
        (ALL_INTENTIONS as readonly string[]).includes(intentionId), false,
        `${intentionId} must not become a derived Wardrobe Intelligence field`,
      );
    }
  });
});
