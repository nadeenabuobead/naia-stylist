// app/routes/closet.intelligence.persona-f-render.test.tsx
// Run: npx vitest run app/routes/closet.intelligence.persona-f-render.test.tsx
//
// Renders the REAL closet.intelligence.tsx default-export component through the REAL
// engine output for Persona F — not a source-text assertion, and not a hand-typed mock of
// what the page block "should" look like. The loaderData fed to useLoaderData() here is
// built by calling the same real functions the real loader calls (computeWardrobeIntelligence,
// computeWardrobeNeeds, computeWardrobeRecommendations, buildWardrobePage) over Persona F's
// fixture, then deriving garmentCards/enoughCluster/enoughClusters/rediscoverPieces with the
// identical inline logic the loader itself uses (copied verbatim from closet.intelligence.tsx's
// loader — see the comment at each derivation below). Only the Remix/React Router plumbing
// (useLoaderData, Form, Link, useNavigation, useSearchParams) and server-only imports
// (prisma, auth, cloudinary, the wardrobe-intelligence SERVER wrapper) are mocked — the
// closet.intelligence.tsx is never touched by Prisma or a database.
//
// Same convention as app/routes/style-me/source.anchor-rejection-render.test.tsx: Vitest,
// `environment: "node"` (no jsdom/RTL in this repo), renderToString, vi.mock("react-router").
// This is the first genuine render test for any Wardrobe Intelligence module — the only
// existing WI test for this route (closet.intelligence-promotion.test.ts) is a source-text
// regex test, which cannot catch a runtime render defect the way this can.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";

import {
  computeWardrobeIntelligence,
  type WardrobeGarment,
  type WardrobePassport,
} from "~/lib/ai/wardrobe-intelligence";
import { computeWardrobeNeeds } from "~/lib/ai/wardrobe-needs";
import { computeWardrobeRecommendations } from "~/lib/ai/wardrobe-recommendations";
import { buildWardrobePage, type WardrobePage } from "~/lib/ai/wardrobe-page";

// ── react-router + server-only mocks (module evaluation requires these to resolve) ──

const state = vi.hoisted(() => ({ loader: null as unknown }));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    Link: ({ to, children, className }: any) => createElement("a", { href: to, className }, children),
    Form: ({ children, method, action }: any) => createElement("form", { method, action }, children),
    useLoaderData: () => state.loader,
    useNavigation: () => ({ state: "idle", formData: undefined }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useLocation: () => ({ pathname: "/closet/intelligence", search: "", hash: "", state: null, key: "default" }),
    UNSAFE_withComponentProps: (C: any) => C,
  };
});

vi.mock("../db.server", () => ({ default: {} }));
vi.mock("~/lib/naia-session.server", () => ({ requireCurrentNaiaCustomer: vi.fn() }));
vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn(() => null),
  buildPrivateDownloadUrl: vi.fn(),
}));
vi.mock("~/lib/ai/wardrobe-intelligence.server", () => ({ loadWardrobeIntelligence: vi.fn() }));
vi.mock("~/lib/ai/wardrobe-snapshot.server", () => ({ readAndRecordChange: vi.fn() }));
vi.mock("~/lib/ai/wardrobe-confidence.server", () => ({
  readClosetConfidence: vi.fn(),
  recordClosetConfidence: vi.fn(),
}));

import WardrobeIntelligencePage from "./closet.intelligence";

// ── Persona F fixture — same wardrobe as wardrobe-persona-f.test.ts, duplicated here per
//    this codebase's convention (each test file owns its own fixtures) ───────────────────

let seq = 0;
function makeGarment(overrides: Partial<WardrobeGarment> = {}): WardrobeGarment {
  seq += 1;
  const base: WardrobeGarment = {
    id: `pfr-g${seq}`, name: `Piece ${seq}`, category: "TOPS", subcategory: null, imageUrl: null,
    slot: "top", primaryColor: "Black", colors: [], pattern: "solid", material: "cotton",
    silhouette: "straight", fitProfile: "tailored", formality: "smart-casual", stylePersonality: null,
    occasions: [], seasons: [], analysisStatus: "ready", visualWeight: "medium",
    colourProfile: { hueFamily: null, wardrobeNeutral: true, lightDark: "dark", energyTier: "neutral-versatile" },
    garmentRelationships: [], intentions: null, intentionsSource: null, intelligenceSource: "derived",
    sleeveLength: "full", necklineCoverage: "crew", hemLength: "n/a", topLength: "hip-length",
    midriffExposed: false, shoulderCoverage: true,
    outfitAppearances: 0, savedLookAppearances: 0, observedWear: null,
  } as WardrobeGarment;
  return { ...base, ...overrides };
}

function neutralWardrobe(): WardrobeGarment[] {
  return [
    makeGarment({ id: "pfr-top-black", name: "Black Tailored Shirt", slot: "top", primaryColor: "Black" }),
    makeGarment({ id: "pfr-top-cream", name: "Cream Shirt", slot: "top", primaryColor: "Cream" }),
    makeGarment({ id: "pfr-bottom-black", name: "Black Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Black" }),
    makeGarment({ id: "pfr-bottom-brown", name: "Brown Trousers", category: "BOTTOMS", slot: "bottom", primaryColor: "Brown" }),
    makeGarment({ id: "pfr-outer-black", name: "Black Blazer", category: "OUTERWEAR", slot: "outerwear", primaryColor: "Black" }),
    makeGarment({ id: "pfr-dress-black", name: "Black Dress", category: "DRESSES", slot: "dress", primaryColor: "Black" }),
  ];
}

const TOP_SHAPES = [
  { silhouette: "fitted",    fitProfile: "tailored", primaryColor: "Black" },
  { silhouette: "oversized", fitProfile: "loose",    primaryColor: "Navy"  },
  { silhouette: "boxy",      fitProfile: "relaxed",  primaryColor: "Cream" },
  { silhouette: "wrap",      fitProfile: "fitted",   primaryColor: "Green" },
  { silhouette: "column",    fitProfile: "slim",     primaryColor: "Grey"  },
];
const BOTTOM_SHAPES = [
  { silhouette: "straight", fitProfile: "tailored",  primaryColor: "Charcoal" },
  { silhouette: "flared",   fitProfile: "flowy",     primaryColor: "Beige"    },
  { silhouette: "tapered",  fitProfile: "slim",      primaryColor: "Navy"     },
  { silhouette: "a-line",   fitProfile: "relaxed",   primaryColor: "Brown"    },
  { silhouette: "balloon",  fitProfile: "oversized", primaryColor: "Black"    },
];
function variedLooks(formality: string, n: number): WardrobeGarment[] {
  const out: WardrobeGarment[] = [];
  const neutral = { hueFamily: null, wardrobeNeutral: true, lightDark: "dark" as const, energyTier: "neutral-versatile" as const };
  for (let i = 0; i < n; i++) {
    const t = TOP_SHAPES[i % TOP_SHAPES.length];
    const b = BOTTOM_SHAPES[i % BOTTOM_SHAPES.length];
    out.push(makeGarment({ slot: "top", category: "TOPS", formality, topLength: "hip-length", hemLength: "n/a", occasions: ["Weekend"], colourProfile: neutral, ...t }));
    out.push(makeGarment({ slot: "bottom", category: "BOTTOMS", formality, topLength: "n/a", hemLength: "full", occasions: ["Weekend"], colourProfile: neutral, ...b }));
  }
  return out;
}

function personaFWardrobe(): WardrobeGarment[] {
  const items = [...neutralWardrobe(), ...variedLooks("casual", 5)];
  items.find((g) => g.id === "pfr-bottom-black")!.garmentRelationships = ["rarely-wear"];
  const probe = makeGarment({
    id: "pfr-probe-sleeveless-top", name: "Sleeveless Linen Top", slot: "top", category: "TOPS",
    primaryColor: "White", formality: "casual", sleeveLength: "sleeveless",
    garmentRelationships: ["rarely-wear"],
  });
  return [...items, probe];
}

const PERSONA_F_PASSPORT: WardrobePassport = {
  lifestyle: ["everyday-casual", "office"], favoriteColors: [], avoidColors: [], stylePersonalities: [],
  silhouette: [], structure: null, fitPreferences: [], styleStruggles: [], styleSupport: [], becoming: [],
} as unknown as WardrobePassport;

/**
 * Builds the exact loaderData shape closet.intelligence.tsx's own loader returns, running
 * the real engine over Persona F's fixture. The derivation of garmentCards/enoughCluster/
 * enoughClusters/rediscoverPieces below is copied verbatim from the real loader (lines
 * ~168-290 of closet.intelligence.tsx at the time this test was written) — if that
 * derivation ever changes, this must change with it, which is the point: a drift between
 * the two would otherwise go unnoticed by a test that renders a hand-typed shape instead.
 */
function buildPersonaFLoaderData(items: WardrobeGarment[], passport: WardrobePassport) {
  const intelligence = computeWardrobeIntelligence({ items, passport, seenCombinations: new Set<string>() });
  const needs = computeWardrobeNeeds({ items, passport, styleMeSessions: null, outcomes: null, styleMeDemandFacts: null });
  const recommendations = computeWardrobeRecommendations({ needs, items, passport });
  const page: WardrobePage = buildWardrobePage({
    intelligence, needs, recommendations, closetCount: items.length,
    garmentName: (id) => items.find((g) => g.id === id)?.name ?? null,
    lifestyle: passport.lifestyle ?? [],
    hasStatedColourPreference: (passport.favoriteColors?.length ?? 0) > 0,
    contradictedColours: [],
  });

  const garmentCards = items.map((g) => ({
    id: g.id, name: g.name, category: g.category, subcategory: g.subcategory,
    primaryColor: g.primaryColor, imageUrl: g.imageUrl, hemLength: g.hemLength ?? null,
  }));

  const enoughClusters = needs.enough.map((e) => ({ title: e.title, body: e.body, garmentIds: e.garmentIds, count: e.garmentIds.length }));
  const enoughCluster = enoughClusters[0] ?? null;

  const worthTryingEntries = page.sections.find((s) => s.id === "wear")?.blocks.find((b) => b.id === "worth-trying")?.entries ?? [];
  const rediscoverPieces: Array<{ garmentId: string; matchIds: string[]; insight: string }> = [];
  for (const entry of worthTryingEntries) {
    const members = entry.meta?.members as Array<{ garmentId: string; title: string }> | undefined;
    if (members && members.length > 0) {
      const insight = `Marked difficult to style — ${entry.garmentIds.length} compatible pieces.`;
      for (const m of members) rediscoverPieces.push({ garmentId: m.garmentId, matchIds: entry.garmentIds, insight });
    } else {
      const gid = entry.meta?.garmentId as string | undefined;
      const insight = (entry.meta?.label as string | undefined) ?? entry.body ?? "";
      if (gid) rediscoverPieces.push({ garmentId: gid, matchIds: entry.garmentIds, insight });
    }
  }

  const reconsiderEntries = needs.reconsider.entries.map((e) => ({ garmentId: e.garmentId, reasons: e.reasons }));

  return {
    page, garmentCards, glanceRegisters: [], allRegisterReadings: [], neutralSharePct: null, neutralTemperature: null,
    enoughCluster, enoughClusters, rediscoverPieces, bestByRegisterPreview: {}, moodboardLooks: [], recommendationDetail: null,
    combosCount: null, reconsiderEntries,
  };
}

beforeEach(() => {
  state.loader = buildPersonaFLoaderData(personaFWardrobe(), PERSONA_F_PASSPORT);
});

const render = () => renderToString(<WardrobeIntelligencePage />);

/** React SSR inserts <!-- --> markers between text and an interpolated expression
 *  (e.g. "See <!-- -->9<!-- --> compatible pieces") — strip them before asserting on
 *  rendered text content, same as any renderToString-based text assertion must. */
const stripSsrComments = (html: string) => html.replace(/<!--\s*-->/g, "");

/** The HTML for just the Rediscover section — "wip-piece-card" is reused by the
 *  separate "Worth reconsidering" section below it, so a global count would conflate
 *  the two. Bounded to the next <section> after the heading. */
const rediscoverSectionHtml = (html: string) => {
  const start = html.indexOf("Pieces worth rediscovering.");
  if (start === -1) return "";
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? undefined : end);
};

describe("PFR-A — Buy Less genuinely renders real content for Persona F", () => {
  it("PFR-A.1 the 'Buy less.' section heading renders", () => {
    const html = render();
    expect(html).toContain("Buy less.");
    expect(html).toContain("Skip for now");
  });

  it("PFR-A.2 the body text is the real engine sentence, not a placeholder, and the count is real", () => {
    const html = render();
    const loaderData = state.loader as ReturnType<typeof buildPersonaFLoaderData>;
    const body = loaderData.enoughCluster!.body;
    expect(body).toMatch(/You already have \d+ /);
    // React/renderToString HTML-escapes the apostrophe in "wouldn't" as &#x27;.
    expect(html).toContain(body.replace(/'/g, "&#x27;"));
  });

  it("PFR-A.3 it never claims visual similarity (near-duplicate/identical) it never checked", () => {
    const html = render();
    const buyLessIdx = html.indexOf("Buy less.");
    expect(buyLessIdx).toBeGreaterThan(-1);
    // Scope to roughly this section so a match elsewhere on the page can't hide a real finding.
    const scope = html.slice(buyLessIdx, buyLessIdx + 1500);
    expect(scope).not.toMatch(/near-duplicate|identical/i);
  });

  it("PFR-A.4 real garment evidence thumbnails render — one per listed garment id, up to 4", () => {
    const html = render();
    const loaderData = state.loader as ReturnType<typeof buildPersonaFLoaderData>;
    const expectedCount = Math.min(loaderData.enoughCluster!.garmentIds.length, 4);
    expect(expectedCount).toBeGreaterThan(0);
    const buyLessIdx = html.indexOf("Buy less.");
    const scope = html.slice(buyLessIdx, buyLessIdx + 3000);
    const thumbs = (scope.match(/wip-thumb\b/g) ?? []).length;
    expect(thumbs).toBeGreaterThanOrEqual(expectedCount);
  });
});

describe("PFR-B — Wear More / Rediscover genuinely renders real content for Persona F", () => {
  it("PFR-B.1 the 'Pieces worth rediscovering.' section heading renders", () => {
    const html = render();
    expect(html).toContain("Pieces worth rediscovering.");
  });

  it("PFR-B.2 the rarely-worn bottom's card shows its real, engine-computed insight label", () => {
    // The card shows entry.meta.label ("Underused" — a real classification, not invented
    // text) rather than the full self-reported sentence ("You said you rarely reach for
    // this piece...", which lives in the engine's RediscoverPiece.body and is proven
    // present in wardrobe-persona-f.test.ts's PF-3.1 at the engine layer). Both are real;
    // this just confirms which one the actual card renders, rather than assuming.
    const html = render();
    const loaderData = state.loader as ReturnType<typeof buildPersonaFLoaderData>;
    const scope = rediscoverSectionHtml(html);
    expect(scope).toContain(loaderData.rediscoverPieces.find((p) => p.garmentId.includes("bottom-black"))!.insight);
  });

  it("PFR-B.3 the real 'Style this in StyleMe' handoff form posts the real garment id", () => {
    const html = render();
    const loaderData = state.loader as ReturnType<typeof buildPersonaFLoaderData>;
    const bottomId = loaderData.rediscoverPieces.find((p) => p.garmentId.includes("bottom-black"))!.garmentId;
    expect(html).toContain(`action="/api/wi-style-this"`);
    expect(html).toContain(`value="${bottomId}"`);
  });

  it("PFR-B.4 the compatible-pieces interaction control renders with the real partner count", () => {
    const html = stripSsrComments(render());
    const loaderData = state.loader as ReturnType<typeof buildPersonaFLoaderData>;
    const bottom = loaderData.rediscoverPieces.find((p) => p.garmentId.includes("bottom-black"))!;
    expect(bottom.matchIds.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain(`See ${bottom.matchIds.length} compatible pieces`);
  });

  it("PFR-B.5 at most 3 pieces render even though more may qualify — the real display cap, not an invented one", () => {
    const html = render();
    const loaderData = state.loader as ReturnType<typeof buildPersonaFLoaderData>;
    const scope = rediscoverSectionHtml(html);
    expect(scope).not.toBe("");
    const cardCount = (scope.match(/wip-piece-card\b/g) ?? []).length;
    expect(cardCount).toBe(Math.min(loaderData.rediscoverPieces.length, 3));
  });
});

describe("PFR-C — the Passport-gate fix is visible at the render layer, not just the engine layer", () => {
  it("PFR-C.1 WITHOUT the restriction, the sleeveless probe's own StyleMe handoff form renders", () => {
    const html = render();
    expect(html).toContain(`value="pfr-probe-sleeveless-top"`);
  });

  it("PFR-C.2 WITH arms-covered stated, the probe's handoff form never renders at all", () => {
    const restricted = { ...PERSONA_F_PASSPORT, dressingPreferences: ["arms-covered"] } as unknown as WardrobePassport;
    state.loader = buildPersonaFLoaderData(personaFWardrobe(), restricted);
    const html = render();
    expect(html).not.toContain(`value="pfr-probe-sleeveless-top"`);
    // The genuinely compatible candidate must still be there — the gate excludes one piece,
    // not the whole section.
    expect(html).toContain("Pieces worth rediscovering.");
  });
});

describe("PFR-D — missing-data behaviour: neither section renders when there is nothing to show", () => {
  it("PFR-D.1 a thin wardrobe with no 'enough' cluster and no rediscover candidate renders neither section", () => {
    const thin = [
      makeGarment({ id: "pfr-thin-1", slot: "top" }),
      makeGarment({ id: "pfr-thin-2", slot: "bottom", category: "BOTTOMS" }),
      makeGarment({ id: "pfr-thin-3", slot: "shoe", category: "SHOES" }),
    ];
    state.loader = buildPersonaFLoaderData(thin, PERSONA_F_PASSPORT);
    const html = render();
    expect(html).not.toContain("Buy less.");
    expect(html).not.toContain("Pieces worth rediscovering.");
  });
});

// ── PFR-E: interaction handlers — source-verified wiring, NOT a simulated click ──
//
// HONEST LIMITATION: this repo has no jsdom/React Testing Library (vitest.config.ts sets
// environment: "node", confirmed by the explore pass that scoped this task), so a real
// click-then-rerender cycle cannot be exercised here. renderToString is static SSR — an
// onClick prop never serialises into the HTML it produces, so it cannot be asserted on
// through the render itself. PFR-B already proves the two concrete, verifiable facts a
// click interaction depends on: the handoff <Form> carries the real garment id (PFR-B.3),
// and the "compatible pieces" button's own label carries the real partner count (PFR-B.4).
// What's checked here, additionally and explicitly as a SOURCE check rather than a render
// assertion, is that the button is actually wired to open the matches dialog for the
// correct anchor id, computed from the loop variable rather than hardcoded.

describe("PFR-E — the 'compatible pieces' interaction handler is wired correctly (source-verified, not a simulated click)", () => {
  it("PFR-E.1 the button's onClick opens the matches dialog keyed to THIS piece's own garment id", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "app/routes/closet.intelligence.tsx"), "utf8");
    const sectionIdx = src.indexOf("Pieces worth rediscovering.");
    const scope = src.slice(sectionIdx, sectionIdx + 2000);
    expect(scope).toMatch(/onClick=\{\(\)\s*=>\s*setDialog\(\{\s*kind:\s*"matches",\s*anchorId:\s*piece\.garmentId\s*\}\)\}/);
  });
});

// ── PFR-F: responsive behaviour — SIMULATED source/CSS checks only, NOT a real browser ──
//
// EXPLICITLY NOT a real viewport test. There is no browser, no jsdom, and no visual
// rendering here — renderToString produces a string of HTML in a Node process with no
// layout engine at all. What follows only confirms that a real, already-shipped @media
// breakpoint exists in the component's own CSS for the two sections Persona F exercises.
// It cannot and does not prove how the page actually looks at any width; that requires an
// actual browser (e.g. the Browser-pane preview workflow), which was out of scope for this
// local-only verification pass.

describe("PFR-F — responsive CSS exists for both sections (SIMULATED check — source/CSS only, not a real browser)", () => {
  it("PFR-F.1 [SIMULATED] .wip-piece-grid (Rediscover's card grid) has real breakpoints, not a fixed desktop-only layout", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "app/routes/closet.intelligence.tsx"), "utf8");
    expect(src).toMatch(/@media\(max-width:900px\)\{\.wip-piece-grid/);
    expect(src).toMatch(/@media\(max-width:600px\)\{\.wip-piece-grid/);
  });

  it("PFR-F.2 [SIMULATED] .wip-card-shell (Buy-Less's card, section 7) has a real narrower-viewport rule", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(process.cwd(), "app/routes/closet.intelligence.tsx"), "utf8");
    expect(src).toMatch(/@media\(max-width:700px\)\{\.wip-card-shell/);
  });
});
