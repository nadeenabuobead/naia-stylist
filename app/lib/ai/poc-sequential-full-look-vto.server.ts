// app/lib/ai/poc-sequential-full-look-vto.server.ts
//
// PROOF OF CONCEPT — NOT wired to any route, not imported by any customer-facing
// code. Exists only to let a human visually judge whether sequential FASHN
// chaining produces a convincing full-look result, before any backend,
// migration, or route work is approved.
//
// WHAT THIS IS. FASHN's tryon-max endpoint accepts exactly one product_image per
// call — there is no multi-garment endpoint. The only way to layer garments
// (e.g. a blazer over a top) is to call it once per garment, feeding each
// result's output back in as the next call's model image. This module is that
// chain, built entirely from the existing, trusted single-garment primitives:
//   - runFashnTryOn (./fashn-try-on.server.ts) — already hardcodes
//     generation_mode:"fast", resolution:"1k", num_images:1. This module does
//     not set those parameters itself; it inherits them by calling that
//     function, so there is no separate place they could drift from "fast/1k".
//   - closetItemToSlot (./closet-slot.ts) — the existing category→slot
//     vocabulary, reused here to decide layering order (base → top →
//     outerwear) rather than inventing new classification logic.
//
// CREDIT USE. Each step is one runFashnTryOn call = one FASHN prediction.
// FASHN does not bill failed predictions, so the ceiling is exactly
// MAX_CHAIN_LENGTH credits for a fully successful chain, and strictly fewer
// if any step fails (the chain halts immediately — it never attempts a step
// after a failure). MAX_CHAIN_LENGTH is 3, enforced in code below, not just
// documented here — a caller cannot accidentally submit a longer chain and
// spend more than 3 credits through this module.
//
// PRIVACY. This module sends whatever modelImageDataUrl it is given to
// FASHN's servers, exactly like the production single-garment path. It must
// only ever be invoked with an authorised test model photo and test garment
// images supplied by a human for this explicit purpose — never a real
// customer's photo. This file cannot and does not source or fabricate test
// images itself.
//
// APPROVAL GATE. Nothing in this module calls FASHN with real credentials by
// itself — it is a pure orchestration function over an injected call. A real,
// paid run requires a separate, explicit go-ahead before any script invokes
// this with live _fetch/_getApiKey.

import { runFashnTryOn, type RunTryOnOptions } from "./fashn-try-on.server.js";
import { closetItemToSlot } from "./closet-slot.js";
import type { OutfitSlot } from "./styleme-recommendation.types.js";
import type { VirtualTryOnConsent, VirtualTryOnResult } from "./virtual-try-on.types.js";

// ── Hard cap ──────────────────────────────────────────────────────────────────
// 3 garments (trousers + top + blazer) is the POC's own scope. Enforced, not
// just documented, so this module can never be the thing that silently runs
// up a larger bill than planned.
export const MAX_CHAIN_LENGTH = 3;

// Only these slots are meaningful to a visual layering chain. Anything else
// (shoe/bag/accessory/jewelry/unknown) isn't something FASHN's model-image
// try-on renders onto the body in a layered way, so it is excluded rather
// than silently mis-ordered.
const LAYER_ORDER: Partial<Record<OutfitSlot, number>> = {
  dress: 0,
  set: 0,
  bottom: 0,
  top: 1,
  outerwear: 2,
};

export interface SequentialTryOnGarmentInput {
  // Human-readable identifier for a test garment — a POC label, never a real
  // catalog handle or a real customer's closet item id.
  label: string;
  category: string;
  subcategory?: string | null;
  productImageUrl: string;
}

interface ResolvedGarment extends SequentialTryOnGarmentInput {
  slot: OutfitSlot;
}

export interface SequentialTryOnStepResult {
  stepIndex: number; // 0-based position in the chain actually run
  garment: SequentialTryOnGarmentInput;
  slot: OutfitSlot;
  result: VirtualTryOnResult;
}

export type SequentialTryOnReport =
  | {
      ok: true;
      steps: SequentialTryOnStepResult[];
      skipped: SequentialTryOnGarmentInput[];
      finalImageDataUrl: string;
      creditsUsed: number;
    }
  | {
      ok: false;
      reason: "TOO_MANY_GARMENTS" | "SLOT_CONFLICT" | "NO_ELIGIBLE_GARMENTS" | "STEP_FAILED";
      steps: SequentialTryOnStepResult[];
      skipped: SequentialTryOnGarmentInput[];
      failedStepIndex?: number;
      detail?: string;
      creditsUsed: number;
    };

/**
 * Resolves each garment's layering slot, drops slots that aren't part of the
 * visual chain, and reports the first slot claimed by more than one garment
 * (e.g. two tops) — mirrors findConflictingSlot's "fail closed on the whole
 * set, not a silent pick" convention from the single-garment WI handoff.
 */
function resolveAndOrder(
  garments: SequentialTryOnGarmentInput[],
): { ordered: ResolvedGarment[]; skipped: SequentialTryOnGarmentInput[]; conflictSlot: OutfitSlot | null } {
  const skipped: SequentialTryOnGarmentInput[] = [];
  const eligible: ResolvedGarment[] = [];

  for (const g of garments) {
    const slot = closetItemToSlot(g.category, g.subcategory);
    if (LAYER_ORDER[slot] === undefined) {
      skipped.push(g);
      continue;
    }
    eligible.push({ ...g, slot });
  }

  const counts = new Map<OutfitSlot, number>();
  for (const g of eligible) counts.set(g.slot, (counts.get(g.slot) ?? 0) + 1);
  let conflictSlot: OutfitSlot | null = null;
  for (const [slot, count] of counts) {
    if (count > 1) {
      conflictSlot = slot;
      break;
    }
  }

  const ordered = eligible
    .slice()
    .sort((a, b) => (LAYER_ORDER[a.slot] as number) - (LAYER_ORDER[b.slot] as number));

  return { ordered, skipped, conflictSlot };
}

export interface RunSequentialFullLookTryOnArgs {
  customerId: string;
  initialModelImageDataUrl: string;
  garments: SequentialTryOnGarmentInput[];
  consent: VirtualTryOnConsent;
  productHandlePrefix?: string; // for logging/diagnostics only; defaults to "poc"
}

/**
 * Sequentially applies each eligible garment to the model image, body-outward
 * (base layer → top → outerwear), feeding each successful step's output
 * forward as the next step's input. Halts on the first failure — it never
 * attempts a later step once an earlier one has failed, so credit use never
 * exceeds the number of steps actually attempted.
 */
export async function runSequentialFullLookTryOn(
  args: RunSequentialFullLookTryOnArgs,
  tryOnOptions: RunTryOnOptions = {},
): Promise<SequentialTryOnReport> {
  const { customerId, initialModelImageDataUrl, garments, consent } = args;
  const prefix = args.productHandlePrefix ?? "poc";

  if (garments.length > MAX_CHAIN_LENGTH) {
    return {
      ok: false,
      reason: "TOO_MANY_GARMENTS",
      steps: [],
      skipped: [],
      detail: `received ${garments.length} garments, max is ${MAX_CHAIN_LENGTH}`,
      creditsUsed: 0,
    };
  }

  const { ordered, skipped, conflictSlot } = resolveAndOrder(garments);

  if (conflictSlot !== null) {
    return {
      ok: false,
      reason: "SLOT_CONFLICT",
      steps: [],
      skipped,
      detail: `more than one garment resolved to the "${conflictSlot}" slot`,
      creditsUsed: 0,
    };
  }

  if (ordered.length === 0) {
    return {
      ok: false,
      reason: "NO_ELIGIBLE_GARMENTS",
      steps: [],
      skipped,
      creditsUsed: 0,
    };
  }

  const steps: SequentialTryOnStepResult[] = [];
  let currentModelImage = initialModelImageDataUrl;

  for (let i = 0; i < ordered.length; i++) {
    const garment = ordered[i];
    const result = await runFashnTryOn(
      {
        customerId,
        modelImageDataUrl: currentModelImage,
        productImageUrl: garment.productImageUrl,
        productHandle: `${prefix}-${garment.label}`,
        consent,
      },
      tryOnOptions,
    );

    steps.push({ stepIndex: i, garment, slot: garment.slot, result });

    if (!result.ok) {
      return {
        ok: false,
        reason: "STEP_FAILED",
        steps,
        skipped,
        failedStepIndex: i,
        detail: `step ${i} (${garment.label}, slot "${garment.slot}") failed: ${result.code}`,
        creditsUsed: steps.length - 1, // this failed step is not billed by FASHN
      };
    }

    currentModelImage = result.outputDataUrl;
  }

  const last = steps[steps.length - 1].result;
  // Narrowed by the loop above: every step here is ok:true.
  const finalImageDataUrl = (last as { ok: true; outputDataUrl: string }).outputDataUrl;

  return {
    ok: true,
    steps,
    skipped,
    finalImageDataUrl,
    creditsUsed: steps.length,
  };
}
