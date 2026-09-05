// scripts/backfill-taste-evidence.ts
// Phase 5D — Idempotent backfill of TasteEvidence + StyleTendency from existing data.
//
// Usage:
//   npx tsx scripts/backfill-taste-evidence.ts
//   npx tsx scripts/backfill-taste-evidence.ts --customer-id <id>
//
// Safety:
//   - writeSourceEvidence uses delete-and-reinsert, so running multiple times is safe.
//   - REJECTED StyleTendency rows are preserved by reconcileObservations (never touched).
//   - Existing CONFIRMED observations are updated in place — text + metrics refreshed.

import prisma from "../app/db.server.js";
import { extractStyleMeEvidence } from "../app/lib/ai/taste-extraction.server.js";
import { extractPostWearEvidence } from "../app/lib/ai/taste-extraction.server.js";
import { extractClosetEvidence } from "../app/lib/ai/taste-extraction.server.js";
import { extractBuySkipEvidence } from "../app/lib/ai/taste-extraction.server.js";
import { writeSourceEvidence, reconcileObservations } from "../app/lib/ai/taste-reconcile.server.js";

const BATCH_SIZE = 50;

function parseArgs(): { customerId: string | null } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--customer-id");
  return { customerId: idx !== -1 ? (args[idx + 1] ?? null) : null };
}

async function getCustomerIds(targetId: string | null): Promise<string[]> {
  if (targetId) return [targetId];
  const customers = await prisma.customer.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  return customers.map(c => c.id);
}

async function backfillStyleMe(customerId: string): Promise<void> {
  let skip = 0;
  while (true) {
    const outcomes = await prisma.styleMeOutcome.findMany({
      where: { customerId },
      take: BATCH_SIZE,
      skip,
      orderBy: { submittedAt: "asc" },
      include: { suggestion: { include: { session: { select: { currentMood: true, occasion: true } } } } },
    });
    if (outcomes.length === 0) break;

    for (const outcome of outcomes) {
      try {
        const rows = extractStyleMeEvidence(outcome, {
          currentMood: outcome.suggestion?.session?.currentMood ?? null,
          occasion:    outcome.suggestion?.session?.occasion    ?? null,
        });
        await writeSourceEvidence(customerId, "STYLEME_OUTCOME", outcome.id, rows);
      } catch (err) {
        console.warn(`  [warn] StyleMe ${outcome.id}: ${err}`);
      }
    }
    skip += outcomes.length;
    if (outcomes.length < BATCH_SIZE) break;
  }
}

async function backfillPostWear(customerId: string): Promise<void> {
  let skip = 0;
  while (true) {
    const reviews = await prisma.postOutfitReview.findMany({
      where: { customerId },
      take: BATCH_SIZE,
      skip,
      orderBy: { createdAt: "asc" },
      include: { session: { select: { currentMood: true, occasion: true } } },
    });
    if (reviews.length === 0) break;

    for (const review of reviews) {
      try {
        const rows = extractPostWearEvidence(review, {
          currentMood: review.session?.currentMood ?? null,
          occasion:    review.session?.occasion    ?? null,
        });
        await writeSourceEvidence(customerId, "POST_OUTFIT_REVIEW", review.id, rows);
      } catch (err) {
        console.warn(`  [warn] PostWear ${review.id}: ${err}`);
      }
    }
    skip += reviews.length;
    if (reviews.length < BATCH_SIZE) break;
  }
}

async function backfillCloset(customerId: string): Promise<void> {
  let skip = 0;
  while (true) {
    const items = await prisma.closetItem.findMany({
      where: { customerId },
      take: BATCH_SIZE,
      skip,
      orderBy: { createdAt: "asc" },
      select: { id: true, customerId: true, category: true, garmentRelationships: true, updatedAt: true },
    });
    if (items.length === 0) break;

    for (const item of items) {
      try {
        const rows = extractClosetEvidence(item);
        await writeSourceEvidence(customerId, "CLOSET_RELATIONSHIP", item.id, rows);
      } catch (err) {
        console.warn(`  [warn] Closet ${item.id}: ${err}`);
      }
    }
    skip += items.length;
    if (items.length < BATCH_SIZE) break;
  }
}

async function backfillBuySkip(customerId: string): Promise<void> {
  let skip = 0;
  while (true) {
    const analyses = await prisma.buyOrSkipAnalysis.findMany({
      where: { customerId },
      take: BATCH_SIZE,
      skip,
      orderBy: { createdAt: "asc" },
      include: { outcomes: { select: { id: true, postPurchaseOutcome: true, createdAt: true } } },
    });
    if (analyses.length === 0) break;

    for (const analysis of analyses) {
      for (const outcome of analysis.outcomes) {
        try {
          const rows = extractBuySkipEvidence({
            id:                  outcome.id,
            customerId,
            postPurchaseOutcome: outcome.postPurchaseOutcome,
            category:            analysis.category,
            createdAt:           outcome.createdAt,
          });
          await writeSourceEvidence(customerId, "BUYSKIP_OUTCOME", outcome.id, rows);
        } catch (err) {
          console.warn(`  [warn] BuySkip ${outcome.id}: ${err}`);
        }
      }
    }
    skip += analyses.length;
    if (analyses.length < BATCH_SIZE) break;
  }
}

async function backfillCustomer(customerId: string): Promise<void> {
  console.log(`  → StyleMe outcomes`);
  await backfillStyleMe(customerId);
  console.log(`  → Post-wear reviews`);
  await backfillPostWear(customerId);
  console.log(`  → Closet items`);
  await backfillCloset(customerId);
  console.log(`  → Buy or Skip outcomes`);
  await backfillBuySkip(customerId);
  console.log(`  → Final reconcile`);
  await reconcileObservations(customerId);
}

async function main(): Promise<void> {
  const { customerId } = parseArgs();
  const customerIds = await getCustomerIds(customerId);

  console.log(`Backfill: ${customerIds.length} customer(s)`);

  for (let i = 0; i < customerIds.length; i++) {
    const id = customerIds[i];
    console.log(`[${i + 1}/${customerIds.length}] Customer ${id}`);
    await backfillCustomer(id);
  }

  console.log("Done.");
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
