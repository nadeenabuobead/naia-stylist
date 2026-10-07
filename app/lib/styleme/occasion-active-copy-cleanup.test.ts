// app/lib/styleme/occasion-active-copy-cleanup.test.ts
//
// Final StyleMe freeze cleanup, two parts:
//
// (A) Raw `active` customer-facing copy leaks. "active" is the one canonical occasion id
// with no hyphen, so every `occasion.replace(/-/g, " ")` pattern in this codebase was a
// no-op for it specifically, leaking the raw internal word ("...for your active.",
// "· active") instead of the customer-facing label. Fixed by routing through the existing
// occasionDisplayFor/OCCASION_DISPLAY_LABELS (app/lib/styleme/occasion-display.ts) — no new
// label map was created. The canonical internal id "active" is untouched; only its DISPLAY
// changed, and only where it was leaking raw.
//
// (B) Temporary StyleMe QA diagnostics ([nAia-*], all gated on NAIA_STYLEME_DIAGNOSTICS).
// Removed now that manual QA has passed; [nAia-model-failure] and [nAia-model-error] are
// deliberately retained (separate observability decision, not part of this cleanup).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { occasionDisplayFor, OCCASION_DISPLAY_LABELS } from "./occasion-display.js";
import { buildSongReason, deterministicWording } from "../ai/styleme-result.server.js";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..", "..", "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ── 1. Every customer-facing historical `active` render resolves to the canonical label ──

describe("1 — customer-facing historical active renders resolve to 'Busy / on-the-go day'", () => {
  it("1.1 OCCASION_DISPLAY_LABELS['active'] is the single source of truth for the label", () => {
    assert.equal(OCCASION_DISPLAY_LABELS["active"], "Busy / on-the-go day");
  });

  it("1.2 occasionDisplayFor('active') never returns the raw word", () => {
    assert.equal(occasionDisplayFor(null, "active"), "Busy / on-the-go day");
    assert.notEqual(occasionDisplayFor(null, "active"), "active");
  });

  it("1.3 occasionDisplayFor still prefers the captured display label when present (unchanged precedence)", () => {
    // A fresh-generation session that captured "Busy / on-the-go day" verbatim at answer
    // time must keep echoing it, not re-derive from the canonical map.
    assert.equal(occasionDisplayFor("Busy / on-the-go day", "active"), "Busy / on-the-go day");
  });

  for (const [file, importLine] of [
    ["app/routes/post-wear-review.tsx", 'import { occasionDisplayFor } from "~/lib/styleme/occasion-display";'],
    ["app/routes/my-naia.saved.tsx", 'import { occasionDisplayFor } from "~/lib/styleme/occasion-display";'],
    ["app/routes/my-naia._index.tsx", 'import { occasionDisplayFor } from "~/lib/styleme/occasion-display";'],
    ["app/routes/style-me/_index.tsx", 'import { occasionDisplayFor } from "~/lib/styleme/occasion-display";'],
  ] as const) {
    it(`1.4 ${file} imports and uses the canonical helper, and no longer renders a bare occasion string`, () => {
      const text = src(file);
      assert.ok(text.includes(importLine), `${file} must import occasionDisplayFor`);
      assert.ok(text.includes("occasionDisplayFor("), `${file} must call it`);
    });
  }

  it("1.5 post-wear-review.tsx no longer interpolates session.occasion raw", () => {
    const text = src("app/routes/post-wear-review.tsx");
    assert.ok(!text.includes("` · ${session.occasion}`"), "the raw interpolation is gone");
    assert.ok(text.includes("occasionDisplayFor(null, session.occasion)"));
  });

  it("1.6 my-naia.saved.tsx no longer builds metaParts from the raw occasion field", () => {
    const text = src("app/routes/my-naia.saved.tsx");
    assert.ok(!text.includes("[look.occasion, formattedDate]"), "the raw array is gone");
    assert.ok(text.includes("occasionDisplayFor(null, look.occasion)"));
  });

  it("1.7 my-naia._index.tsx no longer interpolates session.occasion raw", () => {
    const text = src("app/routes/my-naia._index.tsx");
    assert.ok(!text.includes("` · ${session.occasion}`"), "the raw interpolation is gone");
    assert.ok(text.includes("occasionDisplayFor(null, session.occasion)"));
  });

  it("1.8 style-me/_index.tsx's own duplicate OCCASION_LABELS map is gone — no second map was created", () => {
    const text = src("app/routes/style-me/_index.tsx");
    assert.ok(!text.includes("const OCCASION_LABELS"), "the local, out-of-sync duplicate map is removed");
    assert.ok(text.includes("occasionDisplayFor(null, session.occasion)"), "replaced by the canonical helper");
  });

  it("1.9 historical occasion='active' sessions render through the exact same path as every other occasion — no active-specific branch was added to any of the four files", () => {
    for (const file of [
      "app/routes/post-wear-review.tsx",
      "app/routes/my-naia.saved.tsx",
      "app/routes/my-naia._index.tsx",
      "app/routes/style-me/_index.tsx",
    ]) {
      const text = src(file);
      assert.ok(!/occasion\s*===\s*["']active["']/.test(text), `${file} must not special-case "active" — occasionDisplayFor already handles it`);
    }
  });
});

// ── 2. buildSongReason cannot produce the raw leak ───────────────────────────────

describe("2 — buildSongReason never says 'for your active.'", () => {
  it("2.1 occasion='active' with no matched mood produces the canonical label, not the raw word", () => {
    const reason = buildSongReason([], [], [], "active");
    assert.equal(reason, "Curated to set the tone for your busy / on-the-go day.");
    assert.ok(!reason.includes("your active."), "the exact known leak must not reproduce");
  });

  it("2.2 other occasions are completely unaffected — same wording as before this fix", () => {
    assert.equal(buildSongReason([], [], [], "everyday"), "Curated to set the tone for your everyday.");
    assert.equal(buildSongReason([], [], [], "date-night"), "Curated to set the tone for your date night.");
    assert.equal(buildSongReason([], [], [], "not-sure"), "Curated to set the tone for your not sure.");
  });

  it("2.3 the matched-mood branches (unrelated to the leak) are untouched", () => {
    const reason = buildSongReason(["confident"], ["active"], ["confident"], "active");
    assert.ok(reason.startsWith("Matched to your confident energy for"));
    assert.ok(!reason.includes(" active."), "the occasion-matched branch also must not leak the raw word");
  });
});

// ── 3. The canonical label itself ────────────────────────────────────────────────

describe("3 — OCCASION_DISPLAY_LABELS['active'] remains exactly 'Busy / on-the-go day'", () => {
  it("3.1 no other value was substituted by this cleanup", () => {
    assert.equal(OCCASION_DISPLAY_LABELS["active"], "Busy / on-the-go day");
  });

  it("3.2 deterministicWording's fallback title also uses the canonical label for 'active', not the raw word", () => {
    // outfitName falls to "Your <occasionLabel> look" when no primaryTitle/selectedGarments
    // are available — the same leak class as buildSongReason, same fix.
    const w = deterministicWording("closet-led", [], [], "active", null, null);
    assert.ok(w.outfitName.toLowerCase().includes("busy / on-the-go day"));
    assert.ok(!/\bactive\b/i.test(w.outfitName), "the raw internal word must not appear in the title");
  });

  it("3.3 deterministicWording for other occasions is unaffected — same title wording as before", () => {
    const w = deterministicWording("closet-led", [], [], "everyday", null, null);
    assert.ok(w.outfitName.toLowerCase().includes("everyday look"));
  });
});

// ── 4. Temporary diagnostics are gone, except the two retained ones ─────────────

describe("4 — temporary [nAia-*] QA diagnostics removed; model-failure/model-error retained as-is", () => {
  const REMOVED_TAGS = [
    "nAia-closet-mode-branch",
    "nAia-dressing-gate",
    "nAia-anchor-rank",
    "nAia-candidates",
    "nAia-slot-pipeline",
    "nAia-selection-diag",
    "nAia-t4-and-profile",
    "nAia-eligibility-drop",
    "nAia-slot-score",
    "nAia-finishing-suitability",
    "nAia-core-diversity",
  ];

  for (const file of ["app/lib/ai/styleme-anchor.server.ts", "app/lib/ai/styleme-result.server.ts"]) {
    it(`4.1 ${file} contains none of the 11 confirmed temp diagnostic tags`, () => {
      const text = src(file);
      for (const tag of REMOVED_TAGS) {
        assert.ok(!text.includes(`[${tag}]`), `${tag} must be fully removed from ${file}`);
      }
    });
  }

  it("4.2 styleme-result.server.ts still retains [nAia-model-failure] and [nAia-model-error], unchanged", () => {
    const text = src("app/lib/ai/styleme-result.server.ts");
    assert.ok(text.includes('console.log("[nAia-model-failure]"'));
    assert.ok(text.includes('console.log("[nAia-model-error]"'));
  });

  it("4.3 the two retained diagnostics are still gated on the same flag and still console.log (not console.error) — not converted, not made always-on", () => {
    const text = src("app/lib/ai/styleme-result.server.ts");
    const failIdx = text.indexOf('console.log("[nAia-model-failure]"');
    const failGuard = text.slice(Math.max(0, failIdx - 150), failIdx);
    assert.ok(failGuard.includes('NAIA_STYLEME_DIAGNOSTICS === "true"'), "model-failure is still flag-gated, not always-on");

    const errIdx = text.indexOf('console.log("[nAia-model-error]"');
    const errGuard = text.slice(Math.max(0, errIdx - 150), errIdx);
    assert.ok(errGuard.includes('NAIA_STYLEME_DIAGNOSTICS === "true"'), "model-error is still flag-gated, not always-on");
  });

  it("4.4 the control-flow this cleanup ran alongside (continue/gates) is untouched — same gates, same order, no logDrop calls remain", () => {
    const text = src("app/lib/ai/styleme-result.server.ts");
    assert.ok(!/\blogDrop\(/.test(text), "no dead probe-closure calls remain");
    assert.ok(!/function logSlotPipeline/.test(text), "the dead shared probe helper is removed");
    assert.ok(!/function logNaiaSelectionDiag/.test(text), "the dead selection-diag helper is removed");
    // The four real gates in selectAdditionalClosetGarments are still present, in order,
    // now ending in a plain `continue` instead of `logDrop(...); continue;`.
    assert.ok(text.includes("if (!passesProfileOccasionGate(item, session.occasion)) continue;"));
    assert.ok(text.includes("if (!passesProfileRegisterGate(item, session.occasion)) continue;"));
    assert.ok(text.includes("if (!passesRegisterCoherenceWithAnchor(item, anchorClosetItem, session.occasion)) continue;"));
    assert.ok(text.includes("if (!passesOutfitFunctionGate(item, slot)) continue;"));
  });

  it("4.5 styleme-anchor.server.ts's real filters are untouched — isStructuralAnchorCandidate and passesDressingRequirements still gate, unconditionally (not behind the removed diagnostic)", () => {
    const text = src("app/lib/ai/styleme-anchor.server.ts");
    assert.ok(text.includes("isStructuralAnchorCandidate(item) &&"));
    assert.ok(text.includes("passesDressingRequirements("));
    assert.ok(!/function\b.*\bexplainDressingRequirements\(probe/.test(text), "the dead probe call is gone");
  });

  it("4.6 no test in this codebase still asserts on a removed diagnostic's presence (the one that did, closet-mode-branch-diagnostic.test.ts, was deleted alongside its subject)", () => {
    assert.ok(
      !existsSync(join(ROOT, "app/lib/styleme/closet-mode-branch-diagnostic.test.ts")),
      "the diagnostic-only test file was removed, not left to fail",
    );
  });
});
