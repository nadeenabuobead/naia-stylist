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

  it("occasion does not import signal-contract", () => {
    const text = src("occasion.tsx");
    assert.ok(!text.includes("signal-contract"), "no signal-contract import");
  });

  // ── source.tsx ───────────────────────────────────────────────────

  it("source uses field name 'source' and stores styleMeSource", () => {
    const text = src("source.tsx");
    assert.ok(text.includes('formData.get("source")'), "reads source field");
    assert.ok(text.includes('session.set("styleMeSource", source)'), "sets styleMeSource");
  });

  it("source has multi-step anchor selection (Phase 4B3 feature)", () => {
    const text = src("source.tsx");
    assert.ok(text.includes("getAllCatalogProducts"), "imports catalog products");
    assert.ok(text.includes("getCurrentNaiaCustomer"), "resolves naiaCustomer");
    assert.ok(text.includes("NadineAnchorStep"), "has nAia anchor step component");
    assert.ok(text.includes("ClosetAnchorStep"), "has closet anchor step component");
    assert.ok(text.includes("set-anchor"), "has set-anchor intent");
  });

  it("source anchor action stores styleMeNadineAnchorHandle or styleMeClosetAnchorId", () => {
    const text = src("source.tsx");
    assert.ok(text.includes('session.set("styleMeNadineAnchorHandle"'), "sets nadine anchor handle");
    assert.ok(text.includes('session.set("styleMeClosetAnchorId"'), "sets closet anchor id");
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

  it("result passes null/empty for Phase 2 params in buildEngineInput", () => {
    const text = src("result.tsx");
    assert.ok(text.includes("coverageConditional: null"), "coverageConditional is null");
    assert.ok(text.includes("formalityConditional: null"), "formalityConditional is null");
    assert.ok(text.includes("practicalIds: []"), "practicalIds is empty array");
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
});
