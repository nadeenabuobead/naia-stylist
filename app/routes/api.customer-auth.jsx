import crypto from "crypto";
import { createCustomerToken } from "../customer-auth.server";

/**
 * POST /api/customer-auth
 * 
 * Called from the Shopify storefront to authenticate a customer.
 * Expects a signed payload from the storefront extension (using the app proxy signature)
 * OR a direct payload with customer info for development.
 * 
 * Body: { shopifyId, email, firstName, lastName, signature, timestamp }
 * Returns: { token, customer: { shopifyId, email, firstName, lastName } }
 */
export async function action({ request }) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const body = await request.json();
    const { shopifyId, email, firstName, lastName, signature, timestamp } = body;

    if (!shopifyId) {
      return Response.json({ error: "Missing shopifyId" }, { status: 400, headers });
    }

    // Verify the signature from the storefront extension
    // The extension signs: shopifyId + timestamp with the shared secret
    const secret = process.env.NAIA_CUSTOMER_SECRET || process.env.SHOPIFY_API_SECRET || "";
    
    if (signature && timestamp) {
      // Production: verify signature
      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(`${shopifyId}:${timestamp}`)
        .digest("hex");
      
      const timeDiff = Math.abs(Date.now() - Number(timestamp));
      if (timeDiff > 5 * 60 * 1000) {
        return Response.json({ error: "Expired request" }, { status: 401, headers });
      }
      
      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
        return Response.json({ error: "Invalid signature" }, { status: 401, headers });
      }
    } else if (process.env.NODE_ENV === "production") {
      // In production, require signature
      return Response.json({ error: "Missing signature" }, { status: 401, headers });
    }

    const token = createCustomerToken({
      shopifyId: String(shopifyId),
      email: email || null,
      firstName: firstName || null,
      lastName: lastName || null,
    });

    return Response.json({
      token,
      customer: { shopifyId: String(shopifyId), email, firstName, lastName },
    }, { headers });

  } catch (err) {
    console.error("Customer auth error:", err);
    return Response.json({ error: "Authentication failed" }, { status: 500, headers });
  }
}

// Handle preflight
export async function loader() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
