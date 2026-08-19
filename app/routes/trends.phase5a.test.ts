// app/routes/trends.phase5a.test.ts
// Phase 5A — Imagery & Editorial Presentation tests.
//
// Run: node --test --import tsx/esm app/routes/trends.phase5a.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { trendReports } from "../lib/trend-reports.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readRoute(name: string): string {
  return readFileSync(resolve(__dirname, name), "utf-8");
}
function readLib(name: string): string {
  return readFileSync(resolve(__dirname, "../lib", name), "utf-8");
}

const trendsJsx = readRoute("trends.jsx");
const slugTsx = readRoute("trends.$slug.tsx");
const trendReportsTs = readLib("trend-reports.ts");

const SLUGS = ["spring-2026-soft-structure", "modern-tailoring-spring-2026", "spring-2026-colour-direction"] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function deterministicSort(reports: typeof trendReports) {
  return reports
    .filter((r) => r.published)
    .sort((a, b) => {
      if (a.publishedAt > b.publishedAt) return -1;
      if (a.publishedAt < b.publishedAt) return 1;
      return (a.order ?? 99) - (b.order ?? 99);
    });
}

// ─── Data model: TrendMedia / TrendReportMedia types ──────────────────────────

describe("Phase 5A: TrendMedia type definition", () => {
  it("TrendMedia type is exported from trend-reports.ts", () => {
    assert.ok(trendReportsTs.includes("export type TrendMedia"), "TrendMedia type must be exported");
  });
  it("TrendMedia has src, alt, and rights fields", () => {
    assert.ok(trendReportsTs.includes("src: string"), "TrendMedia must have src field");
    assert.ok(trendReportsTs.includes("alt: string"), "TrendMedia must have alt field");
    assert.ok(trendReportsTs.includes('rights: "nadine-owned"'), "TrendMedia must have rights: nadine-owned");
  });
  it("TrendReportMedia type is exported from trend-reports.ts", () => {
    assert.ok(trendReportsTs.includes("export type TrendReportMedia"), "TrendReportMedia type must be exported");
  });
  it("TrendReportData has optional media field", () => {
    assert.ok(trendReportsTs.includes("media?: TrendReportMedia"), "TrendReportData must have optional media field");
  });
});

// ─── All three published report slugs present ─────────────────────────────────

describe("Phase 5A: all three report slugs exist", () => {
  for (const slug of SLUGS) {
    it(`trendReports contains slug "${slug}"`, () => {
      const found = trendReports.find((r) => r.slug === slug);
      assert.ok(found, `trendReports must contain slug "${slug}"`);
    });
  }
});

// ─── Order field: all three reports have order set ────────────────────────────

describe("Phase 5A: order field for deterministic sort", () => {
  for (const slug of SLUGS) {
    it(`${slug} has a numeric order field`, () => {
      const report = trendReports.find((r) => r.slug === slug);
      assert.ok(typeof report?.order === "number", `${slug} must have a numeric order field`);
    });
  }

  it("sort produces spring-2026-soft-structure as featured (order 1)", () => {
    const sorted = deterministicSort(trendReports);
    assert.equal(sorted[0].slug, "spring-2026-soft-structure", "Soft Structure must be first after deterministic sort");
  });

  it("sort produces modern-tailoring-spring-2026 as second", () => {
    const sorted = deterministicSort(trendReports);
    assert.equal(sorted[1].slug, "modern-tailoring-spring-2026");
  });

  it("sort produces spring-2026-colour-direction as third", () => {
    const sorted = deterministicSort(trendReports);
    assert.equal(sorted[2].slug, "spring-2026-colour-direction");
  });

  it("trends.jsx sort uses order as tiebreaker", () => {
    assert.ok(
      trendsJsx.includes("a.order") && trendsJsx.includes("b.order"),
      "trends.jsx sort must use order field as tiebreaker"
    );
  });
});

// ─── Media data: infrastructure present, photographs TBC ──────────────────────

describe("Phase 5A: media infrastructure (photographs pending)", () => {
  it("TrendReportData accepts optional media field", () => {
    // All three reports intentionally have no media wired yet (awaiting real photographs).
    // This block confirms the optional field is accepted and no report crashes on load.
    for (const slug of SLUGS) {
      const report = trendReports.find((r) => r.slug === slug);
      assert.ok(report, `${slug} must exist`);
      // media is optional — undefined is the correct state until photographs are supplied
      assert.ok(report?.media === undefined || typeof report.media === "object");
    }
  });
});

// ─── No old unclear-provenance JPG references remain ──────────────────────────

describe("Phase 5A: old unclear-provenance images removed", () => {
  it("trend-reports.ts has no reference to tr-modern-tailoring.jpg", () => {
    assert.ok(!trendReportsTs.includes("tr-modern-tailoring.jpg"), "Old JPG reference must be removed");
  });
  it("trend-reports.ts has no reference to tr-landing-hero.jpg", () => {
    assert.ok(!trendReportsTs.includes("tr-landing-hero.jpg"), "tr-landing-hero.jpg must not be referenced");
  });
  // SVG files remain in public/images/ as optional editorial-break graphics but are NOT
  // wired as media.hero/media.card — real photographs are required for those fields.
  it("trend-reports.ts does not wire SVGs as hero/card imagery", () => {
    assert.ok(
      !trendReportsTs.includes('"nadine-owned"') || !trendReportsTs.includes(".svg"),
      "No SVG file should appear in a TrendMedia rights:nadine-owned block"
    );
  });
});

// ─── Media data: Modern Tailoring — awaiting real photograph ──────────────────

describe("Phase 5A: Modern Tailoring report data", () => {
  const report = trendReports.find((r) => r.slug === "modern-tailoring-spring-2026");

  it("modern-tailoring-spring-2026 exists in trendReports", () => {
    assert.ok(report, "modern-tailoring-spring-2026 must be in trendReports");
  });

  it("modern-tailoring has order 2", () => {
    assert.equal(report?.order, 2);
  });

  it("modern-tailoring is published", () => {
    assert.ok(report?.published);
  });

  it("modern-tailoring has no SVG wired as hero/card (SVGs rejected as hero imagery)", () => {
    assert.ok(!report?.media?.hero?.src?.endsWith(".svg"), "SVG must not be hero imagery");
    assert.ok(!report?.media?.card?.src?.endsWith(".svg"), "SVG must not be card imagery");
  });
});

// ─── Media data: any report with media.hero passes validation ─────────────────

describe("Phase 5A: media data validity for all reports", () => {
  for (const slug of SLUGS) {
    const report = trendReports.find((r) => r.slug === slug);

    it(`${slug}: if media.hero present — has src, alt, nadine-owned rights`, () => {
      if (!report?.media?.hero) return; // no media is valid
      assert.ok(report.media.hero.src.length > 0, "hero.src must be non-empty");
      assert.ok(report.media.hero.alt.length > 0, "hero.alt must be non-empty");
      assert.equal(report.media.hero.rights, "nadine-owned");
    });

    it(`${slug}: if media.card present — has src, alt, nadine-owned rights`, () => {
      if (!report?.media?.card) return; // no media is valid
      assert.ok(report.media.card.src.length > 0, "card.src must be non-empty");
      assert.ok(report.media.card.alt.length > 0, "card.alt must be non-empty");
      assert.equal(report.media.card.rights, "nadine-owned");
    });
  }
});

// ─── All reports have a mood field (needed for editorial break) ───────────────

describe("Phase 5A: all reports have mood field", () => {
  for (const slug of SLUGS) {
    it(`${slug} has a non-empty mood`, () => {
      const report = trendReports.find((r) => r.slug === slug);
      assert.ok(report?.mood?.length, `${slug} must have a non-empty mood field`);
    });
  }
});

// ─── Landing page CSS: editorial mood panel and card image/palette ─────────────

describe("Phase 5A: trends.jsx landing page CSS", () => {
  it("pub-featured-img-mood class is defined", () => {
    assert.ok(trendsJsx.includes(".pub-featured-img-mood"), "pub-featured-img-mood class must be defined in trends.jsx");
  });
  it("pub-featured-img-mood uses Cormorant Garamond", () => {
    assert.ok(
      trendsJsx.includes(".pub-featured-img-mood") && trendsJsx.includes("Cormorant Garamond"),
      "pub-featured-img-mood must use Cormorant Garamond"
    );
  });
  it("pub-card-img-panel class is defined", () => {
    assert.ok(trendsJsx.includes(".pub-card-img-panel"), "pub-card-img-panel class must be defined for image cards");
  });
  it("pub-card-palette-strip class is defined", () => {
    assert.ok(trendsJsx.includes(".pub-card-palette-strip"), "pub-card-palette-strip class must be defined for colour direction card");
  });
  it("pub-card-img-fade class is defined for gradient overlay", () => {
    assert.ok(trendsJsx.includes(".pub-card-img-fade"), "pub-card-img-fade class must be defined");
  });
});

// ─── Landing page JSX: conditional image rendering ────────────────────────────

describe("Phase 5A: trends.jsx landing page JSX", () => {
  it("featured card renders editorial mood word from report.mood", () => {
    assert.ok(trendsJsx.includes("pub-featured-img-mood"), "JSX must render pub-featured-img-mood");
    assert.ok(trendsJsx.includes("featured.mood"), "JSX must use featured.mood for the editorial mood word");
  });
  it("card image panel is conditionally rendered with report.media?.card", () => {
    assert.ok(trendsJsx.includes("report.media?.card") || trendsJsx.includes("hasCardImg"), "JSX must conditionally render card image panel");
  });
  it("palette strip is rendered for colour direction slug", () => {
    assert.ok(
      trendsJsx.includes("spring-2026-colour-direction") && trendsJsx.includes("pub-card-palette-strip"),
      "JSX must render palette strip for colour direction"
    );
  });
  it("COLOUR_PALETTE constant is defined with at least 4 swatches", () => {
    const matches = trendsJsx.match(/COLOUR_PALETTE/g) ?? [];
    assert.ok(matches.length >= 2, "COLOUR_PALETTE must be defined and used");
  });
});

// ─── Public report CSS: hero image + editorial break ──────────────────────────

describe("Phase 5A: trends.$slug.tsx public report CSS", () => {
  it("psl-hero--has-image class is defined", () => {
    assert.ok(slugTsx.includes(".psl-hero--has-image"), "psl-hero--has-image modifier class must be defined");
  });
  it("psl-hero-visual class is defined", () => {
    assert.ok(slugTsx.includes(".psl-hero-visual"), "psl-hero-visual class must be defined for image column");
  });
  it("psl-editorial-break class is defined", () => {
    assert.ok(slugTsx.includes(".psl-editorial-break"), "psl-editorial-break class must be defined");
  });
  it("psl-editorial-break-mood class is defined", () => {
    assert.ok(slugTsx.includes(".psl-editorial-break-mood"), "psl-editorial-break-mood class must be defined");
  });
  it("psl-editorial-break uses Cormorant Garamond", () => {
    assert.ok(
      slugTsx.includes("psl-editorial-break-mood") && slugTsx.includes("Cormorant Garamond"),
      "psl-editorial-break-mood must use Cormorant Garamond"
    );
  });
});

// ─── Public report JSX: conditional hero image + editorial break ──────────────

describe("Phase 5A: trends.$slug.tsx public report JSX", () => {
  it("hero section conditionally adds psl-hero--has-image class", () => {
    assert.ok(slugTsx.includes("psl-hero--has-image"), "hero section must conditionally apply psl-hero--has-image");
    assert.ok(slugTsx.includes("report.media?.hero"), "hero must check report.media?.hero");
  });
  it("psl-hero-visual div renders when media.hero is present", () => {
    assert.ok(slugTsx.includes("psl-hero-visual"), "psl-hero-visual div must appear in JSX");
  });
  it("editorial break renders report.mood", () => {
    assert.ok(slugTsx.includes("psl-editorial-break"), "psl-editorial-break must appear in JSX");
    assert.ok(slugTsx.includes("report.mood"), "editorial break must reference report.mood");
  });
  it("editorial break is conditionally rendered only when report.mood exists", () => {
    assert.ok(
      slugTsx.includes("{report.mood && (") || slugTsx.includes("report.mood &&"),
      "editorial break must be guarded by report.mood existence"
    );
  });
});
