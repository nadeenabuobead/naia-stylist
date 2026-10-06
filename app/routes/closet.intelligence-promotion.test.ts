// app/routes/closet.intelligence-promotion.test.ts
//
// The live Wardrobe Intelligence page was still the older collage layout while the approved
// editorial design sat unlinked at /closet/intelligence-preview.
//
// Nothing was lost: the editorial design has been on this branch since 601ae68 brought it in
// as "Presentation preview only — not linked from navigation, makes no writes", newest at
// 194aa01 (2026-10-02). So this is a PROMOTION, not a recovery — the preview supplies
// presentation, the live route stays the source of truth for behaviour.
//
// Two implementations of one page is how it drifted in the first place, so the preview route
// is retired in the same change. These tests pin both halves: the editorial structure must be
// what renders, AND every live behaviour must survive it — most importantly the WI -> StyleMe
// handoff, which existed in the preview as decorative TEXT with no form, no action and no
// closetItemId. Promoting presentation without re-attaching that contract would have silently
// turned a working button into a label.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const p = (rel: string) => join(process.cwd(), rel);
const read = (rel: string) => readFileSync(p(rel), "utf8");

const LIVE = "app/routes/closet.intelligence.tsx";
const PREVIEW = "app/routes/closet.intelligence-preview.tsx";
const ROUTES = "app/routes.ts";
const PAGE_LIB = "app/lib/ai/wardrobe-page.ts";

// ── CIP-A: the editorial design is what renders ───────────────────────────

describe("CIP-A — the live route carries the approved editorial presentation", () => {
  test("CIP-A.1 every approved section heading is present", () => {
    const src = read(LIVE);
    for (const heading of [
      "Your Closet, styled",
      "Pieces worth rediscovering",
      "How your wardrobe supports your life",
      "Where your wardrobe repeats",
      "Shop smarter",
    ]) {
      assert.ok(src.includes(heading), `missing approved heading: ${heading}`);
    }
  });

  test("CIP-A.2 the hero keeps the approved capitalisation", () => {
    // "Your wardrobe, understood." — lowercase w, as the approved preview has it.
    assert.match(read(LIVE), /Your wardrobe,\s*<(?:span|em)[^>]*>understood\./,
      "lowercase w, exactly as the approved preview has it (it uses <em>)");
  });

  test("CIP-A.3 the collage structure is gone from the live page", () => {
    const src = read(LIVE);
    for (const marker of ["wi-chapter", "wi-opening", "wi-dna-grid", "wi-knows-list"]) {
      assert.equal(
        (src.match(new RegExp(marker, "g")) ?? []).length, 0,
        `${marker} belongs to the retired collage layout`,
      );
    }
  });

  test("CIP-A.4 the editorial namespace is what styles the page", () => {
    const src = read(LIVE);
    const wip = (src.match(/wip-/g) ?? []).length;
    assert.ok(wip > 100, `expected the editorial wip-* system; found ${wip} references`);
  });
});

// ── CIP-B: every live behaviour survived ──────────────────────────────────

describe("CIP-B — behaviour is preserved, not re-implemented", () => {
  test("CIP-B.1 the confidence action still writes", () => {
    const src = read(LIVE);
    assert.match(src, /export async function action\(/);
    assert.match(src, /recordClosetConfidence\(/);
    assert.match(src, /closetCompleteness/, "the answer field the action reads");
  });

  test("CIP-B.2 readAndRecordChange still runs, and its result reaches the page model", () => {
    const src = read(LIVE);
    assert.match(src, /readAndRecordChange\(/, "snapshot/change tracking must not be dropped");
    const build = src.slice(src.indexOf("buildWardrobePage({"));
    const call = build.slice(0, build.indexOf("});"));
    assert.match(call, /change,/, "the real change must be passed");
    assert.doesNotMatch(call, /change: null/,
      "change: null was the preview's no-write stance — the live page records change");
  });

  test("CIP-B.3 the basis status line survives", () => {
    const src = read(LIVE);
    assert.match(src, /wi-basis-status/);
    assert.match(src, /Based on \{?model\.closetCount/);
  });

  test("CIP-B.4 the completeness question is still askable and answerable", () => {
    const src = read(LIVE);
    assert.match(src, /wi-completeness/);
    assert.match(src, /readClosetConfidence\(/);
  });

  test("CIP-B.5 auth/customer loader behaviour is unchanged", () => {
    const src = read(LIVE);
    assert.match(src, /requireCurrentNaiaCustomer\(/);
    assert.match(src, /redirect\("\/auth\/shopify\/login"\)/);
    assert.match(src, /onboardingProfile: \{ select: PASSPORT_SELECT \}/,
      "the explicit select guards against a column a migration has not added yet");
  });

  test("CIP-B.6 the loader exposes every field the editorial presentation needs", () => {
    const src = read(LIVE);
    const ret = src.slice(src.indexOf("return data({", src.indexOf("export async function loader")));
    const block = ret.slice(0, ret.indexOf("});"));
    for (const field of [
      "glanceRegisters", "allRegisterReadings", "neutralSharePct",
      "enoughCluster", "enoughClusters", "rediscoverPieces",
      "bestByRegisterPreview", "moodboardLooks", "recommendationDetail",
    ]) {
      assert.ok(block.includes(field), `loader must return ${field}`);
    }
  });

  test("CIP-B.7 the dead footer key is gone", () => {
    // Proven zero consumers before removal: only its own construction site referenced it.
    const src = read(LIVE);
    assert.doesNotMatch(src, /signalAvailability:/);
    assert.doesNotMatch(src, /wearNote:/);
  });
});

// ── CIP-C: the WI -> StyleMe handoff is still real ────────────────────────

describe("CIP-C — the handoff is a working form, not a label", () => {
  test("CIP-C.1 it posts to /api/wi-style-this", () => {
    assert.match(read(LIVE), /<Form method="post" action="\/api\/wi-style-this">/);
  });

  test("CIP-C.2 the exact closetItemId contract is intact", () => {
    assert.match(read(LIVE), /<input type="hidden" name="closetItemId" value=\{/,
      "the d3ffe34 contract: the owned garment id, by that exact field name");
  });

  test("CIP-C.3 the label is unchanged", () => {
    assert.match(read(LIVE), /Style this in StyleMe →/);
  });

  test("CIP-C.4 it submits — the preview's version had no form at all", () => {
    const src = read(LIVE);
    const form = src.slice(src.indexOf('action="/api/wi-style-this"'));
    const scope = form.slice(0, form.indexOf("</Form>"));
    assert.match(scope, /type="submit"/, "decorative text would be a regression, not a port");
    assert.match(scope, /name="closetItemId"/);
  });

  test("CIP-C.5 the route it posts to is still registered", () => {
    assert.match(read(ROUTES), /route\("api\/wi-style-this"/);
  });
});

// ── CIP-D: locked copy is not collateral damage ───────────────────────────

describe("CIP-D — wardrobe-page.ts locked copy is untouched", () => {
  test("CIP-D.1 the locked section copy still reads exactly as before", () => {
    const src = read(PAGE_LIB);
    assert.match(src, /wear: "Wear what you already own",/,
      "this is locked copy in the page model, not page structure — promoting the layout " +
      "must not edit it");
  });

  test("CIP-D.2 the page-model builder is still the single source of the model", () => {
    assert.match(read(LIVE), /buildWardrobePage\(\{/);
    assert.ok(existsSync(p(PAGE_LIB)));
  });
});

// ── CIP-E: the duplicate is retired ───────────────────────────────────────

describe("CIP-E — one implementation, so it cannot drift again", () => {
  test("CIP-E.1 the preview route file is gone", () => {
    assert.equal(existsSync(p(PREVIEW)), false,
      "two implementations of one page is how the live route fell behind");
  });

  test("CIP-E.2 the preview route is no longer registered", () => {
    const src = read(ROUTES);
    assert.doesNotMatch(src, /closet\/intelligence-preview/);
    assert.doesNotMatch(src, /closet\.intelligence-preview/);
  });

  test("CIP-E.3 the real route is still registered", () => {
    assert.match(read(ROUTES), /route\("closet\/intelligence", "routes\/closet\.intelligence\.tsx"\)/);
  });

  test("CIP-E.4 shared helpers survive the retirement", () => {
    // The preview route goes; the libraries it shared with the live route stay.
    for (const lib of [
      "app/lib/ai/wardrobe-page.ts",
      "app/lib/ai/wardrobe-copy.ts",
      "app/lib/ai/wardrobe-needs.ts",
      "app/lib/ai/wardrobe-intelligence.ts",
      "app/lib/ai/wardrobe-snapshot.server.ts",
      "app/lib/ai/wardrobe-confidence.server.ts",
    ]) {
      assert.ok(existsSync(p(lib)), `${lib} must not be removed with the preview route`);
    }
  });
});

// ── CIP-F: no preview-only affordance survived ────────────────────────────

describe("CIP-F — nothing fake came across with the presentation", () => {
  test("CIP-F.1 the preview's session-local status control is gone", () => {
    // The preview carried its own confidence control whose own copy said
    // "Preview interaction only. This choice is local to this session and does not
    // recalculate the findings shown here." On the live route that would sit beside the
    // real one and silently discard her answer.
    const src = read(LIVE);
    assert.doesNotMatch(src, /Preview interaction only/);
    assert.doesNotMatch(src, /previewStatus/);
    assert.doesNotMatch(src, /kind: "status"/);
  });

  test("CIP-F.2 exactly one confidence control remains, and it writes", () => {
    const src = read(LIVE);
    assert.equal((src.match(/wi-basis-status/g) ?? []).length >= 1, true);
    assert.match(src, /name="closetCompleteness"/, "the real control posts to the action");
  });
});
