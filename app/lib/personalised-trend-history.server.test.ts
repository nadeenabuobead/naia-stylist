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

vi.mock("./cloudinary-admin.server", () => ({
  getCloudinaryConfig: () => ({ cloudName: "test", apiKey: "k", apiSecret: "s" }),
  validatePublicIdOwnership: (publicId: string, customerId: string) => ({ ok: publicId.includes(customerId) }),
  buildPrivateDownloadUrl: (_c: unknown, publicId: string) => `https://signed.test/${publicId}?ts=${Date.now()}`,
}));

interface ClosetRow { id: string; customerId: string; imagePublicId: string | null; imageFormat: string | null }

// vi.mock factories are hoisted above every top-level const, so the store and
// the fake client are created inside vi.hoisted() where the factory can see them.
const { db, fakePrisma, resetSeq } = vi.hoisted(() => {
  const store = {
    snapshots: [] as SnapRow[], unlocks: [] as UnlockRow[], closetItems: [] as ClosetRow[],
    failSnapshotWrite: false, failUnlockWrite: false,
  };
  let counter = 0;
  const uniqueViolation = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = {};
  Object.assign(client, {
    personalisedTrendEdit: {
      findUnique: vi.fn(async ({ where }: never) => {
        const w = (where as Record<string, never>).customerId_reportId_snapshotHash as unknown as
          { customerId: string; reportId: string; snapshotHash: string };
        return store.snapshots.find((s) => s.customerId === w.customerId && s.reportId === w.reportId && s.snapshotHash === w.snapshotHash) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { id: string; customerId: string };
        return store.snapshots.find((s) => s.id === w.id && s.customerId === w.customerId) ?? null;
      }),
      findMany: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { customerId: string };
        return store.snapshots
          .filter((s) => s.customerId === w.customerId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),
      create: vi.fn(async ({ data }: never) => {
        if (store.failSnapshotWrite) throw new Error("connection lost");
        const d = data as unknown as Omit<SnapRow, "id" | "createdAt">;
        if (store.snapshots.some((s) => s.customerId === d.customerId && s.reportId === d.reportId && s.snapshotHash === d.snapshotHash)) {
          throw uniqueViolation();
        }
        const row: SnapRow = { ...d, id: `snap_${++counter}`, createdAt: new Date(2026, 8, counter) };
        store.snapshots.push(row);
        return row;
      }),
    },
    closetItem: {
      findMany: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { id: { in: string[] }; customerId: string };
        return store.closetItems.filter((c) => w.id.in.includes(c.id) && c.customerId === w.customerId);
      }),
    },
    // Interactive transaction with REAL rollback: the store is snapshotted
    // before the callback and restored if it throws.
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = { snapshots: [...store.snapshots], unlocks: [...store.unlocks] };
      try {
        return await fn(client);
      } catch (error) {
        store.snapshots = before.snapshots;
        store.unlocks = before.unlocks;
        throw error;
      }
    }),
    personalisedTrendEditUnlock: {
      findUnique: vi.fn(async ({ where }: never) => {
        const w = (where as Record<string, never>).customerId_reportId as unknown as { customerId: string; reportId: string };
        return store.unlocks.find((u) => u.customerId === w.customerId && u.reportId === w.reportId) ?? null;
      }),
      create: vi.fn(async ({ data }: never) => {
        if (store.failUnlockWrite) throw new Error("connection lost");
        const d = data as unknown as Omit<UnlockRow, "id" | "grantedAt">;
        if (store.unlocks.some((u) => u.customerId === d.customerId && u.reportId === d.reportId)) throw uniqueViolation();
        const row: UnlockRow = { ...d, id: `unlock_${++counter}`, grantedAt: new Date() };
        store.unlocks.push(row);
        return row;
      }),
      count: vi.fn(async ({ where }: never) => {
        const w = where as unknown as { customerId: string; grantedAt: { gte: Date; lt: Date } };
        return store.unlocks.filter((u) => u.customerId === w.customerId && u.grantedAt >= w.grantedAt.gte && u.grantedAt < w.grantedAt.lt).length;
      }),
    },
  });
  return { db: store, fakePrisma: { default: client as Record<string, any> }, resetSeq: () => { counter = 0; } };
});

vi.mock("../db.server", () => fakePrisma);

import {
  recordEditSnapshot,
  resolveSnapshotImages,
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
  db.snapshots = []; db.unlocks = []; db.closetItems = [];
  db.failSnapshotWrite = false; db.failUnlockWrite = false;
  resetSeq();
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

  it("a concurrent duplicate insert is absorbed, not surfaced as an error", async () => {
    await record("cust-1");
    // The race: both requests' pre-checks miss, the second insert collides.
    fakePrisma.default.personalisedTrendEdit.findUnique.mockResolvedValueOnce(null);
    fakePrisma.default.personalisedTrendEditUnlock.findUnique.mockResolvedValueOnce(null);
    await expect(record("cust-1")).resolves.toBeDefined();
    expect(db.snapshots).toHaveLength(1);
    expect(db.unlocks).toHaveLength(1);
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
    fakePrisma.default.personalisedTrendEditUnlock.findUnique.mockResolvedValueOnce(null);
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

// ── §PS-6 FIRST RECEIPT IS ATOMIC ───────────────────────────────────────────
//
// The two states that must be impossible:
//   unlock without snapshot  → allowance consumed, nothing stored
//   snapshot without unlock  → history exists, usage disagrees

describe("§PS-6 atomic first receipt", () => {
  it("writes both rows in ONE transaction", async () => {
    const r = await record("cust-1");
    expect(fakePrisma.default.$transaction).toHaveBeenCalledTimes(1);
    expect(r.snapshotCreated).toBe(true);
    expect(r.unlockCreated).toBe(true);
    expect(db.snapshots).toHaveLength(1);
    expect(db.unlocks).toHaveLength(1);
  });

  it("SNAPSHOT side throws → NEITHER row survives", async () => {
    db.failSnapshotWrite = true;
    const r = await record("cust-1");
    expect(db.snapshots).toHaveLength(0);
    expect(db.unlocks).toHaveLength(0);          // the unlock rolled back with it
    expect(r.snapshotPersisted).toBe(false);
    expect(r.unlockPersisted).toBe(false);
    expect(r.unlockCreated).toBe(false);          // no allowance consumed
  });

  it("UNLOCK side throws → NEITHER row survives", async () => {
    db.failUnlockWrite = true;
    const r = await record("cust-1");
    expect(db.unlocks).toHaveLength(0);
    expect(db.snapshots).toHaveLength(0);
    expect(r.snapshotPersisted).toBe(false);
    expect(r.unlockPersisted).toBe(false);
  });

  it("never reports persisted when nothing was written", async () => {
    db.failSnapshotWrite = true;
    const r = await record("cust-1");
    expect(r).toEqual({
      snapshotCreated: false, unlockCreated: false,
      snapshotPersisted: false, unlockPersisted: false, snapshotId: null,
    });
  });

  it("a failed first receipt leaves the NEXT load able to write both", async () => {
    db.failSnapshotWrite = true;
    await record("cust-1");
    db.failSnapshotWrite = false;

    const r = await record("cust-1");
    expect(r.snapshotCreated).toBe(true);
    expect(r.unlockCreated).toBe(true);
    expect(db.snapshots).toHaveLength(1);
    expect(db.unlocks).toHaveLength(1);
  });

  it("a failure never throws — the route still renders the generated edit", async () => {
    db.failSnapshotWrite = true;
    db.failUnlockWrite = true;
    await expect(record("cust-1")).resolves.toBeDefined();
  });

  it("AFTER first receipt, a new version needs no transaction", async () => {
    await record("cust-1");
    vi.mocked(fakePrisma.default.$transaction).mockClear();

    const r = await record("cust-1", REPORT_A, edit({ aLookToTry: "Changed." }));
    expect(fakePrisma.default.$transaction).not.toHaveBeenCalled();
    expect(r.snapshotCreated).toBe(true);
    expect(r.unlockCreated).toBe(false);
    expect(db.unlocks).toHaveLength(1);
  });

  it("a later snapshot failure cannot revoke an existing unlock", async () => {
    await record("cust-1");
    db.failSnapshotWrite = true;

    const r = await record("cust-1", REPORT_A, edit({ aLookToTry: "Changed." }));
    expect(r.snapshotPersisted).toBe(false);
    expect(db.unlocks).toHaveLength(1);        // untouched
    expect(db.snapshots).toHaveLength(1);      // the original survives
  });

  it("an identical refresh writes nothing and opens no transaction", async () => {
    await record("cust-1");
    vi.mocked(fakePrisma.default.$transaction).mockClear();

    const r = await record("cust-1");
    expect(fakePrisma.default.$transaction).not.toHaveBeenCalled();
    expect(r.snapshotCreated).toBe(false);
    expect(r.unlockCreated).toBe(false);
    expect(r.snapshotPersisted).toBe(true);
    expect(r.unlockPersisted).toBe(true);
  });
});

// ── §PS-7 HISTORICAL MEDIA FIDELITY ─────────────────────────────────────────
//
// The snapshot pins the exact Cloudinary asset the edit displayed. Replacing a
// photo mints a new public id AND hard-deletes the old asset, so replay must
// never fall back to whatever photo the closet row carries today.

describe("§PS-7 historical images", () => {
  const ASSET = "naia-wardrobe/cust-1/blazer-v1";

  const withItem = (over: Partial<{ closetItemId: string; imagePublicId: string | null; imageFormat: string | null }> = {}) =>
    edit({
      evidenceClosetItems: [{
        closetItemId: "ci_1", imagePublicId: ASSET, imageFormat: "jpg",
        name: "Navy Blazer", imageUrl: null, category: "OUTERWEAR", roleNote: "Anchor.",
        ...over,
      }],
    } as Partial<ShopperEdit>);

  it("re-signs the HISTORICAL asset when the piece still carries it", async () => {
    db.closetItems.push({ id: "ci_1", customerId: "cust-1", imagePublicId: ASSET, imageFormat: "jpg" });
    const resolved = await resolveSnapshotImages("cust-1", withItem());
    expect(resolved.evidenceClosetItems[0].imageUrl).toContain(ASSET);
  });

  it("PHOTO REPLACED → no image, never today's different photo", async () => {
    // The row moved on; the asset she saw was deleted with the replacement.
    db.closetItems.push({ id: "ci_1", customerId: "cust-1", imagePublicId: "naia-wardrobe/cust-1/blazer-v2", imageFormat: "jpg" });
    const resolved = await resolveSnapshotImages("cust-1", withItem());
    expect(resolved.evidenceClosetItems[0].imageUrl).toBeNull();
    expect(resolved.evidenceClosetItems[0].name).toBe("Navy Blazer");
  });

  it("never signs an asset the snapshot did not pin", async () => {
    db.closetItems.push({ id: "ci_1", customerId: "cust-1", imagePublicId: "naia-wardrobe/cust-1/blazer-v2", imageFormat: "jpg" });
    const resolved = await resolveSnapshotImages("cust-1", withItem());
    expect(JSON.stringify(resolved)).not.toContain("blazer-v2");
  });

  it("a DELETED piece keeps its label and loses only the image", async () => {
    const resolved = await resolveSnapshotImages("cust-1", withItem({ closetItemId: "ci_gone" }));
    expect(resolved.evidenceClosetItems[0].imageUrl).toBeNull();
    expect(resolved.evidenceClosetItems[0].name).toBe("Navy Blazer");
  });

  it("an older snapshot with no pinned asset renders without an image", async () => {
    db.closetItems.push({ id: "ci_1", customerId: "cust-1", imagePublicId: ASSET, imageFormat: "jpg" });
    const resolved = await resolveSnapshotImages("cust-1", withItem({ imagePublicId: null }));
    expect(resolved.evidenceClosetItems[0].imageUrl).toBeNull();
  });

  it("cannot surface another customer's photograph", async () => {
    db.closetItems.push({ id: "ci_1", customerId: "cust-2", imagePublicId: ASSET, imageFormat: "jpg" });
    const resolved = await resolveSnapshotImages("cust-1", withItem());
    expect(resolved.evidenceClosetItems[0].imageUrl).toBeNull();
  });

  it("refuses an asset that fails the ownership check", async () => {
    const foreign = "naia-wardrobe/someone-else/blazer";
    db.closetItems.push({ id: "ci_1", customerId: "cust-1", imagePublicId: foreign, imageFormat: "jpg" });
    const resolved = await resolveSnapshotImages("cust-1", withItem({ imagePublicId: foreign }));
    expect(resolved.evidenceClosetItems[0].imageUrl).toBeNull();
  });

  it("leaves the personalised copy untouched", async () => {
    db.closetItems.push({ id: "ci_1", customerId: "cust-1", imagePublicId: ASSET, imageFormat: "jpg" });
    const original = withItem();
    const resolved = await resolveSnapshotImages("cust-1", original);
    expect(resolved.aLookToTry).toBe(original.aLookToTry);
    expect(resolved.evidenceClosetItems[0].roleNote).toBe("Anchor.");
  });

  it("does no work when the edit names no pieces", async () => {
    const resolved = await resolveSnapshotImages("cust-1", edit());
    expect(resolved.evidenceClosetItems).toHaveLength(0);
    expect(fakePrisma.default.closetItem.findMany).not.toHaveBeenCalled();
  });
});
