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
//   §B  api.bodyscan.jsx requires authentication and resolves customer
//       identity from the session only — Bodygram integration logic itself
//       is unchanged (under product review, not rebuilt, not removed)
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
const bodyscan = readRoute("api.bodyscan.jsx");
const bindingModule = readRootFile("app/lib/bodyscan-session-binding.server.ts");

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

// ── §B: api.bodyscan.jsx requires authentication ──────────────────────────────

describe("§B — api.bodyscan.jsx imports session auth", () => {
  it("B1 — imports getCurrentNaiaCustomer from naia-session.server", () => {
    assert.ok(bodyscan.includes("getCurrentNaiaCustomer"), "must import getCurrentNaiaCustomer");
    assert.ok(bodyscan.includes("naia-session.server"), "must import from naia-session.server");
  });
});

describe("§B — action() rejects unauthenticated requests before any Bodygram call", () => {
  it("B2 — auth check precedes the scan-tokens fetch", () => {
    const actionBody = bodyscan.slice(
      bodyscan.indexOf("export async function action"),
      bodyscan.indexOf("export async function loader"),
    );
    const authPos = actionBody.indexOf("getCurrentNaiaCustomer");
    const fetchPos = actionBody.indexOf("fetch(");
    assert.ok(authPos > -1 && fetchPos > -1, "both auth check and fetch call must be present");
    assert.ok(authPos < fetchPos, "auth check must precede the Bodygram fetch call");
  });

  it("B3 — returns 401 when customer is null", () => {
    const actionBody = bodyscan.slice(
      bodyscan.indexOf("export async function action"),
      bodyscan.indexOf("export async function loader"),
    );
    assert.ok(actionBody.includes("if (!customer) return authRequired();"));
    assert.ok(bodyscan.includes("status: 401"), "must return 401 on null customer");
  });
});

describe("§B — loader() rejects unauthenticated requests before any Bodygram call", () => {
  it("B4 — auth check precedes the scan-result fetch", () => {
    const loaderBody = bodyscan.slice(bodyscan.indexOf("export async function loader"));
    const authPos = loaderBody.indexOf("getCurrentNaiaCustomer");
    const fetchPos = loaderBody.indexOf("fetch(");
    assert.ok(authPos > -1 && fetchPos > -1, "both auth check and fetch call must be present");
    assert.ok(authPos < fetchPos, "auth check must precede the Bodygram fetch call");
  });

  it("B5 — returns 401 when customer is null", () => {
    const loaderBody = bodyscan.slice(bodyscan.indexOf("export async function loader"));
    assert.ok(loaderBody.includes("if (!customer) return authRequired();"));
  });
});

describe("§B — cross-customer write vector closed", () => {
  it("B6 — loader no longer reads customerId from the query string", () => {
    assert.ok(
      !bodyscan.includes('searchParams.get("customerId")'),
      "customerId must never be read from the request — it enabled writing to another customer's profile",
    );
  });

  it("B7 — OnboardingProfile lookup is keyed to the session customer only", () => {
    assert.ok(
      bodyscan.includes("where: { customerId: customer.id }"),
      "upsert where-clause must use the session-derived customer.id",
    );
  });

  it("B8 — OnboardingProfile create is keyed to the session customer only", () => {
    const createBlock = bodyscan.slice(bodyscan.indexOf("create: {"), bodyscan.indexOf("create: {") + 120);
    assert.ok(
      createBlock.includes("customerId: customer.id"),
      "create block must use the session-derived customer.id, not a request-supplied value",
    );
  });

  it("B9 — scan-token metadata is keyed to the session customer only", () => {
    assert.ok(
      bodyscan.includes("metadata: { naiaCustomerId: customer.id }"),
      "Bodygram scan-token metadata must use the session-derived customer.id",
    );
  });
});

describe("§B — scan sessionId is cryptographically bound to the customer it was issued for", () => {
  // Real behavioral tests (not string assertions) against the exported
  // signSessionOwnership/sessionOwnershipValid helpers — these are what
  // close the gap between "the DB write uses customer.id" (closes a write
  // vector) and "this sessionId actually belongs to this customer" (closes
  // a session-binding vector: customer A supplying customer B's sessionId).
  process.env.SESSION_SECRET ||= "phase1-test-only-secret-do-not-use-in-prod";

  it("B16 — action() response includes a sig alongside sessionId", () => {
    const actionBody = bodyscan.slice(
      bodyscan.indexOf("export async function action"),
      bodyscan.indexOf("export async function loader"),
    );
    assert.ok(actionBody.includes("sessionId: data.token, sig"), "action must return sig with sessionId");
    assert.ok(actionBody.includes("signSessionOwnership(data.token, customer.id)"));
  });

  it("B17 — loader() rejects a missing sig with 403 before calling Bodygram", async () => {
    const { sessionOwnershipValid } = await import("../lib/bodyscan-session-binding.server.ts");
    assert.equal(sessionOwnershipValid("sess-1", "cust-A", undefined), false);
    assert.equal(sessionOwnershipValid("sess-1", "cust-A", null), false);
    assert.equal(sessionOwnershipValid("sess-1", "cust-A", ""), false);
  });

  it("B18 — a valid signature for (sessionId, customer) verifies", async () => {
    const { signSessionOwnership, sessionOwnershipValid } = await import("../lib/bodyscan-session-binding.server.ts");
    const sig = signSessionOwnership("sess-1", "cust-A");
    assert.equal(sessionOwnershipValid("sess-1", "cust-A", sig), true);
  });

  it("B19 — customer B cannot use a sig issued for customer A's session (the actual exploit this closes)", async () => {
    const { signSessionOwnership, sessionOwnershipValid } = await import("../lib/bodyscan-session-binding.server.ts");
    // Customer A legitimately creates a scan and receives sig_A for sess-1.
    const sigForA = signSessionOwnership("sess-1", "cust-A");
    // Customer B authenticates as themselves and tries to poll A's sessionId,
    // presenting the sig A received (e.g. obtained from A's network tab).
    assert.equal(
      sessionOwnershipValid("sess-1", "cust-B", sigForA),
      false,
      "a sig computed for customer A must not validate when checked against customer B",
    );
  });

  it("B20 — a sig for one sessionId does not transfer to a different sessionId for the same customer", async () => {
    const { signSessionOwnership, sessionOwnershipValid } = await import("../lib/bodyscan-session-binding.server.ts");
    const sigForSessX = signSessionOwnership("sess-X", "cust-A");
    assert.equal(sessionOwnershipValid("sess-Y", "cust-A", sigForSessX), false);
  });

  it("B21 — a tampered signature (same length, different bytes) is rejected", async () => {
    const { signSessionOwnership, sessionOwnershipValid } = await import("../lib/bodyscan-session-binding.server.ts");
    const sig = signSessionOwnership("sess-1", "cust-A");
    const tampered = sig.slice(0, -1) + (sig.at(-1) === "A" ? "B" : "A");
    assert.equal(sessionOwnershipValid("sess-1", "cust-A", tampered), false);
  });

  it("B22 — loader checks ownership before the Bodygram scan-result fetch", () => {
    const loaderBody = bodyscan.slice(bodyscan.indexOf("export async function loader"));
    const sigCheckPos = loaderBody.indexOf("sessionOwnershipValid");
    const fetchPos = loaderBody.indexOf("fetch(");
    assert.ok(sigCheckPos > -1 && fetchPos > -1);
    assert.ok(sigCheckPos < fetchPos, "ownership check must precede the Bodygram scan-result fetch");
  });

  it("B23 — ownership check precedes the OnboardingProfile write", () => {
    const loaderBody = bodyscan.slice(bodyscan.indexOf("export async function loader"));
    const sigCheckPos = loaderBody.indexOf("sessionOwnershipValid");
    const upsertPos = loaderBody.indexOf("prisma.onboardingProfile.upsert");
    assert.ok(sigCheckPos < upsertPos, "ownership check must precede the DB write");
  });

  it("B24 — comparison uses timingSafeEqual, not a plain string/== compare (no timing oracle)", () => {
    assert.ok(bindingModule.includes("timingSafeEqual"));
    assert.ok(!bindingModule.includes("providedSig === expected"), "must not use a non-constant-time comparison");
  });

  it("B24b — the binding logic lives in a .server.ts module, not exported from the route", () => {
    // Confirmed by hitting it directly during this work: a named export from
    // a route file is bundled into the CLIENT build by React Router's
    // convention, which pulls Node's `crypto` into the browser bundle and
    // breaks the production build. .server.ts is this codebase's existing
    // convention for code that must never reach the client.
    assert.ok(
      bodyscan.includes('from "../lib/bodyscan-session-binding.server"'),
      "api.bodyscan.jsx must import the binding functions, not define/export them itself",
    );
    assert.ok(!bodyscan.includes("createHmac"), "route file itself must not import Node's crypto module directly");
  });

  it("B25 — fails closed when SESSION_SECRET is not configured", async () => {
    const { sessionOwnershipValid, signSessionOwnership } = await import("../lib/bodyscan-session-binding.server.ts");
    const saved = process.env.SESSION_SECRET;
    try {
      const sig = signSessionOwnership("sess-1", "cust-A"); // signed while secret present
      delete process.env.SESSION_SECRET;
      assert.equal(
        sessionOwnershipValid("sess-1", "cust-A", sig),
        false,
        "verification must fail closed (not throw, not pass) when the secret is missing",
      );
    } finally {
      if (saved !== undefined) process.env.SESSION_SECRET = saved;
    }
  });
});

describe("§B — Bodygram integration logic preserved (not rebuilt, not removed)", () => {
  it("B10 — scan-token creation call is unchanged", () => {
    assert.ok(bodyscan.includes("/scan-tokens"));
    assert.ok(bodyscan.includes("api.platform.bodygram.com/scans:create"));
  });

  it("B11 — scan-result polling and measurement mapping are unchanged", () => {
    assert.ok(bodyscan.includes("/scans/${sessionId}"));
    assert.ok(bodyscan.includes("BUST_GIRTH"));
    assert.ok(bodyscan.includes("WAIST_GIRTH"));
    assert.ok(bodyscan.includes("HIP_GIRTH"));
    assert.ok(bodyscan.includes("HEIGHT"));
  });

  it("B12 — OnboardingProfile upsert is unchanged in shape", () => {
    assert.ok(bodyscan.includes("prisma.onboardingProfile.upsert"));
    assert.ok(bodyscan.includes("scanConfidence: 0.95"));
  });

  it("B13 — route registration itself is untouched (file kept, not retired)", () => {
    assert.ok(
      routesConfig.includes(`route("api/body-scan", "routes/api.bodyscan.jsx")`),
      "api/body-scan must remain registered — Bodygram's future is a pending product decision, not resolved by deleting the route",
    );
  });
});

describe("§B — verbose measurement/scan logging trimmed", () => {
  it("B14 — no longer logs the full Bodygram response payload", () => {
    assert.ok(
      !bodyscan.includes('console.log("Bodygram response:", JSON.stringify(data))'),
      "must not log the full scan-token response (may include measurement-adjacent data)",
    );
    assert.ok(
      !bodyscan.includes('console.log("Bodygram scan result:", JSON.stringify(data))'),
      "must not log the full scan-result response (contains body measurements)",
    );
  });

  it("B15 — still logs enough to debug (presence/status only)", () => {
    assert.ok(bodyscan.includes("token present"));
    assert.ok(bodyscan.includes("status ="));
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

  it("C7 — the unreachable onboarding/body-scan.jsx page is untouched, still unregistered", () => {
    assert.ok(
      existsSync(join(ROOT, "app/routes/onboarding/body-scan.jsx")),
      "the Bodygram capture page is left in place pending the product decision",
    );
    assert.ok(
      !routesConfig.includes("onboarding/body-scan"),
      "it must remain unregistered — re-registering it is a feature decision, not part of this lockdown",
    );
  });
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
      const allowed = ["api.trigger-tryon.tsx", "api.tryon-status.$jobId.tsx", "api.staging-full-look-vto.tsx"];
      if (allowed.includes(entry.name)) continue;
      const src = readFileSync(join(routesDir, entry.name), "utf8");
      if (src.includes("api.fashn.ai")) offenders.push(entry.name);
    }
    assert.deepEqual(offenders, [], `unexpected direct FASHN calls outside the hardened routes: ${offenders.join(", ")}`);
  });

  it("D2 — api.quick-style.jsx's direct unauthenticated Anthropic call is gone", () => {
    assert.equal(existsSync(routePath("api.quick-style.jsx")), false);
  });

  it("D3 — Bodygram's paid scan-token call is gated behind auth (see B2)", () => {
    const actionBody = bodyscan.slice(
      bodyscan.indexOf("export async function action"),
      bodyscan.indexOf("export async function loader"),
    );
    assert.ok(actionBody.indexOf("getCurrentNaiaCustomer") < actionBody.indexOf("scan-tokens"));
  });
});
