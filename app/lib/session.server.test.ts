// app/lib/session.server.test.ts
// Behavioral tests for the clearStyleMeSession cookie helper.
//
// Proves:
//   CS-01  All 9 StyleMe keys are absent after clearStyleMeSession
//   CS-01  An unrelated PKCE key (pkce_state) survives in the same cookie
//   CS-02  The returned value is a valid, parseable __naia_session cookie
//   CS-03  The cleared cookie can be carried in a redirect — proving the
//           start-over action contract (redirect("/style-me/mood") + cleared cookie)
//
// Run: node --test --import tsx/esm app/lib/session.server.test.ts

// Must be set before the module is imported.
// session.server.ts falls back to "default-secret-change-me" but we use an
// explicit value so the test is self-contained and does not depend on .env.
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "test-session-secret-for-unit-tests";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redirect } from "react-router";

import { getSession, commitSession, clearStyleMeSession } from "~/lib/session.server";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Extract the "name=value" segment from a Set-Cookie header to use as a Cookie request header. */
function toCookieHeader(setCookieHeader: string): string {
  return setCookieHeader.split(";")[0];
}

/** Minimal Request carrying a Cookie header; no __naia_tok so getCurrentNaiaCustomer returns null. */
function requestWithCookie(cookieHeader: string): Request {
  return new Request("http://localhost/style-me/result", {
    headers: { Cookie: cookieHeader },
  });
}

const STYLEME_KEYS = [
  "styleMeMood",
  "styleMeFeelings",
  "styleMeBodyNeeds",
  "styleMePractical",
  "styleMeOccasion",
  "styleMeFormalityConditional",
  "styleMeSource",
  "styleMeNadineAnchorHandle",
  "styleMeClosetAnchorId",
] as const;

// ── tests ─────────────────────────────────────────────────────────────────────

describe("clearStyleMeSession — behavioral", () => {
  it("CS-01: clears all 9 StyleMe keys while preserving pkce_state", async () => {
    // Build a session populated with all 9 StyleMe keys plus a PKCE key
    const session = await getSession(null);
    for (const key of STYLEME_KEYS) {
      session.set(key, `val-${key}`);
    }
    session.set("pkce_state", "abc123-pkce-nonce");

    const cookieBefore = toCookieHeader(await commitSession(session));

    // Round-trip sanity: all keys readable before the clear
    const sessionBefore = await getSession(requestWithCookie(cookieBefore).headers.get("Cookie"));
    for (const key of STYLEME_KEYS) {
      assert.equal(sessionBefore.get(key), `val-${key}`, `${key} should be set before clear`);
    }
    assert.equal(sessionBefore.get("pkce_state"), "abc123-pkce-nonce", "pkce_state must be set before clear");

    // Call clearStyleMeSession and parse the returned cookie
    const req = requestWithCookie(cookieBefore);
    const setCookieAfter = await clearStyleMeSession(req);
    const cookieAfter = toCookieHeader(setCookieAfter);
    const sessionAfter = await getSession(requestWithCookie(cookieAfter).headers.get("Cookie"));

    // All 9 StyleMe keys must be absent
    for (const key of STYLEME_KEYS) {
      assert.equal(sessionAfter.get(key), undefined, `${key} must be absent after clearStyleMeSession`);
    }

    // Unrelated PKCE key must still be present
    assert.equal(
      sessionAfter.get("pkce_state"),
      "abc123-pkce-nonce",
      "pkce_state must survive clearStyleMeSession — auth cookie state is never cleared",
    );
  });

  it("CS-02: returned Set-Cookie is a valid parseable __naia_session header", async () => {
    const session = await getSession(null);
    session.set("styleMeMood", "confident");
    const cookieBefore = toCookieHeader(await commitSession(session));

    const setCookieAfter = await clearStyleMeSession(requestWithCookie(cookieBefore));

    assert.ok(
      setCookieAfter.startsWith("__naia_session="),
      "clearStyleMeSession must return a __naia_session Set-Cookie header",
    );
    // Confirm the cleared cookie is parseable and the key is gone
    const cookieAfter = toCookieHeader(setCookieAfter);
    const sessionAfter = await getSession(requestWithCookie(cookieAfter).headers.get("Cookie"));
    assert.equal(sessionAfter.get("styleMeMood"), undefined, "styleMeMood must not appear in the reparsed session");
  });

  it("CS-03: cleared cookie travels correctly in a redirect to /style-me/mood (start-over contract)", async () => {
    // Populate a session with a StyleMe key so we can verify it is cleared
    const session = await getSession(null);
    session.set("styleMeMood", "adventurous");
    session.set("styleMeFeelings", ["more-confident"]);
    const cookieBefore = toCookieHeader(await commitSession(session));

    const req = requestWithCookie(cookieBefore);
    const clearedCookie = await clearStyleMeSession(req);

    // Construct the redirect as the start-over action does
    const response = redirect("/style-me/mood", {
      headers: { "Set-Cookie": clearedCookie },
    });

    // Response must be a 302 to /style-me/mood
    assert.equal(response.status, 302, "start-over redirect must be 302");
    assert.equal(
      response.headers.get("Location"),
      "/style-me/mood",
      "start-over redirect must target /style-me/mood",
    );

    // Set-Cookie header must be present and must be the cleared __naia_session
    const setCookieOnRedirect = response.headers.get("Set-Cookie");
    assert.ok(
      setCookieOnRedirect?.startsWith("__naia_session="),
      "redirect must carry the cleared __naia_session Set-Cookie header",
    );

    // Parsing the cookie on the redirect must show StyleMe keys are gone
    const cookieFromRedirect = toCookieHeader(setCookieOnRedirect!);
    const clearedSession = await getSession(requestWithCookie(cookieFromRedirect).headers.get("Cookie"));
    assert.equal(clearedSession.get("styleMeMood"), undefined, "styleMeMood must be absent in the redirected Set-Cookie");
    assert.equal(clearedSession.get("styleMeFeelings"), undefined, "styleMeFeelings must be absent in the redirected Set-Cookie");
  });
});
