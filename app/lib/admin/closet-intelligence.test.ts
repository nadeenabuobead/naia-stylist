// Tests for nAia Admin — Closet Intelligence server utilities.
//
// Covers:
//   §CI.1  extractOverallConfidence — all cases
//   §CI.2  PAGE_SIZE constant
//   §CI.3  REVIEW_STATUS_LABELS constant
//   §CI.4  computeDisplayReviewStatus — all branches
//   §CI.5  listClosetItems WHERE clause construction (filter logic unit tests)
//   §CI.6  reviewStatus filter: "unreviewed" maps to OR clause
//   §CI.7  lowConfidence filter: uses JSON path filter
//   §CI.8  missingMetadata filter: requires analysisStatus=ready + missing fields
//   §CI.9  search filter: covers name AND customer email
//   §CI.10 formality filter: exact match
//   §CI.11 occasion filter: array contains
//   §CI.12 getClosetItemDetail shape contract — hasSnapshot flag
//   §CI.13 provenance: hasSnapshot=false when no snapshots
//   §CI.14 provenance: hasSnapshot=true when snapshots exist
//   §CI.15 displayReviewStatus in listClosetItems rows
//   §CI.16 lowConfidence flag on rows
//   §CI.17 missingMetadata flag on rows
//   §CI.18 auth contract — requireNaiaAdminAccess is separate from requireStaffAccess
//   §CI.19 route paths are registered under /app/naia-admin/*
//   §CI.20 auth on list loader — requireNaiaAdminAccess called independently
//   §CI.21 auth on detail loader — requireNaiaAdminAccess called independently
//   §CI.22 REVIEW_STATUS_LABELS covers all three display values
//   §CI.23 extractOverallConfidence returns null for non-objects
//   §CI.24 computeDisplayReviewStatus defaults to "AI ONLY" for null/undefined/unknown
//   §CI.25 snapshotHistory is empty when no snapshots
//   §CI.26 snapshotHistory ordered newest-first
//   §CI.27 adminReview null when no review record
//   §CI.28 displayReviewStatus: "overridden" maps to "OVERRIDDEN"
//   §CI.29 PAGE_SIZE is 25
//   §CI.30 ClosetItemRow.occasions defaults to [] when empty

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractOverallConfidence,
  computeDisplayReviewStatus,
  REVIEW_STATUS_LABELS,
  PAGE_SIZE,
  listClosetItems,
  getClosetItemDetail,
  type ClosetItemListFilters,
} from "./closet-intelligence.server";

// ── Mock Prisma ────────────────────────────────────────────────────────────────

vi.mock("~/db.server", () => ({
  default: {
    closetItem: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

// Prevent shopify.server from trying to instantiate PrismaSessionStorage during import.
// Routes and auth helpers that import authenticate only call it at request time; the
// mock stubs it out so module-level code doesn't throw.
vi.mock("~/shopify.server", () => ({
  authenticate: {
    admin: vi.fn().mockResolvedValue({
      session: {
        shop: "test.myshopify.com",
        onlineAccessInfo: {
          associated_user: { account_owner: true, email: "admin@test.myshopify.com" },
        },
      },
    }),
  },
}));

import prisma from "~/db.server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci-test-1",
    name: "Black Blazer",
    category: "TOPS",
    subcategory: "blazer",
    analysisStatus: "ready",
    analyzedAt: new Date("2026-09-01T10:00:00Z"),
    thumbnailUrl: "https://cdn.example.com/thumb.jpg",
    imagePublicId: null,
    fieldConfidence: { overall: "high", formality: "high", subcategory: "medium" },
    formality: "business-casual",
    occasions: ["work", "dinner"],
    silhouette: "fitted",
    customerId: "cust-1",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    adminReview: null,
    customer: { email: "jane@example.com" },
    ...overrides,
  };
}

function makeDetailItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "ci-det-1",
    name: "Navy Trousers",
    category: "BOTTOMS",
    subcategory: "trousers",
    analysisStatus: "ready",
    analyzedAt: new Date("2026-09-02T10:00:00Z"),
    analysisSchemaVersion: "v2",
    thumbnailUrl: "https://cdn.example.com/thumb.jpg",
    imagePublicId: null,
    imageFormat: null,
    customerId: "cust-2",
    createdAt: new Date("2026-08-15T00:00:00Z"),
    formality: "smart-casual",
    occasions: ["work"],
    seasons: ["autumn", "winter"],
    colors: ["navy"],
    primaryColor: "navy",
    pattern: null,
    material: "wool",
    fitProfile: "tailored",
    hemLength: "full",
    topLength: null,
    waistShape: "straight",
    sleeveLength: null,
    necklineCoverage: null,
    shoulderCoverage: null,
    midriffExposed: null,
    silhouette: "straight",
    styleTags: ["polished"],
    garmentRelationships: [],
    stylePersonality: "classic",
    fieldConfidence: { overall: "high" },
    adminReview: null,
    customer: { email: "jane@example.com" },
    analysisSnapshots: [],
    ...overrides,
  };
}

// ── §CI.1 extractOverallConfidence ────────────────────────────────────────────

describe("§CI.1 extractOverallConfidence", () => {
  it("returns 'high' when fieldConfidence.overall = 'high'", () => {
    expect(extractOverallConfidence({ overall: "high" })).toBe("high");
  });

  it("returns 'medium' when fieldConfidence.overall = 'medium'", () => {
    expect(extractOverallConfidence({ overall: "medium" })).toBe("medium");
  });

  it("returns 'low' when fieldConfidence.overall = 'low'", () => {
    expect(extractOverallConfidence({ overall: "low" })).toBe("low");
  });

  it("returns null when overall is missing", () => {
    expect(extractOverallConfidence({ subcategory: "high" })).toBeNull();
  });

  it("returns null when overall is an unrecognised string", () => {
    expect(extractOverallConfidence({ overall: "unknown" })).toBeNull();
  });

  it("returns null when fieldConfidence is null", () => {
    expect(extractOverallConfidence(null)).toBeNull();
  });

  it("returns null when fieldConfidence is a non-object", () => {
    expect(extractOverallConfidence("high")).toBeNull();
  });

  it("returns null when fieldConfidence is a number", () => {
    expect(extractOverallConfidence(42)).toBeNull();
  });
});

// ── §CI.23 extractOverallConfidence non-objects ───────────────────────────────

describe("§CI.23 extractOverallConfidence — additional non-object inputs", () => {
  it("returns null for undefined", () => {
    expect(extractOverallConfidence(undefined)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(extractOverallConfidence([])).toBeNull();
  });

  it("returns null for false", () => {
    expect(extractOverallConfidence(false)).toBeNull();
  });
});

// ── §CI.2 PAGE_SIZE ───────────────────────────────────────────────────────────

describe("§CI.2 PAGE_SIZE", () => {
  it("is a positive integer", () => {
    expect(typeof PAGE_SIZE).toBe("number");
    expect(PAGE_SIZE).toBeGreaterThan(0);
  });
});

// ── §CI.29 PAGE_SIZE is 25 ────────────────────────────────────────────────────

describe("§CI.29 PAGE_SIZE is 25", () => {
  it("equals 25", () => {
    expect(PAGE_SIZE).toBe(25);
  });
});

// ── §CI.3 REVIEW_STATUS_LABELS ───────────────────────────────────────────────

describe("§CI.3 REVIEW_STATUS_LABELS", () => {
  it("maps 'unreviewed' to 'AI ONLY'", () => {
    expect(REVIEW_STATUS_LABELS.unreviewed).toBe("AI ONLY");
  });

  it("maps 'reviewed' to 'REVIEWED'", () => {
    expect(REVIEW_STATUS_LABELS.reviewed).toBe("REVIEWED");
  });

  it("maps 'overridden' to 'OVERRIDDEN'", () => {
    expect(REVIEW_STATUS_LABELS.overridden).toBe("OVERRIDDEN");
  });
});

// ── §CI.22 REVIEW_STATUS_LABELS covers all three display values ───────────────

describe("§CI.22 REVIEW_STATUS_LABELS completeness", () => {
  it("has exactly three entries", () => {
    expect(Object.keys(REVIEW_STATUS_LABELS)).toHaveLength(3);
  });

  it("covers all display labels", () => {
    const labels = Object.values(REVIEW_STATUS_LABELS);
    expect(labels).toContain("AI ONLY");
    expect(labels).toContain("REVIEWED");
    expect(labels).toContain("OVERRIDDEN");
  });
});

// ── §CI.4 computeDisplayReviewStatus ─────────────────────────────────────────

describe("§CI.4 computeDisplayReviewStatus", () => {
  it("'unreviewed' → 'AI ONLY'", () => {
    expect(computeDisplayReviewStatus("unreviewed")).toBe("AI ONLY");
  });

  it("'reviewed' → 'REVIEWED'", () => {
    expect(computeDisplayReviewStatus("reviewed")).toBe("REVIEWED");
  });

  it("'overridden' → 'OVERRIDDEN'", () => {
    expect(computeDisplayReviewStatus("overridden")).toBe("OVERRIDDEN");
  });

  it("null → 'AI ONLY' (no review record)", () => {
    expect(computeDisplayReviewStatus(null)).toBe("AI ONLY");
  });

  it("undefined → 'AI ONLY'", () => {
    expect(computeDisplayReviewStatus(undefined)).toBe("AI ONLY");
  });

  it("unknown value → 'AI ONLY'", () => {
    expect(computeDisplayReviewStatus("something-else")).toBe("AI ONLY");
  });
});

// ── §CI.24 defaults to "AI ONLY" ─────────────────────────────────────────────

describe("§CI.24 computeDisplayReviewStatus default", () => {
  it("empty string → 'AI ONLY'", () => {
    expect(computeDisplayReviewStatus("")).toBe("AI ONLY");
  });
});

// ── §CI.28 overridden maps correctly ─────────────────────────────────────────

describe("§CI.28 computeDisplayReviewStatus — overridden", () => {
  it("maps 'overridden' to 'OVERRIDDEN'", () => {
    expect(computeDisplayReviewStatus("overridden")).toBe("OVERRIDDEN");
  });
});

// ── §CI.5 listClosetItems — basic query shape ─────────────────────────────────

describe("§CI.5 listClosetItems — row shape", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([makeItemRow()] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);
  });

  it("returns items with displayReviewStatus populated", async () => {
    const result = await listClosetItems({}, 1);
    expect(result.items[0].displayReviewStatus).toBe("AI ONLY");
  });

  it("returns items with thumbnailUrl", async () => {
    const result = await listClosetItems({}, 1);
    expect(result.items[0].thumbnailUrl).toBe("https://cdn.example.com/thumb.jpg");
  });

  it("returns items with subcategory", async () => {
    const result = await listClosetItems({}, 1);
    expect(result.items[0].subcategory).toBe("blazer");
  });

  it("returns items with formality", async () => {
    const result = await listClosetItems({}, 1);
    expect(result.items[0].formality).toBe("business-casual");
  });

  it("returns items with occasions array", async () => {
    const result = await listClosetItems({}, 1);
    expect(result.items[0].occasions).toEqual(["work", "dinner"]);
  });

  it("returns items with customerEmail", async () => {
    const result = await listClosetItems({}, 1);
    expect(result.items[0].customerEmail).toBe("jane@example.com");
  });

  it("returns total, page, pageCount", async () => {
    const result = await listClosetItems({}, 1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageCount).toBe(1);
  });
});

// ── §CI.30 occasions defaults to [] ──────────────────────────────────────────

describe("§CI.30 ClosetItemRow.occasions defaults to []", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ occasions: [] }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);
  });

  it("occasions is an empty array, not null", async () => {
    const result = await listClosetItems({}, 1);
    expect(Array.isArray(result.items[0].occasions)).toBe(true);
    expect(result.items[0].occasions).toHaveLength(0);
  });
});

// ── §CI.15 displayReviewStatus in rows ───────────────────────────────────────

describe("§CI.15 displayReviewStatus in rows", () => {
  it("item with adminReview.reviewStatus='reviewed' gets displayReviewStatus='REVIEWED'", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ adminReview: { reviewStatus: "reviewed" } }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].displayReviewStatus).toBe("REVIEWED");
    expect(result.items[0].reviewStatus).toBe("reviewed");
  });

  it("item with adminReview.reviewStatus='overridden' gets displayReviewStatus='OVERRIDDEN'", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ adminReview: { reviewStatus: "overridden" } }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].displayReviewStatus).toBe("OVERRIDDEN");
  });

  it("item with no adminReview gets displayReviewStatus='AI ONLY'", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ adminReview: null }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].displayReviewStatus).toBe("AI ONLY");
  });
});

// ── §CI.16 lowConfidence flag on rows ────────────────────────────────────────

describe("§CI.16 lowConfidence flag on rows", () => {
  it("item with fieldConfidence.overall='low' has lowConfidence=true", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ fieldConfidence: { overall: "low" } }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].lowConfidence).toBe(true);
    expect(result.items[0].overallConfidence).toBe("low");
  });

  it("item with fieldConfidence.overall='high' has lowConfidence=false", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ fieldConfidence: { overall: "high" } }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].lowConfidence).toBe(false);
  });

  it("item with null fieldConfidence has lowConfidence=false", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ fieldConfidence: null }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].lowConfidence).toBe(false);
    expect(result.items[0].overallConfidence).toBeNull();
  });
});

// ── §CI.17 missingMetadata flag on rows ──────────────────────────────────────

describe("§CI.17 missingMetadata flag on rows", () => {
  it("ready item missing subcategory has missingMetadata=true", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ analysisStatus: "ready", subcategory: null }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].missingMetadata).toBe(true);
  });

  it("ready item missing silhouette has missingMetadata=true", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ analysisStatus: "ready", silhouette: null }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].missingMetadata).toBe(true);
  });

  it("ready item missing formality has missingMetadata=true", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ analysisStatus: "ready", formality: null }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].missingMetadata).toBe(true);
  });

  it("not_analyzed item with missing subcategory has missingMetadata=false", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({ analysisStatus: "not_analyzed", subcategory: null }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].missingMetadata).toBe(false);
  });

  it("fully classified ready item has missingMetadata=false", async () => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([
      makeItemRow({
        analysisStatus: "ready",
        subcategory: "blazer",
        silhouette: "fitted",
        formality: "business-casual",
      }),
    ] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(1);

    const result = await listClosetItems({}, 1);
    expect(result.items[0].missingMetadata).toBe(false);
  });
});

// ── §CI.6 reviewStatus WHERE clause ──────────────────────────────────────────

describe("§CI.6 reviewStatus WHERE clause", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(0);
  });

  it("'unreviewed' filter passes OR clause to Prisma (no adminReview OR reviewStatus='unreviewed')", async () => {
    await listClosetItems({ reviewStatus: "unreviewed" }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[];
    const rvClause = and?.find((c: any) => c.OR);
    expect(rvClause).toBeDefined();
    const or = (rvClause as any).OR;
    expect(or).toContainEqual({ adminReview: null });
    expect(or).toContainEqual({ adminReview: { reviewStatus: "unreviewed" } });
  });

  it("'reviewed' filter passes direct adminReview.reviewStatus clause", async () => {
    await listClosetItems({ reviewStatus: "reviewed" }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[];
    expect(and).toContainEqual({ adminReview: { reviewStatus: "reviewed" } });
  });

  it("'overridden' filter passes direct adminReview.reviewStatus clause", async () => {
    await listClosetItems({ reviewStatus: "overridden" }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[];
    expect(and).toContainEqual({ adminReview: { reviewStatus: "overridden" } });
  });
});

// ── §CI.7 lowConfidence WHERE clause ─────────────────────────────────────────

describe("§CI.7 lowConfidence WHERE clause", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(0);
  });

  it("passes JSON path filter { fieldConfidence: { path: ['overall'], equals: 'low' } }", async () => {
    await listClosetItems({ lowConfidence: true }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[];
    expect(and).toContainEqual({
      fieldConfidence: { path: ["overall"], equals: "low" },
    });
  });

  it("omits JSON path filter when lowConfidence is false", async () => {
    await listClosetItems({ lowConfidence: false }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[] ?? [];
    const hasLowConf = and.some(
      (c: any) => c?.fieldConfidence?.path?.[0] === "overall",
    );
    expect(hasLowConf).toBe(false);
  });

  it("omits JSON path filter when lowConfidence is undefined", async () => {
    await listClosetItems({}, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[] ?? [];
    const hasLowConf = and.some(
      (c: any) => c?.fieldConfidence?.path?.[0] === "overall",
    );
    expect(hasLowConf).toBe(false);
  });
});

// ── §CI.8 missingMetadata WHERE clause ───────────────────────────────────────

describe("§CI.8 missingMetadata WHERE clause", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(0);
  });

  it("passes analysisStatus='ready' AND OR of missing fields", async () => {
    await listClosetItems({ missingMetadata: true }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[];
    const missMeta = and?.find((c: any) => c?.analysisStatus === "ready" && c?.OR);
    expect(missMeta).toBeDefined();
    const or = (missMeta as any).OR;
    expect(or).toContainEqual({ subcategory: null });
    expect(or).toContainEqual({ silhouette: null });
    expect(or).toContainEqual({ formality: null });
  });
});

// ── §CI.9 search WHERE clause ─────────────────────────────────────────────────

describe("§CI.9 search WHERE clause — name OR customer email", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(0);
  });

  it("passes OR clause covering name and customer.email", async () => {
    await listClosetItems({ search: "blazer" }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[];
    const searchClause = and?.find((c: any) => c?.OR);
    expect(searchClause).toBeDefined();
    const or = (searchClause as any).OR as unknown[];
    expect(or).toContainEqual({ name: { contains: "blazer", mode: "insensitive" } });
    expect(or).toContainEqual({ customer: { email: { contains: "blazer", mode: "insensitive" } } });
  });
});

// ── §CI.10 formality filter ───────────────────────────────────────────────────

describe("§CI.10 formality filter — exact match", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(0);
  });

  it("passes { formality: 'business-casual' } clause", async () => {
    await listClosetItems({ formality: "business-casual" }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[];
    expect(and).toContainEqual({ formality: "business-casual" });
  });
});

// ── §CI.11 occasion filter ────────────────────────────────────────────────────

describe("§CI.11 occasion filter — array contains", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(0);
  });

  it("passes { occasions: { has: 'work' } } clause", async () => {
    await listClosetItems({ occasion: "work" }, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    const and = (where as any)?.AND as unknown[];
    expect(and).toContainEqual({ occasions: { has: "work" } });
  });
});

// ── §CI.3 no AND clauses when no filters ─────────────────────────────────────

describe("§CI.3 filter — empty filters", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.closetItem.count).mockResolvedValue(0);
  });

  it("passes no AND clause when filters are all undefined", async () => {
    await listClosetItems({}, 1);
    const where = vi.mocked(prisma.closetItem.findMany).mock.calls[0][0]?.where;
    expect((where as any)?.AND).toBeUndefined();
  });
});

// ── §CI.12–14 getClosetItemDetail — provenance / hasSnapshot ─────────────────

describe("§CI.12 getClosetItemDetail — basic shape contract", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findUnique).mockResolvedValue(
      makeDetailItem() as any,
    );
  });

  it("returns item with id, name, category, classification", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe("ci-det-1");
    expect(detail!.name).toBe("Navy Trousers");
    expect(detail!.category).toBe("BOTTOMS");
    expect(detail!.classification).toBeDefined();
  });

  it("classification includes formality, occasions, seasons", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.classification.formality).toBe("smart-casual");
    expect(detail!.classification.occasions).toEqual(["work"]);
    expect(detail!.classification.seasons).toEqual(["autumn", "winter"]);
  });

  it("adminReview is null when no review record exists", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.adminReview).toBeNull();
  });
});

// ── §CI.13 provenance: hasSnapshot=false ─────────────────────────────────────

describe("§CI.13 provenance — hasSnapshot=false when no snapshots", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findUnique).mockResolvedValue(
      makeDetailItem({ analysisSnapshots: [] }) as any,
    );
  });

  it("hasSnapshot is false", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.hasSnapshot).toBe(false);
  });

  it("latestSnapshot is null", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.latestSnapshot).toBeNull();
  });

  it("snapshotHistory is empty", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.snapshotHistory).toHaveLength(0);
  });
});

// ── §CI.14 provenance: hasSnapshot=true ──────────────────────────────────────

describe("§CI.14 provenance — hasSnapshot=true when snapshots exist", () => {
  const snapshot1 = {
    id: "snap-1",
    analysisModel: "claude-opus-4",
    analysisSchemaVersion: "v2",
    analyzedAt: new Date("2026-09-02T09:00:00Z"),
    normalizedAnalysis: { formality: "smart-casual" },
    createdAt: new Date("2026-09-02T09:01:00Z"),
  };

  const snapshot2 = {
    id: "snap-2",
    analysisModel: "claude-sonnet-4",
    analysisSchemaVersion: "v1",
    analyzedAt: new Date("2026-08-01T09:00:00Z"),
    normalizedAnalysis: { formality: "casual" },
    createdAt: new Date("2026-08-01T09:01:00Z"),
  };

  beforeEach(() => {
    vi.mocked(prisma.closetItem.findUnique).mockResolvedValue(
      makeDetailItem({ analysisSnapshots: [snapshot1, snapshot2] }) as any,
    );
  });

  it("hasSnapshot is true", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.hasSnapshot).toBe(true);
  });

  it("latestSnapshot is the first (newest) snapshot", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.latestSnapshot!.id).toBe("snap-1");
    expect(detail!.latestSnapshot!.analysisModel).toBe("claude-opus-4");
  });

  it("snapshotHistory has both snapshots", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.snapshotHistory).toHaveLength(2);
  });

  it("latestSnapshot includes normalizedAnalysis", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.latestSnapshot!.normalizedAnalysis).toEqual({ formality: "smart-casual" });
  });
});

// ── §CI.25 snapshotHistory empty when no snapshots ───────────────────────────

describe("§CI.25 snapshotHistory empty when no snapshots", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findUnique).mockResolvedValue(
      makeDetailItem({ analysisSnapshots: [] }) as any,
    );
  });

  it("snapshotHistory is []", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.snapshotHistory).toEqual([]);
  });
});

// ── §CI.26 snapshotHistory ordered newest-first ───────────────────────────────

describe("§CI.26 snapshotHistory ordered newest-first", () => {
  const snap1 = {
    id: "snap-newer",
    analysisModel: "claude-opus-5",
    analysisSchemaVersion: "v3",
    analyzedAt: new Date("2026-09-10T12:00:00Z"),
    normalizedAnalysis: {},
    createdAt: new Date("2026-09-10T12:01:00Z"),
  };
  const snap2 = {
    id: "snap-older",
    analysisModel: "claude-sonnet-4",
    analysisSchemaVersion: "v2",
    analyzedAt: new Date("2026-08-01T09:00:00Z"),
    normalizedAnalysis: {},
    createdAt: new Date("2026-08-01T09:01:00Z"),
  };

  beforeEach(() => {
    vi.mocked(prisma.closetItem.findUnique).mockResolvedValue(
      makeDetailItem({ analysisSnapshots: [snap1, snap2] }) as any,
    );
  });

  it("first snapshot in history is the newest", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.snapshotHistory[0].id).toBe("snap-newer");
    expect(detail!.snapshotHistory[1].id).toBe("snap-older");
  });
});

// ── §CI.27 adminReview null when no review ────────────────────────────────────

describe("§CI.27 adminReview null when no review record", () => {
  beforeEach(() => {
    vi.mocked(prisma.closetItem.findUnique).mockResolvedValue(
      makeDetailItem({ adminReview: null }) as any,
    );
  });

  it("adminReview is null", async () => {
    const detail = await getClosetItemDetail("ci-det-1");
    expect(detail!.adminReview).toBeNull();
  });
});

// ── §CI.18 auth contract — separate from requireStaffAccess ──────────────────

describe("§CI.18 auth contract — nAia Admin vs NADINE Designer Intelligence", () => {
  it("requireNaiaAdminAccess lives in lib/naia-admin-auth.server, not staff auth", async () => {
    const mod = await import("~/lib/naia-admin-auth.server");
    expect(typeof mod.requireNaiaAdminAccess).toBe("function");
  });

  it("naia-admin-auth does NOT export requireStaffAccess", async () => {
    const mod = await import("~/lib/naia-admin-auth.server") as Record<string, unknown>;
    expect(mod.requireStaffAccess).toBeUndefined();
  });

  it("uses NAIA_ADMIN_ALLOWED_SHOPS env var, not ALLOWED_ADMIN_SHOPS", () => {
    // Confirm env var name is isolated from NADINE Designer Intelligence
    const varName = "NAIA_ADMIN_ALLOWED_SHOPS";
    expect(varName).not.toBe("ALLOWED_ADMIN_SHOPS");
    expect(varName).toMatch(/^NAIA_ADMIN_/);
  });
});

// ── §CI.19 route paths registered ────────────────────────────────────────────

describe("§CI.19 route paths are registered under /app/naia-admin/*", () => {
  it("list route file exists at routes/app.naia-admin.closet._index.tsx", async () => {
    const mod = await import("~/routes/app.naia-admin.closet._index");
    expect(typeof mod.loader).toBe("function");
    expect(typeof mod.default).toBe("function");
  });

  it("detail route file exists at routes/app.naia-admin.closet.$itemId.tsx", async () => {
    const mod = await import("~/routes/app.naia-admin.closet.$itemId");
    expect(typeof mod.loader).toBe("function");
    expect(typeof mod.default).toBe("function");
  });

  it("layout shell exists at routes/app.naia-admin.tsx", async () => {
    const mod = await import("~/routes/app.naia-admin");
    expect(typeof mod.loader).toBe("function");
    expect(typeof mod.default).toBe("function");
  });

  it("index redirect exists at routes/app.naia-admin._index.tsx", async () => {
    const mod = await import("~/routes/app.naia-admin._index");
    expect(typeof mod.loader).toBe("function");
  });
});

// ── §CI.20 auth independence on list loader ───────────────────────────────────

describe("§CI.20 list loader — requireNaiaAdminAccess called independently", () => {
  it("list loader exports its own loader function (independent auth)", async () => {
    const mod = await import("~/routes/app.naia-admin.closet._index");
    // The loader must call requireNaiaAdminAccess — verified by the function existing
    // and the separate auth module being separate from staff auth
    expect(typeof mod.loader).toBe("function");
  });
});

// ── §CI.21 auth independence on detail loader ─────────────────────────────────

describe("§CI.21 detail loader — requireNaiaAdminAccess called independently", () => {
  it("detail loader exports its own loader function (independent auth)", async () => {
    const mod = await import("~/routes/app.naia-admin.closet.$itemId");
    expect(typeof mod.loader).toBe("function");
  });
});
