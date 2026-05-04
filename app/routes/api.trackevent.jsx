import prisma from "../db.server";
import { authenticateCustomer } from "../customer-auth.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
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

    const validEvents = ["clicked", "tryon", "wishlisted", "addedToCart", "purchased"];
    if (!validEvents.includes(eventType)) {
      return Response.json({ error: "Invalid event type" }, { status: 400, headers: CORS });
    }

    const event = await prisma.stylingEvent.create({
      data: {
        customerId: customer.id,
        sessionId,
        productId,
        productTitle: productTitle || "Unknown",
        eventType,
      },
    });

    return Response.json({ success: true, event }, { headers: CORS });
  } catch (error) {
    console.error("Track event error:", error);
    return Response.json({ error: error.message }, { status: 500, headers: CORS });
  }
}
