// Trend Report normalisation tests.
//
// Proves that the DB-to-canonical adapter in editorial-reports.normalise.ts
// correctly maps the proven staging DB field names to the canonical
// TrendSignal / TrendReportReferenceCard / TrendReportSource types, and that
// the filter predicates drop malformed rows.
//
// Uses the exact runtime objects extracted from staging on 2026-08-25:
//   rising[0]   = { trend: "Linen as a year-round fabric", why: "..." }
//   ref[0]      = { label: "Loro Piana SS26", quote: "...", why: "..." }
//   source[0]   = { label: "Vogue Runway SS26", url: "https://...", date: "2025-10-01" }
//   source[1]   = { label: "Business of Fashion", url: "...", date: "...", note: "Trend analysis" }

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normaliseSignal,
  normaliseReference,
  normaliseSource,
  signalHasContent,
  referenceHasContent,
  sourceHasContent,
} from "./editorial-reports.normalise";
import { trendReports } from "./trend-reports";

// ── A. Rising / Fading — DB shape ─────────────────────────────────────────────

describe("A — normaliseSignal: DB legacy shape { trend, why }", () => {
  const DB_RISING = {
    trend: "Linen as a year-round fabric",
    why: "No longer limited to summer — weight and weave variations now make it appropriate across seasons.",
  };

  it("maps trend → signal", () => {
    const out = normaliseSignal(DB_RISING);
    assert.equal(out.signal, "Linen as a year-round fabric");
  });

  it("preserves why", () => {
    const out = normaliseSignal(DB_RISING);
    assert.equal(out.why, DB_RISING.why);
  });

  it("source defaults to empty string when absent", () => {
    const out = normaliseSignal(DB_RISING);
    assert.equal(out.source, "");
  });

  it("signalHasContent passes a valid DB item", () => {
    assert.ok(signalHasContent(normaliseSignal(DB_RISING)));
  });
});

// ── B. Rising / Fading — canonical shape already present ──────────────────────

describe("B — normaliseSignal: canonical shape { signal, why, source }", () => {
  const CANONICAL = {
    signal: "Fluid tailoring",
    why: "Replacing rigid structure with drape.",
    source: "Vogue Runway SS26",
  };

  it("canonical signal is not overridden by absent trend key", () => {
    const out = normaliseSignal(CANONICAL);
    assert.equal(out.signal, "Fluid tailoring");
  });

  it("preserves canonical source", () => {
    const out = normaliseSignal(CANONICAL);
    assert.equal(out.source, "Vogue Runway SS26");
  });
});

// ── C. Rising / Fading — canonical key wins when both present ─────────────────

describe("C — normaliseSignal: canonical key takes priority over legacy", () => {
  const BOTH = { signal: "CANONICAL", trend: "LEGACY", why: "test" };

  it("signal wins over trend when both present", () => {
    const out = normaliseSignal(BOTH);
    assert.equal(out.signal, "CANONICAL");
  });
});

// ── D. Rising / Fading — empty source does not produce a visible element ──────

describe("D — source subline: empty source produces falsy value", () => {
  it("source is empty string — falsy guard in renderer hides the span", () => {
    const out = normaliseSignal({ trend: "Something", why: "Because" });
    // Renderer uses {r.source && <span>…</span>} — empty string is falsy
    assert.equal(!!out.source, false);
  });
});

// ── E. Malformed signals are filtered ─────────────────────────────────────────

describe("E — signalHasContent filter", () => {
  it("drops item with no trend and no signal", () => {
    assert.equal(signalHasContent(normaliseSignal({ why: "orphaned why" })), false);
  });

  it("drops empty object", () => {
    assert.equal(signalHasContent(normaliseSignal({})), false);
  });

  it("keeps item with trend only", () => {
    assert.equal(signalHasContent(normaliseSignal({ trend: "something" })), true);
  });
});

// ── F. Reference — DB shape ───────────────────────────────────────────────────

describe("F — normaliseReference: DB shape { label, quote, why }", () => {
  const DB_REF = {
    label: "Loro Piana SS26",
    quote: "The collection moved away from conspicuous craftsmanship toward something more personal.",
    why: "Clear example of the soft-structure direction in premium market.",
  };

  it("maps label → brand", () => {
    const out = normaliseReference(DB_REF);
    assert.equal(out.brand, "Loro Piana SS26");
  });

  it("maps quote → signal", () => {
    const out = normaliseReference(DB_REF);
    assert.equal(out.signal, DB_REF.quote);
  });

  it("maps why → naiaRead", () => {
    const out = normaliseReference(DB_REF);
    assert.equal(out.naiaRead, DB_REF.why);
  });

  it("collection is undefined when absent", () => {
    const out = normaliseReference(DB_REF);
    assert.equal(out.collection, undefined);
  });

  it("referenceHasContent passes a valid DB ref", () => {
    assert.ok(referenceHasContent(normaliseReference(DB_REF)));
  });
});

// ── G. Reference — canonical key takes priority ───────────────────────────────

describe("G — normaliseReference: canonical keys win when both present", () => {
  it("brand wins over label", () => {
    const out = normaliseReference({ brand: "CANONICAL", label: "LEGACY", signal: "x", naiaRead: "y" });
    assert.equal(out.brand, "CANONICAL");
  });

  it("signal wins over quote", () => {
    const out = normaliseReference({ brand: "B", signal: "CANONICAL_SIG", quote: "LEGACY_QUOTE", naiaRead: "y" });
    assert.equal(out.signal, "CANONICAL_SIG");
  });

  it("naiaRead wins over why", () => {
    const out = normaliseReference({ brand: "B", signal: "x", naiaRead: "CANONICAL_READ", why: "LEGACY_WHY" });
    assert.equal(out.naiaRead, "CANONICAL_READ");
  });

  it("collection is preserved when present", () => {
    const out = normaliseReference({ brand: "B", signal: "x", naiaRead: "y", collection: "SS26" });
    assert.equal(out.collection, "SS26");
  });
});

// ── H. Malformed references are filtered ──────────────────────────────────────

describe("H — referenceHasContent filter", () => {
  it("drops ref with no brand and no signal", () => {
    const r = normaliseReference({ why: "orphan", naiaRead: "orphan" });
    assert.equal(referenceHasContent(r), false);
  });

  it("keeps ref with brand only", () => {
    assert.ok(referenceHasContent(normaliseReference({ label: "Zara SS26" })));
  });

  it("keeps ref with signal only", () => {
    assert.ok(referenceHasContent(normaliseReference({ quote: "Important observation." })));
  });
});

// ── I. Source — DB shape (single label field) ─────────────────────────────────

describe("I — normaliseSource: DB shape { label, url, date }", () => {
  const DB_SOURCE = {
    label: "Vogue Runway SS26",
    url: "https://www.vogue.com/fashion-shows/spring-2026-ready-to-wear",
    date: "2025-10-01",
  };

  it("maps label → publisher", () => {
    const out = normaliseSource(DB_SOURCE);
    assert.equal(out.publisher, "Vogue Runway SS26");
  });

  it("title equals publisher when no distinct title present", () => {
    const out = normaliseSource(DB_SOURCE);
    assert.equal(out.title, out.publisher);
  });

  it("url is preserved exactly", () => {
    const out = normaliseSource(DB_SOURCE);
    assert.equal(out.url, DB_SOURCE.url);
  });

  it("maps date → publishedAt", () => {
    const out = normaliseSource(DB_SOURCE);
    assert.equal(out.publishedAt, "2025-10-01");
  });

  it("descriptor is undefined when note absent", () => {
    const out = normaliseSource(DB_SOURCE);
    assert.equal(out.descriptor, undefined);
  });

  it("sourceHasContent passes a valid DB source", () => {
    assert.ok(sourceHasContent(normaliseSource(DB_SOURCE)));
  });
});

// ── J. Source with note field ─────────────────────────────────────────────────

describe("J — normaliseSource: DB shape { label, url, date, note }", () => {
  const DB_SOURCE_NOTE = {
    label: "Business of Fashion",
    url: "https://www.businessoffashion.com",
    date: "2025-11-15",
    note: "Trend analysis",
  };

  it("maps note → descriptor", () => {
    const out = normaliseSource(DB_SOURCE_NOTE);
    assert.equal(out.descriptor, "Trend analysis");
  });

  it("title still equals publisher (no separate article title)", () => {
    const out = normaliseSource(DB_SOURCE_NOTE);
    assert.equal(out.title, "Business of Fashion");
    assert.equal(out.title, out.publisher);
  });
});

// ── K. Source label renders once, not twice ───────────────────────────────────

describe("K — source de-duplication invariant", () => {
  it("publisher === title when only label is present — renderer can deduplicate", () => {
    const out = normaliseSource({ label: "Vogue Runway SS26", url: "https://vogue.com", date: "2025-10-01" });
    assert.equal(out.publisher, out.title);
  });

  it("publisher !== title when canonical title is distinct — both are shown", () => {
    const out = normaliseSource({ publisher: "Vogue", title: "SS26 Runway Review", url: "https://vogue.com" });
    assert.notEqual(out.publisher, out.title);
    assert.equal(out.publisher, "Vogue");
    assert.equal(out.title, "SS26 Runway Review");
  });
});

// ── L. Source link is always accessible ──────────────────────────────────────

describe("L — source URL is always present after normalisation", () => {
  it("url is non-empty for valid DB source", () => {
    const out = normaliseSource({ label: "Vogue Runway SS26", url: "https://vogue.com" });
    assert.ok(out.url.length > 0);
  });
});

// ── M. Malformed sources are filtered ────────────────────────────────────────

describe("M — sourceHasContent filter", () => {
  it("drops source with no url", () => {
    const s = normaliseSource({ label: "No URL source" });
    assert.equal(sourceHasContent(s), false);
  });

  it("keeps source with url", () => {
    assert.ok(sourceHasContent(normaliseSource({ label: "Vogue", url: "https://vogue.com" })));
  });
});

// ── N. PDF never emits undefined ─────────────────────────────────────────────

describe("N — PDF safety: all normalised fields are strings, never undefined", () => {
  it("normaliseSignal always returns string fields", () => {
    const out = normaliseSignal({ trend: "X", why: "Y" });
    assert.equal(typeof out.signal, "string");
    assert.equal(typeof out.why, "string");
    assert.equal(typeof out.source, "string");
  });

  it("normaliseReference always returns string brand/signal/naiaRead", () => {
    const out = normaliseReference({ label: "Brand SS26", quote: "Q", why: "W" });
    assert.equal(typeof out.brand, "string");
    assert.equal(typeof out.signal, "string");
    assert.equal(typeof out.naiaRead, "string");
  });

  it("normaliseSource always returns string publisher and title", () => {
    const out = normaliseSource({ label: "Vogue", url: "https://vogue.com" });
    assert.equal(typeof out.publisher, "string");
    assert.equal(typeof out.title, "string");
    assert.equal(typeof out.url, "string");
  });

  it("PDF source concat never produces 'undefined'", () => {
    const out = normaliseSource({ label: "Vogue Runway SS26", url: "https://vogue.com", date: "2025-10-01" });
    const titlePart = out.title && out.title !== out.publisher ? ` — ${out.title}` : "";
    const line = `${out.publisher}${titlePart}`;
    assert.ok(!line.includes("undefined"), `PDF line must not contain 'undefined': "${line}"`);
    assert.equal(line, "Vogue Runway SS26");
  });

  it("PDF naiaRead concat never produces 'undefined'", () => {
    const out = normaliseReference({ label: "Brand SS26", quote: "Signal text.", why: "nAia read." });
    const line = "nAia: " + out.naiaRead;
    assert.ok(!line.includes("undefined"), `PDF line must not contain 'undefined': "${line}"`);
    assert.equal(line, "nAia: nAia read.");
  });
});

// ── O. Static fallback is unchanged ──────────────────────────────────────────

describe("O — static fallback: trendReports uses canonical field names", () => {
  it("spring-2026-soft-structure exists in static data", () => {
    const r = trendReports.find((t) => t.slug === "spring-2026-soft-structure");
    assert.ok(r, "static report must exist");
  });

  it("static rising items use canonical signal field", () => {
    const r = trendReports.find((t) => t.slug === "spring-2026-soft-structure");
    if (r?.rising?.length) {
      assert.ok("signal" in r.rising[0], "static rising item must have signal field");
    }
  });

  it("static sources use canonical publisher + title fields", () => {
    const r = trendReports.find((t) => t.slug === "spring-2026-soft-structure");
    if (r?.sources?.length) {
      assert.ok("publisher" in r.sources[0], "static source must have publisher");
      assert.ok("title" in r.sources[0], "static source must have title");
    }
  });

  it("static references use canonical brand + naiaRead fields", () => {
    const r = trendReports.find((t) => t.slug === "spring-2026-soft-structure");
    if (r?.referencesBehindThisEdit?.length) {
      assert.ok("brand" in r.referencesBehindThisEdit[0], "static ref must have brand");
      assert.ok("naiaRead" in r.referencesBehindThisEdit[0], "static ref must have naiaRead");
    }
  });

  it("normaliseSignal is a no-op for canonical static data", () => {
    const r = trendReports.find((t) => t.slug === "spring-2026-soft-structure");
    if (r?.rising?.length) {
      const original = r.rising[0];
      const normalised = normaliseSignal(original as Record<string, unknown>);
      assert.equal(normalised.signal, original.signal);
      assert.equal(normalised.why, original.why);
      assert.equal(normalised.source, original.source);
    }
  });
});
