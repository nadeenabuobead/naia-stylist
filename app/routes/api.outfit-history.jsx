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
    include: {
      suggestions: {
        take: 1,
        include: { items: true }
      }
    }
  });

  const history = sessions.map(session => ({
    id: session.id,
    createdAt: session.createdAt,
    mood: session.currentMood,
    feeling: session.desiredFeeling,
    occasion: session.occasion,
    result: session.suggestions[0] ? {
      outfitName: session.suggestions[0].outfitName,
      whyThisWorks: session.suggestions[0].whyThisWorks,
      confidenceBoost: session.suggestions[0].confidenceBoost,
      perfumeRec: session.suggestions[0].perfumeRec,
      hairstyleRec: session.suggestions[0].hairstyleRec,
      makeupVibeRec: session.suggestions[0].makeupVibeRec,
      songRec: session.suggestions[0].songRec,
      items: session.suggestions[0].items
    } : null
  }));

  return Response.json({ history, authenticated: true }, { headers: CORS });
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return Response.json({ ok: true }, { headers: CORS });
}
