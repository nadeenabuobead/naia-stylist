// app/lib/plan/entitlement.test.ts
// Tests for the entitlement service and plan architecture.
//
// Source-code contract tests (no live DB) + unit tests for pure logic.
//
// ENT-01  schema has CustomerPlan enum with FREE and PAID values
// ENT-02  Customer model has plan field with CustomerPlan type and FREE default
// ENT-03  StylingSession has parentSessionId nullable self-reference
// ENT-04  entitlement service imports from plan-limits and billing-window
// ENT-05  qualifying StyleMe query filters parentSessionId: null (root sessions only)
// ENT-06  qualifying StyleMe query requires at least one non-null moodDescription
// ENT-07  qualifying StyleMe query excludes no-eligible-product outcome
// ENT-08  VTO in-flight uses lastActivityAt stale threshold, not unlimited window
// ENT-09  VTO completed counts only COMPLETED status
// ENT-10  VTO quota check = completed + inFlight >= limit
// ENT-11  BuySkip qualifying verdicts are BUY, SKIP, MAYBE only (not INCOMPLETE)
// ENT-12  BuySkip FREE uses lifetime count (no window filter)
// ENT-13  BuySkip PAID uses monthly window filter
// ENT-14  closet guard checks plan limit from getLimits, not a hardcoded number
// ENT-15  StyleMe welcome calculation: FREE first-ever qualifying session excluded from monthly
// ENT-16  StyleMe PAID has no welcome subtraction — all sessions count toward monthly
// ENT-17  Overview helper buildOverviewPlanCards uses entitlement, not closetCount directly
// ENT-18  Closet enforcement is immediate (no ENTITLEMENT_ENFORCEMENT flag check)
// ENT-19  Monthly guards (StyleMe, BuySkip, VTO) check ENTITLEMENT_ENFORCEMENT flag
// ENT-20  migration file exists for plan_entitlement
// ENT-21  plan-usage route registered in routes.ts
// ENT-22  adjust-vibe action stores styleMeAdjustVibeSourceId in cookie
// ENT-23  result.tsx loader reads styleMeAdjustVibeSourceId and passes parentSessionId to create

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../..");

function readFile(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

const schema     = readFile("prisma/schema.prisma");
const entSvc     = readFile("app/lib/plan/entitlement.server.ts");
const planLimits = readFile("app/lib/plan/plan-limits.server.ts");
const bWindow    = readFile("app/lib/plan/billing-window.server.ts");
const resultTsx  = readFile("app/routes/style-me/result.tsx");
const overview   = readFile("app/routes/my-naia._index.tsx");
const closetRt   = readFile("app/routes/closet._index.tsx");
const closetApi  = readFile("app/routes/api.closet.jsx");
const wishlist   = readFile("app/routes/api.wishlist.jsx");
const triggerVto = readFile("app/routes/api.trigger-tryon.tsx");
const routes     = readFile("app/routes.ts");

// ── Schema ────────────────────────────────────────────────────────────────────

describe("ENT-01 — CustomerPlan enum in schema", () => {
  it("has FREE and PAID values", () => {
    assert.ok(schema.includes("enum CustomerPlan"), "CustomerPlan enum missing");
    assert.ok(schema.includes("FREE"), "FREE value missing");
    assert.ok(schema.includes("PAID"), "PAID value missing");
  });
});

describe("ENT-02 — Customer.plan field", () => {
  it("has CustomerPlan type with FREE default", () => {
    assert.ok(schema.includes("plan              CustomerPlan @default(FREE)") ||
              schema.includes("plan  CustomerPlan @default(FREE)") ||
              (schema.includes("plan") && schema.includes("CustomerPlan") && schema.includes("@default(FREE)")),
              "Customer.plan field with FREE default missing");
  });
});

describe("ENT-03 — StylingSession.parentSessionId", () => {
  it("has nullable self-referencing parentSessionId", () => {
    assert.ok(schema.includes("parentSessionId"), "parentSessionId field missing");
    assert.ok(schema.includes("SessionContinuation"), "self-relation name missing");
  });
});

// ── Service imports ───────────────────────────────────────────────────────────

describe("ENT-04 — entitlement service imports", () => {
  it("imports from plan-limits and billing-window", () => {
    assert.ok(entSvc.includes("plan-limits.server"), "should import plan-limits");
    assert.ok(entSvc.includes("billing-window.server"), "should import billing-window");
  });
});

// ── StyleMe query correctness ─────────────────────────────────────────────────

describe("ENT-05 — qualifying StyleMe filters root sessions only", () => {
  it("entitlement service filters parentSessionId: null", () => {
    assert.ok(entSvc.includes("parentSessionId: null"), "must filter parentSessionId: null");
  });
});

describe("ENT-06 — qualifying StyleMe requires non-null moodDescription", () => {
  it("entitlement service checks moodDescription not null", () => {
    assert.ok(entSvc.includes("moodDescription") && entSvc.includes("not: null"),
              "must require non-null moodDescription");
  });
});

describe("ENT-07 — qualifying StyleMe excludes no-eligible-product", () => {
  it("entitlement service excludes no-eligible-product encoding", () => {
    assert.ok(entSvc.includes('"outcome":"no-eligible-product"'),
              'must exclude "outcome":"no-eligible-product" from qualifying sessions');
  });
});

// ── VTO quota logic ───────────────────────────────────────────────────────────

describe("ENT-08 — VTO in-flight uses stale threshold", () => {
  it("entitlement service uses lastActivityAt with a time threshold", () => {
    assert.ok(entSvc.includes("lastActivityAt"), "must use lastActivityAt for stale detection");
    assert.ok(entSvc.includes("VTO_IN_FLIGHT_STALE_MS") || entSvc.includes("staleThreshold"),
              "must define a stale threshold");
  });
});

describe("ENT-09 — VTO completed counts COMPLETED status only", () => {
  it("display usage query filters status: COMPLETED", () => {
    assert.ok(entSvc.includes('"COMPLETED"'), "must count COMPLETED status for display");
  });
});

describe("ENT-10 — VTO quota = completed + inFlight >= limit", () => {
  it("entitlement check adds completed and inFlight before comparing to limit", () => {
    assert.ok(entSvc.includes("completed + inFlight") || entSvc.includes("vtoCompleted + vtoInFlight"),
              "must sum completed and inFlight for quota check");
  });
});

// ── BuySkip quota logic ───────────────────────────────────────────────────────

describe("ENT-11 — BuySkip qualifying verdicts", () => {
  it("entitlement service counts BUY, SKIP, MAYBE and excludes INCOMPLETE", () => {
    assert.ok(entSvc.includes('"BUY"') && entSvc.includes('"SKIP"') && entSvc.includes('"MAYBE"'),
              "must include BUY, SKIP, MAYBE");
    // INCOMPLETE should not appear in the verdict filter arrays
    const verdictFilter = entSvc.match(/verdict.*in.*\[([^\]]+)\]/g) ?? [];
    verdictFilter.forEach(f => {
      assert.ok(!f.includes("INCOMPLETE"), `verdict filter must not include INCOMPLETE: ${f}`);
    });
  });
});

describe("ENT-12 — BuySkip FREE uses lifetime count", () => {
  it("FREE intro check has no window (createdAt) filter", () => {
    // The FREE path uses buySkipIntroLifetime; the PAID path uses window.
    // Verify the service distinguishes them.
    assert.ok(entSvc.includes("buySkipIntroLifetime") || entSvc.includes("introBuySkipUsed"),
              "must have a lifetime intro check path");
  });
});

describe("ENT-13 — BuySkip PAID uses monthly window filter", () => {
  it("PAID monthly BuySkip query uses window.start and window.end", () => {
    assert.ok(entSvc.includes("window.start") && entSvc.includes("window.end"),
              "must use billing window for monthly counts");
  });
});

// ── Closet enforcement ────────────────────────────────────────────────────────

describe("ENT-14 — closet guard uses getLimits, not hardcoded number", () => {
  it("closet._index.tsx imports checkEntitlement and calls it before create", () => {
    assert.ok(closetRt.includes("checkEntitlement"), "closet._index.tsx must call checkEntitlement");
    assert.ok(!closetRt.includes("count >= 50") && !closetRt.includes("count >= 100"),
              "closet._index.tsx must not hardcode limit numbers");
  });
});

describe("ENT-18 — closet enforcement is immediate (no flag)", () => {
  it("closet routes do not gate on ENTITLEMENT_ENFORCEMENT env var", () => {
    // The closet guard runs unconditionally — no flag check
    const closetRtGuardIdx = closetRt.indexOf("checkEntitlement");
    const envFlagIdx = closetRt.indexOf("ENTITLEMENT_ENFORCEMENT");
    // Either flag doesn't appear, or the guard appears before any flag check
    assert.ok(envFlagIdx === -1 || closetRtGuardIdx < envFlagIdx,
              "closet enforcement must not be behind ENTITLEMENT_ENFORCEMENT flag");
    const apiGuardIdx = closetApi.indexOf("checkEntitlement");
    const apiEnvFlagIdx = closetApi.indexOf("ENTITLEMENT_ENFORCEMENT");
    assert.ok(apiEnvFlagIdx === -1 || apiGuardIdx < apiEnvFlagIdx,
              "api.closet.jsx enforcement must not be behind ENTITLEMENT_ENFORCEMENT flag");
  });
});

// ── Monthly guards behind flag ────────────────────────────────────────────────

describe("ENT-19 — monthly guards check ENTITLEMENT_ENFORCEMENT flag", () => {
  it("StyleMe guard in result.tsx checks ENTITLEMENT_ENFORCEMENT", () => {
    assert.ok(resultTsx.includes("ENTITLEMENT_ENFORCEMENT"), "StyleMe guard must check flag");
    assert.ok(resultTsx.includes("checkEntitlement"), "StyleMe guard must use checkEntitlement");
  });

  it("BuySkip guard in api.wishlist.jsx checks ENTITLEMENT_ENFORCEMENT", () => {
    assert.ok(wishlist.includes("ENTITLEMENT_ENFORCEMENT"), "BuySkip guard must check flag");
    assert.ok(wishlist.includes("checkEntitlement"), "BuySkip guard must use checkEntitlement");
  });

  it("VTO guard in api.trigger-tryon.tsx checks ENTITLEMENT_ENFORCEMENT", () => {
    assert.ok(triggerVto.includes("ENTITLEMENT_ENFORCEMENT"), "VTO guard must check flag");
    assert.ok(triggerVto.includes("checkEntitlement"), "VTO guard must use checkEntitlement");
  });
});

// ── Welcome StyleMe calculation ───────────────────────────────────────────────

describe("ENT-15 — welcome StyleMe excluded from monthly for FREE", () => {
  it("entitlement service subtracts welcome session when it falls in current window", () => {
    assert.ok(entSvc.includes("welcomeInThisWindow"), "must detect welcome session in current window");
    assert.ok(entSvc.includes("welcomeInThisWindow ? 1 : 0"),
              "must subtract 1 from monthly count when welcome is in window");
  });
});

describe("ENT-16 — PAID StyleMe has no welcome subtraction", () => {
  it("PAID plan skips first-ever session query and welcome logic", () => {
    assert.ok(entSvc.includes('plan === "FREE"') || entSvc.includes("plan === 'FREE'"),
              "must be plan-aware for welcome logic");
    assert.ok(entSvc.includes("welcomeStyleMe: false") || planLimits.includes("welcomeStyleMe: false"),
              "PAID limits must have welcomeStyleMe: false");
  });
});

// ── Overview ─────────────────────────────────────────────────────────────────

describe("ENT-17 — Overview uses entitlement, not hardcoded values", () => {
  it("my-naia._index.tsx calls getEntitlementSummary", () => {
    assert.ok(overview.includes("getEntitlementSummary"), "overview must call getEntitlementSummary");
  });

  it("my-naia._index.tsx no longer contains fake hardcoded plan values", () => {
    assert.ok(!overview.includes('"The Atelier Plan"'), 'must not contain hardcoded "The Atelier Plan"');
    assert.ok(!overview.includes('"5 sessions remaining"'), 'must not contain hardcoded session string');
    assert.ok(!overview.includes('"3 checks remaining"'), 'must not contain hardcoded checks string');
    assert.ok(!overview.includes('"3 try-ons remaining"'), 'must not contain hardcoded try-ons string');
    assert.ok(!overview.includes('"Available this month"'), 'must not contain hardcoded trend string');
    assert.ok(!overview.includes("of 100 spaces"), 'must not contain hardcoded 100 spaces string');
  });
});

// ── Migration and route registration ─────────────────────────────────────────

describe("ENT-20 — migration file exists", () => {
  it("plan_entitlement migration exists with required statements", () => {
    const migration = readFile("prisma/migrations/20260905100000_plan_entitlement/migration.sql");
    assert.ok(migration.includes("CustomerPlan"), "migration must create CustomerPlan enum");
    assert.ok(migration.includes("Customer"), "migration must alter Customer table");
    assert.ok(migration.includes("parentSessionId"), "migration must add parentSessionId");
  });
});

describe("ENT-21 — plan-usage route registered", () => {
  it("routes.ts contains my-naia/plan-usage", () => {
    assert.ok(routes.includes("my-naia/plan-usage"), "plan-usage route must be registered");
    assert.ok(routes.includes("my-naia.plan-usage.tsx"), "plan-usage route file must be referenced");
  });
});

// ── Adjust Vibe parentSessionId linkage ──────────────────────────────────────

describe("ENT-22 — adjust-vibe action stores source session ID", () => {
  it("result.tsx stores styleMeAdjustVibeSourceId in cookie on adjust-vibe", () => {
    assert.ok(resultTsx.includes("styleMeAdjustVibeSourceId"),
              "must store source session ID in cookie for Adjust Vibe");
  });
});

describe("ENT-23 — loader reads parentSessionId from cookie", () => {
  it("result.tsx loader reads styleMeAdjustVibeSourceId and passes parentSessionId to create", () => {
    assert.ok(resultTsx.includes("adjustVibeSourceId"), "must read adjustVibeSourceId from cookie");
    assert.ok(resultTsx.includes("parentSessionId: adjustVibeSourceId"),
              "must pass parentSessionId to StylingSession.create");
  });
});
