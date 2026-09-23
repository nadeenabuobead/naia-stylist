// scripts/backfill-trend-content-ids.test.mts
//
// The identity backfill must never quietly destroy a facet.
//
// applyContentIdentity() validates and REWRITES facets, and --apply writes the
// whole rewritten entry back. So an invalid value is not a cosmetic warning:
// applying would strip it from the stored row, and the facet backfill could not
// restore it because its manifest is built from the static source and knows
// nothing about values authored directly into the database.
//
// These tests hold the line at: reported in the dry run, refused on apply,
// and — the one that actually matters — zero writes.

import { describe, it, expect, vi } from "vitest";
import { planBackfill, runBackfill } from "./backfill-trend-content-ids.mts";

/** A report whose single trend carries one good facet value and one bad one. */
function reportWithBadFacet() {
  return {
    id: "rep_bad",
    slug: "test-bad-facet",
    title: "Test",
    season: "Spring 2026",
    keyTrends: [
      {
        name: "Softened tailoring",
        description: "x",
        facets: { category: ["OUTERWEAR"], silhouette: ["NOT_A_REAL_SILHOUETTE"] },
      },
    ],
    rising: [],
    fading: [],
    referencesBehindThisEdit: [],
  } as never;
}

/** The same report with every facet value in vocabulary. */
function cleanReport() {
  return {
    id: "rep_ok",
    slug: "test-clean",
    title: "Test",
    season: "Spring 2026",
    keyTrends: [
      { name: "Softened tailoring", description: "x", facets: { category: ["OUTERWEAR"] } },
    ],
    rising: [],
    fading: [],
    referencesBehindThisEdit: [],
  } as never;
}

const silence = () => vi.spyOn(console, "log").mockImplementation(() => {});

describe("identity backfill — rejected facets are fatal", () => {
  it("DRY RUN reports the rejected facet value, with its kind and value", async () => {
    silence();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.join(" ")); });

    const write = vi.fn();
    await runBackfill([reportWithBadFacet()], { apply: false, write });

    const text = errors.join("\n");
    expect(text).toContain("silhouette");
    expect(text).toContain("NOT_A_REAL_SILHOUETTE");
    vi.restoreAllMocks();
  });

  it("--apply REFUSES, and says why", async () => {
    silence();
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...a) => { errors.push(a.join(" ")); });

    const write = vi.fn();
    const result = await runBackfill([reportWithBadFacet()], { apply: true, write });

    expect(result.refusal).toMatch(/rejected facet value/);
    expect(errors.join("\n")).toContain("Refusing to apply");
    vi.restoreAllMocks();
  });

  it("NO report JSON is written when a rejection exists", async () => {
    silence();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const write = vi.fn();
    const result = await runBackfill([reportWithBadFacet()], { apply: true, write });

    expect(write).not.toHaveBeenCalled();
    expect(result.written).toBe(0);
    vi.restoreAllMocks();
  });

  it("one bad facet blocks the WHOLE run, including the clean reports beside it", async () => {
    // Partial application would leave the database in a state no dry run had
    // ever described.
    silence();
    vi.spyOn(console, "error").mockImplementation(() => {});

    const write = vi.fn();
    await runBackfill([cleanReport(), reportWithBadFacet()], { apply: true, write });

    expect(write).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("a clean run still writes — the guard is not blanket", async () => {
    silence();
    const write = vi.fn().mockResolvedValue({});
    const result = await runBackfill([cleanReport()], { apply: true, write });

    expect(result.refusal).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
    expect(result.written).toBe(1);
    vi.restoreAllMocks();
  });

  it("a clean DRY RUN writes nothing either", async () => {
    silence();
    const write = vi.fn();
    const result = await runBackfill([cleanReport()], { apply: false, write });

    expect(write).not.toHaveBeenCalled();
    expect(result.written).toBe(0);
    vi.restoreAllMocks();
  });

  it("planBackfill surfaces the rejection without performing any I/O", () => {
    silence();
    const plan = planBackfill([reportWithBadFacet()]);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0].kind).toBe("silhouette");
    expect(plan.refusal).not.toBeNull();
    vi.restoreAllMocks();
  });

  it("the refusal precedes identity assignment being trusted — ids are still computed for the report", () => {
    // The dry run must remain useful: you should be able to see what the ids
    // WOULD be while still being refused the write.
    silence();
    const plan = planBackfill([reportWithBadFacet()]);
    expect(plan.assigned.valueOf()).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});
