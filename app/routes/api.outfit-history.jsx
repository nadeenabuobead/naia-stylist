import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/outfit-history — fetch past styling results (most recent first)
 */
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

  const history = await prisma.outfitHistory.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return Response.json({ history, authenticated: true }, { headers: CORS });
}

/**
 * POST /api/outfit-history — save a styling result
 * Body: { mood, feeling, event, styleWords, bodyPref, mode, closetItemIds, result }
 */
export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: CORS });
  }

  const body = await request.json();
  const { mood, feeling, event, styleWords, bodyPref, mode, closetItemIds, result } = body;

  if (!result) {
    return Response.json({ error: "Result required" }, { status: 400, headers: CORS });
  }

  const entry = await prisma.outfitHistory.create({
    data: {
      customerId: customer.id,
      mood: mood || null,
      feeling: feeling || null,
      event: event || null,
      styleWords: Array.isArray(styleWords) ? JSON.stringify(styleWords) : styleWords || null,
      bodyPref: bodyPref || null,
      mode: mode || null,
      closetItemIds: Array.isArray(closetItemIds) ? JSON.stringify(closetItemIds) : closetItemIds || null,
      result,
    },
  });

  // Also save preferences for quick re-style
  await prisma.customer.update({
    where: { id: customer.id },
    data: {
      lastMood: mood || undefined,
      lastFeeling: feeling || undefined,
      lastEvent: event || undefined,
      lastStyleWords: Array.isArray(styleWords) ? JSON.stringify(styleWords) : styleWords || undefined,
      lastBodyPref: bodyPref || undefined,
      lastMode: mode || undefined,
    },
  });

  return Response.json({ entry }, { headers: CORS });
}
