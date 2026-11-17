// app/lib/editorial-reports-qa-preview.test.ts
//
// Coverage for getPublishedEditorialReportsForQaPreview (editorial-reports.server.ts),
// the customer-restricted viewing path added for #23's same-month Trend
// Edit fixture after it was discovered that the shared naia-stylist-staging
// Vercel project has no genuinely separate database per Preview deployment
// (every DATABASE_URL-family env var is scoped "Production, Preview" — one
// shared DB for every Preview). Since there is no isolated database to
// create the fixture rows in, this wrapper is what keeps those two global,
// non-customer-scoped EditorialTrendReport rows from ever appearing to a
// real customer: they are created as status: DRAFT (invisible to the
// standard getPublishedEditorialReports() query used by every other route),
// and this wrapper is the ONLY path that can ever surface them, gated on
// two independent secrets that must both match on the same request.
//
// Run: npx vitest run app/lib/editorial-reports-qa-preview.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    editorialTrendReport: { count: vi.fn(), findMany: vi.fn() },
  },
}));

import prisma from "../db.server";
import { getPublishedEditorialReportsForQaPreview } from "./editorial-reports.server";

const FIXTURE_SLUGS = [
  "test-batch1-trend-edit-samemonth-a",
  "test-batch1-trend-edit-samemonth-b",
];

function makeRow(slug: string) {
  return {
    id: `fixture_${slug}`,
    slug,
    title: `[QA TEST] ${slug}`,
    season: "QA Fixture",
    publishedAt: new Date("2026-01-01"),
    editionMonth: "2030-01",
    status: "DRAFT",
    order: 0,
    mood: null,
    naiaTake: null,
    naiaInterpretation: null,
    naiaVerdict: null,
    wardrobeNote: null,
    investmentNotes: null,
    visualTreatment: null,
    keyTrends: [],
    rising: [],
    fading: [],
    referencesBehindThisEdit: [],
    howToWear: [],
    sources: [],
    spendSaveSkip: {},
    summary: "QA fixture — safe to ignore.",
    editorialIntro: "QA fixture — safe to ignore.",
  };
}

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/my-naia/trends/my-edits", { headers });
}

describe("getPublishedEditorialReportsForQaPreview — #23 customer-restricted fixture viewing", () => {
  const originalFlag = process.env.TREND_EDIT_FIXTURE_ENABLED;
  const originalSecret = process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET;
  const PREVIEW_SECRET = "qa-preview-secret-xyz";

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.editorialTrendReport.count as any).mockResolvedValue(3);
    (prisma.editorialTrendReport.findMany as any).mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.TREND_EDIT_FIXTURE_ENABLED;
    else process.env.TREND_EDIT_FIXTURE_ENABLED = originalFlag;
    if (originalSecret === undefined) delete process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET;
    else process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET = originalSecret;
  });

  it("QA1 — with the flag unset, never queries for fixture rows regardless of any header sent", async () => {
    delete process.env.TREND_EDIT_FIXTURE_ENABLED;
    delete process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET;
    await getPublishedEditorialReportsForQaPreview(
      makeRequest({ "x-trend-edit-fixture-preview": "anything" }),
    );
    // Exactly one findMany call: the standard PUBLISHED query. No second
    // call for the fixture slugs.
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
    expect((prisma.editorialTrendReport.findMany as any).mock.calls[0][0]).toEqual({
      where: { status: "PUBLISHED" },
      orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
    });
  });

  it("QA2 — with the flag on but no preview secret configured, fails closed (never surfaces fixture rows)", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    delete process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET;
    await getPublishedEditorialReportsForQaPreview(
      makeRequest({ "x-trend-edit-fixture-preview": "anything" }),
    );
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
  });

  it("QA3 — with the flag and secret both configured but no header sent, fails closed", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET = PREVIEW_SECRET;
    await getPublishedEditorialReportsForQaPreview(makeRequest());
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
  });

  it("QA4 — with a header present but not matching the configured secret, fails closed", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET = PREVIEW_SECRET;
    await getPublishedEditorialReportsForQaPreview(
      makeRequest({ "x-trend-edit-fixture-preview": "wrong-value" }),
    );
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
  });

  it("QA5 — only with flag on AND an exact header/secret match does it query for the two fixed fixture slugs, scoped to status: DRAFT", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET = PREVIEW_SECRET;
    (prisma.editorialTrendReport.findMany as any)
      .mockResolvedValueOnce([]) // the standard PUBLISHED query
      .mockResolvedValueOnce(FIXTURE_SLUGS.map(makeRow)); // the gated fixture query

    const result = await getPublishedEditorialReportsForQaPreview(
      makeRequest({ "x-trend-edit-fixture-preview": PREVIEW_SECRET }),
    );

    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(2);
    expect((prisma.editorialTrendReport.findMany as any).mock.calls[1][0]).toEqual({
      where: { slug: { in: FIXTURE_SLUGS }, status: "DRAFT" },
      orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
    });
    expect(result.map((r) => r.slug).sort()).toEqual([...FIXTURE_SLUGS].sort());
  });

  it("QA6 — merged result never includes the matched secret value anywhere in its data", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET = PREVIEW_SECRET;
    (prisma.editorialTrendReport.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(FIXTURE_SLUGS.map(makeRow));

    const result = await getPublishedEditorialReportsForQaPreview(
      makeRequest({ "x-trend-edit-fixture-preview": PREVIEW_SECRET }),
    );
    expect(JSON.stringify(result)).not.toContain(PREVIEW_SECRET);
  });
});
