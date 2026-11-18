// app/lib/ai/styleme-anchor-legacy-image-ownership.test.ts
//
// 2026-11-18 — QA #36 follow-up. resolveClosetAnchor and
// loadAllClosetItemsForEngine (styleme-anchor.server.ts) both read
// ClosetItem.imageUrl — the same legacy, pre-private-delivery-migration
// public Cloudinary URL field covered elsewhere by validateImageUrlOwnership
// — with no ownership check, found during a fresh sweep after the original
// QA #36 fix (which covered look-image-resolution.server.ts,
// customer-360.server.ts, closet._index.tsx, trend-evidence.server.ts, and
// style-me/result.tsx, but not this file). Both functions' underlying
// Prisma queries are already customerId-scoped (findFirst/findMany with
// customerId in the WHERE clause), so this closes a pattern gap rather than
// a confirmed live exploit — same category as the original fix.
//
// styleme-anchor.test.ts's own header notes resolveClosetAnchor is
// "integration-only, not tested here" — this file fills that specific gap
// with a mocked Prisma client, following the same vitest + importOriginal
// convention as trend-evidence-hydrate.test.ts and
// trend-evidence-shopper-image-priority.test.ts.
//
// Run: npx vitest run app/lib/ai/styleme-anchor-legacy-image-ownership.test.ts

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.server.js", () => ({
  default: {
    closetItem: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("../../lib/cloudinary-admin.server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/cloudinary-admin.server.js")>();
  return {
    ...actual, // keep the real buildPrivateDownloadUrl/validateImageUrlOwnership
    getCloudinaryConfig: vi.fn(() => ({ cloudName: "demo", apiKey: "key", apiSecret: "secret" })),
  };
});

import prisma from "../../db.server.js";
import { resolveClosetAnchor, loadAllClosetItemsForEngine } from "./styleme-anchor.server";

function closetItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    name: "Blazer",
    category: "TOPS",
    subcategory: null,
    colors: [],
    primaryColor: null,
    pattern: null,
    material: null,
    styleTags: [],
    occasions: [],
    imageUrl: null,
    imagePublicId: null,
    imageFormat: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveClosetAnchor — legacy imageUrl ownership", () => {
  it("prefers the signed URL over the legacy imageUrl when both are present", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue(
      closetItem({
        imageUrl: "https://legacy.example.com/old.jpg",
        imagePublicId: "naia-wardrobe/cust-A/item-1",
        imageFormat: "jpg",
      }),
    );
    const result = await resolveClosetAnchor("cust-A", "item-1");
    expect(result!.imageUrl).toContain("https://api.cloudinary.com/v1_1/demo/");
  });

  it("falls back to the legacy imageUrl, ownership-checked, when no signed fields are present", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue(
      closetItem({ imageUrl: "https://legacy.example.com/old.jpg" }),
    );
    const result = await resolveClosetAnchor("cust-A", "item-1");
    expect(result!.imageUrl).toBe("https://legacy.example.com/old.jpg");
  });

  it("rejects a legacy imageUrl naming a DIFFERENT customer's naia-wardrobe folder", async () => {
    (prisma.closetItem.findFirst as any).mockResolvedValue(
      closetItem({
        imageUrl: "https://res.cloudinary.com/demo/image/upload/naia-wardrobe/cust-B/item-1.jpg",
      }),
    );
    const result = await resolveClosetAnchor("cust-A", "item-1");
    expect(result!.imageUrl).toBeNull();
  });
});

describe("loadAllClosetItemsForEngine — legacy imageUrl ownership", () => {
  it("prefers the signed URL over the legacy imageUrl when both are present", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      closetItem({
        imageUrl: "https://legacy.example.com/old.jpg",
        imagePublicId: "naia-wardrobe/cust-A/item-1",
        imageFormat: "jpg",
      }),
    ]);
    const [result] = await loadAllClosetItemsForEngine("cust-A");
    expect(result.imageUrl).toContain("https://api.cloudinary.com/v1_1/demo/");
  });

  it("rejects a legacy imageUrl naming a DIFFERENT customer's naia-wardrobe folder", async () => {
    (prisma.closetItem.findMany as any).mockResolvedValue([
      closetItem({
        imageUrl: "https://res.cloudinary.com/demo/image/upload/naia-wardrobe/cust-B/item-1.jpg",
      }),
    ]);
    const [result] = await loadAllClosetItemsForEngine("cust-A");
    expect(result.imageUrl).toBeNull();
  });
});
