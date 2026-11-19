// app/lib/editorial-reports-content-ids.test.ts
//
// Coverage for ensureContentIds, createEditorialReport/updateEditorialReport
// (id-minting on write) and backfillContentIds — the fix for the stability
// gap where an admin text edit silently orphaned an existing SavedItem /
// TrendContentFeedback row (see saved-items-resolve.ts's findEntry and
// saved-items.server.ts's loadReportSaveState for the read-side half of the
// fix).
//
// Prisma is mocked throughout — backfillContentIds in particular must NEVER
// run against a real database; this file proves its logic only against
// in-memory/mocked data, per this module's own header comment.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { create, update, findMany } = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: { editorialTrendReport: { create, update, findMany } },
}));

import {
  ensureContentIds,
  createEditorialReport,
  updateEditorialReport,
  backfillContentIds,
} from "./editorial-reports.server";

beforeEach(() => {
  vi.clearAllMocks();
});

const BASE_REPORT_INPUT = {
  slug: "test-report",
  title: "Test Report",
  season: "Spring 2026",
  status: "PUBLISHED" as const,
  publishedAt: "2026-06-30",
  order: 1,
  featured: false,
  summary: "s",
  editorialIntro: "i",
  howToWear: [],
  sources: [],
  spendSaveSkip: {},
};

describe("ensureContentIds", () => {
  it("a fresh entry with no id gets exactly one newly-minted, non-empty, unique id", () => {
    const result = ensureContentIds([{ name: "A" }, { name: "B" }]) as Array<{ id: string; name: string }>;
    expect(result).toHaveLength(2);
    expect(result[0].id).toBeTypeOf("string");
    expect(result[0].id.length).toBeGreaterThan(0);
    expect(result[1].id).toBeTypeOf("string");
    expect(result[0].id).not.toBe(result[1].id);
  });

  it("an entry that already has an id keeps that EXACT value, byte for byte, never regenerated", () => {
    const result = ensureContentIds([{ id: "fixed-id-123", name: "A" }]) as Array<{ id: string }>;
    expect(result[0].id).toBe("fixed-id-123");
  });

  it("a mix of id-bearing and id-less entries only mints for the ones missing an id", () => {
    const input = [{ id: "keep-me", name: "A" }, { name: "B" }];
    const result = ensureContentIds(input) as Array<{ id: string; name: string }>;
    expect(result[0].id).toBe("keep-me");
    expect(result[1].id).toBeTypeOf("string");
    expect(result[1].id).not.toBe("keep-me");
  });

  it("does not mutate the input array or its objects", () => {
    const input = [{ name: "A" }];
    const result = ensureContentIds(input) as Array<{ id: string }>;
    expect(input[0]).not.toHaveProperty("id");
    expect(result).not.toBe(input);
  });

  it.each([
    ["not an array (object)", { name: "A" }],
    ["not an array (string)", "oops"],
    [null, null],
    [undefined, undefined],
  ])("malformed input %s passes through unchanged without throwing", (_label, input) => {
    expect(() => ensureContentIds(input)).not.toThrow();
    expect(ensureContentIds(input)).toEqual(input);
  });

  it("an array containing non-object entries passes those entries through unchanged", () => {
    const input = ["a string entry", 42, null, { name: "real entry" }];
    const result = ensureContentIds(input) as unknown[];
    expect(result[0]).toBe("a string entry");
    expect(result[1]).toBe(42);
    expect(result[2]).toBe(null);
    expect((result[3] as { id: string }).id).toBeTypeOf("string");
  });

  it("treats a blank-string id as missing and mints a real one", () => {
    const result = ensureContentIds([{ id: "   ", name: "A" }]) as Array<{ id: string }>;
    expect(result[0].id.trim()).not.toBe("");
  });
});

describe("createEditorialReport — mints ids on write", () => {
  it("new content with no ids gets ids minted across all four JSON fields before the DB write", async () => {
    create.mockResolvedValueOnce({ id: "row-1" });

    await createEditorialReport({
      ...BASE_REPORT_INPUT,
      keyTrends: [{ name: "Trend A", description: "d" }],
      rising: [{ signal: "Rising A", why: "w", source: "s" }],
      fading: [{ signal: "Fading A", why: "w", source: "s" }],
      referencesBehindThisEdit: [{ brand: "Brand A", signal: "s", naiaRead: "r" }],
    });

    expect(create).toHaveBeenCalledTimes(1);
    const written = create.mock.calls[0][0].data;
    for (const field of ["keyTrends", "rising", "fading", "referencesBehindThisEdit"] as const) {
      expect(written[field]).toHaveLength(1);
      expect(written[field][0].id).toBeTypeOf("string");
      expect(written[field][0].id.length).toBeGreaterThan(0);
    }
  });
});

describe("updateEditorialReport — preserves existing ids verbatim", () => {
  it("updating content that already carries ids keeps them exactly, and still mints for anything new", async () => {
    update.mockResolvedValueOnce({ id: "row-1" });

    await updateEditorialReport("row-1", {
      ...BASE_REPORT_INPUT,
      keyTrends: [{ id: "trend-id-1", name: "Trend A — retitled", description: "d" }],
      rising: [{ signal: "Rising A", why: "w", source: "s" }], // no id: this is the edit-mints-id case
      fading: [],
      referencesBehindThisEdit: [],
    });

    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][0].data;
    expect(written.keyTrends[0].id).toBe("trend-id-1");
    expect(written.rising[0].id).toBeTypeOf("string");
  });
});

describe("backfillContentIds — idempotent, never auto-run", () => {
  it("mints ids for every report missing them and writes back only those reports", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "report-1",
        keyTrends: [{ name: "A" }],
        rising: [],
        fading: [],
        referencesBehindThisEdit: [],
      },
      {
        id: "report-2",
        keyTrends: [{ id: "already-has-id", name: "B" }],
        rising: [],
        fading: [],
        referencesBehindThisEdit: [],
      },
    ]);
    update.mockResolvedValueOnce({ id: "report-1" });

    const result = await backfillContentIds();

    expect(result).toEqual({ scanned: 2, updated: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "report-1" } }),
    );
  });

  it("is a no-op (no writes) when every report already has ids everywhere — safe to re-run", async () => {
    findMany.mockResolvedValueOnce([
      {
        id: "report-1",
        keyTrends: [{ id: "id-1", name: "A" }],
        rising: [{ id: "id-2", signal: "S" }],
        fading: [],
        referencesBehindThisEdit: [],
      },
    ]);

    const result = await backfillContentIds();

    expect(result).toEqual({ scanned: 1, updated: 0 });
    expect(update).not.toHaveBeenCalled();
  });
});
