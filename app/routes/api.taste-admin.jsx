// Staging-only taste-evidence admin endpoint.
// Guarded by STAGING_FIX_SECRET env var (not set in production project).
// Actions: backfillTaste, tendencyReport
import prisma from "../db.server";
import {
  extractStyleMeEvidence,
  extractPostWearEvidence,
  extractClosetEvidence,
  extractBuySkipEvidence,
} from "../lib/ai/taste-extraction.server";
import {
  writeSourceEvidence,
  reconcileObservations,
} from "../lib/ai/taste-reconcile.server";

export async function action({ request }) {
  // Blocked when STAGING_FIX_SECRET is not set (production project doesn't have it).
  if (!process.env.STAGING_FIX_SECRET) {
    return new Response("Not Found", { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { _action, fixSecret, customerId, shopifyCustomerId, email } = body ?? {};

  const valid =
    fixSecret === process.env.STAGING_FIX_SECRET ||
    (process.env.STAGING_SEED_SECRET && fixSecret === process.env.STAGING_SEED_SECRET);
  if (!valid) return new Response("Forbidden", { status: 403 });

  // Resolve customer
  let customer = null;
  if (customerId) {
    customer = await prisma.customer.findUnique({ where: { id: String(customerId) }, select: { id: true, shopifyCustomerId: true, email: true } });
  } else if (shopifyCustomerId) {
    customer = await prisma.customer.findUnique({ where: { shopifyCustomerId: String(shopifyCustomerId) }, select: { id: true, shopifyCustomerId: true, email: true } });
  } else if (email) {
    customer = await prisma.customer.findFirst({ where: { email: String(email) }, select: { id: true, shopifyCustomerId: true, email: true } });
  }
  if (!customer) return Response.json({ error: "customer not found" }, { status: 404 });
  const cid = customer.id;

  if (_action === "tendencyReport") {
    const tendencies = await prisma.styleTendency.findMany({
      where: { customerId: cid },
      orderBy: [{ observationKey: "asc" }, { generation: "desc" }],
      select: { observationKey: true, dimension: true, value: true, generation: true, state: true, wSupport: true, wContradict: true, wNet: true, effectiveSupport: true, distinctRecords: true, distinctSources: true, dominantPolarity: true, observationFamily: true, claimText: true, customerFeedback: true, customerFeedbackAt: true },
    });
    const evidenceCounts = await prisma.tasteEvidence.groupBy({ by: ["source"], where: { customerId: cid }, _count: { id: true } });
    return Response.json({ customerId: cid, tendencies, evidenceBySource: Object.fromEntries(evidenceCounts.map(r => [r.source, r._count.id])) });
  }

  if (_action === "backfillTaste") {
    const report = { styleme: 0, postwear: 0, closet: 0, buyskip: 0, errors: [] };

    const outcomes = await prisma.styleMeOutcome.findMany({
      where: { customerId: cid },
      include: { suggestion: { include: { session: { select: { currentMood: true, occasion: true } } } } },
    });
    for (const outcome of outcomes) {
      try {
        const rows = extractStyleMeEvidence(outcome, { currentMood: outcome.suggestion?.session?.currentMood ?? null, occasion: outcome.suggestion?.session?.occasion ?? null });
        await writeSourceEvidence(cid, "STYLEME_OUTCOME", outcome.id, rows);
        report.styleme += rows.length;
      } catch (e) { report.errors.push(`styleme:${outcome.id}:${e.message?.slice(0, 60)}`); }
    }

    const reviews = await prisma.postOutfitReview.findMany({
      where: { customerId: cid },
      include: { session: { select: { currentMood: true, occasion: true } } },
    });
    for (const review of reviews) {
      try {
        const rows = extractPostWearEvidence(review, { currentMood: review.session?.currentMood ?? null, occasion: review.session?.occasion ?? null });
        await writeSourceEvidence(cid, "POST_OUTFIT_REVIEW", review.id, rows);
        report.postwear += rows.length;
      } catch (e) { report.errors.push(`postwear:${review.id}:${e.message?.slice(0, 60)}`); }
    }

    const items = await prisma.closetItem.findMany({
      where: { customerId: cid },
      select: { id: true, customerId: true, category: true, garmentRelationships: true, updatedAt: true },
    });
    for (const item of items) {
      try {
        const rows = extractClosetEvidence(item);
        await writeSourceEvidence(cid, "CLOSET_RELATIONSHIP", item.id, rows);
        report.closet += rows.length;
      } catch (e) { report.errors.push(`closet:${item.id}:${e.message?.slice(0, 60)}`); }
    }

    const analyses = await prisma.buyOrSkipAnalysis.findMany({
      where: { customerId: cid },
      include: { outcomes: { select: { id: true, postPurchaseOutcome: true, createdAt: true } } },
    });
    for (const analysis of analyses) {
      for (const outcome of analysis.outcomes) {
        try {
          const rows = extractBuySkipEvidence({ id: outcome.id, customerId: cid, postPurchaseOutcome: outcome.postPurchaseOutcome, category: analysis.category, createdAt: outcome.createdAt });
          await writeSourceEvidence(cid, "BUYSKIP_OUTCOME", outcome.id, rows);
          report.buyskip += rows.length;
        } catch (e) { report.errors.push(`buyskip:${outcome.id}:${e.message?.slice(0, 60)}`); }
      }
    }

    await reconcileObservations(cid);

    const tendencies = await prisma.styleTendency.findMany({
      where: { customerId: cid },
      orderBy: [{ observationKey: "asc" }, { generation: "desc" }],
      select: { observationKey: true, dimension: true, value: true, generation: true, state: true, wSupport: true, wContradict: true, wNet: true, effectiveSupport: true, distinctRecords: true, distinctSources: true, dominantPolarity: true, observationFamily: true, claimText: true, customerFeedback: true, customerFeedbackAt: true },
    });
    const evidenceCounts = await prisma.tasteEvidence.groupBy({ by: ["source"], where: { customerId: cid }, _count: { id: true } });

    return Response.json({ ok: true, customerId: cid, evidenceWritten: report, evidenceBySource: Object.fromEntries(evidenceCounts.map(r => [r.source, r._count.id])), tendencies });
  }

  return Response.json({ error: "unknown _action" }, { status: 400 });
}
