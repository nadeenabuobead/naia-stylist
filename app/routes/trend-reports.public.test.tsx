// Public Trend Reports — behavioral + boundary tests.
//
// The pre-existing trends.phase4.test.ts / trends.phase5a.test.ts files only
// string-match raw route source text; they never invoke a loader, render a
// component, or exercise a 404/draft path. This file exercises the real
// loader/meta/component contracts for the two PUBLIC surfaces:
//   /trend-reports        -> app/routes/trend-reports._index.tsx -> trends.jsx
//   /trend-reports/:slug  -> app/routes/trend-reports.$slug.tsx  -> trends.$slug.tsx
// plus a static boundary check that none of the public trend-report files
// import anything from StyleMe, Wardrobe Intelligence, Buy/Skip, Passport
// customer resolution, or session/auth.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import React from "react";
import type { TrendReportData } from "../lib/trend-reports";

const __dirname = dirname(fileURLToPath(import.meta.url));

// trends.jsx is plain JSX (classic transform under this test runner's esbuild
// defaults, unlike the .tsx routes which pick up tsconfig's react-jsx/automatic
// setting) and references a bare `React` identifier at render time. Exposing it
// globally here fixes the test harness only — the real Vite+React build already
// handles this correctly for the production app.
(globalThis as Record<string, unknown>).React = React;

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  const { createElement } = await import("react");
  const mockLink = ({
    to,
    children,
    className,
    style,
  }: {
    to: string;
    children: unknown;
    className?: string;
    style?: object;
  }) => createElement("a", { href: to, className, style }, children as React.ReactNode);

  return {
    ...actual,
    Link: mockLink,
    useLoaderData: vi.fn(),
    useRouteError: vi.fn(),
  };
});

vi.mock("~/lib/editorial-reports.server", () => ({
  getPublishedEditorialReports: vi.fn(),
  getEditorialReportBySlug: vi.fn(),
}));

import { useLoaderData, useRouteError } from "react-router";
import {
  getPublishedEditorialReports,
  getEditorialReportBySlug,
} from "~/lib/editorial-reports.server";
import TrendReports, { loader as landingLoader, meta as landingMeta } from "./trends.jsx";
import TrendReportDetail, {
  loader as detailLoader,
  meta as detailMeta,
  ErrorBoundary,
} from "./trends.$slug";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<TrendReportData> = {}): TrendReportData {
  return {
    slug: "spring-2026-soft-structure",
    title: "Spring 2026 Soft Structure",
    season: "Spring 2026",
    publishedAt: "2026-06-30",
    summary: "A reading of softened tailoring.",
    editorialIntro: "Structure is loosening without losing intent.",
    keyTrends: [
      { name: "Undone Tailoring", description: "Jackets that hold shape without rigidity." },
      { name: "Soft Volume", description: "Fuller silhouettes with a quieter hand." },
    ],
    sources: [{ publisher: "WWD", title: "Soft Tailoring Returns", url: "https://example.com/a" }],
    published: true,
    order: 1,
    ...overrides,
  };
}

// ── 1. Landing route (/trend-reports -> trends.jsx) ────────────────────────────

describe("landing loader (public, anonymous)", () => {
  it("resolves with no request/session argument at all — proves no auth dependency", async () => {
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([makeReport()]);
    await expect(landingLoader()).resolves.toBeDefined();
  });

  it("passes through exactly what the data layer returns — no extra filtering/leakage", async () => {
    const published = makeReport({ slug: "only-one", order: 1 });
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([published]);

    const result = await landingLoader();

    expect(result.featured?.slug).toBe("only-one");
    expect(result.rest).toHaveLength(0);
  });

  it("sorts deterministically: newest publishedAt first, then order ascending as tiebreak", async () => {
    const older = makeReport({ slug: "older", publishedAt: "2026-01-01", order: 2 });
    const newer = makeReport({ slug: "newer", publishedAt: "2026-06-01", order: 5 });
    const sameDateFirst = makeReport({ slug: "same-date-first", publishedAt: "2026-06-01", order: 1 });
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([older, newer, sameDateFirst]);

    const result = await landingLoader();

    expect(result.featured?.slug).toBe("same-date-first");
    expect(result.rest.map((r: TrendReportData) => r.slug)).toEqual(["newer", "older"]);
  });

  it("returns a null-featured, empty-rest shape when the data layer has nothing published", async () => {
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([]);
    const result = await landingLoader();
    expect(result.featured).toBeNull();
    expect(result.rest).toEqual([]);
  });
});

describe("landing metadata", () => {
  it("exports a meta() with a useful title and description", () => {
    const tags = landingMeta();
    const title = tags.find((t: Record<string, unknown>) => "title" in t);
    const description = tags.find((t: Record<string, unknown>) => t.name === "description");
    expect(title?.title).toMatch(/Trend Reports/i);
    expect(typeof description?.content).toBe("string");
    expect((description?.content as string).length).toBeGreaterThan(10);
  });
});

describe("TrendReports component (landing)", () => {
  it("renders the featured report's title, season and date without crashing", () => {
    const featured = makeReport({ title: "Spring Soft Structure", season: "Spring 2026", publishedAt: "2026-06-30" });
    vi.mocked(useLoaderData).mockReturnValue({ featured, rest: [] });

    const html = renderToString(React.createElement(TrendReports));

    expect(html).toContain("Spring 2026");
    expect(html).toMatch(/Soft/);
  });

  it("renders every rest-report's title in a grid card", () => {
    const featured = makeReport({ slug: "a", title: "A Report" });
    const second = makeReport({ slug: "b", title: "Second Direction" });
    vi.mocked(useLoaderData).mockReturnValue({ featured, rest: [second] });

    const html = renderToString(React.createElement(TrendReports));

    expect(html).toContain("Second Direction");
  });

  it("does not crash when there is no featured report and no rest reports (empty state)", () => {
    vi.mocked(useLoaderData).mockReturnValue({ featured: null, rest: [] });
    expect(() => renderToString(React.createElement(TrendReports))).not.toThrow();
  });

  it("does not crash on a report with no visual treatment (missing optional image)", () => {
    const featured = makeReport({ visual: undefined });
    vi.mocked(useLoaderData).mockReturnValue({ featured, rest: [] });
    expect(() => renderToString(React.createElement(TrendReports))).not.toThrow();
  });

  it("does not break rendering on an unusually long title/summary", () => {
    const featured = makeReport({
      title: "An Extraordinarily Long Editorial Title That Keeps Going Well Past What Any Reasonable Layout Would Expect To Receive",
      summary: "A deck sentence that similarly refuses to end and keeps running on and on describing the same seasonal direction in exhaustive, unnecessary detail for layout-stress purposes only.",
    });
    vi.mocked(useLoaderData).mockReturnValue({ featured, rest: [] });
    expect(() => renderToString(React.createElement(TrendReports))).not.toThrow();
  });

  it("never mentions personalization verdicts about the anonymous reader", () => {
    const featured = makeReport();
    vi.mocked(useLoaderData).mockReturnValue({ featured, rest: [] });
    const html = renderToString(React.createElement(TrendReports)).toLowerCase();
    expect(html).not.toMatch(/this suits you/);
    expect(html).not.toMatch(/you should buy/);
    expect(html).not.toMatch(/works for your body/);
    expect(html).not.toMatch(/matches your passport/);
  });
});

// ── 2. Detail route (/trend-reports/:slug -> trends.$slug.tsx) ─────────────────

describe("detail loader (public, anonymous)", () => {
  it("resolves a known, published slug without any request/session argument", async () => {
    const report = makeReport();
    vi.mocked(getEditorialReportBySlug).mockResolvedValueOnce(report);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([report]);

    const result = await detailLoader({ params: { slug: report.slug } } as never);

    expect(result.report.slug).toBe(report.slug);
  });

  it("throws a 404 Response for an unknown slug", async () => {
    vi.mocked(getEditorialReportBySlug).mockResolvedValueOnce(null);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([]);

    await expect(detailLoader({ params: { slug: "does-not-exist" } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("throws a 404 Response for a draft/unpublished slug — getEditorialReportBySlug already returns null for drafts", async () => {
    // getEditorialReportBySlug's own contract (editorial-reports.server.ts) returns
    // null for any DB row whose status isn't PUBLISHED; the route loader must turn
    // that into a 404 rather than rendering draft content.
    vi.mocked(getEditorialReportBySlug).mockResolvedValueOnce(null);
    vi.mocked(getPublishedEditorialReports).mockResolvedValueOnce([]);

    await expect(detailLoader({ params: { slug: "unpublished-draft" } } as never)).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("detail metadata", () => {
  it("uses the report's own title and summary, not a generic fallback", () => {
    const report = makeReport({ title: "Modern Tailoring", summary: "Tailoring becomes fluid." });
    const tags = detailMeta({ data: { report } } as never);
    const title = tags.find((t: Record<string, unknown>) => "title" in t);
    const description = tags.find((t: Record<string, unknown>) => t.name === "description");
    expect(title?.title).toContain("Modern Tailoring");
    expect(description?.content).toBe("Tailoring becomes fluid.");
  });

  it("falls back to a non-leaking generic title when there is no report (404 path)", () => {
    const tags = detailMeta({ data: undefined } as never);
    const title = tags.find((t: Record<string, unknown>) => "title" in t);
    expect(title?.title).toMatch(/Not Found/i);
  });
});

describe("TrendReportDetail component", () => {
  it("renders title, season (category) and date", () => {
    const report = makeReport({ title: "Colour Direction", season: "Spring 2026", publishedAt: "2026-05-01" });
    vi.mocked(useLoaderData).mockReturnValue({ report, allPublished: [report] });

    const html = renderToString(React.createElement(TrendReportDetail));

    expect(html).toMatch(/Colour|Direction/);
    expect(html).toContain("Spring 2026");
  });

  it("renders key-direction sections in the order they're given", () => {
    const report = makeReport({
      keyTrends: [
        { name: "First Direction", description: "" },
        { name: "Second Direction", description: "" },
      ],
    });
    vi.mocked(useLoaderData).mockReturnValue({ report, allPublished: [report] });

    const html = renderToString(React.createElement(TrendReportDetail));

    expect(html.indexOf("First Direction")).toBeGreaterThan(-1);
    expect(html.indexOf("First Direction")).toBeLessThan(html.indexOf("Second Direction"));
  });

  it("renders nAia Take before Investment Notes, preserving editorial section order", () => {
    const report = makeReport({ naiaTake: "nAia reads this as intentional.", investmentNotes: "Spend on the blazer." });
    vi.mocked(useLoaderData).mockReturnValue({ report, allPublished: [report] });

    const html = renderToString(React.createElement(TrendReportDetail));

    expect(html.indexOf("nAia reads this as intentional.")).toBeLessThan(
      html.indexOf("Spend on the blazer.")
    );
  });

  it("does not crash when mood/rising/fading/references/sources are all absent", () => {
    const report = makeReport({ mood: undefined, rising: undefined, fading: undefined, referencesBehindThisEdit: undefined, sources: [] });
    vi.mocked(useLoaderData).mockReturnValue({ report, allPublished: [report] });
    expect(() => renderToString(React.createElement(TrendReportDetail))).not.toThrow();
  });

  it("does not crash when there are no other published reports to relate to", () => {
    const report = makeReport();
    vi.mocked(useLoaderData).mockReturnValue({ report, allPublished: [report] });
    const html = renderToString(React.createElement(TrendReportDetail));
    expect(html).not.toContain("more <em>reports.</em>".replace("<em>", "").replace("</em>", ""));
  });

  it("does not break rendering on an unusually long title", () => {
    const report = makeReport({
      title: "A Title So Long It Would Normally Force A Layout Engineer To Reconsider Every Decision They Have Ever Made About Typography",
    });
    vi.mocked(useLoaderData).mockReturnValue({ report, allPublished: [report] });
    expect(() => renderToString(React.createElement(TrendReportDetail))).not.toThrow();
  });

  it("never asserts personalized fit/ownership claims about the anonymous reader", () => {
    const report = makeReport();
    vi.mocked(useLoaderData).mockReturnValue({ report, allPublished: [report] });
    const html = renderToString(React.createElement(TrendReportDetail)).toLowerCase();
    expect(html).not.toMatch(/this suits you/);
    expect(html).not.toMatch(/you should buy/);
    expect(html).not.toMatch(/works for your body/);
    expect(html).not.toMatch(/matches your passport/);
  });
});

describe("ErrorBoundary (404 page)", () => {
  it("renders a not-found message for a 404 Response without leaking draft content", () => {
    vi.mocked(useRouteError).mockReturnValue(new Response("Not Found", { status: 404 }));
    const html = renderToString(React.createElement(ErrorBoundary));
    expect(html).toMatch(/not found/i);
  });
});

// ── 3. Public alias routes wire to the same functions ──────────────────────────

describe("/trend-reports alias routes", () => {
  it("trend-reports._index.tsx re-exports the same default/loader/meta as trends.jsx", async () => {
    const alias = await import("./trend-reports._index");
    expect(alias.default).toBe(TrendReports);
    expect(alias.loader).toBe(landingLoader);
    expect(alias.meta).toBe(landingMeta);
  });

  it("trend-reports.$slug.tsx re-exports the same default/loader/meta as trends.$slug.tsx", async () => {
    const alias = await import("./trend-reports.$slug");
    expect(alias.default).toBe(TrendReportDetail);
    expect(alias.loader).toBe(detailLoader);
    expect(alias.meta).toBe(detailMeta);
  });
});

// ── 4. Boundary: no personalized/customer-data imports in the public surface ──

const FORBIDDEN_IMPORT_PATTERNS: RegExp[] = [
  /from ["'].*styleme/i,
  /from ["'].*\/ai\/styleme/i,
  /from ["'].*buyskip/i,
  /from ["'].*wardrobe-(intelligence|recommendations|needs|copy)/i,
  /from ["'].*\/passport\//i,
  /from ["'].*naia-session\.server/i,
  /from ["'].*\bsession\.server/i,
  /requireCurrentNaiaCustomer/,
];

const PUBLIC_SURFACE_FILES = [
  "trends.jsx",
  "trends.$slug.tsx",
  "trend-reports._index.tsx",
  "trend-reports.$slug.tsx",
];

const PUBLIC_LIB_FILES = [
  "../lib/editorial-reports.server.ts",
  "../lib/editorial-reports.normalise.ts",
  "../lib/trend-reports.ts",
  "../lib/report-visual.tsx",
  "../lib/storefront-config.ts",
];

describe("boundary: public trend-report surface imports nothing personalized/customer-specific", () => {
  for (const file of [...PUBLIC_SURFACE_FILES, ...PUBLIC_LIB_FILES]) {
    it(`${file} has no forbidden import`, () => {
      const source = readFileSync(resolve(__dirname, file), "utf-8");
      for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
        expect(source).not.toMatch(pattern);
      }
    });
  }

  it("none of the public files import Prisma directly except the editorial content layer", () => {
    for (const file of PUBLIC_SURFACE_FILES) {
      const source = readFileSync(resolve(__dirname, file), "utf-8");
      expect(source).not.toMatch(/from ["'].*db\.server/);
    }
  });
});
