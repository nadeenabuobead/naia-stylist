import prisma from "../db.server";

// One-time staging fixture endpoint. Returns 403 unless STAGING_SEED_SECRET is set
// AND the caller supplies a matching x-seed-secret header. Remove this file after seeding.
export async function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ request }) {
  const secret = request.headers.get("x-seed-secret");
  if (!process.env.STAGING_SEED_SECRET || secret !== process.env.STAGING_SEED_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { shopifyCustomerId, email } = body ?? {};
  if (!shopifyCustomerId || !email) {
    return Response.json({ error: "shopifyCustomerId and email required" }, { status: 400 });
  }

  const existing = await prisma.customer.findUnique({
    where: { shopifyCustomerId: String(shopifyCustomerId) },
    select: { id: true, shopifyCustomerId: true, email: true },
  });
  if (existing) {
    return Response.json({ alreadyExists: true, id: existing.id, shopifyCustomerId: existing.shopifyCustomerId });
  }

  const customer = await prisma.customer.create({
    data: {
      shopifyCustomerId: String(shopifyCustomerId),
      email: String(email),
    },
  });
  return Response.json({ created: true, id: customer.id, shopifyCustomerId: customer.shopifyCustomerId });
}
