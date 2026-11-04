import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";
import { deleteClosetItemWithImage } from "../lib/closet-item-deletion.server.js";
import { checkEntitlement, reserveClosetSlot } from "../lib/plan/entitlement.server";
import { getMembershipAllowances } from "../lib/plan/plan-limits.server";

function isSerializationError(e) {
  return e?.code === "P2034";
}
const MAX_SYNC_TX_RETRIES = 2;

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
    const { name, category } = body;
    if (!name?.trim()) {
      return Response.json({ error: "Name required" }, { status: 400, headers: CORS });
    }
    // Atomic: reserveClosetSlot re-verifies the count and creates inside one
    // Serializable transaction, so two concurrent "add" calls (or an "add"
    // racing a "sync") from the same customer can't both pass the count
    // before either commits — the bare checkEntitlement check this replaced
    // was read-before-write only. Mirrors closet._index.tsx's canonical path.
    //
    // imageUrl is forced null, never a client-supplied value — this path has
    // no Cloudinary ownership check and no Layer 2/3 moderation, so it must
    // not be able to attach an arbitrary, unscreened image to a closet item
    // (preserved from this route's existing security contract; `image` isn't
    // even read from the request body on this action). Items added through
    // this path can have a photo attached afterwards through the canonical,
    // moderated upload flow in closet._index.tsx (same ClosetItem row).
    const reservation = await reserveClosetSlot(customer.id, customer.membershipStatus, {
      customer: { connect: { id: customer.id } },
      name: name.trim(),
      category: normalizeCategory(category),
      imageUrl: null,
    });
    if (!reservation.allowed) {
      return Response.json({ error: "Your closet is full. Remove some items to add new ones." }, { status: 403, headers: CORS });
    }
    return Response.json({ item: reservation.record }, { headers: CORS });
  }

  // ─── SYNC from localStorage (merge, skip duplicates) ──────────────────────
  if (act === "sync") {
    const { items } = body;
    if (!Array.isArray(items)) {
      return Response.json({ error: "Items array required" }, { status: 400, headers: CORS });
    }

    // Cheap early fast-fail — skip the batch entirely if clearly already at
    // capacity. Not atomic on its own; see the transaction below.
    const capacityCheck = await checkEntitlement(customer.id, customer.membershipStatus, "closet");
    if (!capacityCheck.allowed) {
      return Response.json({ error: "Your closet is full. Remove some items to add new ones.", merged: 0 }, { status: 403, headers: CORS });
    }

    // Atomic: re-verify the count AND cap the batch to the customer's actual
    // remaining capacity inside one Serializable transaction. The check
    // above only answers "is the customer currently at capacity" — a
    // boolean — not "how many more fit". Without this, a customer with a
    // single slot left and a 500-item sync payload would have had all 500
    // created in one unbounded createMany call; two concurrent syncs could
    // likewise both pass the boolean check and together blow past the cap.
    const limits = getMembershipAllowances(customer.membershipStatus);
    let merged = 0;
    for (let attempt = 0; attempt <= MAX_SYNC_TX_RETRIES; attempt++) {
      try {
        merged = await prisma.$transaction(async (tx) => {
          const existing = await tx.closetItem.findMany({
            where: { customerId: customer.id },
            select: { name: true, category: true },
          });
          const existingSet = new Set(existing.map(e => `${e.name}::${e.category}`));
          const remaining = Math.max(0, limits.closetItems - existing.length);

          // See the "add" action above — client-supplied image data is never
          // trusted on this unmoderated legacy path, hence imageUrl: null
          // unconditionally rather than reading any per-item upload field.
          const toCreate = items
            .filter(i => {
              if (!i.name?.trim()) return false;
              const cat = normalizeCategory(i.category);
              return !existingSet.has(`${i.name.trim()}::${cat}`);
            })
            .slice(0, remaining)
            .map(i => ({
              customerId: customer.id,
              name: i.name.trim(),
              category: normalizeCategory(i.category),
              imageUrl: null,
            }));

          if (toCreate.length > 0) {
            await tx.closetItem.createMany({ data: toCreate });
          }
          return toCreate.length;
        }, { isolationLevel: "Serializable" });
        break;
      } catch (e) {
        if (isSerializationError(e) && attempt < MAX_SYNC_TX_RETRIES) continue;
        throw e;
      }
    }

    const allItems = await prisma.closetItem.findMany({
      where: { customerId: customer.id },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({ items: allItems, merged }, { headers: CORS });
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
