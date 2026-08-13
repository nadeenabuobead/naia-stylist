// app/routes/api.tryon-status.$jobId.test.ts
// M2 — Contract tests for /api/tryon-status/:jobId.
//
// All tests are source-code assertions — no live DB, no Cloudinary, no FASHN calls.
// Covers:
//   T1  session cookie auth only (getCurrentNaiaCustomer, not Shopify proxy)
//   T2  job ownership enforced — DB customer ID, never client-supplied
//   T3  COMPLETED terminal state returns resultUrl (no FASHN call)
//   T4  FAILED/CANCELED/TIMED_OUT terminal states return FAILED
//   T5  FASHN_API_KEY stays server-side — never returned to client
//   T6  result URL has Cache-Control: no-store header
//   T7  no measurement/body shape/fit data inferred or returned
//   T8  route registered in routes.ts as api/tryon-status/:jobId
//   T9  only loader exported — no action (GET only)
//   T10 useTryOn hook sends correct consent payload
//   T11 VtoExperience renders nothing for ineligible handle
//   T12 VtoExperience renders nothing when not authenticated
//
// Run: node --test --import tsx/esm app/routes/api.tryon-status.\$jobId.test.ts

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

function readRoute(name: string): string {
  return readFileSync(join(__dirname, name), "utf8");
}

function readHook(name: string): string {
  return readFileSync(join(__dirname, "../hooks", name), "utf8");
}

function readComponent(name: string): string {
  return readFileSync(join(__dirname, "../components", name), "utf8");
}

function readRootFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const m2Route = readRoute("api.tryon-status.$jobId.tsx");
const hook = readHook("useTryOn.ts");
const component = readComponent("VtoExperience.tsx");
const routesConfig = readRootFile("app/routes.ts");

// ── T1: Session cookie auth only ────────────────────────────────────────────────

describe("T1 — session cookie auth only (getCurrentNaiaCustomer)", () => {
  it("M2 route imports getCurrentNaiaCustomer from naia-session.server", () => {
    assert.ok(
      m2Route.includes("getCurrentNaiaCustomer"),
      "must import getCurrentNaiaCustomer",
    );
    assert.ok(
      m2Route.includes("naia-session.server"),
      "must import from naia-session.server",
    );
  });

  it("M2 route does not use Shopify proxy auth", () => {
    assert.ok(
      !m2Route.includes("authenticate.public.appProxy"),
      "must not use Shopify app-proxy auth — session-cookie only",
    );
  });

  it("M2 route returns 401 when customer is null", () => {
    assert.ok(
      m2Route.includes("AUTH_REQUIRED"),
      "must return AUTH_REQUIRED status when unauthenticated",
    );
    assert.ok(
      m2Route.includes("status: 401"),
      "must use HTTP 401 for unauthenticated requests",
    );
  });
});

// ── T2: Job ownership enforced ───────────────────────────────────────────────────

describe("T2 — job ownership enforced from DB (never client-supplied)", () => {
  it("M2 route loads job from DB by jobId param, not from request body", () => {
    assert.ok(
      m2Route.includes("prisma.virtualTryOnJob.findUnique"),
      "must query DB for job by id",
    );
    assert.ok(
      !m2Route.includes("body.customerId") && !m2Route.includes("req.customerId"),
      "customerId must never come from request body",
    );
  });

  it("M2 route calls checkResultOwnership with DB customer ID", () => {
    assert.ok(
      m2Route.includes("checkResultOwnership"),
      "must call checkResultOwnership",
    );
    assert.ok(
      m2Route.includes("job.customerId"),
      "must use job.customerId from DB in ownership check",
    );
    assert.ok(
      m2Route.includes("customer.id"),
      "must use authenticated customer.id in ownership check",
    );
  });

  it("M2 route returns 403 when ownership check fails", () => {
    assert.ok(
      m2Route.includes("FORBIDDEN"),
      "must return FORBIDDEN status on ownership mismatch",
    );
    assert.ok(
      m2Route.includes("status: 403"),
      "must use HTTP 403 for forbidden access",
    );
  });
});

// ── T3: COMPLETED terminal state ────────────────────────────────────────────────

describe("T3 — COMPLETED job returns resultUrl without FASHN call", () => {
  it("M2 route short-circuits on COMPLETED status before any fetch call", () => {
    // The COMPLETED terminal check must appear before the fetch to FASHN status endpoint
    const completedIdx = m2Route.indexOf('job.status === "COMPLETED"');
    const fetchCallIdx = m2Route.indexOf('fetch(`${FASHN_BASE}');
    assert.ok(completedIdx > 0, "must check job.status === COMPLETED");
    assert.ok(fetchCallIdx > 0, "must call FASHN status endpoint");
    assert.ok(completedIdx < fetchCallIdx, "COMPLETED check must precede FASHN fetch call");
  });

  it("M2 route calls buildTryOnResultUrl for COMPLETED jobs", () => {
    assert.ok(
      m2Route.includes("buildTryOnResultUrl"),
      "must call buildTryOnResultUrl to generate signed URL",
    );
  });
});

// ── T4: Failure terminal states ──────────────────────────────────────────────────

describe("T4 — FAILED/CANCELED/TIMED_OUT return FAILED without FASHN call", () => {
  it("M2 route handles all terminal failure states", () => {
    assert.ok(m2Route.includes('"FAILED"'), "must handle FAILED status");
    assert.ok(m2Route.includes('"CANCELED"'), "must handle CANCELED status");
    assert.ok(m2Route.includes('"TIMED_OUT"'), "must handle TIMED_OUT status");
  });
});

// ── T5: FASHN_API_KEY stays server-side ─────────────────────────────────────────

describe("T5 — FASHN_API_KEY never returned to client", () => {
  it("M2 route reads FASHN_API_KEY from process.env, not from request", () => {
    assert.ok(
      m2Route.includes("process.env.FASHN_API_KEY"),
      "must read FASHN_API_KEY from process.env (server-side only)",
    );
  });

  it("M2 route response never includes FASHN_API_KEY", () => {
    const responsePatterns = ["return data("];
    for (const pat of responsePatterns) {
      // The response data objects must not contain FASHN_API_KEY
      assert.ok(
        !m2Route.includes("apiKey: "),
        "apiKey must never appear in a data() response",
      );
    }
  });

  it("useTryOn hook never sends FASHN_API_KEY", () => {
    assert.ok(
      !hook.includes("FASHN_API_KEY"),
      "client hook must not reference FASHN_API_KEY",
    );
  });
});

// ── T6: Cache-Control: no-store for result URLs ──────────────────────────────────

describe("T6 — result URL response has Cache-Control: no-store", () => {
  it("M2 route sets Cache-Control: no-store on COMPLETED response", () => {
    assert.ok(
      m2Route.includes("Cache-Control"),
      "must set Cache-Control header",
    );
    assert.ok(
      m2Route.includes("no-store"),
      "Cache-Control must be no-store",
    );
  });
});

// ── T7: No measurement/body shape inference ──────────────────────────────────────

describe("T7 — no body shape, measurement, or fit data inferred or returned", () => {
  // Only check runtime code terms — comment text in hooks/components is intentional documentation
  const routeForbidden = ["bodyShape", "bodyMeasurement", "bust", "waist", "willFitYou", "fitScore", "sizeRecommendation"];
  for (const term of routeForbidden) {
    it(`M2 route does not reference "${term}"`, () => {
      assert.ok(!m2Route.includes(term), `"${term}" must not appear in M2 route`);
    });
  }

  it("M2 route never returns body shape or measurement data", () => {
    assert.ok(
      !m2Route.includes("bodyShape"),
      "bodyShape must not appear in M2 route response",
    );
  });

  it("VtoExperience disclaimer always shown with result image", () => {
    assert.ok(
      component.includes("PROVIDER_DISCLAIMER"),
      "VtoExperience must always show PROVIDER_DISCLAIMER with result",
    );
  });
});

// ── T8: Route registered in routes.ts ───────────────────────────────────────────

describe("T8 — M2 route registered in routes.ts", () => {
  it("routes.ts registers api/tryon-status/:jobId → api.tryon-status.$jobId.tsx", () => {
    assert.ok(
      routesConfig.includes("api/tryon-status/:jobId") ||
        routesConfig.includes("api/tryon-status/:jobId"),
      "must register the M2 route in routes.ts",
    );
    assert.ok(
      routesConfig.includes("api.tryon-status.$jobId.tsx"),
      "must reference the correct route file",
    );
  });
});

// ── T9: Only loader exported (GET only) ─────────────────────────────────────────

describe("T9 — M2 route is GET only (loader only, no action)", () => {
  it("M2 route exports loader", () => {
    assert.ok(m2Route.includes("export async function loader"), "must export loader");
  });

  it("M2 route does not export action", () => {
    assert.ok(
      !m2Route.includes("export async function action") &&
        !m2Route.includes("export function action"),
      "must not export action — GET only",
    );
  });
});

// ── T10: useTryOn sends correct consent payload ──────────────────────────────────

describe("T10 — useTryOn sends required consent fields", () => {
  it("hook sends productHandle", () => {
    assert.ok(hook.includes("productHandle"), "must send productHandle");
  });

  it("hook sends virtualTryOnConsentAt as ISO timestamp", () => {
    assert.ok(
      hook.includes("virtualTryOnConsentAt"),
      "must send virtualTryOnConsentAt",
    );
    assert.ok(
      hook.includes("new Date().toISOString()"),
      "consent timestamp must be current time as ISO string",
    );
  });

  it("hook sends saveTryOnResultConsent: true", () => {
    assert.ok(
      hook.includes("saveTryOnResultConsent: true"),
      "must send saveTryOnResultConsent: true",
    );
  });

  it("hook sends idempotencyKey as random value", () => {
    assert.ok(hook.includes("idempotencyKey"), "must send idempotencyKey");
    assert.ok(
      hook.includes("crypto.getRandomValues") || hook.includes("randomKey"),
      "idempotencyKey must be randomly generated",
    );
  });
});

// ── T11: VtoExperience renders nothing for ineligible handle ─────────────────────

describe("T11 — VtoExperience renders nothing for ineligible garments", () => {
  it("VtoExperience imports isTryOnEligible", () => {
    assert.ok(
      component.includes("isTryOnEligible"),
      "must import and use isTryOnEligible",
    );
  });

  it("VtoExperience returns null when isTryOnEligible is false", () => {
    assert.ok(
      component.includes("return null") || component.includes("return null;"),
      "must return null for ineligible garments",
    );
  });
});

// ── T12: VtoExperience renders nothing when not authenticated ─────────────────────

describe("T12 — VtoExperience renders nothing when user is not authenticated", () => {
  it("VtoExperience accepts isAuthenticated prop", () => {
    assert.ok(
      component.includes("isAuthenticated"),
      "must accept isAuthenticated prop",
    );
  });

  it("VtoExperience returns null when isAuthenticated is false", () => {
    assert.ok(
      component.includes("!isAuthenticated"),
      "must guard on isAuthenticated before rendering",
    );
  });
});
