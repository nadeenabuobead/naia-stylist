import prisma from "../db.server";

export async function loader() {
  try {
    const reviews = await prisma.postOutfitReview.findMany({
      take: 100,
      orderBy: { createdAt: "desc" }
    });

    const totalReviews = reviews.length;
    const avgFeeling = reviews.reduce((sum, r) => sum + (r.overallFeeling || 0), 0) / totalReviews || 0;
    const feltLikeMe = reviews.filter(r => r.feltLikeHer === "Yes").length;
    const wouldWear = reviews.filter(r => r.wouldWearAgain === "Definitely").length;

    return Response.json({
      totalReviews,
      avgFeeling: Math.round(avgFeeling * 10) / 10,
      feltLikeMePercent: Math.round((feltLikeMe / totalReviews) * 100) || 0,
      wouldWearPercent: Math.round((wouldWear / totalReviews) * 100) || 0,
    });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}