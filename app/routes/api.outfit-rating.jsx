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
    return Response.json({ ratings: [], authenticated: false }, { headers: CORS });
  }
  const url = new URL(request.url);
  const historyId = url.searchParams.get("historyId");
  if (historyId) {
    const rating = await prisma.outfitRating.findUnique({ where: { historyId } });
    return Response.json({ rating, authenticated: true }, { headers: CORS });
  }
  const ratings = await prisma.outfitRating.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Response.json({ ratings, authenticated: true }, { headers: CORS });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: CORS });
  }
  const body = await request.json();
  const { historyId, confidence, feltLikeMe, wouldWearAgain, physicallyComfortable, mood, feeling, event, styleWords } = body;
  if (!historyId || confidence === undefined) {
    return Response.json({ error: "historyId and confidence required" }, { status: 400, headers: CORS });
  }
  const history = await prisma.outfitHistory.findFirst({
    where: { id: historyId, customerId: customer.id },
  });
  if (!history) {
    return Response.json({ error: "Outfit not found" }, { status: 404, headers: CORS });
  }
  try {
    const existing = await prisma.outfitRating.findUnique({ where: { historyId } });
    let rating;
    if (existing) {
      rating = await prisma.outfitRating.update({
        where: { historyId },
        data: {
          confidence: Number(confidence),
          feltLikeMe: feltLikeMe ?? null,
          wouldWearAgain: wouldWearAgain ?? null,
          physicallyComfortable: physicallyComfortable ?? null,
        },
      });
    } else {
      rating = await prisma.outfitRating.create({
        data: {
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
    }
    return Response.json({ rating }, { headers: CORS });
  } catch (err) {
    console.error("Rating save error:", err);
    return Response.json({ error: "Failed to save rating" }, { status: 500, headers: CORS });
  }
}
