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
const sessionServerSrc = () => readFileSync(join(ROOT, "app/lib/session.server.ts"), "utf8");

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

  it("1.6 the manual picker's inline rejection (ClosetAnchorStep) replaces the ambiguous Continue/Back pair with the same two explicit actions", () => {
    // The manual-pick path (set-anchor's own pre-existing, unmodified eligibility check)
    // is a second place the same refusal surfaces, distinct from the locked-anchor step
    // above. Before this fix it kept the generic Continue (which just resubmitted the
    // same rejected item — the "dead button" ActionError's own comment describes) and
    // a Back that returned to the anchor-method screen, not the occasion step.
    const src = sourceSrc();
    const fn = src.slice(src.indexOf("function ClosetAnchorStep"), src.indexOf("function RequiresLoginStep"));
    assert.ok(fn.includes("const rejected ="), "the rejected state is read from the same actionData the message already uses");
    const rejectedBlock = fn.slice(fn.indexOf("rejected ? ("), fn.indexOf("rejected ? (") + 400);
    assert.ok(rejectedBlock.includes(">Change occasion<"), "explicit label, not Back");
    assert.ok(rejectedBlock.includes('to="/style-me/occasion"'), "routes to the occasion step, not the anchor-method screen Back currently used");
    assert.ok(rejectedBlock.includes(">Choose another piece<"), "explicit label, not Continue");
    assert.ok(rejectedBlock.includes('value="change-piece"'), "reuses the existing change-piece action, per the required behaviour, rather than resubmitting the same rejected item");
    // The generic Continue must not be offered at all once rejected — only the fresh
    // selection it would silently resubmit made it ambiguous in the first place.
    assert.ok(!rejectedBlock.includes(">Continue<"));
    assert.ok(!rejectedBlock.includes("← Back"));
  });

  it("1.7 the normal (non-rejected) picker is unchanged — Continue/Back keep their existing labels and destinations", () => {
    const src = sourceSrc();
    const fn = src.slice(src.indexOf("function ClosetAnchorStep"), src.indexOf("function RequiresLoginStep"));
    assert.ok(fn.includes("!rejected &&"), "Continue is still offered when nothing was rejected");
    assert.ok(fn.includes('value="back"'), "the original Back intent is preserved for the unrejected case");
    assert.ok(fn.includes('name="from" value="closet-anchor"'), "Back still carries its original from=closet-anchor hydration");
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

  it("2.4 the anchor-locked response still carries exactly {id, name, imageUrl} for the anchor itself", () => {
    // Was item: { id: resolved.id, name: resolved.name, imageUrl: resolved.imageUrl } inline.
    // The multi-garment handoff factored this into toLockedAnchorItem(resolved) — same three
    // fields, same shape, now shared with the new `companions` array added alongside it (see
    // wi-multi-garment-handoff.test.ts) so "Styling around" can show the complete combination,
    // not just the anchor. Window widened: that companion-resolution block now sits between
    // the outcome check and the return.
    const src = sourceSrc();
    const eligibleBlock = src.slice(src.indexOf('outcome.kind === "eligible"'), src.indexOf('outcome.kind === "eligible"') + 900);
    assert.ok(eligibleBlock.includes('step: "anchor-locked" as const'));
    assert.ok(eligibleBlock.includes("item: toLockedAnchorItem(resolved)"), "the anchor's own item shape is unchanged, just factored out");
    const toLockedAnchorItemFn = src.slice(src.indexOf("const toLockedAnchorItem ="), src.indexOf("const toLockedAnchorItem =") + 300);
    assert.ok(toLockedAnchorItemFn.includes("id: item.id") && toLockedAnchorItemFn.includes("name: item.name") && toLockedAnchorItemFn.includes("imageUrl: item.imageUrl"), "toLockedAnchorItem itself must still produce exactly {id, name, imageUrl}");
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
    const checkEligibilityIdx = src.indexOf("const checkEligibility =");
    const checkIdx = src.indexOf('const closetAnchorId = session.get("styleMeClosetAnchorId")');
    const adjustVibeIdx = src.indexOf('const adjustVibe = session.get("styleMeAdjustVibe")');
    assert.ok(checkEligibilityIdx > -1 && checkEligibilityIdx < checkIdx, "the shared gate helper is defined before either check uses it");
    assert.ok(adjustVibeIdx > checkIdx, "the anchor check runs BEFORE adjustVibe is even read — it cannot be gated on it");
    const helperBlock = src.slice(checkEligibilityIdx, checkIdx);
    assert.ok(helperBlock.includes("evaluateAnchorEligibility"), "the same gate is re-run, inside the one shared helper both checks call");
    const checkBlock = src.slice(checkIdx, adjustVibeIdx);
    assert.ok(checkBlock.includes("checkEligibility(closetAnchorId)"), "the real-anchor check uses the shared helper");
    assert.ok(checkBlock.includes("checkEligibility(pendingClosetAnchorId)"), "the pending-anchor check uses the exact same helper — one gate, not two");
    assert.ok(!checkBlock.includes('styleMeAdjustVibe'), "the check reads no Adjust-Vibe state at all");
    assert.ok(!checkBlock.includes('session.get("styleMeAnchorLocked")'), "the check does not require the anchor to have been WI-locked — any existing closetAnchorId qualifies");
  });

  it("4.4 occasion.tsx decides eligible-or-not for an EXISTING anchor without reading/setting provenance; MANUAL is named only when promoting a pending pick, which is MANUAL by construction", () => {
    const src = occasionSrc();
    const fn = src.slice(src.indexOf("export async function action"), src.indexOf("export default function StyleMeOccasion"));
    assert.ok(!fn.includes('"AUTO"'), "occasion.tsx never names AUTO — that distinction belongs to source.tsx alone");
    // "MANUAL" appears exactly once: stamping a promoted pending pick. It is never read
    // back, and never used to decide between AUTO/MANUAL for an existing anchor.
    const manualCount = (fn.match(/"MANUAL"/g) ?? []).length;
    assert.equal(manualCount, 1, "MANUAL is named only at the one promotion site, not as a general decision");
    assert.ok(
      fn.includes('pendingNowEligible) {\n      session.set("styleMeClosetAnchorId", pendingClosetAnchorId);\n      session.set("styleMeAnchorProvenance", "MANUAL");'),
      "MANUAL is stamped only inside the pending-promotion branch",
    );
    assert.ok(fn.includes('session.set("styleMeAnchorLocked", "1")'), "ineligible EXISTING anchors are still routed into source.tsx's own anchorLocked branch, not decided here");
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

// ── 8. A rejected MANUAL pick is preserved across Change Occasion ───────────────
//
// Before this fix, a manually-picked piece that failed set-anchor's own eligibility
// check was never written anywhere — only the error response carried it, gone the
// moment the customer navigated. Change Occasion therefore always landed on an empty
// picker, as if the piece had never been chosen. styleMePendingClosetAnchorId fixes
// that: "explicitly chosen MANUAL piece, not yet eligible for any occasion checked" —
// deliberately NOT styleMeClosetAnchorId, which means "validated anchor".

describe("8 — rejected manual pick survives Change Occasion as a pending (not validated) choice", () => {
  it("8.1 styleMePendingClosetAnchorId is registered in STYLEME_SESSION_KEYS, so Start Over / WI full-reset clear it automatically", () => {
    const src = sessionServerSrc();
    assert.ok(src.includes('"styleMePendingClosetAnchorId"'), "the key is in the registry both clearStyleMeSession and the WI handoff iterate");
  });

  it("8.2 a rejected manual pick persists the pending key with a committed cookie, and never writes styleMeClosetAnchorId", () => {
    const src = sourceSrc();
    const rejectIdx = src.indexOf("if (!eligibility.eligible) {");
    const block = src.slice(rejectIdx, rejectIdx + 630);
    assert.ok(block.includes('session.set("styleMePendingClosetAnchorId", closetItemId)'), "the rejected pick is remembered");
    assert.ok(block.includes('headers: { "Set-Cookie": await commitSession(session) }'), "the cookie is actually committed on the 400 response — previously it was not");
    assert.ok(!block.includes('session.set("styleMeClosetAnchorId"'), "an unvalidated piece must never be written to the field that means 'validated anchor'");
  });

  it("8.3 a successful manual pick clears any stale pending key left over from an earlier rejected attempt in the same flow", () => {
    const src = sourceSrc();
    const successIdx = src.indexOf('session.set("styleMeClosetAnchorId", closetItemId)');
    const block = src.slice(successIdx, successIdx + 650);
    assert.ok(block.includes('session.unset("styleMePendingClosetAnchorId")'));
  });

  it("8.4 CHOOSE ANOTHER PIECE (change-piece) clears the pending piece, not only the locked-anchor fields", () => {
    const src = sourceSrc();
    const idx = src.indexOf('if (intent === "change-piece")');
    const block = src.slice(idx, idx + 500);
    assert.ok(block.includes('session.unset("styleMePendingClosetAnchorId")'));
  });

  it("8.5 occasion.tsx promotes an eligible-now pending pick to the real anchor, stamps MANUAL, clears pending, and continues to /style-me/result", () => {
    const src = occasionSrc();
    const idx = src.indexOf("if (pendingNowEligible) {");
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes('session.set("styleMeClosetAnchorId", pendingClosetAnchorId)'));
    assert.ok(block.includes('session.set("styleMeAnchorProvenance", "MANUAL")'));
    assert.ok(block.includes('session.unset("styleMePendingClosetAnchorId")'));
    const resultRedirectIdx = src.indexOf("pendingClosetAnchorId && pendingNowEligible");
    const resultBlock = src.slice(resultRedirectIdx, resultRedirectIdx + 200);
    assert.ok(resultBlock.includes('redirect("/style-me/result"'), "promotion proceeds exactly like a fresh successful manual pick");
  });

  it("8.6 occasion.tsx leaves a still-ineligible pending pick untouched and routes through /style-me/source, not /style-me/result", () => {
    const src = occasionSrc();
    const idx = src.indexOf("if (pendingClosetAnchorId && !pendingNowEligible)");
    assert.ok(idx > -1);
    const block = src.slice(idx, idx + 300);
    assert.ok(block.includes('redirect("/style-me/source"'));
    assert.ok(!block.includes("styleMePendingClosetAnchorId\", undefined") && !block.includes('unset("styleMePendingClosetAnchorId")'), "the still-ineligible branch must not clear the pending piece — it has to survive to be re-offered");
  });

  it("8.7 occasion.tsx only consults the pending key when there is no real anchor yet — a real anchor always takes precedence", () => {
    const src = occasionSrc();
    const idx = src.indexOf("const pendingClosetAnchorId = !closetAnchorId");
    assert.ok(idx > -1, "the pending read is explicitly gated on the absence of a real closetAnchorId");
  });

  it("8.8 source.tsx's loader renders the SAME anchor-incompatible step for a still-ineligible pending piece, reusing the existing component and data shape", () => {
    const src = sourceSrc();
    const idx = src.indexOf('const pendingClosetAnchorId = session.get("styleMePendingClosetAnchorId")');
    assert.ok(idx > -1, "the loader has its own independent re-check, not only occasion.tsx's");
    // Window widened: unrelated additions earlier in this same loader section (the
    // multi-garment handoff's companion resolution, see wi-multi-garment-handoff.test.ts)
    // pushed this block's own content further from pendingClosetAnchorId's declaration.
    const block = src.slice(idx, idx + 2400);
    assert.ok(block.includes('step: "anchor-incompatible" as const'), "reuses the exact same step the WI-locked case renders");
    assert.ok(block.includes('session.set("styleMeClosetAnchorId", resolvedPending.id)'), "the loader can also promote (e.g. direct navigation back to /style-me/source), mirroring occasion.tsx");
    assert.ok(block.includes('redirect("/style-me/result"'));
  });

  it("8.9 a pending piece that no longer resolves (deleted) is dropped, not silently promoted", () => {
    const src = sourceSrc();
    const idx = src.indexOf('const pendingClosetAnchorId = session.get("styleMePendingClosetAnchorId")');
    // Window widened for the same reason as 8.8 above.
    const block = src.slice(idx, idx + 2800);
    const deletedIdx = block.indexOf("Deleted since the rejection");
    assert.ok(deletedIdx > -1);
    assert.ok(block.slice(deletedIdx, deletedIdx + 200).includes('session.unset("styleMePendingClosetAnchorId")'));
  });

  it("8.10 the same compatible/incompatible decision for the pending piece is the one, unmodified evaluateAnchorEligibility — no second eligibility rule", () => {
    // Direct behavioural proof, independent of source text: the same piece, same
    // gate, two different occasions — exactly what Change Occasion exercises.
    const pieceA = closetItem({ work: "Strong", everyday: "No" });
    const stillRejectedForEveryday = evaluateAnchorEligibility(pieceA, "everyday", []);
    const okForWork = evaluateAnchorEligibility(pieceA, "work", []);
    assert.equal(stillRejectedForEveryday.eligible, false);
    assert.equal(okForWork.eligible, true);
  });
});
