// app/routes/app.dev-tryon-img.$handle.tsx
// Resource route: proxies private FASHN dev-test result images for the gallery.
//
// URL: /app/dev-tryon-img/:handle?t=<token>
// The token is a short-lived (10 min) process-scoped credential issued by the
// staff-authenticated dev-tryon loader. This route does NOT call Shopify auth
// because <img> sub-requests do not carry the Shopify JWT — the token
// substitutes for that auth signal for image delivery only.
//
// Never returns: credentials, signed URLs, asset IDs, or prediction IDs.

import type { LoaderFunctionArgs } from "react-router";
import {
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
} from "../lib/cloudinary-admin.server";
import { verifyImageToken } from "../lib/dev-tryon-image-tokens.server";

// Only slugs with confirmed dev-test results may be served.
const ALLOWED_SLUGS = new Set([
  // Batch 1 — product-owner-approved 2026-07-17
  "collar-shirt",
  "double-top-leather-underlayer",
  "leather-suede-jacket",
  "midi-dress",
  "trench-coat",
  // Batch 2 kimono — product-owner-approved 2026-07-17
  "kimono-jacket",
  // Batch 3 — 4 re-runs + 6 new components stored 2026-07-17
  "cropped-top",
  "asymmetrical-pants",
  "straight-pants",
  "suede-skirt",
  "double-top-full-layered-top",
  "double-top-chiffon-overlay",
  "dress-set-complete-set",
  "dress-set-corset",
  "dress-set-mesh-top",
  "dress-set-skirt",
]);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const slug = params.handle ?? "";

  if (!ALLOWED_SLUGS.has(slug)) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";

  if (!verifyImageToken(token, slug)) {
    return new Response("Forbidden", { status: 403 });
  }

  const cfg = getCloudinaryConfig();
  if (!cfg) {
    return new Response("Service unavailable", { status: 503 });
  }

  // Derive the stored public ID — identical to devResultPublicId() in the harness.
  const publicId = `naia-tryon/dev-test/${slug}`;
  const dlUrl = buildPrivateDownloadUrl(cfg, publicId, "png", "private");

  try {
    const upstream = await fetch(dlUrl);
    if (upstream.status === 404) return new Response("Not found", { status: 404 });
    if (!upstream.ok) return new Response("Upstream error", { status: 502 });

    const bytes = await upstream.arrayBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Service unavailable", { status: 503 });
  }
}
