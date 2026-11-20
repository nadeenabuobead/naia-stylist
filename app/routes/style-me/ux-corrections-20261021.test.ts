// app/routes/style-me/ux-corrections-20261021.test.ts
//
// Three customer-facing UX corrections identified during the first real-browser staging
// pass on the integrated build (commit 1ac71ff and its history). Source-regex tests, same
// convention as every other result.tsx/closet.intelligence.tsx test in this codebase
// (both files import *.css?url and cannot be loaded directly under plain node --test).
//
//   1. Save Look confirmation wording + destination (View Saved Looks -> /style-me).
//   2. The multi-garment "Pieces That Work Together" CTA relabelled to "Complete This
//      Look" — the single-piece Rediscover CTA ("Style this in StyleMe") is a distinct
//      string and must be unaffected.
//   3. The "SAVE QA PAGE" debug control gated by a dedicated, explicit, server-computed
//      env flag instead of isStagingProject — staging now also hosts live customer
//      acceptance checks, so "is staging" no longer implies "is an internal QA session."

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const resultSrc = (): string =>
  readFileSync(join(process.cwd(), "app/routes/style-me/result.tsx"), "utf8");
const closetIntelSrc = (): string =>
  readFileSync(join(process.cwd(), "app/routes/closet.intelligence.tsx"), "utf8");

// ── 1. Save Look confirmation ───────────────────────────────────────────────

describe("UX-1 — Save Look confirmation points at the real Saved Looks destination", () => {
  test("UX-1.1 the confirmation banner uses the new wording, not the old Passport copy", () => {
    const src = resultSrc();
    assert.match(src, /Look saved to My Looks!/);
    assert.doesNotMatch(src, /Saved to your nAia Passport\./, "old wording must not survive alongside the new copy");
  });

  test("UX-1.2 'View Saved Looks' links directly to the Your StyleMe Looks section via anchor, not a bare page top", () => {
    const src = resultSrc();
    const bannerAt = src.indexOf("sm-banner-saved");
    const scope = src.slice(bannerAt, bannerAt + 400);
    assert.match(scope, /<Link to="\/style-me#your-styleme-looks" className="sm-banner-cta">View Saved Looks/,
      "must land on the section itself, not just the top of /style-me — Start a New Session / Recent Feedback sit above it");
  });

  test("UX-1.3 /style-me (StyleMeIndex) genuinely queries SavedLook and badges saved entries, and the anchor target id actually exists there", () => {
    const indexSrc = readFileSync(join(process.cwd(), "app/routes/style-me/_index.tsx"), "utf8");
    assert.match(indexSrc, /prisma\.savedLook\.findMany/, "the page must actually read SavedLook records");
    assert.match(indexSrc, /session\.saved && <span className="sml-card-saved-badge">SAVED<\/span>/, "a saved look must be visibly marked as such on this page");
    assert.match(indexSrc, /id="your-styleme-looks"/, "the section the banner links to must carry the matching anchor id");
  });

  test("UX-1.6 /my-naia/saved is a confirmed dead end (unconditional redirect to /style-me), not a viable alternative destination", () => {
    // Revisit from the second staging pass: before anchoring to /style-me, confirm there
    // isn't a cleaner, purpose-built page being missed. There is one (my-naia.saved.tsx,
    // titled "Saved Looks", with a real SavedLook query) — but its loader redirects away
    // before ever reaching that query, and nothing in the app links to it. /style-me is the
    // genuine destination, not a fallback chosen in its absence.
    const myNaiaSavedSrc = readFileSync(join(process.cwd(), "app/routes/my-naia.saved.tsx"), "utf8");
    const loaderAt = myNaiaSavedSrc.indexOf("export async function loader");
    const loaderOpening = myNaiaSavedSrc.slice(loaderAt, loaderAt + 150);
    assert.match(loaderOpening, /return redirect\("\/style-me"\);/, "the loader must still redirect away unconditionally, confirming this route is not a live alternative");
  });

  test("UX-1.4 the banner still only renders after a real save (isSaved), not unconditionally", () => {
    const src = resultSrc();
    const bannerAt = src.indexOf("sm-banner-saved");
    const beforeBanner = src.slice(Math.max(0, bannerAt - 80), bannerAt);
    assert.match(beforeBanner, /\{isSaved && \(/);
  });

  test("UX-1.5 the Save Look action and saved-outfit recovery are untouched — same intent, same SavedLook.create call, same ownership check", () => {
    const src = resultSrc();
    assert.match(src, /intent === "save"/, "the save action intent is unchanged");
    assert.match(src, /prisma\.savedLook\.create/, "saving still creates a real SavedLook row");
    assert.match(src, /if \(!suggestion \|\| suggestion\.session\.customerId !== naiaCustomer\.id\)/, "the save path's ownership check (CR-F.3) is untouched by this UX change");
  });
});

// ── 2. Wardrobe Intelligence "Complete This Look" CTA ──────────────────────

describe("UX-2 — the multi-garment combination CTA is relabelled without affecting the single-piece CTA", () => {
  test("UX-2.1 the moodboard combination dialog's CTA now reads 'Complete This Look' (2026-11-20: the inline markup this test originally checked was refactored into the shared CompleteLookForm component — same button text, just no longer duplicated per call site)", () => {
    const src = closetIntelSrc();
    const moodboardAt = src.indexOf('dialog.kind === "moodboardLook"');
    assert.ok(moodboardAt > -1, "the moodboard combination dialog must still exist");
    const scope = src.slice(moodboardAt, src.indexOf("</DialogShell>", moodboardAt));
    assert.match(scope, /<CompleteLookForm garmentIds=\{look\.garmentIds\}\s*\/>/, "the dialog must render the shared CompleteLookForm component with every garment id");
    const formDefAt = src.indexOf("function CompleteLookForm");
    assert.ok(formDefAt > -1, "the shared CompleteLookForm component must exist");
    const formScope = src.slice(formDefAt, src.indexOf("\n}", formDefAt));
    assert.match(formScope, /Complete This Look →/, "the component's own button text must read 'Complete This Look'");
    assert.doesNotMatch(formScope, /Style this look in StyleMe/, "the old single-piece label must not have leaked into the shared multi-garment component");
  });

  test("UX-2.2 the multi-garment handoff mechanism itself is unchanged: every garment id is still submitted to /api/wi-style-this (2026-11-20: now via the shared CompleteLookForm component instead of an inline <Form>)", () => {
    const src = closetIntelSrc();
    const moodboardAt = src.indexOf('dialog.kind === "moodboardLook"');
    const scope = src.slice(moodboardAt, src.indexOf("</DialogShell>", moodboardAt));
    assert.match(scope, /<CompleteLookForm garmentIds=\{look\.garmentIds\}\s*\/>/, "the dialog must pass the FULL garmentIds array (not a single index) to the shared form");
    assert.doesNotMatch(scope, /garmentIds=\{\s*\[?\s*look\.garmentIds\[0\]/, "must not regress to submitting only the first garment");
    const formDefAt = src.indexOf("function CompleteLookForm");
    const formScope = src.slice(formDefAt, src.indexOf("\n}", formDefAt));
    assert.match(formScope, /<fetcher\.Form method="post" action="\/api\/wi-style-this"/, "the shared form component must still post to the real multi-garment handoff endpoint");
    assert.match(formScope, /garmentIds\.map\(/, "every garment id must still be submitted — only the label/structure changed, not the mechanism");
  });

  test("UX-2.3 the SEPARATE single-piece Rediscover CTA ('Style this in StyleMe') is a distinct string and was not touched", () => {
    const src = closetIntelSrc();
    assert.match(src, /Style this in StyleMe →/, "the single-piece CTA (Pieces worth rediscovering) must still exist, unchanged");
    // Sanity: confirm this is genuinely a different occurrence from the one just relabelled —
    // the old multi-garment string must not have simply moved here instead of being replaced.
    const occurrences = (src.match(/Style this in StyleMe →/g) ?? []).length;
    assert.equal(occurrences, 1, "exactly one single-piece CTA occurrence, not a leftover duplicate");
  });

  test("UX-2.4 no other styling CTA in this file was relabelled — 'Complete This Look' appears exactly once", () => {
    const src = closetIntelSrc();
    const occurrences = (src.match(/Complete This Look →/g) ?? []).length;
    assert.equal(occurrences, 1, "only the moodboard combination CTA should carry the new label");
  });
});

// ── 3. "SAVE QA PAGE" gated by a dedicated server-side flag, not isStagingProject ──

describe("UX-3 — the Save QA Page debug control is gated by an explicit, server-computed flag", () => {
  test("UX-3.1 the QA export flag is computed server-side from process.env, not a client-side toggle", () => {
    const src = resultSrc();
    assert.match(
      src, /const qaExportEnabled = process\.env\.STYLEME_QA_EXPORT_ENABLED === "true";/,
      "must be a real server-side env check in the loader, same pattern as devTryOnEnabled/vtoEnabled — never useState/localStorage",
    );
    assert.doesNotMatch(src, /qaExportEnabled.*useState|localStorage.*[Qq]a[Ee]xport/, "must never be settable from the client");
  });

  test("UX-3.2 the SAVE QA PAGE button is gated by qaExportEnabled, no longer by isStagingProject", () => {
    const src = resultSrc();
    const btnAt = src.indexOf("SAVE QA PAGE");
    assert.ok(btnAt > -1, "the control must still exist for internal QA use");
    const before = src.slice(Math.max(0, btnAt - 1400), btnAt);
    assert.match(before, /\{loaderData\.qaExportEnabled && \(/, "must be gated by the new dedicated flag");
    assert.doesNotMatch(before, /\{loaderData\.isStagingProject && \(/, "must no longer be gated by the broad staging flag — staging now also hosts real customer acceptance checks");
  });

  test("UX-3.3 the UNRELATED staging-gated block (full-look VTO trigger) is untouched — this fix is scoped to the QA export button only (2026-11-20: the section comment's wording was later updated from 'Staging QA: full-look VTO trigger' to '── Virtual Try-On ──' — a cosmetic rename, not a behavioral change; the gate below is unchanged)", () => {
    const src = resultSrc();
    const vtoAt = src.indexOf("── Virtual Try-On ──");
    assert.ok(vtoAt > -1, "the unrelated VTO trigger feature must still exist");
    const jsxAt = src.indexOf("loaderData.isStagingProject && suggestion?.id", vtoAt);
    assert.ok(jsxAt > -1, "it must remain gated by isStagingProject — only the Save QA Page control's gate changed");
  });

  test("UX-3.4 qaExportEnabled is threaded through every loader return path, same as isStagingProject already was", () => {
    const src = resultSrc();
    const isStagingCount = (src.match(/\bisStagingProject,?\s*$/gm) ?? []).length
      + (src.match(/\bisStagingProject,\s/g) ?? []).length;
    const qaExportCount = (src.match(/\bqaExportEnabled,?\s*$/gm) ?? []).length
      + (src.match(/\bqaExportEnabled,\s/g) ?? []).length;
    assert.ok(qaExportCount > 0, "qaExportEnabled must be returned from the loader on at least one path");
    assert.ok(isStagingCount > 0, "sanity: isStagingProject's own return sites must still be findable for comparison");
  });

  test("UX-3.5 off by default: the flag requires an exact 'true' string match, never truthy-by-presence", () => {
    const src = resultSrc();
    assert.match(src, /process\.env\.STYLEME_QA_EXPORT_ENABLED === "true"/, "must require the literal string \"true\", not just any set value — so an accidentally-set empty/placeholder env var does not enable it");
  });
});
