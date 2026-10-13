// Tests for nAia Admin — Customer 360 (app/lib/admin/customer-360.server.ts).
//
// Covers:
//   §C360.1 every fetcher scopes its Prisma query to the requested customerId
//   §C360.2 Learning & Feedback returns every StyleTendency state, including REJECTED
//   §C360.3 getAdminCustomerActivity merges all source tables and sorts newest-first
//   §C360.4 getAdminCustomerStrongestTendency reuses the CONFIRMED-only customer-facing query, not a new one
//   §C360.5 this module never writes StyleTendency/TasteEvidence — read-only, like the rest of nAia Admin
//   §C360.6 the admin loader requires requireAdminSession before any Customer 360 fetch

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
    closetItem: { findMany: vi.fn() },
    stylingSession: { findMany: vi.fn() },
    styleTendency: { findMany: vi.fn() },
    personalisedTrendEditUsage: { findMany: vi.fn() },
    naiaModel: { findUnique: vi.fn() },
    virtualTryOnJob: { findMany: vi.fn() },
    styleMeOutcome: { findMany: vi.fn() },
    postOutfitReview: { findMany: vi.fn() },
    buyOrSkipAnalysis: { findMany: vi.fn() },
    buySkipOutcome: { findMany: vi.fn() },
    savedLook: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/ai/taste-reconcile.server", () => ({
  loadStrongestConfirmedTendency: vi.fn(),
}));

import prisma from "~/db.server";
import { loadStrongestConfirmedTendency } from "~/lib/ai/taste-reconcile.server";
import {
  getAdminCustomerClosetGallery,
  getAdminCustomerStyleMeSessions,
  getAdminCustomerLearningFeedback,
  getAdminCustomerTrendEditUsage,
  getAdminCustomerVtoHistory,
  getAdminCustomerActivity,
  getAdminCustomerStrongestTendency,
} from "./customer-360.server";

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.closetItem.findMany as any).mockResolvedValue([]);
  (prisma.stylingSession.findMany as any).mockResolvedValue([]);
  (prisma.styleTendency.findMany as any).mockResolvedValue([]);
  (prisma.personalisedTrendEditUsage.findMany as any).mockResolvedValue([]);
  (prisma.naiaModel.findUnique as any).mockResolvedValue(null);
  (prisma.virtualTryOnJob.findMany as any).mockResolvedValue([]);
  (prisma.styleMeOutcome.findMany as any).mockResolvedValue([]);
  (prisma.postOutfitReview.findMany as any).mockResolvedValue([]);
  (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([]);
  (prisma.buySkipOutcome.findMany as any).mockResolvedValue([]);
  (prisma.savedLook.findMany as any).mockResolvedValue([]);
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

  it("getAdminCustomerLearningFeedback queries where: { customerId }", async () => {
    await getAdminCustomerLearningFeedback("cust-A");
    expect(prisma.styleTendency.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
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

// ── §C360.2 — Learning & Feedback includes REJECTED ───────────────────────────

describe("§C360.2 Learning & Feedback surfaces every state, including REJECTED", () => {
  it("does not filter by state at all — CANDIDATE, CONFIRMED, SUPPRESSED, and REJECTED all pass through", async () => {
    const rows = [
      { id: "t1", state: "CONFIRMED" },
      { id: "t2", state: "REJECTED" },
      { id: "t3", state: "CANDIDATE" },
      { id: "t4", state: "SUPPRESSED" },
    ].map(r => ({
      ...r,
      dimension: "fit", value: "fitted", observationFamily: "WORKS_WELL",
      claimText: null, rationaleText: null, effectiveSupport: 1, distinctSources: 1,
      customerFeedback: null, customerFeedbackAt: null, notQuiteReason: null, notQuiteNote: null,
      createdAt: new Date(), updatedAt: new Date(),
    }));
    (prisma.styleTendency.findMany as any).mockResolvedValue(rows);

    const result = await getAdminCustomerLearningFeedback("cust-A");

    expect(result.map(r => r.state).sort()).toEqual(["CANDIDATE", "CONFIRMED", "REJECTED", "SUPPRESSED"]);
    const query = (prisma.styleTendency.findMany as any).mock.calls[0][0];
    expect(query.where).toEqual({ customerId: "cust-A" });
    expect(query.where.state).toBeUndefined();
  });

  it("carries notQuiteReason/notQuiteNote through for a rejected-via-not-quite row", async () => {
    (prisma.styleTendency.findMany as any).mockResolvedValue([{
      id: "t1", dimension: "comfort", value: "structured", state: "REJECTED",
      observationFamily: "FRICTION", claimText: "You tend to find structured pieces restrictive.",
      rationaleText: null, effectiveSupport: 2, distinctSources: 2,
      customerFeedback: "not-quite", customerFeedbackAt: new Date("2026-09-01"),
      notQuiteReason: "only-sometimes", notQuiteNote: "Only when it's very hot out.",
      createdAt: new Date(), updatedAt: new Date(),
    }]);
    const [row] = await getAdminCustomerLearningFeedback("cust-A");
    expect(row.notQuiteReason).toBe("only-sometimes");
    expect(row.notQuiteNote).toBe("Only when it's very hot out.");
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
