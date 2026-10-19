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
  const reviews = await prisma.postOutfitReview.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Response.json({ ratings: reviews, authenticated: true }, { headers: CORS });
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
  // 2026-10-19 privacy review: this was a duplicated log line previously printing
  // the full tag arrays; counts only now, matching the pattern applied elsewhere.
  console.log("Review data received:", { workedTagCount: body.workedTags?.length ?? 0, didntWorkTagCount: body.didntWorkTags?.length ?? 0 });
  const { historyId, overallReaction, feltLikeMe, desiredFeelingAchieved, wouldWearAgain, physicalComfort, workedTags, didntWorkTags, objections, additionalNotes, mood, feeling, event, styleWords } = body;
  if (!historyId || overallReaction === undefined) {
    return Response.json({ error: "historyId and confidence required" }, { status: 400, headers: CORS });
  }

  try {
    const existing = await prisma.postOutfitReview.findUnique({
      where: { sessionId: historyId },
    });

    let review;
    if (existing) {
      review = await prisma.postOutfitReview.update({
        where: { sessionId: historyId },
        data: {
  overallFeeling: Number(overallReaction),
  feltLikeHer: feltLikeMe ?? null,
  desiredFeelingAchieved: desiredFeelingAchieved ?? null,
  wouldWearAgain: wouldWearAgain ?? null,
  physicallyComfortable: physicalComfort ?? null,
  workedTags: workedTags ? JSON.stringify(workedTags) : null,
  didntWorkTags: didntWorkTags ? JSON.stringify(didntWorkTags) : null,
  objections: objections || null,
  additionalNotes: additionalNotes || null,
},
      });
    } else {
  // Debug: Check the session being linked
  const linkedSession = await prisma.stylingSession.findUnique({ where: { id: historyId }, include: { suggestions: { include: { items: true } } } });
  // 2026-10-19 privacy review: previously logged bodyPreference, styleDNA, and
  // product titles — body-related and style-preference data with no debugging
  // need for the actual content, only whether the link resolved.
  console.log("Review linking to session:", { historyId, sessionFound: !!linkedSession, pieceCount: linkedSession?.suggestions?.[0]?.items?.length ?? 0 });
  review = await prisma.postOutfitReview.create({
    data: {
      customerId: customer.id,
      sessionId: historyId,
      overallFeeling: Number(overallReaction),
      feltLikeHer: feltLikeMe ?? null,
      desiredFeelingAchieved: desiredFeelingAchieved ?? null,
      wouldWearAgain: wouldWearAgain ?? null,
      physicallyComfortable: physicalComfort ?? null,
      workedTags: workedTags ? JSON.stringify(workedTags) : null,
      didntWorkTags: didntWorkTags ? JSON.stringify(didntWorkTags) : null,
      objections: objections || null,
      additionalNotes: additionalNotes || null,
    },
  });
}
    return Response.json({ rating: review }, { headers: CORS });
  } catch (err) {
    console.error("Rating save error:", err);
    return Response.json({ error: "Failed to save rating" }, { status: 500, headers: CORS });
  }
}