/**
 * Staging-only: audit and cleanup of legacy NADINE-inclusive SavedLooks.
 *
 * Security: blocked in production (VERCEL_ENV=production → 404).
 * Auth: requires matching x-audit-secret header == STAGING_SEED_SECRET.
 *
 * GET  ?action=audit       → JSON report of all SavedLooks (dry-run, no changes)
 * POST ?action=delete-legacy → deletes only confirmed-legacy rows (shopifyProductId != null)
 *
 * A look is LEGACY if any of its SavedLookItems has shopifyProductId non-null.
 * A look is CURRENT if all items have closetItemId set and shopifyProductId null.
 * A look is AMBIGUOUS (0 items or neither field) — never touched.
 */
import prisma from "../db.server";

function unauthorized() {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

function blocked() {
  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

async function fetchAll() {
  return prisma.savedLook.findMany({
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
}

function classify(looks) {
  const legacy = [];
  const current = [];
  const ambiguous = [];
  for (const look of looks) {
    const hasNadine = look.items.some(i => i.shopifyProductId !== null);
    const hasCloset = look.items.some(i => i.closetItemId !== null);
    if (look.items.length === 0) {
      ambiguous.push(look);
    } else if (hasNadine) {
      legacy.push(look);
    } else if (hasCloset) {
      current.push(look);
    } else {
      ambiguous.push(look);
    }
  }
  return { legacy, current, ambiguous };
}

function serializeLook(look) {
  return {
    id: look.id,
    name: look.name,
    createdAt: look.createdAt.toISOString(),
    fromSuggestionId: look.fromSuggestionId,
    items: look.items.map(i => ({
      id: i.id,
      itemType: i.itemType,
      closetItemId: i.closetItemId,
      shopifyProductId: i.shopifyProductId,
      hasProductImageUrl: !!i.productImageUrl,
    })),
  };
}

export async function loader({ request }) {
  if (process.env.VERCEL_ENV === "production") return blocked();

  const authHeader = request.headers.get("x-audit-secret");
  if (!process.env.STAGING_SEED_SECRET || authHeader !== process.env.STAGING_SEED_SECRET) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "audit";
  if (action !== "audit") {
    return new Response(
      JSON.stringify({ error: "Use GET ?action=audit for dry-run or POST ?action=delete-legacy to delete" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const looks = await fetchAll();
  const { legacy, current, ambiguous } = classify(looks);

  return new Response(
    JSON.stringify({
      mode: "DRY_RUN",
      total: looks.length,
      summary: { legacy: legacy.length, current: current.length, ambiguous: ambiguous.length },
      legacy: legacy.map(serializeLook),
      current: current.map(serializeLook),
      ambiguous: ambiguous.map(serializeLook),
    }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export async function action({ request }) {
  if (process.env.VERCEL_ENV === "production") return blocked();

  const authHeader = request.headers.get("x-audit-secret");
  if (!process.env.STAGING_SEED_SECRET || authHeader !== process.env.STAGING_SEED_SECRET) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const act = url.searchParams.get("action");
  if (act !== "delete-legacy") {
    return new Response(
      JSON.stringify({ error: "POST requires ?action=delete-legacy" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const looks = await fetchAll();
  const { legacy, current, ambiguous } = classify(looks);

  if (legacy.length === 0) {
    return new Response(
      JSON.stringify({ deleted: 0, kept: { current: current.length, ambiguous: ambiguous.length }, message: "No legacy records found" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const ids = legacy.map(l => l.id);
  const deletedItems = await prisma.savedLookItem.deleteMany({ where: { savedLookId: { in: ids } } });
  const deletedLooks = await prisma.savedLook.deleteMany({ where: { id: { in: ids } } });

  return new Response(
    JSON.stringify({
      mode: "DELETE",
      deletedLooks: deletedLooks.count,
      deletedItems: deletedItems.count,
      deletedIds: ids,
      deletedNames: legacy.map(l => l.name),
      kept: { current: current.length, ambiguous: ambiguous.length },
    }, null, 2),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
