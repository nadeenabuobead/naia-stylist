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
//   4. Only POST accepted — loader returns 405.
//
// This endpoint does NOT run Layer 2 (content moderation) or Layer 3 (suitability).
// Those layers run at final submission (/closet action intent=add) before the DB write,
// preserving the existing security order. The preview endpoint is read-only: it does
// not persist anything and does not delete any asset.

import { data, type ActionFunctionArgs } from "react-router";
import { getCurrentNaiaCustomer } from "~/lib/naia-session.server";
import {
  validatePublicIdOwnership,
  verifyCloudinaryAsset,
} from "~/lib/cloudinary-admin.server";
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

  // 5. Preview analysis — non-blocking timeout internal to previewAnalyzeGarment.
  //    Returns null on failure (timeout, parse error, Claude error).
  const preview = await previewAnalyzeGarment(publicId);
  if (!preview) {
    return data({ error: "Analysis failed" }, { status: 500 });
  }

  return data(preview);
}
