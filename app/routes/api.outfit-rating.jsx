import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/outfit-rating?historyId=xxx — fetch rating for a specific outfit
 * GET /api/outfit-rating — fetch all ratings for the customer
 */
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ ratings: [], authenticated: false }, { headers: CORS });
  }

  const url = new URL(request.url);
  const historyId = url.searchParams.get("historyId");

  if (historyId) {
    const rating = await prisma.outfitRating.findFirst({
      where: { customerId: customer.id, historyId },
    });
    return Response.json({ rating, authenticated: true }, { headers: CORS });
  }

  const ratings = await prisma.outfitRating.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return Response.json({ ratings, authenticated: true }, { headers: CORS });
}

/**
 * POST /api/outfit-rating — save a confidence rating
 * Body: { historyId, confidence, feltLikeMe, wouldWearAgain, physicallyComfortable, mood, feeling, event, styleWords }
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
  const {
    historyId,
    confidence,
    feltLikeMe,
    wouldWearAgain,
    physicallyComfortable,
    mood,
    feeling,
    event,
    styleWords,
  } = body;

  if (!historyId || confidence === undefined) {
    return Response.json({ error: "historyId and confidence required" }, { status: 400, headers: CORS });
  }

  // Verify the outfit history belongs to this customer
  const history = await prisma.outfitHistory.findFirst({
    where: { id: historyId, customerId: customer.id },
  });
  if (!history) {
    return Response.json({ error: "Outfit not found" }, { status: 404, headers: CORS });
  }

  // Upsert — allow updating an existing rating
  const rating = await prisma.outfitRating.upsert({
    where: {
      customerId_historyId: {
        customerId: customer.id,
        historyId,
      },
    },
    update: {
      confidence: Number(confidence),
      feltLikeMe: feltLikeMe ?? null,
      wouldWearAgain: wouldWearAgain ?? null,
      physicallyComfortable: physicallyComfortable ?? null,
    },
    create: {
      customerId: customer.id,
      historyId,
      confidence: Number(confidence),
      feltLikeMe: feltLikeMe ?? null,
      wouldWearAgain: wouldWearAgain ?? null,
      physicallyComfortable: physicallyComfortable ?? null,
      mood: mood || history.mood || null,
      feeling: feeling || history.feeling || null,
      event: event || history.event || null,
      styleWords: styleWords || history.styleWords || null,
    },
  });

  return Response.json({ rating }, { headers: CORS });
}
