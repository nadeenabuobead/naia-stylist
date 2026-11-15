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
import {
  getEffectiveEditionPeriod,
  formatEditionMonthLabel,
  getEditionNumberMap,
  formatEditionNumber,
} from "./editorial-report-edition";
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

// Regression coverage for the 2026-11-15 UI fix: every page that showed a
// decorative edition number derived it a different way (newest-first render
// position, the admin `order` field, or array index) and the numbers
// disagreed with each other and with real chronology. getEditionNumberMap is
// now the one source of truth every surface must use instead.
describe("getEditionNumberMap", () => {
  it("numbers the three real fixture reports 01/02/03 in April/May/June order", () => {
    const map = getEditionNumberMap(trendReports);
    expect(map.get("2026-04")).toBe(1);
    expect(map.get("2026-05")).toBe(2);
    expect(map.get("2026-06")).toBe(3);
  });

  it("assigns the number from real chronology, independent of input array order", () => {
    const reports = [
      { editionMonth: "2026-06", publishedAt: "2026-06-30" },
      { editionMonth: "2026-04", publishedAt: "2026-06-30" },
      { editionMonth: "2026-05", publishedAt: "2026-06-30" },
    ];
    const map = getEditionNumberMap(reports);
    expect(map.get("2026-04")).toBe(1);
    expect(map.get("2026-05")).toBe(2);
    expect(map.get("2026-06")).toBe(3);
  });

  it("gives reports sharing one edition period the same number", () => {
    const reports = [
      { editionMonth: "2026-06", publishedAt: "2026-06-30" },
      { editionMonth: "2026-06", publishedAt: "2026-06-29" },
      { editionMonth: "2026-04", publishedAt: "2026-06-30" },
    ];
    const map = getEditionNumberMap(reports);
    expect(map.get("2026-06")).toBe(2);
    expect(map.get("2026-04")).toBe(1);
    expect(map.size).toBe(2);
  });

  it("excludes reports with no parseable period rather than fabricating one", () => {
    const reports = [
      { editionMonth: undefined, publishedAt: "" },
      { editionMonth: "2026-04", publishedAt: "2026-06-30" },
    ];
    const map = getEditionNumberMap(reports);
    expect(map.size).toBe(1);
    expect(map.get("2026-04")).toBe(1);
  });
});

describe("formatEditionNumber", () => {
  it("zero-pads to two digits", () => {
    expect(formatEditionNumber(1)).toBe("01");
    expect(formatEditionNumber(12)).toBe("12");
  });

  it("returns null for null/undefined, never a fabricated '00'", () => {
    expect(formatEditionNumber(null)).toBeNull();
    expect(formatEditionNumber(undefined)).toBeNull();
  });
});
