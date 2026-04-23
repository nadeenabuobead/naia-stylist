import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ history: [], authenticated: false }, { headers: CORS });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);

  const sessions = await prisma.stylingSession.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const history = sessions.map(session => ({
    id: session.id,
    createdAt: session.createdAt,
    mood: session.currentMood,
    feeling: session.desiredFeeling,
    event: session.occasion,
    result: session.specificNeeds || null,
  }));

  return Response.json({ history, authenticated: true }, { headers: CORS });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: CORS });
  }

  try {
    const body = await request.json();
    const { sessionId } = body;

    // Just return the session ID passed from the frontend, don't create a new session
    return Response.json({ ok: true, entry: { id: sessionId } }, { headers: CORS });
  } catch (err) {
    console.error("History save error:", err);
    return Response.json({ error: "Failed to save" }, { status: 500, headers: CORS });
  }
}