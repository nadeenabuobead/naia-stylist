// Tests for the QA-fixture-only createDuplicateMonthTrendEditFixture /
// deleteDuplicateMonthTrendEditFixture actions added to api.seed-staging.jsx
// to exercise #23's same-editionMonth grouping on a live deployment without
// needing real editorial content to happen to include that scenario.
//
// This fixture is global/public content (EditorialTrendReport, not
// customer-scoped), a materially bigger blast radius than every other
// action in this file — hence the dedicated TREND_EDIT_FIXTURE_ENABLED
// gate tested explicitly below, independent of the standard staging +
// secret checks already covered by the existing §S1/§S2 suites.
//
// Run: npx vitest run app/routes/api.seed-staging.trend-edit-fixture.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    editorialTrendReport: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock("../lib/ai/journey-events.server", () => ({
  emitClosetItemAdded: vi.fn(),
  recordJourneyEvent: vi.fn(),
}));

import prisma from "../db.server";
import { action } from "./api.seed-staging";

const STAGING_SECRET = "test-secret-abc123";
const SLUGS = ["test-batch1-trend-edit-samemonth-a", "test-batch1-trend-edit-samemonth-b"];

function makeActionRequest(body: object): { request: Request } {
  return {
    request: new Request("https://example.com/api/seed-staging", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-seed-secret": STAGING_SECRET },
      body: JSON.stringify(body),
    }),
  };
}

describe("§S7 seed-staging duplicate-month Trend Edit fixture", () => {
  const originalVariant = process.env.NAIA_PROJECT_VARIANT;
  const originalSecret = process.env.STAGING_SEED_SECRET;
  const originalFlag = process.env.TREND_EDIT_FIXTURE_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NAIA_PROJECT_VARIANT = "staging";
    process.env.STAGING_SEED_SECRET = STAGING_SECRET;
    process.env.TREND_EDIT_FIXTURE_ENABLED = "true";
  });

  afterEach(() => {
    process.env.NAIA_PROJECT_VARIANT = originalVariant;
    process.env.STAGING_SEED_SECRET = originalSecret;
    if (originalFlag === undefined) delete process.env.TREND_EDIT_FIXTURE_ENABLED;
    else process.env.TREND_EDIT_FIXTURE_ENABLED = originalFlag;
  });

  it("S701 — refuses when TREND_EDIT_FIXTURE_ENABLED is unset, even with staging + a valid secret", async () => {
    delete process.env.TREND_EDIT_FIXTURE_ENABLED;
    const resp = await action(makeActionRequest({ _action: "createDuplicateMonthTrendEditFixture" }) as any);
    expect(resp.status).toBe(403);
    expect(prisma.editorialTrendReport.upsert).not.toHaveBeenCalled();
  });

  it("S702 — refuses a near-miss value (\"TRUE\", \"1\", trailing space) just as it would refuse unset", async () => {
    for (const badValue of ["TRUE", "1", "true ", "yes"]) {
      process.env.TREND_EDIT_FIXTURE_ENABLED = badValue;
      const resp = await action(makeActionRequest({ _action: "createDuplicateMonthTrendEditFixture" }) as any);
      expect(resp.status, `value ${JSON.stringify(badValue)} must still refuse`).toBe(403);
    }
    expect(prisma.editorialTrendReport.upsert).not.toHaveBeenCalled();
  });

  it("S703 — creates exactly 2 rows sharing one editionMonth, with no caller input accepted", async () => {
    (prisma.editorialTrendReport.upsert as any).mockImplementation(({ create }: any) =>
      Promise.resolve({ id: `fixture_${create.slug}`, slug: create.slug }),
    );

    const resp = await action(
      makeActionRequest({
        _action: "createDuplicateMonthTrendEditFixture",
        slug: "attacker-controlled-slug",
        editionMonth: "2026-06",
      }) as any,
    );
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(prisma.editorialTrendReport.upsert).toHaveBeenCalledTimes(2);
    const calledSlugs = (prisma.editorialTrendReport.upsert as any).mock.calls.map((c: any) => c[0].where.slug);
    expect(calledSlugs.sort()).toEqual([...SLUGS].sort());
    // The caller-supplied editionMonth/slug must be completely ignored.
    for (const call of (prisma.editorialTrendReport.upsert as any).mock.calls) {
      expect(call[0].create.editionMonth).toBe("2030-01");
      expect(call[0].create.editionMonth).not.toBe("2026-06");
    }
    expect(json.editionMonth).toBe("2030-01");
  });

  it("S704 — both rows are status DRAFT (invisible to the standard published query) and clearly marked as QA-only in title/summary", async () => {
    (prisma.editorialTrendReport.upsert as any).mockImplementation(({ create }: any) =>
      Promise.resolve({ id: `fixture_${create.slug}`, slug: create.slug }),
    );
    await action(makeActionRequest({ _action: "createDuplicateMonthTrendEditFixture" }) as any);

    for (const call of (prisma.editorialTrendReport.upsert as any).mock.calls) {
      // DRAFT, not PUBLISHED: getPublishedEditorialReports() only ever
      // selects status: PUBLISHED, so this is what keeps the fixture rows
      // off /trends, /trends/:slug and every real customer's page by
      // construction — not by convention. See
      // getPublishedEditorialReportsForQaPreview in
      // editorial-reports.server.ts for the one gated exception.
      expect(call[0].create.status).toBe("DRAFT");
      expect(call[0].create.title).toMatch(/^\[QA TEST\]/);
      expect(call[0].create.summary).toMatch(/QA fixture/i);
    }
  });

  it("S705 — is idempotent: calling create twice never produces more than 2 rows (upsert, not create)", async () => {
    (prisma.editorialTrendReport.upsert as any).mockImplementation(({ create }: any) =>
      Promise.resolve({ id: `fixture_${create.slug}`, slug: create.slug }),
    );
    await action(makeActionRequest({ _action: "createDuplicateMonthTrendEditFixture" }) as any);
    await action(makeActionRequest({ _action: "createDuplicateMonthTrendEditFixture" }) as any);

    expect(prisma.editorialTrendReport.upsert).toHaveBeenCalledTimes(4); // 2 calls x 2 rows, all upserts
    for (const call of (prisma.editorialTrendReport.upsert as any).mock.calls) {
      expect(call[0]).toHaveProperty("where");
      expect(call[0]).toHaveProperty("update"); // never a bare create-only call
    }
  });

  it("S706 — delete action removes exactly the 2 fixture slugs, nothing else, gated the same way", async () => {
    (prisma.editorialTrendReport.deleteMany as any).mockResolvedValue({ count: 2 });
    const resp = await action(makeActionRequest({ _action: "deleteDuplicateMonthTrendEditFixture" }) as any);
    const json = await resp.json();

    expect(resp.status).toBe(200);
    expect(json.deletedCount).toBe(2);
    expect(prisma.editorialTrendReport.deleteMany).toHaveBeenCalledWith({ where: { slug: { in: SLUGS } } });
  });

  it("S707 — delete also refuses when TREND_EDIT_FIXTURE_ENABLED is unset", async () => {
    delete process.env.TREND_EDIT_FIXTURE_ENABLED;
    const resp = await action(makeActionRequest({ _action: "deleteDuplicateMonthTrendEditFixture" }) as any);
    expect(resp.status).toBe(403);
    expect(prisma.editorialTrendReport.deleteMany).not.toHaveBeenCalled();
  });

  it("S708 — refused in production regardless of the fixture flag (inherits the file's own staging-only gate)", async () => {
    process.env.NAIA_PROJECT_VARIANT = "production";
    const resp = await action(makeActionRequest({ _action: "createDuplicateMonthTrendEditFixture" }) as any);
    expect(resp.status).toBe(404);
    expect(prisma.editorialTrendReport.upsert).not.toHaveBeenCalled();
  });
});
