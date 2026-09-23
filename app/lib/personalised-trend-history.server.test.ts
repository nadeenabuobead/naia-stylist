// app/lib/personalised-trend-history.server.test.ts
//
// Persistence behaviour: idempotency, unlock semantics, ownership isolation and
// the failure boundary. Prisma is faked with an in-memory store that enforces
// the same unique constraints the migration declares.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake Prisma ───────────────────────────────────────────────────────────────

interface SnapRow {
  id: string; customerId: string; reportId: string; reportSlug: string;
  reportTitle: string; reportSeason: string; engineVersion: string;
  snapshotHash: string; edit: unknown; evidenceSummary: unknown; createdAt: Date;
}
interface UnlockRow {
  id: string; customerId: string; reportId: string; reportSlug: string;
  grantedAt: Date; grantedPeriod: string;
}

const db = { snapshots: [] as SnapRow[], unlocks: [] as UnlockRow[], failSnapshotWrite: false, failUnlockWrite: false };
let seq = 0;

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

vi.mock("../db.server", () => ({
  default: {
    personalisedTrendEdit: {
      findUnique: vi.fn(async ({ where }: never) => {
        const w = (where as Record<string, never>).customerId_reportId_snapshotHash as unknown as
          { customerId: string; reportId: string; snapshotHash: string };
        return db.snapshots.find((s) => s.customerId === w.customerId && s.reportId === w.reportId && s.snapshotHash === w.snapshotHash) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { id: string; customerId: string };
        return db.snapshots.find((s) => s.id === w.id && s.customerId === w.customerId) ?? null;
      }),
      findMany: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { customerId: string };
        return db.snapshots
          .filter((s) => s.customerId === w.customerId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
      create: vi.fn(async ({ data }: never) => {
        if (db.failSnapshotWrite) throw new Error("connection lost");
        const d = data as unknown as Omit<SnapRow, "id" | "createdAt">;
        if (db.snapshots.some((s) => s.customerId === d.customerId && s.reportId === d.reportId && s.snapshotHash === d.snapshotHash)) {
          throw uniqueViolation();
        }
        const row: SnapRow = { ...d, id: `snap_${++seq}`, createdAt: new Date(2026, 8, seq) };
        db.snapshots.push(row);
        return row;
      }),
    },
    personalisedTrendEditUnlock: {
      findUnique: vi.fn(async ({ where }: never) => {
        const w = (where as Record<string, never>).customerId_reportId as unknown as { customerId: string; reportId: string };
        return db.unlocks.find((u) => u.customerId === w.customerId && u.reportId === w.reportId) ?? null;
      }),
      create: vi.fn(async ({ data }: never) => {
        if (db.failUnlockWrite) throw new Error("connection lost");
        const d = data as unknown as Omit<UnlockRow, "id" | "grantedAt">;
        if (db.unlocks.some((u) => u.customerId === d.customerId && u.reportId === d.reportId)) throw uniqueViolation();
        const row: UnlockRow = { ...d, id: `unlock_${++seq}`, grantedAt: new Date() };
        db.unlocks.push(row);
        return row;
      }),
      count: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { customerId: string; grantedAt: { gte: Date; lt: Date } };
        return db.unlocks.filter((u) => u.customerId === w.customerId && u.grantedAt >= w.grantedAt.gte && u.grantedAt < w.grantedAt.lt).length;
      }),
    },
  },
}));

import {
  recordEditSnapshot,
  loadSnapshot,
  loadHistoryCards,
  countUnlocksThisWindow,
} from "./personalised-trend-history.server";
import type { ShopperEdit } from "./trend-evidence.server";

const REPORT_A = { reportId: "rep_autumn", reportSlug: "autumn-edit", reportTitle: "Autumn Edit", reportSeason: "September 2026" };
const REPORT_B = { reportId: "rep_spring", reportSlug: "spring-edit", reportTitle: "Spring Edit", reportSeason: "March 2026" };

const edit = (o: Partial<ShopperEdit> = {}) => ({
  subTitle: "S", yourVersion: "v", evidenceStyleDna: null, evidencePassportSays: null,
  evidenceClosetItems: [], evidenceReviews: null, lowDataNotice: null,
  yourBestRouteIn: "r", aLookToTry: "look", theBalanceToProtect: "b",
  partToTake: ["A"], worthInvestingStatement: null, coveredClosetCategories: [], partToLeave: ["C"],
  ...o,
}) as ShopperEdit;

const record = (customerId: string, report = REPORT_A, e = edit()) =>
  recordEditSnapshot({ customerId, ...report, edit: e });

beforeEach(() => {
  db.snapshots = []; db.unlocks = []; db.failSnapshotWrite = false; db.failUnlockWrite = false;
  seq = 0;
  vi.clearAllMocks();
});

// ── §PS-1 snapshots ───────────────────────────────────────────────────────────

describe("§PS-1 snapshot persistence", () => {
  it("first generated edit → one snapshot", async () => {
    const r = await record("cust-1");
    expect(r.snapshotCreated).toBe(true);
    expect(db.snapshots).toHaveLength(1);
  });

  it("refresh with identical output → still one snapshot", async () => {
    await record("cust-1");
    const second = await record("cust-1");
    expect(second.snapshotCreated).toBe(false);
    expect(db.snapshots).toHaveLength(1);
  });

  it("ten refreshes → still one snapshot", async () => {
    for (let i = 0; i < 10; i++) await record("cust-1");
    expect(db.snapshots).toHaveLength(1);
  });

  it("changed personalised output → a second IMMUTABLE snapshot", async () => {
    await record("cust-1");
    const original = { ...db.snapshots[0] };
    await record("cust-1", REPORT_A, edit({ aLookToTry: "A different look entirely." }));
    expect(db.snapshots).toHaveLength(2);
    // The first row is untouched — never updated in place.
    expect(db.snapshots[0]).toEqual(original);
  });

  it("customers do not share snapshots", async () => {
    await record("cust-1");
    await record("cust-2");
    expect(db.snapshots).toHaveLength(2);
  });

  it("a concurrent identical write is absorbed, not surfaced as an error", async () => {
    await record("cust-1");
    // Simulate the race: the pre-check misses, the insert collides.
    const prisma = (await import("../db.server")).default as never as { personalisedTrendEdit: { findUnique: ReturnType<typeof vi.fn> } };
    prisma.personalisedTrendEdit.findUnique.mockResolvedValueOnce(null);
    const r = await record("cust-1");
    expect(r.snapshotPersisted).toBe(true);
    expect(db.snapshots).toHaveLength(1);
  });
});

// ── §PS-2 unlocks ─────────────────────────────────────────────────────────────

describe("§PS-2 unlock semantics", () => {
  it("first report → unlock created", async () => {
    const r = await record("cust-1");
    expect(r.unlockCreated).toBe(true);
    expect(db.unlocks).toHaveLength(1);
  });

  it("refresh → NO new unlock", async () => {
    await record("cust-1");
    const second = await record("cust-1");
    expect(second.unlockCreated).toBe(false);
    expect(db.unlocks).toHaveLength(1);
  });

  it("another internal snapshot → NO new unlock", async () => {
    await record("cust-1");
    await record("cust-1", REPORT_A, edit({ aLookToTry: "Changed." }));
    expect(db.snapshots).toHaveLength(2);
    expect(db.unlocks).toHaveLength(1);
  });

  it("a different report → a new unlock", async () => {
    await record("cust-1", REPORT_A);
    await record("cust-1", REPORT_B);
    expect(db.unlocks).toHaveLength(2);
  });

  it("stamps the window it was granted in", async () => {
    await record("cust-1");
    expect(db.unlocks[0].grantedPeriod).toMatch(/^[A-Z][a-z]+ \d{4}$/);
  });

  it("a concurrent first-open grants exactly one unlock", async () => {
    await record("cust-1");
    const prisma = (await import("../db.server")).default as never as { personalisedTrendEditUnlock: { findUnique: ReturnType<typeof vi.fn> } };
    prisma.personalisedTrendEditUnlock.findUnique.mockResolvedValueOnce(null);
    const r = await record("cust-1");
    expect(r.unlockCreated).toBe(false);
    expect(db.unlocks).toHaveLength(1);
  });
});

// ── §PS-3 replay + isolation ─────────────────────────────────────────────────

describe("§PS-3 historical replay", () => {
  it("returns the stored copy exactly", async () => {
    await record("cust-1", REPORT_A, edit({ aLookToTry: "The original wording." }));
    const snapshot = await loadSnapshot("cust-1", db.snapshots[0].id);
    expect(snapshot?.edit.aLookToTry).toBe("The original wording.");
  });

  it("an older snapshot still returns ITS wording, not the newer one", async () => {
    await record("cust-1", REPORT_A, edit({ aLookToTry: "September wording." }));
    const oldId = db.snapshots[0].id;
    await record("cust-1", REPORT_A, edit({ aLookToTry: "Rewritten in October." }));
    const snapshot = await loadSnapshot("cust-1", oldId);
    expect(snapshot?.edit.aLookToTry).toBe("September wording.");
  });

  it("customer A CANNOT open customer B's snapshot", async () => {
    await record("cust-b");
    const stolen = await loadSnapshot("cust-a", db.snapshots[0].id);
    expect(stolen).toBeNull();
  });

  it("an unknown snapshot id resolves to null", async () => {
    expect(await loadSnapshot("cust-1", "snap_nope")).toBeNull();
  });

  it("reading history creates neither a snapshot nor an unlock", async () => {
    await record("cust-1");
    const snapshotsBefore = db.snapshots.length;
    const unlocksBefore = db.unlocks.length;
    await loadSnapshot("cust-1", db.snapshots[0].id);
    await loadHistoryCards("cust-1");
    expect(db.snapshots).toHaveLength(snapshotsBefore);
    expect(db.unlocks).toHaveLength(unlocksBefore);
  });
});

// ── §PS-4 history cards ───────────────────────────────────────────────────────

describe("§PS-4 history cards", () => {
  it("three versions of one report → ONE card", async () => {
    await record("cust-1", REPORT_A, edit({ aLookToTry: "v1" }));
    await record("cust-1", REPORT_A, edit({ aLookToTry: "v2" }));
    await record("cust-1", REPORT_A, edit({ aLookToTry: "v3" }));
    const cards = await loadHistoryCards("cust-1");
    expect(cards).toHaveLength(1);
    expect(cards[0].versionCount).toBe(3);
    expect(cards[0].snapshotId).toBe(db.snapshots[2].id);
  });

  it("two reports → two cards", async () => {
    await record("cust-1", REPORT_A);
    await record("cust-1", REPORT_B);
    expect(await loadHistoryCards("cust-1")).toHaveLength(2);
  });

  it("shows only this customer's history", async () => {
    await record("cust-1", REPORT_A);
    await record("cust-2", REPORT_B);
    const cards = await loadHistoryCards("cust-1");
    expect(cards).toHaveLength(1);
    expect(cards[0].reportSlug).toBe("autumn-edit");
  });
});

// ── §PS-5 usage ───────────────────────────────────────────────────────────────

describe("§PS-5 monthlyUsed counts unlocks", () => {
  it("counts unlocks granted in the current window", async () => {
    await record("cust-1", REPORT_A);
    await record("cust-1", REPORT_B);
    expect(await countUnlocksThisWindow("cust-1")).toBe(2);
  });

  it("EXCLUDES an unlock granted in an earlier window", async () => {
    await record("cust-1", REPORT_A);
    db.unlocks[0].grantedAt = new Date("2026-01-15T00:00:00.000Z");
    expect(await countUnlocksThisWindow("cust-1")).toBe(0);
  });

  it("snapshot count does not affect usage", async () => {
    await record("cust-1", REPORT_A, edit({ aLookToTry: "v1" }));
    await record("cust-1", REPORT_A, edit({ aLookToTry: "v2" }));
    await record("cust-1", REPORT_A, edit({ aLookToTry: "v3" }));
    expect(db.snapshots).toHaveLength(3);
    expect(await countUnlocksThisWindow("cust-1")).toBe(1);
  });

  it("is scoped per customer", async () => {
    await record("cust-1", REPORT_A);
    await record("cust-2", REPORT_B);
    expect(await countUnlocksThisWindow("cust-1")).toBe(1);
  });
});

// ── §PS-6 the failure boundary ───────────────────────────────────────────────

describe("§PS-6 failure boundary", () => {
  it("a failed snapshot write does not pretend history was saved", async () => {
    db.failSnapshotWrite = true;
    const r = await record("cust-1");
    expect(r.snapshotPersisted).toBe(false);
    expect(r.snapshotCreated).toBe(false);
    expect(db.snapshots).toHaveLength(0);
  });

  it("a failed snapshot write does not corrupt or block the unlock", async () => {
    db.failSnapshotWrite = true;
    const r = await record("cust-1");
    expect(r.unlockPersisted).toBe(true);
    expect(db.unlocks).toHaveLength(1);
  });

  it("the snapshot lands on the next successful load", async () => {
    db.failSnapshotWrite = true;
    await record("cust-1");
    db.failSnapshotWrite = false;
    const r = await record("cust-1");
    expect(r.snapshotCreated).toBe(true);
    expect(db.unlocks).toHaveLength(1);   // still exactly one — no double grant
  });

  it("a failed unlock write does not block history", async () => {
    db.failUnlockWrite = true;
    const r = await record("cust-1");
    expect(r.unlockPersisted).toBe(false);
    expect(r.snapshotPersisted).toBe(true);
    expect(db.snapshots).toHaveLength(1);
  });

  it("neither failure throws — the page still renders", async () => {
    db.failSnapshotWrite = true;
    db.failUnlockWrite = true;
    await expect(record("cust-1")).resolves.toBeDefined();
  });
});
