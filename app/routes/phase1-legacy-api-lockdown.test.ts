// app/routes/phase1-legacy-api-lockdown.test.ts
// Phase 1 — Pre-launch audit remediation: lock down unauthenticated legacy
// API routes (2026-10-19 audit, Critical findings 1-3 and High finding "legacy
// unmoderated upload path").
//
// All tests are source-code assertions — no live DB, no Cloudinary, no FASHN,
// no Anthropic, no Bodygram calls. Mirrors the existing contract-test style
// used by api.trigger-tryon.test.ts and my-naia-model-moderation.test.ts.
//
// Covers:
//   §A  api.tryon.jsx / api.quick-style.jsx deleted and unregistered (no live
//       callers; secure replacements exist). api.closet.jsx is KEPT — an
//       existing regression test (batch1-integration.test.ts "b1-53") requires
//       it to stay live with real add/sync/delete logic, so it is patched in
//       place instead: client-supplied image data is no longer trusted.
//   §B  api.bodyscan.jsx (Bodygram), its session-binding helper, and the
//       unreachable onboarding/body-scan.jsx capture page are fully removed
//       (2026-11-18 Founder Decision: Bodygram permanently out of scope —
//       the earlier BODYGRAM_ENABLED=false kill-switch was the interim
//       safeguard, this is the final state)
//   §C  regression — secure replacement routes and unrelated features are
//       untouched
//   §D  abuse-prevention — no remaining unauthenticated path to a paid
//       provider, and no remaining unmoderated image-ingestion path
//
// Run: node --test --import tsx/esm app/routes/phase1-legacy-api-lockdown.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function routePath(name: string): string {
  return join(__dirname, name);
}

function readRoute(name: string): string {
  return readFileSync(routePath(name), "utf8");
}

function readRootFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const routesConfig = readRootFile("app/routes.ts");

// ── §A: retired routes are gone and unregistered ──────────────────────────────

describe("§A — api.tryon.jsx retired (no live caller; superseded by api/trigger-tryon)", () => {
  it("A1 — route file no longer exists", () => {
    assert.equal(existsSync(routePath("api.tryon.jsx")), false, "api.tryon.jsx must stay deleted");
  });

  it("A2 — route is not registered in app/routes.ts", () => {
    assert.ok(
      !routesConfig.includes(`"routes/api.tryon.jsx"`),
      "app/routes.ts must not reference api.tryon.jsx",
    );
    assert.ok(
      !routesConfig.includes(`route("api/tryon"`),
      "the api/tryon path must not be registered",
    );
  });
});

describe("§A — api.quick-style.jsx retired (no live caller; /quick-style has its own action)", () => {
  it("A3 — route file no longer exists", () => {
    assert.equal(existsSync(routePath("api.quick-style.jsx")), false, "api.quick-style.jsx must stay deleted");
  });

  it("A4 — route is not registered in app/routes.ts", () => {
    assert.ok(
      !routesConfig.includes(`"routes/api.quick-style.jsx"`),
      "app/routes.ts must not reference api.quick-style.jsx",
    );
    assert.ok(
      !routesConfig.includes(`route("api/quick-style"`),
      "the api/quick-style path must not be registered",
    );
  });

  it("A5 — the live /quick-style UI page is untouched", () => {
    assert.ok(
      routesConfig.includes(`route("quick-style", "routes/quick-style/_index.tsx")`),
      "the real quick-style page must remain registered",
    );
  });
});

describe("§A — api.style.jsx retired (2026-11-02 follow-up to commit 97a70f1)", () => {
  // 97a70f1 added a mandatory authenticate.admin() gate to api.style.jsx.
  // This follow-up goes further: the only real caller was the AI-stylist-
  // preview prototype on app._index.jsx (the embedded admin's home page),
  // which was itself a stale prototype superseded by the real nAia Admin
  // dashboard and the customer-facing /style-me flow. Retiring both closes
  // the unauthenticated-billable-Anthropic-call exposure at the root instead
  // of just gating it.

  it("A10 — route file no longer exists", () => {
    assert.equal(existsSync(routePath("api.style.jsx")), false, "api.style.jsx must stay deleted");
  });

  it("A11 — route is not registered in app/routes.ts", () => {
    assert.ok(
      !routesConfig.includes(`"routes/api.style.jsx"`),
      "app/routes.ts must not reference api.style.jsx",
    );
    assert.ok(
      !routesConfig.includes(`route("api/style"`),
      "the api/style path must not be registered",
    );
  });

  it("A12 — the gate test from the prior commit is gone too (it tested deleted code)", () => {
    assert.equal(
      existsSync(routePath("api.style.test.ts")),
      false,
      "api.style.test.ts tested the now-deleted route and should not remain as a stale fixture",
    );
  });
});

describe("§A — app/routes.ts has no filesystem-based auto-discovery that could silently resurrect a deleted route file", () => {
  // Retiring a route by deleting its file and registration entry is only
  // sufficient if nothing else scans app/routes/ by filename convention.
  // React Router's flatRoutes()/fs-routes would do exactly that — confirmed
  // absent here. If this ever changes, every retirement in this file (and
  // in §A above) needs re-auditing, since a resurrected file would need no
  // registration at all to become reachable again.
  it("A13 — routes.ts does not call flatRoutes() or import @react-router/fs-routes", () => {
    assert.ok(!routesConfig.includes("flatRoutes"), "no flatRoutes() usage expected in routes.ts");
    assert.ok(!routesConfig.includes("fs-routes"), "no @react-router/fs-routes import expected in routes.ts");
  });

  it("A14 — routes.ts exports a plain array of explicit route() entries only", () => {
    assert.match(routesConfig, /export default \[/, "routes.ts must export a literal array");
  });
});

describe("§A — app._index.jsx (embedded admin home page) prototype retired alongside api.style.jsx", () => {
  const appIndex = readRoute("app._index.jsx");

  it("A15 — no fetch call to the retired /api/style endpoint remains", () => {
    assert.ok(!appIndex.includes('fetch("/api/style"'), "app._index.jsx must not call the retired /api/style route");
    assert.ok(!appIndex.includes("callAI"), "the AI-stylist-preview callAI() handler must be removed");
  });

  it("A16 — the product-recommendation/scoring prototype logic is gone", () => {
    for (const marker of ["scoreProduct", "getFeelingKeywordMap", "getEventKeywordMap", "parseStylingResult", "GetNaiaProducts"]) {
      assert.ok(!appIndex.includes(marker), `prototype helper "${marker}" should be removed, not just unused`);
    }
  });

  it("A17 — the auth-bounce-suppression try/catch around authenticate.admin() is preserved", () => {
    // See closet-intelligence.test.ts §CI.35 — removing this, or letting a
    // thrown auth error propagate from this specific loader, reintroduces
    // a token-exchange redirect loop on the embedded app's first load.
    const loaderBody = appIndex.slice(
      appIndex.indexOf("export async function loader"),
      appIndex.indexOf("export default function"),
    );
    assert.ok(loaderBody.includes("authenticate.admin(request)"), "loader must still call authenticate.admin()");
    const tryPos = loaderBody.indexOf("try {");
    const catchPos = loaderBody.indexOf("} catch"); // "} catch" only matches real code, not the prose comment above it
    const authPos = loaderBody.indexOf("authenticate.admin(request)");
    assert.ok(
      tryPos > -1 && catchPos > -1 && tryPos < authPos && authPos < catchPos,
      "authenticate.admin(request) must still be wrapped in its own try/catch",
    );
  });

  it("A18 — the working nav link to the real nAia Admin dashboard still exists", () => {
    assert.ok(appIndex.includes("/app/naia-admin"), "home page must still link merchants to the real admin dashboard");
  });
});

describe("§A — api.closet.jsx kept live, patched in place (see b1-53 in batch1-integration.test.ts)", () => {
  const closetApi = readRoute("api.closet.jsx");

  it("A6 — route file and registration are both still present", () => {
    assert.ok(existsSync(routePath("api.closet.jsx")), "api.closet.jsx must not be deleted — see b1-53");
    assert.ok(
      routesConfig.includes(`route("api/closet", "routes/api.closet.jsx")`),
      "api/closet must remain registered",
    );
  });

  it("A7 — add/sync/delete logic required by existing regression tests is intact", () => {
    assert.ok(closetApi.includes('act === "add"'));
    assert.ok(closetApi.includes("normalizeCategory"));
    assert.ok(closetApi.includes("deleteClosetItemWithImage"));
  });

  it("A8 — the 'add' action no longer trusts a client-supplied image value", () => {
    const addBlock = closetApi.slice(closetApi.indexOf('if (act === "add")'), closetApi.indexOf('if (act === "sync")'));
    assert.ok(!addBlock.includes("image ?? null"), "add action must not persist a raw client-supplied image URL");
    assert.ok(addBlock.includes("imageUrl: null"), "add action must always write imageUrl: null");
  });

  it("A9 — the 'sync' action no longer trusts client-supplied image values", () => {
    const syncBlock = closetApi.slice(closetApi.indexOf('if (act === "sync")'), closetApi.indexOf('if (act === "delete")'));
    assert.ok(!syncBlock.includes("i.image"), "sync action must not read i.image at all");
    assert.ok(syncBlock.includes("imageUrl: null"), "sync action must always write imageUrl: null");
  });
});


// ── §B: Bodygram fully removed (2026-11-18 Founder Decision) ────────────────
//
// Supersedes the interim BODYGRAM_ENABLED=false kill-switch (86a66f8):
// permanent removal, not just a disabled gate. Same "retired route" pattern
// as §A above.

describe("§B — api.bodyscan.jsx (Bodygram route) retired", () => {
  it("B1 — route file no longer exists", () => {
    assert.equal(existsSync(routePath("api.bodyscan.jsx")), false, "api.bodyscan.jsx must stay deleted");
  });

  it("B2 — route is not registered in app/routes.ts", () => {
    assert.ok(
      !routesConfig.includes(`"routes/api.bodyscan.jsx"`),
      "app/routes.ts must not reference api.bodyscan.jsx",
    );
    assert.ok(
      !routesConfig.includes(`route("api/body-scan"`),
      "the api/body-scan path must not be registered",
    );
  });

  it("B3 — the route's own test file is gone too (it tested deleted code)", () => {
    assert.equal(
      existsSync(routePath("api.bodyscan.launch-exclusion.test.ts")),
      false,
      "api.bodyscan.launch-exclusion.test.ts tested the now-deleted route and should not remain as a stale fixture",
    );
  });
});

describe("§B — bodyscan-session-binding.server.ts (Bodygram sessionId-binding helper) retired", () => {
  it("B4 — module file no longer exists", () => {
    assert.equal(
      existsSync(join(ROOT, "app/lib/bodyscan-session-binding.server.ts")),
      false,
      "bodyscan-session-binding.server.ts must stay deleted — it had no caller other than the now-removed route",
    );
  });
});

describe("§B — onboarding/body-scan.jsx (unreachable Bodygram capture page) retired", () => {
  it("B5 — page file no longer exists", () => {
    assert.equal(
      existsSync(join(ROOT, "app/routes/onboarding/body-scan.jsx")),
      false,
      "onboarding/body-scan.jsx must stay deleted — it was already unregistered and unreachable before this removal",
    );
  });

  it("B6 — still not registered in app/routes.ts (it never was)", () => {
    assert.ok(!routesConfig.includes("onboarding/body-scan"), "onboarding/body-scan must not be registered");
  });
});

describe("§B — no remaining reference to the Bodygram provider anywhere live-reachable", () => {
  it("B7 — no route file calls platform.bodygram.com", () => {
    const routesDir = join(ROOT, "app/routes");
    const offenders: string[] = [];
    for (const entry of readdirSync(routesDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      if (entry.name.includes(".test.")) continue;
      const src = readFileSync(join(routesDir, entry.name), "utf8");
      if (src.includes("platform.bodygram.com")) offenders.push(entry.name);
    }
    assert.deepEqual(offenders, [], `unexpected remaining Bodygram call sites: ${offenders.join(", ")}`);
  });

  it("B8 — no lib module references Bodygram's live API surface", () => {
    const libDir = join(ROOT, "app/lib");
    const offenders: string[] = [];
    for (const entry of readdirSync(libDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      if (entry.name.includes(".test.")) continue;
      const src = readFileSync(join(libDir, entry.name), "utf8");
      if (src.includes("platform.bodygram.com") || src.includes("BODYGRAM_API_KEY") || src.includes("BODYGRAM_ORG_ID")) {
        offenders.push(entry.name);
      }
    }
    assert.deepEqual(offenders, [], `unexpected remaining Bodygram references: ${offenders.join(", ")}`);
  });
});

// ── §C: regression — secure replacements and unrelated features untouched ────

describe("§C — secure replacement routes are untouched", () => {
  it("C1 — api/trigger-tryon (hardened VTO) still registered and present", () => {
    assert.ok(routesConfig.includes(`route("api/trigger-tryon", "routes/api.trigger-tryon.tsx")`));
    assert.ok(existsSync(routePath("api.trigger-tryon.tsx")));
  });

  it("C2 — api/tryon-status/:jobId (hardened VTO polling) still registered and present", () => {
    assert.ok(routesConfig.includes(`"api/tryon-status/:jobId"`));
    assert.ok(existsSync(routePath("api.tryon-status.$jobId.tsx")));
  });

  it("C3 — closet (hardened upload/moderation flow) still registered and present", () => {
    assert.ok(routesConfig.includes(`route("closet", "routes/closet._index.tsx")`));
    assert.ok(existsSync(routePath("closet._index.tsx")));
  });

  it("C4 — api/closet-preview-analyze still registered and present", () => {
    assert.ok(routesConfig.includes(`route("api/closet-preview-analyze"`));
    assert.ok(existsSync(routePath("api.closet-preview-analyze.ts")));
  });

  it("C5 — settings.tsx photo-deletion controls untouched", () => {
    const settings = readRoute("settings.tsx");
    for (const intent of ["delete-model-all", "delete-vto-results", "delete-bos-images", "delete-all-closet-photos"]) {
      assert.ok(settings.includes(intent), `settings.tsx must still handle intent "${intent}"`);
    }
  });
});

describe("§C — unrelated dead UI code left in place (out of Phase 1 scope)", () => {
  it("C6 — TryOnButton.tsx (never rendered) is untouched, not deleted", () => {
    assert.ok(
      existsSync(join(ROOT, "app/components/TryOnButton.tsx")),
      "TryOnButton.tsx cleanup is a separate, lower-priority decision — not made here",
    );
  });

  // C7 (onboarding/body-scan.jsx) removed 2026-11-18 — the page itself is
  // now deleted, not just left unregistered. See §B5/§B6 above.
});

// ── §D: abuse-prevention — no unauthenticated path to a paid provider ─────────

describe("§D — no remaining unauthenticated fetch to a paid AI/scan provider", () => {
  it("D1 — no route file other than the hardened ones calls api.fashn.ai directly", () => {
    const routesDir = join(ROOT, "app/routes");
    const offenders: string[] = [];
    for (const entry of readdirSync(routesDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      if (entry.name.includes(".test.")) continue;
      const allowed = [
        "api.trigger-tryon.tsx",
        "api.tryon-status.$jobId.tsx",
        "api.staging-full-look-vto.tsx",
        // 2026-11-16 — checkFashnCredits() is a read-only GET /v1/credits
        // balance check (FASHN's own docs: never billable, submits nothing).
        // isAuthorized() in this same file fail-closes on four independent
        // checks before any FASHN call is reachable: VERCEL_ENV must be
        // preview/development (never production), NAIA_PROJECT_VARIANT must
        // be "staging", a dedicated secret header, and an exact allowlisted
        // QA customer ID.
        "api.vto-qa-fixture.tsx",
      ];
      if (allowed.includes(entry.name)) continue;
      const src = readFileSync(join(routesDir, entry.name), "utf8");
      // Strip full-line `//` comments before scanning: a route documenting,
      // in prose, that it does NOT call FASHN (e.g. staging.full-look-vto-
      // test.tsx's own header, which is entirely FASHN-mocked) must not trip
      // this check the same way a real `FASHN_BASE = "https://api.fashn.ai"`
      // constant in executable code would.
      const codeOnly = src
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      if (codeOnly.includes("api.fashn.ai")) offenders.push(entry.name);
    }
    assert.deepEqual(offenders, [], `unexpected direct FASHN calls outside the hardened routes: ${offenders.join(", ")}`);
  });

  it("D2 — api.quick-style.jsx's direct unauthenticated Anthropic call is gone", () => {
    assert.equal(existsSync(routePath("api.quick-style.jsx")), false);
  });

  it("D2b — api.style.jsx's direct unauthenticated Anthropic call is gone (2026-11-02)", () => {
    assert.equal(existsSync(routePath("api.style.jsx")), false);
  });

  // D3 (Bodygram auth-gating) removed 2026-11-18 — the route itself is gone,
  // not merely gated. See §B above.
});
