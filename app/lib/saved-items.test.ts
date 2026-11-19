// app/lib/saved-items.test.ts
//
// Pure-module tests for the facet-free, content-identity-free key scheme.
// No DB, no mocks — buildItemKey/buildSaveItemRow/slugify are pure functions.

import { describe, it, expect } from "vitest";
import {
  slugify,
  buildItemKey,
  buildSaveItemRow,
  isTrendContentType,
  isReportScopedContentType,
  isSavedSourceKind,
  isTakeawaySectionKey,
  TAKEAWAY_SECTION_KEYS,
  TREND_CONTENT_TYPES,
  savedItemToCard,
} from "./saved-items";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Softened Tailoring")).toBe("softened-tailoring");
  });

  it("strips punctuation and collapses runs of non-alphanumerics", () => {
    expect(slugify("Loro Piana — SS26!!")).toBe("loro-piana-ss26");
  });

  it("trims leading/trailing hyphens produced by leading/trailing punctuation", () => {
    expect(slugify("  —Suede Textures—  ")).toBe("suede-textures");
  });
});

describe("isTrendContentType — FACET and LOOK are not valid (Founder Decision + scope cut)", () => {
  it("accepts exactly the five v1 types", () => {
    expect(TREND_CONTENT_TYPES).toEqual(["TREND", "SIGNAL", "REFERENCE", "PRODUCT", "TAKEAWAY"]);
    for (const t of TREND_CONTENT_TYPES) expect(isTrendContentType(t)).toBe(true);
  });

  it("rejects FACET — the frozen facet vocabulary never lands here", () => {
    expect(isTrendContentType("FACET")).toBe(false);
  });

  it("rejects LOOK — SavedLook is StyleMe's own, untouched store", () => {
    expect(isTrendContentType("LOOK")).toBe(false);
  });

  it("rejects garbage input", () => {
    expect(isTrendContentType("anything-else")).toBe(false);
    expect(isTrendContentType(123)).toBe(false);
    expect(isTrendContentType(null)).toBe(false);
  });
});

describe("isReportScopedContentType", () => {
  it("PRODUCT is global", () => {
    expect(isReportScopedContentType("PRODUCT")).toBe(false);
  });
  it("everything else is report-scoped", () => {
    expect(isReportScopedContentType("TREND")).toBe(true);
    expect(isReportScopedContentType("SIGNAL")).toBe(true);
    expect(isReportScopedContentType("REFERENCE")).toBe(true);
    expect(isReportScopedContentType("TAKEAWAY")).toBe(true);
  });
});

describe("isSavedSourceKind", () => {
  it("only TREND_REPORT exists in this v1 (STYLEME/CLOSET/BUY_OR_SKIP provenance never applies to a SavedItem here)", () => {
    expect(isSavedSourceKind("TREND_REPORT")).toBe(true);
    expect(isSavedSourceKind("STYLEME")).toBe(false);
  });
});

describe("TAKEAWAY_SECTION_KEYS", () => {
  it("has exactly the 11 prose fields of ShopperEdit", () => {
    expect(TAKEAWAY_SECTION_KEYS).toHaveLength(11);
    expect(TAKEAWAY_SECTION_KEYS).toEqual([
      "yourVersion",
      "evidenceStyleDna",
      "evidencePassportSays",
      "evidenceReviews",
      "lowDataNotice",
      "yourBestRouteIn",
      "aLookToTry",
      "theBalanceToProtect",
      "worthInvestingStatement",
      "partToTake",
      "partToLeave",
    ]);
  });

  it("isTakeawaySectionKey rejects anything outside that fixed list", () => {
    expect(isTakeawaySectionKey("yourBestRouteIn")).toBe(true);
    expect(isTakeawaySectionKey("madeUpSection")).toBe(false);
  });
});

describe("buildItemKey", () => {
  it("PRODUCT is global — no reportSlug in the key, and none required", () => {
    expect(buildItemKey({ contentType: "PRODUCT", contentKey: "navy-blazer" }))
      .toBe("PRODUCT:navy-blazer");
  });

  it("TREND/SIGNAL/REFERENCE/TAKEAWAY are report-scoped — same contentKey in two reports is two keys", () => {
    const a = buildItemKey({ contentType: "TREND", contentKey: "softened-tailoring", reportSlug: "spring-2026" });
    const b = buildItemKey({ contentType: "TREND", contentKey: "softened-tailoring", reportSlug: "autumn-2026" });
    expect(a).not.toBe(b);
    expect(a).toBe("TREND:spring-2026:softened-tailoring");
  });

  it("throws for a report-scoped type with no reportSlug", () => {
    expect(() => buildItemKey({ contentType: "TREND", contentKey: "x" })).toThrow();
  });

  it("throws for an empty contentKey", () => {
    expect(() => buildItemKey({ contentType: "PRODUCT", contentKey: "" })).toThrow();
  });
});

describe("buildSaveItemRow", () => {
  const base = {
    contentType: "TREND" as const,
    contentKey: "softened-tailoring",
    reportSlug: "spring-2026",
    label: "Softened tailoring",
    sourceKind: "TREND_REPORT" as const,
  };

  it("builds a row with the derived itemKey and a trimmed label", () => {
    const row = buildSaveItemRow({ ...base, label: "  Softened   tailoring  " });
    expect(row.itemKey).toBe("TREND:spring-2026:softened-tailoring");
    expect(row.label).toBe("Softened tailoring");
  });

  it("rejects an unknown content type (covers a tampered FACET payload reaching this far)", () => {
    expect(() => buildSaveItemRow({ ...base, contentType: "FACET" as never })).toThrow();
  });

  it("rejects a missing label", () => {
    expect(() => buildSaveItemRow({ ...base, label: "   " })).toThrow();
  });

  it("drops an off-site sourcePath (absolute URL or protocol-relative) rather than storing it", () => {
    const row1 = buildSaveItemRow({ ...base, sourcePath: "https://evil.example/x" });
    expect(row1.sourcePath).toBeNull();
    const row2 = buildSaveItemRow({ ...base, sourcePath: "//evil.example/x" });
    expect(row2.sourcePath).toBeNull();
    const row3 = buildSaveItemRow({ ...base, sourcePath: "/trends/spring-2026" });
    expect(row3.sourcePath).toBe("/trends/spring-2026");
  });

  it("PRODUCT rows carry no reportSlug even when one was passed in as context", () => {
    const row = buildSaveItemRow({
      ...base,
      contentType: "PRODUCT",
      contentKey: "navy-blazer",
      reportSlug: "spring-2026",
      label: "Navy Blazer",
    });
    expect(row.reportSlug).toBeNull();
    expect(row.itemKey).toBe("PRODUCT:navy-blazer");
  });
});

describe("savedItemToCard", () => {
  it("renders a provenance line from the snapshot, not from a live report lookup", () => {
    const card = savedItemToCard({
      id: "si_1",
      itemKey: "TREND:spring-2026:softened-tailoring",
      contentType: "TREND",
      contentKey: "softened-tailoring",
      label: "Softened tailoring",
      sublabel: null,
      imageUrl: null,
      sourceKind: "TREND_REPORT",
      sourceReportTitle: "Spring 2026 Wardrobe Edit",
      sourceSeason: "Spring 2026",
      sourceContentLabel: null,
      sourcePath: "/trends/spring-2026",
      createdAt: "2026-11-19T00:00:00.000Z",
    });
    expect(card.lane).toBe("trends");
    expect(card.typeLabel).toBe("Trend");
    expect(card.provenance).toBe("From: Spring 2026 Wardrobe Edit · Spring 2026");
  });
});
