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
// and this wrapper is the ONLY path that can ever surface them.
//
// 2026-11-18 — rewritten for the session-based redesign (was: a shared
// secret header, never actually usable by Five-Persona QA for the same
// reason the StyleMe fixture hit the same wall — see editorial-reports.server.ts's
// own comment). customerId is now ALWAYS the real, session-derived id from
// the one real caller (trends.my-edits.tsx's own requireCurrentNaiaCustomer)
// — never attacker-suppliable — so these tests pass it directly rather than
// constructing a Request/header at all. Gated on FOUR independent,
// all-fail-closed conditions: VERCEL_ENV, NAIA_PROJECT_VARIANT, the feature
// flag, and the authenticated caller being the one specific, founder-
// authorized QA customer.
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

describe("getPublishedEditorialReportsForQaPreview — #23 customer-restricted fixture viewing (session-based, no shared secret)", () => {
  const originalEnv = process.env.VERCEL_ENV;
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalFlag = process.env.TREND_EDIT_FIXTURE_ENABLED;
  const originalCustomerId = process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID;
  const AUTHORIZED_CUSTOMER_ID = "cust_qa_authorized_abc123";
  const OTHER_CUSTOMER_ID = "cust_some_other_real_customer";

  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.editorialTrendReport.count as any).mockResolvedValue(3);
    (prisma.editorialTrendReport.findMany as any).mockResolvedValue([]);
    process.env.VERCEL_ENV = "preview";
    process.env.NAIA_PROJECT_VARIANT = "staging";
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalEnv;
    if (originalVariant === undefined) delete process.env.NAIA_PROJECT_VARIANT;
    else process.env.NAIA_PROJECT_VARIANT = originalVariant;
    if (originalFlag === undefined) delete process.env.TREND_EDIT_FIXTURE_ENABLED;
    else process.env.TREND_EDIT_FIXTURE_ENABLED = originalFlag;
    if (originalCustomerId === undefined) delete process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID;
    else process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID = originalCustomerId;
  });

  it("QA1 — with the flag unset, never queries for fixture rows even for the authorized customer", async () => {
    delete process.env.TREND_EDIT_FIXTURE_ENABLED;
    delete process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID;
    await getPublishedEditorialReportsForQaPreview(AUTHORIZED_CUSTOMER_ID);
    // Exactly one findMany call: the standard PUBLISHED query. No second
    // call for the fixture slugs.
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
    expect((prisma.editorialTrendReport.findMany as any).mock.calls[0][0]).toEqual({
      where: { status: "PUBLISHED" },
      orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
    });
  });

  it("QA2 — production environment rejects even the correctly authorized customer", async () => {
    process.env.VERCEL_ENV = "production";
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID = AUTHORIZED_CUSTOMER_ID;
    const result = await getPublishedEditorialReportsForQaPreview(AUTHORIZED_CUSTOMER_ID);
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it("QA2b — a non-staging NAIA_PROJECT_VARIANT rejects even on a preview VERCEL_ENV", async () => {
    process.env.NAIA_PROJECT_VARIANT = "not-staging";
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID = AUTHORIZED_CUSTOMER_ID;
    const result = await getPublishedEditorialReportsForQaPreview(AUTHORIZED_CUSTOMER_ID);
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it("QA3 — with the flag on but TREND_EDIT_FIXTURE_QA_CUSTOMER_ID unset, fails closed even for a plausible customer id", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    delete process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID;
    await getPublishedEditorialReportsForQaPreview(AUTHORIZED_CUSTOMER_ID);
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
  });

  it("QA5 — the WRONG (genuinely real, genuinely authenticated) customer still fails closed", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID = AUTHORIZED_CUSTOMER_ID;
    const result = await getPublishedEditorialReportsForQaPreview(OTHER_CUSTOMER_ID);
    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it("QA6 — no customerId at all (null/undefined) fails closed, never throws", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID = AUTHORIZED_CUSTOMER_ID;
    for (const missing of [null, undefined]) {
      await expect(getPublishedEditorialReportsForQaPreview(missing)).resolves.toEqual([]);
    }
  });

  it("QA8 — POSITIVE: preview + staging + flag on + the authorized customer — queries for the two fixed fixture slugs, scoped to status: DRAFT", async () => {
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID = AUTHORIZED_CUSTOMER_ID;
    (prisma.editorialTrendReport.findMany as any)
      .mockResolvedValueOnce([]) // the standard PUBLISHED query
      .mockResolvedValueOnce(FIXTURE_SLUGS.map(makeRow)); // the gated fixture query

    const result = await getPublishedEditorialReportsForQaPreview(AUTHORIZED_CUSTOMER_ID);

    expect(prisma.editorialTrendReport.findMany).toHaveBeenCalledTimes(2);
    expect((prisma.editorialTrendReport.findMany as any).mock.calls[1][0]).toEqual({
      where: { slug: { in: FIXTURE_SLUGS }, status: "DRAFT" },
      orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
    });
    expect(result.map((r) => r.slug).sort()).toEqual([...FIXTURE_SLUGS].sort());
  });

  it("QA10 — development VERCEL_ENV is accepted (same convention as the StyleMe fixture's resolver)", async () => {
    process.env.VERCEL_ENV = "development";
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
    process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID = AUTHORIZED_CUSTOMER_ID;
    (prisma.editorialTrendReport.findMany as any)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(FIXTURE_SLUGS.map(makeRow));
    const result = await getPublishedEditorialReportsForQaPreview(AUTHORIZED_CUSTOMER_ID);
    expect(result.map((r) => r.slug).sort()).toEqual([...FIXTURE_SLUGS].sort());
  });
});
