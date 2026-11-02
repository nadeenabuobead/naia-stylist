// app/routes/staging.full-look-vto-test.tsx
//
// STAGING-ONLY, MOCK-ONLY test harness for sequential full-look VTO.
//
// NOT REGISTERED in app/routes.ts — this module exists and is covered by
// staging.full-look-vto-test.test.ts (loader/action invoked directly), but
// there is no route() entry wiring this path into the app yet. That is a
// deliberate, separate step: adding it to routes.ts is "connecting this to
// the live application," which is explicitly a later, separately-approved
// action, not this one.
//
// WHAT THIS DOES: reuses the production WI pairing engine
// (loadWardrobeIntelligence) to find the one specific, already visually
// confirmed Work-register combination — EXPECTED_WORK_GARMENT_NAMES below —
// among whatever candidates the engine currently ranks, re-verifies
// ownership of every garment (resolveOwnedWiGarments), checks every
// non-photo production VTO gate that applies (see "PROTECTIONS" below),
// then runs it through the job-tracked sequential chain
// (poc-job-tracked-full-look-chain.server.ts, Stage 2B) — the real
// VirtualTryOnJob lifecycle (cooldown, Serializable active-job lock, a
// race-safe single-attempt reservation) wrapped around each step's FASHN
// interaction, which is still only ever reached through a mock in every
// test in this project.
//
// WHY A NAMED COMBINATION, NOT "WHATEVER RANKS #1": the WI pairing engine
// re-ranks on every load as the Closet/Passport change. Taking
// bestByRegister.work[0] unconditionally would silently swap in a different
// outfit than the one a human visually confirmed, defeating the point of a
// "controlled" test. This route instead searches every current Work
// candidate for the one whose three garments match that exact, named set —
// and fails closed (expected_combination_not_found) if it isn't there
// today, rather than substituting a different combination.
//
// PROTECTIONS — what reuses the real production gates today vs. what is
// deferred until private-photo access is separately approved:
//   REUSED NOW (none of these touch an image/photo byte):
//     - Ownership: resolveOwnedWiGarments, same as api.wi-style-this.tsx.
//     - Category eligibility: isVtoCategoryAllowed per garment, same
//       function api.trigger-tryon.tsx calls before ever letting a garment
//       near VTO (rejects ACTIVEWEAR/SWIMWEAR/LOUNGEWEAR/OTHER/unknown).
//     - nAia Model readiness: computeModelReadinessFromRecord
//       (hasFullBodyPhoto, then isReadyForTryOn) — the same two-step check
//       and the same two distinct error messages api.trigger-tryon.tsx uses.
//     - Body photo moderation: bodyModerationStatus === "APPROVED", read
//       from the DB record already loaded for readiness — the same gate
//       submitTryOnJob enforces before any provider call.
//     - Per-generation consent freshness: a client-stamped
//       virtualTryOnConsentAt must be within MAX_CONSENT_AGE_MS (15
//       minutes), exactly api.trigger-tryon.tsx's own window and
//       constant — not a bare "consent=yes" checkbox standing in for it.
//       The checkbox is additionally required as a second, explicit
//       "I agree to this one-off test" signal; it does not replace the
//       timestamp check.
//     - Per-garment image resolution + suitability screening (2026-11-02):
//       resolveClosetAnchor resolves each garment's real, ownership-scoped
//       signed Cloudinary URL (the exact function api.wi-style-this.tsx and
//       api.trigger-tryon.tsx's closet path both already use); FASHN never
//       sees it since the chain call below is still fully mocked (see
//       createMockFashnFetch) — the URL is built, not fetched, by this step.
//       screenGarmentSuitability then runs the real, unmocked production
//       image-based AI screen (api.trigger-tryon.tsx's own suitability gate
//       for the closet source) against that URL. A missing/unresolvable
//       image or a non-PASS screening result fails the whole set closed —
//       never a silent skip, never a placeholder substituted in. This is
//       the one gate in this route that, when it actually RUNS against a
//       real account, does read real Closet garment image bytes (via the
//       AI vision call inside screenGarmentSuitability) — unlike every
//       other gate above, which only reads DB fields. It has only ever been
//       exercised here against mocked images/mocked services; see
//       staging.full-look-vto-test.test.ts.
//   DEFERRED (requires Sara's actual nAia Model body photo):
//     - Everything behind the remaining SWAP POINT below (the real model
//       photo) and the real FASHN call itself.
//     - A verified, explicitly-approved execution-time allowance for the
//       real run — see poc-job-tracked-full-look-chain.server.ts's "Issue 3"
//       section. No maxDuration/functions config exists anywhere in this
//       repo today, and a worst-case 3-step real chain (~270s) would exceed
//       Vercel's default function timeout. NOT resolved here — reported,
//       not assumed away, and nothing in this codebase changes it.
//   PARTIALLY ADDRESSED (2026-11-03, Stage 2A): a quota pre-check now runs
//   before any image is resolved — see hasQuotaRoomForFullLookChain below.
//   It is deliberately NOT routed through checkEntitlement/getEffectiveVtoLimit
//   (isolated from the pre-existing, unresolved VTO_MONTHLY_LIMIT_OVERRIDE
//   scoping bug flagged elsewhere in this project) and is enforced regardless
//   of ENTITLEMENT_ENFORCEMENT.
//   ADDRESSED (2026-11-03, Stage 2B): the chain now runs through
//   runJobTrackedFullLookChain (poc-job-tracked-full-look-chain.server.ts)
//   instead of the DB-free orchestrator — real VirtualTryOnJob rows, the
//   real Serializable active-job lock, a race-safe single-attempt
//   reservation keyed off the existing idempotencyKey unique constraint
//   (not a count query), and correct per-step cooldown placement (checked
//   once, before step 1 — checking it before every step would self-block
//   the chain on its own just-completed prior step; see that file's own
//   header for why). Multi-credit accounting falls out of this for free:
//   up to 3 real job rows, one per genuinely attempted step, is exactly
//   what the existing quota-counting queries already count correctly.
//
// AUTH / AUTHORIZATION / CSRF: identity comes only from
// getCurrentNaiaCustomer(request) — the real session cookie
// (naia-session.server.ts sets it HttpOnly; Secure; SameSite=Lax). customerId
// is never read from the request body or form. The page's <Form method="post">
// submits same-origin; SameSite=Lax already stops the session cookie from
// being attached to a cross-site POST, which is the same baseline every other
// same-origin mutating route in this app (e.g. api.wi-style-this.tsx) relies
// on instead of a separate CSRF token. Authorization is the staging+allowlist
// gate below, re-checked on every request (loader AND action independently —
// there is no shared "already authorized" state), plus ownership
// re-verification repeated inside the action rather than trusted from the
// loader's earlier result.
//
// IMPOSSIBLE IN PRODUCTION EVEN IF ACCIDENTALLY REGISTERED: the gate checks
// process.env.NAIA_PROJECT_VARIANT with strict equality against the literal
// string "staging" — never VERCEL_ENV (which is "production" on both the
// real production project and a promoted staging deployment, so it cannot
// tell them apart — see api.staging-full-look-vto.tsx's own comment on
// exactly this). Unset, "production", "preview", or any other value all
// fail closed. See GT.16 in the test file, which sets
// NAIA_PROJECT_VARIANT="production" explicitly (not merely absent) with a
// matching allowlist, and still gets 404.
//
// WHAT THIS DOES NOT DO (by construction, not by omission):
//   - GET never touches FASHN, a model photo, or a garment image. It only
//     reads garment name/category/subcategory metadata and a boolean
//     nAia Model readiness flag. Opening this page spends nothing.
//   - POST (the only way anything generates) uses a MOCK model image —
//     synthetic data: URL, never Sara's real nAia Model photo. That one
//     remaining call site is marked "SWAP POINT" below; it is not touched
//     here. Garment "product images" are now real, ownership-verified,
//     screened Closet image URLs (2026-11-02) — see the per-garment
//     resolution block above.
//   - The FASHN call itself is fully mocked (createMockFashnFetch) — no
//     real network request to api.fashn.ai happens from this route today,
//     regardless of how real the garment image URLs passed into it are.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadWardrobeIntelligence } from "~/lib/ai/wardrobe-intelligence.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { isVtoCategoryAllowed } from "~/lib/ai/closet-eligibility";
import { resolveClosetAnchor } from "~/lib/ai/styleme-anchor.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { getMembershipAllowances } from "~/lib/plan/plan-limits.server";
import { getEntitlementSummary } from "~/lib/plan/entitlement.server";
import type { MembershipStatus } from "@prisma/client";
import prisma from "~/db.server";
import { resolveOwnedWiGarments, type WiResolvedGarmentMetadata } from "~/lib/ai/poc-wi-combination-resolver.server";
import { MAX_CHAIN_LENGTH } from "~/lib/ai/poc-sequential-full-look-vto.server";
import {
  runJobTrackedFullLookChain,
  type JobTrackedChainGarmentInput,
} from "~/lib/ai/poc-job-tracked-full-look-chain.server";
import type { RunTryOnOptions } from "~/lib/ai/fashn-try-on.server";
import type { VirtualTryOnConsent } from "~/lib/ai/virtual-try-on.types";

// ── Gate ──────────────────────────────────────────────────────────────────────

interface GateableCustomer {
  id: string;
  shopifyCustomerId?: string | null;
}

export function isAuthorizedStagingTestAccount(customer: GateableCustomer): boolean {
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") return false;
  const allowlist = (process.env.FULL_LOOK_VTO_TEST_CUSTOMER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return false;
  return allowlist.includes(customer.shopifyCustomerId ?? "") || allowlist.includes(customer.id);
}

function notFound(): never {
  throw new Response("Not Found", { status: 404 });
}

// ── Passport mapping ──────────────────────────────────────────────────────────
// Deliberately duplicated from closet.intelligence.tsx's own profile→
// WardrobePassport mapping rather than imported — that file is a
// customer-facing route and stays untouched. This is a small, inert data
// shape, not the VTO infrastructure itself.

function mapProfileToPassport(profile: Record<string, unknown>) {
  return {
    lifestyle: (profile.lifestyle as string[]) ?? [],
    favoriteColors: (profile.favoriteColors as string[]) ?? [],
    avoidColors: (profile.avoidColors as string[]) ?? [],
    stylePersonalities: (profile.stylePersonalities as string[]) ?? [],
    silhouette: (profile.silhouette as string[]) ?? [],
    structure: (profile.structure as string | null) ?? null,
    fitPreferences: (profile.fitPreferences as string[]) ?? [],
    styleStruggles: (profile.styleStruggles as string[]) ?? [],
    styleSupport: (profile.styleSupport as string[]) ?? [],
    becoming: (profile.becoming as string[]) ?? [],
    styleExpression: (profile.styleExpression as string[]) ?? undefined,
    styleDirections: (profile.styleDirections as string[]) ?? undefined,
    explorationLevel: (profile.explorationLevel as string | null) ?? null,
    dressingHabits: (profile.dressingHabits as string[]) ?? undefined,
    dressingPreferences: (profile.dressingPreferences as string[]) ?? [],
    coveragePreferences: (profile.coveragePreferences as string[]) ?? undefined,
    preferredCoverage: (profile.preferredCoverage as string | null) ?? null,
    dressingRequirementsNote: (profile.dressingRequirementsNote as string | null) ?? null,
    fitConcerns: (profile.fitConcerns as string[]) ?? undefined,
    dressesFor: (profile.dressesFor as string[]) ?? undefined,
    neutralVsColour: (profile.neutralVsColour as string | null) ?? null,
    colourIntensity: (profile.colourIntensity as string | null) ?? null,
    printAppetite: (profile.printAppetite as string | null) ?? null,
  };
}

const DISPLAY_SLOT_ORDER: Record<string, number> = { dress: 0, set: 0, bottom: 0, top: 1, outerwear: 2 };
function sortForDisplay(garments: WiResolvedGarmentMetadata[]): WiResolvedGarmentMetadata[] {
  return [...garments].sort((a, b) => (DISPLAY_SLOT_ORDER[a.slot] ?? 9) - (DISPLAY_SLOT_ORDER[b.slot] ?? 9));
}

// ── The one, named, already-confirmed combination ────────────────────────────
// Deliberately hardcoded to this single validated real-world case, not a
// general "take the top Work pairing" mechanism. Matched by name, against
// whatever the pairing engine currently ranks — never substituted for a
// different combination if this exact one isn't found.

const EXPECTED_WORK_GARMENT_NAMES = [
  "Beige Tailored Blazer",
  "Blue Chambray Button-Up Shirt",
  "Beige Tailored Trousers",
] as const;

function normalizeName(s: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

function matchesExpectedCombination(garments: WiResolvedGarmentMetadata[]): boolean {
  if (garments.length !== EXPECTED_WORK_GARMENT_NAMES.length) return false;
  const expected = new Set(EXPECTED_WORK_GARMENT_NAMES.map((n) => normalizeName(n)));
  const actual = new Set(garments.map((g) => normalizeName(g.name)));
  if (actual.size !== expected.size) return false;
  for (const name of actual) if (!expected.has(name)) return false;
  return true;
}

// ── Real-Work-pairing resolution, shared by loader and action ───────────────

type WorkPairingOutcome =
  | { ok: true; reason: string; garments: WiResolvedGarmentMetadata[] }
  | { ok: false; reason: "expected_combination_not_found" | "ownership_check_failed" };

async function resolveExpectedWorkCombination(customerId: string): Promise<WorkPairingOutcome> {
  const profile = await prisma.onboardingProfile.findUnique({ where: { customerId } });
  const passport = profile ? mapProfileToPassport(profile as unknown as Record<string, unknown>) : null;

  const { intelligence } = await loadWardrobeIntelligence(customerId, {
    imageUrlById: new Map(), // never resolved here — metadata-only, matches the WI pairing engine's own needs
    passport,
  });

  const candidates = intelligence.pairings.bestByRegister.work ?? [];

  for (const pairing of candidates) {
    if (pairing.garmentIds.length !== EXPECTED_WORK_GARMENT_NAMES.length) continue;

    const resolved = await resolveOwnedWiGarments(customerId, pairing.garmentIds);
    if (!resolved) return { ok: false, reason: "ownership_check_failed" };

    if (matchesExpectedCombination(resolved)) {
      return { ok: true, reason: pairing.reason, garments: resolved };
    }
  }

  return { ok: false, reason: "expected_combination_not_found" };
}

// ── Loader — metadata + readiness only, zero generation, zero cost ──────────

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || !isAuthorizedStagingTestAccount(customer)) notFound();

  const outcome = await resolveExpectedWorkCombination(customer.id);
  if (!outcome.ok) {
    return data({ ok: false as const, reason: outcome.reason });
  }

  const naiaModel = await loadNaiaModel(customer.id);
  const modelReady = naiaModel ? computeModelReadinessFromRecord(naiaModel).isReadyForTryOn : false;

  return data({
    ok: true as const,
    reason: outcome.reason,
    modelReady,
    garments: sortForDisplay(outcome.garments).map((g) => ({
      closetItemId: g.closetItemId,
      name: g.name,
      category: g.category,
      slot: g.slot,
    })),
  });
}

// ── Mock FASHN fetch — local to this test harness only ──────────────────────
// Mirrors the two-request shape runFashnTryOn makes (POST /v1/run, then GET
// /v1/status/{id}) with synthetic, always-valid-pattern data URLs. No real
// network call. failAtStepIndex lets the test flow (and this route's own
// automated tests) exercise partial-failure handling without ever touching
// a real FASHN credential or endpoint.

function createMockFashnFetch(failAtStepIndex: number | null): RunTryOnOptions {
  let stepIndex = -1;
  const _fetch = (async (url: string | URL | Request) => {
    const u = url.toString();
    if (u.includes("/v1/run")) {
      stepIndex += 1;
      return new Response(JSON.stringify({ id: `mock-pred-${stepIndex}` }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/v1/status/")) {
      if (failAtStepIndex !== null && stepIndex === failAtStepIndex) {
        return new Response(JSON.stringify({ status: "failed", error: "simulated failure" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ status: "completed", output: [`data:image/png;base64,bW9ja291dHB1dCR7c3RlcEluZGV4fQ==`] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    throw new Error(`unexpected mock fetch to ${u}`);
  }) as typeof fetch;
  return { _fetch, _sleep: () => Promise.resolve(), _getApiKey: () => "mock-key" };
}

const MOCK_MODEL_IMAGE_DATA_URL = "data:image/png;base64,bW9ja21vZGVsaW1hZ2U=";
// SWAP POINT (model photo): going real means replacing the constant above
// with downloadModelPhotoAsDataUrl(naiaModel.bodyPublicId, naiaModel.bodyFormat,
// naiaModel.deliveryType) from fashn-tryon-service.server.ts — not done here.

const MAX_CONSENT_AGE_MS = 15 * 60 * 1000; // same window and constant as api.trigger-tryon.tsx

// ── Stage 2A: quota pre-check for the full 3-step chain (2026-11-03) ────────
//
// PROVISIONAL POLICY, not a final pricing decision: a 3-garment Full-Look
// generation is treated here as costing MAX_CHAIN_LENGTH (3) VTO quota units,
// not 1 — because it costs 3x a normal single-garment VTO in real FASHN
// credits. The request must not even START unless the customer has room for
// the WORST case (all 3 steps succeeding), not just room for one — a chain
// that runs out of allowance partway through would still have genuinely
// spent credits on the steps that did succeed.
//
// DELIBERATELY ISOLATED FROM THE SHARED PRODUCTION ENTITLEMENT SYSTEM:
//   - Uses getMembershipAllowances(status).vtoPerMonth — the raw, standard
//     per-tier allowance — NOT getEffectiveVtoLimit(status). That function
//     applies VTO_MONTHLY_LIMIT_OVERRIDE, a staging/QA override meant to
//     raise the limit for every tier in every environment (a separate,
//     already-flagged, unresolved scoping issue). This one-off test must
//     never inherit that override in either direction — not this check, not
//     checkEntitlement, not getEffectiveVtoLimit, not the override env var
//     itself, are touched or modified by this change.
//   - Usage counts (monthlyCompleted + monthlyInFlight) are read via the
//     existing, unmodified getEntitlementSummary — the same real DB counts
//     every other feature already relies on, just not run through the
//     override-aware limit.
//   - Enforced UNCONDITIONALLY, regardless of process.env.ENTITLEMENT_ENFORCEMENT.
//     A new fail-closed safeguard should not depend on an existing flag
//     whose current value in whatever environment this eventually runs in
//     is not this route's concern.
//
// NOT ATOMIC — AND NOT SUFFICIENT AUTHORISATION FOR REAL SPENDING:
//   This is a plain read-before-write, exactly the same non-atomic pattern
//   entitlement.server.ts's own header comment already documents and
//   accepts for every other feature's identical quota check ("acceptable
//   for staging [low concurrency]... before enabling ENTITLEMENT_ENFORCEMENT
//   in production, [other features'] guards must be wrapped in Serializable
//   transactions"). Two near-simultaneous requests from the same customer
//   could both pass this check. For the MOCKED prototype this route runs
//   today, that is an accepted, explicitly-flagged residual risk — not
//   because it is harmless, but because nothing here can actually overspend:
//   no FASHN call happens, no credit is at risk, and only one allowlisted
//   staging test account can ever reach this route at all.
//   This changes completely the moment real FASHN calls are ever enabled.
//   Before that happens, this route needs, at minimum: durable per-customer
//   concurrency protection (a real reservation, held in a Serializable
//   transaction or equivalent, not a plain count-then-compare), real usage
//   accounting for a multi-credit chain (today's VirtualTryOnJob model has
//   no concept of a job costing more than 1 unit), and a hard, enforced
//   spending ceiling independent of this quota check. This pre-check alone
//   must never be read or represented as having solved any of that.
async function hasQuotaRoomForFullLookChain(
  customer: { id: string; membershipStatus: MembershipStatus },
): Promise<boolean> {
  try {
    const allowance = getMembershipAllowances(customer.membershipStatus);
    const summary = await getEntitlementSummary(customer.id, customer.membershipStatus);
    const used = summary.vto.monthlyCompleted + summary.vto.monthlyInFlight;
    const remaining = allowance.vtoPerMonth - used;
    return remaining >= MAX_CHAIN_LENGTH;
  } catch {
    // Membership or usage could not be established reliably — fail closed,
    // never fail open to "allowed".
    return false;
  }
}

// ── Action — the only way anything "generates" ───────────────────────────────
// Every branch below returns the same shape (ActionResult) so a consumer
// (this file's own tests, the page component) never has to guess which
// optional fields a given failure reason carries.

interface ActionStepResult {
  label: string;
  slot: string;
  ok: boolean;
}

type ActionResult =
  | { ok: true; mock: true; creditsUsed: number; steps: ActionStepResult[]; finalImageDataUrl: string }
  | { ok: false; reason: string; mock?: true; creditsUsed?: number; failedStepIndex?: number; steps?: ActionStepResult[] };

export async function action({ request }: ActionFunctionArgs) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer || !isAuthorizedStagingTestAccount(customer)) notFound();

  const form = await request.formData();

  // ── Explicit human confirmation — additive, not a substitute for the
  // freshness check below. ────────────────────────────────────────────────
  if (form.get("consent") !== "yes") {
    return data({ ok: false, reason: "consent_required" } as ActionResult, { status: 400 });
  }

  // ── Per-generation consent freshness — same MAX_CONSENT_AGE_MS window as
  // api.trigger-tryon.tsx, driven by a timestamp the client stamps at
  // submit time (see onSubmit in the component below), not a static value. ─
  const rawConsentAt = form.get("virtualTryOnConsentAt");
  if (typeof rawConsentAt !== "string" || rawConsentAt.length === 0) {
    return data({ ok: false, reason: "consent_required" } as ActionResult, { status: 400 });
  }
  const consentAt = new Date(rawConsentAt);
  if (isNaN(consentAt.getTime())) {
    return data({ ok: false, reason: "consent_required" } as ActionResult, { status: 400 });
  }
  const consentAgeMs = Date.now() - consentAt.getTime();
  if (consentAgeMs < 0 || consentAgeMs > MAX_CONSENT_AGE_MS) {
    return data({ ok: false, reason: "consent_expired" } as ActionResult, { status: 400 });
  }

  // ── Re-resolved independently of the loader — defense in depth, same
  // convention as every other mutating action in this codebase. ───────────
  const outcome = await resolveExpectedWorkCombination(customer.id);
  if (!outcome.ok) {
    return data({ ok: false, reason: outcome.reason } as ActionResult, { status: 400 });
  }

  // ── nAia Model readiness — re-checked here, not trusted from the loader's
  // earlier (possibly stale) read. Same two-step distinction
  // api.trigger-tryon.tsx makes. ───────────────────────────────────────────
  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) {
    return data({ ok: false, reason: "model_not_configured" } as ActionResult, { status: 400 });
  }
  const readiness = computeModelReadinessFromRecord(naiaModel);
  if (!readiness.hasFullBodyPhoto || !readiness.isReadyForTryOn) {
    return data({ ok: false, reason: "model_not_ready" } as ActionResult, { status: 400 });
  }

  // ── Body photo moderation — same gate submitTryOnJob enforces before any
  // provider call. A DB field read, not a photo access. ────────────────────
  if (naiaModel.bodyModerationStatus !== "APPROVED") {
    return data({ ok: false, reason: "model_not_moderated" } as ActionResult, { status: 400 });
  }

  // ── Per-garment category eligibility — same function
  // api.trigger-tryon.tsx calls before any closet garment reaches VTO. ─────
  const ineligible = outcome.garments.find((g) => !isVtoCategoryAllowed(g.category, g.subcategory));
  if (ineligible) {
    return data({ ok: false, reason: "garment_not_eligible" } as ActionResult, { status: 400 });
  }

  // ── Quota pre-check — the request must not start unless there is room for
  // the whole 3-step chain. See the large comment on hasQuotaRoomForFullLookChain
  // above for the policy, isolation from VTO_MONTHLY_LIMIT_OVERRIDE, and the
  // explicit non-atomicity caveat. No customer-identifying or numeric detail
  // is exposed in the response — just a flat, safe reason code. ───────────
  const hasQuotaRoom = await hasQuotaRoomForFullLookChain(customer);
  if (!hasQuotaRoom) {
    return data({ ok: false, reason: "quota_insufficient_for_full_look" } as ActionResult, { status: 400 });
  }

  // ── Per-garment image resolution + suitability screening — real, not a
  // placeholder. resolveClosetAnchor re-verifies ownership AGAIN (defense
  // in depth, same as every other check in this action) and returns the
  // garment's real signed Cloudinary URL; screenGarmentSuitability then runs
  // the real production AI screen against it. Each garment is resolved and
  // screened individually, and ANY failure fails the whole set closed —
  // never a silent skip, never a placeholder substituted in its place. ────
  const resolvedImageUrlById = new Map<string, string>();
  for (const g of outcome.garments) {
    const anchor = await resolveClosetAnchor(customer.id, g.closetItemId);
    if (!anchor || !anchor.imageUrl) {
      return data({ ok: false, reason: "garment_image_unavailable" } as ActionResult, { status: 400 });
    }
    const suitability = await screenGarmentSuitability(anchor.imageUrl, { declaredCategory: g.category });
    if (suitability.status !== "PASS") {
      return data({ ok: false, reason: "garment_not_suitable" } as ActionResult, { status: 400 });
    }
    resolvedImageUrlById.set(g.closetItemId, anchor.imageUrl);
  }

  const consent: VirtualTryOnConsent = {
    virtualTryOnConsent: true,
    policyVersion: "1.0-staging-test",
    consentedAt: consentAt.toISOString(),
  };

  const ordered = sortForDisplay(outcome.garments);
  const garments: JobTrackedChainGarmentInput[] = ordered.map((g) => ({
    label: g.name ?? g.closetItemId,
    category: g.category,
    subcategory: g.subcategory,
    productImageUrl: resolvedImageUrlById.get(g.closetItemId)!,
  }));

  // Test-harness-only knob — lets this route's own tests (and only this
  // route's own tests) exercise partial-failure handling. Has no effect
  // unless the staging+allowlist gate above already passed.
  const rawFailAt = form.get("__simulateFailureAtStep");
  const failAtStepIndex = typeof rawFailAt === "string" && rawFailAt !== "" ? Number(rawFailAt) : null;

  // ── Stage 2B: job-tracked chain execution — see
  // poc-job-tracked-full-look-chain.server.ts for the full design (cooldown
  // checked once, the race-safe single-attempt reservation, and the
  // still-unresolved execution-timeout caveat for the real run). ──────────
  const report = await runJobTrackedFullLookChain(
    {
      customerId: customer.id,
      naiaModelId: naiaModel.id,
      bodyPublicId: naiaModel.bodyPublicId,
      initialModelImageDataUrl: MOCK_MODEL_IMAGE_DATA_URL,
      garments,
      consent,
    },
    createMockFashnFetch(failAtStepIndex),
  );

  if (report.ok) {
    return data({
      ok: true,
      mock: true,
      creditsUsed: report.creditsUsed,
      steps: report.steps.map((s, i) => ({ label: s.label, slot: ordered[i]?.slot ?? "unknown", ok: s.ok })),
      finalImageDataUrl: report.finalImageDataUrl,
    } as ActionResult);
  }

  return data({
    ok: false,
    mock: true,
    reason: report.reason,
    creditsUsed: report.creditsUsed,
    failedStepIndex: report.failedStepIndex,
    steps: report.steps.map((s, i) => ({ label: s.label, slot: ordered[i]?.slot ?? "unknown", ok: s.ok })),
  } as ActionResult, { status: 400 });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StagingFullLookVtoTest() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();

  if (!loaderData.ok) {
    return <p>Could not find the expected Work combination: {loaderData.reason}</p>;
  }

  return (
    <div>
      <p style={{ fontWeight: "bold" }}>
        MOCK TEST — no real photo, no real FASHN call, no credits spent.
      </p>
      <h1>Full-Look VTO staging test — Work</h1>
      <p>{loaderData.reason}</p>
      <ol>
        {loaderData.garments.map((g) => (
          <li key={g.closetItemId}>{g.name ?? g.closetItemId} — {g.category} ({g.slot})</li>
        ))}
      </ol>
      <p>nAia Model ready: {loaderData.modelReady ? "yes" : "no"}</p>

      <Form
        method="post"
        onSubmit={(e) => {
          // Stamped fresh at the moment of submit, same as the real client
          // flow — never a value left sitting in the DOM from page load.
          const input = e.currentTarget.elements.namedItem("virtualTryOnConsentAt") as HTMLInputElement | null;
          if (input) input.value = new Date().toISOString();
        }}
      >
        <input type="hidden" name="virtualTryOnConsentAt" value="" />
        <label>
          <input type="checkbox" name="consent" value="yes" required /> I consent to this one staging test.
        </label>
        <button type="submit">Generate mock full-look preview</button>
      </Form>

      {actionData && actionData.ok && (
        <div>
          <p>Mock chain complete — {actionData.creditsUsed} mock credit(s) used.</p>
          <img src={actionData.finalImageDataUrl} alt="Mock full-look result" />
        </div>
      )}
      {actionData && !actionData.ok && (
        <div>
          <p>Failed: {actionData.reason}</p>
          {actionData.steps && (
            <ul>
              {actionData.steps.map((s, i) => (
                <li key={i}>{s.label} — {s.ok ? "ok" : "FAILED"}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
