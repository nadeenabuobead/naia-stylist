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
// then runs the isolated sequential VTO POC (runSequentialFullLookTryOn)
// against it.
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
//   DEFERRED (requires the actual image, not just a DB field):
//     - screenGarmentSuitability — api.trigger-tryon.tsx's image-based
//       suitability screen for the closet source. Cannot run without
//       fetching the real garment photo, which this route does not do.
//     - Everything behind the two SWAP POINTs below (the real model photo,
//       the real per-garment signed URLs) and the real FASHN call itself.
//   KNOWINGLY NOT ADDRESSED HERE (separately tracked, pre-existing issue,
//   not something to silently fold into this test):
//     - VTO quota/entitlement (ENTITLEMENT_ENFORCEMENT) — already flagged
//       elsewhere in this project as having its own unresolved scoping bug.
//       This route does not call checkEntitlement at all.
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
//   - POST (the only way anything generates) uses a MOCK model image and
//     MOCK garment "product images" — synthetic data: URLs, never Sara's
//     real nAia Model photo and never a real signed Cloudinary URL. The
//     two call sites that would need to change to go real are marked
//     "SWAP POINT" below; neither is touched here.
//   - The FASHN call itself is fully mocked (createMockFashnFetch) — no
//     real network request to api.fashn.ai happens from this route today.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, useActionData, useLoaderData } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { loadWardrobeIntelligence } from "~/lib/ai/wardrobe-intelligence.server";
import { loadNaiaModel, computeModelReadinessFromRecord } from "~/lib/ai/my-naia-model.server";
import { isVtoCategoryAllowed } from "~/lib/ai/closet-eligibility";
import prisma from "~/db.server";
import { resolveOwnedWiGarments, type WiResolvedGarmentMetadata } from "~/lib/ai/poc-wi-combination-resolver.server";
import {
  runSequentialFullLookTryOn,
  type SequentialTryOnGarmentInput,
} from "~/lib/ai/poc-sequential-full-look-vto.server";
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

const MOCK_PRODUCT_IMAGE_URL = "https://example.com/mock-product-image.png";
// SWAP POINT (garment photos): going real means resolving each garment's
// actual signed Cloudinary URL (resolveClosetAnchor / buildPrivateDownloadUrl)
// instead of this placeholder — not done here. screenGarmentSuitability
// (image-based) also belongs here once this swap happens; it cannot run
// against a placeholder URL today.

const MAX_CONSENT_AGE_MS = 15 * 60 * 1000; // same window and constant as api.trigger-tryon.tsx

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

  const consent: VirtualTryOnConsent = {
    virtualTryOnConsent: true,
    policyVersion: "1.0-staging-test",
    consentedAt: consentAt.toISOString(),
  };

  const ordered = sortForDisplay(outcome.garments);
  const garments: SequentialTryOnGarmentInput[] = ordered.map((g) => ({
    label: g.name ?? g.closetItemId,
    category: g.category,
    subcategory: g.subcategory,
    productImageUrl: MOCK_PRODUCT_IMAGE_URL,
  }));

  // Test-harness-only knob — lets this route's own tests (and only this
  // route's own tests) exercise partial-failure handling. Has no effect
  // unless the staging+allowlist gate above already passed.
  const rawFailAt = form.get("__simulateFailureAtStep");
  const failAtStepIndex = typeof rawFailAt === "string" && rawFailAt !== "" ? Number(rawFailAt) : null;

  const report = await runSequentialFullLookTryOn(
    { customerId: customer.id, initialModelImageDataUrl: MOCK_MODEL_IMAGE_DATA_URL, garments, consent },
    createMockFashnFetch(failAtStepIndex),
  );

  if (report.ok) {
    return data({
      ok: true,
      mock: true,
      creditsUsed: report.creditsUsed,
      steps: report.steps.map((s) => ({ label: s.garment.label, slot: s.slot, ok: true })),
      finalImageDataUrl: report.finalImageDataUrl,
    } as ActionResult);
  }

  return data({
    ok: false,
    mock: true,
    reason: report.reason,
    creditsUsed: report.creditsUsed,
    failedStepIndex: "failedStepIndex" in report ? report.failedStepIndex : undefined,
    steps: report.steps.map((s) => ({ label: s.garment.label, slot: s.slot, ok: s.result.ok })),
  } as ActionResult);
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
