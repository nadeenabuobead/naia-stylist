import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/confidence-dashboard — aggregated confidence data for the customer
 * Returns:
 *   - averageConfidence
 *   - totalRatings
 *   - feltLikeMePercent
 *   - wouldWearAgainPercent
 *   - physicallyComfortablePercent
 *   - bestMoods (moods with highest confidence)
 *   - bestEvents (events with highest confidence)
 *   - bestStyleWords (style words with highest confidence)
 *   - recentRatings (last 10 with outfit context)
 */
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ dashboard: null, authenticated: false }, { headers: CORS });
  }

  const ratings = await prisma.outfitRating.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    include: {
      history: {
        select: { mood: true, feeling: true, event: true, styleWords: true, result: true, createdAt: true },
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
        physicallyComfortablePercent: 0,
        bestMoods: [],
        bestEvents: [],
        bestStyleWords: [],
        recentRatings: [],
        confidenceOverTime: [],
      },
    }, { headers: CORS });
  }

  // Basic stats
  const totalRatings = ratings.length;
  const avgConfidence = ratings.reduce((sum, r) => sum + r.confidence, 0) / totalRatings;
  const feltLikeMeCount = ratings.filter(r => r.feltLikeMe === true).length;
  const wouldWearAgainCount = ratings.filter(r => r.wouldWearAgain === true).length;
  const comfortCount = ratings.filter(r => r.physicallyComfortable === true).length;
  const ratedBool = (field) => ratings.filter(r => r[field] !== null).length || 1;

  // Best moods — group by mood, average confidence
  const moodMap = {};
  const eventMap = {};
  const styleMap = {};

  for (const r of ratings) {
    const mood = r.mood || r.history?.mood;
    const event = r.event || r.history?.event;
    let words = r.styleWords || r.history?.styleWords;

    if (mood) {
      if (!moodMap[mood]) moodMap[mood] = { total: 0, count: 0 };
      moodMap[mood].total += r.confidence;
      moodMap[mood].count += 1;
    }

    if (event) {
      if (!eventMap[event]) eventMap[event] = { total: 0, count: 0 };
      eventMap[event].total += r.confidence;
      eventMap[event].count += 1;
    }

    if (words) {
      try {
        if (typeof words === "string") words = JSON.parse(words);
      } catch { words = []; }
      if (Array.isArray(words)) {
        for (const w of words) {
          if (!styleMap[w]) styleMap[w] = { total: 0, count: 0 };
          styleMap[w].total += r.confidence;
          styleMap[w].count += 1;
        }
      }
    }
  }

  const sortByAvg = (map) =>
    Object.entries(map)
      .map(([key, val]) => ({ name: key, avg: Math.round((val.total / val.count) * 10) / 10, count: val.count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);

  // Confidence over time (last 20 ratings, oldest first)
  const confidenceOverTime = ratings
    .slice(0, 20)
    .reverse()
    .map(r => ({
      date: r.createdAt,
      confidence: r.confidence,
      event: r.event || r.history?.event || "",
    }));

  // Recent ratings with context
  const recentRatings = ratings.slice(0, 10).map(r => ({
    id: r.id,
    confidence: r.confidence,
    feltLikeMe: r.feltLikeMe,
    wouldWearAgain: r.wouldWearAgain,
    physicallyComfortable: r.physicallyComfortable,
    mood: r.mood || r.history?.mood,
    feeling: r.feeling || r.history?.feeling,
    event: r.event || r.history?.event,
    date: r.createdAt,
  }));

  return Response.json({
    authenticated: true,
    dashboard: {
      totalRatings,
      averageConfidence: Math.round(avgConfidence * 10) / 10,
      feltLikeMePercent: Math.round((feltLikeMeCount / ratedBool("feltLikeMe")) * 100),
      wouldWearAgainPercent: Math.round((wouldWearAgainCount / ratedBool("wouldWearAgain")) * 100),
      physicallyComfortablePercent: Math.round((comfortCount / ratedBool("physicallyComfortable")) * 100),
      bestMoods: sortByAvg(moodMap),
      bestEvents: sortByAvg(eventMap),
      bestStyleWords: sortByAvg(styleMap),
      recentRatings,
      confidenceOverTime,
    },
  }, { headers: CORS });
}
