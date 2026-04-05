import { authenticateCustomer } from "../customer-auth.server";
import prisma from "../db.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * GET /api/wishlist — fetch all wishlist items
 */
export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const { customer } = await authenticateCustomer(request);
  if (!customer) {
    return Response.json({ items: [], authenticated: false }, { headers: CORS });
  }

  const items = await prisma.wishlistItem.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
  });

  return Response.json({ items, authenticated: true }, { headers: CORS });
}

/**
 * POST /api/wishlist — add or remove wishlist items
 * Body: { action: "add", naiaProductId, title, handle, image }
 *    or: { action: "remove", naiaProductId }
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

  if (act === "add") {
    const { naiaProductId, title, handle, image } = body;
    if (!naiaProductId || !title) {
      return Response.json({ error: "naiaProductId and title required" }, { status: 400, headers: CORS });
    }

    const item = await prisma.wishlistItem.upsert({
      where: {
        customerId_naiaProductId: {
          customerId: customer.id,
          naiaProductId: String(naiaProductId),
        },
      },
      update: { title, handle: handle || "", image: image || null },
      create: {
        customerId: customer.id,
        naiaProductId: String(naiaProductId),
        title,
        handle: handle || "",
        image: image || null,
      },
    });

    return Response.json({ item }, { headers: CORS });
  }

  if (act === "remove") {
    const { naiaProductId } = body;
    if (!naiaProductId) {
      return Response.json({ error: "naiaProductId required" }, { status: 400, headers: CORS });
    }

    try {
      await prisma.wishlistItem.delete({
        where: {
          customerId_naiaProductId: {
            customerId: customer.id,
            naiaProductId: String(naiaProductId),
          },
        },
      });
    } catch {
      // Already removed, that's fine
    }

    return Response.json({ removed: true }, { headers: CORS });
  }

  return Response.json({ error: "Unknown action" }, { status: 400, headers: CORS });
}
