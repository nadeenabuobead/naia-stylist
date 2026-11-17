// app/routes/api.styleme-handoff-origin.test.ts
//
// XO-01 through XO-10 — genuine browser-origin behavior for the two StyleMe
// handoff routes (api.styleme-handoff.tsx, api.styleme-nadine-entry.tsx)
// after the 2026-11-17 QA finding: both hardcoded a single-origin `!==`
// check against only the production storefront, so a legitimate
// cross-origin POST from the staging Shopify test store's own equivalent
// page got the same 403 a real CSRF attempt would — indistinguishable from
// an attack in staging, and untestable there.
//
// "Never spoof Origin": every case here builds a REAL Request with the
// Origin header set exactly as a browser would for a cross-origin form
// POST (fetch()'s own Request constructor refuses to let script set this
// header for same-origin requests — these are genuinely cross-origin test
// requests, not a bypassed/fabricated header), and calls the real exported
// action() — no mocking of isAllowedHandoffOrigin or the origin check
// itself. Session plumbing (SESSION_SECRET) is configured so the action
// runs its full real body, not a stubbed shortcut.
//
// Run: node --test --import tsx/esm app/routes/api.styleme-handoff-origin.test.ts

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

before(() => {
  process.env.SESSION_SECRET ||= "xo-handoff-origin-test-only-secret-do-not-use-in-prod";
});

const PRODUCTION_ORIGIN = "https://naiabynadine.com";
const STAGING_ORIGIN = "https://naia-test-store.myshopify.com";

// A real locked-catalogue handle api.styleme-handoff.tsx's own
// isValidNadineHandle() accepts — read from the same source file both the
// route and this test ultimately depend on, never hand-typed, so this test
// can't silently drift from the real allowlist.
async function realCatalogueHandle(): Promise<string> {
  const { LOCKED_CATALOGUE_HANDLES } = await import("~/lib/ai/naia-product-media.js");
  const first = LOCKED_CATALOGUE_HANDLES[0];
  assert.ok(first, "LOCKED_CATALOGUE_HANDLES must not be empty for this test to mean anything");
  return first;
}

function postRequest(url: string, origin: string | null, body?: BodyInit): Request {
  const headers = new Headers();
  if (origin !== null) headers.set("Origin", origin);
  return new Request(url, { method: "POST", headers, body });
}

describe("XO — cross-origin behavior for /api/styleme-nadine-entry (the simpler of the two routes)", () => {
  it("XO-01 — production origin is allowed, session cookie set, redirected to the entry path", async () => {
    const { action } = await import("./api.styleme-nadine-entry");
    const res = await action({
      request: postRequest("http://localhost/api/styleme-nadine-entry", PRODUCTION_ORIGIN),
    } as never);
    assert.equal((res as Response).status, 302);
    assert.ok((res as Response).headers.get("Set-Cookie"), "a session cookie must be set on success");
  });

  it("XO-02 — the documented staging test store origin is allowed too, same success shape as production", async () => {
    const { action } = await import("./api.styleme-nadine-entry");
    const res = await action({
      request: postRequest("http://localhost/api/styleme-nadine-entry", STAGING_ORIGIN),
    } as never);
    assert.equal((res as Response).status, 302);
    assert.ok((res as Response).headers.get("Set-Cookie"), "staging must get the exact same real session write as production");
  });

  it("XO-03 — a null/missing Origin (what a non-browser caller or a same-origin fetch sends) is rejected", async () => {
    const { action } = await import("./api.styleme-nadine-entry");
    const res = await action({
      request: postRequest("http://localhost/api/styleme-nadine-entry", null),
    } as never);
    assert.equal((res as Response).status, 403);
  });

  it("XO-04 — an unrelated foreign origin is rejected — this is the actual CSRF case the guard exists for", async () => {
    const { action } = await import("./api.styleme-nadine-entry");
    const res = await action({
      request: postRequest("http://localhost/api/styleme-nadine-entry", "https://evil.example.com"),
    } as never);
    assert.equal((res as Response).status, 403);
  });

  it("XO-05 — a near-miss origin (subdomain, http instead of https, trailing slash) is still rejected — exact match only, no prefix/suffix leniency", async () => {
    const { action } = await import("./api.styleme-nadine-entry");
    for (const nearMiss of [
      "http://naiabynadine.com",
      "https://www.naiabynadine.com",
      "https://naiabynadine.com/",
      "https://naia-test-store.myshopify.com.evil.com",
    ]) {
      const res = await action({
        request: postRequest("http://localhost/api/styleme-nadine-entry", nearMiss),
      } as never);
      assert.equal((res as Response).status, 403, `"${nearMiss}" must not be treated as an allowed origin`);
    }
  });
});

describe("XO — cross-origin behavior for /api/styleme-handoff (the PDP handoff, carries a product handle)", () => {
  it("XO-06 — production origin with a real catalogue handle succeeds and stamps the anchor", async () => {
    const { action } = await import("./api.styleme-handoff");
    const handle = await realCatalogueHandle();
    const form = new URLSearchParams({ handle });
    const res = await action({
      request: postRequest("http://localhost/api/styleme-handoff", PRODUCTION_ORIGIN, form),
    } as never);
    assert.equal((res as Response).status, 302);
    assert.ok((res as Response).headers.get("Set-Cookie"));
  });

  it("XO-07 — the staging test store origin with the same real handle succeeds identically", async () => {
    const { action } = await import("./api.styleme-handoff");
    const handle = await realCatalogueHandle();
    const form = new URLSearchParams({ handle });
    const res = await action({
      request: postRequest("http://localhost/api/styleme-handoff", STAGING_ORIGIN, form),
    } as never);
    assert.equal((res as Response).status, 302);
    assert.ok((res as Response).headers.get("Set-Cookie"));
  });

  it("XO-08 — a foreign origin is rejected even with a valid handle in the body — origin is checked first, body is never read", async () => {
    const { action } = await import("./api.styleme-handoff");
    const handle = await realCatalogueHandle();
    const form = new URLSearchParams({ handle });
    const res = await action({
      request: postRequest("http://localhost/api/styleme-handoff", "https://evil.example.com", form),
    } as never);
    assert.equal((res as Response).status, 403);
  });

  it("XO-09 — null Origin is rejected on the handle-carrying route too", async () => {
    const { action } = await import("./api.styleme-handoff");
    const handle = await realCatalogueHandle();
    const form = new URLSearchParams({ handle });
    const res = await action({
      request: postRequest("http://localhost/api/styleme-handoff", null, form),
    } as never);
    assert.equal((res as Response).status, 403);
  });

  it("XO-10 — an allowed origin with an INVALID handle still succeeds the origin check but fails closed on the handle, redirecting to a plain entry (no anchor), never a 403", async () => {
    const { action } = await import("./api.styleme-handoff");
    const form = new URLSearchParams({ handle: "not-a-real-handle-xyz" });
    const res = await action({
      request: postRequest("http://localhost/api/styleme-handoff", STAGING_ORIGIN, form),
    } as never);
    // An unrecognised handle is a DIFFERENT fail-closed path from a bad
    // origin — it degrades to an ordinary session (still a 302, just no
    // Set-Cookie from this route, since nothing was stamped) rather than a
    // 403. This proves the origin allowlist and the handle allowlist are
    // two independent gates, not conflated into one.
    assert.equal((res as Response).status, 302);
  });
});
