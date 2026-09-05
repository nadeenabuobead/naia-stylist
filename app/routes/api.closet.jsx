import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";
import { deleteClosetItemWithImage } from "../lib/closet-item-deletion.server.js";
import { checkEntitlement } from "../lib/plan/entitlement.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Maps legacy lowercase category strings from stylist.jsx to Prisma ClosetCategory enum values.
// The canonical closet UI (closet._index.tsx) uses correct enum values directly.
const CATEGORY_ENUM = {
  top:       "TOPS",      tops:       "TOPS",
  bottom:    "BOTTOMS",   bottoms:    "BOTTOMS",
  dress:     "DRESSES",   dresses:    "DRESSES",
  outerwear: "OUTERWEAR",
  shoes:     "SHOES",     shoe:       "SHOES",
  bag:       "BAGS",      bags:       "BAGS",
  accessory: "ACCESSORIES", accessories: "ACCESSORIES",
  jewelry:   "JEWELRY",
  other:     "OTHER",
};

function normalizeCategory(raw) {
  if (!raw) return "OTHER";
  const lower = String(raw).toLowerCase().trim();
  return CATEGORY_ENUM[lower] ?? "OTHER";
}

/**
 * GET /api/closet — fetch all closet items for the authenticated customer.
 * Used by stylist.jsx (legacy JWT auth path).
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
 * POST /api/closet — add, sync, or delete closet items.
 * Used by stylist.jsx (legacy JWT auth path).
 * Category strings are normalised to Prisma ClosetCategory enum values.
 * The canonical write path for new closet UIs is closet._index.tsx (NaiaSession auth).
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

  // ─── ADD a single item ─────────────────────────────────────────────────────
  if (act === "add") {
    const { name, category, image } = body;
    if (!name?.trim()) {
      return Response.json({ error: "Name required" }, { status: 400, headers: CORS });
    }
    const capacityCheck = await checkEntitlement(customer.id, customer.plan, "closet");
    if (!capacityCheck.allowed) {
      return Response.json({ error: "Your closet is full. Remove some items to add new ones." }, { status: 403, headers: CORS });
    }
    const item = await prisma.closetItem.create({
      data: {
        customerId: customer.id,
        name: name.trim(),
        category: normalizeCategory(category),
        imageUrl: image ?? null,
      },
    });
    return Response.json({ item }, { headers: CORS });
  }

  // ─── SYNC from localStorage (merge, skip duplicates) ──────────────────────
  if (act === "sync") {
    const { items } = body;
    if (!Array.isArray(items)) {
      return Response.json({ error: "Items array required" }, { status: 400, headers: CORS });
    }

    const capacityCheck = await checkEntitlement(customer.id, customer.plan, "closet");
    if (!capacityCheck.allowed) {
      return Response.json({ error: "Your closet is full. Remove some items to add new ones.", merged: 0 }, { status: 403, headers: CORS });
    }

    const existing = await prisma.closetItem.findMany({
      where: { customerId: customer.id },
      select: { name: true, category: true },
    });
    const existingSet = new Set(existing.map(e => `${e.name}::${e.category}`));

    const toCreate = items
      .filter(i => {
        if (!i.name?.trim()) return false;
        const cat = normalizeCategory(i.category);
        return !existingSet.has(`${i.name.trim()}::${cat}`);
      })
      .map(i => ({
        customerId: customer.id,
        name: i.name.trim(),
        category: normalizeCategory(i.category),
        imageUrl: i.image ?? null,
      }));

    if (toCreate.length > 0) {
      await prisma.closetItem.createMany({ data: toCreate });
    }

    const allItems = await prisma.closetItem.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({ items: allItems, merged: toCreate.length }, { headers: CORS });
  }

  // ─── DELETE an item ────────────────────────────────────────────────────────
  if (act === "delete") {
    const { itemId } = body;
    if (!itemId) {
      return Response.json({ error: "itemId required" }, { status: 400, headers: CORS });
    }
    // deleteClosetItemWithImage verifies ownership, removes the private Cloudinary
    // asset (idempotent), then deletes the DB record.
    const result = await deleteClosetItemWithImage(itemId, customer.id);
    if (!result.deleted) {
      return Response.json({ error: "Item not found" }, { status: 404, headers: CORS });
    }
    return Response.json({ deleted: true }, { headers: CORS });
  }

  return Response.json({ error: "Unknown action" }, { status: 400, headers: CORS });
}
