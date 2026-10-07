// app/routes/style-me/anchor-occasion-incompatibility.test.ts
//
// Regression coverage for the Omar / "Nylon" defect: a closet anchor locked before
// occasion was known (Wardrobe Intelligence "Style this") reached generation without
// ever being checked against the occasion the customer later chose, producing a
// degenerate one-piece result (generic Complete-the-Look placeholders, a material-named
// fallback title) instead of a clean refusal.
//
// The fix adds no new eligibility rule — occasionFit[occasion] === "No" is still the
// same hard exclusion evaluateAnchorEligibility (app/lib/ai/styleme-profile-gate.ts,
// UNMODIFIED) already enforced. What's new is: (1) source.tsx's loader re-runs that gate
// against the now-known occasion for a locked anchor, before the customer ever reaches
// generation, and (2) occasion.tsx's Adjust-Vibe shortcut no longer skips that re-check.
//
// resolveLockedAnchorOutcome (source.tsx) is the pure decision at the centre of both:
// given a gate verdict and who chose the anchor, what should happen. It is tested
// directly here rather than through a mocked request/session, and evaluateAnchorEligibility
// is imported unmodified from styleme-profile-gate.ts — a read-only import, not a change
// to that file.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { evaluateAnchorEligibility } from "../../lib/ai/styleme-profile-gate.js";
import { resolveLockedAnchorOutcome } from "../../lib/styleme/locked-anchor-outcome.js";
import type { ClosetAnchorInput } from "../../lib/ai/styleme-recommendation.types.js";

const ROOT = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..", "..", "..");
const sourceSrc = () => readFileSync(join(ROOT, "app/routes/style-me/source.tsx"), "utf8");
const occasionSrc = () => readFileSync(join(ROOT, "app/routes/style-me/occasion.tsx"), "utf8");
const wiHandoffSrc = () => readFileSync(join(ROOT, "app/routes/api.wi-style-this.tsx"), "utf8");
const lockedAnchorOutcomeSrc = () => readFileSync(join(ROOT, "app/lib/styleme/locked-anchor-outcome.ts"), "utf8");

/** A minimal closet item shaped for evaluateAnchorEligibility — no DB involved. */
const closetItem = (occasionFit: Record<string, string> | null, overrides: Partial<ClosetAnchorInput> = {}) =>
  ({
    hemLength: null,
    topLength: null,
    approvedProfile: occasionFit ? { occasionFit } : null,
    ...overrides,
  } as unknown as ClosetAnchorInput);

// ── 1. My Closet + locked anchor + occasionFit.everyday = "No" ──────────────────

describe("1 — locked anchor rejected for Everyday (the Omar case)", () => {
  it("1.1 evaluateAnchorEligibility refuses it — the gate itself is untouched", () => {
    const joggers = closetItem({ everyday: "No", active: "Acceptable" });
    const eligibility = evaluateAnchorEligibility(joggers, "everyday", []);
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.code, "occasion-not-suitable");
  });

  it("1.2 resolveLockedAnchorOutcome returns 'incompatible' for a MANUAL anchor, not 'eligible' or 'stale-auto'", () => {
    const joggers = closetItem({ everyday: "No", active: "Acceptable" });
    const eligibility = evaluateAnchorEligibility(joggers, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(eligibility, "MANUAL");
    assert.equal(outcome.kind, "incompatible");
    if (outcome.kind === "incompatible") {
      assert.ok(outcome.message.length > 0, "a deterministic message must be present");
    }
  });

  it("1.3 the incompatible outcome is reached without ever building a one-piece outfit — source.tsx renders a dedicated step, not anchor-locked", () => {
    const src = sourceSrc();
    assert.ok(src.includes('step: "anchor-incompatible"'), "a distinct step exists for the rejected case");
    assert.ok(
      src.indexOf("outcome.kind === \"incompatible\"") < src.indexOf('session.unset("styleMeAnchorLocked")'),
      "the incompatible branch returns before falling through to the normal drop-the-lock path",
    );
  });

  it("1.4 the incompatible step never routes through buildEngineInput / generation — it returns directly from source.tsx's loader", () => {
    const src = sourceSrc();
    const incompatibleBlock = src.slice(src.indexOf('outcome.kind === "incompatible"'), src.indexOf('outcome.kind === "incompatible"') + 400);
    assert.ok(incompatibleBlock.includes("return data("), "the loader returns directly — it never redirects into /style-me/result");
    assert.ok(!incompatibleBlock.includes("buildEngineInput"), "generation is never invoked for the rejected case");
  });

  it("1.5 the rendered step shows the piece and both required actions, not a generated outfit", () => {
    const src = sourceSrc();
    const component = src.slice(src.indexOf("function AnchorIncompatibleStep"));
    assert.ok(component.includes("item.imageUrl"), "the rejected piece is shown visually");
    assert.ok(component.includes("item.name"), "the rejected piece is named");
    assert.ok(component.includes('value="change-piece"'), "Choose another piece reuses the existing change-piece action");
    assert.ok(component.includes('to="/style-me/occasion"'), "Change occasion links back to the occasion step");
  });
});

// ── 2. My Closet + eligible locked anchor — unchanged ────────────────────────────

describe("2 — an eligible locked anchor behaves exactly as before", () => {
  it("2.1 evaluateAnchorEligibility approves a Strong/Acceptable-rated item", () => {
    const blazer = closetItem({ everyday: "Strong" });
    const eligibility = evaluateAnchorEligibility(blazer, "everyday", []);
    assert.equal(eligibility.eligible, true);
  });

  it("2.2 resolveLockedAnchorOutcome returns 'eligible' — the untouched step: 'anchor-locked' path", () => {
    const blazer = closetItem({ everyday: "Strong" });
    const eligibility = evaluateAnchorEligibility(blazer, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(eligibility, "MANUAL");
    assert.deepEqual(outcome, { kind: "eligible" });
  });

  it("2.3 an item with no approved profile at all is also 'eligible' — fail-open, matching existing gate behaviour", () => {
    const unreviewed = closetItem(null);
    const eligibility = evaluateAnchorEligibility(unreviewed, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(eligibility, "MANUAL");
    assert.deepEqual(outcome, { kind: "eligible" });
  });

  it("2.4 the original anchor-locked response shape (id, name, imageUrl only) is unchanged", () => {
    const src = sourceSrc();
    const eligibleBlock = src.slice(src.indexOf('outcome.kind === "eligible"'), src.indexOf('outcome.kind === "eligible"') + 300);
    assert.ok(eligibleBlock.includes('step: "anchor-locked" as const'));
    assert.ok(eligibleBlock.includes("item: { id: resolved.id, name: resolved.name, imageUrl: resolved.imageUrl }"));
  });
});

// ── 3. Historical `active` occasion is unaffected ────────────────────────────────

describe("3 — the gate and the new wiring are occasion-agnostic, so historical `active` sessions are unaffected", () => {
  it("3.1 occasionFit.active = 'No' is refused exactly like occasionFit.everyday = 'No' — same gate, no special-casing", () => {
    const gymOnly = closetItem({ active: "No", everyday: "Strong" });
    const eligibility = evaluateAnchorEligibility(gymOnly, "active", []);
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.code, "occasion-not-suitable");
  });

  it("3.2 occasionFit.active = 'Acceptable' still passes — the rule that let Omar's original Active session through is untouched", () => {
    const joggers = closetItem({ active: "Acceptable", everyday: "No" });
    const eligibility = evaluateAnchorEligibility(joggers, "active", []);
    assert.equal(eligibility.eligible, true);
  });

  it("3.3 resolveLockedAnchorOutcome has no occasion parameter at all — it cannot special-case any one occasion", () => {
    const fn = lockedAnchorOutcomeSrc();
    assert.ok(!fn.includes('"everyday"'), "the decision function never hardcodes the everyday occasion");
    assert.ok(!fn.includes('"active"'), "the decision function never hardcodes the active occasion");
    assert.ok(fn.includes("export function resolveLockedAnchorOutcome"));
  });

  it("3.4 the loader passes the session's actual occasion variable, not a literal, into evaluateAnchorEligibility", () => {
    const src = sourceSrc();
    const call = src.slice(src.indexOf("evaluateAnchorEligibility(\n        {"), src.indexOf("evaluateAnchorEligibility(\n        {") + 500);
    assert.ok(call.includes("\n        occasion,\n"), "occasion is passed through as the session variable, uniform across every occasion including active");
  });
});

// ── 4. WI-origin explicit anchor incompatible with the later-selected occasion ──

describe("4 — Wardrobe Intelligence handoff gets the same clean incompatibility behaviour", () => {
  it("4.1 the WI handoff stamps the anchor MANUAL and locked, before any occasion exists", () => {
    const src = wiHandoffSrc();
    assert.ok(src.includes('session.set("styleMeAnchorProvenance", "MANUAL")'));
    assert.ok(src.includes('session.set("styleMeAnchorLocked", "1")'));
    assert.ok(src.includes('redirect("/style-me/state"'), "WI hands off before the questionnaire, so no occasion is known yet");
  });

  it("4.2 a WI-style MANUAL+locked anchor that fails the gate for the chosen occasion resolves to 'incompatible', never silently swapped", () => {
    const wiAnchor = closetItem({ everyday: "No" });
    const eligibility = evaluateAnchorEligibility(wiAnchor, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(eligibility, "MANUAL");
    assert.equal(outcome.kind, "incompatible");
  });

  it("4.3 the re-check runs generically on every occasion submit, not only inside an Adjust-Vibe branch", () => {
    const src = occasionSrc();
    const checkIdx = src.indexOf('const closetAnchorId = session.get("styleMeClosetAnchorId")');
    const adjustVibeIdx = src.indexOf('const adjustVibe = session.get("styleMeAdjustVibe")');
    assert.ok(checkIdx > -1, "the eligibility re-check exists");
    assert.ok(adjustVibeIdx > checkIdx, "the anchor check runs BEFORE adjustVibe is even read — it cannot be gated on it");
    const checkBlock = src.slice(checkIdx, adjustVibeIdx);
    assert.ok(checkBlock.includes("evaluateAnchorEligibility"), "the same gate is re-run");
    assert.ok(!checkBlock.includes('styleMeAdjustVibe'), "the check reads no Adjust-Vibe state at all");
    assert.ok(!checkBlock.includes('session.get("styleMeAnchorLocked")'), "the check does not require the anchor to have been WI-locked — any existing closetAnchorId qualifies");
  });

  it("4.4 occasion.tsx makes exactly one decision — eligible or not — and never reads/sets provenance itself", () => {
    const src = occasionSrc();
    const fn = src.slice(src.indexOf("export async function action"), src.indexOf("export default function StyleMeOccasion"));
    assert.ok(!fn.includes('"AUTO"'), "occasion.tsx never names AUTO — that distinction belongs to source.tsx alone");
    assert.ok(!fn.includes('"MANUAL"'), "occasion.tsx never names MANUAL either");
    assert.ok(fn.includes('session.set("styleMeAnchorLocked", "1")'), "ineligible anchors are routed into source.tsx's own anchorLocked branch, not decided here");
  });

  it("4.5 the ineligible branch redirects to /style-me/source, never to /style-me/result", () => {
    const src = occasionSrc();
    const ineligibleIdx = src.indexOf("if (!anchorStillEligible)");
    const block = src.slice(ineligibleIdx, ineligibleIdx + 400);
    assert.ok(block.includes('redirect("/style-me/source"'));
    assert.ok(!block.includes('redirect("/style-me/result"'));
  });
});

// ── 6. Back-navigation regenerate: a MANUAL anchor, valid for A, is NOT valid for B ─

describe("6 — Back-navigation occasion change revalidates a MANUAL anchor chosen earlier in the same flow", () => {
  it("6.1 eligible for occasion A, then ineligible for occasion B — same item, same provenance, different occasion", () => {
    // The exact scenario: a plain manual pick (not WI, never styleMeAnchorLocked) is
    // valid when first chosen, then the customer goes Back and changes the occasion.
    const item = closetItem({ work: "Strong", everyday: "No" });
    const forA = evaluateAnchorEligibility(item, "work", []);
    const forB = evaluateAnchorEligibility(item, "everyday", []);
    assert.equal(forA.eligible, true, "occasion A (work) — this is why the manual pick was accepted at selection time");
    assert.equal(forB.eligible, false, "occasion B (everyday) — the same item, revalidated, is no longer eligible");
  });

  it("6.2 resolveLockedAnchorOutcome for occasion B is 'incompatible', not 'eligible' — generation must not be reached", () => {
    const item = closetItem({ work: "Strong", everyday: "No" });
    const forB = evaluateAnchorEligibility(item, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(forB, "MANUAL");
    assert.equal(outcome.kind, "incompatible");
  });

  it("6.3 occasion.tsx's check has no precondition on styleMeAnchorLocked, so a plain (non-WI) manual pick from an earlier pass through this same flow is still caught", () => {
    const src = occasionSrc();
    const checkIdx = src.indexOf('const closetAnchorId = session.get("styleMeClosetAnchorId")');
    const guardIdx = src.indexOf("if (closetAnchorId) {", checkIdx);
    assert.ok(guardIdx > -1 && guardIdx - checkIdx < 150, "the only gate is closetAnchorId existing — no anchorLocked flag is required to trigger the re-check");
  });

  it("6.4 on ineligibility occasion.tsx stamps styleMeAnchorLocked so source.tsx's existing branch — not a new one — renders anchor-incompatible for this never-locked anchor", () => {
    const src = occasionSrc();
    const ineligibleIdx = src.indexOf("if (!anchorStillEligible)");
    const block = src.slice(ineligibleIdx, ineligibleIdx + 400);
    assert.ok(block.includes('session.set("styleMeAnchorLocked", "1")'));
  });
});

// ── 7. AUTO anchor becomes incompatible after an occasion change — silent recovery ──

describe("7 — an AUTO anchor invalidated by a later occasion change recovers through the normal flow, not a refusal", () => {
  it("7.1 same gate, same mechanics as the MANUAL case — only provenance differs", () => {
    const item = closetItem({ work: "Strong", everyday: "No" });
    const forB = evaluateAnchorEligibility(item, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(forB, "AUTO");
    assert.deepEqual(outcome, { kind: "stale-auto" });
  });

  it("7.2 source.tsx's stale-auto branch drops all three anchor keys and falls through — it does not return an anchor-incompatible response", () => {
    const src = sourceSrc();
    const staleIdx = src.indexOf('outcome.kind === "stale-auto"');
    assert.ok(staleIdx > -1);
    const afterOutcomeSwitch = src.slice(src.indexOf('if (outcome.kind === "eligible")'), src.indexOf('outcome.kind === "stale-auto"') + 400);
    assert.ok(afterOutcomeSwitch.includes('session.unset("styleMeAnchorLocked")'));
    assert.ok(afterOutcomeSwitch.includes('session.unset("styleMeClosetAnchorId")'));
    assert.ok(afterOutcomeSwitch.includes('session.unset("styleMeAnchorProvenance")'));
  });

  it("7.3 after dropping a stale AUTO anchor, the loader redirects to /style-me/source for normal anchor-method recovery, not to a refusal screen", () => {
    const src = sourceSrc();
    const idx = src.indexOf('outcome.kind === "incompatible"');
    const tail = src.slice(idx, idx + 1200);
    assert.ok(tail.includes('redirect("/style-me/source"'), "the shared fail-safe redirect below the outcome switch serves both the resolved-null case and the dropped-stale-AUTO case");
  });

  it("7.4 occasion.tsx's own guard does not distinguish AUTO from MANUAL when deciding to redirect — only source.tsx's provenance read (added previously, untouched here) does", () => {
    const src = occasionSrc();
    const fn = src.slice(src.indexOf("export async function action"), src.indexOf("export default function StyleMeOccasion"));
    assert.ok(!fn.includes("resolveLockedAnchorOutcome"), "occasion.tsx does not import or call the provenance-aware resolver at all");
  });
});

// ── 5. Stale-anchor auto-recovery only when provenance is definitively AUTO ─────

describe("5 — silent recovery is gated strictly on provenance === 'AUTO', never inferred", () => {
  it("5.1 AUTO + ineligible resolves to 'stale-auto'", () => {
    const stale = closetItem({ everyday: "No" });
    const eligibility = evaluateAnchorEligibility(stale, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(eligibility, "AUTO");
    assert.deepEqual(outcome, { kind: "stale-auto" });
  });

  it("5.2 MANUAL + ineligible never resolves to 'stale-auto'", () => {
    const sameItem = closetItem({ everyday: "No" });
    const eligibility = evaluateAnchorEligibility(sameItem, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(eligibility, "MANUAL");
    assert.notEqual(outcome.kind, "stale-auto");
    assert.equal(outcome.kind, "incompatible");
  });

  it("5.3 null (unstamped/legacy) + ineligible never resolves to 'stale-auto' — treated as MANUAL, the existing documented default", () => {
    const sameItem = closetItem({ everyday: "No" });
    const eligibility = evaluateAnchorEligibility(sameItem, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(eligibility, null);
    assert.notEqual(outcome.kind, "stale-auto");
    assert.equal(outcome.kind, "incompatible");
  });

  it("5.4 no new provenance value is introduced — only the existing 'AUTO' | 'MANUAL' | null vocabulary is read", () => {
    const fn = lockedAnchorOutcomeSrc();
    assert.ok(fn.includes('provenance === "AUTO"'));
    assert.ok(!/["']STALE["']|["']UNLOCKED["']/.test(fn), "no invented provenance value appears");
  });

  it("5.5 an eligible AUTO anchor is simply 'eligible' — AUTO alone does not force recovery when nothing is wrong", () => {
    const fine = closetItem({ everyday: "Strong" });
    const eligibility = evaluateAnchorEligibility(fine, "everyday", []);
    const outcome = resolveLockedAnchorOutcome(eligibility, "AUTO");
    assert.deepEqual(outcome, { kind: "eligible" });
  });
});
