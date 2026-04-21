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
    return Response.json({ dashboard: null, authenticated: false }, { headers: CORS });
  }

  const ratings = await prisma.postOutfitReview.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    include: {
      session: {
        select: { currentMood: true, desiredFeeling: true, occasion: true, specificNeeds: true, createdAt: true },
      },
    },
  });

  if (ratings.length === 0) {
    return Response.json({
      authenticated: true,
      dashboard: {
        totalRatings: 0,
        averageConfidence: 0,
        feltLikeMePercent: 0,
        wouldWearAgainPercent: 0,
        bestMoods: [],
        bestEvents: [],
        recentRatings: [],
        confidenceOverTime: [],
      },
    }, { headers: CORS });
  }

  const totalRatings = ratings.length;
  const avgConfidence = ratings.reduce((sum, r) => sum + (r.overallFeeling || 0), 0) / totalRatings;
  const feltLikeMeCount = ratings.filter(r => r.feltLikeHer === true).length;
  const wouldWearAgainCount = ratings.filter(r => r.wouldWearAgain === true).length;

  const moodMap = {};
  const eventMap = {};

  for (const r of ratings) {
    const mood = r.session?.currentMood;
    const event = r.session?.occasion;

    if (mood) {
      if (!moodMap[mood]) moodMap[mood] = { total: 0, count: 0 };
      moodMap[mood].total += r.overallFeeling || 0;
      moodMap[mood].count += 1;
    }

    if (event) {
      if (!eventMap[event]) eventMap[event] = { total: 0, count: 0 };
      eventMap[event].total += r.overallFeeling || 0;
      eventMap[event].count += 1;
    }
  }

  const sortByAvg = (map) =>
    Object.entries(map)
      .map(([key, val]) => ({ name: key, avg: Math.round((val.total / val.count) * 10) / 10, count: val.count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);

  const confidenceOverTime = ratings
    .slice(0, 20)
    .reverse()
    .map(r => ({
      date: r.createdAt,
      confidence: r.overallFeeling,
      event: r.session?.occasion || "",
    }));

  const recentRatings = ratings.slice(0, 10).map(r => ({
    id: r.id,
    confidence: r.overallFeeling,
    feltLikeMe: r.feltLikeHer,
    wouldWearAgain: r.wouldWearAgain,
    notes: r.additionalNotes,
    mood: r.session?.currentMood,
    feeling: r.session?.desiredFeeling,
    event: r.session?.occasion,
    createdAt: r.createdAt,
  }));

  return Response.json({
    authenticated: true,
    dashboard: {
      totalRatings,
      averageConfidence: Math.round(avgConfidence * 10) / 10,
      feltLikeMePercent: Math.round((feltLikeMeCount / totalRatings) * 100),
      wouldWearAgainPercent: Math.round((wouldWearAgainCount / totalRatings) * 100),
      bestMoods: sortByAvg(moodMap),
      bestEvents: sortByAvg(eventMap),
      recentRatings,
      confidenceOverTime,
    },
  }, { headers: CORS });
}