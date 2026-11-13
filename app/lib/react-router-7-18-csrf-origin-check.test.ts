// app/lib/react-router-7-18-csrf-origin-check.test.ts
//
// react-router 7.13.1 -> 7.18.5 upgrade (fixes GHSA-84g9-w2xq-vcv6 and 11
// other advisories). 7.18.0 tightened the CSRF check
// (throwIfPotentialCSRFAttack, lib/actions.ts) to compare the browser's
// `Origin` header against `new URL(request.url).origin` for every
// POST/PUT/PATCH/DELETE request, instead of only checking POST.
//
// The check is sound in isolation, but it depends entirely on how the
// server adapter constructs `request.url` -- specifically, whether the
// scheme (http/https) it reports matches what the browser's real Origin
// header says. This file empirically verifies that dependency using the
// REAL adapter code `@react-router/serve` actually uses
// (`@remix-run/node-fetch-server`'s `createRequest`), not a
// reimplementation -- so this test tracks the real behavior even if that
// adapter's internals change later. If `@remix-run/node-fetch-server`
// ever becomes unresolvable here, that itself is a signal this file needs
// updating to match whatever replaced it.
//
// Finding (see the PR/commit message for the full writeup): when TLS
// terminates at a reverse proxy in front of this app (Vercel's standard
// topology -- TLS at the edge, plain HTTP to the Node process) and that
// process is reached via `@react-router/serve` (i.e. `npm start` /
// `docker-start`, confirmed real, existing scripts), the constructed
// request URL's scheme is `http:` while the browser's real Origin is
// `https:` -- these origins do NOT match, and the request is only saved
// from a false-positive CSRF rejection if `allowedActionOrigins` (in
// react-router.config.ts) explicitly allow-lists the real hostname.
// Today's config only lists `naia-test-store.myshopify.com` (the Shopify
// embedding origin) -- it does NOT list this app's own domain(s).

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { describe, it } from "node:test";
import { createRequestListener } from "@remix-run/node-fetch-server";
import config from "../../react-router.config.ts";

// Mirrors react-router@7.18.5's lib/actions.ts::throwIfPotentialCSRFAttack
// origin/url comparison exactly (read directly from
// node_modules/react-router/dist/development/index.js at the time this
// was written) -- reproduced here (not imported, since it's a private,
// unexported function) purely to report pass/fail without needing to
// drive a full React Router app instance.
function originCheckResult(request: Request): { skipped: true } | { skipped: false; matches: boolean } {
  const originHeader = request.headers.get("origin");
  if (!originHeader || originHeader === "null") return { skipped: true };
  const originUrl = new URL(originHeader);
  const requestUrl = new URL(request.url);
  return { skipped: false, matches: originUrl.origin === requestUrl.origin };
}

function rawPost(port: number, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/action-route", method: "POST", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function withProbeServer(fn: (port: number) => Promise<void>) {
  const server = createServer(
    createRequestListener(async (request: Request) => new Response(JSON.stringify(originCheckResult(request)))),
  );
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await fn(port);
  } finally {
    server.close();
  }
}

const REAL_DOMAIN = "naia-stylist-staging.vercel.app";

describe("react-router 7.18.5 CSRF origin check vs. this app's reverse-proxy topology", () => {
  it("FINDING: a plain-HTTP socket (TLS terminated upstream) + a real https Origin header produces a scheme mismatch the origin check would reject", async () => {
    await withProbeServer(async (port) => {
      const body = await rawPost(port, { Host: REAL_DOMAIN, Origin: `https://${REAL_DOMAIN}` });
      const result = JSON.parse(body);
      assert.equal(result.skipped, false);
      assert.equal(
        result.matches,
        false,
        "this documents a real risk, not an expectation to preserve -- see react-router.config.ts's allowedActionOrigins recommendation",
      );
    });
  });

  it("control: when the socket's scheme and the Origin header already agree, the check passes", async () => {
    await withProbeServer(async (port) => {
      const body = await rawPost(port, { Host: REAL_DOMAIN, Origin: `http://${REAL_DOMAIN}` });
      const result = JSON.parse(body);
      assert.equal(result.matches, true);
    });
  });

  it("webhook-shaped request (POST, no Origin header at all) skips the check entirely", async () => {
    await withProbeServer(async (port) => {
      const body = await rawPost(port, { Host: REAL_DOMAIN });
      const result = JSON.parse(body);
      assert.equal(result.skipped, true, "no Origin header -> throwIfPotentialCSRFAttack never compares anything, confirmed by reading lib/actions.ts");
    });
  });

  it("today's allowedActionOrigins only covers the Shopify embedding origin, not this app's own domain(s) -- the scheme-mismatch risk above is NOT mitigated by current config", () => {
    assert.deepEqual(
      config.allowedActionOrigins,
      ["naia-test-store.myshopify.com"],
      "if this changes, re-check whether the app's own domain(s) have been added as a mitigation for the finding above",
    );
  });
});
