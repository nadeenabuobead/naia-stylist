// Tests for nAia Admin — Customer 360 (app/lib/admin/customer-360.server.ts).
//
// Covers:
//   §C360.1 every fetcher scopes its Prisma query to the requested customerId
//   §C360.2 What nAia Is Noticing & Feedback surfaces only CONFIRMED/REJECTED, human-readable only
//   §C360.3 getAdminCustomerActivity merges all source tables and sorts newest-first
//   §C360.4 getAdminCustomerStrongestTendency reuses the CONFIRMED-only customer-facing query, not a new one
//   §C360.5 this module never writes StyleTendency/TasteEvidence — read-only, like the rest of nAia Admin
//   §C360.6 the admin loader requires requireAdminSession before any Customer 360 fetch
//   §C360.11 Closet gallery resolves real images via the canonical private-delivery path
//   §C360.12 StyleMe session detail — scoping, outcome, and post-wear review rendering
//   §C360.13 Trend Edit snapshot persistence and historical-row ("not stored") behavior

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");
function readSource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

vi.mock("~/db.server", () => ({
  default: {
    closetItem: { findMany: vi.fn(), count: vi.fn() },
    stylingSession: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    styleTendency: { findMany: vi.fn() },
    personalisedTrendEditUsage: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn() },
    naiaModel: { findUnique: vi.fn() },
    virtualTryOnJob: { findMany: vi.fn(), count: vi.fn() },
    styleMeOutcome: { findMany: vi.fn() },
    postOutfitReview: { findMany: vi.fn() },
    buyOrSkipAnalysis: { findMany: vi.fn(), count: vi.fn() },
    buySkipOutcome: { findMany: vi.fn() },
    savedLook: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/ai/taste-reconcile.server", () => ({
  loadStrongestConfirmedTendency: vi.fn(),
}));

vi.mock("~/lib/editorial-reports.server", () => ({
  getEditorialReportBySlug: vi.fn(),
}));

vi.mock("~/lib/cloudinary-admin.server", () => ({
  getCloudinaryConfig: vi.fn(() => null),
  validatePublicIdOwnership: vi.fn(() => ({ ok: true })),
  buildPrivateDownloadUrl: vi.fn(() => "https://example.com/signed.jpg"),
}));

import prisma from "~/db.server";
import { loadStrongestConfirmedTendency } from "~/lib/ai/taste-reconcile.server";
import { getEditorialReportBySlug } from "~/lib/editorial-reports.server";
import { getCloudinaryConfig, validatePublicIdOwnership } from "~/lib/cloudinary-admin.server";
import {
  getAdminCustomerClosetGallery,
  getAdminCustomerStyleMeSessions,
  getAdminCustomerStyleMeSessionDetail,
  getAdminCustomerNoticingFeedback,
  getAdminCustomerTrendEditUsage,
  getAdminCustomerTrendEditDetail,
  getAdminCustomerVtoHistory,
  getAdminCustomerActivity,
  getAdminCustomerStrongestTendency,
  getAdminCustomerLifetimeUsage,
} from "./customer-360.server";

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.closetItem.findMany as any).mockResolvedValue([]);
  (prisma.closetItem.count as any).mockResolvedValue(0);
  (prisma.stylingSession.findMany as any).mockResolvedValue([]);
  (prisma.stylingSession.count as any).mockResolvedValue(0);
  (prisma.stylingSession.findUnique as any).mockResolvedValue(null);
  (prisma.styleTendency.findMany as any).mockResolvedValue([]);
  (prisma.personalisedTrendEditUsage.findMany as any).mockResolvedValue([]);
  (prisma.personalisedTrendEditUsage.count as any).mockResolvedValue(0);
  (prisma.personalisedTrendEditUsage.findUnique as any).mockResolvedValue(null);
  (prisma.naiaModel.findUnique as any).mockResolvedValue(null);
  (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([]);
  (prisma.virtualTryOnJob.count as any).mockResolvedValue(0);
  (prisma.styleMeOutcome.findMany as any).mockResolvedValue([]);
  (prisma.postOutfitReview.findMany as any).mockResolvedValue([]);
  (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([]);
  (prisma.buyOrSkipAnalysis.count as any).mockResolvedValue(0);
  (prisma.buySkipOutcome.findMany as any).mockResolvedValue([]);
  (prisma.savedLook.findMany as any).mockResolvedValue([]);
  (getEditorialReportBySlug as any).mockResolvedValue(null);
  (getCloudinaryConfig as any).mockReturnValue(null);
  (validatePublicIdOwnership as any).mockReturnValue({ ok: true });
});

// ── §C360.1 — scoping ────────────────────────────────────────────────────────

describe("§C360.1 every fetcher scopes to one customerId", () => {
  it("getAdminCustomerClosetGallery queries where: { customerId }", async () => {
    await getAdminCustomerClosetGallery("cust-A");
    expect(prisma.closetItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
    );
  });

  it("getAdminCustomerStyleMeSessions queries where: { customerId }", async () => {
    await getAdminCustomerStyleMeSessions("cust-A");
    expect(prisma.stylingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
    );
  });

  it("getAdminCustomerNoticingFeedback queries where: { customerId, state: { in: [CONFIRMED, REJECTED] } }", async () => {
    await getAdminCustomerNoticingFeedback("cust-A");
    expect(prisma.styleTendency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A", state: { in: ["CONFIRMED", "REJECTED"] } } }),
    );
  });

  it("getAdminCustomerTrendEditUsage queries where: { customerId }", async () => {
    await getAdminCustomerTrendEditUsage("cust-A");
    expect(prisma.personalisedTrendEditUsage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
    );
  });

  it("getAdminCustomerVtoHistory scopes both the model and the job list to customerId", async () => {
    await getAdminCustomerVtoHistory("cust-A");
    expect(prisma.naiaModel.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
    );
    expect(prisma.virtualTryOnJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
    );
  });

  it("getAdminCustomerActivity scopes every source table to customerId (BuySkipOutcome via its analysis relation)", async () => {
    await getAdminCustomerActivity("cust-A");
    expect(prisma.stylingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
    );
    expect(prisma.buyOrSkipAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
    );
    expect(prisma.buySkipOutcome.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { analysis: { customerId: "cust-A" } } }),
    );
  });
});

// ── §C360.7 — bounded lists (V1 performance protection) ──────────────────────

describe("§C360.7 high-volume lists are bounded with a visible totalCount", () => {
  it("getAdminCustomerClosetGallery caps findMany with take and returns totalCount", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([{ id: "c1" }]);
    (prisma.closetItem.count as any).mockResolvedValue(143);
    const result = await getAdminCustomerClosetGallery("cust-A");
    const query = (prisma.closetItem.findMany as any).mock.calls[0][0];
    expect(query.take).toBe(25);
    expect(query.orderBy).toEqual({ createdAt: "desc" });
    expect(result.totalCount).toBe(143);
    expect(result.items).toHaveLength(1);
  });

  it("getAdminCustomerStyleMeSessions caps findMany with take and returns totalCount", async () => {
    (prisma.stylingSession.findMany as any).mockResolvedValue([]);
    (prisma.stylingSession.count as any).mockResolvedValue(87);
    const result = await getAdminCustomerStyleMeSessions("cust-A");
    const query = (prisma.stylingSession.findMany as any).mock.calls[0][0];
    expect(query.take).toBe(25);
    expect(result.totalCount).toBe(87);
  });

  it("getAdminCustomerVtoHistory caps the job list with take and returns jobsTotalCount", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([]);
    (prisma.virtualTryOnJob.count as any).mockResolvedValue(61);
    const result = await getAdminCustomerVtoHistory("cust-A");
    const query = (prisma.virtualTryOnJob.findMany as any).mock.calls[0][0];
    expect(query.take).toBe(25);
    expect(result.jobsTotalCount).toBe(61);
  });

  it("getAdminCustomerNoticingFeedback is NOT take-bounded (low-cardinality by construction)", async () => {
    await getAdminCustomerNoticingFeedback("cust-A");
    const query = (prisma.styleTendency.findMany as any).mock.calls[0][0];
    expect(query.take).toBeUndefined();
  });

  it("getAdminCustomerTrendEditUsage is NOT take-bounded (one row per customer per report per month)", async () => {
    await getAdminCustomerTrendEditUsage("cust-A");
    const query = (prisma.personalisedTrendEditUsage.findMany as any).mock.calls[0][0];
    expect(query.take).toBeUndefined();
  });

  it("every source query feeding the Activity timeline is take-bounded", async () => {
    await getAdminCustomerActivity("cust-A");
    for (const model of [
      "stylingSession", "styleMeOutcome", "postOutfitReview", "buyOrSkipAnalysis",
      "buySkipOutcome", "styleTendency", "personalisedTrendEditUsage", "virtualTryOnJob", "savedLook",
    ] as const) {
      const query = (prisma[model].findMany as any).mock.calls[0][0];
      expect(query.take, `${model} query should be take-bounded`).toBeDefined();
    }
  });

  it("the merged Activity timeline is capped even when every source returns its full take", async () => {
    const many = (n: number, build: (i: number) => Record<string, unknown>) =>
      Array.from({ length: n }, (_, i) => build(i));
    (prisma.stylingSession.findMany as any).mockResolvedValue(
      many(50, i => ({ id: `s${i}`, createdAt: new Date(2026, 0, i + 1), occasion: null })),
    );
    const result = await getAdminCustomerActivity("cust-A");
    expect(result.length).toBeLessThanOrEqual(50);
  });
});

// ── §C360.9 — Activity global top-50 correctness (pre-staging patch) ─────────

describe("§C360.9 the global Activity timeline is the true newest 50 across all sources", () => {
  it("each source query requests take: 50, not 25", async () => {
    await getAdminCustomerActivity("cust-A");
    for (const model of [
      "stylingSession", "styleMeOutcome", "postOutfitReview", "buyOrSkipAnalysis",
      "buySkipOutcome", "styleTendency", "personalisedTrendEditUsage", "virtualTryOnJob", "savedLook",
    ] as const) {
      const query = (prisma[model].findMany as any).mock.calls[0][0];
      expect(query.take, `${model} should request 50`).toBe(50);
    }
  });

  it("a single source contributing more than 25 of the globally-newest events is not clipped to 25", async () => {
    // 40 StylingSession rows, all newer than anything from any other source —
    // the old take:25-per-source bug would have silently dropped events
    // 26-40 even though they belong in the true newest 50.
    const sessions = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      createdAt: new Date(2026, 5, 1, 0, 0, i), // seconds 0..39, all after everything else
      occasion: null,
    }));
    (prisma.stylingSession.findMany as any).mockResolvedValue(sessions);
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      { id: "b-old", createdAt: new Date(2020, 0, 1), verdict: "BUY" },
    ]);

    const events = await getAdminCustomerActivity("cust-A");
    const styleMeEvents = events.filter(e => e.label === "Started StyleMe");
    expect(styleMeEvents).toHaveLength(40);
  });

  it("returns exactly the newest 50 events after merging sources that together exceed 50", async () => {
    // 50 StylingSession rows (seconds 50..99, i.e. the newest half) +
    // 50 BuyOrSkipAnalysis rows (seconds 0..49, the oldest half) = 100
    // candidates; the correct result is the 50 StyleMe events only.
    const sessions = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      createdAt: new Date(2026, 0, 1, 0, 0, 50 + i),
      occasion: null,
    }));
    const analyses = Array.from({ length: 50 }, (_, i) => ({
      id: `b${i}`,
      createdAt: new Date(2026, 0, 1, 0, 0, i),
      verdict: "BUY",
    }));
    (prisma.stylingSession.findMany as any).mockResolvedValue(sessions);
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue(analyses);

    const events = await getAdminCustomerActivity("cust-A");
    expect(events).toHaveLength(50);
    expect(events.every(e => e.label === "Started StyleMe")).toBe(true);
    // newest-first
    expect(events[0].timestamp.getTime()).toBeGreaterThan(events[49].timestamp.getTime());
  });
});

// ── §C360.10 — Buy/Skip timeline timestamp truth (pre-staging patch) ─────────

describe("§C360.10 the Buy/Skip outcome event is labeled truthfully from updatedAt", () => {
  it('uses "Buy/Skip outcome updated", not "decision recorded" (updatedAt cannot prove when the decision was first made)', async () => {
    (prisma.buySkipOutcome.findMany as any).mockResolvedValue([{
      updatedAt: new Date("2026-02-01T00:00:00Z"),
      decision: "BOUGHT_IT",
      postPurchaseOutcome: null,
    }]);
    const events = await getAdminCustomerActivity("cust-A");
    const event = events.find(e => e.label.startsWith("Buy/Skip outcome"));
    expect(event?.label).toBe("Buy/Skip outcome updated");
    expect(events.some(e => e.label === "Buy/Skip decision recorded")).toBe(false);
  });

  it("includes both decision and postPurchaseOutcome in the detail when both are known", async () => {
    (prisma.buySkipOutcome.findMany as any).mockResolvedValue([{
      updatedAt: new Date("2026-02-01T00:00:00Z"),
      decision: "BOUGHT_IT",
      postPurchaseOutcome: "LOVE_IT",
    }]);
    const events = await getAdminCustomerActivity("cust-A");
    const event = events.find(e => e.label.startsWith("Buy/Skip outcome"));
    expect(event?.detail).toBe("bought it · love it");
  });

  it("omits the postPurchaseOutcome segment when it is not yet known", async () => {
    (prisma.buySkipOutcome.findMany as any).mockResolvedValue([{
      updatedAt: new Date("2026-02-01T00:00:00Z"),
      decision: "STILL_DECIDING",
      postPurchaseOutcome: null,
    }]);
    const events = await getAdminCustomerActivity("cust-A");
    const event = events.find(e => e.label.startsWith("Buy/Skip outcome"));
    expect(event?.detail).toBe("still deciding");
  });

  it("does not synthesize a separate event for postPurchaseOutcome — one row, one event, one timestamp", async () => {
    (prisma.buySkipOutcome.findMany as any).mockResolvedValue([{
      updatedAt: new Date("2026-02-01T00:00:00Z"),
      decision: "BOUGHT_IT",
      postPurchaseOutcome: "LOVE_IT",
    }]);
    const events = await getAdminCustomerActivity("cust-A");
    const buySkipOutcomeEvents = events.filter(e => e.label.startsWith("Buy/Skip outcome"));
    expect(buySkipOutcomeEvents).toHaveLength(1);
  });
});

// ── §C360.8 — VTO timestamp truth (Activity must not pair createdAt with a later status) ──

describe("§C360.8 Activity's VTO event uses completedAt once the job has actually finished", () => {
  it("a COMPLETED job emits its event at completedAt, not createdAt", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([{
      createdAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-04T00:00:00Z"),
      productHandle: "midi-dress",
      status: "COMPLETED",
    }]);
    const events = await getAdminCustomerActivity("cust-A");
    const vtoEvent = events.find(e => e.label.startsWith("Virtual try-on job"));
    expect(vtoEvent?.timestamp.toISOString()).toBe("2026-01-04T00:00:00.000Z");
    expect(vtoEvent?.label).toBe("Virtual try-on job finished");
  });

  it("an in-flight job (no completedAt) emits its event at createdAt, labeled as started", async () => {
    (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([{
      createdAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: null,
      productHandle: "midi-dress",
      status: "PROCESSING",
    }]);
    const events = await getAdminCustomerActivity("cust-A");
    const vtoEvent = events.find(e => e.label.startsWith("Virtual try-on job"));
    expect(vtoEvent?.timestamp.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(vtoEvent?.label).toBe("Virtual try-on job started");
  });
});

// ── §C360.2 — What nAia Is Noticing & Feedback: customer-visible only ────────
//
// Rewritten for the visual-QA pass: the primary Customer 360 list must show
// only CONFIRMED and REJECTED StyleTendency rows (the only two states whose
// claimText a customer's own screen ever actually rendered — see the
// rationale comment above getAdminCustomerNoticingFeedback in
// customer-360.server.ts) and must never expose raw internal mechanics
// (dimension, value, effectiveSupport, distinctSources, observationFamily).

function makeTendencyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    state: "CONFIRMED",
    claimText: "You consistently choose fitted silhouettes.",
    customerFeedback: null,
    customerFeedbackAt: null,
    notQuiteReason: null,
    notQuiteNote: null,
    createdAt: new Date("2026-09-01"),
    ...overrides,
  };
}

describe("§C360.2 What nAia Is Noticing & Feedback — customer-visible observations only", () => {
  it("queries only CONFIRMED and REJECTED — CANDIDATE and SUPPRESSED are excluded at the query level, not filtered client-side", async () => {
    (prisma.styleTendency.findMany as any).mockResolvedValue([
      makeTendencyRow({ id: "t1", state: "CONFIRMED" }),
      makeTendencyRow({ id: "t2", state: "REJECTED", customerFeedback: "not-quite" }),
    ]);
    const result = await getAdminCustomerNoticingFeedback("cust-A");

    const query = (prisma.styleTendency.findMany as any).mock.calls[0][0];
    expect(query.where.state).toEqual({ in: ["CONFIRMED", "REJECTED"] });
    expect(result.map(r => r.status).sort()).toEqual(["Confirmed", "Rejected"]);
  });

  it("never returns dimension, value, effectiveSupport, distinctSources, or observationFamily — only human-readable fields", async () => {
    (prisma.styleTendency.findMany as any).mockResolvedValue([makeTendencyRow()]);
    const [row] = await getAdminCustomerNoticingFeedback("cust-A");
    expect(row).not.toHaveProperty("dimension");
    expect(row).not.toHaveProperty("value");
    expect(row).not.toHaveProperty("effectiveSupport");
    expect(row).not.toHaveProperty("distinctSources");
    expect(row).not.toHaveProperty("observationFamily");
    expect(Object.keys(row).sort()).toEqual(
      ["customerFeedback", "feedbackAt", "id", "notQuiteNote", "notQuiteReason", "observationText", "status", "surfacedAt"].sort(),
    );
  });

  it("maps customerFeedback to the three human labels: Accurate / Not quite / Awaiting feedback", async () => {
    (prisma.styleTendency.findMany as any).mockResolvedValue([
      makeTendencyRow({ id: "t1", customerFeedback: "accurate" }),
      makeTendencyRow({ id: "t2", customerFeedback: "not-quite" }),
      makeTendencyRow({ id: "t3", customerFeedback: null }),
    ]);
    const rows = await getAdminCustomerNoticingFeedback("cust-A");
    expect(rows.find(r => r.id === "t1")!.customerFeedback).toBe("Accurate");
    expect(rows.find(r => r.id === "t2")!.customerFeedback).toBe("Not quite");
    expect(rows.find(r => r.id === "t3")!.customerFeedback).toBe("Awaiting feedback");
  });

  it("carries notQuiteReason/notQuiteNote through for a rejected-via-not-quite row", async () => {
    (prisma.styleTendency.findMany as any).mockResolvedValue([makeTendencyRow({
      state: "REJECTED",
      claimText: "You tend to find structured pieces restrictive.",
      customerFeedback: "not-quite", customerFeedbackAt: new Date("2026-09-01"),
      notQuiteReason: "only-sometimes", notQuiteNote: "Only when it's very hot out.",
    })]);
    const [row] = await getAdminCustomerNoticingFeedback("cust-A");
    expect(row.notQuiteReason).toBe("only-sometimes");
    expect(row.notQuiteNote).toBe("Only when it's very hot out.");
  });

  it("never fabricates raw dimension:value text even as a claimText fallback", async () => {
    (prisma.styleTendency.findMany as any).mockResolvedValue([makeTendencyRow({ claimText: null })]);
    const [row] = await getAdminCustomerNoticingFeedback("cust-A");
    expect(row.observationText).not.toMatch(/:/); // no "garment-category:TOPS"-style raw key
  });
});

// ── §C360.3 — Activity timeline ──────────────────────────────────────────────

describe("§C360.3 getAdminCustomerActivity merges sources and sorts newest-first", () => {
  it("merges StylingSession, BuyOrSkipAnalysis, and SavedLook into one sorted timeline", async () => {
    (prisma.stylingSession.findMany as any).mockResolvedValue([
      { id: "s1", createdAt: new Date("2026-01-01T00:00:00Z"), occasion: "work" },
    ]);
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      { id: "b1", createdAt: new Date("2026-03-01T00:00:00Z"), verdict: "BUY" },
    ]);
    (prisma.savedLook.findMany as any).mockResolvedValue([
      { createdAt: new Date("2026-02-01T00:00:00Z"), name: "Brunch look" },
    ]);

    const events = await getAdminCustomerActivity("cust-A");

    expect(events).toHaveLength(3);
    expect(events.map(e => e.timestamp.toISOString())).toEqual([
      "2026-03-01T00:00:00.000Z",
      "2026-02-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
    expect(events[0].label).toBe("Buy/Skip analysis");
    expect(events[1].label).toBe("Saved a look");
    expect(events[2].label).toBe("Started StyleMe");
  });

  it("excludes StyleTendency rows the customer never gave feedback on (customerFeedbackAt filter)", async () => {
    await getAdminCustomerActivity("cust-A");
    const query = (prisma.styleTendency.findMany as any).mock.calls[0][0];
    expect(query.where).toEqual({ customerId: "cust-A", customerFeedbackAt: { not: null } });
  });
});

// ── §C360.4 — strongest tendency reuses the customer-facing query ───────────

describe("§C360.4 getAdminCustomerStrongestTendency reuses loadStrongestConfirmedTendency", () => {
  it("calls the shared CONFIRMED-only helper rather than its own StyleTendency query", async () => {
    (loadStrongestConfirmedTendency as any).mockResolvedValue({
      id: "t1", dimension: "fit", value: "fitted",
      claimText: "You consistently choose fitted silhouettes.", rationaleText: null,
    });
    const result = await getAdminCustomerStrongestTendency("cust-A");
    expect(loadStrongestConfirmedTendency).toHaveBeenCalledWith("cust-A");
    expect(result?.claimText).toBe("You consistently choose fitted silhouettes.");
  });

  it("returns null when the customer has no CONFIRMED tendency yet", async () => {
    (loadStrongestConfirmedTendency as any).mockResolvedValue(null);
    const result = await getAdminCustomerStrongestTendency("cust-A");
    expect(result).toBeNull();
  });
});

// ── §C360.5 — read-only ───────────────────────────────────────────────────────

describe("§C360.5 customer-360.server.ts is read-only", () => {
  it("contains no create/update/upsert/delete call on any Prisma model", () => {
    const src = readSource("app/lib/admin/customer-360.server.ts");
    expect(src).not.toMatch(/\.(create|update|upsert|delete)(Many)?\(/);
  });

  it("never writes TasteEvidence or StyleTendency", () => {
    const src = readSource("app/lib/admin/customer-360.server.ts");
    expect(src).not.toMatch(/tasteEvidence\.(create|update|upsert)/i);
    expect(src).not.toMatch(/styleTendency\.(create|update|upsert)/i);
  });
});

// ── §C360.6 — admin auth gate ─────────────────────────────────────────────────

describe("§C360.6 the customer detail loader requires an admin session before any Customer 360 fetch", () => {
  it("requireAdminSession runs before the Promise.all of new tab fetchers", () => {
    const src = readSource("app/routes/admin.naia.customers.$customerId.tsx");
    const authIdx = src.indexOf("await requireAdminSession(request)");
    const fetchIdx = src.indexOf("getAdminCustomerClosetGallery(customerId)");
    expect(authIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(authIdx);
  });

  it("no Designer Intelligence route imports customer-360.server.ts", () => {
    const designerSrc = readSource("app/routes/app.designer-intelligence.jsx");
    expect(designerSrc).not.toMatch(/customer-360\.server/);
  });
});

// ── §C360.11 — Closet gallery image resolution (visual-QA fix) ──────────────

describe("§C360.11 Closet gallery resolves real images via the canonical private-delivery path", () => {
  it("builds a signed URL from imagePublicId+imageFormat when present — not thumbnailUrl", async () => {
    (getCloudinaryConfig as any).mockReturnValue({ cloudName: "x", apiKey: "y", apiSecret: "z" });
    (prisma.closetItem.findMany as any).mockResolvedValue([{
      id: "c1", name: "Blazer", brand: "Zara", category: "OUTERWEAR", subcategory: null,
      imageUrl: null, imagePublicId: "naia-wardrobe/cust-A/c1", imageFormat: "jpg",
      colors: [], material: null, garmentRelationships: [], customerNote: null,
      favorite: false, timesWorn: 0, createdAt: new Date(), adminReview: null,
    }]);
    const result = await getAdminCustomerClosetGallery("cust-A");
    expect(result.items[0].thumbnailUrl).toBe("https://example.com/signed.jpg");
  });

  it("falls back to the legacy public imageUrl when no imagePublicId is present", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([{
      id: "c1", name: "Blazer", brand: null, category: "OUTERWEAR", subcategory: null,
      imageUrl: "https://legacy.example.com/old.jpg", imagePublicId: null, imageFormat: null,
      colors: [], material: null, garmentRelationships: [], customerNote: null,
      favorite: false, timesWorn: 0, createdAt: new Date(), adminReview: null,
    }]);
    const result = await getAdminCustomerClosetGallery("cust-A");
    expect(result.items[0].thumbnailUrl).toBe("https://legacy.example.com/old.jpg");
  });

  it("resolves to null (not a crash) when neither image reference exists", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([{
      id: "c1", name: "Blazer", brand: null, category: "OUTERWEAR", subcategory: null,
      imageUrl: null, imagePublicId: null, imageFormat: null,
      colors: [], material: null, garmentRelationships: [], customerNote: null,
      favorite: false, timesWorn: 0, createdAt: new Date(), adminReview: null,
    }]);
    const result = await getAdminCustomerClosetGallery("cust-A");
    expect(result.items[0].thumbnailUrl).toBeNull();
  });

  it("ownership mismatch fails closed to null, never leaking a cross-customer image", async () => {
    (getCloudinaryConfig as any).mockReturnValue({ cloudName: "x", apiKey: "y", apiSecret: "z" });
    (validatePublicIdOwnership as any).mockReturnValue({ ok: false });
    (prisma.closetItem.findMany as any).mockResolvedValue([{
      id: "c1", name: "Blazer", brand: null, category: "OUTERWEAR", subcategory: null,
      imageUrl: null, imagePublicId: "naia-wardrobe/cust-B/c1", imageFormat: "jpg",
      colors: [], material: null, garmentRelationships: [], customerNote: null,
      favorite: false, timesWorn: 0, createdAt: new Date(), adminReview: null,
    }]);
    const result = await getAdminCustomerClosetGallery("cust-A");
    expect(result.items[0].thumbnailUrl).toBeNull();
  });
});

// ── §C360.12 — StyleMe session detail (visual-QA fix) ────────────────────────

describe("§C360.12 getAdminCustomerStyleMeSessionDetail scoping", () => {
  it("returns null when the session belongs to a different customer (no leak)", async () => {
    (prisma.stylingSession.findUnique as any).mockResolvedValue({ id: "s1", customerId: "cust-B" });
    const result = await getAdminCustomerStyleMeSessionDetail("cust-A", "s1");
    expect(result).toBeNull();
  });

  it("returns null when the session does not exist", async () => {
    (prisma.stylingSession.findUnique as any).mockResolvedValue(null);
    const result = await getAdminCustomerStyleMeSessionDetail("cust-A", "nonexistent");
    expect(result).toBeNull();
  });

  it("returns the full detail when the session belongs to the requested customer", async () => {
    (prisma.stylingSession.findUnique as any).mockResolvedValue({
      id: "s1", customerId: "cust-A", createdAt: new Date(), occasion: "work", currentMood: null,
      desiredFeeling: null, state: null, intentions: [], styleFrom: "BOTH", styleMeMode: "naia",
      bodyNeeds: [], practicalIds: [], formalityConditional: null, specificNeeds: null,
      bodyPreference: null, styleDNA: null, weather: null, timeOfDay: null,
      closetAnchorId: null, anchorProvenance: null, suggestions: [], review: null,
    });
    const result = await getAdminCustomerStyleMeSessionDetail("cust-A", "s1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("s1");
  });
});

describe("§C360.12 getAdminCustomerStyleMeSessionDetail renders outcome and post-wear review fully", () => {
  const baseSession = {
    id: "s1", customerId: "cust-A", createdAt: new Date(), occasion: "work", currentMood: null,
    desiredFeeling: null, state: null, intentions: [], styleFrom: "BOTH", styleMeMode: "naia",
    bodyNeeds: [], practicalIds: [], formalityConditional: null, specificNeeds: null,
    bodyPreference: null, styleDNA: null, weather: null, timeOfDay: null,
    closetAnchorId: null, anchorProvenance: null,
  };

  it("surfaces every StyleMeOutcome field — wore it, goal response, worked, felt off, customer comment", async () => {
    (prisma.stylingSession.findUnique as any).mockResolvedValue({
      ...baseSession,
      suggestions: [{
        id: "sg1", createdAt: new Date(), status: "PENDING", outfitName: "Sharp Tailoring",
        whyThisWorks: null, confidenceBoost: null, moodDescription: null,
        perfumeRec: null, perfumeNotes: null, hairstyleRec: null, hairstyleNotes: null,
        makeupVibeRec: null, makeupNotes: null, songRec: null, songArtist: null,
        selected: true, savedAsLook: false, items: [],
        outcome: {
          outcomeStatus: "wore-it", changeTypes: [], otherChangeNote: null,
          goalOutcome: "yes", selectedDirection: "most-you",
          whatWorked: ["fit"], whatFeltOff: [], didntWearReasons: [],
          reasonOtherNote: "Felt amazing all day.", submittedAt: new Date("2026-09-02"),
        },
      }],
      review: null,
    });
    const result = await getAdminCustomerStyleMeSessionDetail("cust-A", "s1");
    const outcome = result!.suggestions[0].outcome!;
    expect(outcome.outcomeStatus).toBe("wore-it");
    expect(outcome.goalOutcome).toBe("yes");
    expect(outcome.whatWorked).toEqual(["fit"]);
    expect(outcome.reasonOtherNote).toBe("Felt amazing all day.");
  });

  it("surfaces every PostOutfitReview field when present", async () => {
    (prisma.stylingSession.findUnique as any).mockResolvedValue({
      ...baseSession,
      suggestions: [],
      review: {
        overallFeeling: 4, feltLikeHer: "Yes", desiredFeelingAchieved: "Yes", wouldWearAgain: "Definitely",
        physicallyComfortable: "Comfortable", workedTags: "[\"fit\"]", didntWorkTags: null,
        additionalNotes: "Loved it.", objections: null, confidenceBefore: 5, confidenceAfter: 8,
        didWearIt: "yes", feelingAnswer: "great", fitFeedback: "yes", coverageFeedback: "yes",
        colourFeedback: "yes", createdAt: new Date("2026-09-03"),
      },
    });
    const result = await getAdminCustomerStyleMeSessionDetail("cust-A", "s1");
    expect(result!.review!.feltLikeHer).toBe("Yes");
    expect(result!.review!.confidenceBefore).toBe(5);
    expect(result!.review!.confidenceAfter).toBe(8);
    expect(result!.review!.additionalNotes).toBe("Loved it.");
  });

  it("does not fabricate a review when none was ever submitted", async () => {
    (prisma.stylingSession.findUnique as any).mockResolvedValue({ ...baseSession, suggestions: [], review: null });
    const result = await getAdminCustomerStyleMeSessionDetail("cust-A", "s1");
    expect(result!.review).toBeNull();
  });
});

// ── §C360.13 — Trend Edit snapshot persistence (visual-QA fix) ──────────────

describe("§C360.13 getAdminCustomerTrendEditUsage resolves a title without fabricating content", () => {
  it("prefers the title stored in the snapshot when present", async () => {
    (prisma.personalisedTrendEditUsage.findMany as any).mockResolvedValue([{
      id: "u1", reportSlug: "modern-tailoring", periodKey: "2026-09", createdAt: new Date(),
      snapshot: { schemaVersion: "trend-edit-snapshot-v1", reportTitle: "Modern Tailoring", reportSlug: "modern-tailoring", generatedAt: "2026-09-01T00:00:00Z", edit: {}, nadineRecommendation: null },
    }]);
    const rows = await getAdminCustomerTrendEditUsage("cust-A");
    expect(rows[0].reportTitle).toBe("Modern Tailoring");
    expect(rows[0].hasSnapshot).toBe(true);
    expect(getEditorialReportBySlug).not.toHaveBeenCalled();
  });

  it("falls back to the live editorial report's title for a historical row with no snapshot", async () => {
    (prisma.personalisedTrendEditUsage.findMany as any).mockResolvedValue([{
      id: "u1", reportSlug: "modern-tailoring", periodKey: "2026-09", createdAt: new Date(), snapshot: null,
    }]);
    (getEditorialReportBySlug as any).mockResolvedValue({ slug: "modern-tailoring", title: "Modern Tailoring" });
    const rows = await getAdminCustomerTrendEditUsage("cust-A");
    expect(rows[0].reportTitle).toBe("Modern Tailoring");
    expect(rows[0].hasSnapshot).toBe(false);
  });

  it("falls back to the raw slug when the report can no longer be resolved at all", async () => {
    (prisma.personalisedTrendEditUsage.findMany as any).mockResolvedValue([{
      id: "u1", reportSlug: "retired-report", periodKey: "2026-09", createdAt: new Date(), snapshot: null,
    }]);
    (getEditorialReportBySlug as any).mockResolvedValue(null);
    const rows = await getAdminCustomerTrendEditUsage("cust-A");
    expect(rows[0].reportTitle).toBe("retired-report");
  });
});

describe("§C360.13 getAdminCustomerTrendEditDetail — historical rows are never fabricated", () => {
  it("returns null when the usage row belongs to a different customer", async () => {
    (prisma.personalisedTrendEditUsage.findUnique as any).mockResolvedValue({ customerId: "cust-B", createdAt: new Date(), snapshot: null });
    const result = await getAdminCustomerTrendEditDetail("cust-A", "u1");
    expect(result).toBeNull();
  });

  it("hasSnapshot is false and snapshot is null for a pre-snapshot historical row — never reconstructed", async () => {
    (prisma.personalisedTrendEditUsage.findUnique as any).mockResolvedValue({ customerId: "cust-A", createdAt: new Date(), snapshot: null });
    const result = await getAdminCustomerTrendEditDetail("cust-A", "u1");
    expect(result!.hasSnapshot).toBe(false);
    expect(result!.snapshot).toBeNull();
  });

  it("returns the full stored snapshot when present", async () => {
    const snapshot = { schemaVersion: "trend-edit-snapshot-v1", reportSlug: "s", reportTitle: "T", generatedAt: "2026-09-01T00:00:00Z", edit: { yourVersion: "x" }, nadineRecommendation: null };
    (prisma.personalisedTrendEditUsage.findUnique as any).mockResolvedValue({ customerId: "cust-A", createdAt: new Date(), snapshot });
    const result = await getAdminCustomerTrendEditDetail("cust-A", "u1");
    expect(result!.hasSnapshot).toBe(true);
    expect(result!.snapshot).toEqual(snapshot);
  });
});

// ── Membership & Usage — current-cycle vs lifetime (visual-QA fix) ──────────

describe("getAdminCustomerLifetimeUsage returns unscoped lifetime counts, never window-filtered", () => {
  it("queries every count with no createdAt filter at all", async () => {
    await getAdminCustomerLifetimeUsage("cust-A");
    const sessionQuery = (prisma.stylingSession.count as any).mock.calls[0][0];
    const buySkipQuery = (prisma.buyOrSkipAnalysis.count as any).mock.calls[0][0];
    const trendQuery = (prisma.personalisedTrendEditUsage.count as any).mock.calls[0][0];
    expect(sessionQuery.where.createdAt).toBeUndefined();
    expect(buySkipQuery.where.createdAt).toBeUndefined();
    expect(trendQuery.where.createdAt).toBeUndefined();
  });

  it("returns the raw counts without any limit/ratio attached", async () => {
    (prisma.stylingSession.count as any).mockResolvedValue(97);
    (prisma.buyOrSkipAnalysis.count as any).mockResolvedValue(23);
    (prisma.personalisedTrendEditUsage.count as any).mockResolvedValue(3);
    const result = await getAdminCustomerLifetimeUsage("cust-A");
    expect(result.styleMeSessions).toBe(97);
    expect(result.buySkipAnalyses).toBe(23);
    expect(result.personalisedTrendEdits).toBe(3);
  });
});
