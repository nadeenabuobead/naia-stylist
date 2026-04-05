import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/closet — fetch all closet items for the authenticated customer
 */
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ items: [], authenticated: false }, { headers: CORS });
  }

  const items = await prisma.closetItem.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ items, authenticated: true }, { headers: CORS });
}

/**
 * POST /api/closet — add or bulk-sync closet items
 * Body: { action: "add", name, category, image }
 *    or: { action: "sync", items: [{ name, category, image }] }  (merge localStorage → DB)
 *    or: { action: "delete", itemId }
 */
export async function action({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ error: "Not authenticated" }, { status: 401, headers: CORS });
  }

  const body = await request.json();
  const { action: act } = body;

  // ─── ADD a single item ───
  if (act === "add") {
    const { name, category, image } = body;
    if (!name?.trim()) {
      return Response.json({ error: "Name required" }, { status: 400, headers: CORS });
    }
    const item = await prisma.closetItem.create({
      data: {
        customerId: customer.id,
        name: name.trim(),
        category: category || "top",
        image: image || null,
      },
    });
    return Response.json({ item }, { headers: CORS });
  }

  // ─── SYNC from localStorage (merge, skip duplicates) ───
  if (act === "sync") {
    const { items } = body;
    if (!Array.isArray(items)) {
      return Response.json({ error: "Items array required" }, { status: 400, headers: CORS });
    }

    // Get existing items to avoid duplicates
    const existing = await prisma.closetItem.findMany({
      where: { customerId: customer.id },
      select: { name: true, category: true },
    });
    const existingSet = new Set(existing.map(e => `${e.name}::${e.category}`));

    const toCreate = items
      .filter(i => i.name?.trim() && !existingSet.has(`${i.name.trim()}::${i.category || "top"}`))
      .map(i => ({
        customerId: customer.id,
        name: i.name.trim(),
        category: i.category || "top",
        image: i.image || null,
      }));

    if (toCreate.length > 0) {
      await prisma.closetItem.createMany({ data: toCreate });
    }

    // Return full closet
    const allItems = await prisma.closetItem.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({ items: allItems, merged: toCreate.length }, { headers: CORS });
  }

  // ─── DELETE an item ───
  if (act === "delete") {
    const { itemId } = body;
    if (!itemId) {
      return Response.json({ error: "itemId required" }, { status: 400, headers: CORS });
    }
    // Verify ownership
    const item = await prisma.closetItem.findFirst({
      where: { id: itemId, customerId: customer.id },
    });
    if (!item) {
      return Response.json({ error: "Item not found" }, { status: 404, headers: CORS });
    }
    await prisma.closetItem.delete({ where: { id: itemId } });
    return Response.json({ deleted: true }, { headers: CORS });
  }

  return Response.json({ error: "Unknown action" }, { status: 400, headers: CORS });
}
