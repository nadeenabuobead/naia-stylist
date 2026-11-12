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
  console.log("Review data received:", { workedTags: body.workedTags, didntWorkTags: body.didntWorkTags });
  console.log("Review data received:", { workedTags: body.workedTags, didntWorkTags: body.didntWorkTags });
  const { historyId, overallReaction, feltLikeMe, desiredFeelingAchieved, wouldWearAgain, physicalComfort, workedTags, didntWorkTags, objections, additionalNotes, mood, feeling, event, styleWords } = body;
  if (!historyId || overallReaction === undefined) {
    return Response.json({ error: "historyId and confidence required" }, { status: 400, headers: CORS });
  }

  try {
    const existing = await prisma.postOutfitReview.findUnique({
      where: { sessionId: historyId },
    });

    // Ownership (hotfix 2026-11-12) — an existing review belongs to whoever
    // created it; a client-supplied historyId must not let a different
    // authenticated customer overwrite it. "Not found" (not 403) avoids
    // confirming that a review exists for an ID that isn't the caller's.
    if (existing && existing.customerId !== customer.id) {
      return Response.json({ error: "Not found" }, { status: 404, headers: CORS });
    }

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
  // Ownership (hotfix 2026-11-12) — a review must not be created against a
  // session that belongs to a different customer, even under the caller's
  // own customerId; that would attach a styling session's feedback to the
  // wrong account's history.
  if (linkedSession && linkedSession.customerId !== customer.id) {
    return Response.json({ error: "Not found" }, { status: 404, headers: CORS });
  }
  console.log("Review linking to session:", { historyId, bodyPref: linkedSession?.bodyPreference, styleDNA: linkedSession?.styleDNA, pieces: linkedSession?.suggestions?.[0]?.items?.map(i => i.productTitle || `Closet ${i.closetItemId}`) || [] });
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