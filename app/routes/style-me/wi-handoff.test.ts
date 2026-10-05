// app/routes/style-me/wi-handoff.test.ts
// Wardrobe Intelligence → StyleMe manual-anchor handoff.
// The CTA on /closet/intelligence pre-selects an owned Closet item as the
// existing MANUAL anchor so the customer is never asked to pick it again.
// Text-based contract tests (same convention as route-contract.test.ts) —
// the production DB and the live session cookie are not exercised here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routesDir = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname);
const apiDir = join(routesDir, "..");
const libDir = join(routesDir, "..", "..", "lib");

function src(file: string): string {
  return readFileSync(join(routesDir, file), "utf8");
}
function apiSrc(file: string): string {
  return readFileSync(join(apiDir, file), "utf8");
}
function lib(file: string): string {
  return readFileSync(join(libDir, file), "utf8");
}
function closetIntelligence(): string {
  return readFileSync(join(apiDir, "closet.intelligence.tsx"), "utf8");
}

describe("Wardrobe Intelligence -> StyleMe handoff", () => {
  // ── 1. WI CTA passes the correct closet item ──────────────────────────────

  it("1: WI rediscover card posts the garment's own id to /api/wi-style-this", () => {
    const text = closetIntelligence();
    assert.ok(text.includes('action="/api/wi-style-this"'), "posts to the handoff route");
    assert.ok(
      text.includes('name="closetItemId" value={piece.garmentId}'),
      "hidden field carries this exact piece's garmentId, not a different identifier",
    );
  });

  it("1b: WI CTA copy and visual pattern are unchanged from spec — 'Style this in StyleMe →'", () => {
    const text = closetIntelligence();
    assert.ok(
      text.includes("Style this in StyleMe →"),
      "CTA copy must be the exact approved string",
    );
    // Same text-button visual idiom as the existing 'See what it works with' toggle.
    const css = text.slice(text.indexOf("const css"));
    assert.ok(css.includes(".wi-style-cta"), "a dedicated CTA style exists");
  });

  it("1c: the handoff route is registered in routes.ts (unlike the dead api.styleme-handoff.tsx precedent)", () => {
    const routesTs = readFileSync(join(apiDir, "..", "routes.ts"), "utf8");
    assert.ok(
      routesTs.includes('route("api/wi-style-this", "routes/api.wi-style-this.tsx")'),
      "api/wi-style-this must be registered or the CTA 404s",
    );
  });

  // ── 2. The item becomes the existing MANUAL anchor (no second anchor system) ─

  it("2: the handoff writes the same styleMeClosetAnchorId key the manual picker uses — no parallel anchor field", () => {
    const handoff = apiSrc("api.wi-style-this.tsx");
    const sourceTsx = src("source.tsx");
    assert.ok(
      handoff.includes('session.set("styleMeClosetAnchorId", resolved.id)'),
      "handoff sets styleMeClosetAnchorId",
    );
    assert.ok(
      sourceTsx.includes('session.set("styleMeClosetAnchorId", closetItemId)'),
      "manual picker also sets styleMeClosetAnchorId — same key, same downstream resolution",
    );
    assert.ok(
      !handoff.includes("styleMeWiAnchorId") && !handoff.includes("WardrobeAnchor"),
      "no second, WI-specific anchor field is introduced",
    );
  });

  it("2b: the handoff sets styleMeSource/styleMeMode exactly as the existing closet-only flow expects", () => {
    const handoff = apiSrc("api.wi-style-this.tsx");
    assert.ok(handoff.includes('session.set("styleMeSource", "my-closet")'));
    assert.ok(handoff.includes('session.set("styleMeMode", "naia")'));
  });

  // ── 3. The user is not asked to select it again ───────────────────────────

  it("3: source.tsx loader short-circuits to an 'anchor-locked' confirmation before the anchor-method/closet-anchor picker steps", () => {
    const text = src("source.tsx");
    const lockedIdx = text.indexOf('session.get("styleMeAnchorLocked")');
    const anchorModeIdx = text.indexOf('const anchorMode = session.get("styleMeAnchorMode")');
    assert.ok(lockedIdx !== -1, "loader reads styleMeAnchorLocked");
    assert.ok(anchorModeIdx !== -1, "loader still reads styleMeAnchorMode for the normal flow");
    assert.ok(
      lockedIdx < anchorModeIdx,
      "the anchor-locked check must run BEFORE the anchor-method/closet-anchor branch, so a locked anchor is never re-asked",
    );
    assert.ok(text.includes('step: "anchor-locked"'), "loader can return the anchor-locked step");
    assert.ok(text.includes("AnchorLockedStep"), "a dedicated step component renders the confirmation");
  });

  it("3b: AnchorLockedStep shows 'Styling around' and a Change piece control, not a picker", () => {
    const text = src("source.tsx");
    const compStart = text.indexOf("function AnchorLockedStep");
    const compBody = text.slice(compStart, compStart + 1200);
    assert.ok(compBody.includes("Styling around"), "heading matches the desired UX");
    assert.ok(compBody.includes("Change piece"), "Change piece control is present");
    assert.ok(!compBody.includes("sm-item-picker"), "does not render the closet item grid");
  });

  // ── 4. Another customer's closet item cannot be injected ──────────────────

  it("4: the handoff resolves ownership via resolveClosetAnchor(customerId, closetItemId) — never trusts the posted id alone", () => {
    const handoff = apiSrc("api.wi-style-this.tsx");
    assert.ok(handoff.includes("resolveClosetAnchor"), "imports the ownership-checked resolver");
    assert.ok(
      handoff.includes("resolveClosetAnchor(naiaCustomer.id, closetItemId)"),
      "resolution is scoped to the authenticated customer's id, not an id read from the form alone",
    );
    assert.ok(
      handoff.includes("if (!naiaCustomer)"),
      "requires an authenticated nAia customer before resolving anything",
    );
  });

  it("4b: resolveClosetAnchor itself scopes the DB lookup by customerId (foreign item resolves to null)", () => {
    const anchorServer = lib("ai/styleme-anchor.server.ts");
    assert.ok(
      anchorServer.includes("prisma.closetItem.findFirst({\n    where: { id: closetItemId, customerId },"),
      "resolveClosetAnchor's DB query must filter by customerId, not id alone",
    );
  });

  // ── 5. Invalid/deleted item fails safely ──────────────────────────────────

  it("5: the handoff redirects back to Wardrobe Intelligence (no anchor set) when resolution fails", () => {
    const handoff = apiSrc("api.wi-style-this.tsx");
    const idx = handoff.indexOf("if (!resolved)");
    const block = handoff.slice(idx, idx + 120);
    assert.ok(block.includes('redirect("/closet/intelligence")'), "fails back to the WI page, not into a broken StyleMe session");
    // The failure branch must come before any session.set call.
    const firstSet = handoff.indexOf("session.set(");
    assert.ok(idx < firstSet, "failure check runs before any session anchor is written");
  });

  it("5b: source.tsx loader re-validates the locked anchor on every visit and drops the lock if it no longer resolves", () => {
    const text = src("source.tsx");
    const lockedIdx = text.indexOf('session.get("styleMeAnchorLocked")');
    const block = text.slice(lockedIdx, lockedIdx + 900);
    assert.ok(block.includes("resolveClosetAnchor(naiaCustomer.id, closetAnchorId)"), "re-resolves ownership, does not trust the stale cookie value");
    assert.ok(block.includes('session.unset("styleMeAnchorLocked")'), "drops the lock on failed re-resolution");
    assert.ok(block.includes('session.unset("styleMeClosetAnchorId")'), "drops the stale anchor id too — never styles around a deleted item");
    assert.ok(
      block.includes('redirect("/style-me/source"'),
      "falls back to the normal flow rather than crashing or silently keeping a dead anchor",
    );
  });

  // ── 6. Change piece returns to normal manual selection ────────────────────

  it("6: 'change-piece' intent unlocks and routes straight into the normal manual closet picker", () => {
    const text = src("source.tsx");
    const idx = text.indexOf('intent === "change-piece"');
    assert.ok(idx !== -1, "change-piece intent is handled");
    const block = text.slice(idx, idx + 400);
    assert.ok(block.includes('session.unset("styleMeAnchorLocked")'));
    assert.ok(block.includes('session.unset("styleMeClosetAnchorId")'), "clears the preselected item — it is not forced back on the customer");
    assert.ok(
      block.includes('session.set("styleMeAnchorMode", "manual")'),
      "goes straight to ClosetAnchorStep (the same component manual picks already use), per 'return to the normal manual closet selector'",
    );
    assert.ok(block.includes('redirect("/style-me/source"'));
  });

  // ── 7 & 8. New Look / Adjust Vibe preserve the preselected anchor ─────────
  // The preselected anchor rides in the same styleMeClosetAnchorId /
  // StylingSession.closetAnchorId path a manual pick already uses, so these
  // existing invariants in result.tsx must remain untouched by this change.

  it("7: regenerate ('New Look, Same Vibe') re-resolves the anchor from the persisted DB session, unchanged", () => {
    const result = readFileSync(join(apiDir, "style-me", "result.tsx"), "utf8");
    const regenIdx = result.indexOf('intent === "regenerate"');
    assert.ok(regenIdx !== -1, "regenerate intent handler exists");
    const block = result.slice(regenIdx, regenIdx + 1200);
    assert.ok(
      block.includes("resolveActionAnchor"),
      "regenerate still re-resolves the anchor through the single ownership/eligibility gate",
    );
    assert.ok(
      block.includes("closetAnchorId"),
      "regenerate still threads closetAnchorId through — a WI-sourced anchor is indistinguishable from a manual one here",
    );
  });

  it("8: adjust-vibe does not clear styleMeClosetAnchorId — the preselected piece survives the vibe-only re-ask loop", () => {
    const result = readFileSync(join(apiDir, "style-me", "result.tsx"), "utf8");
    const idx = result.indexOf('intent === "adjust-vibe"');
    assert.ok(idx !== -1, "adjust-vibe intent handler exists");
    const block = result.slice(idx, idx + 600);
    assert.ok(
      !block.includes('session.unset("styleMeClosetAnchorId")'),
      "adjust-vibe must not unset the closet anchor — otherwise the engine would silently swap anchors",
    );
  });

  // ── 9. Normal StyleMe entry (no preselection) behaves exactly as before ──

  it("9: the anchor-locked branch only activates when styleMeAnchorLocked === '1' — unrelated sessions are unaffected", () => {
    const text = src("source.tsx");
    assert.ok(
      text.includes('session.get("styleMeAnchorLocked") === "1"'),
      "lock check is a strict equality gate, not a truthy-string trap (e.g. would not fire on a stale non-\"1\" value)",
    );
    // The original anchor-method / closet-anchor branches must be byte-present and unmodified in shape.
    assert.ok(text.includes('if (anchorMode === "manual") {'), "original manual-picker branch is untouched");
    assert.ok(text.includes('{ step: "anchor-method" as const'), "original anchor-method step is untouched");
  });

  it("9b: styleMeAnchorLocked is cleared by clearStyleMeSession (Start Over leaves no stale lock behind)", () => {
    const sessionServer = lib("session.server.ts");
    assert.ok(
      sessionServer.includes('"styleMeAnchorLocked"'),
      "styleMeAnchorLocked must be one of the keys clearStyleMeSession unsets",
    );
  });

  it("9c: AnchorInput/engine types are untouched — no source/selectionMethod field was added to the anchor shape", () => {
    const types = lib("ai/styleme-recommendation.types.ts");
    assert.ok(
      !types.includes("selectionMethod") && !types.includes('source: "wi"'),
      "the engine's AnchorInput contract is unchanged — WI pre-selection is invisible to it, exactly like a manual pick",
    );
  });
});
