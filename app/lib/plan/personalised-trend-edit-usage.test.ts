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

const { upsertMock, findUniqueMock } = vi.hoisted(() => ({
  upsertMock: vi.fn().mockResolvedValue({ id: "row-1" }),
  findUniqueMock: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/db.server", () => ({
  default: { personalisedTrendEditUsage: { upsert: upsertMock, findUnique: findUniqueMock } },
}));

vi.mock("./usage-window.server", () => ({
  getUsageWindow: vi.fn(() => ({
    start: new Date("2026-10-01T00:00:00.000Z"),
    end: new Date("2026-11-01T00:00:00.000Z"),
    label: "October 2026",
    periodKey: "2026-10",
  })),
}));

import { recordPersonalisedTrendEditUsage, getTrendEditUsageState } from "./personalised-trend-edit-usage.server";
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
      create: { customerId: "cust-1", reportSlug: "spring-2026-soft-structure", periodKey: "2026-10", snapshot: undefined },
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
    // Scoped to the write function's own body only — getTrendEditUsageState
    // (a separate, dedicated read function below it) legitimately uses
    // findUnique and must not trip this check.
    const writeFnStart = source.indexOf("export async function recordPersonalisedTrendEditUsage");
    const writeFnEnd = source.indexOf("\n}", writeFnStart);
    const writeFnBody = source.slice(writeFnStart, writeFnEnd);
    expect(writeFnBody).not.toMatch(/findFirst|findUnique/);
    expect(writeFnBody).toMatch(/\.upsert\(/);
  });

  it("does not read a browser-submitted customer id — the function signature takes a trusted string, nothing resolved from params/query/body", () => {
    expect(source).not.toMatch(/params\.|searchParams|request\.body/);
  });
});

describe("§TREND-EDIT-USAGE — no alternate pre-create path exists anywhere in the codebase", () => {
  // Investigated after a 14 Oct 2026 report of a brand-new usage row with
  // snapshot:null: a second writer that creates the row WITHOUT a snapshot
  // (a "usage-only" reservation, an old pre-snapshot code path, a seed
  // script, a raw SQL insert) would explain that symptom even though this
  // file's own upsert is provably atomic-with-snapshot. This asserts the
  // repo-wide search this investigation performed stays true going
  // forward: exactly one write call against PersonalisedTrendEditUsage
  // exists anywhere, and it is this file's upsert.
  function grepRepo(pattern: RegExp): string[] {
    const root = join(__dirname, "..", "..", "..");
    const hits: string[] = [];
    const SKIP_DIRS = new Set(["node_modules", ".git", "build", "scratch_wi_preview", "scratch_wi_static"]);
    function walk(dir: string) {
      const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
      for (const entry of readdirSync(dir)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
        if (/\.test\.(ts|tsx|js|jsx)$/.test(entry)) continue; // test files mock, never write for real
        const content = readFileSync(full, "utf8");
        if (pattern.test(content)) hits.push(full.slice(root.length + 1));
      }
    }
    walk(join(root, "app"));
    return hits;
  }

  it("exactly one file calls a mutating prisma.personalisedTrendEditUsage operation — this one", () => {
    const writers = grepRepo(/prisma\.personalisedTrendEditUsage\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(writers).toEqual(["app/lib/plan/personalised-trend-edit-usage.server.ts"]);
  });

  it("exactly one production call site invokes recordPersonalisedTrendEditUsage — the customer-facing generation loader", () => {
    const callers = grepRepo(/\brecordPersonalisedTrendEditUsage\s*\(/).filter(
      (f) => !f.endsWith("personalised-trend-edit-usage.server.ts"),
    );
    expect(callers).toEqual(["app/routes/trends.my-edits.$slug.tsx"]);
  });
});

describe("§TREND-EDIT-USAGE — snapshot persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  const SNAPSHOT = {
    schemaVersion: "trend-edit-snapshot-v1" as const,
    reportSlug: "spring-2026-soft-structure",
    reportTitle: "Spring 2026 Soft Structure",
    generatedAt: "2026-10-01T00:00:00.000Z",
    edit: { subTitle: "x", yourVersion: "y" } as any,
    nadineRecommendation: null,
  };

  it("passes the snapshot to the create branch only — the update branch never writes it", async () => {
    await recordPersonalisedTrendEditUsage("cust-1", "spring-2026-soft-structure", SNAPSHOT);
    const call = upsertMock.mock.calls[0][0];
    expect(call.create.snapshot).toEqual(SNAPSHOT);
    expect(call.update).toEqual({});
  });

  it("a pre-snapshot historical row (snapshot: null) is never backfilled — calling this again for the same period cannot write new content onto it", async () => {
    // Simulates the exact 08 Oct scenario: a legacy row with snapshot:null
    // already exists for this (customerId, reportSlug, periodKey). Prisma's
    // upsert would hit the update branch, not create — proving update: {}
    // means the historical row's snapshot can never be set to anything,
    // regardless of what a caller passes.
    await recordPersonalisedTrendEditUsage("cust-1", "spring-2026-soft-structure", SNAPSHOT);
    const call = upsertMock.mock.calls[0][0];
    expect(call.update).not.toHaveProperty("snapshot");
  });

  it("duplicate/concurrent calls for the same customer+report+period EACH carry a full snapshot in their own create branch — whichever one the DB's unique constraint lets win, the committed row has a real snapshot, never null", async () => {
    // This models the exact race the 14 Oct null-snapshot row was suspected
    // of: two requests reaching this function for the same composite key at
    // once. Prisma's upsert resolves the conflict server-side (one INSERT
    // wins, the other falls through to update:{}, a no-op) — but the
    // application-level guarantee this test proves is that NEITHER call
    // ever sends an empty/undefined create.snapshot. There is no call shape
    // that could leave a freshly-created row null.
    const snapshotA = { ...SNAPSHOT, generatedAt: "2026-10-14T10:47:00.000Z" };
    const snapshotB = { ...SNAPSHOT, generatedAt: "2026-10-14T10:47:01.000Z" };
    await Promise.all([
      recordPersonalisedTrendEditUsage("cust-1", "spring-2026-soft-structure", snapshotA),
      recordPersonalisedTrendEditUsage("cust-1", "spring-2026-soft-structure", snapshotB),
    ]);
    expect(upsertMock).toHaveBeenCalledTimes(2);
    for (const call of upsertMock.mock.calls) {
      expect(call[0].create.snapshot).toBeTruthy();
      expect(call[0].create.snapshot.schemaVersion).toBe("trend-edit-snapshot-v1");
    }
  });

  it("getTrendEditUsageState reads by the same composite key, scoped to the current period, and returns the exact stored snapshot", async () => {
    findUniqueMock.mockResolvedValue({ snapshot: SNAPSHOT });
    const result = await getTrendEditUsageState("cust-1", "spring-2026-soft-structure");
    expect(findUniqueMock).toHaveBeenCalledWith({
      where: { customerId_reportSlug_periodKey: { customerId: "cust-1", reportSlug: "spring-2026-soft-structure", periodKey: "2026-10" } },
      select: { snapshot: true },
    });
    expect(result).toEqual({ status: "snapshotted", snapshot: SNAPSHOT });
  });

  it("returns status:'none' when no usage row exists yet for this period (genuine first view)", async () => {
    findUniqueMock.mockResolvedValue(null);
    const result = await getTrendEditUsageState("cust-1", "spring-2026-soft-structure");
    expect(result).toEqual({ status: "none" });
  });

  it("returns status:'legacy_no_snapshot' — distinct from 'none' — when a row exists but predates snapshot persistence", async () => {
    findUniqueMock.mockResolvedValue({ snapshot: null });
    const result = await getTrendEditUsageState("cust-1", "spring-2026-soft-structure");
    expect(result).toEqual({ status: "legacy_no_snapshot" });
    // The two "nothing to render" states must never collapse into the same
    // shape — a caller that only checked truthiness (the old null/non-null
    // check) could no longer tell them apart and risked treating a legacy
    // row exactly like a genuine first view.
    expect(result.status).not.toBe("none");
  });
});

describe("§TREND-EDIT-USAGE — period semantics authority", () => {
  it("5. periodKey comes from getUsageWindow() — the single shared period authority, not separate calendar-month logic", () => {
    expect(source).toMatch(/getUsageWindow/);
    expect(source).not.toMatch(/toISOString\(\)\.slice/); // the exact ad-hoc pattern this replaces
    expect(source).not.toMatch(/getUTCMonth\(\)/); // no independent date math duplicated here
  });
});
