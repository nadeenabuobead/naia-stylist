import { createHash } from "node:crypto";
import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher, useRevalidator, Link } from "react-router";
import { data, redirect, type LoaderFunctionArgs, type ActionFunctionArgs, type LinksFunction } from "react-router";
import prisma from "../db.server";
import { requireCurrentNaiaCustomer, getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { assessClosetEligibility, CLOSET_ELIGIBILITY_DISPLAY, type ClosetTryOnEligibility } from "~/lib/ai/closet-eligibility";
import { emitClosetItemAdded, recordJourneyEventAwaited } from "~/lib/ai/journey-events.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";
import { verifyCloudinaryAsset, deleteCloudinaryAsset, buildPrivateDownloadUrl, getCloudinaryConfig, validatePublicIdOwnership } from "~/lib/cloudinary-admin.server";
import { computeClosetInsights, type ClosetInsightProfile } from "~/lib/ai/closet-insights";
import { moderateImageContent } from "~/lib/image-moderation.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";

// Option B shell: MyNaiaLayout + naiaStyles (NADINE header, My nAia navigation)
export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const CATEGORIES = ["TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "SHOES", "BAGS", "ACCESSORIES", "JEWELRY", "OTHER"];
const COLORS = ["Black", "White", "Beige", "Brown", "Grey", "Navy", "Blue", "Green", "Red", "Pink", "Purple", "Yellow", "Orange", "Gold", "Silver", "Multicolor"];
const OCCASIONS = ["Casual", "Work", "Dinner", "Party", "Formal", "Date", "Weekend", "Travel"];
const SEASONS = ["Spring", "Summer", "Fall", "Winter", "All Season"];
const PATTERNS = ["Solid", "Stripes", "Floral", "Plaid", "Animal Print", "Geometric", "Abstract", "Other"];

const GENERAL_PHOTO_TIPS = [
  "Photograph one item only",
  "Use a plain, contrasting background",
  "Use bright, even lighting",
  "Keep the image sharp and in focus",
  "Make sure the entire item is visible",
  "Do not crop any important part",
  "Avoid hands, people, clutter or other items covering it",
];

const CATEGORY_PHOTO_TIPS: Record<string, { title: string; tips: string[] }> = {
  TOPS:      { title: "For clothing", tips: ["Lay it flat or hang it straight", "Show the full neckline, sleeves, waist and hem", "Do not fold or bunch the garment"] },
  BOTTOMS:   { title: "For clothing", tips: ["Lay it flat or hang it straight", "Show the full waistband and hem", "Do not fold or bunch the garment"] },
  DRESSES:   { title: "For clothing", tips: ["Hang or lay fully flat", "Show the full neckline, sleeves, waist and hem", "Do not fold or bunch the garment"] },
  OUTERWEAR: { title: "For clothing", tips: ["Lay flat or hang straight", "Show the full collar, sleeves and hem", "Do not fold or bunch the garment"] },
  SHOES:     { title: "For shoes",    tips: ["Show the full pair", "Keep both shoes visible and unobstructed", "Do not photograph while worn", "Use a clear side or three-quarter view"] },
  BAGS:      { title: "For bags",     tips: ["Show the complete bag", "Keep handles and straps fully visible", "Use a front or three-quarter view", "Remove anything covering its shape"] },
};

function eligibilityStatus(elig: ClosetTryOnEligibility | null, hint: string | null) {
  if (!elig) return null;
  const display = CLOSET_ELIGIBILITY_DISPLAY[elig];
  return { label: display.label, hint: hint || display.fallbackHint, isNeeds: elig === "needs-clearer-photo" };
}

// ── Server-side upload validation helpers ─────────────────────────────────────

function extractCloudinaryPublicId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    // Path: /{cloud}/image/{deliveryType}/[v{version}/]{public_id}.{ext}
    const match = pathname.match(
      /\/image\/(?:private|upload|authenticated)\/(?:v\d+\/)?(.+)\.[a-z0-9]+$/i,
    );
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// Checks first 12 bytes of a fetched buffer for known image file signatures.
function detectImageFormatFromBytes(header: Uint8Array): string | null {
  if (header.length < 4) return null;
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return "jpeg";
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) return "png";
  if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) return "gif";
  if (
    header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
    header.length >= 12 &&
    header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50
  ) return "webp";
  if (header.length >= 8 && header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70) return "heic";
  return null;
}

export function meta() {
  return [{ title: "Digital Closet | nAia" }];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const naiaCustomer = await requireCurrentNaiaCustomer(request);
  const customer = await prisma.customer.findUnique({
    where: { id: naiaCustomer.id },
    include: {
      closetItems: { orderBy: { createdAt: "desc" } },
      onboardingProfile: true,
    },
  });
  if (!customer) return redirect("/auth/shopify/login");

  // Generate signed display URLs for all private closet items (local HMAC, no network).
  // Legacy items with imageUrl (public delivery) retain their imageUrl as fallback.
  const cfg = getCloudinaryConfig();
  const items = customer.closetItems.map((item) => {
    let displayImageUrl: string | null = null;
    if (item.imagePublicId && item.imageFormat && cfg) {
      displayImageUrl = buildPrivateDownloadUrl(cfg, item.imagePublicId, item.imageFormat, "private");
    } else if (item.imageUrl) {
      displayImageUrl = item.imageUrl;
    }
    return { ...item, displayImageUrl };
  });

  const insightItems = items.map((item) => ({
    id: item.id,
    category: item.category as string,
    primaryColor: item.primaryColor,
    occasions: item.occasions.length > 0 ? item.occasions : null,
    seasons: item.seasons.length > 0 ? item.seasons : null,
  }));
  const insightProfile: ClosetInsightProfile | null = customer.onboardingProfile
    ? {
        lifestyle: customer.onboardingProfile.lifestyle,
        styleStruggles: customer.onboardingProfile.styleStruggles,
        styleSupport: customer.onboardingProfile.styleSupport,
        favoriteColors: customer.onboardingProfile.favoriteColors,
        avoidColors: customer.onboardingProfile.avoidColors,
        stylePersonalities: customer.onboardingProfile.stylePersonalities,
        desiredImpression: customer.onboardingProfile.desiredImpression,
        desiredFeelings: customer.onboardingProfile.desiredFeelings,
        becoming: customer.onboardingProfile.becoming,
      }
    : null;
  const closetInsights = computeClosetInsights(insightItems, insightProfile);

  return data({ items, closetInsights });
}

export async function action({ request }: ActionFunctionArgs) {
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) return data({ error: "Not authenticated" }, { status: 401 });
  const customer = await prisma.customer.findUnique({ where: { id: naiaCustomer.id } });
  if (!customer) return data({ error: "Not authenticated" }, { status: 401 });

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const name = formData.get("name") as string;
    const category = formData.get("category") as string;
    const publicId = (formData.get("publicId") as string)?.trim();
    const primaryColor = formData.get("primaryColor") as string;
    const pattern = formData.get("pattern") as string;
    const brand = formData.get("brand") as string;
    const occasions = JSON.parse((formData.get("occasions") as string) || "[]");
    const seasons = JSON.parse((formData.get("seasons") as string) || "[]");
    if (!name || !category) return data({ error: "Name and category required" }, { status: 400 });
    if (!publicId) return data({ error: "Image upload reference required." }, { status: 400 });

    // ── Server-side upload validation ─────────────────────────────────────────
    // All checks run BEFORE any DB write. Rejected uploads have their Cloudinary
    // asset deleted so orphaned assets do not accumulate in storage.

    // 1. Ownership check — publicId must belong to the authenticated customer's folder.
    const ownership = validatePublicIdOwnership(publicId, customer.id);
    if (!ownership.ok) {
      return data({ error: ownership.error }, { status: 400 });
    }

    // 2. Verify via Cloudinary Admin API — authoritative format/bytes/dimensions.
    const verify = await verifyCloudinaryAsset(publicId, "private");
    if (!verify.ok) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: "Image could not be verified. Please upload again." }, { status: 400 });
    }

    const serverFormat = verify.asset.format.toLowerCase();
    const serverBytes  = verify.asset.bytes;
    const serverWidth  = verify.asset.width;
    const serverHeight = verify.asset.height;

    if (verify.asset.type !== "private") {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: "Image must be uploaded via the app." }, { status: 400 });
    }
    if (verify.asset.resourceType !== "image") {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: "Uploaded file must be an image." }, { status: 400 });
    }

    // 3. Format allowlist — derived from Admin API, not client-provided value.
    const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
    if (!ALLOWED_FORMATS.has(serverFormat)) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `File type "${serverFormat}" is not accepted. Use JPG, PNG, WEBP, or HEIC.` }, { status: 400 });
    }

    // 4. File-size cap — from Admin API, not client-reported bytes.
    const SERVER_MAX_BYTES = 5 * 1024 * 1024;
    if (serverBytes > SERVER_MAX_BYTES) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image is too large (${(serverBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.` }, { status: 400 });
    }

    // 5. Dimension bounds — from Admin API, not client form data.
    const MIN_DIM = 200;
    const MAX_DIM = 8000;
    if (serverWidth !== null && serverWidth < MIN_DIM) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image width (${serverWidth} px) is below the minimum of ${MIN_DIM} px.` }, { status: 400 });
    }
    if (serverHeight !== null && serverHeight < MIN_DIM) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image height (${serverHeight} px) is below the minimum of ${MIN_DIM} px.` }, { status: 400 });
    }
    if (serverWidth !== null && serverWidth > MAX_DIM) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image width (${serverWidth} px) exceeds the maximum of ${MAX_DIM} px.` }, { status: 400 });
    }
    if (serverHeight !== null && serverHeight > MAX_DIM) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: `Image height (${serverHeight} px) exceeds the maximum of ${MAX_DIM} px.` }, { status: 400 });
    }

    // 6. Server-side magic-byte check.
    const cfg = getCloudinaryConfig();
    if (!cfg) {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: "Image service is not configured. Please try again." }, { status: 503 });
    }
    const downloadUrl = buildPrivateDownloadUrl(cfg, publicId, serverFormat, "private");
    try {
      const byteRes = await fetch(downloadUrl, {
        headers: { Range: "bytes=0-11" },
        signal: AbortSignal.timeout(15000),
      });
      if (byteRes.ok) {
        const buf = await byteRes.arrayBuffer();
        const header = new Uint8Array(buf);
        if (!detectImageFormatFromBytes(header)) {
          await deleteCloudinaryAsset(publicId, "private");
          return data({ error: "File signature does not match a supported image format." }, { status: 400 });
        }
      }
    } catch {
      await deleteCloudinaryAsset(publicId, "private");
      return data({ error: "Image verification timed out. Please try again." }, { status: 400 });
    }

    // ── Layer 2: Global content safety moderation ──────────────────────────
    const moderation = await moderateImageContent(downloadUrl);
    if (moderation.status === "MODERATION_UNAVAILABLE") {
      await deleteCloudinaryAsset(publicId, "private");
      // Minimal audit log — no publicId, no URL, no image data.
      try {
        await prisma.journeyEvent.create({
          data: {
            type: "image_moderation_unavailable",
            occurredAt: new Date(),
            customerIdHash: createHash("sha256").update(customer.id).digest("hex").slice(0, 16),
            sessionId: "closet",
            payload: { feature: "closet" },
          },
        });
      } catch { /* audit failure never blocks */ }
      return data({ error: "Image review is temporarily unavailable. Please try again." }, { status: 503 });
    }
    if (moderation.status === "SAFETY_REJECT") {
      await deleteCloudinaryAsset(publicId, "private");
      // Minimal audit log — no publicId, no URL, no image data.
      try {
        await prisma.journeyEvent.create({
          data: {
            type: "image_safety_reject",
            occurredAt: new Date(),
            customerIdHash: createHash("sha256").update(customer.id).digest("hex").slice(0, 16),
            sessionId: "closet",
            payload: { feature: "closet", reasonCode: moderation.reasonCode },
          },
        });
      } catch { /* audit failure never blocks */ }
      return data({ error: "Photo could not be accepted. Please use a clothing photo." }, { status: 422 });
    }

    // ── Layer 3: Garment suitability ───────────────────────────────────────
    const suitability = await screenGarmentSuitability(downloadUrl, { declaredCategory: category });
    const GARMENT_GUIDANCE: Record<string, string> = {
      no_garment_visible: "No clothing item was detected. Please upload a photo of a single garment.",
      image_too_blurry: "Photo is too blurry. Please try a clearer photo.",
      garment_excessively_cropped: "The garment is too cropped. Please ensure the full item is visible.",
      multiple_items_ambiguous: "Multiple items detected. Please photograph one item at a time.",
      color_indeterminate: "The colour of this item is unclear in the photo.",
      category_mismatch: "The item in the photo does not match the selected category.",
      item_not_identifiable: "The item could not be identified. Please try a clearer photo.",
      assessment_failed: "Image assessment is temporarily unavailable. Please try again.",
    };
    if (suitability.status === "RETRY_IMAGE") {
      await deleteCloudinaryAsset(publicId, "private");
      const msg = GARMENT_GUIDANCE[(suitability as { status: "RETRY_IMAGE"; subCode: string }).subCode]
        ?? "Please upload a clearer photo of a single fashion item.";
      return data({ error: msg }, { status: 422 });
    }
    if (suitability.status === "NEEDS_CLARIFICATION") {
      // Item is usable but needs clarification — proceed but surface the guidance.
      // (Do not block; subCode is informational.)
    }
    // ──────────────────────────────────────────────────────────────────────────

    const stageA = assessClosetEligibility({
      prismaCategory: category,
      width: serverWidth ?? undefined,
      height: serverHeight ?? undefined,
      format: serverFormat,
      bytes: serverBytes,
    });

    const newItem = await prisma.closetItem.create({
      data: {
        customer: { connect: { id: customer.id } },
        name,
        category,
        imageUrl: null,                // private upload — null for new records
        imagePublicId: publicId,
        imageFormat: serverFormat,
        primaryColor: primaryColor || null,
        pattern: pattern || null,
        brand: brand || null,
        occasions: occasions.length > 0 ? occasions : [],
        seasons: seasons.length > 0 ? seasons : [],
        tryOnEligibility: stageA.eligible,
        tryOnAssessedAt: new Date(stageA.assessedAt),
        tryOnCustomerHint: stageA.customerHint,
        tryOnInternalNote: stageA.internalNote,
      },
    });

    try {
      await recordJourneyEventAwaited(
        emitClosetItemAdded({ customerId: customer.id, closetItemId: newItem.id, category: newItem.category, tryOnEligibility: newItem.tryOnEligibility ?? null }),
        `closet_item_added:${newItem.id}:v1`,
      );
    } catch { /* event emission never blocks the response */ }

    // Stage B runs through the dedicated /api/closet-assess endpoint after the response
    // is sent — not as fire-and-forget background work inside this action.
    const pendingAssessment = stageA.eligible === "pending-assessment" && !!newItem.imagePublicId;
    return data({ success: true, pendingAssessment, itemId: pendingAssessment ? newItem.id : undefined });
  }

  if (intent === "delete") {
    const itemId = formData.get("itemId") as string;
    const deleted = await prisma.closetItem.deleteMany({ where: { id: itemId, customerId: customer.id } });
    if (deleted.count === 0) return data({ error: "Item not found" }, { status: 403 });
    return data({ success: true });
  }

  if (intent === "edit") {
    const itemId    = (formData.get("itemId")      as string)?.trim();
    const name      = (formData.get("name")        as string)?.trim();
    const category  = (formData.get("category")    as string)?.trim();
    const primaryColor = (formData.get("primaryColor") as string)?.trim();
    const newPublicId  = (formData.get("newPublicId")  as string)?.trim();

    if (!itemId || !name || !category) {
      return data({ error: "Item ID, name, and category are required." }, { status: 400 });
    }

    const existing = await prisma.closetItem.findUnique({ where: { id: itemId } });
    if (!existing || existing.customerId !== customer.id) {
      return data({ error: "Item not found." }, { status: 404 });
    }

    // Meta-only edit — no photo replacement requested.
    if (!newPublicId) {
      await prisma.closetItem.update({
        where: { id: itemId },
        data: { name, category, primaryColor: primaryColor || null },
      });
      return data({ success: true });
    }

    // ── Photo replacement: full security pipeline (mirrors "add") ─────────────

    // 1. Ownership check — newPublicId must be in the customer's folder.
    const ownership = validatePublicIdOwnership(newPublicId, customer.id);
    if (!ownership.ok) {
      return data({ error: ownership.error }, { status: 400 });
    }

    // 2. Verify via Cloudinary Admin API.
    const verify = await verifyCloudinaryAsset(newPublicId, "private");
    if (!verify.ok) {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: "Image could not be verified. Please upload again." }, { status: 400 });
    }

    const editAsset   = verify.asset;
    const editFormat  = editAsset.format.toLowerCase();
    const editBytes   = editAsset.bytes;
    const editWidth   = editAsset.width;
    const editHeight  = editAsset.height;

    if (editAsset.type !== "private") {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: "Image must be uploaded via the app." }, { status: 400 });
    }
    if (editAsset.resourceType !== "image") {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: "Uploaded file must be an image." }, { status: 400 });
    }

    // 3. Format allowlist.
    const EDIT_ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif"]);
    if (!EDIT_ALLOWED_FORMATS.has(editFormat)) {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: `File type "${editFormat}" is not accepted. Use JPG, PNG, WEBP, or HEIC.` }, { status: 400 });
    }

    // 4. File-size cap.
    if (editBytes > 5 * 1024 * 1024) {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: `Image is too large (${(editBytes / 1024 / 1024).toFixed(1)} MB). Maximum is 5 MB.` }, { status: 400 });
    }

    // 5. Dimension bounds.
    const EDIT_MIN_DIM = 200, EDIT_MAX_DIM = 8000;
    if (editWidth !== null && editWidth < EDIT_MIN_DIM) {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: `Image width (${editWidth} px) is below the minimum of ${EDIT_MIN_DIM} px.` }, { status: 400 });
    }
    if (editHeight !== null && editHeight < EDIT_MIN_DIM) {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: `Image height (${editHeight} px) is below the minimum of ${EDIT_MIN_DIM} px.` }, { status: 400 });
    }
    if (editWidth !== null && editWidth > EDIT_MAX_DIM) {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: `Image width (${editWidth} px) exceeds the maximum of ${EDIT_MAX_DIM} px.` }, { status: 400 });
    }
    if (editHeight !== null && editHeight > EDIT_MAX_DIM) {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: `Image height (${editHeight} px) exceeds the maximum of ${EDIT_MAX_DIM} px.` }, { status: 400 });
    }

    // 6. Magic-byte check.
    const editCfg = getCloudinaryConfig();
    if (!editCfg) {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: "Image service is not configured. Please try again." }, { status: 503 });
    }
    const editDownloadUrl = buildPrivateDownloadUrl(editCfg, newPublicId, editFormat, "private");
    try {
      const byteRes = await fetch(editDownloadUrl, {
        headers: { Range: "bytes=0-11" },
        signal: AbortSignal.timeout(15000),
      });
      if (byteRes.ok) {
        const buf = await byteRes.arrayBuffer();
        const header = new Uint8Array(buf);
        if (!detectImageFormatFromBytes(header)) {
          await deleteCloudinaryAsset(newPublicId, "private");
          return data({ error: "File signature does not match a supported image format." }, { status: 400 });
        }
      }
    } catch {
      await deleteCloudinaryAsset(newPublicId, "private");
      return data({ error: "Image verification timed out. Please try again." }, { status: 400 });
    }

    // ── Layer 2: Global content safety moderation ─────────────────────────────
    const editModeration = await moderateImageContent(editDownloadUrl);
    if (editModeration.status === "MODERATION_UNAVAILABLE") {
      await deleteCloudinaryAsset(newPublicId, "private");
      try {
        await prisma.journeyEvent.create({
          data: {
            type: "image_moderation_unavailable",
            occurredAt: new Date(),
            customerIdHash: createHash("sha256").update(customer.id).digest("hex").slice(0, 16),
            sessionId: "closet",
            payload: { feature: "closet_edit" },
          },
        });
      } catch { /* audit failure never blocks */ }
      return data({ error: "Image review is temporarily unavailable. Please try again." }, { status: 503 });
    }
    if (editModeration.status === "SAFETY_REJECT") {
      await deleteCloudinaryAsset(newPublicId, "private");
      try {
        await prisma.journeyEvent.create({
          data: {
            type: "image_safety_reject",
            occurredAt: new Date(),
            customerIdHash: createHash("sha256").update(customer.id).digest("hex").slice(0, 16),
            sessionId: "closet",
            payload: { feature: "closet_edit", reasonCode: editModeration.reasonCode },
          },
        });
      } catch { /* audit failure never blocks */ }
      return data({ error: "Photo could not be accepted. Please use a clothing photo." }, { status: 422 });
    }

    // ── Layer 3: Garment suitability ──────────────────────────────────────────
    const editSuitability = await screenGarmentSuitability(editDownloadUrl, { declaredCategory: category });
    const EDIT_GARMENT_GUIDANCE: Record<string, string> = {
      no_garment_visible:          "No clothing item was detected. Please upload a photo of a single garment.",
      image_too_blurry:            "Photo is too blurry. Please try a clearer photo.",
      garment_excessively_cropped: "The garment is too cropped. Please ensure the full item is visible.",
      multiple_items_ambiguous:    "Multiple items detected. Please photograph one item at a time.",
      color_indeterminate:         "The colour of this item is unclear in the photo.",
      category_mismatch:           "The item in the photo does not match the selected category.",
      item_not_identifiable:       "The item could not be identified. Please try a clearer photo.",
      assessment_failed:           "Image assessment is temporarily unavailable. Please try again.",
    };
    if (editSuitability.status === "RETRY_IMAGE") {
      await deleteCloudinaryAsset(newPublicId, "private");
      const msg = EDIT_GARMENT_GUIDANCE[(editSuitability as { status: "RETRY_IMAGE"; subCode: string }).subCode]
        ?? "Please upload a clearer photo of a single fashion item.";
      return data({ error: msg }, { status: 422 });
    }

    // All checks passed — compute eligibility then update DB.
    const editStageA = assessClosetEligibility({
      prismaCategory: category,
      width:  editWidth  ?? undefined,
      height: editHeight ?? undefined,
      format: editFormat,
      bytes:  editBytes,
    });

    // Capture old publicId before the update so we can delete it afterwards.
    const oldPublicId = existing.imagePublicId;

    const updatedItem = await prisma.closetItem.update({
      where: { id: itemId },
      data: {
        name,
        category,
        primaryColor: primaryColor || null,
        imageUrl: null,
        imagePublicId: newPublicId,
        imageFormat: editFormat,
        tryOnEligibility:  editStageA.eligible,
        tryOnAssessedAt:   new Date(editStageA.assessedAt),
        tryOnCustomerHint: editStageA.customerHint,
        tryOnInternalNote: editStageA.internalNote,
      },
    });

    // Delete old Cloudinary asset ONLY after the DB update succeeds.
    if (oldPublicId && oldPublicId !== newPublicId) {
      await deleteCloudinaryAsset(oldPublicId, "private");
    }

    // Stage B runs through the dedicated /api/closet-assess endpoint after the response
    // is sent — not as fire-and-forget background work inside this action.
    const editPendingAssessment = editStageA.eligible === "pending-assessment" && !!updatedItem.imagePublicId;
    return data({ success: true, pendingAssessment: editPendingAssessment, itemId: editPendingAssessment ? updatedItem.id : undefined });
  }

  return data({ error: "Unknown intent" }, { status: 400 });
}

// ── cl-* inline design system calibrated for the 880 px content column
//    inside MyNaiaLayout (sidebar 256 px + gap 64 px = 320 px consumed at 1280 px).
//    Lovable Option A reference used standalone cl-wrap = 1120 px inner width.
//    Proportions are scaled accordingly.
//
// Shell-level overrides (mn-page-head, mn-body, mn-page-sections) are scoped to
// this route's injected <style> tag — they only apply while this page is loaded.
const css = `
  /* ── Shell calibration: mn-body--compact handles top offset via naia-design-system.css.
     mn-page-sections gap collapses to zero — cl-* elements own their own spacing. */
  .mn-page-sections{gap:0}
  .mn-page-sections>.mn-back-link{display:block;margin-bottom:1.75rem}

  /* ── Option A cl-* page content — calibrated for 880 px column ── */
  /* Title: matches sp-shell-title exactly (naia-design-system.css). */
  .cl-headline{font-family:var(--naia-ff-display);font-size:clamp(24px,3.5vw,36px);font-weight:200;color:var(--naia-ink);line-height:1.05;margin-bottom:14px}
  /* Subtitle */
  .cl-sub{font-family:var(--ff-ui);font-size:10px;letter-spacing:3px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:28px}
  /* Stats — 3-col grid. Padding 20px (was 24px) to tighten card density. */
  .cl-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:28px}
  .cl-stat{background:var(--bg-50, var(--c-surface));padding:20px;border:1px solid var(--fg-10, var(--c-border))}
  .cl-stat-num{font-family:var(--ff-display);font-size:40px;font-weight:900;color:var(--fg, var(--c-ink))}
  .cl-stat-label{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted))}
  /* Add a Piece button — matches sp-btn-primary exactly (naia-design-system.css). */
  .cl-add-btn{display:inline-flex;align-items:center;align-self:flex-start;width:auto;padding:12px 28px;background:var(--naia-ink);color:var(--naia-bg);border:none;border-radius:9999px;margin-bottom:28px;cursor:pointer;font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2.5px;text-transform:uppercase;transition:opacity .13s}
  .cl-add-btn:hover{opacity:.8}
  .cl-add-btn:focus-visible{outline:2px solid var(--naia-ink);outline-offset:2px}
  .cl-add-btn:disabled{opacity:.45;cursor:not-allowed}
  /* Add to Wardrobe form */
  .cl-form{background:var(--bg-50, var(--c-panel));padding:32px;margin-bottom:28px;border:1px solid var(--fg-10, var(--c-border))}
  .cl-form-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
  .cl-form-title{font-family:var(--ff-display);font-size:24px;font-weight:900;font-style:italic;color:var(--fg, var(--c-ink))}
  .cl-form-cancel{background:none;border:none;cursor:pointer;font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted))}
  .cl-label{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:10px}
  .cl-input{width:100%;padding:12px;border:1px solid var(--fg-10, var(--c-border));font-size:15px;font-family:var(--ff-ui);background:var(--bg, var(--c-surface));color:var(--fg, var(--c-ink));outline:none;margin-bottom:20px}
  .cl-input:focus{border-color:var(--fg, var(--c-ink))}
  .cl-pills{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:20px}
  .cl-pill{padding:8px 14px;border:1px solid var(--fg-10, var(--c-border));font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg, var(--c-ink));cursor:pointer;background:transparent;transition:all .2s}
  .cl-pill:hover{border-color:var(--fg, var(--c-ink))}
  .cl-pill.on{background:var(--lipstick, var(--c-burg));color:#FAF6F1}
  .cl-upload-box{border:1px dashed var(--fg-10, var(--c-border));padding:32px;text-align:center;cursor:pointer;background:var(--bg, var(--c-surface));margin-bottom:8px;display:block}
  .cl-upload-hint{font-family:var(--ff-body);font-size:15px;font-style:italic;color:var(--fg-60, var(--c-muted))}
  .cl-upload-notice{font-family:var(--ff-ui);font-size:8px;letter-spacing:1px;line-height:1.6;color:var(--fg-60, var(--c-muted));margin-bottom:14px}
  .cl-upload-error{font-family:var(--ff-ui);font-size:9px;letter-spacing:1px;color:var(--lipstick, var(--c-burg));margin-bottom:14px}
  .cl-guide{background:var(--bg, var(--c-surface));border:1px solid var(--fg-10, var(--c-border));padding:16px;margin-bottom:20px}
  .cl-guide-header{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:10px}
  .cl-guide-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px}
  .cl-guide-col-label{font-family:var(--ff-ui);font-size:7px;letter-spacing:1px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:6px}
  .cl-guide-tips{list-style:none;padding:0}
  .cl-guide-tips li{font-family:var(--ff-body);font-size:12px;color:var(--fg, var(--c-ink));padding:2px 0 2px 14px;position:relative}
  .cl-guide-tips li::before{content:"–";position:absolute;left:0;color:var(--fg-60, var(--c-muted))}
  .cl-guide-ex{display:flex;gap:8px;padding:5px 8px;font-size:11px;font-family:var(--ff-body);margin-top:4px}
  .cl-guide-ex.good{background:rgba(76,175,80,.08);border-left:2px solid #4caf50}
  .cl-guide-ex.avoid{background:rgba(107,29,38,.06);border-left:2px solid var(--lipstick, var(--c-burg))}
  .cl-guide-ex-mark{font-weight:700;flex-shrink:0}
  .cl-submit{width:100%;padding:14px;background:var(--lipstick, var(--c-burg));color:#FAF6F1;border:none;font-family:var(--ff-ui);font-size:10px;letter-spacing:4px;text-transform:uppercase;cursor:pointer}
  .cl-submit:disabled{opacity:.3;cursor:not-allowed}
  /* Filter row — constrain search width so the row doesn't sprawl across 880 px */
  .cl-filter-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.75rem;border-top:1px solid var(--fg-12, var(--c-border));padding-top:1.25rem;margin-bottom:20px}
  .cl-filters{display:flex;gap:6px;overflow-x:auto;padding-bottom:4px;flex:1;min-width:0}
  .cl-filter{padding:8px 14px;border:1px solid var(--fg-10, var(--c-border));font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg, var(--c-ink));cursor:pointer;background:transparent;white-space:nowrap;transition:all .2s;flex-shrink:0}
  .cl-filter.on{background:var(--lipstick, var(--c-burg));color:#FAF6F1}
  .cl-search-label{display:flex;align-items:center;gap:0.5rem;font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));flex-shrink:0}
  /* Search width: 120 px is proportional to the 880 px column */
  .cl-search-input{border-top:none;border-left:none;border-right:none;border-bottom:1px solid var(--fg-25, var(--c-border));background:transparent;padding:0.25rem;font-size:13px;letter-spacing:normal;text-transform:none;color:var(--fg, var(--c-ink));outline:none;font-family:var(--ff-ui);width:120px}
  .cl-count{font-family:var(--ff-ui);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:20px}
  /* Product grid: minmax(200px,1fr) fits 4 cards in 880 px (4×200+3×16=848 px).
     Matches Lovable's minmax(250px,1fr) in its wider 1120 px column (4×250+3×24=1072 px). */
  .cl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
  .cl-card{background:var(--bg-50, var(--c-surface));border:1px solid var(--fg-10, var(--c-border));overflow:hidden;position:relative}
  /* Card image: square aspect ratio; contain preserves full garment — no clipping. */
  .cl-card-img{aspect-ratio:1;background:var(--bg-75, var(--c-muted-bg));display:flex;align-items:center;justify-content:center;overflow:hidden}
  .cl-card-img img{width:100%;height:100%;object-fit:contain}
  .cl-card-body{padding:16px}
  .cl-card-cat{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:6px}
  .cl-card-name{font-family:var(--ff-display);font-size:16px;font-weight:700;color:var(--fg, var(--c-ink));margin-bottom:4px}
  .cl-card-meta{font-family:var(--ff-ui);font-size:9px;letter-spacing:1px;color:var(--fg-60, var(--c-muted));text-transform:uppercase}
  .cl-card-elig--needs{font-family:var(--ff-ui);font-size:8px;letter-spacing:1px;color:var(--lipstick, var(--c-burg));text-transform:uppercase;margin-top:6px;display:block}
  .cl-card-elig--ok{font-family:var(--ff-ui);font-size:8px;letter-spacing:1px;color:var(--fg-60, var(--c-muted));text-transform:uppercase;margin-top:6px;display:block}
  .cl-delete{position:absolute;top:10px;right:10px;background:rgba(40,21,12,0.8);color:#FAF6F1;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;line-height:1}
  .cl-empty{text-align:center;padding:60px 32px;background:var(--bg-50, var(--c-surface));border:1px solid var(--fg-10, var(--c-border))}
  .cl-empty-icon{font-family:var(--ff-display);font-size:52px;color:var(--fg, var(--c-ink));opacity:.2;margin-bottom:16px}
  .cl-empty-text{font-family:var(--ff-body);font-size:18px;font-style:italic;color:var(--fg-60, var(--c-muted));margin-bottom:28px}
  /* Closet Insights section */
  .cl-insights{margin-bottom:28px;border:1px solid var(--fg-10, var(--c-border));padding:20px 24px}
  .cl-insights-header{font-family:var(--ff-ui);font-size:7px;letter-spacing:2px;text-transform:uppercase;color:var(--fg-60, var(--c-muted));margin-bottom:14px}
  .cl-insight{padding:10px 0;border-bottom:1px solid var(--fg-06, var(--c-border))}
  .cl-insight:last-child{border-bottom:none;padding-bottom:0}
  .cl-insight-claim{font-family:var(--ff-body);font-size:14px;font-style:italic;color:var(--fg, var(--c-ink));margin:0;line-height:1.55}
  .cl-cta{margin-top:48px;text-align:center}
  .cl-cta-btn{display:inline-flex;align-items:center;padding:12px 28px;background:var(--naia-ink);color:var(--naia-bg);text-decoration:none;font-family:var(--naia-ff-ui);font-size:10px;letter-spacing:2.5px;text-transform:uppercase;border:none;border-radius:9999px;cursor:pointer;transition:opacity .13s}
  .cl-cta-btn:hover{opacity:.8}
  .cl-cta-btn:focus-visible{outline:2px solid var(--naia-ink);outline-offset:2px}
  .cl-cta-btn:disabled{opacity:.45;cursor:not-allowed}
  @media(max-width:1023px){
    .mn-page-sections>.mn-back-link{margin-bottom:1.25rem}
  }
  @media(max-width:640px){
    .cl-stats{grid-template-columns:1fr}
    .cl-stat{display:flex;align-items:center;gap:14px;padding:14px 18px}
    .cl-stat-num{font-size:28px}
    .cl-guide-cols{grid-template-columns:1fr}
    .cl-filter-row{flex-direction:column;align-items:flex-start}
    .cl-search-input{width:100%}
    .cl-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
  }
  /* ── Validation error message ───────────────────────────────────────────── */
  .cl-error{color:var(--lipstick,#8b2252);font-family:var(--ff-body,inherit);font-size:13px;line-height:1.5;margin:8px 0 0;padding:10px 12px;background:color-mix(in srgb,var(--lipstick,#8b2252) 8%,transparent);border-radius:6px;border-left:3px solid var(--lipstick,#8b2252)}
  /* ── Edit panel & card edit controls ─────────────────────────────────────── */
  .cl-edit-btn{display:block;width:100%;background:none;border:none;cursor:pointer;font-family:var(--ff-ui,inherit);font-size:7px;font-weight:500;letter-spacing:1.5px;text-transform:uppercase;color:var(--c-muted,#888);text-align:center;padding:8px 0 2px;text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px}
  .cl-edit-btn:hover{color:var(--c-ink,#111)}
  .cl-replace-link{background:none;border:none;cursor:pointer;font-family:var(--ff-ui,inherit);font-size:7px;font-weight:500;letter-spacing:1.2px;text-transform:uppercase;color:var(--lipstick,#8b2252);padding:0;margin-left:6px;text-decoration:underline;text-underline-offset:2px;vertical-align:middle}
  .cl-replace-link:hover{opacity:0.75}
  .cl-edit-photo-row{display:flex;gap:16px;align-items:flex-start;margin-bottom:4px}
  .cl-edit-current{flex:0 0 100px;height:100px;border-radius:6px;overflow:hidden;background:var(--bg-50,#f5f5f5);display:flex;align-items:center;justify-content:center;font-size:32px;opacity:.3}
  .cl-edit-current img{width:100%;height:100%;object-fit:cover;opacity:1}
  .cl-edit-upload-side{flex:1;display:flex;flex-direction:column;gap:6px}
`;

// ── Component ─────────────────────────────────────────────────────────────────
// Composed implementation:
//   Shell  → Option B (my-naia.closet.tsx): MyNaiaLayout, NADINE header, My nAia navigation
//   Content → Option A (closet._index.tsx): Digital Closet title, stats, Add to Wardrobe
//             form, filters, card grid, Style Me CTA
//   Logic  → existing staging: Cloudinary, eligibility, journey events, delete, validation

export default function Closet() {
  const { items, closetInsights } = useLoaderData<typeof loader>();
  const { revalidate } = useRevalidator();

  const fetcher    = useFetcher();  // delete only
  const addFetcher = useFetcher<{ success?: boolean; error?: string; pendingAssessment?: boolean; itemId?: string }>();
  const addPendingRef = useRef(false);   // true while we are waiting for addFetcher to settle

  // ── Stage B assessment fetcher ────────────────────────────────────────────
  // Posts to /api/closet-assess after a successful add/edit, or on manual re-check.
  const assessFetcher = useFetcher<{ eligible?: string; customerHint?: string | null; assessmentFailed?: boolean }>();
  // itemId that is either queued for assessment or currently being assessed.
  const [pendingAssessId, setPendingAssessId] = useState<string | null>(null);
  // Tracks the itemId currently in-flight so completion effects can identify it.
  const assessingIdRef = useRef<string | null>(null);
  // Items whose assessment call failed — show "Re-check photo" for these.
  const [failedAssessIds, setFailedAssessIds] = useState<Set<string>>(new Set());
  // Prevents the page-load recovery from firing more than once per mount.
  const recoveryDoneRef = useRef(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [activeCategory, setActiveCategory] = useState("ALL");
  const [query, setQuery] = useState("");

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState("TOPS");
  const [newImageUrl, setNewImageUrl] = useState("");  // local blob URL for preview only — never sent to server
  const [newPublicId, setNewPublicId] = useState("");  // Cloudinary public ID — sent to action
  const blobUrlRef = useRef<string | null>(null);
  const [newColor, setNewColor] = useState("");
  const [newPattern, setNewPattern] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newOccasions, setNewOccasions] = useState<string[]>([]);
  const [newSeasons, setNewSeasons] = useState<string[]>([]);

  // ── Edit state ────────────────────────────────────────────────────────────
  const editFetcher = useFetcher<{ success?: boolean; error?: string; pendingAssessment?: boolean; itemId?: string }>();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState("TOPS");
  const [editColor, setEditColor] = useState("");
  const [editPublicId, setEditPublicId] = useState("");
  const [editImageUrl, setEditImageUrl] = useState("");
  const editBlobUrlRef = useRef<string | null>(null);
  const editPanelRef  = useRef<HTMLDivElement>(null);  // top of edit panel
  const editPhotoRef  = useRef<HTMLDivElement>(null);  // photo section inside panel
  const editScrollToPhotoRef = useRef(false);           // true → scroll to photo on open
  const [editUploading, setEditUploading] = useState(false);
  const [editUploadError, setEditUploadError] = useState<string | null>(null);

  // Revoke both blob preview URLs when the component unmounts.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      if (editBlobUrlRef.current) URL.revokeObjectURL(editBlobUrlRef.current);
    };
  }, []);

  const filtered = items.filter((item: any) => {
    const matchesCat = activeCategory === "ALL" || item.category === activeCategory;
    const q = query.trim().toLowerCase();
    const matchesSearch = !q ||
      (item.name ?? "").toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.brand ?? "").toLowerCase().includes(q);
    return matchesCat && matchesSearch;
  });

  useEffect(() => {
    if (!showAddForm) {
      // Form just closed — restore focus after React commits the button to the DOM
      addBtnRef.current?.focus();
      return;
    }
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") resetAddForm(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showAddForm]);

  // Known image magic bytes (file signatures). Checked before upload to catch
  // spoofed extensions and files that are not real images.
  const IMAGE_SIGNATURES: Array<{ mime: string; bytes: number[]; offset?: number }> = [
    { mime: "image/jpeg",  bytes: [0xFF, 0xD8, 0xFF] },
    { mime: "image/png",   bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
    { mime: "image/gif",   bytes: [0x47, 0x49, 0x46, 0x38] },
    { mime: "image/webp",  bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 },  // RIFF then WEBP at 8
    { mime: "image/heic",  bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },  // ftyp box
    { mime: "image/heif",  bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 },
  ];

  const MIN_DIMENSION = 200;   // px
  const MAX_DIMENSION = 8000;  // px
  const MAX_FILE_BYTES = 5 * 1024 * 1024;

  async function validateImageFile(file: File): Promise<string | null> {
    // 1. MIME type claim (fast check — can be spoofed, magic bytes confirm later)
    if (!file.type.startsWith("image/")) {
      return "Only image files are accepted (JPG, PNG, WEBP, HEIC).";
    }

    // 2. File size
    if (file.size > MAX_FILE_BYTES) {
      return `Image must be smaller than 5 MB. This file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`;
    }
    if (file.size === 0) {
      return "The file appears to be empty.";
    }

    // 3. Magic-byte / file-signature check
    const headerBytes = await file.slice(0, 12).arrayBuffer();
    const header = new Uint8Array(headerBytes);
    const signatureMatch = IMAGE_SIGNATURES.some(({ bytes, offset = 0 }) =>
      bytes.every((b, i) => header[offset + i] === b)
    );
    // WEBP: bytes 8-11 must be "WEBP" (0x57 0x45 0x42 0x50)
    const isWebp = header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46
                && header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
    if (!signatureMatch && !isWebp) {
      return "This file does not appear to be a valid image. Please use a JPG, PNG, WEBP, or HEIC photo.";
    }

    // 4. Decode check + dimension validation (also catches corrupted images)
    const dimensionError = await new Promise<string | null>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const { naturalWidth: w, naturalHeight: h } = img;
        if (w === 0 || h === 0) {
          resolve("The image could not be decoded. Please try a different file.");
        } else if (w < MIN_DIMENSION || h < MIN_DIMENSION) {
          resolve(`Image is too small (${w} × ${h} px). Minimum size is ${MIN_DIMENSION} × ${MIN_DIMENSION} px.`);
        } else if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
          resolve(`Image is too large (${w} × ${h} px). Maximum size is ${MAX_DIMENSION} × ${MAX_DIMENSION} px.`);
        } else {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve("The image could not be decoded. It may be corrupted or not a supported format.");
      };
      img.src = url;
    });
    if (dimensionError) return dimensionError;

    return null;
  }

  async function uploadToCloudinary(file: File) {
    setUploading(true);
    setUploadError(null);

    // Client-side validation: MIME, size, magic bytes, decode, dimensions
    const validationError = await validateImageFile(file);
    if (validationError) {
      setUploadError(validationError);
      setUploading(false);
      return;
    }

    try {
      const sigRes = await fetch("/api/cloudinary-signature", { credentials: "same-origin" });
      if (sigRes.status === 401) { setUploadError("Your session has expired. Please sign in again."); setUploading(false); return; }
      if (!sigRes.ok) { setUploadError("Upload service unavailable. Please try again."); setUploading(false); return; }
      const sig = await sigRes.json() as any;

      if (file.size > sig.maxFileSizeBytes) {
        setUploadError(`Image must be under ${Math.round(sig.maxFileSizeBytes / 1024 / 1024)} MB.`);
        setUploading(false);
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature);
      form.append("folder", sig.assetFolder);        // fixed folder mode — ownership check requires prefix
      form.append("upload_preset", sig.uploadPreset);
      form.append("allowed_formats", sig.allowedFormats);
      form.append("type", sig.deliveryType);         // signed — enforces private delivery

      const cloudRes = await fetch(sig.uploadUrl, { method: "POST", body: form });
      if (!cloudRes.ok) {
        const errData = await cloudRes.json().catch(() => ({} as any));
        setUploadError((errData as any).error?.message || "Upload failed. Please try again.");
        setUploading(false);
        return;
      }
      const cloudData = await cloudRes.json() as any;
      if (!cloudData.public_id) {
        setUploadError("Upload failed. Please try another photo.");
        setUploading(false);
        return;
      }
      // Private assets are not accessible via secure_url — use a local blob URL for preview.
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blobUrl = URL.createObjectURL(file);
      blobUrlRef.current = blobUrl;
      setNewImageUrl(blobUrl);
      setNewPublicId(cloudData.public_id);
    } catch {
      setUploadError("Upload failed. Please check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  function toggleOccasion(o: string) {
    setNewOccasions(prev => prev.includes(o) ? prev.filter(x => x !== o) : [...prev, o]);
  }
  function toggleSeason(s: string) {
    setNewSeasons(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  function handleAdd() {
    if (!newName || !newPublicId) return;
    addPendingRef.current = true;
    addFetcher.submit(
      {
        intent: "add",
        name: newName,
        category: newCategory,
        publicId: newPublicId,           // Cloudinary public ID — server verifies ownership
        primaryColor: newColor,
        pattern: newPattern,
        brand: newBrand,
        occasions: JSON.stringify(newOccasions),
        seasons: JSON.stringify(newSeasons),
      },
      { method: "post" }
    );
    // Do NOT close or reset the form here.
    // The useEffect below closes on success and keeps open on error.
  }

  function resetAddForm() {
    setNewName("");
    if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null; }
    setNewImageUrl("");
    setNewPublicId("");
    setNewColor("");
    setNewPattern("");
    setNewBrand("");
    setNewOccasions([]);
    setNewSeasons([]);
    setUploadError(null);
    setShowAddForm(false);
  }

  // ── Edit helpers ──────────────────────────────────────────────────────────

  async function uploadToCloudinaryForEdit(file: File) {
    setEditUploading(true);
    setEditUploadError(null);

    const validationError = await validateImageFile(file);
    if (validationError) {
      setEditUploadError(validationError);
      setEditUploading(false);
      return;
    }

    try {
      const sigRes = await fetch("/api/cloudinary-signature", { credentials: "same-origin" });
      if (sigRes.status === 401) { setEditUploadError("Your session has expired. Please sign in again."); setEditUploading(false); return; }
      if (!sigRes.ok) { setEditUploadError("Upload service unavailable. Please try again."); setEditUploading(false); return; }
      const sig = await sigRes.json() as any;

      if (file.size > sig.maxFileSizeBytes) {
        setEditUploadError(`Image must be under ${Math.round(sig.maxFileSizeBytes / 1024 / 1024)} MB.`);
        setEditUploading(false);
        return;
      }

      const form = new FormData();
      form.append("file", file);
      form.append("api_key", sig.apiKey);
      form.append("timestamp", String(sig.timestamp));
      form.append("signature", sig.signature);
      form.append("folder", sig.assetFolder);
      form.append("upload_preset", sig.uploadPreset);
      form.append("allowed_formats", sig.allowedFormats);
      form.append("type", sig.deliveryType);

      const cloudRes = await fetch(sig.uploadUrl, { method: "POST", body: form });
      if (!cloudRes.ok) {
        const errData = await cloudRes.json().catch(() => ({} as any));
        setEditUploadError((errData as any).error?.message || "Upload failed. Please try again.");
        setEditUploading(false);
        return;
      }
      const cloudData = await cloudRes.json() as any;
      if (!cloudData.public_id) {
        setEditUploadError("Upload failed. Please try another photo.");
        setEditUploading(false);
        return;
      }
      if (editBlobUrlRef.current) URL.revokeObjectURL(editBlobUrlRef.current);
      const blobUrl = URL.createObjectURL(file);
      editBlobUrlRef.current = blobUrl;
      setEditImageUrl(blobUrl);
      setEditPublicId(cloudData.public_id);
    } catch {
      setEditUploadError("Upload failed. Please check your connection and try again.");
    } finally {
      setEditUploading(false);
    }
  }

  function openEdit(item: any, scrollToPhoto = false) {
    editScrollToPhotoRef.current = scrollToPhoto;
    setEditingItemId(item.id);
    setEditName(item.name ?? "");
    setEditCategory(item.category ?? "TOPS");
    setEditColor(item.primaryColor ?? "");
    setEditPublicId("");
    setEditImageUrl("");
    setEditUploadError(null);
    if (editBlobUrlRef.current) { URL.revokeObjectURL(editBlobUrlRef.current); editBlobUrlRef.current = null; }
  }

  function handleRecheck(itemId: string) {
    setFailedAssessIds(prev => { const s = new Set(prev); s.delete(itemId); return s; });
    setPendingAssessId(itemId);
  }

  function closeEdit() {
    setEditingItemId(null);
    setEditName("");
    setEditCategory("TOPS");
    setEditColor("");
    setEditPublicId("");
    if (editBlobUrlRef.current) { URL.revokeObjectURL(editBlobUrlRef.current); editBlobUrlRef.current = null; }
    setEditImageUrl("");
    setEditUploadError(null);
  }

  function handleEditSubmit() {
    if (!editingItemId || !editName || !editCategory) return;
    editFetcher.submit(
      {
        intent: "edit",
        itemId: editingItemId,
        name: editName,
        category: editCategory,
        primaryColor: editColor,
        newPublicId: editPublicId,   // empty string = meta-only edit; publicId = photo replacement
      },
      { method: "post" }
    );
  }

  // Close the add form on success; keep it open on error.
  // addPendingRef guards against stale data from a previous submission firing this.
  useEffect(() => {
    if (!addPendingRef.current) return;
    if (addFetcher.state !== "idle") return;
    addPendingRef.current = false;
    if (addFetcher.data?.success) {
      // Queue Stage B if the server flagged this item as pending-assessment.
      if (addFetcher.data.pendingAssessment && addFetcher.data.itemId) {
        setPendingAssessId(addFetcher.data.itemId);
      }
      resetAddForm();
    }
    // On error, keep form open — addFetcher.data?.error renders below the submit button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFetcher.state, addFetcher.data]);

  // Close the edit panel when the server reports success.
  useEffect(() => {
    if (!editFetcher.data?.success) return;
    // Queue Stage B if the server flagged this item as pending-assessment.
    if (editFetcher.data.pendingAssessment && editFetcher.data.itemId) {
      setPendingAssessId(editFetcher.data.itemId);
    }
    closeEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editFetcher.data]);

  // ── Stage B — submit assess when a pendingAssessId is set and fetcher is idle ──
  // Submits to /api/closet-assess; records the in-flight itemId for completion handling.
  useEffect(() => {
    if (!pendingAssessId || assessFetcher.state !== "idle") return;
    assessingIdRef.current = pendingAssessId;
    setPendingAssessId(null);
    assessFetcher.submit({ itemId: pendingAssessId }, { method: "post", action: "/api/closet-assess" });
  }, [pendingAssessId, assessFetcher.state]);

  // ── Stage B — handle assess completion ───────────────────────────────────
  useEffect(() => {
    if (assessFetcher.state !== "idle" || !assessFetcher.data) return;
    if (assessFetcher.data.assessmentFailed) {
      // AI timeout or system failure — mark for Re-check button without writing to DB.
      const id = assessingIdRef.current;
      assessingIdRef.current = null;
      if (id) setFailedAssessIds(prev => new Set([...prev, id]));
      return;
    }
    if (assessFetcher.data.eligible) {
      // Genuine result persisted — revalidate so the card reflects the final eligibility.
      assessingIdRef.current = null;
      revalidate();
    }
  }, [assessFetcher.state, assessFetcher.data, revalidate]);

  // ── Recovery — one assess attempt per page load for stuck items ───────────
  useEffect(() => {
    if (recoveryDoneRef.current) return;
    recoveryDoneRef.current = true;
    const stuck = (items as any[]).find((i: any) => i.tryOnEligibility === "pending-assessment");
    if (stuck) setPendingAssessId(stuck.id);
    // items captured at mount — the dep array is intentionally empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After React commits the panel to the DOM, scroll it (or its photo section) into view.
  // editScrollToPhotoRef is a plain ref so this effect only depends on editingItemId —
  // no extra renders, no timeouts.
  useEffect(() => {
    if (!editingItemId) return;
    const target = editScrollToPhotoRef.current ? editPhotoRef.current : editPanelRef.current;
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editingItemId]);

  // Current item being edited — used to render existing photo in the edit panel.
  const editingItem = editingItemId ? (items as any[]).find((i: any) => i.id === editingItemId) ?? null : null;

  return (
    // Option B shell: compact variant — NADINE header + sidebar, no MY nAia. masthead
    <MyNaiaLayout compact>
      <style>{css}</style>

      <div className="mn-page-sections">
        {/* Option B navigation: back to My nAia Overview */}
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Option A page header */}
        <h1 className="cl-headline">Digital Closet</h1>
        <p className="cl-sub">Upload, save, and style your pieces</p>

        {/* Option A: Total Pieces / Categories / Brands */}
        <div className="cl-stats">
          <div className="cl-stat">
            <div className="cl-stat-num">{items.length}</div>
            <div className="cl-stat-label">Total Pieces</div>
          </div>
          <div className="cl-stat">
            <div className="cl-stat-num">{new Set(items.map((i: any) => i.category)).size}</div>
            <div className="cl-stat-label">Categories</div>
          </div>
          <div className="cl-stat">
            <div className="cl-stat-num">{new Set(items.map((i: any) => i.brand).filter(Boolean)).size}</div>
            <div className="cl-stat-label">Brands</div>
          </div>
        </div>

        {/* Closet Insights — deterministic, on-demand, V2-A4 */}
        {closetInsights.insights.length > 0 && (
          <section className="cl-insights" aria-label="Closet Insights">
            <div className="cl-insights-header">Closet Insights</div>
            {closetInsights.insights.map((insight) => (
              <div key={insight.id} className="cl-insight">
                <p className="cl-insight-claim">{insight.claim}</p>
              </div>
            ))}
          </section>
        )}

        {/* Option A: + Add a Piece CTA */}
        {!showAddForm && (
          <button ref={addBtnRef} type="button" className="cl-add-btn" onClick={() => setShowAddForm(true)}>
            + Add a Piece
          </button>
        )}

        {/* Option A: Add to Wardrobe inline form */}
        {showAddForm && (
          <div className="cl-form">
            <div className="cl-form-header">
              <h3 className="cl-form-title">Add to Wardrobe</h3>
              <button type="button" className="cl-form-cancel" onClick={resetAddForm}>Cancel</button>
            </div>

            {/* Photo guide integrated inside Add to Wardrobe panel */}
            <div className="cl-guide">
              <div className="cl-guide-header">Photo guide</div>
              <div className="cl-guide-cols">
                <div>
                  <div className="cl-guide-col-label">General</div>
                  <ul className="cl-guide-tips">
                    {GENERAL_PHOTO_TIPS.map((tip, i) => <li key={i}>{tip}</li>)}
                  </ul>
                </div>
                {CATEGORY_PHOTO_TIPS[newCategory] && (
                  <div>
                    <div className="cl-guide-col-label">{CATEGORY_PHOTO_TIPS[newCategory].title}</div>
                    <ul className="cl-guide-tips">
                      {CATEGORY_PHOTO_TIPS[newCategory].tips.map((tip, i) => <li key={i}>{tip}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              <div>
                <div className="cl-guide-ex good">
                  <span className="cl-guide-ex-mark">✓</span>
                  <span>Single item · plain background · fully visible · well lit</span>
                </div>
                <div className="cl-guide-ex avoid">
                  <span className="cl-guide-ex-mark">✗</span>
                  <span>Multiple items or cluttered background</span>
                </div>
                <div className="cl-guide-ex avoid">
                  <span className="cl-guide-ex-mark">✗</span>
                  <span>Item cropped, blurry or poorly lit</span>
                </div>
              </div>
            </div>

            <div className="cl-label">Photo</div>
            <label className="cl-upload-box">
              {newImageUrl
                ? <img src={newImageUrl} alt="preview" style={{ maxHeight: "200px", objectFit: "cover" }} />
                : uploading
                  ? <span className="cl-upload-hint">Uploading…</span>
                  : <span className="cl-upload-hint">Click to upload photo</span>
              }
              <input
                type="file"
                accept="image/*"
                onChange={e => e.target.files?.[0] && uploadToCloudinary(e.target.files[0])}
                style={{ display: "none" }}
              />
            </label>
            <p className="cl-upload-notice">
              Upload photos of clothing items only. Do not upload selfies, face photos, mirror photos, body scans, or personal images.
            </p>
            {uploadError && <p className="cl-upload-error">{uploadError}</p>}

            <div className="cl-label">Name *</div>
            <input
              className="cl-input"
              type="text"
              placeholder="e.g. Black silk blazer"
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />

            <div className="cl-label">Category *</div>
            <div className="cl-pills">
              {CATEGORIES.map(c => (
                <button key={c} type="button" onClick={() => setNewCategory(c)} className={`cl-pill${newCategory === c ? " on" : ""}`}>
                  {c.charAt(0) + c.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="cl-label">Color</div>
            <div className="cl-pills">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setNewColor(c)} className={`cl-pill${newColor === c ? " on" : ""}`}>{c}</button>
              ))}
            </div>

            <div className="cl-label">Pattern</div>
            <div className="cl-pills">
              {PATTERNS.map(p => (
                <button key={p} type="button" onClick={() => setNewPattern(p)} className={`cl-pill${newPattern === p ? " on" : ""}`}>{p}</button>
              ))}
            </div>

            <div className="cl-label">Occasions</div>
            <div className="cl-pills">
              {OCCASIONS.map(o => (
                <button key={o} type="button" onClick={() => toggleOccasion(o)} className={`cl-pill${newOccasions.includes(o) ? " on" : ""}`}>{o}</button>
              ))}
            </div>

            <div className="cl-label">Season</div>
            <div className="cl-pills">
              {SEASONS.map(s => (
                <button key={s} type="button" onClick={() => toggleSeason(s)} className={`cl-pill${newSeasons.includes(s) ? " on" : ""}`}>{s}</button>
              ))}
            </div>

            <div className="cl-label">Brand (optional)</div>
            <input
              className="cl-input"
              type="text"
              placeholder="Brand name"
              value={newBrand}
              onChange={e => setNewBrand(e.target.value)}
            />

            <button
              type="button"
              className="cl-submit"
              onClick={handleAdd}
              disabled={!newName || !newPublicId || uploading || addFetcher.state === "submitting"}
            >
              {uploading ? "Uploading…" : addFetcher.state === "submitting" ? "Saving…" : "Add to Wardrobe"}
            </button>

            {addFetcher.data?.error && (
              <p className="cl-error">{addFetcher.data.error}</p>
            )}
          </div>
        )}

        {/* ── Edit panel ────────────────────────────────────────────────── */}
        {editingItemId && (
          <div ref={editPanelRef} className="cl-form" role="region" aria-label="Edit piece">
            <div className="cl-form-header">
              <span className="cl-form-title">Edit Piece</span>
              <button type="button" className="cl-form-cancel" onClick={closeEdit}>✕ Cancel</button>
            </div>

            <div ref={editPhotoRef} style={{ scrollMarginTop: "72px" }}>
            <div className="cl-label">Photo</div>
            <div className="cl-edit-photo-row">
              <div className="cl-edit-current">
                {editImageUrl
                  ? <img src={editImageUrl} alt="New photo preview" />
                  : editingItem?.displayImageUrl
                    ? <img src={editingItem.displayImageUrl} alt="Current photo" />
                    : "◇"
                }
              </div>
              <div className="cl-edit-upload-side">
                <label className="cl-upload-box" style={{ minHeight: "72px", cursor: "pointer" }}>
                  {editUploading
                    ? <span className="cl-upload-hint">Uploading…</span>
                    : editPublicId
                      ? <span className="cl-upload-hint" style={{ color: "var(--lipstick,#8b2252)" }}>New photo ready ✓</span>
                      : <span className="cl-upload-hint">Upload a replacement photo (optional)</span>
                  }
                  <input
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadToCloudinaryForEdit(f); }}
                    disabled={editUploading || editFetcher.state === "submitting"}
                  />
                </label>
                {editUploadError && <p className="cl-error">{editUploadError}</p>}
              </div>
            </div>
            </div>{/* /editPhotoRef wrapper */}

            <div className="cl-label">Item Name</div>
            <input
              className="cl-input"
              type="text"
              placeholder="e.g. Black silk blazer"
              value={editName}
              onChange={e => setEditName(e.target.value)}
            />

            <div className="cl-label">Category</div>
            <div className="cl-pills">
              {CATEGORIES.map(c => (
                <button key={c} type="button" onClick={() => setEditCategory(c)} className={`cl-pill${editCategory === c ? " on" : ""}`}>{c.charAt(0) + c.slice(1).toLowerCase()}</button>
              ))}
            </div>

            <div className="cl-label">Colour</div>
            <div className="cl-pills">
              {COLORS.map(c => (
                <button key={c} type="button" onClick={() => setEditColor(c)} className={`cl-pill${editColor === c ? " on" : ""}`}>{c}</button>
              ))}
            </div>

            {editFetcher.data?.error && (
              <p className="cl-error" style={{ marginTop: "8px" }}>{editFetcher.data.error}</p>
            )}

            <button
              type="button"
              className="cl-submit"
              onClick={handleEditSubmit}
              disabled={!editName || !editCategory || editUploading || editFetcher.state === "submitting"}
            >
              {editFetcher.state === "submitting" ? "Saving…" : "Save Changes"}
            </button>
          </div>
        )}

        {/* Option A: category filters + Option B: search — combined row */}
        <div className="cl-filter-row">
          <div className="cl-filters">
            {["ALL", ...CATEGORIES].map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`cl-filter${activeCategory === cat ? " on" : ""}`}
              >
                {cat === "ALL" ? "All" : cat.charAt(0) + cat.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <label className="cl-search-label">
            <span>Search</span>
            <input
              type="text"
              className="cl-search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ivory trouser…"
            />
          </label>
        </div>

        {/* Item count */}
        <p className="cl-count">{filtered.length} {filtered.length === 1 ? "piece" : "pieces"}</p>

        {/* Option A: card grid */}
        {filtered.length === 0 ? (
          <div className="cl-empty">
            <div className="cl-empty-icon">◇</div>
            <p className="cl-empty-text">
              {items.length === 0
                ? "No pieces yet. Add your first to get started."
                : "No pieces match this view."}
            </p>
            {items.length === 0 && (
              <button
                type="button"
                className="cl-add-btn"
                style={{ width: "auto", display: "inline-block", marginBottom: 0 }}
                onClick={() => setShowAddForm(true)}
              >
                Add Your First Piece
              </button>
            )}
          </div>
        ) : (
          <div className="cl-grid">
            {filtered.map((item: any) => {
              const elig = eligibilityStatus(item.tryOnEligibility, item.tryOnCustomerHint);
              return (
                <div key={item.id} className="cl-card">
                  <div className="cl-card-img">
                    {item.displayImageUrl
                      ? <img src={item.displayImageUrl} alt={item.name} />
                      : <span style={{ fontSize: "64px", opacity: 0.2 }}>◇</span>
                    }
                  </div>
                  <div className="cl-card-body">
                    <div className="cl-card-cat">{item.category}</div>
                    <div className="cl-card-name">{item.name}</div>
                    {(item.primaryColor || item.pattern) && (
                      <div className="cl-card-meta">{[item.primaryColor, item.pattern].filter(Boolean).join(" · ")}</div>
                    )}
                    {item.brand && <div className="cl-card-meta" style={{ marginTop: "4px" }}>{item.brand}</div>}
                    {elig && (
                      <span className={elig.isNeeds ? "cl-card-elig--needs" : "cl-card-elig--ok"}>
                        {elig.label}
                        {elig.isNeeds && (
                          <button type="button" className="cl-replace-link" onClick={() => openEdit(item, true)}>
                            Replace photo
                          </button>
                        )}
                        {item.tryOnEligibility === "pending-assessment" && failedAssessIds.has(item.id) && (
                          <button type="button" className="cl-replace-link" onClick={() => handleRecheck(item.id)}>
                            Re-check photo
                          </button>
                        )}
                      </span>
                    )}
                    <button type="button" className="cl-edit-btn" onClick={() => openEdit(item)}>
                      Edit
                    </button>
                  </div>
                  <button
                    type="button"
                    className="cl-delete"
                    aria-label={`Remove ${item.name}`}
                    onClick={() => fetcher.submit({ intent: "delete", itemId: item.id }, { method: "post" })}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Option A: Style Me CTA → canonical /style-me route */}
        <div className="cl-cta">
          <Link to="/style-me" className="cl-cta-btn">Style Me →</Link>
        </div>
      </div>
    </MyNaiaLayout>
  );
}
