import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname);

function src(file: string): string {
  return readFileSync(join(dir, file), "utf8");
}

describe("Phase 4B3 recovery — route contract", () => {
  // ── Deleted routes must not exist ──────────────────────────────

  it("coverage.tsx is deleted", () => {
    assert.equal(existsSync(join(dir, "coverage.tsx")), false);
  });

  it("formality.tsx is deleted", () => {
    assert.equal(existsSync(join(dir, "formality.tsx")), false);
  });

  it("today-colours.tsx is deleted", () => {
    assert.equal(existsSync(join(dir, "today-colours.tsx")), false);
  });

  it("practical.tsx is deleted", () => {
    assert.equal(existsSync(join(dir, "practical.tsx")), false);
  });

  // ── mood.tsx ────────────────────────────────────────────────────

  it("mood stores styleMeMood as a string (single select)", () => {
    const text = src("mood.tsx");
    assert.ok(text.includes('session.set("styleMeMood", mood)'), "sets styleMeMood");
    assert.ok(!text.includes('session.set("styleMeMood", moods)'), "not storing moods array");
    assert.ok(text.includes('formData.get("mood")'), "reads mood field");
  });

  it("mood redirects to /style-me/feeling", () => {
    const text = src("mood.tsx");
    assert.ok(text.includes('redirect("/style-me/feeling"'), "redirects to feeling");
  });

  it("mood is single-select (not multi-select)", () => {
    const text = src("mood.tsx");
    assert.ok(text.includes("useState<string | null>"), "single-select state");
    assert.ok(!text.includes("useState<string[]>"), "no multi-select state");
  });

  // ── feeling.tsx ─────────────────────────────────────────────────

  it("feeling uses field name 'feelings' (JSON array, multi-select)", () => {
    const text = src("feeling.tsx");
    assert.ok(text.includes('formData.get("feelings")'), "reads feelings field");
    assert.ok(!text.includes('formData.get("feeling")'), "not reading singular feeling field");
  });

  it("feeling stores styleMeFeelings as an array", () => {
    const text = src("feeling.tsx");
    assert.ok(text.includes('session.set("styleMeFeelings"'), "sets styleMeFeelings");
    assert.ok(!text.includes('session.set("styleMeFeeling"'), "not setting singular styleMeFeeling");
  });

  it("feeling redirects to /style-me/comfort (not occasion)", () => {
    const text = src("feeling.tsx");
    assert.ok(text.includes('redirect("/style-me/comfort"'), "redirects to comfort");
    assert.ok(!text.includes('redirect("/style-me/occasion"'), "not redirecting to occasion");
  });

  // ── comfort.tsx ──────────────────────────────────────────────────

  it("comfort uses field name 'bodyNeeds' (JSON array, multi-select)", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes('formData.get("bodyNeeds")'), "reads bodyNeeds field");
    assert.ok(!text.includes('formData.get("comfort")'), "not reading singular comfort field");
  });

  it("comfort stores styleMeBodyNeeds (normalized canonical IDs)", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes('session.set("styleMeBodyNeeds"'), "sets styleMeBodyNeeds");
    assert.ok(!text.includes('session.set("styleMeComfort"'), "not setting styleMeComfort");
    assert.ok(text.includes("BODY_NEED_NORMALIZATION_MAP"), "applies normalization map");
  });

  it("comfort redirects to /style-me/occasion (not source, not coverage)", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes('redirect("/style-me/occasion"'), "redirects to occasion");
    assert.ok(!text.includes('redirect("/style-me/source"'), "not redirecting to source");
    assert.ok(!text.includes('redirect("/style-me/coverage"'), "not redirecting to coverage");
  });

  it("comfort loader reads styleMeFeelings from session", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes('session.get("styleMeFeelings")'), "reads styleMeFeelings");
    assert.ok(!text.includes('session.get("styleMeFeeling")'), "not reading singular styleMeFeeling");
  });

  it("comfort back link is /style-me/feeling", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes('backTo="/style-me/feeling"'), "back link to feeling");
    assert.ok(!text.includes('backTo="/style-me/occasion"'), "not back to occasion");
  });

  it("comfort imports signal-contract for normalization", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes("signal-contract"), "imports signal-contract for BODY_NEED_NORMALIZATION_MAP");
  });

  // ── occasion.tsx ─────────────────────────────────────────────────

  it("occasion loader reads styleMeFeelings and styleMeBodyNeeds from session", () => {
    const text = src("occasion.tsx");
    assert.ok(text.includes('session.get("styleMeFeelings")'), "reads styleMeFeelings");
    assert.ok(text.includes('session.get("styleMeBodyNeeds")'), "reads styleMeBodyNeeds");
    assert.ok(!text.includes('session.get("styleMeFeeling")'), "not reading singular styleMeFeeling");
  });

  it("occasion redirects to /style-me/source (not comfort, not formality)", () => {
    const text = src("occasion.tsx");
    assert.ok(text.includes('redirect("/style-me/source"'), "redirects to source");
    assert.ok(!text.includes('redirect("/style-me/comfort"'), "not redirecting to comfort");
    assert.ok(!text.includes('redirect("/style-me/formality"'), "not redirecting to formality");
    assert.ok(!text.includes('redirect("/style-me/today-colours"'), "not redirecting to today-colours");
  });

  it("occasion back link is /style-me/comfort", () => {
    const text = src("occasion.tsx");
    assert.ok(text.includes('backTo="/style-me/comfort"'), "back link to comfort");
    assert.ok(!text.includes('backTo="/style-me/feeling"'), "not back to feeling");
  });

  it("occasion imports signal-contract (Step 2A: reuses SESSION_QUESTIONS for formality visibility, not duplicated)", () => {
    const text = src("occasion.tsx");
    assert.ok(text.includes("signal-contract"), "imports signal-contract");
    assert.ok(text.includes("SESSION_QUESTIONS"), "uses SESSION_QUESTIONS as single source of truth");
    assert.ok(text.includes("SQ.FORMALITY_CONDITIONAL"), "looks up the FORMALITY_CONDITIONAL question");
  });

  // ── source.tsx ───────────────────────────────────────────────────

  it("source uses field name 'source' and stores styleMeSource", () => {
    const text = src("source.tsx");
    assert.ok(text.includes('formData.get("source")'), "reads source field");
    assert.ok(text.includes('session.set("styleMeSource", source)'), "sets styleMeSource");
  });

  it("naia-piece source skips anchor step — no product picker rendered", () => {
    const text = src("source.tsx");
    assert.ok(!text.includes("NadineAnchorStep"), "no NADINE product picker component");
    assert.ok(!text.includes("getAllCatalogProducts"), "no catalog product import");
    assert.ok(text.includes("ClosetAnchorStep"), "closet anchor step still present");
    assert.ok(text.includes("set-anchor"), "closet set-anchor intent still present");
    assert.ok(text.includes("getCurrentNaiaCustomer"), "resolves naiaCustomer for closet step");
  });

  it("source anchor action stores only styleMeClosetAnchorId; engine selects NADINE piece", () => {
    const text = src("source.tsx");
    assert.ok(!text.includes('session.set("styleMeNadineAnchorHandle"'), "does not set NADINE handle (engine auto-selects)");
    assert.ok(text.includes('session.set("styleMeClosetAnchorId"'), "sets closet anchor id");
    assert.ok(text.includes('session.unset("styleMeNadineAnchorHandle"'), "clears stale NADINE handle on source change and closet anchor");
  });

  it("source redirects to /style-me/result after anchor selection", () => {
    const text = src("source.tsx");
    assert.ok(text.includes('redirect("/style-me/result"'), "redirects to result");
  });

  it("source back link is /style-me/occasion", () => {
    const text = src("source.tsx");
    assert.ok(text.includes('to="/style-me/occasion"'), "back link to occasion");
    assert.ok(!text.includes('to="/style-me/comfort"'), "not back to comfort");
    assert.ok(!text.includes('to="/style-me/practical"'), "not back to practical");
  });

  it("source does not import signal-contract (FORMALITY_OCCASIONS removed)", () => {
    const text = src("source.tsx");
    assert.ok(!text.includes("signal-contract"), "no signal-contract import");
  });

  it("source does not redirect to Phase 2 routes", () => {
    const text = src("source.tsx");
    assert.ok(!text.includes('redirect("/style-me/coverage"'), "no coverage redirect");
    assert.ok(!text.includes('redirect("/style-me/formality"'), "no formality redirect");
    assert.ok(!text.includes('redirect("/style-me/today-colours"'), "no today-colours redirect");
    assert.ok(!text.includes('redirect("/style-me/practical"'), "no practical redirect");
  });

  // ── result.tsx ───────────────────────────────────────────────────

  it("result reads styleMeFeelings (array) from cookie", () => {
    const text = src("result.tsx");
    assert.ok(text.includes('cookieSession.get("styleMeFeelings")'), "reads styleMeFeelings array");
    assert.ok(!text.includes('cookieSession.get("styleMeFeeling")'), "not reading singular styleMeFeeling");
  });

  it("result uses service layer for generation (computeStyleMeResult, buildEngineInput)", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("computeStyleMeResult"), "uses computeStyleMeResult");
    assert.ok(text.includes("buildEngineInput"), "uses buildEngineInput");
    assert.ok(!text.includes("callClaude"), "does not use callClaude");
  });

  it("result generate effect sends bodyNeeds, moods, and desiredFeelings arrays", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("bodyNeeds: JSON.stringify"), "sends bodyNeeds array");
    assert.ok(text.includes("moods: JSON.stringify"), "sends moods array");
    assert.ok(text.includes("desiredFeelings: JSON.stringify"), "sends desiredFeelings array");
  });

  it("result has TryOnPanel and RecommendationFeedbackWidget", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("TryOnPanel"), "has TryOnPanel");
    assert.ok(text.includes("RecommendationFeedbackWidget"), "has RecommendationFeedbackWidget");
  });

  it("result imports service layer and journey context", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("styleme-result.server"), "imports styleme-result.server");
    assert.ok(text.includes("journey-context.server"), "imports journey-context.server");
    assert.ok(!text.includes("signal-contract"), "does not import signal-contract (FORMALITY_OCCASIONS removed)");
  });

  it("result resolves anchor via resolveActionAnchor (mandatory for all sources)", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("resolveActionAnchor"), "calls resolveActionAnchor");
    assert.ok(text.includes('styleme-anchor.server'), "imports styleme-anchor.server");
  });

  it("result still passes null for the still-unimplemented Coverage Conditional param", () => {
    // Coverage Conditional (a distinct session question from Body Needs' more-coverage)
    // remains orphaned — only Formality and Practical were wired in Step 2A.
    const text = src("result.tsx");
    assert.ok(text.includes("coverageConditional: null"), "coverageConditional is still null");
  });

  it("result no longer hardcodes formalityConditional/practicalIds to null/[] (Step 2A wired both)", () => {
    const text = src("result.tsx");
    assert.ok(!text.includes("formalityConditional: null,"), "formalityConditional is no longer hardcoded null");
    assert.ok(!text.includes("practicalIds: [],"), "practicalIds is no longer hardcoded empty");
  });

  it("result does not redirect to deleted Phase 2 routes", () => {
    const text = src("result.tsx");
    assert.ok(!text.includes('redirect("/style-me/coverage"'), "no coverage redirect");
    assert.ok(!text.includes('redirect("/style-me/formality"'), "no formality redirect");
    assert.ok(!text.includes('redirect("/style-me/today-colours"'), "no today-colours redirect");
    assert.ok(!text.includes('redirect("/style-me/practical"'), "no practical redirect");
  });

  it("result has pending-save flow (save-pending and clear-pending intents)", () => {
    const text = src("result.tsx");
    assert.ok(text.includes('"save-pending"'), "has save-pending intent");
    assert.ok(text.includes('"clear-pending"'), "has clear-pending intent");
    assert.ok(text.includes("writePendingSave"), "uses writePendingSave");
    assert.ok(text.includes("readPendingSave"), "uses readPendingSave");
  });

  it("result has shouldRevalidate export to prevent side-effecting loader re-runs", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("export function shouldRevalidate"), "exports shouldRevalidate");
  });

  // ── bodyNeeds persistence round-trip (Step 1 correctness) ───────

  it("loader persists bodyNeeds when creating StylingSession", () => {
    const text = src("result.tsx");
    // The create payload must include bodyNeeds so the DB stores the original comfort selections.
    assert.ok(
      text.includes("bodyNeeds: bodyNeeds ?? []"),
      "StylingSession.create includes bodyNeeds",
    );
  });

  it("regenerate recovers bodyNeeds from DB session (not hardcoded [])", () => {
    const text = src("result.tsx");
    // Must use session.bodyNeeds, not a literal empty array, so comfort signals survive regenerate.
    assert.ok(
      text.includes("bodyNeeds: session.bodyNeeds ?? []"),
      "regenerate reads bodyNeeds from DB session",
    );
    assert.ok(
      !text.includes("bodyNeeds: [],"),
      "regenerate no longer passes a hardcoded empty array",
    );
  });

  it("multiple bodyNeeds survive the cookie→DB round trip: source is styleMeBodyNeeds from cookie", () => {
    const text = src("result.tsx");
    // The loader reads the normalized array from the cookie session.
    assert.ok(
      text.includes('cookieSession.get("styleMeBodyNeeds")'),
      "loader reads styleMeBodyNeeds from cookie",
    );
    // The create call must reference the bodyNeeds variable derived from that cookie key.
    assert.ok(
      text.includes("bodyNeeds: bodyNeeds ?? []"),
      "create payload uses cookie-derived bodyNeeds variable",
    );
  });

  it("legacy session missing bodyNeeds regenerates safely (null-coalesce fallback)", () => {
    const text = src("result.tsx");
    // The ?? [] guard ensures old sessions with no stored bodyNeeds default to empty array
    // rather than propagating undefined/null into the recommendation engine.
    assert.ok(
      text.includes("session.bodyNeeds ?? []"),
      "null-coalesce guard on session.bodyNeeds for legacy sessions",
    );
  });

  it("style-me.server.ts (dead code) is deleted — no stale imports in result.tsx", () => {
    const text = src("result.tsx");
    assert.ok(
      !text.includes("style-me.server"),
      "result.tsx does not import the deleted style-me.server.ts",
    );
  });

  // ── Step 2A: Desired Feeling copy + softer ──────────────────────

  it("feeling H1 reads 'How do you want to feel in your outfit?'", () => {
    const text = src("feeling.tsx");
    assert.ok(
      text.includes("How do you want to feel in your outfit?"),
      "feeling H1 uses the Step 2A copy",
    );
  });

  // ── Step 2A: What You Need Today — two groups, independent caps ─

  it("comfort renders two visually grouped sections: Fit & Feel and Practical Today", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes("Fit &amp; Feel") || text.includes("Fit & Feel"), "has a Fit & Feel group label");
    assert.ok(text.includes("Practical Today"), "has a Practical Today group label");
  });

  it("comfort does not offer a duplicate 'Feel relaxed' pill; 'Nothing clingy today' remains", () => {
    const text = src("comfort.tsx");
    assert.ok(!text.includes('"Feel relaxed"'), "no duplicate Feel relaxed option");
    assert.ok(text.includes("Nothing clingy today"), "Nothing clingy today kept");
  });

  it("comfort keeps Give me some structure and drops the raw 'structured' label duplication", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes("Give me some structure"), "structured option present with Step 2A wording");
  });

  it("comfort enforces independent 2-max caps for Fit & Feel and Practical", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes("BODY_NEEDS_MAX = 2"), "Fit & Feel cap is 2");
    assert.ok(text.includes("PRACTICAL_MAX = 2"), "Practical cap is 2");
  });

  it("comfort 'nothing-specific' is mutually exclusive with other Fit & Feel selections", () => {
    const text = src("comfort.tsx");
    assert.ok(
      text.includes('id === "nothing-specific"'),
      "toggle handler special-cases nothing-specific for mutual exclusivity",
    );
  });

  it("comfort has 5 Practical options mapped to the existing PSM tokens", () => {
    const text = src("comfort.tsx");
    for (const token of ["movement-friendly", "quick-to-style", "long-day", "practical-footwear", "day-to-night"]) {
      assert.ok(text.includes(token), `practical option ${token} present`);
    }
  });

  it("comfort action stores Practical separately from Fit & Feel (styleMePractical vs styleMeBodyNeeds)", () => {
    const text = src("comfort.tsx");
    assert.ok(text.includes('session.set("styleMeBodyNeeds"'), "sets styleMeBodyNeeds");
    assert.ok(text.includes('session.set("styleMePractical"'), "sets styleMePractical separately");
  });

  // ── Step 2A: Occasion + conditional Formality (same screen) ─────

  it("occasion renders the 4 formality options with exact engine IDs", () => {
    const text = src("occasion.tsx");
    for (const id of ["formality-relaxed", "formality-smart", "formality-polished", "formality-occasion"]) {
      assert.ok(text.includes(id), `formality option ${id} present`);
    }
  });

  it("occasion formality question copy reads 'How dressed-up does this need to be?'", () => {
    const text = src("occasion.tsx");
    assert.ok(text.includes("How dressed-up does this need to be?"));
  });

  it("occasion does not create a separate route/page for formality (same-screen conditional only)", () => {
    const text = src("occasion.tsx");
    // Formality renders inside the same default export, gated by client state — not a redirect/new route.
    assert.ok(text.includes("showFormality"), "conditional render flag exists in the same component");
    assert.ok(!text.includes('redirect("/style-me/formality"'), "no redirect to a separate formality route");
  });

  it("occasion action validates formalityConditional only for occasions in the visibility set", () => {
    const text = src("occasion.tsx");
    assert.ok(
      text.includes("FORMALITY_OCCASIONS.has(occasion)"),
      "server-side action re-checks visibility before honoring formalityConditional",
    );
  });

  it("occasion writes styleMeFormalityConditional to the session", () => {
    const text = src("occasion.tsx");
    assert.ok(text.includes('session.set("styleMeFormalityConditional"'), "sets styleMeFormalityConditional");
  });

  // ── Step 2A: formality + practical persistence across regenerate ─

  it("result loader reads styleMePractical and styleMeFormalityConditional from cookie", () => {
    const text = src("result.tsx");
    assert.ok(text.includes('cookieSession.get("styleMePractical")'), "reads styleMePractical");
    assert.ok(text.includes('cookieSession.get("styleMeFormalityConditional")'), "reads styleMeFormalityConditional");
  });

  it("result loader persists formalityConditional and practicalIds on StylingSession.create", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("formalityConditional,"), "create payload includes formalityConditional");
    assert.ok(text.includes("practicalIds,"), "create payload includes practicalIds");
  });

  it("result generate action reads formalityConditional and practicalIds from form data", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes('formData.get("formalityConditional")'),
      "generate reads formalityConditional from formData",
    );
    assert.ok(
      text.includes('formData.get("practicalIds")'),
      "generate reads practicalIds from formData",
    );
  });

  it("result regenerate recovers formalityConditional and practicalIds from DB session (not hardcoded)", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("formalityConditional: session.formalityConditional"),
      "regenerate reads formalityConditional from DB session",
    );
    assert.ok(
      text.includes("practicalIds: session.practicalIds ?? []"),
      "regenerate reads practicalIds from DB session",
    );
  });

  it("result client effect sends formalityConditional and practicalIds in the initial generate submission", () => {
    const text = src("result.tsx");
    // Read via the narrowed generationData cast (type-safety fix), not loaderData directly.
    assert.ok(
      text.includes("formalityConditional: generationData.formalityConditional"),
      "initial generate submission includes formalityConditional",
    );
    assert.ok(
      text.includes("practicalIds: JSON.stringify(generationData.practicalIds"),
      "initial generate submission includes practicalIds",
    );
  });
});

// ── StyleMe Result Experience cleanup pass ───────────────────────────────────

describe("StyleMe Result Experience — cleanup pass", () => {
  function src(file: string): string {
    const dir = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname);
    return readFileSync(join(dir, file), "utf8");
  }

  // ── Anchor card deduplication ─────────────────────────────────────

  it("result computes anchorAlreadyInItems to detect when anchor is already in the Look", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("anchorAlreadyInItems"), "variable anchorAlreadyInItems exists");
  });

  it("closet anchor dedup uses closetItemId identity — not text comparison", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("anchor.id"),
      "closet dedup compares anchor.id against closetItemId",
    );
    assert.ok(
      text.includes("anchor.type === \"closet\""),
      "closet dedup discriminates on anchor.type",
    );
  });

  it("NADINE anchor dedup compares anchor.handle exactly against primaryHandle", () => {
    const text = src("result.tsx");
    // anchor "trench-coat" + primaryHandle "trench-coat" → true (hide duplicate).
    // anchor "trench-coat" + primaryHandle "collar-shirt" → false (keep anchor card).
    assert.ok(
      text.includes("anchor.handle === suggestionMeta?.primaryHandle"),
      "NADINE dedup uses anchor.handle === primaryHandle (exact identity)",
    );
  });

  it("NADINE anchor dedup does not infer sameness from !item.closetItemId alone", () => {
    const text = src("result.tsx");
    // The NADINE branch must NOT use the broad '!i.closetItemId' existence check —
    // that would hide Anchor Piece whenever any non-closet garment exists, regardless of handle.
    // Verify by checking the NADINE branch text uses handle comparison, not the mainItems filter.
    const nadinaSection = text.slice(
      text.indexOf("anchor.handle === suggestionMeta"),
      text.indexOf("anchor.handle === suggestionMeta") + 80,
    );
    assert.ok(
      !nadinaSection.includes("!i.closetItemId"),
      "NADINE dedup branch does not use !i.closetItemId (that is the closet branch, not here)",
    );
  });

  it("anchor card is gated by !anchorAlreadyInItems — prevents BOTH/CLOSET/NAIA duplication", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("!anchorAlreadyInItems"),
      "anchor card render condition includes !anchorAlreadyInItems",
    );
  });

  // ── Closet item label ─────────────────────────────────────────────

  it("closet item card label is 'Already Yours' (not 'From Your Closet')", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("Already Yours"), "result.tsx contains 'Already Yours'");
    assert.ok(!text.includes("From Your Closet"), "result.tsx does not contain 'From Your Closet'");
  });

  // ── NADINE shopping CTA ───────────────────────────────────────────

  it("NADINE item with productUrl gets a Shop This Piece link", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("Shop This Piece"), "Shop This Piece CTA present in result.tsx");
  });

  it("Shop This Piece CTA is gated by !item.closetItemId — closet items never receive it", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("!item.closetItemId && item.productUrl"),
      "Shop This Piece condition requires !item.closetItemId",
    );
  });

  // ── Footer commerce CTA ───────────────────────────────────────────

  it("Shop nAia footer CTA is suppressed for closet-led results", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("outcome !== \"closet-led\""),
      "Shop nAia is gated by outcome !== 'closet-led'",
    );
  });
});
