// app/lib/styleme/provenance-session-isolation.test.ts
//
// styleMeAnchorProvenance was missing from STYLEME_SESSION_KEYS, so clearStyleMeSession —
// Start Over — left it behind.
//
// Why that is a session-isolation bug and not a tidiness one: provenance governs whether
// New Look may move the anchor. result.tsx reads it and treats MANUAL as "vary the outfit
// around this piece, never replace it". A stale MANUAL surviving Start Over pins the next
// session's reroll to an anchor the customer never chose; a stale AUTO lets a reroll move a
// piece she did choose. Both are wrong, and in opposite directions.
//
// These tests exercise the REAL cookie session round-trip (createCookieSessionStorage has a
// default secret, so no env setup is needed) rather than asserting registry membership —
// membership is the mechanism, clearing is the behaviour, and the behaviour is what broke.
//
// The fix belongs in the registry, not in Start Over: STYLEME_SESSION_KEYS is documented as
// the source of truth that clearStyleMeSession iterates, and a one-off unset alongside it
// would be a second place to forget.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getSession,
  commitSession,
  clearStyleMeSession,
  STYLEME_SESSION_KEYS,
} from "~/lib/session.server";

/** Set-Cookie -> a Cookie request header carrying just the pair. */
const asCookie = (setCookie: string): string => setCookie.split(";")[0];

const req = (cookie: string) =>
  new Request("https://example.test/style-me", { headers: { Cookie: cookie } });

/** Builds a committed session holding `entries`, and returns its Cookie header. */
async function seed(entries: Record<string, string>): Promise<string> {
  const session = await getSession(null);
  for (const [k, v] of Object.entries(entries)) session.set(k, v);
  return asCookie(await commitSession(session));
}

/** Runs Start Over over that cookie and returns the resulting session. */
async function startOver(cookie: string) {
  const cleared = await clearStyleMeSession(req(cookie));
  return getSession(asCookie(cleared));
}

// ── PSI-A: Start Over cannot carry provenance ─────────────────────────────

describe("PSI-A — Start Over clears anchor provenance", () => {
  test("PSI-A.1 a stale MANUAL does not survive", async () => {
    const after = await startOver(await seed({
      styleMeAnchorProvenance: "MANUAL",
      styleMeClosetAnchorId: "closet-1",
    }));
    assert.equal(after.get("styleMeAnchorProvenance"), undefined,
      "a stale MANUAL pins the next session's reroll to an anchor she never chose");
  });

  test("PSI-A.2 a stale AUTO does not survive", async () => {
    const after = await startOver(await seed({
      styleMeAnchorProvenance: "AUTO",
      styleMeClosetAnchorId: "closet-2",
    }));
    assert.equal(after.get("styleMeAnchorProvenance"), undefined,
      "a stale AUTO lets a reroll move a piece she did choose");
  });

  test("PSI-A.3 the anchor it described goes with it", async () => {
    const after = await startOver(await seed({
      styleMeAnchorProvenance: "MANUAL",
      styleMeClosetAnchorId: "closet-3",
      styleMeAnchorLocked: "1",
    }));
    for (const k of ["styleMeAnchorProvenance", "styleMeClosetAnchorId", "styleMeAnchorLocked"]) {
      assert.equal(after.get(k), undefined, `${k} must not survive Start Over`);
    }
  });

  test("PSI-A.4 every registry key is genuinely cleared, end to end", async () => {
    // Behavioural proof for the whole registry, not just the key that was missing.
    const seeded: Record<string, string> = {};
    for (const k of STYLEME_SESSION_KEYS) seeded[k] = "stale";
    seeded.styleMeAnchorProvenance = "MANUAL";
    const after = await startOver(await seed(seeded));
    const survivors = [...STYLEME_SESSION_KEYS, "styleMeAnchorProvenance"]
      .filter((k) => after.get(k) !== undefined);
    assert.deepEqual(survivors, [], `survived Start Over: ${survivors.join(", ")}`);
  });
});

// ── PSI-B: nothing else is disturbed ──────────────────────────────────────

describe("PSI-B — unrelated session state is untouched", () => {
  test("PSI-B.1 non-StyleMe keys survive Start Over", async () => {
    const after = await startOver(await seed({
      styleMeAnchorProvenance: "MANUAL",
      styleMeIntentions: "feel-sharper",
      // Stand-ins for anything else the app cookie may carry.
      returnTo: "/my-naia",
      someUnrelatedFlag: "keep-me",
    }));
    assert.equal(after.get("styleMeAnchorProvenance"), undefined);
    assert.equal(after.get("styleMeIntentions"), undefined);
    assert.equal(after.get("returnTo"), "/my-naia", "Start Over clears StyleMe, not the app");
    assert.equal(after.get("someUnrelatedFlag"), "keep-me");
  });

  test("PSI-B.2 the registry contains only styleMe keys", () => {
    for (const k of STYLEME_SESSION_KEYS) {
      assert.ok(k.startsWith("styleMe"),
        `${k} is in the StyleMe registry but is not a styleMe key — it would be cleared by Start Over`);
    }
  });

  test("PSI-B.3 Start Over does not destroy the session", () => {
    const src = readFileSync(join(process.cwd(), "app/lib/session.server.ts"), "utf8");
    const fn = src.slice(src.indexOf("export async function clearStyleMeSession"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.doesNotMatch(body, /destroySession/, "the customer must stay signed in");
    assert.match(body, /for \(const key of STYLEME_SESSION_KEYS\)/,
      "the registry stays the single source of truth");
  });
});

// ── PSI-C: the writers that must keep working ─────────────────────────────

describe("PSI-C — routes that set provenance deliberately still do", () => {
  const route = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  test("PSI-C.1 the WI handoff clears first, then sets MANUAL back", () => {
    const src = route("app/routes/api.wi-style-this.tsx");
    const clearAt = src.search(/for \(const key of STYLEME_SESSION_KEYS\)/);
    const setAt = src.indexOf('session.set("styleMeAnchorProvenance", "MANUAL")');
    assert.ok(clearAt > -1 && setAt > -1);
    assert.ok(clearAt < setAt,
      "the registry clear now removes provenance, so the handoff must set it back afterwards");
  });

  test("PSI-C.2 the NADINE doorways still clear provenance explicitly", () => {
    // They clear their own lists rather than the registry; both must keep doing so.
    for (const rel of ["app/routes/api.styleme-nadine-entry.tsx", "app/routes/style-me.nadine-preview.tsx"]) {
      assert.match(route(rel), /session\.unset\("styleMeAnchorProvenance"\)/, rel);
    }
  });

  test("PSI-C.3 the manual and auto pick sites still stamp provenance", () => {
    const src = route("app/routes/style-me/source.tsx");
    assert.match(src, /session\.set\("styleMeAnchorProvenance", "MANUAL"\)/);
    assert.match(src, /session\.set\("styleMeAnchorProvenance", "AUTO"\)/);
  });

  test("PSI-C.4 New Look / reroll semantics are unchanged when provenance is present", () => {
    const src = route("app/routes/style-me/result.tsx");
    assert.match(src, /rawProvenance === "AUTO" \? "AUTO" : rawProvenance === "MANUAL" \? "MANUAL" : null/,
      "the reader is untouched — only the lifetime of the value changed");
  });
});
