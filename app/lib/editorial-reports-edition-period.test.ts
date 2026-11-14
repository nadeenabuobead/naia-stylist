// app/lib/editorial-reports-edition-period.test.ts
//
// Regression coverage for getEffectiveEditionPeriod/formatEditionMonthLabel
// (editorial-report-edition.ts) — the shared logic behind the 2026-11-14
// fix for three reports that were all grouped under the same month despite
// being intended as three different monthly editions. These two pure
// functions are what every customer-facing surface (My Trend Edits, the
// public landing page, the report page, its lens variant) now derives a
// report's displayed month from, so they're tested directly rather than
// only indirectly through each page.

import { describe, it, expect } from "vitest";
import { getEffectiveEditionPeriod, formatEditionMonthLabel } from "./editorial-report-edition";
import { trendReports } from "./trend-reports";

// Direct regression test against the real fixture content — this is where
// the original bug actually lived (all three reports authored with the
// same publishedAt, the day the fixture file was written, rather than
// genuine distinct editorial dates). Guards against the fix regressing to
// "all one month" if the static data is ever edited again without
// re-checking this.
describe("trendReports — real fixture data has three genuinely different editions", () => {
  const bySlug = Object.fromEntries(trendReports.map((r) => [r.slug, r]));

  it("soft-structure, modern-tailoring, and colour-direction each have their own distinct editionMonth", () => {
    const softStructure = getEffectiveEditionPeriod(bySlug["spring-2026-soft-structure"]);
    const modernTailoring = getEffectiveEditionPeriod(bySlug["modern-tailoring-spring-2026"]);
    const colourDirection = getEffectiveEditionPeriod(bySlug["spring-2026-colour-direction"]);

    expect(softStructure).toBe("2026-04");
    expect(modernTailoring).toBe("2026-05");
    expect(colourDirection).toBe("2026-06");

    // The real regression check: all three must be distinct from each other.
    expect(new Set([softStructure, modernTailoring, colourDirection]).size).toBe(3);
  });

  it("publishedAt is preserved unchanged on all three — the fix never rewrites publication history", () => {
    expect(bySlug["spring-2026-soft-structure"].publishedAt).toBe("2026-06-30");
    expect(bySlug["modern-tailoring-spring-2026"].publishedAt).toBe("2026-06-30");
    expect(bySlug["spring-2026-colour-direction"].publishedAt).toBe("2026-06-30");
  });
});

describe("getEffectiveEditionPeriod", () => {
  it("prefers a valid editionMonth over publishedAt", () => {
    expect(
      getEffectiveEditionPeriod({ editionMonth: "2026-04", publishedAt: "2026-06-30" }),
    ).toBe("2026-04");
  });

  it("falls back to publishedAt's own month when editionMonth is absent (a pre-existing row)", () => {
    expect(
      getEffectiveEditionPeriod({ editionMonth: undefined, publishedAt: "2026-03-15" }),
    ).toBe("2026-03");
  });

  it("falls back to publishedAt when editionMonth is an empty string", () => {
    expect(
      getEffectiveEditionPeriod({ editionMonth: "", publishedAt: "2026-03-15" }),
    ).toBe("2026-03");
  });

  it("falls back to publishedAt when editionMonth is malformed, rather than trusting bad data", () => {
    expect(
      getEffectiveEditionPeriod({ editionMonth: "not-a-month", publishedAt: "2026-03-15" }),
    ).toBe("2026-03");
  });

  it("returns null when neither editionMonth nor publishedAt parse — never fabricates a date", () => {
    expect(
      getEffectiveEditionPeriod({ editionMonth: undefined, publishedAt: "" }),
    ).toBeNull();
  });
});

describe("formatEditionMonthLabel", () => {
  it("formats a YYYY-MM period as 'Month Year'", () => {
    expect(formatEditionMonthLabel("2026-04")).toBe("April 2026");
    expect(formatEditionMonthLabel("2026-12")).toBe("December 2026");
  });

  it("returns 'Undated' for null, never a fabricated month", () => {
    expect(formatEditionMonthLabel(null)).toBe("Undated");
  });
});
