import { authenticateCustomer } from "../customer-auth.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/customer-profile — returns customer info + last styling prefs for quick re-style
 */
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ customer: null, authenticated: false }, { headers: CORS });
  }

  let lastStyleWords = [];
  try {
    lastStyleWords = customer.lastStyleWords ? JSON.parse(customer.lastStyleWords) : [];
  } catch {}

  return Response.json({
    authenticated: true,
    customer: {
      id: customer.id,
      shopifyId: customer.shopifyId,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      lastMood: customer.lastMood,
      lastFeeling: customer.lastFeeling,
      lastEvent: customer.lastEvent,
      lastStyleWords,
      lastBodyPref: customer.lastBodyPref,
      lastMode: customer.lastMode,
    },
  }, { headers: CORS });
}
