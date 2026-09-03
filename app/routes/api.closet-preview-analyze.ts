// app/routes/api.closet-preview-analyze.ts
// POST /api/closet-preview-analyze
//
// Runs garment preview analysis on a just-uploaded Cloudinary asset so the
// customer can confirm nAia's read before the item is saved.
//
// Security contract:
//   1. NaiaSession auth required (same as all customer-facing routes).
//   2. publicId ownership validated — must start with naia-wardrobe/{customerId}/.
//   3. Asset verified via Cloudinary Admin API — must exist and be type=private.
//   4. Layer 2 content moderation (moderateImageContent) must PASS before analysis.
//   5. Layer 3 garment suitability (screenGarmentSuitability) must PASS before analysis.
//   6. Only POST accepted — loader returns 405.
//
// On Layer 2 or Layer 3 failure the asset is deleted (matching the final-submit
// pipeline) and requiresReupload:true is returned so the client can clear state.
// NEEDS_CLARIFICATION (Layer 3) preserves the asset — the customer can fill in
// details manually in the fallback form and resubmit.

import { data, type ActionFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  verifyCloudinaryAsset,
  buildPrivateDownloadUrl,
  deleteCloudinaryAsset,
} from "~/lib/cloudinary-admin.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { previewAnalyzeGarment } from "~/lib/ai/closet-preview-analysis.server";

export async function loader() {
  return data({ error: "Method not allowed" }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return data({ error: "Method not allowed" }, { status: 405 });
  }

  // 1. Auth
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return data({ error: "Not authenticated" }, { status: 401 });
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data({ error: "Invalid request body" }, { status: 400 });
  }

  const publicId = (
    typeof body === "object" &&
    body !== null &&
    "publicId" in body &&
    typeof (body as Record<string, unknown>).publicId === "string"
      ? ((body as Record<string, unknown>).publicId as string)
      : ""
  ).trim();

  if (!publicId) {
    return data({ error: "publicId required" }, { status: 400 });
  }

  // 3. Ownership check — publicId must belong to the authenticated customer's folder.
  const ownership = validatePublicIdOwnership(publicId, naiaCustomer.id);
  if (!ownership.ok) {
    return data({ error: ownership.error }, { status: 400 });
  }

  // 4. Asset verification — must exist and be private delivery type.
  const verify = await verifyCloudinaryAsset(publicId, "private");
  if (!verify.ok) {
    return data({ error: "Asset not found or could not be verified" }, { status: 400 });
  }
  if (verify.asset.type !== "private") {
    return data({ error: "Asset must be a private upload" }, { status: 400 });
  }

  // 5. Build server-side download URL — required for safety checks (never trust client URLs).
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    return data({ error: "Service unavailable" }, { status: 503 });
  }
  const downloadUrl = buildPrivateDownloadUrl(cfg, publicId, verify.asset.format, "private");

  // 6. Layer 2: content moderation — must run before any AI garment analysis.
  //    Matches the order enforced at final submission in the /closet action.
  const moderation = await moderateImageContent(downloadUrl);
  if (moderation.status === "MODERATION_UNAVAILABLE") {
    await deleteCloudinaryAsset(publicId, "private");
    return data(
      { error: "Image review is temporarily unavailable. Please try a different photo.", requiresReupload: true },
      { status: 503 },
    );
  }
  if (moderation.status === "SAFETY_REJECT") {
    await deleteCloudinaryAsset(publicId, "private");
    return data(
      { error: "This image does not meet our content standards. Please upload a different photo.", requiresReupload: true },
      { status: 422 },
    );
  }

  // 7. Layer 3: garment suitability — no declaredCategory at preview stage
  //    (customer hasn't confirmed category yet; category_mismatch cannot fire).
  const suitability = await screenGarmentSuitability(downloadUrl);
  if (suitability.status === "RETRY_IMAGE") {
    await deleteCloudinaryAsset(publicId, "private");
    const subCode = (suitability as { status: "RETRY_IMAGE"; subCode: string }).subCode;
    const PREVIEW_GUIDANCE: Record<string, string> = {
      no_garment_visible: "No clothing item was detected. Please upload a photo of a single garment.",
      image_too_blurry: "Photo is too blurry. Please try a clearer photo.",
      garment_excessively_cropped: "The garment is too cropped. Please ensure the full item is visible.",
      multiple_items_ambiguous: "Multiple items detected. Please photograph one item at a time.",
      item_not_identifiable: "We couldn't identify a wearable fashion item. Please upload a clear photo.",
      assessment_failed: "Image assessment is temporarily unavailable. Please try again.",
    };
    return data(
      { error: PREVIEW_GUIDANCE[subCode] ?? "Please upload a clearer photo of a single fashion item.", requiresReupload: true },
      { status: 422 },
    );
  }
  if (suitability.status === "NEEDS_CLARIFICATION") {
    // Asset preserved — customer can fill in details manually in the fallback form and resubmit.
    return data(
      { error: "We couldn't read all the details from this photo. You can still add the item manually below." },
      { status: 422 },
    );
  }

  // 8. Preview analysis — non-blocking timeout internal to previewAnalyzeGarment.
  //    Returns null on failure (timeout, parse error, Claude error).
  const preview = await previewAnalyzeGarment(publicId);
  if (!preview) {
    return data({ error: "Analysis failed" }, { status: 500 });
  }

  return data(preview);
}
