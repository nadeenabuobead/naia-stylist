// nAia Admin authentication gate.
//
// Separate from the NADINE Designer Intelligence gate (requireStaffAccess).
// Uses dedicated env vars so Designer Intelligence access does NOT implicitly
// grant access to individual customer Passport / Closet / StyleMe data.
//
// Required env vars:
//   NAIA_ADMIN_ALLOWED_SHOPS            — comma-separated shop domains
//   NAIA_ADMIN_ALLOWED_EMAILS           — comma-separated email allowlist (optional)
//   NAIA_ADMIN_REQUIRE_ACCOUNT_OWNER    — "true" | "false" (optional)
//
// All three layers must pass. Fails closed: empty shop allowlist → always 403.

import { authenticate } from "../shopify.server";

export async function requireNaiaAdminAccess(request: Request) {
  const { session } = await authenticate.admin(request);

  // ── Layer 1: dedicated shop allowlist ────────────────────────────────────
  const allowedShops = (process.env.NAIA_ADMIN_ALLOWED_SHOPS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (allowedShops.length === 0 || !allowedShops.includes(session.shop.toLowerCase())) {
    throw new Response("Forbidden", { status: 403 });
  }

  // ── Layer 2: optional account-owner restriction ──────────────────────────
  if (process.env.NAIA_ADMIN_REQUIRE_ACCOUNT_OWNER === "true") {
    if (!session.accountOwner) {
      throw new Response("Forbidden — account owner access required", { status: 403 });
    }
  }

  // ── Layer 3: optional per-email allowlist ────────────────────────────────
  const allowedEmails = (process.env.NAIA_ADMIN_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowedEmails.length > 0 && session.email) {
    if (!allowedEmails.includes(session.email.toLowerCase())) {
      throw new Response("Forbidden — your account is not on the nAia admin allowlist", { status: 403 });
    }
  }

  return session;
}
