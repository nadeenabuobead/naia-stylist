// app/lib/ai/full-look-work-combination.server.ts
//
// Shared helpers for the Full-Look VTO test harnesses — extracted (2026-11-03)
// from staging.full-look-vto-test.tsx so both that mock route and
// staging.full-look-vto-real.tsx can import the SAME implementation instead
// of each defining (and risking drift between) their own copy.
//
// WHY THIS HAD TO MOVE OUT OF THE ROUTE FILE: React Router's build only
// strips server-only code from a route module's loader/action/middleware/
// headers exports. Any OTHER named export from a route .tsx file is treated
// as potentially client-reachable, so if it transitively imports a
// `.server.ts` module (as resolveExpectedWorkCombination does, via
// loadWardrobeIntelligence), the production build fails with "Server-only
// module referenced by client" — confirmed by actually running the build
// after exporting these functions directly from the route file. Moving them
// into this ordinary `.server.ts` module (never a route file) is the fix:
// a route file may freely IMPORT from a `.server.ts` module, it just can't
// RE-EXPORT something that drags one in as a non-loader/action export.

import prisma from "../../db.server.js";
import { loadWardrobeIntelligence } from "./wardrobe-intelligence.server.js";
import { resolveOwnedWiGarments, type WiResolvedGarmentMetadata } from "./poc-wi-combination-resolver.server.js";
import { getMembershipAllowances } from "../plan/plan-limits.server.js";
import { getEntitlementSummary } from "../plan/entitlement.server.js";
import { MAX_CHAIN_LENGTH } from "./poc-sequential-full-look-vto.server.js";
import type { MembershipStatus } from "@prisma/client";

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

// ── Display / layering order ─────────────────────────────────────────────────
// "trousers → shirt → blazer" body-outward. Both the mock and real routes
// must reuse this exact ordering — two independently-sorted copies of the
// same 3 garments would silently risk a different step order between them.

const DISPLAY_SLOT_ORDER: Record<string, number> = { dress: 0, set: 0, bottom: 0, top: 1, outerwear: 2 };
export function sortForDisplay(garments: WiResolvedGarmentMetadata[]): WiResolvedGarmentMetadata[] {
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

// ── Final-step-only generation tuning (2026-11-03) ──────────────────────────
//
// Scoped to this one named combination, same convention as
// EXPECTED_WORK_GARMENT_NAMES above — not a general mechanism for arbitrary
// garments. Addresses the observed first-real-test result (blazer applied
// last, blue shirt underneath not visibly identifiable) using only
// FASHN-documented tryon-max fields (prompt, generation_mode) — see
// fashn-try-on.server.ts's VirtualTryOnInput for how these flow through.
//
// This is a REQUEST, not a guarantee. FASHN's own docs describe `prompt` as
// "optional instructions to customize the try-on result" — natural-language
// steering with no documented adherence contract — and `generation_mode:
// "quality"` is FASHN's highest general-purpose fidelity tier, not a
// garment-specific preservation control (no such control exists in this
// endpoint's documented parameters). Visual success still requires the next
// real test to actually confirm the shirt is identifiable; this change only
// gives the model the best documented chance of it.
export const FINAL_STEP_VISUAL_PROMPT =
  "Wear the beige tailored blazer open over the existing blue chambray shirt, " +
  "worn normally with both arms inside the sleeves — not draped over the " +
  "shoulders. Keep the blue shirt visibly identifiable through the blazer " +
  "opening, preserving its colour, collar and realistic layering. Preserve " +
  "the beige tailored trousers and the model's identity.";
export const FINAL_STEP_GENERATION_MODE = "quality" as const;

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

// ── Real-Work-pairing resolution, shared by both routes' loaders and actions ─

export type WorkPairingOutcome =
  | { ok: true; reason: string; garments: WiResolvedGarmentMetadata[] }
  | { ok: false; reason: "expected_combination_not_found" | "ownership_check_failed" };

export async function resolveExpectedWorkCombination(customerId: string): Promise<WorkPairingOutcome> {
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

// ── Consent freshness window — same constant api.trigger-tryon.tsx uses ─────

export const MAX_CONSENT_AGE_MS = 15 * 60 * 1000;

// ── Quota pre-check for the full 3-step chain ────────────────────────────────
//
// PROVISIONAL POLICY, not a final pricing decision: a 3-garment Full-Look
// generation is treated here as costing MAX_CHAIN_LENGTH (3) VTO quota units,
// not 1 — because it costs 3x a normal single-garment VTO in real FASHN
// credits. The request must not even START unless the customer has room for
// the WORST case (all 3 steps succeeding), not just room for one.
//
// DELIBERATELY ISOLATED FROM THE SHARED PRODUCTION ENTITLEMENT SYSTEM:
//   - Uses getMembershipAllowances(status).vtoPerMonth — the raw, standard
//     per-tier allowance — NOT getEffectiveVtoLimit(status), which applies
//     VTO_MONTHLY_LIMIT_OVERRIDE (a separate, already-flagged, unresolved
//     scoping issue this check must never inherit).
//   - Usage counts (monthlyCompleted + monthlyInFlight) are read via the
//     existing, unmodified getEntitlementSummary.
//   - Enforced UNCONDITIONALLY, regardless of process.env.ENTITLEMENT_ENFORCEMENT.
//
// NOT ATOMIC — AND NOT SUFFICIENT AUTHORISATION FOR REAL SPENDING: this is a
// plain read-before-write (the same accepted, documented pattern
// entitlement.server.ts's own header comment uses elsewhere). For the mocked
// route this was originally written for, nothing can actually overspend (no
// FASHN call happens). staging.full-look-vto-real.tsx DOES make real FASHN
// calls — this pre-check alone is not a durable concurrency guard for that
// case; the real route's additional protection is the permanent, one-time
// idempotency reservation in full-look-tryon-real.server.ts, not this check.
export async function hasQuotaRoomForFullLookChain(
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
