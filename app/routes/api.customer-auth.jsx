import { createCustomerToken } from "../customer-auth.server";

const CORS = {
  "Access-Control-Allow-Origin": "https://naiabynadine.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function loader({ request }) {
  return new Response(null, { status: 200, headers: CORS });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS });
  }

  try {
    const body = await request.json();
    const { shopifyId, email, firstName, lastName } = body;

    if (!shopifyId) {
      return Response.json({ error: "Missing shopifyId" }, { status: 400, headers: CORS });
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
    }, { headers: CORS });

  } catch (err) {
    console.error("Customer auth error:", err);
    return Response.json({ error: "Authentication failed" }, { status: 500, headers: CORS });
  }
}
