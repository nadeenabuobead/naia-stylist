// app/lib/react-router-7-18-csrf-origin-check.test.ts
//
// react-router 7.13.1 -> 7.18.5 upgrade (fixes GHSA-84g9-w2xq-vcv6 and 11
// other advisories). 7.18.0 tightened the CSRF check
// (throwIfPotentialCSRFAttack, lib/actions.ts) to compare the browser's
// `Origin` header against `new URL(request.url).origin` for every
// POST/PUT/PATCH/DELETE request, instead of only checking POST.
//
// REVISION: the first version of this test used
// @remix-run/node-fetch-server's createRequest to build the Request
// object. That is NOT the adapter this app's production build actually
// uses -- confirmed by inspecting the real compiled output
// (build/server/.../index.js): it exports no `fetch` property, so
// @react-router/serve's cli.js (dist/cli.js:131-140) takes the `else`
// branch and uses @react-router/express's createRequestHandler, not
// createRequestListener. This revision tests THAT real adapter instead
// -- via a real `express()` app, so req.protocol/req.hostname/
// req.app.enabled("trust proxy") are genuine Express-computed values,
// not guesses -- plus the exact origin-comparison line from the
// installed react-router source (quoted below with its file:line).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { describe, it } from "node:test";
// @ts-expect-error -- express ships no bundled types and @types/express is
// not installed; not adding a new dependency just for this test's typing.
import express from "express";
import config from "../../react-router.config.ts";

// react-router@7.18.5, node_modules/react-router/dist/development/index.js,
// lib/actions.ts::throwIfPotentialCSRFAttack, lines 847-872 (quoted
// verbatim in the PR -- reproduced here only because it's a private,
// unexported function). This is a straight URL/string comparison with no
// Express dependency, so replicating it is faithful to the real check:
//
//   let originMatchesRequest = originUrl
//     ? originUrl.origin === requestUrl.origin
//     : originDomain === requestUrl.host;
//   if (originDomain && !originMatchesRequest) {
//     if (!isAllowedOrigin(originDomain, allowedActionOrigins)) throw ...
//
// `.origin` (per the WHATWG URL spec) is scheme://host[:port] -- NOT
// host-only. The installed code compares the FULL origin, scheme
// included, when the Origin header parses as a URL (true for every real
// browser Origin header). This matches react-router's own public
// changelog wording ("comparing the full Origin with request.url's
// origin, scheme included") -- some third-party vulnerability-database
// summaries describe the underlying problem this fixed as a "hostname"
// check, but that describes the OLD, pre-7.15.1 buggy comparison (Origin
// host vs. Host header), not what 7.18.0 actually ships. The code below
// is the ground truth; both results are asserted here for clarity.
function matchesOriginCheck(originHeader: string | null, requestUrl: URL): { skipped: boolean; matchesFullOrigin: boolean; matchesHostOnly: boolean; allowed: boolean } {
  if (!originHeader || originHeader === "null") return { skipped: true, matchesFullOrigin: true, matchesHostOnly: true, allowed: true };
  const originUrl = new URL(originHeader);
  const matchesFullOrigin = originUrl.origin === requestUrl.origin;
  const matchesHostOnly = originUrl.host === requestUrl.host;
  const allowed = matchesFullOrigin || isAllowedOrigin(originUrl.host, config.allowedActionOrigins as string[]);
  return { skipped: false, matchesFullOrigin, matchesHostOnly, allowed };
}

// react-router@7.18.5, same file, isAllowedOrigin + matchWildcardDomain
// -- host-only (scheme-agnostic) allow-list matching, reproduced exactly.
function isAllowedOrigin(originDomain: string, allowedActionOrigins: string[] = []): boolean {
  return allowedActionOrigins.some((o) => o && (o === originDomain || matchWildcardDomain(originDomain, o)));
}
function matchWildcardDomain(domain: string, pattern: string): boolean {
  const d = domain.split("."), p = pattern.split(".");
  if (p.length < 1 || d.length < p.length) return false;
  while (p.length) {
    const pp = p.pop(), dp = d.pop();
    if (pp === "") return false;
    if (pp === "*") { if (!dp) return false; continue; }
    if (pp === "**") return p.length === 0 ? dp !== undefined : false;
    if (dp !== pp) return false;
  }
  return d.length === 0;
}

// Builds a real Express app using @react-router/express's exact
// request-URL construction (createRemixRequest,
// node_modules/@react-router/express/dist/index.js:72-93), reproduced
// here because it's not exported for direct import, but exercised
// through a REAL express() app so req.protocol/req.hostname/
// req.app.enabled("trust proxy") are genuine Express internals, not
// hand-rolled guesses.
function buildApp(trustProxy: boolean) {
  const app = express();
  if (trustProxy) app.set("trust proxy", true);
  app.all("*", (req: any, res: any) => {
    const [, hostnamePortStr] = req.app.enabled("trust proxy") ? (req.get("X-Forwarded-Host")?.split(":") ?? []) : [];
    const [, hostPortStr] = req.get("host")?.split(":") ?? [];
    const hostnamePort = Number.parseInt(hostnamePortStr!, 10);
    const hostPort = Number.parseInt(hostPortStr!, 10);
    const port = Number.isSafeInteger(hostnamePort) ? hostnamePort : Number.isSafeInteger(hostPort) ? hostPort : "";
    const hostname = req.hostname.split(/[\\/?#@]/)[0] || "localhost";
    const resolvedHost = `${hostname}${port ? `:${port}` : ""}`;
    const requestUrl = new URL(`${req.protocol}://${resolvedHost}${req.originalUrl}`);
    const result = matchesOriginCheck(req.get("origin") ?? null, requestUrl);
    res.json({ ...result, requestOrigin: requestUrl.origin });
  });
  return app;
}

function rawRequest(port: number, method: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port, path: "/action-route", method, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(JSON.parse(body)));
    });
    req.on("error", reject);
    req.end();
  });
}

async function withApp(trustProxy: boolean, fn: (port: number) => Promise<void>) {
  const server = createServer(buildApp(trustProxy));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(port);
  } finally {
    server.close();
  }
}

const REAL_DOMAIN = "naia-stylist-staging.vercel.app";

describe("react-router 7.18.5 CSRF origin check vs. @react-router/express (the adapter this app's build actually uses)", () => {
  it("HTTPS Origin vs. HTTP request URL, SAME host, trust proxy OFF (default -- no app.set('trust proxy', ...) exists in @react-router/serve's cli.js): full-origin check fails, host-only would have passed", async () => {
    await withApp(false, async (port) => {
      const result = await rawRequest(port, "POST", { Host: REAL_DOMAIN, Origin: `https://${REAL_DOMAIN}` });
      assert.equal(result.skipped, false);
      assert.equal(result.matchesHostOnly, true, "the host component alone matches");
      assert.equal(result.matchesFullOrigin, false, "but the scheme does not -- req.protocol reflects the raw (unencrypted) socket here, not the browser's real https");
      assert.equal(result.allowed, false, "and allowedActionOrigins today only lists the Shopify embedding origin, not this app's own domain -- so this request IS rejected by the real installed code");
    });
  });

  it("mismatched hosts (genuine cross-origin attack): correctly rejected, with or without trust proxy", async () => {
    await withApp(false, async (port) => {
      const result = await rawRequest(port, "POST", { Host: REAL_DOMAIN, Origin: "https://evil.example.com" });
      assert.equal(result.matchesFullOrigin, false);
      assert.equal(result.matchesHostOnly, false);
      assert.equal(result.allowed, false, "a genuinely different origin must never be let through");
    });
  });

  it("forwarded headers present but trust proxy OFF (default): forwarded headers are ignored, same mismatch as the first test", async () => {
    await withApp(false, async (port) => {
      const result = await rawRequest(port, "POST", {
        Host: REAL_DOMAIN,
        Origin: `https://${REAL_DOMAIN}`,
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": REAL_DOMAIN,
      });
      assert.equal(result.matchesFullOrigin, false, "Express ignores X-Forwarded-* entirely when trust proxy is not enabled -- confirmed, not assumed");
    });
  });

  it("forwarded headers present AND trust proxy ON: the check passes -- this is the correct fix, not a weakening", async () => {
    await withApp(true, async (port) => {
      const result = await rawRequest(port, "POST", {
        Host: "127.0.0.1", // what the raw socket actually sees behind a proxy
        Origin: `https://${REAL_DOMAIN}`,
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": REAL_DOMAIN,
      });
      assert.equal(result.matchesFullOrigin, true, "with trust proxy enabled, req.protocol/req.hostname read X-Forwarded-Proto/X-Forwarded-Host, matching the real browser Origin");
    });
  });

  it("control: HTTP Origin vs HTTP request URL, same host, trust proxy off -- no mismatch when nothing is proxied", async () => {
    await withApp(false, async (port) => {
      const result = await rawRequest(port, "POST", { Host: REAL_DOMAIN, Origin: `http://${REAL_DOMAIN}` });
      assert.equal(result.matchesFullOrigin, true);
    });
  });

  it("webhook-shaped request (POST, no Origin header at all) skips the check entirely", async () => {
    await withApp(false, async (port) => {
      const result = await rawRequest(port, "POST", { Host: REAL_DOMAIN });
      assert.equal(result.skipped, true, "no Origin header -> throwIfPotentialCSRFAttack never compares anything, confirmed by reading lib/actions.ts");
    });
  });

  it("today's allowedActionOrigins only covers the Shopify embedding origin, not this app's own domain(s)", () => {
    assert.deepEqual(config.allowedActionOrigins, ["naia-test-store.myshopify.com"]);
  });
});
