import prisma from "../db.server";
export const config = { runtime: 'nodejs' };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // TODO: Add admin authentication here
  // For now, this is open - you should add a password or admin check

  try {
    // Get all reviews
    const allReviews = await prisma.postOutfitReview.findMany({
      include: {
        session: {
          select: {
            currentMood: true,
            desiredFeeling: true,
            occasion: true,
            specificNeeds: true,
          },
        },
      },
    });

    const totalReviews = allReviews.length;
    const totalUsers = await prisma.customer.count();

    // Calculate averages
    const avgOverallFeeling = allReviews.reduce((sum, r) => sum + (r.overallFeeling || 0), 0) / totalReviews || 0;
    const feltLikeMePercent = Math.round((allReviews.filter(r => r.feltLikeHer === "Yes").length / totalReviews) * 100) || 0;
    const wouldWearAgainPercent = Math.round((allReviews.filter(r => r.wouldWearAgain === "Definitely").length / totalReviews) * 100) || 0;

    // Aggregate tags
    const workedTagsMap = {};
    const didntWorkTagsMap = {};
    
    for (const r of allReviews) {
      if (r.workedTags) {
        try {
          const tags = JSON.parse(r.workedTags);
          tags.forEach(tag => {
            workedTagsMap[tag] = (workedTagsMap[tag] || 0) + 1;
          });
        } catch {}
      }
      if (r.didntWorkTags) {
        try {
          const tags = JSON.parse(r.didntWorkTags);
          tags.forEach(tag => {
            didntWorkTagsMap[tag] = (didntWorkTagsMap[tag] || 0) + 1;
          });
        } catch {}
      }
    }

    // Top tags
    const topWorkedTags = Object.entries(workedTagsMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    const topDidntWorkTags = Object.entries(didntWorkTagsMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));

    // Aggregate occasions
    const occasionMap = {};
    const moodShiftMap = {};
    
    for (const r of allReviews) {
      if (r.session?.occasion) {
        if (!occasionMap[r.session.occasion]) {
          occasionMap[r.session.occasion] = { total: 0, count: 0 };
        }
        occasionMap[r.session.occasion].total += r.overallFeeling || 0;
        occasionMap[r.session.occasion].count += 1;
      }

      if (r.session?.currentMood && r.session?.desiredFeeling) {
        const shift = `${r.session.currentMood} → ${r.session.desiredFeeling}`;
        if (!moodShiftMap[shift]) {
          moodShiftMap[shift] = { total: 0, count: 0 };
        }
        moodShiftMap[shift].total += r.overallFeeling || 0;
        moodShiftMap[shift].count += 1;
      }
    }

    // Best occasions
    const bestOccasions = Object.entries(occasionMap)
      .map(([name, data]) => ({ name, avg: data.total / data.count, count: data.count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10);

    // Best mood shifts
    const bestMoodShifts = Object.entries(moodShiftMap)
      .map(([name, data]) => ({ name, avg: data.total / data.count, count: data.count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10);

    // Get all styling sessions with body preferences
    const allSessions = await prisma.stylingSession.findMany({
      select: {
        bodyPreference: true,
        occasion: true,
      },
    });

    // Aggregate body preferences
    const bodyPrefMap = {};
    allSessions.forEach(s => {
      if (s.bodyPreference) {
        bodyPrefMap[s.bodyPreference] = (bodyPrefMap[s.bodyPreference] || 0) + 1;
      }
    });

    const topBodyPrefs = Object.entries(bodyPrefMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pref, count]) => ({ pref, count }));

    return Response.json({
      dashboard: {
        totalReviews,
        totalUsers,
        avgOverallFeeling: Math.round(avgOverallFeeling * 10) / 10,
        feltLikeMePercent,
        wouldWearAgainPercent,
        topWorkedTags,
        topDidntWorkTags,
        bestOccasions,
        bestMoodShifts,
        topBodyPrefs,
      },
    }, { headers: CORS });
  } catch (err) {
    console.error("Designer dashboard error:", err);
    return Response.json({ error: "Failed to load dashboard" }, { status: 500, headers: CORS });
  }
}