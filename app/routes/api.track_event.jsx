import prisma from "../db.server";
import { authenticateCustomer } from "../customer-auth.server";
import { buildCorsHeaders } from "../lib/storefront-cors.server";

// React Router (and this project's every other dual-method API route, e.g.
// api.outfit-history.jsx) dispatches an OPTIONS preflight to the route's
// loader, never its action — this file had only an action, so its own
// `if (request.method === "OPTIONS")` branch inside action() was dead code,
// never reached. Preflight requests fell through to React Router's default
// no-loader handling instead, producing an inconsistent 400/500 instead of
// the intended 204. This loader exists solely to answer OPTIONS correctly;
// every real (non-preflight) call to this endpoint is a POST and still goes
// through action() exactly as before.
export async function loader({ request }) {
  const CORS = buildCorsHeaders(request, "POST, OPTIONS");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return new Response(null, { status: 405, headers: CORS });
}

export async function action({ request }) {
  const CORS = buildCorsHeaders(request, "POST, OPTIONS");
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  try {
    const { customer } = await authenticateCustomer(request);
    if (!customer) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
    }

    const body = await request.json();
    const { sessionId, productId, productTitle, eventType } = body;

    if (!sessionId || !productId || !eventType) {
      return Response.json({ error: "Missing required fields" }, { status: 400, headers: CORS });
    }

    const validEvents = ["clicked", "tryon", "wishlisted"];
    if (!validEvents.includes(eventType)) {
      return Response.json({ error: "Invalid event type" }, { status: 400, headers: CORS });
    }

    await prisma.stylingEvent.create({
      data: {
        customerId: customer.id,
        sessionId,
        productId,
        productTitle: productTitle || "Unknown",
        eventType,
      },
    });

    return Response.json({ success: true }, { headers: CORS });
  } catch (error) {
    console.error("Track event error:", error);
    return Response.json({ error: error.message }, { status: 500, headers: CORS });
  }
}
