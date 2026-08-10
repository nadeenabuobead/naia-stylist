import { getCurrentNaiaCustomer } from "../lib/naia-session.server";
import { buildModelUploadUrl } from "../lib/cloudinary-admin.server";
import crypto from "node:crypto";

// Max file size enforced by the Cloudinary upload preset (set in the Cloudinary dashboard).
// This constant is returned to the client as an informational pre-check only.
const CLIENT_MAX_BYTES = 5 * 1024 * 1024;

export async function loader({ request }) {
  const naiaCustomer = await getCurrentNaiaCustomer(request);
  if (!naiaCustomer) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const uploadPreset = process.env.CLOUDINARY_WARDROBE_UPLOAD_PRESET;

  if (!cloudName || !apiKey || !apiSecret || !uploadPreset) {
    console.error("Missing Cloudinary environment variables");
    return Response.json({ error: "Upload service not configured" }, { status: 500 });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  // asset_folder organises files in Cloudinary's dynamic folder mode without placing the
  // customer's internal CUID in the public image URL. Cloudinary upload signatures are
  // valid for one hour from their timestamp.
  const assetFolder = `naia-wardrobe/${naiaCustomer.id}`;
  const allowedFormats = "jpg,jpeg,png,webp,heic,heif";

  // All customer model photos are uploaded as private-delivery assets.
  // Delivery type is enforced via the signed `type` parameter — not the URL path.
  // The browser cannot change the type field because it is included in the server signature.
  // Server-side Admin API verification enforces the delivery type before persistence.
  //
  // Parameters must be sorted alphabetically for the Cloudinary signature.
  // public_id is intentionally excluded so Cloudinary auto-generates it;
  // any browser-supplied public_id would fail signature verification.
  // Alphabetical order: allowed_formats < asset_folder < timestamp < type < upload_preset
  const deliveryType = "private";
  const paramsToSign = [
    `allowed_formats=${allowedFormats}`,
    `asset_folder=${assetFolder}`,
    `timestamp=${timestamp}`,
    `type=${deliveryType}`,
    `upload_preset=${uploadPreset}`,
  ].join("&");

  const signature = crypto
    .createHash("sha1")
    .update(paramsToSign + apiSecret)
    .digest("hex");

  // uploadUrl: server-constructed private upload endpoint. Client must use verbatim.
  // Delivery type is enforced by the URL path (/image/private), not a form field.
  const uploadUrl = buildModelUploadUrl(cloudName);

  // api_secret is never returned. Only the public API key is returned.
  // Cache-Control: no-store prevents any browser or proxy from caching this response;
  // a cached signature could be replayed within its one-hour validity window.
  return Response.json(
    {
      signature,
      timestamp,
      apiKey,
      cloudName,
      assetFolder,
      uploadPreset,
      allowedFormats,
      deliveryType,
      uploadUrl,
      maxFileSizeBytes: CLIENT_MAX_BYTES,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
