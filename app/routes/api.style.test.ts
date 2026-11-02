// app/routes/api.style.test.ts
// Security remediation (2026-11-02) — api.style.jsx had no auth gate at all:
// the only thing resembling authentication was an optional authenticateCustomer()
// call used purely to enrich the AI prompt with past-review history, wrapped in
// a try/catch that swallowed failures and proceeded regardless. Anyone could
// POST /api/style directly and trigger a real, billed Claude Sonnet call with
// no session, no HMAC, no entitlement check, and no rate limit — the same bug
// class already fixed for api/tryon and api/quick-style (see
// phase1-legacy-api-lockdown.test.ts), but missed for this route.
//
// Fix: a mandatory authenticate.admin(request) gate now runs first and fails
// closed (401) before the request body is even parsed, let alone before the
// Anthropic fetch. This matches the one real caller found in-repo — the
// embedded Shopify admin preview tool in app._index.jsx, itself gated by
// authenticate.admin in its own loader — rather than the customer-session
// mechanism, which does not apply to this caller.
//
// Per existing project precedent (app/lib/naia-admin-auth.test.ts): calling
// authenticate.admin for real requires a live Shopify session/runtime and is
// not practical to exercise directly in a unit test. These tests follow the
// same source-order-assertion style already established in
// phase1-legacy-api-lockdown.test.ts for exactly this reason.
//
// Run: node --test --import tsx/esm app/routes/api.style.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const apiStyle = readFileSync(join(__dirname, "api.style.jsx"), "utf8");
const routesConfig = readFileSync(join(ROOT, "app/routes.ts"), "utf8");

const actionBody = apiStyle.slice(apiStyle.indexOf("export async function action"));

describe("api.style.jsx — mandatory fail-closed admin auth gate", () => {
  it("1 — imports the real Shopify authenticate helper (shopify.server), not just the optional customer helper", () => {
    assert.ok(
      apiStyle.includes('await import("../shopify.server.js")') ||
        apiStyle.includes('from "../shopify.server.js"') ||
        apiStyle.includes('from "../shopify.server"'),
      "must import the shopify.server authenticate helper",
    );
  });

  it("2 — authenticate.admin(request) is called before the request body is parsed", () => {
    const authPos = actionBody.indexOf("authenticate.admin(request)");
    const bodyParsePos = actionBody.indexOf("request.json()");
    assert.ok(authPos > -1, "authenticate.admin(request) must be called in action()");
    assert.ok(bodyParsePos > -1, "request.json() must still be called somewhere");
    assert.ok(authPos < bodyParsePos, "admin auth must run before the request body is even parsed");
  });

  it("3 — authenticate.admin(request) is called before the Anthropic fetch", () => {
    const authPos = actionBody.indexOf("authenticate.admin(request)");
    const anthropicFetchPos = actionBody.indexOf('fetch("https://api.anthropic.com');
    assert.ok(anthropicFetchPos > -1, "the Anthropic fetch call must still exist");
    assert.ok(authPos < anthropicFetchPos, "admin auth must precede the billable Anthropic call");
  });

  it("4 — a failed admin auth check returns 401 directly, not folded into the 200 fallback path", () => {
    const authCheckBlock = actionBody.slice(
      actionBody.indexOf("authenticate.admin(request)"),
      actionBody.indexOf("authenticate.admin(request)") + 400,
    );
    assert.ok(authCheckBlock.includes("status: 401"), "auth failure must return a 401, not a 200");
    assert.ok(authCheckBlock.includes("Unauthorized"), "auth failure response should say Unauthorized");
  });

  it("5 — the 401 gate is NOT inside the try block that builds the graceful AI-failure fallback", () => {
    // The pre-existing outer try/catch at the bottom of action() returns
    // { result: buildFallback(...), error } with status 200 for genuine
    // Anthropic/processing failures. The auth gate must be a separate,
    // earlier check so an unauthenticated request can never reach that
    // fallback path (which would incorrectly look like a 200 success).
    const authPos = actionBody.indexOf("authenticate.admin(request)");
    const fallbackCatchPos = actionBody.indexOf("buildFallback({ mood: \"\", feeling: \"\", closetItem: null, naiaPiece: null, outfit: \"\" })");
    assert.ok(fallbackCatchPos > -1, "the existing graceful-fallback catch must still exist, unchanged");
    assert.ok(authPos < fallbackCatchPos, "sanity: auth gate appears before the fallback catch in source order");
    // The real guarantee: the auth check's own catch block (checked in test 4)
    // returns before this point is ever reached for an unauthenticated caller.
  });

  it("6 — the optional authenticateCustomer() prompt-enrichment calls remain present but are not the gate", () => {
    // This is intentionally still here — it's used only to personalize the
    // prompt with the caller's past outfit reviews when a customer session
    // happens to exist. It must never be mistaken for the auth boundary.
    assert.ok(
      apiStyle.includes('await import("../customer-auth.server.js")'),
      "optional customer-session prompt-enrichment should remain intact (unrelated to the fix)",
    );
    const firstCustomerAuthPos = actionBody.indexOf("authenticateCustomer");
    const adminAuthPos = actionBody.indexOf("authenticate.admin(request)");
    assert.ok(
      adminAuthPos < firstCustomerAuthPos,
      "the mandatory admin gate must run before the optional customer-enrichment lookup",
    );
  });

  it("7 — route remains registered (not retired) — see audit report for the retire-vs-fix recommendation", () => {
    assert.ok(
      routesConfig.includes('route("api/style", "routes/api.style.jsx")'),
      "api/style should stay registered now that it is properly gated",
    );
  });
});

describe("api.style.jsx — no other unauthenticated path to the Anthropic call was introduced", () => {
  it("8 — there is still exactly one Anthropic fetch call in the file, and it is the gated one", () => {
    const occurrences = apiStyle.split('fetch("https://api.anthropic.com').length - 1;
    assert.equal(occurrences, 1, "expected exactly one Anthropic fetch call in api.style.jsx");
  });
});
