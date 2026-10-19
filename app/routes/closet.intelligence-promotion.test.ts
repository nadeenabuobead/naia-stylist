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

// ── CIP-G: the moodboard "Style this look" handoff is a working form too ──
//
// This dialog's CTA was still the decorative <a href="/style-me"> the rest of
// CIP-C exists to retire — missed because it is a combination (multiple
// garment ids), not a single piece, so the earlier promotion only re-attached
// the single-piece button.

describe("CIP-G — the moodboard combination handoff is a working form, not a label", () => {
  test("CIP-G.1 the dead <a href=\"/style-me\"> is gone", () => {
    assert.doesNotMatch(read(LIVE), /<a className="wip-link" href="\/style-me">/);
  });

  test("CIP-G.2 it posts to /api/wi-style-this with a real closetItemId from the look", () => {
    const src = read(LIVE);
    const idx = src.indexOf("A real combination from what you already own.");
    assert.notEqual(idx, -1, "expected the moodboard dialog to still exist");
    const scope = src.slice(idx, src.indexOf("</DialogShell>", idx));
    assert.match(scope, /<Form method="post" action="\/api\/wi-style-this">/);
    assert.match(scope, /<input type="hidden" name="closetItemId" value=\{look\.garmentIds\[0\]\}/);
    assert.match(scope, /type="submit"/, "decorative text would be a regression, not a fix");
  });

  test("CIP-G.3 the label says 'look', not the single-piece label verbatim", () => {
    assert.match(read(LIVE), /Style this look in StyleMe →/);
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

// ── CIP-H: the whole page must not hide behind one narrow sub-feature ────
//
// The top-level empty-state gate used to be `rediscoverPieces.length === 0`
// — meaning a Closet with real coverage/colour/pairing/reconsider findings
// but no self-reported "rarely-wear"/"struggle" tag and no StyleMe history
// yet (so zero rediscover candidates) showed NOTHING: not one of the nine
// modules, just "Nothing to preview yet". Found via a real test customer
// with a full, analysed Closet and a complete Passport during QA.

describe("CIP-H — the page gates on real readiness, not on one narrow sub-feature", () => {
  test("CIP-H.1 the top-level empty-state check is the page's real readiness flag", () => {
    const src = read(LIVE);
    assert.match(src, /if \(!model\.ready\) \{/, "must gate on model.ready, not a single sub-feature's emptiness");
    assert.doesNotMatch(src, /if \(rediscoverPieces\.length === 0\) \{/, "the old, too-narrow gate must be gone");
  });

  test("CIP-H.2 the not-ready message uses the engine's own readyNote, not a rediscover-specific sentence", () => {
    const src = read(LIVE);
    const gateIdx = src.indexOf("if (!model.ready) {");
    assert.notEqual(gateIdx, -1);
    const scope = src.slice(gateIdx, src.indexOf("return (", gateIdx) + 500);
    assert.match(scope, /model\.readyNote/);
    assert.doesNotMatch(scope, /piece worth/i, "the old rediscover-specific copy must not survive as the general not-ready message");
  });

  test("CIP-H.3 'Pieces worth rediscovering' only renders when there's a real candidate", () => {
    const src = read(LIVE);
    const headingIdx = src.indexOf("Pieces worth rediscovering.");
    assert.notEqual(headingIdx, -1);
    const before = src.slice(Math.max(0, headingIdx - 400), headingIdx);
    assert.match(before, /\{rediscoverPieces\.length > 0 && \(/, "the section itself must be conditional now that the page no longer bails out earlier");
  });
});

// ── CIP-I: "Strongest" is never claimed for a register that's itself thin ────
//
// Found during Persona A QA: a customer whose every needed register was
// under-supported still saw "STRONGEST: Work wardrobe — Fewer combinations"
// — self-contradictory on its face. "Strongest" must only fire when the
// best-of-her-needed-registers is itself in a genuinely good state.

describe("CIP-I — the glance headline never calls a thin register 'Strongest'", () => {
  test("CIP-I.1 isGenuinelyStrong gates the kicker label, not a hardcoded 'Strongest'", () => {
    const src = read(LIVE);
    assert.match(src, /isGenuinelyStrong \? "Strongest" : "Most supported"/);
  });

  test("CIP-I.2 isGenuinelyStrong is computed from the register's own depth rank, not assumed true", () => {
    const src = read(LIVE);
    assert.match(src, /const isGenuinelyStrong = DEPTH_RANK\[best\.state\] <= 1;/);
  });

  test("CIP-I.3 the 'what nAia has learned' support sentence carries the same honesty", () => {
    const src = read(LIVE);
    assert.match(src, /glanceRegisters\[0\]\.isGenuinelyStrong \? "its strongest support" : "relatively more support"/);
  });
});

// ── CIP-J: no fixed-height card layout, anywhere in the life/shop grid ───────
//
// Superseded finding: the previous round's fix for a lone Shop-Smarter card
// (a 436px fixed height + a "solo" override to escape it) treated the
// SYMPTOM. QA's real complaint was the fixed height itself, shared across
// two sections that were never guaranteed to have comparable content —
// "How your wardrobe fits your life" and "Shop smarter" are now one
// coordinated grid with NO fixed or forced-equal height at all; each side
// sizes to its own real content, so there is no empty-gap case left to
// patch around.

describe("CIP-J — the life/shop grid has no fixed-height card to create blank space", () => {
  test("CIP-J.1 the old fixed-height rule is gone", () => {
    const src = read(LIVE);
    assert.doesNotMatch(src, /\.wip-paired-card\{height:436px\}/);
    assert.doesNotMatch(src, /\.wip-shop-col--solo\{height:auto\}/);
  });

  test("CIP-J.2 the new grid declares no height on its columns at all", () => {
    const src = read(LIVE);
    const gridIdx = src.indexOf(".wip-life-shop-grid{");
    assert.notEqual(gridIdx, -1, "the new combined grid must exist");
    const block = src.slice(gridIdx, src.indexOf("\n\n", gridIdx));
    assert.doesNotMatch(block, /height:/, "no fixed or forced height anywhere in the new grid's own rules");
  });

  test("CIP-J.3 'How your wardrobe fits your life' and 'Shop smarter' share one bordered row, not two separately-stacked sections", () => {
    const src = read(LIVE);
    const lifeIdx = src.indexOf("How your wardrobe fits your life.");
    const shopIdx = src.indexOf('<h2 className="wip-section-title">Shop smarter.</h2>');
    assert.notEqual(lifeIdx, -1);
    assert.notEqual(shopIdx, -1);
    const between = src.slice(lifeIdx, shopIdx);
    assert.doesNotMatch(between, /<\/section>/, "both headings must sit inside the same <section>, not two separate ones");
  });
});

// ── CIP-K: Worth Reconsidering uses the same nuance as the Coverage dialog ───
//
// Found during Persona A QA: the Burgundy Midi Dress read "Sits outside a
// preference you stated — keeping your legs covered" in Worth Reconsidering,
// while the Style Passport coverage dialog — same piece, same signal —
// already said "This midi length sits outside that preference, but how you
// style it may change whether it works for you." One surface was blunter
// than the other for the identical underlying fact.

describe("CIP-K — Worth Reconsidering reuses coverageReasonSentence instead of a second, blunter copy of the nuance", () => {
  test("CIP-K.1 reconsider reasons are routed through softenReconsiderReason before rendering", () => {
    const src = read(LIVE);
    assert.match(src, /entry\.reasons\.map\(\(reason\) => <p key=\{reason\}>\{softenReconsiderReason\(reason, card\)\}<\/p>\)/);
  });

  test("CIP-K.2 softenReconsiderReason calls the same coverageReasonSentence the Coverage dialog uses", () => {
    const src = read(LIVE);
    const fnIdx = src.indexOf("function softenReconsiderReason(");
    assert.notEqual(fnIdx, -1);
    const fnBody = src.slice(fnIdx, fnIdx + 500);
    assert.match(fnBody, /coverageReasonSentence\(match\[1\], card\?\.hemLength/);
  });

  test("CIP-K.3 only the dressing-preference reason template is touched — near-duplicate/repetition reasons pass through", () => {
    const src = read(LIVE);
    const fnIdx = src.indexOf("function softenReconsiderReason(");
    const fnBody = src.slice(fnIdx, fnIdx + 500);
    assert.match(fnBody, /if \(!match\) return reason;/, "an unmatched (non-preference) reason must be returned unchanged");
  });
});

// ── CIP-L: every combination dialog discloses it's a starting point ──────────
//
// Found during Persona A QA: the "pair" and "workCombo" dialogs already said
// "Add shoes and finishing pieces to complete the look" — moodboardLook (the
// "Your Closet, styled" dialog) was the one combination surface that didn't,
// even though it's built the same way (a core top/bottom pairing, never
// shoes).

describe("CIP-L — the moodboard look dialog discloses it's a starting point too", () => {
  test("CIP-L.1 the moodboardLook dialog includes the same finishing-pieces note as the other combination dialogs", () => {
    const src = read(LIVE);
    const kindIdx = src.indexOf('dialog.kind === "moodboardLook"');
    assert.notEqual(kindIdx, -1);
    const closeIdx = src.indexOf("</DialogShell>", kindIdx);
    const scope = src.slice(kindIdx, closeIdx);
    assert.match(scope, /Add shoes and finishing pieces to complete the look\./);
  });
});

// ── CIP-M: shopping-gap conclusions are qualified until completeness is confirmed ──
//
// Found during Persona A QA: "Shop smarter" stated an unqualified gap
// ("there's very little in your Closet that combines into something you
// could wear for it") even for a customer who had never answered "is this
// most of the wardrobe you currently wear?" — the SAME hedge wardrobe-page.ts
// already applies to other shop-smarter text was missing from this one.

describe("CIP-M — Shop Smarter's 'why' text is hedged by closet completeness, same as the rest of the page", () => {
  test("CIP-M.1 a hedge note renders whenever confidence isn't 'mostly'", () => {
    const src = read(LIVE);
    assert.match(src, /model\.confidence !== "mostly" && \(/);
    assert.match(src, /wip-shop-hedge/);
  });

  test("CIP-M.2 the hedge text is reused from wardrobe-page.ts's hedge(), not a second hardcoded copy", () => {
    // Was two independent copies of the same two sentences (one here, one in
    // wardrobe-page.ts) — exactly the drift risk this codebase keeps running
    // into. Now sourced once: the route calls hedge(), and the actual
    // sentences are asserted against wardrobe-page.ts, where they live.
    const src = read(LIVE);
    assert.match(src, /\{hedge\(undefined, model\.confidence\)\}/);
    assert.match(src, /import \{ buildWardrobePage, hedge, /);

    const pageSrc = read("app/lib/ai/wardrobe-page.ts");
    assert.match(pageSrc, /You've told nAia you're still adding pieces, so treat this as a first read rather than a final answer\./);
    assert.match(pageSrc, /This is based on what's in your Closet so far — if you own more than you've added, it could change\./);
  });
});

// ── CIP-N: fewer cards than grid columns must not centre, leaving dead space ──
//
// Found during Persona A QA: Worth Reconsidering's single card sat centred
// in a 3-column grid, with large empty margins on both sides instead of
// starting under the section's own left-aligned heading/description.

describe("CIP-N — wip-piece-grid left-aligns instead of centring a short row", () => {
  test("CIP-N.1 justify-content is start, not center", () => {
    const src = read(LIVE);
    const gridIdx = src.indexOf(".wip-piece-grid{");
    assert.notEqual(gridIdx, -1);
    const rule = src.slice(gridIdx, src.indexOf("}", gridIdx));
    assert.match(rule, /justify-content:start/);
    assert.doesNotMatch(rule, /justify-content:center/);
  });

  test("CIP-N.2 a single card never stretches full-width — the grid still caps each card's own column width", () => {
    const src = read(LIVE);
    const gridIdx = src.indexOf(".wip-piece-grid{");
    const rule = src.slice(gridIdx, src.indexOf("}", gridIdx));
    assert.match(rule, /minmax\(0,180px\)/, "columns stay capped, so a lone card keeps its real card width, not 100%");
  });
});

// ── CIP-O: "View this combination" never appears for a register with nothing to show ──
//
// Found live during Persona A QA: Dinners & Events reported "0 usable
// pieces" and still showed "View this combination →"; opening it read
// "An existing WORK combination" (hardcoded title) over a body admitting
// "nAia hasn't selected an occasion example to show here yet." The engine
// always returns an entry for a thin needed register — explicitly naming
// the absence rather than omitting it — so `attentionCombo` being truthy
// was never proof a real combination existed.

describe("CIP-O — the combination link and its dialog never claim more than the evidence supports", () => {
  test("CIP-O.1 the button checks attentionCombo.garmentIds.length, not just truthiness", () => {
    const src = read(LIVE);
    assert.match(src, /attentionRegister && attentionCombo && attentionCombo\.garmentIds\.length > 0 &&/);
  });

  test("CIP-O.2 the dialog title reads from the entry itself, never a hardcoded register name", () => {
    const src = read(LIVE);
    assert.doesNotMatch(src, /title="An existing work combination\."/);
    assert.match(src, /title=\{attentionCombo\.title/);
  });
});

// ── CIP-P: "Why nAia recommends this" reads correctly for every DepthState ────
//
// Found live: "Your dinners & events wardrobe has smaller than it looks."
// — "has fewer combinations" reads fine, but "has smaller than it looks"
// does not. The template assumed every DEPTH_STATE_TEXT value works after
// "has", which is only true for some of them — this is the engine's own
// closed six-value vocabulary, not a per-register or per-persona fix.

describe("CIP-P — the recommendation-reason sentence reads correctly for every register state", () => {
  test("CIP-P.1 a predicate is looked up per DepthState, not a blind 'has {stateText}'", () => {
    const src = read(LIVE);
    assert.match(src, /REGISTER_STATE_PREDICATE\[registerReading\.state\]/);
  });

  test("CIP-P.2 the predicate map covers all six DepthState values with grammatically real predicates", () => {
    const src = read(LIVE);
    const idx = src.indexOf("const REGISTER_STATE_PREDICATE");
    assert.notEqual(idx, -1);
    const block = src.slice(idx, src.indexOf("};", idx));
    for (const state of ["strong", "limited-variety", "needs-range", "less-than-it-looks", "empty", "learning"]) {
      assert.match(block, new RegExp(`"?${state}"?:\\s*"(is|has) `), `${state} must map to a real "is"/"has" predicate`);
    }
    // The specific bug found live, pinned directly.
    assert.match(block, /"less-than-it-looks":\s*"is smaller than it looks"/);
  });
});
