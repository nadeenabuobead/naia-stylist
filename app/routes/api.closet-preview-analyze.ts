// app/routes/api.closet-preview-analyze.ts
// POST /api/closet-preview-analyze
//
// Runs garment preview analysis on a just-uploaded Cloudinary asset so the
// customer can confirm nAia's read before the item is saved.
//
// Security contract:
//   1. NaiaSession auth required (same as all customer-facing routes).
//   2. publicId ownership validated — must start with naia-wardrobe/{customerId}/.
//   3. Closet entitlement checked — a customer with zero/no remaining Closet
//      allowance is refused here, before either paid Claude call below ever
//      runs. Found 2026-11-17: this endpoint had no entitlement gate at all,
//      so a zero-allowance customer's upload triggered a real moderation call
//      AND a real suitability call every time, for an item that could never
//      actually be saved (closet._index.tsx's own capacity check, further
//      downstream, would always reject it afterwards anyway). Uses the exact
//      same checkEntitlement("closet") call and the exact same limit===0
//      upgrade-message text as closet._index.tsx/api.closet.jsx (dd67ed9) —
//      this is a second, EARLIER checkpoint on the same authoritative source
//      of truth, not a separate rule that could drift from it. The final
//      atomic reserveClosetSlot in closet._index.tsx is unchanged and remains
//      the real race-safe enforcement point — this early check is purely a
//      cost/latency fast-fail, never the only thing standing between a
//      zero-allowance customer and a saved item.
//   4. Asset verified via Cloudinary Admin API — must exist and be type=private.
//   5. Layer 2 content moderation (moderateImageContent) must PASS before analysis.
//   6. Layer 3 garment suitability (screenGarmentSuitability) must PASS before analysis.
//   7. Only POST accepted — loader returns 405.
//
// On entitlement, Layer 2, or Layer 3 failure the asset is deleted (matching
// the final-submit pipeline) and (for Layer 2/3) requiresReupload:true is
// returned so the client can clear state. NEEDS_CLARIFICATION (Layer 3)
// preserves the asset — the customer can fill in details manually in the
// fallback form and resubmit.

import { data, type ActionFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  getCloudinaryConfig,
  validatePublicIdOwnership,
  verifyCloudinaryAsset,
  buildPrivateDownloadUrl,
  deleteCloudinaryAsset,
} from "~/lib/cloudinary-admin.server";
import { checkEntitlement } from "~/lib/plan/entitlement.server";
import { moderateImageContent } from "~/lib/image-moderation.server";
import { screenGarmentSuitability } from "~/lib/image-suitability.server";
import { previewAnalyzeGarment } from "~/lib/ai/closet-preview-analysis.server";
import { extractConsentGiven } from "~/lib/photo-consent.server";

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

  // 3. Ownership check — publicId must belong to the authenticated customer's
  //    folder. Must run BEFORE the consent check below: a consent rejection
  //    deletes the asset, and that delete must never be reachable for a
  //    publicId this customer does not own (a forged/guessed publicId plus
  //    withheld consent must not become a way to delete another customer's
  //    photo).
  const ownership = validatePublicIdOwnership(publicId, naiaCustomer.id);
  if (!ownership.ok) {
    return data({ error: ownership.error }, { status: 400 });
  }

  // 4. Closet entitlement — same authoritative check and same limit===0
  //    upgrade-message text as closet._index.tsx's final capacity check
  //    (dd67ed9). Runs before consent/moderation/suitability so a
  //    zero-allowance customer never triggers either paid Claude call below.
  //    Ownership is already confirmed above, so it is safe to delete this
  //    customer's own asset here rather than leave it orphaned.
  //
  //    requiresReupload:true is REQUIRED here, not optional — found live,
  //    2026-11-17: the client (closet._index.tsx's fetchPreviewAnalysis)
  //    only shows a rejection's error text and resets to idle when this flag
  //    is present; without it, a non-ok response falls through to the
  //    generic "couldn't read this piece, fill in manually" fallback,
  //    silently swallowing the upgrade message this check exists to show.
  //    Matches the Layer 2/3 rejection responses below, which already set it.
  const capacityCheck = await checkEntitlement(naiaCustomer.id, naiaCustomer.membershipStatus, "closet");
  if (!capacityCheck.allowed) {
    await deleteCloudinaryAsset(publicId, "private");
    const message = capacityCheck.limit === 0
      ? "Closet access is included with nAia Membership. Subscribe to start adding pieces."
      : "Your closet is full. Remove some items to add new ones.";
    return data({ error: message, requiresReupload: true }, { status: 403 });
  }

  // 5. Photo consent (2026-10-19) — required before any AI analysis of the
  //    photo runs. Ownership is already confirmed above, so it is safe to
  //    delete this customer's own asset here rather than leave it orphaned.
  if (!extractConsentGiven(body)) {
    await deleteCloudinaryAsset(publicId, "private");
    return data({ error: "Photo consent is required before analysis." }, { status: 400 });
  }

  // 6. Asset verification — must exist and be private delivery type.
  const verify = await verifyCloudinaryAsset(publicId, "private");
  if (!verify.ok) {
    return data({ error: "Asset not found or could not be verified" }, { status: 400 });
  }
  if (verify.asset.type !== "private") {
    return data({ error: "Asset must be a private upload" }, { status: 400 });
  }

  // 7. Build server-side download URL — required for safety checks (never trust client URLs).
  const cfg = getCloudinaryConfig();
  if (!cfg) {
    return data({ error: "Service unavailable" }, { status: 503 });
  }
  const downloadUrl = buildPrivateDownloadUrl(cfg, publicId, verify.asset.format, "private");

  // 8. Layer 2: content moderation — must run before any AI garment analysis.
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

  // 9. Layer 3: garment suitability — no declaredCategory at preview stage
  //    (customer hasn't confirmed category yet; category_mismatch cannot fire).
  const suitability = await screenGarmentSuitability(downloadUrl);
  if (suitability.status === "RETRY_IMAGE") {
    await deleteCloudinaryAsset(publicId, "private");
    const subCode = (suitability as { status: "RETRY_IMAGE"; subCode: string }).subCode;
    const PREVIEW_GUIDANCE: Record<string, string> = {
      no_garment_visible: "No fashion item was detected. Please upload a photo of a single clothing item, accessory, or piece of jewellery.",
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

  // 10. Preview analysis — non-blocking timeout internal to previewAnalyzeGarment.
  //    Pass the already-verified downloadUrl so Claude can fetch the private asset
  //    via the authenticated download API (CDN delivery does not serve private assets).
  const preview = await previewAnalyzeGarment(downloadUrl);
  if (!preview) {
    return data({ error: "Analysis failed" }, { status: 500 });
  }

  return data(preview);
}
