import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

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

  // Get style intelligence from reviews
  const reviews = await prisma.postOutfitReview.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      session: {
        select: { currentMood: true, desiredFeeling: true, occasion: true },
      },
    },
  });

  // Build style intelligence summary
  let styleIntelligence = null;
  if (reviews.length > 0) {
    const positiveOccasions = reviews
      .filter(r => r.wouldWearAgain && r.feltLikeHer)
      .map(r => r.session?.occasion)
      .filter(Boolean);

    const negativeOccasions = reviews
      .filter(r => r.wouldWearAgain === false || r.feltLikeHer === false)
      .map(r => r.session?.occasion)
      .filter(Boolean);

    const positiveMoods = reviews
      .filter(r => r.wouldWearAgain && r.feltLikeHer)
      .map(r => r.session?.currentMood)
      .filter(Boolean);

    const notes = reviews
      .filter(r => r.additionalNotes)
      .map(r => r.additionalNotes)
      .slice(0, 3);

    styleIntelligence = {
      totalReviews: reviews.length,
      positiveOccasions: [...new Set(positiveOccasions)],
      negativeOccasions: [...new Set(negativeOccasions)],
      positiveMoods: [...new Set(positiveMoods)],
      recentNotes: notes,
    };
  }

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
      styleIntelligence,
    },
  }, { headers: CORS });
}