// app/lib/plan/personalised-trend-edit-usage.test.ts
//
// Personalised Trend Edit usage persistence — the customer entitlement/usage
// source of truth (PersonalisedTrendEditUsage), distinct from the analytics-
// only JourneyEvent. No live DB: prisma is mocked here exactly as every
// other usage-writing path in this codebase has no DB-integration test
// harness — these tests prove the application code's query/write SHAPE is
// correct (relies on the DB unique constraint, never check-then-create),
// which is the part a live DB can't prove any more thoroughly than a mock
// can for a pure upsert call.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { upsertMock } = vi.hoisted(() => ({ upsertMock: vi.fn().mockResolvedValue({ id: "row-1" }) }));

vi.mock("~/db.server", () => ({
  default: { personalisedTrendEditUsage: { upsert: upsertMock } },
}));

vi.mock("./usage-window.server", () => ({
  getUsageWindow: vi.fn(() => ({
    start: new Date("2026-10-01T00:00:00.000Z"),
    end: new Date("2026-11-01T00:00:00.000Z"),
    label: "October 2026",
    periodKey: "2026-10",
  })),
}));

import { recordPersonalisedTrendEditUsage } from "./personalised-trend-edit-usage.server";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "personalised-trend-edit-usage.server.ts"), "utf8");

describe("§TREND-EDIT-USAGE — idempotent create-if-absent write", () => {
  beforeEach(() => vi.clearAllMocks());

  it("1. a genuine completed edit writes exactly one usage row — correct customerId/reportSlug/periodKey", async () => {
    await recordPersonalisedTrendEditUsage("cust-1", "spring-2026-soft-structure");
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith({
      where: { customerId_reportSlug_periodKey: { customerId: "cust-1", reportSlug: "spring-2026-soft-structure", periodKey: "2026-10" } },
      create: { customerId: "cust-1", reportSlug: "spring-2026-soft-structure", periodKey: "2026-10" },
      update: {},
    });
  });

  it("2/3. refresh / repeated completion for the same customer+report+month issues the identical upsert key both times — idempotent, not a second insert", async () => {
    await recordPersonalisedTrendEditUsage("cust-1", "spring-2026-soft-structure");
    await recordPersonalisedTrendEditUsage("cust-1", "spring-2026-soft-structure");

    expect(upsertMock).toHaveBeenCalledTimes(2);
    const call1 = upsertMock.mock.calls[0][0];
    const call2 = upsertMock.mock.calls[1][0];
    expect(call1.where).toEqual(call2.where);
    // "update: {}" on repeat — never a second logical write, just a no-op
    // touch of the same already-existing row.
    expect(call1.update).toEqual({});
    expect(call2.update).toEqual({});
  });

  it("4. a distinct report in the same month produces a distinct upsert key — second, independent usage row", async () => {
    await recordPersonalisedTrendEditUsage("cust-1", "spring-2026-soft-structure");
    await recordPersonalisedTrendEditUsage("cust-1", "modern-tailoring-spring-2026");

    const key1 = upsertMock.mock.calls[0][0].where.customerId_reportSlug_periodKey;
    const key2 = upsertMock.mock.calls[1][0].where.customerId_reportSlug_periodKey;
    expect(key1).not.toEqual(key2);
    expect(key1.reportSlug).toBe("spring-2026-soft-structure");
    expect(key2.reportSlug).toBe("modern-tailoring-spring-2026");
  });

  it("11. customer A's usage key never matches customer B's for the same report and period", async () => {
    await recordPersonalisedTrendEditUsage("cust-A", "spring-2026-soft-structure");
    await recordPersonalisedTrendEditUsage("cust-B", "spring-2026-soft-structure");

    const keyA = upsertMock.mock.calls[0][0].where.customerId_reportSlug_periodKey;
    const keyB = upsertMock.mock.calls[1][0].where.customerId_reportSlug_periodKey;
    expect(keyA.customerId).toBe("cust-A");
    expect(keyB.customerId).toBe("cust-B");
    expect(keyA).not.toEqual(keyB);
  });

  it("9. relies on the database unique constraint, not a check-then-create race — no findFirst/findUnique read precedes the write", () => {
    // A check-then-create pattern would read before writing; this function
    // must contain no such read — the upsert (and the DB's own unique
    // constraint on customerId+reportSlug+periodKey) is the only guard.
    expect(source).not.toMatch(/findFirst|findUnique/);
    expect(source).toMatch(/\.upsert\(/);
  });

  it("does not read a browser-submitted customer id — the function signature takes a trusted string, nothing resolved from params/query/body", () => {
    expect(source).not.toMatch(/params\.|searchParams|request\.body/);
  });
});

describe("§TREND-EDIT-USAGE — period semantics authority", () => {
  it("5. periodKey comes from getUsageWindow() — the single shared period authority, not separate calendar-month logic", () => {
    expect(source).toMatch(/getUsageWindow/);
    expect(source).not.toMatch(/toISOString\(\)\.slice/); // the exact ad-hoc pattern this replaces
    expect(source).not.toMatch(/getUTCMonth\(\)/); // no independent date math duplicated here
  });
});
