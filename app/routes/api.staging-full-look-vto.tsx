// app/routes/api.staging-full-look-vto.tsx
// STAGING QA PROTOTYPE — full-look multi-product Try-On Max.
// generation_mode "balanced" is a deliberate QA choice, not FASHN-attributed.
//
// POST /api/staging-full-look-vto
//
// Given a persisted OutfitSuggestion, resolves all item images, builds a
// composite product image, calls FASHN tryon-max with the composite + prompt,
// and returns the raw result for manual inspection.
//
// Safety:
//   - Blocked in production (VERCEL_ENV guard).
//   - Requires authenticated customer.
//   - Requires per-generation VTO consent (same 15-min window as single-item flow).
//   - Customer may only access their own OutfitSuggestions.
//   - No VirtualTryOnJob DB record is created.
//   - No Cloudinary storage — result is returned in-memory only.
//   - Existing single-item VTO is completely untouched.
//
// Note: This route runs a full synchronous FASHN poll loop (up to 90 s).
// On Vercel the default function timeout is 60 s — set maxDuration in vercel.json
// or use a non-Vercel environment for QA tests longer than ~55 s.

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  loadNaiaModel,
  computeModelReadinessFromRecord,
} from "~/lib/ai/my-naia-model.server";
import { downloadModelPhotoAsDataUrl } from "~/lib/ai/fashn-tryon-service.server";
import {
  getCloudinaryConfig,
  buildPrivateDownloadUrl,
} from "~/lib/cloudinary-admin.server";
import {
  buildCompositeProductImage,
  buildFullLookPrompt,
  type CompositeSlot,
} from "~/lib/ai/full-look-composite.server";
import prisma from "~/db.server";
import type { OutfitItemType } from "@prisma/client";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_CONSENT_AGE_MS = 15 * 60 * 1_000;
const FASHN_BASE = "https://api.fashn.ai";
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_ATTEMPTS = 45; // 90 s ceiling

// ── Helpers ───────────────────────────────────────────────────────────────────

function stagingOnly() {
  return data(
    { ok: false, code: "staging_only", message: "This endpoint is not available in production." },
    { status: 403 },
  );
}

function badRequest(code: string, message: string) {
  return data({ ok: false, code, message }, { status: 400 });
}

function serverError(message: string) {
  return data({ ok: false, code: "server_error", message }, { status: 500 });
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader() {
  return data({ error: "method_not_allowed" }, { status: 405 });
}

// ── Action ────────────────────────────────────────────────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  // ── 0. Staging guard ─────────────────────────────────────────────────────
  // NAIA_PROJECT_VARIANT is set to "staging" on naia-stylist-staging only.
  // VERCEL_ENV is "production" on both the real project AND promoted staging
  // deployments, so it is not a reliable discriminator.
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") return stagingOnly();

  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return data({ ok: false, code: "auth_required" }, { status: 401 });
  }

  // ── 2. Parse body ────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid_request", "Request body must be JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return badRequest("invalid_request", "Request body must be a JSON object.");
  }
  const { suggestionId: rawSuggestionId, virtualTryOnConsentAt: rawConsentAt } =
    body as Record<string, unknown>;

  if (typeof rawSuggestionId !== "string" || rawSuggestionId.trim().length === 0) {
    return badRequest("invalid_request", "suggestionId is required.");
  }
  const suggestionId = rawSuggestionId.trim();

  // ── 3. Consent ───────────────────────────────────────────────────────────
  if (typeof rawConsentAt !== "string" || rawConsentAt.length === 0) {
    return badRequest("consent_required", "virtualTryOnConsentAt is required.");
  }
  const consentAt = new Date(rawConsentAt);
  if (isNaN(consentAt.getTime())) {
    return badRequest("consent_required", "Invalid consent timestamp.");
  }
  const consentAge = Date.now() - consentAt.getTime();
  if (consentAge < 0 || consentAge > MAX_CONSENT_AGE_MS) {
    return badRequest("consent_expired", "Consent has expired. Please try again.");
  }

  // ── 4. NaiaModel ─────────────────────────────────────────────────────────
  const naiaModel = await loadNaiaModel(customer.id);
  if (!naiaModel) {
    return badRequest("model_not_configured", "Set up your nAia Model first.");
  }
  const readiness = computeModelReadinessFromRecord(naiaModel);
  if (!readiness.hasFullBodyPhoto || !readiness.isReadyForTryOn) {
    return badRequest("model_not_ready", "nAia Model not ready for try-on.");
  }

  // ── 5. Download model photo ───────────────────────────────────────────────
  const modelPhotoResult = await downloadModelPhotoAsDataUrl(
    naiaModel.bodyPublicId as string,
    naiaModel.bodyFormat,
    naiaModel.deliveryType,
  );
  if (!modelPhotoResult.ok) {
    return serverError("Could not load model photo.");
  }
  const modelImageDataUrl = modelPhotoResult.dataUrl;

  // ── 6. Load OutfitSuggestion → OutfitItems ───────────────────────────────
  const suggestion = await prisma.outfitSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      session: { select: { customerId: true } },
      items: {
        include: {
          closetItem: {
            select: {
              id: true,
              imagePublicId: true,
              imageFormat: true,
              name: true,
              primaryColor: true,
            },
          },
        },
      },
    },
  });

  if (!suggestion || suggestion.session.customerId !== customer.id) {
    return badRequest("not_found", "Outfit suggestion not found.");
  }

  // ── 7. Resolve image URLs for each item ──────────────────────────────────
  const cfg = getCloudinaryConfig();
  const slots: CompositeSlot[] = [];
  const skipped: string[] = [];

  for (const item of suggestion.items) {
    const typeLabel = itemTypeLabel(item.itemType as OutfitItemType, item.productTitle, item.closetItem);

    if (item.closetItem) {
      if (!item.closetItem.imagePublicId || !item.closetItem.imageFormat) {
        skipped.push(`${item.itemType} (no closet image)`);
        continue;
      }
      if (!cfg) {
        return serverError("Cloudinary not configured.");
      }
      const signedUrl = buildPrivateDownloadUrl(
        cfg,
        item.closetItem.imagePublicId,
        item.closetItem.imageFormat,
        "private",
      );
      slots.push({ imageUrl: signedUrl, label: typeLabel, itemType: item.itemType as OutfitItemType });
    } else if (item.productImageUrl) {
      slots.push({ imageUrl: item.productImageUrl, label: typeLabel, itemType: item.itemType as OutfitItemType });
    } else {
      skipped.push(`${item.itemType} (no image URL)`);
    }
  }

  if (slots.length === 0) {
    return badRequest("no_images", "No item images could be resolved for this suggestion.");
  }

  // ── 8. Build composite product image ─────────────────────────────────────
  let compositeDataUrl: string;
  try {
    compositeDataUrl = await buildCompositeProductImage(slots);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError(`Composite image failed: ${msg}`);
  }

  // ── 9. Build prompt ───────────────────────────────────────────────────────
  const prompt = buildFullLookPrompt(slots);

  // ── 10. Submit to FASHN tryon-max ─────────────────────────────────────────
  const apiKey = process.env.FASHN_API_KEY;
  if (!apiKey) return serverError("FASHN not configured.");

  let predictionId: string;
  try {
    const runRes = await fetch(`${FASHN_BASE}/v1/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_name: "tryon-max",
        inputs: {
          model_image: modelImageDataUrl,
          product_image: compositeDataUrl,
          prompt,
          return_base64: true,
          output_format: "png",
          resolution: "1k",
          generation_mode: "balanced",
          num_images: 1,
        },
      }),
    });
    if (!runRes.ok) {
      return serverError(`FASHN rejected request: ${runRes.status}`);
    }
    const runBody = (await runRes.json()) as { id?: string; error?: string };
    if (runBody.error || !runBody.id) {
      return serverError(`FASHN error: ${runBody.error ?? "no prediction ID"}`);
    }
    predictionId = runBody.id;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return serverError(`FASHN submission failed: ${msg}`);
  }

  // ── 11. Poll for completion ───────────────────────────────────────────────
  type FashnStatus = "starting" | "in_queue" | "processing" | "completed" | "failed" | "canceled";
  interface FashnStatusBody { status: FashnStatus; output?: string[]; error?: string }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let statusBody: FashnStatusBody;
    try {
      const statusRes = await fetch(`${FASHN_BASE}/v1/status/${predictionId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!statusRes.ok) return serverError(`FASHN poll error: ${statusRes.status}`);
      statusBody = (await statusRes.json()) as FashnStatusBody;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return serverError(`FASHN poll failed: ${msg}`);
    }

    if (statusBody.status === "completed") {
      const outputs = statusBody.output;
      if (!Array.isArray(outputs) || outputs.length === 0 || typeof outputs[0] !== "string") {
        return serverError("FASHN completed but returned no output.");
      }
      return data({
        ok: true,
        predictionId,
        itemCount: slots.length,
        items: slots.map((s) => ({ itemType: s.itemType, label: s.label })),
        skipped,
        prompt,
        outputDataUrl: outputs[0],
      });
    }

    if (statusBody.status === "failed" || statusBody.status === "canceled") {
      return serverError(`FASHN generation ${statusBody.status}: ${statusBody.error ?? ""}`);
    }
  }

  return serverError(`FASHN timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000} s. predictionId: ${predictionId}`);
}

// ── Label helper ──────────────────────────────────────────────────────────────

function itemTypeLabel(
  itemType: OutfitItemType,
  productTitle: string | null,
  closetItem: { name?: string | null; primaryColor?: string | null } | null,
): string {
  if (productTitle) return productTitle;
  if (closetItem) {
    const parts = [closetItem.primaryColor, closetItem.name].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
  }
  const fallbacks: Record<OutfitItemType, string> = {
    TOP: "top",
    BOTTOM: "bottom",
    DRESS: "dress",
    OUTERWEAR: "jacket",
    SHOES: "shoes",
    BAG: "bag",
    ACCESSORY: "accessory",
    JEWELRY: "jewellery",
  };
  return fallbacks[itemType] ?? "garment";
}
