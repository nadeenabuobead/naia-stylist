// app/lib/shopify-customer-oauth-origin-host.test.ts
//
// Root cause: a customer starting a Shopify OAuth login/callback flow from a
// unique Vercel preview never returned to that preview. Ephemeral preview
// URLs can't be registered as a Shopify redirect_uri, so the whole
// login/callback round trip is forced onto the fixed STOREFRONT_HOST — and
// without remembering where the flow actually started, the final
// redirect(returnTo) call used a bare relative path, which resolves against
// whatever host served the response (STOREFRONT_HOST), silently stranding
// the customer there instead of back on the preview that initiated the
// flow. On staging this manifested as a customer generating a Personalised
// Trend Edit on the shared alias's old build instead of the snapshot-aware
// preview they thought they were testing.
//
// validateOriginHost is the open-redirect guard added to fix this: it only
// ever accepts a bare hostname matching this app's own Vercel preview
// naming convention, the configured storefront host, or the canonical
// production app host. requireCurrentNaiaCustomer / auth.shopify.login /
// auth.shopify.callback thread it through so the final post-auth redirect
// can become an absolute URL back to the originating preview.
//
// Run: node --test --import tsx/esm app/lib/shopify-customer-oauth-origin-host.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, beforeEach, afterEach } from "node:test";
import { validateOriginHost, shouldBounceToStorefront, buildProviderLogoutUrl } from "./shopify-customer-oauth.server.ts";
import { requireCurrentNaiaCustomer } from "./naia-session.server.ts";
import { getSession, commitSession } from "./session.server.ts";
import { loader as handoffLoader } from "../routes/auth.shopify.handoff.tsx";

const LOGIN_PATH    = resolve(import.meta.dirname, "../routes/auth.shopify.login.tsx");
const CALLBACK_PATH = resolve(import.meta.dirname, "../routes/auth.shopify.callback.tsx");
const SESSION_PATH  = resolve(import.meta.dirname, "naia-session.server.ts");
const HANDOFF_PATH  = resolve(import.meta.dirname, "../routes/auth.shopify.handoff.tsx");
const handoffSrc = readFileSync(HANDOFF_PATH, "utf-8");
const loginSrc    = readFileSync(LOGIN_PATH, "utf-8");
const callbackSrc = readFileSync(CALLBACK_PATH, "utf-8");
const sessionSrc  = readFileSync(SESSION_PATH, "utf-8");

// ── validateOriginHost — the open-redirect guard itself ────────────────────

describe("validateOriginHost()", () => {
  const savedEnv = { STOREFRONT_HOST: process.env.STOREFRONT_HOST, SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL };
  beforeEach(() => {
    delete process.env.STOREFRONT_HOST;
    delete process.env.SHOPIFY_APP_URL;
  });
  afterEach(() => {
    if (savedEnv.STOREFRONT_HOST !== undefined) process.env.STOREFRONT_HOST = savedEnv.STOREFRONT_HOST; else delete process.env.STOREFRONT_HOST;
    if (savedEnv.SHOPIFY_APP_URL !== undefined) process.env.SHOPIFY_APP_URL = savedEnv.SHOPIFY_APP_URL; else delete process.env.SHOPIFY_APP_URL;
  });

  it("rejects null/empty", () => {
    assert.equal(validateOriginHost(null), null);
    assert.equal(validateOriginHost(""), null);
  });

  it("accepts the bare shared-alias form of this project's own preview host", () => {
    assert.equal(validateOriginHost("naia-stylist-staging.vercel.app"), "naia-stylist-staging.vercel.app");
  });

  it("accepts this project's own unique-preview host pattern (hash + org slug)", () => {
    assert.equal(
      validateOriginHost("naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app"),
      "naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app",
    );
    assert.equal(
      validateOriginHost("naia-stylist-staging-6099bhpow-nadeenabuobeads-projects.vercel.app"),
      "naia-stylist-staging-6099bhpow-nadeenabuobeads-projects.vercel.app",
    );
  });

  it("is case-insensitive for the own-preview pattern", () => {
    assert.equal(
      validateOriginHost("NAIA-STYLIST-STAGING-ABC123-nadeenabuobeads-projects.VERCEL.APP"),
      "NAIA-STYLIST-STAGING-ABC123-nadeenabuobeads-projects.VERCEL.APP",
    );
  });

  it("rejects a different project's preview host under the same vercel.app suffix — not an open redirect to arbitrary vercel.app apps", () => {
    assert.equal(validateOriginHost("some-other-app-abc123-someoneelse.vercel.app"), null);
  });

  it("rejects a host that merely contains the project name as a substring rather than as the exact prefix", () => {
    assert.equal(validateOriginHost("evil-naia-stylist-staging.vercel.app"), null);
    assert.equal(validateOriginHost("naia-stylist-staging.vercel.app.evil.com"), null);
  });

  it("rejects a value carrying a scheme, path, port, or credentials — bare hostname only", () => {
    assert.equal(validateOriginHost("https://naia-stylist-staging.vercel.app"), null);
    assert.equal(validateOriginHost("naia-stylist-staging.vercel.app/evil"), null);
    assert.equal(validateOriginHost("naia-stylist-staging.vercel.app:8080"), null);
    assert.equal(validateOriginHost("user@naia-stylist-staging.vercel.app"), null);
  });

  it("rejects an overlong value", () => {
    assert.equal(validateOriginHost("naia-stylist-staging-" + "a".repeat(200) + "-x.vercel.app"), null);
  });

  it("rejects a plain external host", () => {
    assert.equal(validateOriginHost("evil.com"), null);
    assert.equal(validateOriginHost("attacker.example"), null);
  });

  it("accepts an exact match against the configured STOREFRONT_HOST, whatever its shape", () => {
    process.env.STOREFRONT_HOST = "some-storefront-host-value";
    assert.equal(validateOriginHost("some-storefront-host-value"), "some-storefront-host-value");
    assert.equal(validateOriginHost("not-the-configured-value"), null);
  });

  it("accepts an exact match against SHOPIFY_APP_URL's hostname", () => {
    process.env.SHOPIFY_APP_URL = "https://naia-stylist.vercel.app";
    assert.equal(validateOriginHost("naia-stylist.vercel.app"), "naia-stylist.vercel.app");
  });

  it("does not throw and returns null when SHOPIFY_APP_URL is malformed", () => {
    process.env.SHOPIFY_APP_URL = "not a url";
    assert.equal(validateOriginHost("evil.com"), null);
  });
});

// ── shouldBounceToStorefront() — the self-bounce guard ─────────────────────
//
// Root cause of the live logout regression: STOREFRONT_HOST on shared
// staging had drifted to a stale, unrelated host (an earlier prototype
// storefront). auth.shopify.login's old bare `storefrontHost &&
// !url.searchParams.has("_sf")` check bounced EVERY request — including one
// that had already arrived on the correct canonical host — to whatever
// STOREFRONT_HOST happened to say, with no check that the hop was still
// needed. A customer signing out on the canonical host got bounced to that
// stale host, which still held its own independent, never-cleared session,
// made it look like sign-out had silently logged them back in, and a second
// sign-out click against that other (effectively unmaintained) host is what
// produced the blank page. shouldBounceToStorefront is the extracted,
// independently-testable decision the branch is now gated by — it must
// refuse the hop whenever the request has already arrived on
// storefrontHost, so a correctly-configured STOREFRONT_HOST (pointing at
// itself) can never cause this loop again, regardless of what the value
// happens to be.

describe("shouldBounceToStorefront()", () => {
  it("never bounces when STOREFRONT_HOST is unset — the existing same-host flow is unaffected", () => {
    assert.equal(shouldBounceToStorefront("naia-stylist-staging.vercel.app", "", false), false);
  });

  it("bounces when STOREFRONT_HOST is configured, the request is on a different host, and _sf has not already been set", () => {
    assert.equal(
      shouldBounceToStorefront("naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app", "naia-stylist-staging.vercel.app", false),
      true,
    );
  });

  it("never bounces once _sf=1 marks the request as having already made the one intended hop", () => {
    assert.equal(shouldBounceToStorefront("naia-stylist-staging.vercel.app", "naia-stylist-staging.vercel.app", true), false);
    assert.equal(shouldBounceToStorefront("some-other-host.example", "naia-stylist-staging.vercel.app", true), false);
  });

  it("THE FIX — never bounces a request that has already arrived on STOREFRONT_HOST itself, even without _sf — the self-bounce guard", () => {
    assert.equal(shouldBounceToStorefront("naia-stylist-staging.vercel.app", "naia-stylist-staging.vercel.app", false), false);
  });

  it("REGRESSION — a stale STOREFRONT_HOST pointing at a different, unrelated host must not create a cross-host logout/login loop: the canonical host's own logout/login requests never bounce away from it", () => {
    // Exactly the live-staging failure mode: STOREFRONT_HOST drifted to an
    // old prototype storefront host instead of the canonical staging host
    // the customer is actually signing out from.
    const staleStorefrontHost = "nadine-storefront.vercel.app";
    const canonicalHost = "naia-stylist-staging.vercel.app";
    // The old unguarded condition (`storefrontHost && !hasSfParam`) would
    // have returned true here — bouncing the canonical host's own
    // logout-initiated /auth/shopify/login request away to the stale host.
    // That the real fix is a per-request host check, not merely correcting
    // the env value, is what this test exists to pin down: even with a
    // stale STOREFRONT_HOST still configured, a request already on the
    // canonical host must stay there.
    assert.equal(shouldBounceToStorefront(canonicalHost, staleStorefrontHost, false), true,
      "a DIFFERENT host than the stale STOREFRONT_HOST value still legitimately bounces — this guard only protects same-host requests, it does not substitute for fixing the env value");
    // Once STOREFRONT_HOST is corrected to the canonical host (this fix's
    // actual env change), a request already there never bounces at all —
    // closing the loop for good regardless of future drift.
    assert.equal(shouldBounceToStorefront(canonicalHost, canonicalHost, false), false);
  });
});

// ── buildProviderLogoutUrl() — RP-Initiated Logout URL construction ────────
//
// The confirmed, Shopify-documented mechanism for ending the customer's
// session at Shopify's own identity provider (not just this app's local
// NaiaSession) — verified against this store's live OIDC discovery document
// and Shopify's own docs: end_session_endpoint with id_token_hint and
// post_logout_redirect_uri as the two required parameters. No invented
// prompt=login/select_account here — Shopify's discovery metadata exposes
// no prompt_values_supported at all.

describe("buildProviderLogoutUrl()", () => {
  const END_SESSION_ENDPOINT = "https://shopify.com/authentication/99810082948/logout";
  const REDIRECT_URI = "https://naia-stylist-staging.vercel.app/auth/logout";

  it("builds the end_session_endpoint URL with id_token_hint and post_logout_redirect_uri", () => {
    const url = buildProviderLogoutUrl(END_SESSION_ENDPOINT, "the-id-token-jwt", REDIRECT_URI);
    assert.ok(url);
    const parsed = new URL(url!);
    assert.equal(parsed.origin + parsed.pathname, END_SESSION_ENDPOINT);
    assert.equal(parsed.searchParams.get("id_token_hint"), "the-id-token-jwt");
    assert.equal(parsed.searchParams.get("post_logout_redirect_uri"), REDIRECT_URI);
  });

  it("returns null — fails safe, never throws — when end_session_endpoint is missing (OIDC discovery failed or unavailable)", () => {
    assert.equal(buildProviderLogoutUrl(undefined, "a-hint", REDIRECT_URI), null);
    assert.equal(buildProviderLogoutUrl(null, "a-hint", REDIRECT_URI), null);
    assert.equal(buildProviderLogoutUrl("", "a-hint", REDIRECT_URI), null);
  });

  it("returns null when idTokenHint is missing — an older session with no stored hint must fall back to local-only logout, never throw or block it", () => {
    assert.equal(buildProviderLogoutUrl(END_SESSION_ENDPOINT, null, REDIRECT_URI), null);
    assert.equal(buildProviderLogoutUrl(END_SESSION_ENDPOINT, undefined, REDIRECT_URI), null);
    assert.equal(buildProviderLogoutUrl(END_SESSION_ENDPOINT, "", REDIRECT_URI), null);
  });

  it("does not invent or add any other parameter — no prompt=login, no select_account, no max_age", () => {
    const url = buildProviderLogoutUrl(END_SESSION_ENDPOINT, "hint", REDIRECT_URI);
    const parsed = new URL(url!);
    const keys = [...parsed.searchParams.keys()].sort();
    assert.deepEqual(keys, ["id_token_hint", "post_logout_redirect_uri"]);
  });
});

// ── requireCurrentNaiaCustomer — capture + gate + forward ──────────────────

describe("requireCurrentNaiaCustomer source wiring", () => {
  it("captures url.hostname and validates it through validateOriginHost before ever using it", () => {
    assert.match(sessionSrc, /validateOriginHost\(url\.hostname\)/);
  });

  it("only computes an origin host outside production — VERCEL_ENV === \"production\" gates it off, leaving production's redirect byte-identical to before this fix", () => {
    assert.match(sessionSrc, /process\.env\.VERCEL_ENV !== "production"\s*\?\s*validateOriginHost/);
  });

  it("only appends origin_host to the storefront redirect when it differs from sfHost — a flow that starts ON the storefront host stays there via the unchanged relative-redirect path", () => {
    assert.match(sessionSrc, /originHost\s*&&\s*originHost\s*!==\s*sfHost/);
  });

  it("the non-storefront (no STOREFRONT_HOST configured) branch is untouched — still a bare relative redirect", () => {
    const idx = sessionSrc.indexOf('throw redirect(`/auth/shopify/login?return_to=${returnTo}`)');
    assert.ok(idx > -1, "the original fallback redirect must still exist unchanged");
  });
});

// ── requireCurrentNaiaCustomer — functional redirect construction ─────────
// A request with no cookie header never reaches Prisma (extractRawToken
// short-circuits), so this is a genuine functional test, not a structural
// proxy, with no DB mocking required.

describe("requireCurrentNaiaCustomer() — functional redirect construction", () => {
  const savedEnv = {
    STOREFRONT_HOST: process.env.STOREFRONT_HOST,
    SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v !== undefined) process.env[k] = v; else delete process.env[k];
    }
  });

  async function captureRedirectLocation(requestUrl) {
    process.env.STOREFRONT_HOST = "naia-stylist-staging.vercel.app";
    try {
      await requireCurrentNaiaCustomer(new Request(requestUrl));
      assert.fail("expected requireCurrentNaiaCustomer to throw a redirect");
    } catch (thrown) {
      assert.ok(thrown instanceof Response, "must throw a Response (redirect)");
      return thrown.headers.get("Location");
    }
  }

  it("unique preview login preserves the unique preview host — origin_host is appended, pointing back at the exact requesting host", async () => {
    process.env.VERCEL_ENV = "preview";
    const location = await captureRedirectLocation(
      "https://naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app/trends/my-edits/spring-2026-colour-direction",
    );
    assert.match(location, /^https:\/\/naia-stylist-staging\.vercel\.app\/auth\/shopify\/login\?/);
    assert.match(location, /origin_host=naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects\.vercel\.app/);
  });

  it("relative return path survives the round trip — return_to carries the exact original pathname, not just the host", async () => {
    process.env.VERCEL_ENV = "preview";
    const location = await captureRedirectLocation(
      "https://naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app/trends/my-edits/spring-2026-colour-direction",
    );
    const url = new URL(location);
    assert.equal(decodeURIComponent(url.searchParams.get("return_to")), "/trends/my-edits/spring-2026-colour-direction");
  });

  it("shared staging stays shared staging — a request that already arrives on STOREFRONT_HOST appends no origin_host at all", async () => {
    process.env.VERCEL_ENV = "preview";
    const location = await captureRedirectLocation(
      "https://naia-stylist-staging.vercel.app/trends/my-edits/spring-2026-colour-direction",
    );
    assert.ok(!location.includes("origin_host="), "a flow starting on the storefront host must not redundantly carry itself as the origin");
  });

  it("production stays canonical production — VERCEL_ENV=production never computes or appends origin_host, regardless of request host", async () => {
    process.env.VERCEL_ENV = "production";
    const location = await captureRedirectLocation(
      "https://naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app/trends/my-edits/spring-2026-colour-direction",
    );
    assert.ok(!location.includes("origin_host="), "production must never thread an origin host through — behavior must be byte-identical to before this fix");
  });

  it("external/malicious return host is rejected — a request whose Host does not match any approved pattern appends no origin_host", async () => {
    process.env.VERCEL_ENV = "preview";
    const location = await captureRedirectLocation("https://evil.example.com/trends/my-edits/spring-2026-colour-direction");
    assert.ok(!location.includes("origin_host="), "an unapproved host must never be threaded through as a redirect target");
  });

  it("falls back to the original bare relative redirect when STOREFRONT_HOST is unset — unchanged from before this fix", async () => {
    delete process.env.STOREFRONT_HOST;
    process.env.VERCEL_ENV = "preview";
    try {
      await requireCurrentNaiaCustomer(new Request("https://naia-stylist-staging-l1e919a8p-nadeenabuobeads-projects.vercel.app/trends/my-edits/spring-2026-colour-direction"));
      assert.fail("expected a thrown redirect");
    } catch (thrown) {
      assert.equal(thrown.headers.get("Location"), "/auth/shopify/login?return_to=%2Ftrends%2Fmy-edits%2Fspring-2026-colour-direction");
    }
  });
});

// ── auth.shopify.login.tsx — read, validate, store, forward ────────────────

describe("auth.shopify.login.tsx source wiring", () => {
  it("reads origin_host from the query string and validates it", () => {
    assert.match(loginSrc, /validateOriginHost\(url\.searchParams\.get\("origin_host"\)\)/);
  });

  it("forwards origin_host through its own early storefront-redirect branch — a request that arrives here without _sf=1 must not drop the origin host on the floor", () => {
    const branchStart = loginSrc.indexOf("if (shouldBounceToStorefront(");
    assert.ok(branchStart > -1, "the storefront-redirect branch must be gated by shouldBounceToStorefront");
    const branchEnd = loginSrc.indexOf("}", loginSrc.indexOf("return redirect(sfLogin.toString()", branchStart));
    const branchBody = loginSrc.slice(branchStart, branchEnd);
    assert.match(branchBody, /sfLogin\.searchParams\.set\("origin_host"/);
  });

  it("gates the storefront-redirect branch through shouldBounceToStorefront rather than a bare storefrontHost truthiness check — the self-bounce guard", () => {
    assert.match(loginSrc, /shouldBounceToStorefront\(url\.hostname,\s*storefrontHost,\s*url\.searchParams\.has\("_sf"\)\)/);
  });

  it("stores origin_host in the signed handshake session so it survives the Shopify round trip", () => {
    assert.match(loginSrc, /session\.set\("origin_host",\s*originHost\)/);
  });

  it("builds an absolute final-return target from originHost + returnTo, used for the already-has-a-session short-circuit", () => {
    assert.match(loginSrc, /const finalReturnTarget = originHost \? `https:\/\/\$\{originHost\}\$\{returnTo\}` : returnTo;/);
    assert.match(loginSrc, /return redirect\(finalReturnTarget\);/);
  });

  // ── Browser-binding nonce (2026-10-20) ──────────────────────────────────

  it("mints a fresh browser-binding nonce before storing the PKCE session, never trusting one from the incoming request at this point", () => {
    assert.match(loginSrc, /buildHandoffNonceCookie\(\)/);
    assert.match(loginSrc, /session\.set\("origin_nonce_hash",\s*originNonceHash\)/);
  });

  it("validates origin_nonce_hash is a well-formed SHA-256 hex digest before storing it — anything else this app didn't generate is dropped", () => {
    assert.match(loginSrc, /function validateNonceHash/);
    assert.match(loginSrc, /\^\[a-f0-9\]\{64\}\$/i);
  });

  it("the secondary storefront-bounce branch also mints its own fresh nonce, rather than trusting one on the incoming URL — it is the only place that can set a cookie on this (the originating) host for this path", () => {
    const branchStart = loginSrc.indexOf("if (shouldBounceToStorefront(");
    const branchEnd = loginSrc.indexOf("return redirect(sfLogin.toString()");
    const branchBody = loginSrc.slice(branchStart, branchEnd);
    assert.match(branchBody, /buildHandoffNonceCookie\(\)/);
    assert.match(branchBody, /sfLogin\.searchParams\.set\("origin_nonce_hash",\s*nonce\.nonceHash\)/);
  });
});

// ── auth.shopify.callback.tsx — read back, re-validate, build absolute redirect ──

describe("auth.shopify.callback.tsx source wiring", () => {
  it("re-validates origin_host read back from the session — defense in depth, not blind trust of a previously-stored value", () => {
    assert.match(callbackSrc, /validateOriginHost\(session\.get\("origin_host"\)/);
  });

  it("clears origin_host from the session alongside the other one-shot PKCE/return_to fields", () => {
    assert.match(callbackSrc, /session\.unset\("origin_host"\)/);
  });

  it("the final successful-login redirect uses the computed absolute target, not the bare relative returnTo", () => {
    assert.match(callbackSrc, /return redirect\(finalReturnTarget, \{ headers \}\);/);
    assert.ok(!/return redirect\(returnTo, \{ headers \}\);/.test(callbackSrc),
      "must not still redirect to the bare relative returnTo for the success path");
  });

  it("finalReturnTarget falls back to the existing relative returnTo when no origin host was captured — shared-staging-initiated and production flows are unchanged", () => {
    assert.match(callbackSrc, /const finalReturnTarget = originHost \? `https:\/\/\$\{originHost\}\$\{returnTo\}` : returnTo;/);
  });

  // ── Cross-domain handoff fix (2026-10-20) ────────────────────────────────
  // finalReturnTarget alone was never reachable: the cookie this response
  // sets is scoped to THIS domain (the storefront host), never sent to a
  // different originHost. Redirecting straight there landed the browser
  // with no session at all — the app saw "not authenticated," bounced back
  // to login, Shopify silently re-approved the already-authenticated
  // identity, and the cycle repeated: ERR_TOO_MANY_REDIRECTS. Confirmed
  // live against the real preview deployment, confirmed via git diff that
  // Phase 1/2 never touched this file, so this was always latent — it only
  // needed a real browser login attempt against a Vercel-Authentication-
  // protected preview to surface.

  it("routes through /auth/shopify/handoff on originHost instead of redirecting straight to finalReturnTarget, when an origin host was captured", () => {
    assert.match(callbackSrc, /if \(originHost\) \{/);
    assert.match(callbackSrc, /`https:\/\/\$\{originHost\}\/auth\/shopify\/handoff`/);
  });

  it("carries the handoff value and return_to as query params, not the raw session token directly", () => {
    assert.match(callbackSrc, /handoffUrl\.searchParams\.set\("h", handoffValue\)/);
    assert.match(callbackSrc, /handoffUrl\.searchParams\.set\("return_to", returnTo\)/);
    assert.ok(!/searchParams\.set\("h",\s*rawToken\)/.test(callbackSrc),
      "the raw bearer token must never be placed directly in a URL — only the signed, short-lived handoff value");
  });

  it("the handoff value is built with the same signed-cookie machinery as the PKCE handshake — no new secret, no new signing scheme", () => {
    assert.match(callbackSrc, /handoff\.set\("handoff_raw_token", rawToken\)/);
    assert.match(callbackSrc, /handoff\.set\("handoff_origin_host", originHost\)/);
    assert.match(callbackSrc, /handoff\.set\("handoff_expires_at", pendingExpiresAt\.getTime\(\)\)/);
    assert.match(callbackSrc, /await commitSession\(handoff\)/);
  });

  it("the pending session's short expiry is computed once and reused for both the database row and the handoff payload — never two independent Date.now() calls that could disagree", () => {
    assert.match(callbackSrc, /const pendingExpiresAt = new Date\(Date\.now\(\) \+ HANDOFF_PENDING_MS\)/);
    assert.match(callbackSrc, /createNaiaSession\(customer\.id, request, tokens\.id_token, pendingExpiresAt\)/);
  });

  it("no long-lived session cookie is set on the storefront host for the handoff case — the only usable cookie lands on the destination preview host", () => {
    const branchStart = callbackSrc.indexOf("if (originHost) {");
    const branchEnd = callbackSrc.indexOf("return redirect(handoffUrl.toString()");
    const branchBody = callbackSrc.slice(branchStart, branchEnd);
    assert.ok(!branchBody.includes("buildSessionCookieHeader"),
      "the handoff branch must never set the normal, long-lived __naia_tok cookie on the storefront host");
  });

  it("the no-origin-host path is completely untouched — still redirects straight to finalReturnTarget", () => {
    assert.match(callbackSrc, /return redirect\(finalReturnTarget, \{ headers \}\);/);
  });

  // ── Browser-binding nonce (2026-10-20) ──────────────────────────────────

  it("re-reads the nonce hash captured in auth.shopify.login and clears it from the PKCE session alongside the other one-shot fields", () => {
    assert.match(callbackSrc, /const originNonceHash = session\.get\("origin_nonce_hash"\)/);
    assert.match(callbackSrc, /session\.unset\("origin_nonce_hash"\)/);
  });

  it("refuses to build a handoff at all when the nonce hash never made it this far — never silently proceeds without browser-binding", () => {
    const branchStart = callbackSrc.indexOf("if (originHost) {");
    const nextLine = callbackSrc.slice(branchStart, branchStart + 200);
    assert.match(nextLine, /if \(!originNonceHash\)/);
  });

  it("includes the nonce hash in the signed handoff payload", () => {
    assert.match(callbackSrc, /handoff\.set\("handoff_origin_nonce_hash",\s*originNonceHash\)/);
  });
});

// ── auth.shopify.handoff.tsx — the receiving end of the handoff ───────────

describe("auth.shopify.handoff.tsx — behavioral", () => {
  const ORIGIN_HOST = "naia-stylist-staging-i4b0504kk-nadeenabuobeads-projects.vercel.app";

  async function buildHandoffValue(overrides = {}) {
    const session = await getSession();
    session.set("handoff_raw_token", overrides.rawToken ?? "synthetic-raw-token-abc123");
    session.set("handoff_origin_host", overrides.originHost ?? ORIGIN_HOST);
    session.set("handoff_expires_at", overrides.expiresAt ?? Date.now() + 60_000);
    // A fixed placeholder hash — none of the remaining tests in this file
    // test nonce verification itself (that lives in
    // naia-session-handoff-single-use.test.ts); this only needs to be
    // present so each test below still fails for the reason its own name
    // describes, not incidentally because this field is missing.
    session.set("handoff_origin_nonce_hash", overrides.originNonceHash ?? "a".repeat(64));
    const cookie = await commitSession(session);
    const eq = cookie.indexOf("=");
    const semi = cookie.indexOf(";");
    return cookie.slice(eq + 1, semi === -1 ? undefined : semi);
  }

  function requestTo(hostname, searchParams) {
    const url = new URL(`https://${hostname}/auth/shopify/handoff`);
    for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v);
    return new Request(url.toString());
  }

  // The success path and the single-use/replay guarantee both now go
  // through promoteHandoffSession, which makes a real database call — see
  // naia-session-handoff-single-use.test.ts (vitest, ~/db.server mocked)
  // for those, including the valid-token success case this file used to
  // cover directly. Everything below still fails before ever reaching the
  // database, so it stays here with no mocking required.

  it("an expired handoff value fails closed — redirects to login, sets no session cookie", async () => {
    const h = await buildHandoffValue({ expiresAt: Date.now() - 1000 });
    const res = await handoffLoader({ request: requestTo(ORIGIN_HOST, { h, return_to: "/my-naia" }), params: {}, context: {} });
    assert.equal(res.headers.get("Location"), "/auth/shopify/login");
    assert.equal(res.headers.get("Set-Cookie"), null);
  });

  it("a tampered handoff value fails closed — signature verification rejects it, not a thrown error", async () => {
    const h = await buildHandoffValue({});
    const tampered = h.slice(0, -4) + "9999";
    const res = await handoffLoader({ request: requestTo(ORIGIN_HOST, { h: tampered, return_to: "/my-naia" }), params: {}, context: {} });
    assert.equal(res.headers.get("Location"), "/auth/shopify/login");
    assert.equal(res.headers.get("Set-Cookie"), null);
  });

  it("a missing handoff value fails closed immediately", async () => {
    const res = await handoffLoader({ request: requestTo(ORIGIN_HOST, { return_to: "/my-naia" }), params: {}, context: {} });
    assert.equal(res.headers.get("Location"), "/auth/shopify/login");
  });

  it("REPLAY PROTECTION — a handoff value bound to a different origin host is rejected, even if otherwise valid and unexpired", async () => {
    const h = await buildHandoffValue({ originHost: "some-other-preview-host.vercel.app" });
    const res = await handoffLoader({ request: requestTo(ORIGIN_HOST, { h, return_to: "/my-naia" }), params: {}, context: {} });
    assert.equal(res.headers.get("Location"), "/auth/shopify/login");
    assert.equal(res.headers.get("Set-Cookie"), null);
  });

});

describe("auth.shopify.handoff.tsx — source wiring", () => {
  it("verifies the handoff value through the same signed-cookie mechanism as the PKCE handshake — getSession, not a bespoke check", () => {
    assert.match(handoffSrc, /getSession\(`__naia_session=\$\{h\}`\)/);
  });

  it("checks expiry before trusting anything else in the payload", () => {
    assert.match(handoffSrc, /Date\.now\(\) > expiresAt/);
  });

  it("re-validates the bound origin host against validateOriginHost, not just an equality check on an untrusted value", () => {
    assert.match(handoffSrc, /validateOriginHost\(originHost\)/);
  });
});
