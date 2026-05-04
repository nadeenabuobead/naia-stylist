// app/utils/stylingConversion.server.js
import { prisma } from "~/db.server";

export async function trackStylingRecommendation({
  userId,
  productId,
  sessionId,
  lookId = null,
}) {
  return await prisma.stylingRecommendation.create({
    data: {
      userId,
      productId,
      sessionId,
      lookId,
    },
  });
}

export async function trackProductClick({ userId, productId, sessionId }) {
  const recommendation = await prisma.stylingRecommendation.findFirst({
    where: { userId, productId, sessionId },
    orderBy: { recommendedAt: 'desc' },
  });

  if (recommendation) {
    return await prisma.stylingRecommendation.update({
      where: { id: recommendation.id },
      data: { clicked: true, clickedAt: new Date() },
    });
  }
}

export async function trackVirtualTryOn({ userId, productId, sessionId }) {
  const recommendation = await prisma.stylingRecommendation.findFirst({
    where: { userId, productId, sessionId },
    orderBy: { recommendedAt: 'desc' },
  });

  if (recommendation) {
    return await prisma.stylingRecommendation.update({
      where: { id: recommendation.id },
      data: { virtualTryOn: true, virtualTryOnAt: new Date() },
    });
  }
}

export async function trackProductSaved({ userId, productId, sessionId }) {
  const recommendation = await prisma.stylingRecommendation.findFirst({
    where: { userId, productId, sessionId },
    orderBy: { recommendedAt: 'desc' },
  });

  if (recommendation) {
    return await prisma.stylingRecommendation.update({
      where: { id: recommendation.id },
      data: { saved: true, savedAt: new Date() },
    });
  }
}

export async function trackAddToCart({ userId, productId, sessionId }) {
  const recommendation = await prisma.stylingRecommendation.findFirst({
    where: { userId, productId, sessionId },
    orderBy: { recommendedAt: 'desc' },
  });

  if (recommendation) {
    return await prisma.stylingRecommendation.update({
      where: { id: recommendation.id },
      data: { addedToCart: true, addedToCartAt: new Date() },
    });
  }
}

export async function trackPurchase({ userId, productId, orderId }) {
  const recommendation = await prisma.stylingRecommendation.findFirst({
    where: {
      userId,
      productId,
      purchased: false,
      recommendedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { recommendedAt: 'desc' },
  });

  if (recommendation) {
    return await prisma.stylingRecommendation.update({
      where: { id: recommendation.id },
      data: { purchased: true, purchasedAt: new Date(), orderId },
    });
  }
}

export async function getProductConversionStats(productId, dateFrom = null) {
  const whereClause = {
    productId,
    ...(dateFrom && { recommendedAt: { gte: dateFrom } }),
  };

  const total = await prisma.stylingRecommendation.count({ where: whereClause });
  const clicked = await prisma.stylingRecommendation.count({ where: { ...whereClause, clicked: true } });
  const triedOn = await prisma.stylingRecommendation.count({ where: { ...whereClause, virtualTryOn: true } });
  const saved = await prisma.stylingRecommendation.count({ where: { ...whereClause, saved: true } });
  const addedToCart = await prisma.stylingRecommendation.count({ where: { ...whereClause, addedToCart: true } });
  const purchased = await prisma.stylingRecommendation.count({ where: { ...whereClause, purchased: true } });

  const funnel = [
    { stage: 'recommended', count: total },
    { stage: 'clicked', count: clicked },
    { stage: 'tried_on', count: triedOn },
    { stage: 'saved', count: saved },
    { stage: 'added_to_cart', count: addedToCart },
    { stage: 'purchased', count: purchased },
  ];

  let mainDropOff = null;
  let maxDropOff = 0;

  for (let i = 0; i < funnel.length - 1; i++) {
    const dropOff = funnel[i].count - funnel[i + 1].count;
    if (dropOff > maxDropOff) {
      maxDropOff = dropOff;
      mainDropOff = `${funnel[i].stage} → ${funnel[i + 1].stage}`;
    }
  }

  return {
    productId,
    recommended: total,
    clicked,
    clickRate: total > 0 ? (clicked / total * 100).toFixed(1) : 0,
    triedOn,
    tryOnRate: clicked > 0 ? (triedOn / clicked * 100).toFixed(1) : 0,
    saved,
    addedToCart,
    purchased,
    conversionRate: total > 0 ? (purchased / total * 100).toFixed(1) : 0,
    mainDropOff,
  };
}

export async function getAllProductsConversionStats(dateFrom = null) {
  const productsWithRecommendations = await prisma.stylingRecommendation.groupBy({
    by: ['productId'],
    where: dateFrom ? { recommendedAt: { gte: dateFrom } } : {},
  });

  const stats = await Promise.all(
    productsWithRecommendations.map(({ productId }) =>
      getProductConversionStats(productId, dateFrom)
    )
  );

  // Return stats with product ID as name (no Product model lookup)
  return stats.map(stat => ({
    ...stat,
    productName: `Product ${stat.productId}`,
    productImage: null,
    productPrice: null,
  })).sort((a, b) => b.recommended - a.recommended);
}
