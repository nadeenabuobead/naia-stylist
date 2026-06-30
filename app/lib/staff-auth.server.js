import { authenticate } from "../shopify.server";

// Internal Designer Intelligence data must never be reachable by shop install
// alone — authenticate.admin only proves a valid Shopify Admin session for
// *some* shop that installed nAia, not that it's an approved shop. The
// allowlist below is the actual restriction. Fails closed: a missing or
// empty allowlist, or a shop not on it, is always a 403.
export async function requireStaffAccess(request) {
  const { session } = await authenticate.admin(request);

  const allowedShops = (process.env.DESIGNER_INTELLIGENCE_ALLOWED_SHOPS || "")
    .split(",")
    .map((shop) => shop.trim().toLowerCase())
    .filter(Boolean);

  if (allowedShops.length === 0 || !allowedShops.includes(session.shop.toLowerCase())) {
    throw new Response("Forbidden", { status: 403 });
  }

  return session;
}
