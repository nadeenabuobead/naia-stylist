// app/routes/auth.signed-out.test.ts
//
// Root cause this route closes: auth.logout used to redirect straight into
// /auth/shopify/login. With no nAia session left (just destroyed) that route
// immediately starts a fresh Shopify OAuth authorization — and if the
// browser still carries an active Shopify customer session (the normal case
// right after Sign Out), Shopify silently re-authenticates the same account
// with no Sign In click at all. The customer appeared logged straight back
// in within seconds of signing out.
//
// /auth/signed-out is the fix: a deliberately inert landing page between
// Sign Out and any OAuth. It must never auto-navigate on its own — only an
// explicit Sign In click may start the Shopify flow.
//
// Source-string assertions, no DOM/router rendering needed — same
// convention as MyNaiaLayout.test.ts and the other route-source test files
// in this app.
//
// Run: node --test --import tsx/esm app/routes/auth.signed-out.test.ts

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "auth.signed-out.tsx"), "utf-8");
// Strip // line comments before checking for real code patterns — this
// file's own top-of-file doc comment discusses useEffect/<Link> by name
// (explaining what the fix deliberately avoids), which would otherwise
// false-positive a bare substring/regex check against the raw source.
const CODE_ONLY = SRC.replace(/\/\/.*$/gm, "");
const ROUTES_SRC = readFileSync(resolve(__dirname, "../routes.ts"), "utf-8");
const LOGOUT_SRC = readFileSync(resolve(__dirname, "auth.logout.tsx"), "utf-8");

describe("/auth/signed-out — registration", () => {
  it("is explicitly registered in routes.ts at /auth/signed-out, ahead of the auth/* catch-all", () => {
    const signedOutIdx = ROUTES_SRC.indexOf('route("auth/signed-out"');
    const catchAllIdx  = ROUTES_SRC.indexOf('route("auth/*"');
    assert.ok(signedOutIdx > -1, "auth/signed-out must be explicitly registered — this app uses an explicit route registry, not file-based discovery");
    assert.ok(catchAllIdx > -1, "the auth/* catch-all (Shopify admin auth) must still exist");
    assert.ok(signedOutIdx < catchAllIdx, "auth/signed-out must be registered before the auth/* catch-all so it is never shadowed by it");
    assert.match(ROUTES_SRC, /route\("auth\/signed-out",\s*"routes\/auth\.signed-out\.tsx"\)/);
  });
});

describe("/auth/signed-out — never auto-navigates", () => {
  it("has no loader at all — nothing runs server-side that could redirect on its own", () => {
    assert.ok(!/export\s+(async\s+)?function\s+loader/.test(SRC), "no loader export");
  });

  it("has no useEffect, no window.location mutation, and no meta refresh — nothing client-side navigates away automatically either", () => {
    assert.ok(!/\buseEffect\s*\(/.test(CODE_ONLY), "no useEffect call");
    assert.ok(!/window\.location\.(href|replace|assign)/.test(CODE_ONLY), "no programmatic navigation");
    assert.ok(!/http-equiv=["']refresh["']/i.test(CODE_ONLY), "no meta refresh");
  });

  it("renders a stable default component, not a raw terminal Response like auth.shopify.login's own no-session branch", () => {
    assert.match(SRC, /export\s+default\s+function\s+SignedOut/);
    assert.ok(!SRC.includes("new Response("), "does not return a raw Response — a normal React component renders here");
  });
});

describe("/auth/signed-out — shows signed-out state and a Sign In control", () => {
  it("clearly states the customer is signed out", () => {
    assert.match(SRC, /signed out/i);
  });

  it("renders a Sign In control", () => {
    assert.match(SRC, />\s*Sign In\s*</);
  });

  it("Sign In is a plain <a href>, not a React Router <Link> — must always be a full browser navigation, never a client-side transition", () => {
    // A <Link> to /auth/shopify/login (no existing session, by construction —
    // the customer just signed out) would hit the exact same terminal-HTML-
    // via-client-transition blank page this whole fix chain started from.
    assert.ok(!/<Link\b/.test(CODE_ONLY), "must not use react-router's <Link> for the Sign In control");
    assert.ok(!/import\s*{[^}]*\bLink\b[^}]*}\s*from\s*"react-router"/.test(CODE_ONLY),
      "does not even import Link from react-router");
    assert.match(SRC, /<a\s+href="\/auth\/shopify\/login\?return_to=%2Fmy-naia"/);
  });

  it("Sign In points to /auth/shopify/login?return_to=/my-naia — the only place OAuth is allowed to start from", () => {
    const hrefMatch = SRC.match(/href="([^"]*\/auth\/shopify\/login[^"]*)"/);
    assert.ok(hrefMatch, "Sign In href present");
    const url = new URL(hrefMatch[1], "https://naia-stylist-staging.vercel.app");
    assert.equal(url.pathname, "/auth/shopify/login");
    assert.equal(url.searchParams.get("return_to"), "/my-naia");
  });
});

describe("auth.logout — redirects into the signed-out landing, not straight into OAuth", () => {
  const actionBody = LOGOUT_SRC.slice(LOGOUT_SRC.indexOf("export async function action"), LOGOUT_SRC.indexOf("export async function loader"));

  it("the action's redirect target is /auth/signed-out, never /auth/shopify/login", () => {
    assert.match(actionBody, /return redirect\("\/auth\/signed-out"/);
    assert.ok(!actionBody.includes('redirect("/auth/shopify/login"'),
      "the action branch must not redirect into /auth/shopify/login directly — only the unrelated GET loader (direct navigation to /auth/logout) may still reference it");
  });

  it("still clears the session cookie on the same response as the signed-out redirect", () => {
    const actionBody = LOGOUT_SRC.slice(LOGOUT_SRC.indexOf("export async function action"), LOGOUT_SRC.indexOf("export async function loader"));
    assert.match(actionBody, /redirect\("\/auth\/signed-out",\s*\{\s*headers:\s*\{\s*"Set-Cookie":\s*buildClearSessionCookieHeader\(\)/s);
  });

  it("still destroys the nAia session before redirecting", () => {
    const actionBody = LOGOUT_SRC.slice(LOGOUT_SRC.indexOf("export async function action"), LOGOUT_SRC.indexOf("export async function loader"));
    assert.match(actionBody, /await deleteNaiaSession\(request\)/);
  });
});
