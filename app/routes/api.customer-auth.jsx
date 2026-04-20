import { createCustomerToken } from "../customer-auth.server";

/**
 * POST /api/customer-auth
 * 
 * Called from the Shopify storefront to authenticate a customer.
 * The customer data comes from Shopify's Liquid {{ customer }} object
 * which is server-rendered and trustworthy.
 * 
 * Body: { shopifyId, email, firstName, lastName }
 * Returns: { token, customer: { shopifyId, email, firstName, lastName } }
 */
export async function action({ request }) {
  const headers = {
    "Access-Control-Allow-Origin": "https://naiabynadine.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  try {
    const body = await request.json();
    const { shopifyId, email, firstName, lastName } = body;

    if (!shopifyId) {
      return Response.json({ error: "Missing shopifyId" }, { status: 400, headers });
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
      "Access-Control-Allow-Origin": "https://naiabynadine.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
