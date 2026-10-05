// Tests for nAia Admin — Buy/Skip upload history (app/lib/admin/buyskip-admin.server.ts).
//
// Covers:
//   §BSA.1  getAdminCustomerBuySkipUploads scopes the Prisma query to one customerId
//   §BSA.2  getAdminCustomerBuySkipUploadDetail returns null for a cross-customer analysisId (no leak)
//   §BSA.3  getAdminCustomerBuySkipUploadDetail returns the record when it belongs to the requested customer
//   §BSA.4  thumbnail/image URL renders from imagePublicId + imageFormat when present
//   §BSA.5  legacy imageUrl is used directly when no imagePublicId is present
//   §BSA.6  missing/deleted image (neither field present) resolves to null — graceful fallback, not a crash
//   §BSA.7  displayVerdict prefers the richer fullAnalysis.verdict string over the collapsed DB enum
//   §BSA.8  hasDecisionEvidence / verdictOverridden flags read from fullAnalysis safely when absent
//   §BSA.9  Buy/Skip uploads are read from BuyOrSkipAnalysis only — never ClosetItem
//   §BSA.10 admin route requires requireAdminSession (same gate as the rest of admin.naia.*)
//   §BSA.11 routes.ts registers the new detail route

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");
function readSource(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf-8");
}

// ── Mock Prisma ──────────────────────────────────────────────────────────────

vi.mock("~/db.server", () => ({
  default: {
    buyOrSkipAnalysis: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "~/db.server";
import {
  getAdminCustomerBuySkipUploads,
  getAdminCustomerBuySkipUploadDetail,
} from "./buyskip-admin.server";

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "bos-1",
    customerId: "cust-A",
    createdAt: new Date("2026-09-20T10:00:00Z"),
    verdict: "BUY",
    reasoning: "Fits your classic-polished style and your work occasions.",
    category: "Top",
    confidence: 82,
    imagePublicId: "naia-wardrobe/cust-A/bos-1",
    imageFormat: "jpg",
    imageUrl: null,
    fullAnalysis: { verdict: "BUY", itemType: "Blazer" },
    outcome: null,
    ...overrides,
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
  process.env.CLOUDINARY_API_KEY = "test-key";
  process.env.CLOUDINARY_API_SECRET = "test-secret";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ── §BSA.1 ───────────────────────────────────────────────────────────────────

describe("§BSA.1 getAdminCustomerBuySkipUploads scopes to one customer", () => {
  it("queries Prisma with where: { customerId } for the requested customer only", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([makeRow()]);
    await getAdminCustomerBuySkipUploads("cust-A");
    expect(prisma.buyOrSkipAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: "cust-A" } }),
    );
  });

  it("orders newest first", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([]);
    await getAdminCustomerBuySkipUploads("cust-A");
    expect(prisma.buyOrSkipAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });

  it("Customer A's own uploads are returned", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([makeRow({ id: "bos-a1" })]);
    const uploads = await getAdminCustomerBuySkipUploads("cust-A");
    expect(uploads).toHaveLength(1);
    expect(uploads[0].id).toBe("bos-a1");
  });
});

// ── §BSA.2 / §BSA.3 — cross-customer leak prevention ──────────────────────────

describe("§BSA.2 getAdminCustomerBuySkipUploadDetail — cross-customer access", () => {
  it("returns null when the analysis belongs to a different customer (no leak)", async () => {
    (prisma.buyOrSkipAnalysis.findUnique as any).mockResolvedValue(makeRow({ customerId: "cust-B" }));
    const result = await getAdminCustomerBuySkipUploadDetail("cust-A", "bos-1");
    expect(result).toBeNull();
  });

  it("returns null when the analysis does not exist", async () => {
    (prisma.buyOrSkipAnalysis.findUnique as any).mockResolvedValue(null);
    const result = await getAdminCustomerBuySkipUploadDetail("cust-A", "nonexistent");
    expect(result).toBeNull();
  });
});

describe("§BSA.3 getAdminCustomerBuySkipUploadDetail — matching customer", () => {
  it("returns the record when customerId matches", async () => {
    (prisma.buyOrSkipAnalysis.findUnique as any).mockResolvedValue(makeRow({ customerId: "cust-A" }));
    const result = await getAdminCustomerBuySkipUploadDetail("cust-A", "bos-1");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("bos-1");
  });
});

// ── §BSA.4 / §BSA.5 / §BSA.6 — image resolution ───────────────────────────────

describe("§BSA.4 image resolution — S0 private asset", () => {
  it("builds a signed URL when imagePublicId + imageFormat are present", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ imagePublicId: "naia-wardrobe/cust-A/bos-1", imageFormat: "jpg", imageUrl: null }),
    ]);
    const [upload] = await getAdminCustomerBuySkipUploads("cust-A");
    expect(upload.thumbnailUrl).toBeTruthy();
    expect(upload.thumbnailUrl).toMatch(/^https:\/\//);
  });

  it("ownership mismatch (publicId does not belong to this customer's folder) fails closed to null, not a cross-customer image", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ imagePublicId: "naia-wardrobe/cust-B/bos-1", imageFormat: "jpg", imageUrl: null }),
    ]);
    const [upload] = await getAdminCustomerBuySkipUploads("cust-A");
    expect(upload.thumbnailUrl).toBeNull();
  });
});

describe("§BSA.5 image resolution — legacy fallback", () => {
  it("uses the legacy imageUrl directly when no imagePublicId is present", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ imagePublicId: null, imageFormat: null, imageUrl: "https://legacy.example.com/old.jpg" }),
    ]);
    const [upload] = await getAdminCustomerBuySkipUploads("cust-A");
    expect(upload.thumbnailUrl).toBe("https://legacy.example.com/old.jpg");
  });
});

describe("§BSA.6 image resolution — missing/deleted image graceful fallback", () => {
  it("resolves to null (not a throw, not a broken src) when neither reference exists", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ imagePublicId: null, imageFormat: null, imageUrl: null }),
    ]);
    const uploads = await getAdminCustomerBuySkipUploads("cust-A");
    expect(uploads[0].thumbnailUrl).toBeNull();
  });

  it("same graceful fallback applies to the full detail view's imageUrl", async () => {
    (prisma.buyOrSkipAnalysis.findUnique as any).mockResolvedValue(
      makeRow({ imagePublicId: null, imageFormat: null, imageUrl: null }),
    );
    const detail = await getAdminCustomerBuySkipUploadDetail("cust-A", "bos-1");
    expect(detail!.imageUrl).toBeNull();
  });
});

// ── §BSA.7 / §BSA.8 — verdict/evidence display safety ─────────────────────────

describe("§BSA.7 displayVerdict", () => {
  it("prefers fullAnalysis.verdict (e.g. 'SKIP FOR NOW') over the collapsed DB enum", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ verdict: "SKIP", fullAnalysis: { verdict: "SKIP FOR NOW" } }),
    ]);
    const [upload] = await getAdminCustomerBuySkipUploads("cust-A");
    expect(upload.displayVerdict).toBe("SKIP FOR NOW");
  });

  it("falls back to the DB enum when fullAnalysis is absent", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ verdict: "BUY", fullAnalysis: null }),
    ]);
    const [upload] = await getAdminCustomerBuySkipUploads("cust-A");
    expect(upload.displayVerdict).toBe("BUY");
  });
});

describe("§BSA.8 decision-evidence flags are safe on legacy records", () => {
  it("hasDecisionEvidence is false and verdictOverridden is false when fullAnalysis has no such fields", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ fullAnalysis: { verdict: "BUY", itemType: "Blazer" } }),
    ]);
    const [upload] = await getAdminCustomerBuySkipUploads("cust-A");
    expect(upload.hasDecisionEvidence).toBe(false);
    expect(upload.verdictOverridden).toBe(false);
  });

  it("does not throw when fullAnalysis is entirely null (pre-rich-persistence record)", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ fullAnalysis: null, verdict: "SKIP" }),
    ]);
    await expect(getAdminCustomerBuySkipUploads("cust-A")).resolves.toHaveLength(1);
  });

  it("hasDecisionEvidence is true when the new foundation evidence is present", async () => {
    (prisma.buyOrSkipAnalysis.findMany as any).mockResolvedValue([
      makeRow({ fullAnalysis: { verdict: "BUY", decisionEvidence: { duplicateEvidence: { overlap: "unknown" } } } }),
    ]);
    const [upload] = await getAdminCustomerBuySkipUploads("cust-A");
    expect(upload.hasDecisionEvidence).toBe(true);
  });
});

// ── §BSA.9 — Buy/Skip uploads are distinct from Closet items ──────────────────

describe("§BSA.9 Buy/Skip uploads stay distinct from Closet ownership", () => {
  it("buyskip-admin.server.ts never queries or references prisma.closetItem", () => {
    const src = readSource("app/lib/admin/buyskip-admin.server.ts");
    expect(src).not.toMatch(/prisma\.closetItem/);
  });

  it("buyskip-admin.server.ts never writes TasteEvidence or StyleTendency", () => {
    const src = readSource("app/lib/admin/buyskip-admin.server.ts");
    expect(src).not.toMatch(/tasteEvidence\.(create|update|upsert)/i);
    expect(src).not.toMatch(/styleTendency\.(create|update|upsert)/i);
  });

  it("buyskip-admin.server.ts is read-only — no create/update/delete/upsert calls on any model", () => {
    const src = readSource("app/lib/admin/buyskip-admin.server.ts");
    expect(src).not.toMatch(/\.(create|update|upsert|delete)\(/);
  });

  it("BuySkipUploadsSection is rendered as a card separate from ClosetSummarySection, not merged into it", () => {
    const src = readSource("app/routes/admin.naia.customers.$customerId.tsx");
    const closetIdx = src.indexOf("function ClosetSummarySection");
    const buySkipIdx = src.indexOf("function BuySkipUploadsSection");
    expect(closetIdx).toBeGreaterThan(-1);
    expect(buySkipIdx).toBeGreaterThan(-1);
    // Two separate component functions, not one function handling both.
    expect(closetIdx).not.toBe(buySkipIdx);
    const closetBody = src.slice(closetIdx, buySkipIdx);
    expect(closetBody).not.toMatch(/BuySkipUpload/);
  });
});

// ── §BSA.10 / §BSA.11 — auth + route registration ─────────────────────────────

describe("§BSA.10 admin auth gate on the new route", () => {
  it("detail route loader calls requireAdminSession, the same gate as the customer list/detail routes", () => {
    const src = readSource("app/routes/admin.naia.customers.$customerId.buyskip.$analysisId.tsx");
    expect(src).toMatch(/requireAdminSession\(request\)/);
    expect(src).toMatch(/from "~\/lib\/internal-auth\.server"/);
  });

  it("detail route does not define its own weaker auth check", () => {
    const src = readSource("app/routes/admin.naia.customers.$customerId.buyskip.$analysisId.tsx");
    expect(src).not.toMatch(/requireNaiaAdminAccess/); // that's the separate NADINE Designer Intelligence gate, not this surface
  });

  it("customer detail loader's Buy/Skip fetch happens after requireAdminSession, not before", () => {
    const src = readSource("app/routes/admin.naia.customers.$customerId.tsx");
    const authIdx = src.indexOf("await requireAdminSession(request)");
    const fetchIdx = src.indexOf("getAdminCustomerBuySkipUploads(customerId)");
    expect(authIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(authIdx);
  });
});

describe("§BSA.11 routes.ts registers the new detail route", () => {
  it("customers/:customerId/buyskip/:analysisId is registered under the naia admin shell", () => {
    const src = readSource("app/routes.ts");
    expect(src).toMatch(/route\("customers\/:customerId\/buyskip\/:analysisId",\s*"routes\/admin\.naia\.customers\.\$customerId\.buyskip\.\$analysisId\.tsx"\)/);
  });
});
