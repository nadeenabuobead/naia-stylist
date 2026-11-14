import jwt from "jsonwebtoken";
import prisma from "./db.server";

// 2026-11-14 security hotfix: this previously fell back to a hardcoded,
// publicly-readable string ("naia-fallback-secret") if both real secrets were
// unset, which would let anyone who has read this source (this repo is
// public) forge a valid 30-day customer token in that configuration. Fails
// closed instead — no environment should ever be silently signing/verifying
// tokens with a secret that isn't actually secret. Confirmed via read-only,
// names-only Vercel env var inspection that both NAIA_CUSTOMER_SECRET and
// SHOPIFY_API_SECRET are actually configured in Production today, so this
// closes a defense-in-depth gap rather than a live exploit.
function getSecret() {
  const secret = process.env.NAIA_CUSTOMER_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("customer-auth: no NAIA_CUSTOMER_SECRET or SHOPIFY_API_SECRET configured");
  return secret;
}

/**
 * Create a signed token for a storefront customer.
 * Called from the storefront proxy endpoint when Shopify confirms the customer.
 */
export function createCustomerToken({ shopifyId, email, firstName, lastName }) {
  return jwt.sign(
    { shopifyId: String(shopifyId), email, firstName, lastName },
    getSecret(),
    { expiresIn: "30d" }
  );
}

/**
 * Verify a customer token from the request.
 * Returns { shopifyId, email, firstName, lastName } or null.
 */
export function verifyCustomerToken(token) {
  try {
    return jwt.verify(token, getSecret());
  } catch {
    return null;
  }
}

/**
 * Extract customer token from request headers or cookies.
 */
export function getCustomerTokenFromRequest(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  // Check cookie
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/naia_customer_token=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Full auth flow: extract token → verify → upsert customer in DB.
 * Returns { customer, token } or { customer: null, token: null }.
 */
export async function authenticateCustomer(request) {
  const token = getCustomerTokenFromRequest(request);
  if (!token) return { customer: null, token: null };

  const payload = verifyCustomerToken(token);
  if (!payload?.shopifyId) return { customer: null, token: null };

  try {
    const customer = await prisma.customer.upsert({
      where: { shopifyCustomerId: String(payload.shopifyId) },
      update: {
        email: payload.email || undefined,
        firstName: payload.firstName || undefined,
        lastName: payload.lastName || undefined,
      },
      create: {
        shopifyCustomerId: String(payload.shopifyId),
        email: payload.email || null,
        firstName: payload.firstName || null,
        lastName: payload.lastName || null,
      },
    });
    return { customer, token };
  } catch (err) {
    console.error("Customer auth DB error:", err);
    return { customer: null, token: null };
  }
}
