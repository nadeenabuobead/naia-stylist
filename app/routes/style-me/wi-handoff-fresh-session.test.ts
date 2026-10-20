// app/routes/style-me/wi-handoff-fresh-session.test.ts
//
// Entering StyleMe from Wardrobe Intelligence inherited the previous session's answers.
//
// Manual QA: clicking "Style this in StyleMe →" on the Blue Chambray Button-Up Shirt
// resolved the right garment, locked it as the MANUAL anchor and showed the lock screen —
// all correct — but the new questionnaire arrived with an old intention
// ("HELP ME FEEL SHARPER") already selected.
//
// ROOT CAUSE. api.wi-style-this.tsx primes the anchor and nothing else. It sets
// styleMeSource / styleMeMode / styleMeClosetAnchorId / styleMeAnchorProvenance /
// styleMeAnchorLocked and unsets styleMeNadineAnchorHandle / styleMeAnchorMode — so every
// other StyleMe key in the cookie survives from whatever session came before. The two
// NADINE doorways already do this correctly (clearLegacyQuestionnaireKeys plus an explicit
// unset list); the WI doorway never got that treatment.
//
// The anchor mechanism itself is correct and is NOT touched by this change — the existing
// 17 tests in wi-handoff.test.ts continue to own it.
//
// WIF-A.1 is the load-bearing test, and deliberately not a hand-written key list: it
// derives the expectation from STYLEME_SESSION_KEYS, the same registry clearStyleMeSession
// iterates. A key added to that registry later is automatically covered here, which is
// exactly how this bug would otherwise come back — the registry already documents itself as
// the thing a missing key "silently survives" past.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { STYLEME_SESSION_KEYS } from "~/lib/session.server";

const ROUTE = "app/routes/api.wi-style-this.tsx";
const route = (): string => readFileSync(join(process.cwd(), ROUTE), "utf8");

/** Keys the handoff legitimately owns and sets on purpose. */
const OWNED = new Set([
  "styleMeClosetAnchorId",
  "styleMeAnchorProvenance",
  "styleMeAnchorLocked",
  "styleMeSource",
  "styleMeMode",
]);

/** True when the route provably clears this key — individually or via the registry loop. */
function clears(src: string, key: string): boolean {
  if (new RegExp(`session\\.unset\\("${key}"\\)`).test(src)) return true;
  // The robust form: iterate the authoritative registry.
  return /for \(const key of STYLEME_SESSION_KEYS\)[\s\S]{0,120}session\.unset\(key\)/.test(src);
}

describe("WIF-A — the WI handoff starts a fresh Today questionnaire", () => {
  it("WIF-A.1 no key in STYLEME_SESSION_KEYS survives the handoff untouched", () => {
    const src = route();
    const survivors = STYLEME_SESSION_KEYS.filter(
      (k) => !OWNED.has(k) && !clears(src, k),
    );
    assert.deepEqual(
      survivors, [],
      `these stale keys carry into the new questionnaire: ${survivors.join(", ")}`,
    );
  });

  it("WIF-A.2 stale state / mood is cleared", () => {
    const src = route();
    for (const k of ["styleMeState", "styleMeStateOtherText", "styleMeMood", "styleMeFeelings"]) {
      assert.ok(clears(src, k), `${k} must not carry over`);
    }
  });

  it("WIF-A.3 stale intentions are cleared", () => {
    // The exact symptom QA reported: "HELP ME FEEL SHARPER" pre-selected.
    assert.ok(clears(route(), "styleMeIntentions"));
  });

  it("WIF-A.4 stale occasion / formality / coverage are cleared", () => {
    const src = route();
    for (const k of ["styleMeOccasion", "styleMeFormalityConditional", "styleMeCoverageConditional"]) {
      assert.ok(clears(src, k), `${k} must not carry over`);
    }
  });

  it("WIF-A.5 stale source/mode residue and a previous doorway stamp are cleared", () => {
    const src = route();
    // styleMeHandoffOrigin matters most: left behind from a NADINE entry it would make
    // source.tsx treat this closet-only WI session as a NADINE-entry one.
    for (const k of ["styleMeSourcePrev", "styleMeAnchorMethodPrev", "styleMeHandoffOrigin", "styleMeAnchorMode", "styleMeNadineAnchorHandle"]) {
      assert.ok(clears(src, k), `${k} must not carry over`);
    }
  });

  it("WIF-A.6 stale body-need / practical answers are cleared", () => {
    const src = route();
    for (const k of ["styleMeBodyNeeds", "styleMeBodyNeedsRaw", "styleMePractical"]) {
      assert.ok(clears(src, k), `${k} must not carry over`);
    }
  });
});

describe("WIF-B — what the click established is preserved", () => {
  it("WIF-B.1 the clicked closetItemId survives", () => {
    assert.match(route(), /session\.set\("styleMeClosetAnchorId", resolved\.id\)/,
      "the server-resolved owned id, exactly as before");
  });

  it("WIF-B.2 provenance stays MANUAL", () => {
    assert.match(route(), /session\.set\("styleMeAnchorProvenance", "MANUAL"\)/);
  });

  it("WIF-B.3 the anchor stays locked", () => {
    assert.match(route(), /session\.set\("styleMeAnchorLocked", "1"\)/);
  });

  it("WIF-B.4 the clearing happens BEFORE the anchor is set", () => {
    // Order is the whole correctness of this fix: clear-then-set. Set-then-clear would
    // wipe the garment she just clicked.
    const src = route();
    const clearAt = src.search(/for \(const key of STYLEME_SESSION_KEYS\)/);
    const anchorAt = src.indexOf('session.set("styleMeClosetAnchorId"');
    assert.ok(clearAt > -1, "expected the registry-driven clear");
    assert.ok(anchorAt > -1);
    assert.ok(clearAt < anchorAt, "clearing after setting would discard the clicked anchor");
  });

  it("WIF-B.5 authentication and Passport/profile are never touched", () => {
    const src = route();
    assert.doesNotMatch(src, /destroySession/, "the customer must stay signed in");
    // Only StyleMe keys are unset; the registry contains styleMe* keys exclusively.
    for (const k of STYLEME_SESSION_KEYS) {
      assert.ok(k.startsWith("styleMe"), `${k} is in the StyleMe registry but is not a styleMe key`);
    }
    assert.match(src, /getCurrentNaiaCustomer\(request\)/, "identity is still required");
    assert.doesNotMatch(src, /onboardingProfile|dressingPreferences|PASSPORT/,
      "the handoff has no business touching Passport data");
  });

  it("WIF-B.6 ownership is still re-verified server-side — now for every submitted garment, not just one", () => {
    // Was resolveClosetAnchor(naiaCustomer.id, closetItemId) against a single id.
    // The multi-garment handoff (see wi-multi-garment-handoff.test.ts) loops this
    // same ownership check over every id a combination submits, failing the whole
    // set closed on the first one that doesn't resolve.
    const src = route();
    assert.match(src, /for \(const id of closetItemIds\)/, "must loop over every submitted id");
    assert.match(src, /resolveClosetAnchor\(naiaCustomer\.id, id\)/, "each one is still ownership-checked server-side");
  });
});

describe("WIF-C — downstream, the flow behaves as a fresh session with a locked anchor", () => {
  it("WIF-C.1 the questionnaire's first step has nothing pre-selected once state is cleared", () => {
    // state.tsx reads styleMeState and renders `selected`; with the key unset it is null.
    const state = readFileSync(join(process.cwd(), "app/routes/style-me/state.tsx"), "utf8");
    assert.match(state, /session\.get\(STATE_QUESTION\.storageKey\)/);
    assert.match(state, /selected: selected \?\? null/,
      "an unset key must present as no selection, not as a stale one");
  });

  it("WIF-C.2 the final anchor step still renders the exact clicked garment", () => {
    const source = readFileSync(join(process.cwd(), "app/routes/style-me/source.tsx"), "utf8");
    assert.match(source, /styleMeAnchorLocked/, "the lock short-circuit must remain");
    assert.match(source, /step: "anchor-locked"/);
    assert.match(source, /Styling around/, "AnchorLockedStep's confirmation copy");
  });

  it("WIF-C.3 the handoff still lands on the questionnaire's first step", () => {
    assert.match(route(), /redirect\("\/style-me\/state"/);
  });
});
