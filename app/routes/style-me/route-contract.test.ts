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

  it("occasion back link is derived from isRev3 (physical-need for Rev3, comfort for legacy)", () => {
    const text = src("occasion.tsx");
    // Rev 3: back to /style-me/physical-need
    assert.ok(text.includes('"/style-me/physical-need"'), "Rev 3 path links to physical-need");
    // Legacy: back to /style-me/comfort
    assert.ok(text.includes('"/style-me/comfort"'), "legacy path links to comfort");
    // Dynamic derivation — backTo is set via isRev3, not a single hardcoded literal
    assert.ok(text.includes("isRev3"), "backTo is conditional on isRev3");
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

  it("source offers two anchor paths for closet sources — auto and manual", () => {
    const text = src("source.tsx");
    // Both paths are present
    assert.ok(text.includes("AnchorMethodStep"), "AnchorMethodStep presents the LET nAia CHOOSE / I HAVE A PIECE IN MIND choice");
    assert.ok(text.includes("ClosetAnchorStep"), "ClosetAnchorStep present for manual path — 'Which piece are we building around?'");
    assert.ok(text.includes('"set-anchor"'), "set-anchor intent present for manual selection");
    assert.ok(text.includes("set-anchor-method"), "set-anchor-method intent handles auto vs manual choice");
    // Auto path
    assert.ok(text.includes("autoSelectClosetAnchor"), "auto path calls autoSelectClosetAnchor");
    assert.ok(text.includes("getCurrentNaiaCustomer"), "resolves naiaCustomer for closet operations");
    // No NADINE picker (NADINE-only is handled by engine, not a UI picker)
    assert.ok(!text.includes("NadineAnchorStep"), "no NADINE product picker component");
    assert.ok(!text.includes("getAllCatalogProducts"), "no catalog product import");
  });

  it("source ClosetAnchorStep imposes no category restriction — any closet item can be manually selected", () => {
    const text = src("source.tsx");
    // The ANCHOR_CAPABLE_CATEGORIES set lives in the anchor server (used for auto-selection tiebreaking only).
    // source.tsx must not import or reference it — manual selection is unrestricted.
    assert.ok(!text.includes("ANCHOR_CAPABLE_CATEGORIES"), "ANCHOR_CAPABLE_CATEGORIES not referenced in source.tsx — manual picker shows all closet items");
    // set-anchor validates ownership by customerId, not by category.
    assert.ok(text.includes('"closetItemId"'), "reads closetItemId from form in set-anchor");
    assert.ok(text.includes("customerId: naiaCustomer.id"), "set-anchor validates item ownership via customerId, not category");
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
      text.includes("!item.closetItemId && shopUrl"),
      "Shop This Piece condition requires !item.closetItemId and derived shopUrl",
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

  // ── VTO contradiction guard ───────────────────────────────────────

  it("real VtoExperience and 'See This Look On Me' future-update section cannot render simultaneously", () => {
    const text = src("result.tsx");
    // vtoIsActive must be derived and used to suppress showTryOnSection.
    assert.ok(text.includes("vtoIsActive"), "vtoIsActive derived flag must exist in result.tsx");
    assert.ok(
      text.includes("!vtoIsActive"),
      "showTryOnSection must be suppressed (!vtoIsActive) when VtoExperience is active",
    );
  });
});

// ── StyleMe Result Actions cleanup ───────────────────────────────────────────

describe("StyleMe Result Actions — cleanup pass", () => {
  function src(file: string): string {
    const dir = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname);
    return readFileSync(join(dir, file), "utf8");
  }

  function lib(file: string): string {
    const base = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../..", "lib");
    return readFileSync(join(base, file), "utf8");
  }

  // ── Adjust Vibe ──────────────────────────────────────────────────

  it("Adjust Vibe links to /style-me/feeling", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes('to="/style-me/feeling"'),
      "result.tsx must contain a link to /style-me/feeling",
    );
    assert.ok(
      text.includes("Adjust Vibe"),
      "result.tsx must render 'Adjust Vibe' label",
    );
  });

  // ── Start Over ───────────────────────────────────────────────────

  it("Start Over submits intent=start-over via POST (not a plain link)", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes('value="start-over"'),
      "result.tsx must include a hidden field with value='start-over'",
    );
    // The old pattern was exactly: Link to="/style-me" ... Start Over</Link>
    // That pattern is gone — verify the old combined string is absent.
    assert.ok(
      !text.includes('to="/style-me"') || !text.includes(">Start Over</Link>"),
      "Start Over must not be a plain <Link to='/style-me'>",
    );
    // Positive check: a Form with method=post and intent=start-over is present.
    assert.ok(
      text.includes('method="post"') && text.includes('value="start-over"'),
      "Start Over must use a Form with method=post and intent=start-over",
    );
  });

  it("start-over action handler exists and redirects to /style-me/state (Rev 3 contract)", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes('intent === "start-over"'),
      "action must handle intent=start-over",
    );
    assert.ok(
      text.includes('redirect("/style-me/state"'),
      "start-over must redirect to /style-me/state (Rev 3 entry point)",
    );
    assert.ok(
      !text.includes('redirect("/style-me/mood"') || text.indexOf('redirect("/style-me/state"') < text.indexOf('redirect("/style-me/mood"'),
      "start-over action must not redirect to /style-me/mood",
    );
  });

  it("clearStyleMeSession is imported and called in the start-over handler", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("clearStyleMeSession"),
      "result.tsx must import and call clearStyleMeSession",
    );
  });

  it("clearStyleMeSession in session.server.ts unsets all 9 StyleMe flow keys", () => {
    const text = lib("session.server.ts");
    const STYLEME_KEYS = [
      "styleMeMood",
      "styleMeFeelings",
      "styleMeBodyNeeds",
      "styleMePractical",
      "styleMeOccasion",
      "styleMeFormalityConditional",
      "styleMeSource",
      "styleMeNadineAnchorHandle",
      "styleMeClosetAnchorId",
    ];
    for (const key of STYLEME_KEYS) {
      assert.ok(
        text.includes(`"${key}"`),
        `clearStyleMeSession must reference "${key}"`,
      );
    }
  });

  it("clearStyleMeSession does not call destroySession (auth PKCE state preserved)", () => {
    const text = lib("session.server.ts");
    // destroySession would wipe the entire __naia_session cookie including any
    // in-flight pkce_verifier/pkce_state/pkce_nonce keys. clearStyleMeSession
    // must use session.unset() per key instead.
    const clearFnStart = text.indexOf("export async function clearStyleMeSession");
    const clearFnBody = text.slice(clearFnStart, clearFnStart + 500);
    assert.ok(
      !clearFnBody.includes("destroySession"),
      "clearStyleMeSession must not call destroySession",
    );
  });

  it("clearStyleMeSession does not clear auth token (__naia_tok)", () => {
    const text = lib("session.server.ts");
    const clearFnStart = text.indexOf("export async function clearStyleMeSession");
    const clearFnBody = text.slice(clearFnStart, clearFnStart + 500);
    assert.ok(
      !clearFnBody.includes("__naia_tok"),
      "clearStyleMeSession must not touch the auth session cookie",
    );
  });

  // ── Rate This Look removed ────────────────────────────────────────

  it("Rate This Look button is not rendered on the result page", () => {
    const text = src("result.tsx");
    assert.ok(
      !text.includes("Rate This Look"),
      "result.tsx must not render 'Rate This Look' (moved to after-wear context)",
    );
  });

  it("PostOutfitReview route action is preserved (intent=review handler kept)", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes('intent === "review"'),
      "action must still handle intent=review (DB persistence kept for after-wear placement)",
    );
  });

  // ── Save and New Look still present ──────────────────────────────

  it("Save button is still present on the result page", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes('"save"') || text.includes("intent: \"save\""),
      "result.tsx must still submit intent=save",
    );
  });

  it("New Look, Same Vibe is still present on the result page", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("New Look, Same Vibe"),
      "result.tsx must still render 'New Look, Same Vibe'",
    );
    assert.ok(
      text.includes('"regenerate"'),
      "result.tsx must still submit intent=regenerate",
    );
  });
});

// ── OutfitReactionWidget — Quick Feedback ────────────────────────────────────

describe("OutfitReactionWidget — Quick Feedback", () => {
  function src(file: string): string {
    const dir = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname);
    return readFileSync(join(dir, file), "utf8");
  }

  function component(file: string): string {
    const base = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../..", "components");
    return readFileSync(join(base, file), "utf8");
  }

  // ── Component contract ──────────────────────────────────────────────

  it("OutfitReactionWidget.tsx exists", () => {
    assert.ok(
      existsSync(join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../..", "components", "OutfitReactionWidget.tsx")),
      "OutfitReactionWidget.tsx must exist in app/components/",
    );
  });

  it("OutfitReactionWidget heading is 'How does this look feel?'", () => {
    const text = component("OutfitReactionWidget.tsx");
    assert.ok(
      text.includes("How does this look feel?"),
      "OutfitReactionWidget must render the heading 'How does this look feel?'",
    );
  });

  it("OutfitReactionWidget target is hardcoded to complete-suggestion", () => {
    const text = component("OutfitReactionWidget.tsx");
    assert.ok(
      text.includes('"complete-suggestion"'),
      "OutfitReactionWidget must hardcode target = 'complete-suggestion'",
    );
    assert.ok(
      !text.includes("FeedbackTarget") || !text.includes("target: FeedbackTarget"),
      "OutfitReactionWidget must not accept target as a prop — it is always 'complete-suggestion'",
    );
  });

  it("OutfitReactionWidget props do not include shopifyProductId or closetItemId", () => {
    const text = component("OutfitReactionWidget.tsx");
    // Props interface must not declare shopifyProductId or closetItemId.
    const propsStart = text.indexOf("OutfitReactionWidgetProps");
    const propsBlock = text.slice(propsStart, propsStart + 600);
    assert.ok(
      !propsBlock.includes("shopifyProductId"),
      "OutfitReactionWidgetProps must not include shopifyProductId",
    );
    assert.ok(
      !propsBlock.includes("closetItemId"),
      "OutfitReactionWidgetProps must not include closetItemId",
    );
  });

  it("OutfitReactionWidget accepts existingFeedbackId prop for idempotency", () => {
    const text = component("OutfitReactionWidget.tsx");
    assert.ok(
      text.includes("existingFeedbackId"),
      "OutfitReactionWidget must accept existingFeedbackId prop to prevent duplicate records on refresh",
    );
  });

  it("OutfitReactionWidget uses update intent when existingFeedbackId is set", () => {
    const text = component("OutfitReactionWidget.tsx");
    assert.ok(
      text.includes('"update"') && text.includes("existingFeedbackId") || text.includes("feedbackId"),
      "OutfitReactionWidget must use update intent when a feedback record already exists",
    );
    assert.ok(
      text.includes('"create"'),
      "OutfitReactionWidget must use create intent for new feedback",
    );
  });

  it("OutfitReactionWidget posts to /api/recommendation-feedback", () => {
    const text = component("OutfitReactionWidget.tsx");
    assert.ok(
      text.includes('"/api/recommendation-feedback"'),
      "OutfitReactionWidget must submit to /api/recommendation-feedback",
    );
  });

  // ── Result page integration ─────────────────────────────────────────
  // OutfitReactionWidget is NOT wired into result.tsx — the current post-wear
  // path is StyleMeOutcome (outcome-contract + api.styleme-outcome).

  it("result.tsx imports loadSessionFeedback for feedback pre-loading", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("loadSessionFeedback"),
      "result.tsx must import loadSessionFeedback to pre-load existing outfit feedback",
    );
  });

  it("result loader pre-loads existingOutfitFeedback from session feedback", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("existingOutfitFeedback"),
      "result loader must supply existingOutfitFeedback in all loader return branches",
    );
    assert.ok(
      text.includes('target === "complete-suggestion"'),
      "result loader must filter pre-loaded feedback by target === 'complete-suggestion'",
    );
  });

  // ── Suggestion-scoped idempotency ──────────────────────────────────

  it("result loader filters existingOutfitFeedback by both target AND suggestionId (not sessionId alone)", () => {
    const text = src("result.tsx");
    // The lookup must check both conditions together to be suggestion-scoped.
    // A session-only filter would return Look A's feedback when Look B is displayed.
    assert.ok(
      text.includes('f.target === "complete-suggestion"') && text.includes("f.suggestionId ==="),
      "existingOutfitFeedback lookup must filter by both target and suggestionId",
    );
  });

  it("pending-save loader also filters existingOutfitFeedback by suggestionId (not sessionId alone)", () => {
    const text = src("result.tsx");
    // Both the direct-sessionId path and the pending-save path must scope by suggestionId.
    const occurrences = (text.match(/f\.suggestionId ===/g) ?? []).length;
    assert.ok(
      occurrences >= 2,
      `both loader paths must filter by f.suggestionId === (found ${occurrences} occurrence(s))`,
    );
  });

  it("OutfitReactionWidget passes suggestionId in the create call (new feedback tied to current suggestion)", () => {
    const text = component("OutfitReactionWidget.tsx");
    // Create payload must include suggestionId so the DB record is scoped to the suggestion.
    assert.ok(
      text.includes("suggestionId,") || text.includes("suggestionId:"),
      "OutfitReactionWidget create payload must include suggestionId",
    );
  });
});

// ── StyleMe Rev 3 Pre-QA Cleanup — Regression Tests ─────────────────────────
// Tests A–N cover the confirmed issues fixed in the Rev 3 pre-QA cleanup batch.

describe("StyleMe Rev 3 Pre-QA cleanup — regression tests", () => {
  function src(file: string): string {
    const dir = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname);
    return readFileSync(join(dir, file), "utf8");
  }
  function lib(file: string): string {
    const base = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../..", "lib");
    return readFileSync(join(base, file), "utf8");
  }

  // A. Rev 3 start-over action redirects to /style-me/state
  it("A: start-over action redirects to /style-me/state", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes('intent === "start-over"') && text.includes('redirect("/style-me/state"'),
      "start-over intent handler must redirect to /style-me/state",
    );
  });

  // B. start-over clears StyleMe session
  it("B: start-over clears StyleMe session via clearStyleMeSession", () => {
    const text = src("result.tsx");
    const startOverIdx = text.indexOf('intent === "start-over"');
    const nextBlock = text.slice(startOverIdx, startOverIdx + 400);
    assert.ok(
      nextBlock.includes("clearStyleMeSession"),
      "start-over block must call clearStyleMeSession before redirecting",
    );
  });

  // C. error-state Start Again uses canonical restart behavior (intent=start-over)
  it("C: error-state Start Again submits intent=start-over (not a plain link)", () => {
    const text = src("result.tsx");
    // Anchor on the error JSX block gating expression — only present in the component
    const errorBlockStart = text.indexOf("error || !suggestion");
    assert.ok(errorBlockStart !== -1, "error || !suggestion guard must exist in result.tsx");
    const errorBlock = text.slice(errorBlockStart, errorBlockStart + 1000);
    assert.ok(
      errorBlock.includes('value="start-over"'),
      "error-state must submit intent=start-over via a Form",
    );
    assert.ok(
      errorBlock.includes("Start Again"),
      "error-state must render 'Start Again' label",
    );
  });

  // D. error-state does not link Rev 3 customer to /style-me/mood
  it("D: error-state Start Again does not link to /style-me/mood", () => {
    const text = src("result.tsx");
    const errorBlockStart = text.indexOf("Something went wrong");
    const errorBlock = text.slice(errorBlockStart, errorBlockStart + 600);
    assert.ok(
      !errorBlock.includes('"/style-me/mood"') && !errorBlock.includes("to=\"/style-me/mood\""),
      "error-state must not contain a link to /style-me/mood",
    );
  });

  // E. pure Rev 3 result uses rev3State
  it("E: result context grid reads rev3State for Rev 3 sessions", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("rev3State") && text.includes("REV3_STATE_LABELS"),
      "result.tsx must reference rev3State and REV3_STATE_LABELS in the context grid",
    );
  });

  // F. pure Rev 3 result uses rev3Intentions
  it("F: result context grid reads rev3Intentions for Rev 3 sessions", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("rev3Intentions") && text.includes("REV3_INTENTION_LABELS"),
      "result.tsx must reference rev3Intentions and REV3_INTENTION_LABELS in the context grid",
    );
  });

  // G. Rev 3 state renders human label, not raw ID
  it("G: REV3_STATE_LABELS map is defined with human-readable labels", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("REV3_STATE_LABELS"), "REV3_STATE_LABELS must be defined");
    assert.ok(text.includes('"stressed-overloaded"'), "must include stressed-overloaded key");
    assert.ok(text.includes('"Stressed / overloaded"'), "must map to human-readable label");
    assert.ok(text.includes('"feel-good"'), "must include feel-good key");
    assert.ok(text.includes('"I feel good"'), "must map feel-good to human label");
  });

  // H. one intention renders correctly (join with ·)
  it("H: one intention renders using REV3_INTENTION_LABELS (no separator on single)", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes(".join(") && text.includes('" · "'),
      "rev3Intentions must be joined with ' · ' separator (renders correctly for 1 or 2)",
    );
  });

  // I. two intentions render correctly
  it("I: two intentions render as joined labels separated by ·", () => {
    const text = src("result.tsx");
    // The join pattern handles 1 or 2 intentions; ensure the separator is the expected one
    assert.ok(
      text.includes('" · "'),
      "separator must be ' · ' (middle dot with spaces) for two intentions",
    );
    assert.ok(
      text.includes("REV3_INTENTION_LABELS"),
      "each intention is mapped through REV3_INTENTION_LABELS before joining",
    );
  });

  // J. Rev 3 result contains no blank legacy mood/feeling rows
  it("J: Rev 3 context grid suppresses legacy mood/feeling rows when rev3State is set", () => {
    const text = src("result.tsx");
    // The Rev 3 branch must be conditional — legacy rows only render in the else branch
    // Confirm the pattern: rev3State check gates the two branches
    assert.ok(
      text.includes("rev3State ?") || text.includes("rev3State &&") || (text.includes("rev3State") && text.includes("? (")),
      "context grid must branch on rev3State to prevent blank legacy rows",
    );
  });

  // K. occasion still renders correctly
  it("K: occasion label renders for Rev 3 sessions using OCCASION_LABELS", () => {
    const text = src("result.tsx");
    // The Rev 3 branch in the template uses REV3_STATE_LABELS inline — anchor on it
    const templateUsage = text.indexOf("REV3_STATE_LABELS[(loaderData");
    assert.ok(templateUsage !== -1, "REV3_STATE_LABELS must be used in the template");
    const rev3Section = text.slice(templateUsage, templateUsage + 1500);
    assert.ok(
      rev3Section.includes("OCCASION_LABELS") && rev3Section.includes("Dressing for"),
      "Rev 3 branch must render the occasion row using OCCASION_LABELS",
    );
  });

  // L. genuine legacy result behavior remains supported
  it("L: legacy context grid branch still renders You're Feeling and You Want to Feel rows", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("You're Feeling") && text.includes("MOOD_LABELS"),
      "legacy branch must render You're Feeling with MOOD_LABELS",
    );
    assert.ok(
      text.includes("You Want to Feel") && text.includes("FEELING_LABELS"),
      "legacy branch must render You Want to Feel with FEELING_LABELS",
    );
  });

  // M. loading copy no longer says "mood"
  it("M: loading copy does not contain the word 'mood'", () => {
    const text = src("result.tsx");
    // Only the loading spinner paragraph should be checked; MOOD_LABELS still contains the word
    // so we scope the check to the loading state paragraph text
    const loadingParagraph = text.slice(text.indexOf("nAia is styling you"), text.indexOf("sm-loading-track"));
    assert.ok(
      !loadingParagraph.toLowerCase().includes("mood"),
      "loading subtitle must not reference 'mood'",
    );
  });

  // N. new loading copy exact string
  it("N: loading copy exact string is 'Building your look around what you need today, the occasion, and your wardrobe.'", () => {
    const text = src("result.tsx");
    assert.ok(
      text.includes("Building your look around what you need today, the occasion, and your wardrobe."),
      "loading copy must match the exact approved string",
    );
  });

  // Bonus: clearStyleMeSession references Rev 3 session keys
  it("clearStyleMeSession unsets styleMeState and styleMeIntentions (Rev 3 keys)", () => {
    const text = lib("session.server.ts");
    assert.ok(text.includes('"styleMeState"'), "clearStyleMeSession must unset styleMeState");
    assert.ok(text.includes('"styleMeIntentions"'), "clearStyleMeSession must unset styleMeIntentions");
  });
});
