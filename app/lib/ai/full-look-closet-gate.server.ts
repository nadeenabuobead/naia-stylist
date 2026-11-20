// app/lib/ai/full-look-closet-gate.server.ts
//
// 2026-11-21 — Pre-FASHN eligibility gate for CLOSET-backed Full-Look garments.
//
// WHY: the single-garment route (api.trigger-tryon.tsx, source "closet")
// refuses a closet item before any FASHN call unless it passes (1) the shared
// category rule isVtoCategoryAllowed and (2) a live screenGarmentSuitability
// check — its own comment explains Stage B was removed from upload and this
// VTO-time screening replaced it. The Full-Look route never applied either
// check: selectFullLookGarments only resolves an image URL, so a closet piece
// of an unsupported category, or a photo the product itself flags, could be
// submitted as one of up to five billable steps. This module applies the SAME
// two rules (plus the known-ineligible Stage A flags) to every closet-backed
// piece the chain is about to submit.
//
// WHAT IS DELIBERATELY NOT REQUIRED: tryOnEligibility === "ready-for-try-on".
// That value is only ever written by Stage B (runStageBAssessment), which no
// route calls any more, so requiring it would reject every closet item.
// Unassessed / pending items are instead screened live (the screening is the
// assessment), exactly as the single-garment route does.
//
// WHEN IT RUNS: only when a NEW chain attempt is about to start (no jobs yet,
// an explicit retry, or a dead last job that startFullLookOutfit will replace
// with a new attempt) — i.e. exactly when new FASHN credits could be spent.
// It must NOT run on the continuation POSTs of an in-flight, already-paid
// chain: failing the gate mid-chain would strand credits already spent.
//
// Catalog (non-closet) garments are out of scope here: their eligibility is
// enforced by the service layer's catalog rules, unchanged.
//
// FAIL CLOSED: a closet-backed item with no joined closet row, an unresolvable
// image, or an unavailable/failed screening all refuse the whole chain with no
// FASHN call.

import { isVtoCategoryAllowed } from "~/lib/ai/closet-eligibility";
import { screenGarmentSuitability, type GarmentSuitabilityResult } from "~/lib/image-suitability.server";
import { resolveItemImage } from "~/lib/styleme/look-image-resolution.server";
import type { SelectableOutfitItem } from "~/lib/ai/full-look-vto-orchestrator.server";
import type { CloudinaryConfig } from "~/lib/cloudinary-admin.server";

// Stage A outcomes that mean "this photo/category is known not usable".
const BLOCKED_STAGE_A: ReadonlySet<string> = new Set(["not-supported", "needs-clearer-photo"]);

export type FullLookGateFailureReason =
  | "unresolved_closet_item"
  | "category_not_allowed"
  | "photo_flagged"
  | "image_unresolved"
  | "unsuitable_image";

export type FullLookGateResult =
  | { ok: true; screened: number }
  | { ok: false; reason: FullLookGateFailureReason; label: string; subCode?: string };

type ScreenFn = (imageUrl: string, opts: { declaredCategory?: string }) => Promise<GarmentSuitabilityResult>;

export async function gateFullLookClosetGarments(args: {
  customerId: string;
  chosenItems: readonly SelectableOutfitItem[];
  cloudinaryConfig: CloudinaryConfig | null;
  screen?: ScreenFn;
}): Promise<FullLookGateResult> {
  const screen: ScreenFn = args.screen ?? ((url, opts) => screenGarmentSuitability(url, opts));
  const closetBacked = args.chosenItems.filter((i) => !!i.closetItemId);
  const labelOf = (i: SelectableOutfitItem) => i.productTitle ?? i.closetItem?.name ?? i.itemType;

  // Cheap, synchronous checks first so an obviously-ineligible piece never
  // costs a vision call.
  const prepared: { item: SelectableOutfitItem; url: string; category: string | undefined }[] = [];
  for (const item of closetBacked) {
    const ci = item.closetItem;
    if (!ci) return { ok: false, reason: "unresolved_closet_item", label: labelOf(item) };
    if (!isVtoCategoryAllowed(ci.category ?? "", ci.subcategory ?? null)) {
      return { ok: false, reason: "category_not_allowed", label: labelOf(item) };
    }
    if (ci.tryOnEligibility && BLOCKED_STAGE_A.has(ci.tryOnEligibility)) {
      return { ok: false, reason: "photo_flagged", label: labelOf(item) };
    }
    const url = resolveItemImage(item, { customerId: args.customerId, cloudinaryConfig: args.cloudinaryConfig });
    if (!url) return { ok: false, reason: "image_unresolved", label: labelOf(item) };
    prepared.push({ item, url, category: ci.category ?? undefined });
  }

  const results = await Promise.all(
    prepared.map(async (p) => {
      try {
        return await screen(p.url, { declaredCategory: p.category });
      } catch {
        // Screening threw: treat as not-passed (fail closed).
        return { status: "RETRY_IMAGE", subCode: "assessment_failed" } as GarmentSuitabilityResult;
      }
    }),
  );
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "PASS") {
      return { ok: false, reason: "unsuitable_image", label: labelOf(prepared[i].item), subCode: "subCode" in r ? r.subCode : undefined };
    }
  }
  return { ok: true, screened: prepared.length };
}
