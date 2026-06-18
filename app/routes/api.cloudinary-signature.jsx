import { authenticate } from "~/shopify.server";
import prisma from "../db.server";
import crypto from "node:crypto";

// Max file size enforced by the Cloudinary upload preset (set in the Cloudinary dashboard).
// This constant is returned to the client as an informational pre-check only.
const CLIENT_MAX_BYTES = 5 * 1024 * 1024;

export async function loader({ request }) {
  // Throws 400 if this is not a valid Shopify App Proxy request (invalid/missing HMAC).
  // Direct Vercel URL access will never reach the code below.
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shopifyCustomerId = url.searchParams.get("logged_in_customer_id");
  if (!shopifyCustomerId) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  // findUnique only — no upsert, no create. Customer must already have a nAia profile.
  const customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId },
    select: { id: true },
  });
  if (!customer) {
    return Response.json(
      { error: "No nAia profile found. Please complete your Style Profile first." },
      { status: 403 }
    );
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
  const assetFolder = `naia-wardrobe/${customer.id}`;
  const allowedFormats = "jpg,jpeg,png,webp";

  // Parameters must be sorted alphabetically for the Cloudinary signature.
  // public_id is intentionally excluded so Cloudinary auto-generates it;
  // any browser-supplied public_id would fail signature verification.
  const paramsToSign = [
    `allowed_formats=${allowedFormats}`,
    `asset_folder=${assetFolder}`,
    `timestamp=${timestamp}`,
    `upload_preset=${uploadPreset}`,
  ].join("&");

  const signature = crypto
    .createHash("sha1")
    .update(paramsToSign + apiSecret)
    .digest("hex");

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
      maxFileSizeBytes: CLIENT_MAX_BYTES,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
