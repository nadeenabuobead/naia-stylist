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
        feltLikeMePercent: 0,
        wouldWearAgainPercent: 0,
        bestMoods: [],
        bestEvents: [],
        recentRatings: [],
      },
    }, { headers: CORS });
  }

  const totalRatings = ratings.length;

  // Calculate percentages using new string values
  const feltLikeMeCount = ratings.filter(r => r.feltLikeHer === "Yes").length;
  const wouldWearAgainCount = ratings.filter(r => r.wouldWearAgain === "Definitely").length;

  const feltLikeMePercent = Math.round((feltLikeMeCount / totalRatings) * 100);
  const wouldWearAgainPercent = Math.round((wouldWearAgainCount / totalRatings) * 100);

  // Aggregate by mood → feeling pairs for emotional shifts
  const shiftMap = {};
  const eventMap = {};

  for (const r of ratings) {
    const mood = r.session?.currentMood;
    const feeling = r.session?.desiredFeeling;
    const event = r.session?.occasion;
    const score = r.overallFeeling || 0;

    // Track emotional shifts (mood → feeling)
    if (mood && feeling) {
      const shift = `${mood} → ${feeling}`;
      if (!shiftMap[shift]) shiftMap[shift] = { total: 0, count: 0 };
      shiftMap[shift].total += score;
      shiftMap[shift].count += 1;
    }

    // Track events
    if (event) {
      if (!eventMap[event]) eventMap[event] = { total: 0, count: 0 };
      eventMap[event].total += score;
      eventMap[event].count += 1;
    }
  }

  // Sort by average score
  const sortByAvg = (map) =>
    Object.entries(map)
      .map(([key, val]) => ({ name: key, avg: Math.round((val.total / val.count) * 10) / 10, count: val.count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5);

  const bestMoods = sortByAvg(shiftMap);
  const bestEvents = sortByAvg(eventMap);

  // Recent ratings with notes
  const recentRatings = ratings.slice(0, 20).map(r => ({
    mood: r.session?.currentMood || "",
    feeling: r.session?.desiredFeeling || "",
    event: r.session?.occasion || "",
    feltLikeMe: r.feltLikeHer,
    wouldWearAgain: r.wouldWearAgain,
    notes: r.additionalNotes || "",
    overallFeeling: r.overallFeeling,
  }));

  return Response.json({
    authenticated: true,
    dashboard: {
      totalRatings,
      feltLikeMePercent,
      wouldWearAgainPercent,
      bestMoods,
      bestEvents,
      recentRatings,
    },
  }, { headers: CORS });
}