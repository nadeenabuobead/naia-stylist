// app/routes/trends.phase4.test.ts
// Phase 4 structural tests — Public Trend Reports UI, Navigation, CTA & Lens Visual System.
//
// Run: node --test --import tsx/esm app/routes/trends.phase4.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { trendReports } from "../lib/trend-reports.js";
import {
  PROFESSIONAL_LENS_CONTENT,
  VALID_LENSES,
  LENS_LABELS,
  type LensKey,
} from "../lib/professional-lens-content.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readRoute(name: string): string {
  return readFileSync(resolve(__dirname, name), "utf-8");
}

const trendsJsx = readRoute("trends.jsx");
const slugTsx = readRoute("trends.$slug.tsx");
const lensTsx = readRoute("trends.$slug.lens.$lens.tsx");

const REPORTS = ["spring-2026-soft-structure", "modern-tailoring-spring-2026", "spring-2026-colour-direction"] as const;
const LENSES = Array.from(VALID_LENSES) as string[];

// ─── Nav: NADINE wordmark present in all 3 routes ─────────────────────────────

describe("NADINE wordmark in all public trend routes", () => {
  it("trends.jsx contains NADINE wordmark", () => {
    assert.ok(trendsJsx.includes(">NADINE<"), "NADINE wordmark must appear in trends.jsx");
  });
  it("trends.$slug.tsx contains NADINE wordmark", () => {
    assert.ok(slugTsx.includes(">NADINE<"), "NADINE wordmark must appear in trends.$slug.tsx");
  });
  it("trends.$slug.lens.$lens.tsx contains NADINE wordmark", () => {
    assert.ok(lensTsx.includes(">NADINE<"), "NADINE wordmark must appear in trends.$slug.lens.$lens.tsx");
  });
});

// ─── Logo links to /trends (public homepage — / is authenticated dashboard) ───

describe("Logo (NADINE wordmark) links to /trends", () => {
  it("trends.jsx: NADINE links to /trends", () => {
    assert.ok(
      trendsJsx.includes('to="/trends" className="pub-header-logo">NADINE'),
      "trends.jsx NADINE must link to /trends, not / (/ is authenticated dashboard)",
    );
  });
  it("trends.$slug.tsx: NADINE links to /trends", () => {
    assert.ok(
      slugTsx.includes('to="/trends" className="psl-header-logo">NADINE'),
      "trends.$slug.tsx NADINE must link to /trends, not / (/ is authenticated dashboard)",
    );
  });
  it("trends.$slug.lens.$lens.tsx: NADINE links to /trends", () => {
    assert.ok(
      lensTsx.includes('to="/trends" className="tr-header-logo">NADINE'),
      "trends.$slug.lens.$lens.tsx NADINE must link to /trends, not / (/ is authenticated dashboard)",
    );
  });
});

// ─── TREND REPORTS active state in all 3 routes ───────────────────────────────

describe("TREND REPORTS nav link marked active", () => {
  it("trends.jsx: TREND REPORTS gets active class", () => {
    assert.ok(
      trendsJsx.includes('"/trends" ? " active"'),
      "trends.jsx must mark /trends nav link as active",
    );
  });
  it("trends.$slug.tsx: TREND REPORTS gets active class", () => {
    assert.ok(
      slugTsx.includes('"/trends" ? " active"'),
      "trends.$slug.tsx must mark /trends nav link as active",
    );
  });
  it("trends.$slug.lens.$lens.tsx: TREND REPORTS gets active class", () => {
    assert.ok(
      lensTsx.includes('"/trends" ? " active"'),
      "trends.$slug.lens.$lens.tsx must mark /trends nav link as active",
    );
  });
});

// ─── naiaTake rendered in trends.$slug.tsx ────────────────────────────────────

describe("naiaTake rendered, naiaInterpretation/naiaVerdict removed", () => {
  it("trends.$slug.tsx renders naiaTake", () => {
    assert.ok(
      slugTsx.includes("report.naiaTake") && slugTsx.includes("psl-naia-take"),
      "naiaTake must be rendered with psl-naia-take class",
    );
  });
  it("trends.$slug.tsx does not render naiaInterpretation block", () => {
    assert.ok(
      !slugTsx.includes("nAia Interpretation"),
      "naiaInterpretation heading must not appear in trends.$slug.tsx",
    );
  });
  it("trends.$slug.tsx does not render naiaVerdict block", () => {
    assert.ok(
      !slugTsx.includes("nAia Verdict"),
      "naiaVerdict heading must not appear in trends.$slug.tsx",
    );
  });
  it("trend-reports.ts: all published reports have naiaTake", () => {
    for (const r of trendReports.filter((r) => r.published)) {
      assert.ok(r.naiaTake && r.naiaTake.length > 0, `${r.slug} must have naiaTake`);
    }
  });
});

// ─── naiaTake position: before Investment Notes ────────────────────────────────

describe("naiaTake appears before Investment Notes in source order", () => {
  it("trends.$slug.tsx: naiaTake block precedes Investment Notes block", () => {
    const takePosStart = slugTsx.indexOf("nAia Take");
    const invPos = slugTsx.indexOf("Investment Notes");
    assert.ok(takePosStart !== -1, "nAia Take label must appear in source");
    assert.ok(invPos !== -1, "Investment Notes must appear in source");
    assert.ok(takePosStart < invPos, "nAia Take must appear before Investment Notes");
  });
});

// ─── CTA descriptors in trends.$slug.tsx ─────────────────────────────────────

describe("Personal CTA describes the 4 personalisation factors", () => {
  it("CTA mentions Style DNA", () => {
    assert.ok(slugTsx.includes("Style DNA"), "CTA must mention Style DNA");
  });
  it("CTA mentions wardrobe gaps", () => {
    assert.ok(slugTsx.includes("wardrobe gaps") || slugTsx.includes("wardrobe has gaps"), "CTA must mention wardrobe gaps");
  });
  it("CTA mentions what you already own / Closet", () => {
    assert.ok(
      slugTsx.includes("already own") || slugTsx.includes("Closet"),
      "CTA must mention existing wardrobe / Closet",
    );
  });
  it("CTA mentions feedback / outfit ratings", () => {
    assert.ok(
      slugTsx.includes("feedback") || slugTsx.includes("rated") || slugTsx.includes("outfit"),
      "CTA must mention previous feedback or outfit ratings",
    );
  });
});

// ─── My Edit is NOT styled with burgundy active border in trends.$slug.tsx ────

describe("My Edit is visually separated from professional lenses", () => {
  it("trends.$slug.tsx: lens nav has no .my-edit class with burgundy border", () => {
    assert.ok(
      !slugTsx.includes(".psl-lens-btn.my-edit"),
      ".psl-lens-btn.my-edit (burgundy border) must be removed",
    );
  });
  it("trends.$slug.tsx: My Edit appears after professional lenses in lens nav", () => {
    const proLensPos = slugTsx.indexOf("psl-lens-btn");
    const myEditPos = slugTsx.indexOf("psl-my-edit-btn");
    assert.ok(proLensPos !== -1, "professional lens buttons must exist");
    assert.ok(myEditPos !== -1, "psl-my-edit-btn must exist");
    assert.ok(proLensPos < myEditPos, "professional lenses must appear before My Edit button");
  });
});

// ─── My Edit separation in lens page ─────────────────────────────────────────

describe("Professional lenses appear before My Edit on lens page", () => {
  it("lens page: professional lenses in lens nav before My Edit section", () => {
    const proLensPos = lensTsx.indexOf("tr-lens-nav-row");
    const myEditPos = lensTsx.indexOf("tr-my-edit-sep");
    assert.ok(proLensPos !== -1, "tr-lens-nav-row must exist");
    assert.ok(myEditPos !== -1, "tr-my-edit-sep must exist");
    assert.ok(proLensPos < myEditPos, "professional lens row must precede My Edit separator");
  });
});

// ─── Personal CTA exists on lens pages ───────────────────────────────────────

describe("Personal CTA rendered on lens page", () => {
  it("trends.$slug.lens.$lens.tsx has tr-personal-cta section", () => {
    assert.ok(
      lensTsx.includes("tr-personal-cta"),
      "lens page must have a personal CTA section",
    );
  });
  it("lens page CTA links to /trends/my-edits/", () => {
    assert.ok(
      lensTsx.includes("/trends/my-edits/"),
      "lens page personal CTA must link to /trends/my-edits/",
    );
  });
});

// ─── data-lens attribute on lens page wrapper ─────────────────────────────────

describe("data-lens attribute applied for per-lens CSS differentiation", () => {
  it("lens page outer wrapper has data-lens={lens}", () => {
    assert.ok(
      lensTsx.includes("data-lens={lens}"),
      "outer wrapper must have data-lens={lens} for CSS differentiation",
    );
  });
});

// ─── My Edit link URL is canonical (/trends/my-edits/:slug) ──────────────────

describe("My Edit link uses canonical URL", () => {
  it("lens page: My Edit links to /trends/my-edits/ not /trends/:slug/edit", () => {
    assert.ok(
      !lensTsx.includes(`/trends/\${report.slug}/edit`),
      "lens page must not link to old /edit URL",
    );
    assert.ok(
      lensTsx.includes("/trends/my-edits/"),
      "lens page must link to /trends/my-edits/ canonical URL",
    );
  });
});

// ─── Featured title: no hard <br /> between title parts ──────────────────────

describe("Featured report title uses no hard line break", () => {
  it("trends.jsx: pub-featured-title has no <br /> between title parts", () => {
    const featuredTitleBlock = trendsJsx.slice(
      trendsJsx.indexOf("pub-featured-title"),
      trendsJsx.indexOf("pub-featured-title") + 400,
    );
    assert.ok(
      !featuredTitleBlock.includes("<br />"),
      "pub-featured-title must not use <br /> to force a line break",
    );
  });
  it("trends.$slug.tsx: psl-hero-title has no hard <br /> between title parts", () => {
    const heroTitleBlock = slugTsx.slice(
      slugTsx.indexOf("psl-hero-title"),
      slugTsx.indexOf("psl-hero-title") + 300,
    );
    assert.ok(
      !heroTitleBlock.includes("<br />"),
      "psl-hero-title must not use <br /> to force a line break",
    );
  });
});

// ─── All 15 lens/report combinations still present in content file ────────────

describe("All 15 report/lens combinations present in professional-lens-content", () => {
  for (const report of REPORTS) {
    for (const lens of LENSES) {
      it(`${report} / ${lens}`, () => {
        const r = PROFESSIONAL_LENS_CONTENT[report];
        assert.ok(r, `Report not found: ${report}`);
        const l = r[lens as LensKey];
        assert.ok(l, `Lens not found: ${lens} in ${report}`);
        assert.ok(l.modules.length > 0, "modules array must not be empty");
      });
    }
  }
});

// ─── Phase 1/2/3 content unchanged guard ─────────────────────────────────────

describe("Phase 1: naiaTake authored content preserved in trend-reports.ts", () => {
  it("soft-structure naiaTake contains 'Soft Structure criterion'", () => {
    const r = trendReports.find((r) => r.slug === "spring-2026-soft-structure");
    assert.ok(r?.naiaTake?.includes("Soft Structure"), "soft-structure naiaTake must be preserved");
  });
});

describe("Phase 2: Rising/Fading signals still TrendSignal[]", () => {
  for (const r of trendReports.filter((r) => r.rising && r.rising.length > 0)) {
    it(`${r.slug} rising signals have signal/why/source`, () => {
      for (const sig of r.rising!) {
        assert.ok(typeof sig.signal === "string" && sig.signal.length > 0);
        assert.ok(typeof sig.why === "string");
        assert.ok(typeof sig.source === "string");
      }
    });
  }
});

describe("Phase 3: Designer first module is still THE DESIGN CODE", () => {
  for (const slug of REPORTS) {
    it(slug, () => {
      const mods = PROFESSIONAL_LENS_CONTENT[slug].designer.modules;
      assert.equal((mods[0] as { label: string }).label, "THE DESIGN CODE");
    });
  }
});

describe("Phase 3: CD still has exactly 6 modules", () => {
  for (const slug of REPORTS) {
    it(slug, () => {
      assert.equal(PROFESSIONAL_LENS_CONTENT[slug]["creative-director"].modules.length, 6);
    });
  }
});

describe("LENS_LABELS contains all 5 professional lenses", () => {
  it("all lens keys have labels", () => {
    const expected = ["designer", "buyer", "marketer", "creative-director", "stylist"];
    for (const key of expected) {
      assert.ok(LENS_LABELS[key as LensKey], `LENS_LABELS must have entry for ${key}`);
    }
  });
});
