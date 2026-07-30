import { authenticate } from "../shopify.server";

// Internal Designer Intelligence data must never be reachable by shop install
// alone — authenticate.admin only proves a valid Shopify Admin session for
// *some* shop that installed nAia, not that it's an approved shop.
//
// Access requires ALL of the following to pass:
//   1. Valid Shopify Admin session (authenticate.admin)
//   2. Shop is on DESIGNER_INTELLIGENCE_ALLOWED_SHOPS allowlist
//   3. If DESIGNER_INTELLIGENCE_ALLOWED_EMAILS is set, session email must be on it
//      (covers user-level granularity when multiple staff accounts exist)
//   4. If DESIGNER_INTELLIGENCE_REQUIRE_ACCOUNT_OWNER=true, session.accountOwner must be true
//
// Fails closed: missing/empty shop allowlist → always 403.
export async function requireStaffAccess(request) {
  const { session } = await authenticate.admin(request);

  // ── Layer 1: shop allowlist ──────────────────────────────────────────────
  const allowedShops = (process.env.DESIGNER_INTELLIGENCE_ALLOWED_SHOPS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowedShops.length === 0 || !allowedShops.includes(session.shop.toLowerCase())) {
    throw new Response("Forbidden", { status: 403 });
  }

  // ── Layer 2: optional account-owner restriction ──────────────────────────
  if (process.env.DESIGNER_INTELLIGENCE_REQUIRE_ACCOUNT_OWNER === "true") {
    if (!session.accountOwner) {
      throw new Response("Forbidden — account owner access required", { status: 403 });
    }
  }

  // ── Layer 3: optional per-email allowlist ────────────────────────────────
  const allowedEmails = (process.env.DESIGNER_INTELLIGENCE_ALLOWED_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowedEmails.length > 0 && session.email) {
    if (!allowedEmails.includes(session.email.toLowerCase())) {
      throw new Response("Forbidden — your account is not on the designer allowlist", { status: 403 });
    }
  }

  return session;
}
