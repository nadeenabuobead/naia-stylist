import jwt from "jsonwebtoken";
import prisma from "./db.server";

const SECRET = process.env.NAIA_CUSTOMER_SECRET || process.env.SHOPIFY_API_SECRET || "naia-fallback-secret";

/**
 * Create a signed token for a storefront customer.
 * Called from the storefront proxy endpoint when Shopify confirms the customer.
 */
export function createCustomerToken({ shopifyId, email, firstName, lastName }) {
  return jwt.sign(
    { shopifyId: String(shopifyId), email, firstName, lastName },
    SECRET,
    { expiresIn: "30d" }
  );
}

/**
 * Verify a customer token from the request.
 * Returns { shopifyId, email, firstName, lastName } or null.
 */
export function verifyCustomerToken(token) {
  try {
    return jwt.verify(token, SECRET);
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
