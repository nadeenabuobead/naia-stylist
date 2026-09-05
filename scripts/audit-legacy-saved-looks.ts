/**
 * Staging-only audit and cleanup of legacy NADINE-inclusive SavedLooks.
 *
 * The current nAia StyleMe architecture is Closet-only: every SavedLookItem
 * must have closetItemId set and shopifyProductId null.  Records from the old
 * NADINE-inclusive architecture contain items where shopifyProductId is non-null
 * (the NADINE catalogue product recommended alongside closet pieces).
 *
 * SAFETY RULES encoded in this script:
 *   - Dry-run by default; pass --delete to remove confirmed legacy records.
 *   - Only deletes a SavedLook when ALL of its items have been inspected AND at
 *     least one item has shopifyProductId non-null (unambiguously old arch).
 *   - Any look where ALL items have shopifyProductId null is treated as current
 *     architecture and is never touched.
 *   - Logs every record before acting.
 *
 * Usage:
 *   DATABASE_URL=<staging-url> npx tsx scripts/audit-legacy-saved-looks.ts
 *   DATABASE_URL=<staging-url> npx tsx scripts/audit-legacy-saved-looks.ts --delete
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = !process.argv.includes("--delete");

async function main() {
  console.log(`\n=== audit-legacy-saved-looks ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (pass --delete to remove)" : "DELETE MODE"}\n`);

  const allLooks = await prisma.savedLook.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      items: {
        select: {
          id: true,
          itemType: true,
          closetItemId: true,
          shopifyProductId: true,
          productImageUrl: true,
        },
      },
    },
  });

  console.log(`Total SavedLooks in DB: ${allLooks.length}\n`);

  const legacy: typeof allLooks = [];
  const current: typeof allLooks = [];
  const ambiguous: typeof allLooks = [];

  for (const look of allLooks) {
    const hasNadineItem = look.items.some((i) => i.shopifyProductId !== null);
    const hasClosetItem = look.items.some((i) => i.closetItemId !== null);
    const totalItems = look.items.length;

    if (totalItems === 0) {
      ambiguous.push(look);
    } else if (hasNadineItem) {
      // At least one NADINE catalogue item → unambiguously old architecture
      legacy.push(look);
    } else if (hasClosetItem) {
      // All items are closet-only → current architecture
      current.push(look);
    } else {
      // Items exist but neither field is set — ambiguous, do not touch
      ambiguous.push(look);
    }
  }

  // ── Report current-architecture looks ──────────────────────────────────────
  console.log(`CURRENT ARCHITECTURE looks (Closet-only, will NOT be touched): ${current.length}`);
  for (const look of current) {
    console.log(
      `  [KEEP] "${look.name}" id=${look.id} created=${look.createdAt.toISOString().slice(0, 10)} items=${look.items.length}`
    );
  }

  // ── Report ambiguous looks ─────────────────────────────────────────────────
  if (ambiguous.length > 0) {
    console.log(`\nAMBIGUOUS looks (no items or neither field set, will NOT be touched): ${ambiguous.length}`);
    for (const look of ambiguous) {
      console.log(
        `  [SKIP] "${look.name}" id=${look.id} created=${look.createdAt.toISOString().slice(0, 10)} items=${look.items.length}`
      );
      for (const item of look.items) {
        console.log(
          `         item id=${item.id} type=${item.itemType} closetItemId=${item.closetItemId} shopifyProductId=${item.shopifyProductId}`
        );
      }
    }
  }

  // ── Report and optionally delete legacy looks ──────────────────────────────
  console.log(`\nLEGACY (NADINE-inclusive) looks to ${DRY_RUN ? "REPORT" : "DELETE"}: ${legacy.length}`);
  for (const look of legacy) {
    const nadineItems = look.items.filter((i) => i.shopifyProductId !== null);
    const closetItems = look.items.filter((i) => i.closetItemId !== null);
    console.log(
      `  [LEGACY] "${look.name}" id=${look.id} created=${look.createdAt.toISOString().slice(0, 10)}`
    );
    console.log(`    Total items: ${look.items.length} | NADINE items: ${nadineItems.length} | Closet items: ${closetItems.length}`);
    for (const item of look.items) {
      const kind = item.shopifyProductId ? "NADINE-product" : item.closetItemId ? "closet" : "unknown";
      console.log(
        `    [${kind}] itemId=${item.id} type=${item.itemType} shopifyProductId=${item.shopifyProductId ?? "null"} closetItemId=${item.closetItemId ?? "null"}`
      );
    }
  }

  if (!DRY_RUN && legacy.length > 0) {
    console.log(`\nDeleting ${legacy.length} legacy SavedLooks and their items...`);
    const ids = legacy.map((l) => l.id);

    // Delete items first (FK constraint), then looks.
    const deletedItems = await prisma.savedLookItem.deleteMany({
      where: { savedLookId: { in: ids } },
    });
    console.log(`  Deleted ${deletedItems.count} SavedLookItems`);

    const deletedLooks = await prisma.savedLook.deleteMany({
      where: { id: { in: ids } },
    });
    console.log(`  Deleted ${deletedLooks.count} SavedLooks`);

    console.log(`\nCleanup complete. Remaining SavedLooks: ${allLooks.length - legacy.length}`);
  }

  if (DRY_RUN && legacy.length > 0) {
    console.log(
      `\nDRY RUN: no changes made. Re-run with --delete to remove ${legacy.length} legacy record(s).`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
