// app/lib/plan/entitlement.test.ts
// Tests for the entitlement service and membership architecture.
//
// Source-code contract tests (no live DB) + unit tests for pure logic.
//
// ENT-01  schema has MembershipStatus enum with NONE and MEMBER values
// ENT-02  Customer model has membershipStatus field with MembershipStatus type and NONE default
// ENT-03  StylingSession has parentSessionId nullable self-reference
// ENT-04  entitlement service imports from plan-limits and usage-window
// ENT-05  qualifying StyleMe query filters parentSessionId: null (root sessions only)
// ENT-06  qualifying StyleMe query requires at least one non-null moodDescription
// ENT-07  qualifying StyleMe query excludes no-eligible-product outcome
// ENT-08  VTO in-flight uses lastActivityAt stale threshold, not unlimited window
// ENT-09  VTO completed counts only COMPLETED status
// ENT-10  VTO quota check = completed + inFlight >= effectiveVtoLimit
// ENT-24  entitlement service imports getEffectiveVtoLimit
// ENT-25  getEntitlementSummary uses effectiveVtoLimit for monthlyLimit display
// ENT-26  checkEntitlement VTO case uses effectiveVtoLimit for enforcement
// ENT-11  BuySkip qualifying verdicts are BUY, SKIP, MAYBE only (not INCOMPLETE)
// ENT-12  BuySkip always uses monthly window filter (no lifetime intro path)
// ENT-13  BuySkip window query uses window.start and window.end
// ENT-14  closet guard checks plan limit from getMembershipAllowances, not a hardcoded number
// ENT-17  Overview helper buildOverviewPlanCards uses entitlement, not closetCount directly
// ENT-18  Closet enforcement is immediate (no ENTITLEMENT_ENFORCEMENT flag check)
// ENT-19  Monthly guards (StyleMe, BuySkip, VTO) check ENTITLEMENT_ENFORCEMENT flag
// ENT-20  migration file exists for membership_status
// ENT-21  plan-usage route registered in routes.ts
// ENT-22  adjust-vibe action stores styleMeAdjustVibeSourceId in cookie
// ENT-23  result.tsx loader reads styleMeAdjustVibeSourceId and passes parentSessionId to create
// ENT-27  entitlement service imports getEffectiveStyleMeLimit
// ENT-28  getEntitlementSummary uses effectiveStyleMeLimit for styleMe.monthlyLimit display
// ENT-29  checkEntitlement styleMe case uses effectiveStyleMeLimit for enforcement
// ENT-30  membershipStatus field not plan field used in entitlement service
// ENT-31  overview no longer references e.plan or CustomerPlan

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
const resultTsx  = readFile("app/routes/style-me/result.tsx");
const overview   = readFile("app/routes/my-naia._index.tsx");
const closetRt   = readFile("app/routes/closet._index.tsx");
const closetApi  = readFile("app/routes/api.closet.jsx");
const wishlist   = readFile("app/routes/api.wishlist.jsx");
const triggerVto = readFile("app/routes/api.trigger-tryon.tsx");
const routes     = readFile("app/routes.ts");

// ── Schema ────────────────────────────────────────────────────────────────────

describe("ENT-01 — MembershipStatus enum in schema", () => {
  it("has NONE and MEMBER values", () => {
    assert.ok(schema.includes("enum MembershipStatus"), "MembershipStatus enum missing");
    assert.ok(schema.includes("NONE"), "NONE value missing");
    assert.ok(schema.includes("MEMBER"), "MEMBER value missing");
    assert.ok(!schema.includes("enum CustomerPlan"), "old CustomerPlan enum must be removed");
  });
});

describe("ENT-02 — Customer.membershipStatus field", () => {
  it("has MembershipStatus type with NONE default", () => {
    assert.ok(
      schema.includes("membershipStatus") && schema.includes("MembershipStatus") && schema.includes("@default(NONE)"),
      "Customer.membershipStatus field with NONE default missing"
    );
    assert.ok(!schema.includes("plan              CustomerPlan") && !schema.includes("plan  CustomerPlan"),
      "old Customer.plan field with CustomerPlan must be removed");
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
  it("imports from plan-limits and usage-window (not billing-window)", () => {
    assert.ok(entSvc.includes("plan-limits.server"), "should import plan-limits");
    assert.ok(entSvc.includes("usage-window.server"), "should import usage-window");
    assert.ok(!entSvc.includes("billing-window.server"), "must not import old billing-window");
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

describe("ENT-10 — VTO quota = completed + inFlight >= effectiveVtoLimit", () => {
  it("entitlement check adds completed and inFlight before comparing to effectiveVtoLimit", () => {
    assert.ok(entSvc.includes("completed + inFlight") || entSvc.includes("vtoCompleted + vtoInFlight"),
              "must sum completed and inFlight for quota check");
    assert.ok(entSvc.includes("effectiveVtoLimit"),
              "must use effectiveVtoLimit (not limits.vtoPerMonth) for enforcement");
  });
});

describe("ENT-24 — entitlement service imports getEffectiveVtoLimit", () => {
  it("imports getEffectiveVtoLimit from plan-limits", () => {
    assert.ok(entSvc.includes("getEffectiveVtoLimit"),
              "must import and use getEffectiveVtoLimit");
  });
});

describe("ENT-25 — getEntitlementSummary uses effectiveVtoLimit for display", () => {
  it("monthlyLimit in VTO summary uses effectiveVtoLimit", () => {
    assert.ok(entSvc.includes("monthlyLimit: effectiveVtoLimit"),
              "vto.monthlyLimit must be effectiveVtoLimit, not limits.vtoPerMonth");
  });
});

describe("ENT-26 — checkEntitlement VTO enforcement uses effectiveVtoLimit", () => {
  it("VTO enforcement check compares against effectiveVtoLimit", () => {
    assert.ok(entSvc.includes("completed + inFlight >= effectiveVtoLimit"),
              "enforcement must use effectiveVtoLimit");
    assert.ok(!entSvc.includes("completed + inFlight >= limits.vtoPerMonth"),
              "must not compare against raw limits.vtoPerMonth");
  });
});

// ── BuySkip quota logic ───────────────────────────────────────────────────────

describe("ENT-11 — BuySkip qualifying verdicts", () => {
  it("entitlement service counts BUY, SKIP, MAYBE and excludes INCOMPLETE", () => {
    assert.ok(entSvc.includes('"BUY"') && entSvc.includes('"SKIP"') && entSvc.includes('"MAYBE"'),
              "must include BUY, SKIP, MAYBE");
    const verdictFilter = entSvc.match(/verdict.*in.*\[([^\]]+)\]/g) ?? [];
    verdictFilter.forEach(f => {
      assert.ok(!f.includes("INCOMPLETE"), `verdict filter must not include INCOMPLETE: ${f}`);
    });
  });
});

describe("ENT-12 — BuySkip uses monthly window filter (no lifetime intro path)", () => {
  it("entitlement service has no lifetime/intro buy-skip path", () => {
    assert.ok(!entSvc.includes("buySkipIntroLifetime") && !entSvc.includes("introBuySkipUsed"),
              "intro/lifetime BuySkip path must be removed");
    assert.ok(entSvc.includes("window.start") && entSvc.includes("window.end"),
              "BuySkip must use usage window");
  });
});

describe("ENT-13 — BuySkip window query uses window.start and window.end", () => {
  it("monthly BuySkip query uses window.start and window.end", () => {
    assert.ok(entSvc.includes("window.start") && entSvc.includes("window.end"),
              "must use usage window for BuySkip monthly counts");
  });
});

// ── Closet enforcement ────────────────────────────────────────────────────────

describe("ENT-14 — closet guard uses getMembershipAllowances, not hardcoded number", () => {
  it("closet._index.tsx imports checkEntitlement and calls it before create", () => {
    assert.ok(closetRt.includes("checkEntitlement"), "closet._index.tsx must call checkEntitlement");
    assert.ok(!closetRt.includes("count >= 50") && !closetRt.includes("count >= 100"),
              "closet._index.tsx must not hardcode limit numbers");
  });
});

describe("ENT-18 — closet enforcement is immediate (no flag)", () => {
  it("closet routes do not gate on ENTITLEMENT_ENFORCEMENT env var", () => {
    const closetRtGuardIdx = closetRt.indexOf("checkEntitlement");
    const envFlagIdx = closetRt.indexOf("ENTITLEMENT_ENFORCEMENT");
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
    // 2026-11: reserveStyleMeSlot replaced checkEntitlement here — StyleMe has
    // no expensive external call between the check and the write (unlike
    // BuySkip's AI analysis step below), so a single atomic reservation is
    // the complete guard; there's no separate cheap-early-exit check to keep.
    // See ENT-32/ENT-33 for the guest-bypass and atomicity assertions.
    assert.ok(resultTsx.includes("reserveStyleMeSlot"), "StyleMe guard must use the atomic reserveStyleMeSlot");
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

describe("ENT-31 — overview no longer references old plan fields", () => {
  it("buildOverviewPlanCards does not reference e.plan or CustomerPlan", () => {
    assert.ok(!overview.includes('e.plan === "PAID"') && !overview.includes("e.plan === 'PAID'"),
              "must not reference e.plan PAID");
    assert.ok(!overview.includes('e.plan === "FREE"') && !overview.includes("e.plan === 'FREE'"),
              "must not reference e.plan FREE");
    assert.ok(!overview.includes("welcomeAvailable"),
              "welcome session logic must be removed from overview");
    assert.ok(!overview.includes("introAvailable"),
              "intro buy-skip logic must be removed from overview");
  });
});

// ── Migration and route registration ─────────────────────────────────────────

describe("ENT-20 — migration file exists for membership_status", () => {
  it("membership_status migration exists with required statements", () => {
    const migration = readFile("prisma/migrations/20260907000000_membership_status/migration.sql");
    assert.ok(migration.includes("MembershipStatus"), "migration must create MembershipStatus enum");
    assert.ok(migration.includes("membershipStatus"), "migration must add membershipStatus column");
    assert.ok(migration.includes("Customer"), "migration must alter Customer table");
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

// ── StyleMe staging override ──────────────────────────────────────────────────

describe("ENT-27 — entitlement service imports getEffectiveStyleMeLimit", () => {
  it("imports getEffectiveStyleMeLimit from plan-limits", () => {
    assert.ok(entSvc.includes("getEffectiveStyleMeLimit"),
              "must import and use getEffectiveStyleMeLimit");
  });
});

describe("ENT-28 — getEntitlementSummary uses effectiveStyleMeLimit for display", () => {
  it("styleMe.monthlyLimit uses effectiveStyleMeLimit, not limits.styleMePerMonth", () => {
    assert.ok(entSvc.includes("monthlyLimit: effectiveStyleMeLimit"),
              "styleMe.monthlyLimit must be effectiveStyleMeLimit");
    assert.ok(!entSvc.includes("monthlyLimit: limits.styleMePerMonth"),
              "must not reference limits.styleMePerMonth directly for monthlyLimit");
  });
});

describe("ENT-29 — checkEntitlement styleMe enforcement uses effectiveStyleMeLimit", () => {
  it("styleMe case compares monthlyUsed against effectiveStyleMeLimit", () => {
    assert.ok(entSvc.includes("monthlyUsed < effectiveStyleMeLimit"),
              "enforcement must use effectiveStyleMeLimit");
    assert.ok(!entSvc.includes("monthlyUsed < limits.styleMePerMonth"),
              "must not compare against raw limits.styleMePerMonth");
  });

  it("plan-limits.server.ts exports getEffectiveStyleMeLimit", () => {
    assert.ok(planLimits.includes("export function getEffectiveStyleMeLimit"),
              "must export getEffectiveStyleMeLimit from plan-limits.server.ts");
    assert.ok(planLimits.includes("STYLEME_MONTHLY_LIMIT_OVERRIDE"),
              "must read STYLEME_MONTHLY_LIMIT_OVERRIDE env var");
  });
});

describe("ENT-30 — entitlement service uses membershipStatus not plan", () => {
  it("entitlement service parameter and field is membershipStatus", () => {
    assert.ok(entSvc.includes("membershipStatus: MembershipStatus"),
              "parameter must use MembershipStatus type");
    assert.ok(!entSvc.includes("CustomerPlan"),
              "must not reference old CustomerPlan type");
    assert.ok(!entSvc.includes('plan === "FREE"') && !entSvc.includes("plan === 'FREE'"),
              "must not branch on FREE plan");
    assert.ok(!entSvc.includes("welcomeInThisWindow"),
              "welcome session logic must be removed");
    assert.ok(!entSvc.includes("buySkipIntroLifetime"),
              "intro buySkip logic must be removed");
  });
});

// ENT-32  staging-only Full-Look VTO mock jobs (fulllook-poc: namespace) excluded from real VTO usage

describe("ENT-32 — mock VTO jobs (fulllook-poc: namespace) excluded from real usage counting", () => {
  it("defines the exclusion prefix as the exact namespace the mock harness writes", () => {
    assert.ok(entSvc.includes('"fulllook-poc:"'),
              "must define the mock-test productHandle prefix exactly as poc-job-tracked-full-look-chain.server.ts writes it");
  });

  it("both getEntitlementSummary VTO count queries exclude the mock namespace", () => {
    const matches = entSvc.match(/NOT: \{ productHandle: \{ startsWith: MOCK_VTO_PRODUCT_HANDLE_PREFIX \} \}/g) ?? [];
    assert.ok(matches.length >= 4,
              `expected the exclusion in all 4 VTO count call sites (summary completed+inFlight, checkEntitlement completed+inFlight) — found ${matches.length}`);
  });
});

// ENT-36..39 renumbered from the incoming commit's own ENT-32..35 — both this
// branch and the one above independently claimed ENT-32 for unrelated
// features (VTO mock-job exclusion here vs. the guest-bypass/atomic-
// reservation work below); renumbered on merge to avoid a duplicate test ID,
// no content changed.

describe("ENT-36 — StyleMe guest bypass closed: the quota guard no longer requires naiaCustomer to run", () => {
  it("result.tsx does not gate the StyleMe quota check on naiaCustomer being truthy", () => {
    assert.ok(
      !resultTsx.includes("isEnforced && naiaCustomer"),
      "the old guard ran the quota check only for authenticated customers — a guest fell through with zero limit",
    );
  });

  it("result.tsx treats a guest as membershipStatus NONE, not as exempt from the check", () => {
    assert.match(resultTsx, /naiaCustomer\?\.membershipStatus\s*\?\?\s*"NONE"/);
  });

  it("result.tsx no longer imports checkEntitlement — the atomic reserveStyleMeSlot replaced it", () => {
    assert.ok(!resultTsx.includes("checkEntitlement"), "checkEntitlement must not still be imported/used in result.tsx");
    assert.match(resultTsx, /import\s*\{\s*reserveStyleMeSlot\s*\}\s*from\s*"~\/lib\/plan\/entitlement\.server"/);
  });
});

describe("ENT-37 — StyleMe and BuySkip quota writes are atomic (Serializable transaction), not read-before-write", () => {
  it("entitlement.server.ts exports reserveStyleMeSlot and reserveBuySkipSlot", () => {
    assert.ok(entSvc.includes("export async function reserveStyleMeSlot"));
    assert.ok(entSvc.includes("export async function reserveBuySkipSlot"));
  });

  it("the reservation transaction runs at Serializable isolation, matching VTO's createOrFindTryOnJob", () => {
    assert.match(entSvc, /isolationLevel:\s*"Serializable"/);
  });

  it("result.tsx creates the StylingSession via reserveStyleMeSlot when enforcement is on, not a bare prisma.stylingSession.create inside that branch", () => {
    const enforcedBlockStart = resultTsx.indexOf("if (isEnforced) {");
    const enforcedBlockEnd = resultTsx.indexOf("} else {", enforcedBlockStart);
    const enforcedBlock = resultTsx.slice(enforcedBlockStart, enforcedBlockEnd);
    assert.match(enforcedBlock, /reserveStyleMeSlot\(/);
    assert.ok(!enforcedBlock.includes("prisma.stylingSession.create"), "the enforced branch must reserve atomically, not create directly");
  });

  it("api.wishlist.jsx creates the BuyOrSkipAnalysis via reserveBuySkipSlot when enforcement is on", () => {
    assert.match(wishlist, /import\s*\{[^}]*reserveBuySkipSlot[^}]*\}\s*from\s*"\.\.\/lib\/plan\/entitlement\.server"/);
    const enforcedBlockStart = wishlist.indexOf('if (process.env.ENTITLEMENT_ENFORCEMENT === "true") {', wishlist.indexOf("Persist analysis"));
    const enforcedBlockEnd = wishlist.indexOf("} else {", enforcedBlockStart);
    const enforcedBlock = wishlist.slice(enforcedBlockStart, enforcedBlockEnd);
    assert.match(enforcedBlock, /reserveBuySkipSlot\(/);
  });
});

describe("ENT-38 — BuySkip already rejected the shared guest row before this change — confirming, not introducing, this protection", () => {
  it("api.wishlist.jsx explicitly rejects the shared guest customer row before any analysis write", () => {
    assert.match(wishlist, /shopifyCustomerId\s*===\s*"guest"/);
    const guestCheckIdx = wishlist.indexOf('shopifyCustomerId === "guest"');
    const createIdx = wishlist.indexOf("buyOrSkipAnalysis.create");
    assert.ok(guestCheckIdx > -1 && createIdx > -1 && guestCheckIdx < createIdx, "the guest check must run before the analysis is ever created");
  });
});

describe("ENT-39 — the two dead, unauthenticated legacy AI routes are removed, not merely firewalled", () => {
  it("api.quick-style.jsx and api.tryon.jsx no longer exist as route files", () => {
    assert.throws(() => readFile("app/routes/api.quick-style.jsx"));
    assert.throws(() => readFile("app/routes/api.tryon.jsx"));
  });

  it("routes.ts no longer registers either dead route", () => {
    assert.ok(!routes.includes('"routes/api.quick-style.jsx"'));
    assert.ok(!routes.includes('"routes/api.tryon.jsx"'));
  });
});

describe("ENT-36 — Closet's atomic reservation stays unconditional, same posture as checkEntitlement before it", () => {
  it("entitlement.server.ts exports reserveClosetSlot", () => {
    assert.ok(entSvc.includes("export async function reserveClosetSlot"));
  });

  it("neither closet._index.tsx nor api.closet.jsx gates reserveClosetSlot behind ENTITLEMENT_ENFORCEMENT", () => {
    // Checks for the actual gating CODE pattern, not bare presence of the
    // flag name — this file's own explanatory comments mention the flag by
    // name specifically to say Closet does NOT use it, which a bare
    // string-presence check can't distinguish from a real gate.
    for (const [label, src] of [["closet._index.tsx", closetRt], ["api.closet.jsx", closetApi]] as const) {
      const reserveIdx = src.indexOf("reserveClosetSlot");
      assert.ok(reserveIdx > -1, `${label} must call reserveClosetSlot`);
      assert.ok(
        !src.includes('ENTITLEMENT_ENFORCEMENT === "true"'),
        `${label} must not have gained a real ENTITLEMENT_ENFORCEMENT gate — Closet capacity remains unconditional`,
      );
    }
  });

  it("closet._index.tsx creates the ClosetItem via reserveClosetSlot, not a bare prisma.closetItem.create(...) call, in the add-intent branch", () => {
    const addIntentStart = closetRt.indexOf('if (intent === "add")');
    const deleteIntentStart = closetRt.indexOf('if (intent === "delete")');
    const addBlock = closetRt.slice(addIntentStart, deleteIntentStart);
    assert.match(addBlock, /reserveClosetSlot\(/);
    // Matches the real call shape (with the open paren) — this block's own
    // comment explaining the change mentions "prisma.closetItem.create" by
    // name without a paren, which a bare substring check would misfire on.
    assert.ok(!addBlock.includes("prisma.closetItem.create("), "the add-intent branch must reserve atomically, not create directly");
  });

  it("closet._index.tsx reserves AFTER every validation gate (ownership, Cloudinary verify, moderation, suitability) — a rejected upload structurally cannot consume a quota slot", () => {
    // Scoped to the add-intent block only — the later edit-intent branch
    // re-runs these same gate functions for its own, unrelated purpose,
    // which would otherwise make a whole-file lastIndexOf() look like the
    // reservation ran before the gates.
    const addIntentStart = closetRt.indexOf('if (intent === "add")');
    const deleteIntentStart = closetRt.indexOf('if (intent === "delete")');
    const addBlock = closetRt.slice(addIntentStart, deleteIntentStart);
    const reserveIdx = addBlock.indexOf("reserveClosetSlot(");
    const lastGateIdx = Math.max(
      addBlock.lastIndexOf("validatePublicIdOwnership"),
      addBlock.lastIndexOf("moderateImageContent"),
      addBlock.lastIndexOf("screenGarmentSuitability"),
    );
    assert.ok(reserveIdx > lastGateIdx, "reserveClosetSlot must run after ownership/moderation/suitability checks, not before — a failed upload must never reach it");
  });

  it("closet._index.tsx deletes the Cloudinary asset if the atomic reservation is lost to a concurrent upload, so a blocked item never leaves an orphaned asset", () => {
    const reserveIdx = closetRt.indexOf("reserveClosetSlot(");
    const notAllowedIdx = closetRt.indexOf("!reservation.allowed", reserveIdx);
    const blockEnd = closetRt.indexOf("return data(", notAllowedIdx);
    const block = closetRt.slice(notAllowedIdx, blockEnd);
    assert.match(block, /deleteCloudinaryAsset\(publicId,\s*"private"\)/);
  });

  it("api.closet.jsx's add action uses reserveClosetSlot", () => {
    const addIntentStart = closetApi.indexOf('act === "add"');
    const syncIntentStart = closetApi.indexOf('act === "sync"');
    const addBlock = closetApi.slice(addIntentStart, syncIntentStart);
    assert.match(addBlock, /reserveClosetSlot\(/);
  });

  it("api.closet.jsx's sync action caps the batch to remaining capacity inside a transaction, not an unbounded createMany after a boolean check", () => {
    const syncIntentStart = closetApi.indexOf('act === "sync"');
    const deleteIntentStart = closetApi.indexOf('act === "delete"');
    const syncBlock = closetApi.slice(syncIntentStart, deleteIntentStart);
    assert.match(syncBlock, /\$transaction/, "sync must run inside a transaction");
    assert.match(syncBlock, /\.slice\(0,\s*remaining\)/, "the batch must be capped to remaining capacity, not created in full");
  });
});
