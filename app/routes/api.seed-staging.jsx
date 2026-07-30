import { createHash, randomBytes } from "crypto";
import prisma from "../db.server";

// Staging-only fixture and diagnostic endpoint.
// Requires STAGING_SEED_SECRET env var + matching x-seed-secret header.
//
// Supported _action values:
//   "createCustomer"     — create Customer record (idempotent on shopifyCustomerId)
//   "createSession"      — create Customer + NaiaSession, returns rawToken
//   "createStylingSession" — create StylingSession for an existing customer
//   "countRecords"       — return event/analysis counts scoped to a customerId
//   "cleanup"            — delete all test records for a shopifyCustomerId
//
// All test records use shopifyCustomerId prefix "test-batch1-" to isolate them.

function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function generateRawToken() {
  return randomBytes(32).toString("base64url");
}

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

  const act = body?._action ?? "createCustomer";

  // ── createCustomer ────────────────────────────────────────────────────────
  if (act === "createCustomer") {
    const { shopifyCustomerId, email } = body ?? {};
    if (!shopifyCustomerId || !email) {
      return Response.json({ error: "shopifyCustomerId and email required" }, { status: 400 });
    }
    const existing = await prisma.customer.findUnique({
      where: { shopifyCustomerId: String(shopifyCustomerId) },
      select: { id: true, shopifyCustomerId: true },
    });
    if (existing) {
      return Response.json({ alreadyExists: true, id: existing.id, shopifyCustomerId: existing.shopifyCustomerId });
    }
    const customer = await prisma.customer.create({
      data: { shopifyCustomerId: String(shopifyCustomerId), email: String(email) },
    });
    return Response.json({ created: true, id: customer.id, shopifyCustomerId: customer.shopifyCustomerId });
  }

  // ── createSession ─────────────────────────────────────────────────────────
  // Creates Customer (idempotent) + NaiaSession. Returns rawToken for cookie.
  if (act === "createSession") {
    const { shopifyCustomerId, email } = body ?? {};
    if (!shopifyCustomerId || !email) {
      return Response.json({ error: "shopifyCustomerId and email required" }, { status: 400 });
    }

    let customer = await prisma.customer.findUnique({
      where: { shopifyCustomerId: String(shopifyCustomerId) },
      select: { id: true },
    });
    if (!customer) {
      customer = await prisma.customer.create({
        data: { shopifyCustomerId: String(shopifyCustomerId), email: String(email) },
        select: { id: true },
      });
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.naiaSession.create({
      data: { tokenHash, customerId: customer.id, expiresAt },
    });

    return Response.json({ rawToken, customerId: customer.id });
  }

  // ── createStylingSession ──────────────────────────────────────────────────
  if (act === "createStylingSession") {
    const { customerId } = body ?? {};
    if (!customerId) return Response.json({ error: "customerId required" }, { status: 400 });
    const session = await prisma.stylingSession.create({
      data: { customerId: String(customerId) },
      select: { id: true },
    });
    return Response.json({ sessionId: session.id });
  }

  // ── countRecords ──────────────────────────────────────────────────────────
  if (act === "countRecords") {
    const { customerId } = body ?? {};
    if (!customerId) return Response.json({ error: "customerId required" }, { status: 400 });

    const customerIdHash = createHash("sha256").update(customerId).digest("hex").slice(0, 12);

    const [buyOrSkipTotal, buyOrSkipForCustomer, rfTotal, rfForCustomer, porTotal, jeTotal, jeByType] =
      await Promise.all([
        prisma.buyOrSkipAnalysis.count(),
        prisma.buyOrSkipAnalysis.count({ where: { customerId: String(customerId) } }),
        prisma.recommendationFeedback.count(),
        prisma.recommendationFeedback.count({ where: { customerId: String(customerId) } }),
        prisma.postOutfitReview.count({ where: { customerId: String(customerId) } }),
        prisma.journeyEvent.count({ where: { customerIdHash } }),
        prisma.journeyEvent.groupBy({
          by: ["type"],
          where: { customerIdHash },
          _count: { type: true },
        }),
      ]);

    const eventCounts = Object.fromEntries(jeByType.map((r) => [r.type, r._count.type]));

    return Response.json({
      buyOrSkip: { total: buyOrSkipTotal, forCustomer: buyOrSkipForCustomer },
      recommendationFeedback: { total: rfTotal, forCustomer: rfForCustomer },
      postOutfitReview: { forCustomer: porTotal },
      journeyEvents: { total: jeTotal, byType: eventCounts },
    });
  }

  // ── cleanup ───────────────────────────────────────────────────────────────
  if (act === "cleanup") {
    const { shopifyCustomerId } = body ?? {};
    if (!shopifyCustomerId || !String(shopifyCustomerId).startsWith("test-batch1-")) {
      return Response.json({ error: "shopifyCustomerId must start with test-batch1-" }, { status: 400 });
    }

    const customer = await prisma.customer.findUnique({
      where: { shopifyCustomerId: String(shopifyCustomerId) },
      select: { id: true },
    });
    if (!customer) return Response.json({ notFound: true });

    // Cascade delete via customer FK removes sessions, events, analyses, etc.
    await prisma.customer.delete({ where: { id: customer.id } });
    return Response.json({ cleaned: true, customerId: customer.id });
  }

  return Response.json({ error: "Unknown _action" }, { status: 400 });
}
