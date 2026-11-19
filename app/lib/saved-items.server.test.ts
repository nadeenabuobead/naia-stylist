// app/lib/saved-items.server.test.ts
//
// Persistence-layer tests with a mocked Prisma client — idempotency,
// concurrent-save race handling, and that loadReportSaveState derives the
// same itemKey for the same entry text every time (no backfill, no
// recovery, pure re-derivation on every load).

import { describe, it, expect, vi, beforeEach } from "vitest";

const { findUnique, create, deleteMany, findMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../db.server", () => ({
  default: { savedItem: { findUnique, create, deleteMany, findMany } },
}));

import { saveItem, unsaveItem, loadReportSaveState } from "./saved-items.server";

const REQUEST = {
  contentType: "TREND" as const,
  contentKey: "softened-tailoring",
  reportSlug: "spring-2026-soft-structure",
  label: "Softened Tailoring",
  sourceKind: "TREND_REPORT" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveItem — idempotent", () => {
  it("a repeat save of an existing row is a no-op: created:false, no second insert", async () => {
    findUnique.mockResolvedValueOnce({ id: "row-1" });

    const result = await saveItem("customer-A", REQUEST);

    expect(result).toEqual({ created: false, itemKey: "TREND:spring-2026-soft-structure:softened-tailoring", itemId: "row-1" });
    expect(create).not.toHaveBeenCalled();
  });

  it("a genuinely new save creates the row with the itemKey built from the request", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValueOnce({ id: "row-2" });

    const result = await saveItem("customer-A", REQUEST);

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "customer-A",
          itemKey: "TREND:spring-2026-soft-structure:softened-tailoring",
        }),
      }),
    );
  });

  it("a concurrent double-save (unique violation, P2002) is treated as already-saved, not an error", async () => {
    findUnique.mockResolvedValueOnce(null);
    create.mockRejectedValueOnce({ code: "P2002" });

    const result = await saveItem("customer-A", REQUEST);

    expect(result.created).toBe(false);
  });

  it("re-encountering the same object does not overwrite — the update branch is intentionally absent", async () => {
    findUnique.mockResolvedValueOnce({ id: "row-1" });
    await saveItem("customer-A", { ...REQUEST, sourceReportTitle: "A different report" });
    // No update call exists at all on this module — only create and
    // findUnique are ever invoked for a save.
    expect(create).not.toHaveBeenCalled();
  });
});

describe("unsaveItem — customer-scoped, idempotent", () => {
  it("unsaving something never saved is a no-op", async () => {
    findUnique.mockResolvedValueOnce(null);

    const result = await unsaveItem("customer-A", "TREND:spring-2026-soft-structure:softened-tailoring");

    expect(result).toBeNull();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("deletes scoped to BOTH the row id and the customerId — defence in depth", async () => {
    findUnique.mockResolvedValueOnce({ id: "row-1" });

    await unsaveItem("customer-A", "TREND:spring-2026-soft-structure:softened-tailoring");

    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "row-1", customerId: "customer-A" } });
  });
});

describe("loadReportSaveState", () => {
  const report = {
    slug: "spring-2026-soft-structure",
    keyTrends: [{ name: "Softened Tailoring" }],
    rising: [{ signal: "Wide-leg trousers" }],
    fading: [] as Array<{ signal: string }>,
    referencesBehindThisEdit: [{ brand: "Loro Piana", collection: "SS26" }],
  };

  it("an anonymous visitor gets the full itemKeys map but nothing marked saved, and canSave is false", async () => {
    const state = await loadReportSaveState(null, report);

    expect(state.canSave).toBe(false);
    expect(state.saved).toEqual([]);
    expect(state.itemKeys["TREND:softened-tailoring"]).toBe("TREND:spring-2026-soft-structure:softened-tailoring");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("a signed-in customer's saved set is scoped to their own customerId query", async () => {
    findMany.mockResolvedValueOnce([{ itemKey: "TREND:spring-2026-soft-structure:softened-tailoring" }]);

    const state = await loadReportSaveState("customer-A", report);

    expect(state.canSave).toBe(true);
    expect(state.saved).toEqual(["TREND:spring-2026-soft-structure:softened-tailoring"]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ customerId: "customer-A" }) }),
    );
  });

  it("includes PRODUCT (global) and TAKEAWAY (report-scoped) keys only when options name them", async () => {
    findMany.mockResolvedValueOnce([]);

    const state = await loadReportSaveState("customer-A", report, {
      productHandles: ["navy-blazer"],
      takeawaySections: ["yourBestRouteIn"],
    });

    expect(state.itemKeys["PRODUCT:navy-blazer"]).toBe("PRODUCT:navy-blazer");
    expect(state.itemKeys["TAKEAWAY:yourBestRouteIn"]).toBe("TAKEAWAY:spring-2026-soft-structure:yourBestRouteIn");
  });
});
