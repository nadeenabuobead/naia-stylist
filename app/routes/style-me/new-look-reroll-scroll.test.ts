// app/routes/style-me/new-look-reroll-scroll.test.ts
//
// "New Look, Same Vibe" generates a new outfit in place via a fetcher (generateFetcher),
// never a navigation. React Router's <ScrollRestoration/> (app/root.jsx) only acts on
// navigation/location changes, so it was never involved and never fighting anything —
// nothing ever asked the page to scroll at all, which is the actual defect. Confirmed by
// contrast with passport.selfie.tsx, which DOES need a double-requestAnimationFrame defer
// because its own scroll trigger comes from a real <Form> navigation (useActionData).
//
// The pending-state button (disabled while fetching, "Finding your look…" label) already
// existed and is left unchanged. The only addition is a scroll-to-top that fires once a
// genuinely new suggestion has settled from an EXPLICIT reroll click — never from the
// shared fetcher's other use (the initial-generation auto-submit on first page load), and
// never from an error or a sameCombination ("no new look available") response.
//
// Text-contract style, matching every other style-me route test in this codebase:
// result.tsx imports *.css?url and can't be loaded directly by plain node --test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..", "..", "..");
const resultSrc = () => readFileSync(join(ROOT, "app/routes/style-me/result.tsx"), "utf8");

// ── 1 & 2. The pending state (unchanged, pre-existing) ───────────────────────────

describe("1/2 — the reroll button's existing pending state and disabled guard are unchanged", () => {
  it("1.1 the button already disables itself while generateFetcher is not idle", () => {
    const src = resultSrc();
    const idx = src.indexOf('generateFetcher.submit({ intent: "regenerate"');
    const buttonBlock = src.slice(src.lastIndexOf("<button", idx), idx + 300);
    assert.ok(buttonBlock.includes('disabled={generateFetcher.state !== "idle"}'));
  });

  it("1.2 the button already swaps its label to a pending message, and the exact copy is left alone", () => {
    const src = resultSrc();
    const idx = src.indexOf('generateFetcher.submit({ intent: "regenerate"');
    const block = src.slice(idx, idx + 400);
    assert.ok(block.includes('generateFetcher.state !== "idle" ? "Finding your look…" : "New Look, Same Vibe"'));
  });
});

// ── 3. Successful reroll scrolls to top ──────────────────────────────────────────

describe("3 — a successful reroll scrolls the page to the top", () => {
  it("3.1 the reroll button's onClick arms the ref before submitting — the only site that ever arms it", () => {
    const src = resultSrc();
    const onClickIdx = src.indexOf('generateFetcher.submit({ intent: "regenerate"');
    const block = src.slice(onClickIdx - 150, onClickIdx);
    assert.ok(block.includes("isRerollingRef.current = true"), "the ref is armed immediately before the regenerate submission");
  });

  it("3.2 the settle effect scrolls to top only when the ref is armed, the fetcher is idle, and a new suggestion is present", () => {
    const src = resultSrc();
    const effectIdx = src.indexOf("const isRerollingRef = useRef(false)");
    assert.ok(effectIdx > -1);
    const effectBlock = src.slice(effectIdx, effectIdx + 700);
    assert.ok(effectBlock.includes('generateFetcher.state !== "idle" || !isRerollingRef.current) return'), "bails out unless idle AND armed by an explicit reroll");
    assert.ok(effectBlock.includes("generateFetcher.data?.suggestion"), "only scrolls for a genuine new result");
    assert.ok(effectBlock.includes('window.scrollTo({ top: 0, behavior: "smooth" })'));
  });

  it("3.3 the scroll call sits inside the suggestion-present branch, not unconditionally after the idle/armed check", () => {
    const src = resultSrc();
    const effectIdx = src.indexOf("const isRerollingRef = useRef(false)");
    const effectBlock = src.slice(effectIdx, effectIdx + 700);
    const suggestionIfIdx = effectBlock.indexOf("if (generateFetcher.data?.suggestion)");
    const scrollIdx = effectBlock.indexOf("window.scrollTo(");
    const closeBraceIdx = effectBlock.indexOf("}", scrollIdx);
    assert.ok(suggestionIfIdx > -1 && suggestionIfIdx < scrollIdx && scrollIdx < closeBraceIdx, "scrollTo is nested inside the suggestion check, not sibling to it");
  });
});

// ── 4. Initial generation never force-scrolls ────────────────────────────────────

describe("4 — the initial page-load generation never arms the reroll ref", () => {
  it("4.1 the auto-submit effect for the fresh-generation branch never sets isRerollingRef", () => {
    const src = resultSrc();
    const autoSubmitIdx = src.indexOf('intent: "generate",');
    assert.ok(autoSubmitIdx > -1, "the initial-generation auto-submit exists");
    const block = src.slice(src.lastIndexOf("useEffect(() => {", autoSubmitIdx), autoSubmitIdx + 50);
    assert.ok(!block.includes("isRerollingRef"), "the ref belongs exclusively to the explicit reroll click, never the shared fetcher's other use");
  });

  it("4.2 isInitialGeneration and isRerollingRef are two separate mechanisms — the ref is not derived from or reset by the initial-generation flag", () => {
    const src = resultSrc();
    assert.ok(src.includes("const [isInitialGeneration] = useState(() => loaderData.isLoading)"));
    const refIdx = src.indexOf("const isRerollingRef = useRef(false)");
    const nearbyBlock = src.slice(refIdx - 50, refIdx + 50);
    assert.ok(!nearbyBlock.includes("isInitialGeneration"), "the ref's declaration is not gated on or coupled to the initial-generation flag");
  });
});

// ── 5. A failed/no-suggestion reroll does not scroll, and does not leave the marker armed ──

describe("5 — a failed or same-combination reroll neither scrolls nor leaves the ref armed for later", () => {
  it("5.1 the ref is reset to false on every settle, unconditionally — not only inside the suggestion branch", () => {
    const src = resultSrc();
    const effectIdx = src.indexOf("const isRerollingRef = useRef(false)");
    const effectBlock = src.slice(effectIdx, effectIdx + 700);
    const suggestionBlockEnd = effectBlock.indexOf("}", effectBlock.indexOf("window.scrollTo("));
    const resetIdx = effectBlock.indexOf("isRerollingRef.current = false");
    assert.ok(resetIdx > suggestionBlockEnd, "the reset happens after the suggestion-only block closes, so it runs whether or not a suggestion was present");
  });

  it("5.2 an error response carries no suggestion field, so the same guard that gates the scroll also keeps a failed reroll from scrolling", () => {
    const src = resultSrc();
    // generateFetcher's typed shape: suggestion and error are alternatives, never both.
    assert.ok(src.includes("useFetcher<{ suggestion?: any; error?: string; sameCombination?: boolean }>()"));
    const effectIdx = src.indexOf("const isRerollingRef = useRef(false)");
    const effectBlock = src.slice(effectIdx, effectIdx + 700);
    assert.ok(!effectBlock.includes("generateFetcher.data?.error"), "the effect does not need to branch on error separately — absence of .suggestion already covers it");
  });

  it("5.3 a sameCombination response (old outfit kept, nothing changed) also does not scroll, for the same reason", () => {
    const src = resultSrc();
    const effectIdx = src.indexOf("const isRerollingRef = useRef(false)");
    const effectBlock = src.slice(effectIdx, effectIdx + 700);
    assert.ok(!effectBlock.includes("sameCombination"), "the effect's only positive condition is .suggestion — sameCombination (no new suggestion) falls through to the unconditional reset, never the scroll");
  });
});
