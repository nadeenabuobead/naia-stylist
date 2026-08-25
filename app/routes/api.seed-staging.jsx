import { createHash, randomBytes } from "crypto";
import prisma from "../db.server";
import { emitClosetItemAdded, recordJourneyEvent } from "../lib/ai/journey-events.server";
import { resolveNaiaSession } from "../lib/naia-session.server";

// Staging-only fixture and diagnostic endpoint.
// Requires STAGING_SEED_SECRET env var + matching x-seed-secret header.
//
// Supported _action values:
//   "createCustomer"     — create Customer record (idempotent on shopifyCustomerId)
//   "createSession"      — create Customer + NaiaSession, returns rawToken
//   "loginRedirect"      — create Customer + NaiaSession, set HttpOnly cookie, redirect to `to`
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

// Staging GET login helper: /api/seed-staging?secret=…&id=…&email=…&to=…
// Sets the __naia_tok cookie and redirects — allows browser-based test login.
export async function loader({ request }) {
  // Hard block in production — no secret check, no DB access, no side effects.
  if (process.env.VERCEL_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  if (!process.env.STAGING_SEED_SECRET || secret !== process.env.STAGING_SEED_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const shopifyCustomerId = url.searchParams.get("id");
  const email             = url.searchParams.get("email");
  const to                = url.searchParams.get("to") ?? "/my-naia";
  if (!shopifyCustomerId || !email) {
    return new Response("id and email required", { status: 400 });
  }
  if (!to.startsWith("/")) {
    return new Response("to must be a relative path", { status: 400 });
  }

  let customer = await prisma.customer.findUnique({
    where: { shopifyCustomerId },
    select: { id: true },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { shopifyCustomerId, email },
      select: { id: true },
    });
  }

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await prisma.naiaSession.create({
    data: { tokenHash, customerId: customer.id, expiresAt },
  });

  const cookieHeader = `__naia_tok=${rawToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
  return new Response(null, {
    status: 302,
    headers: { "Set-Cookie": cookieHeader, Location: to },
  });
}

export async function action({ request }) {
  // Hard block in production — before reading headers, body, or touching DB.
  if (process.env.VERCEL_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const act = body?._action ?? "createCustomer";

  // ── migrate ───────────────────────────────────────────────────────────────
  // One-time Customer A → Customer B data migration (OnboardingProfile + ClosetItems).
  // Auth: valid __naia_tok session that resolves to Customer B (Aug-21 timestamp).
  // No x-seed-secret required — uses the user's own authenticated session.
  // Exact timestamps are hardcoded from the diagnostic result; not user-supplied.
  if (act === "migrate") {
    const NO_CACHE = { "Cache-Control": "no-store" };

    const sessionCustomer = await resolveNaiaSession(request);
    if (!sessionCustomer) {
      return new Response("Unauthorized", { status: 401, headers: NO_CACHE });
    }

    // Exact createdAt timestamps from diagnostic — used to resolve IDs deterministically
    const CUSTOMER_A_TS = new Date("2026-04-20T11:27:28.067Z");
    const CUSTOMER_B_TS = new Date("2026-08-21T11:20:38.977Z");

    const [rowsA, rowsB] = await Promise.all([
      prisma.customer.findMany({ where: { createdAt: CUSTOMER_A_TS }, select: { id: true } }),
      prisma.customer.findMany({ where: { createdAt: CUSTOMER_B_TS }, select: { id: true } }),
    ]);

    if (rowsA.length !== 1 || rowsB.length !== 1) {
      return Response.json({
        error: "timestamp lookup did not resolve to exactly one customer each",
        foundA: rowsA.length,
        foundB: rowsB.length,
      }, { status: 400, headers: NO_CACHE });
    }

    const idA = rowsA[0].id;
    const idB = rowsB[0].id;

    // Session must belong to Customer B
    if (sessionCustomer.id !== idB) {
      return Response.json({
        error: "session does not resolve to Customer B — aborted",
        sessionIsB: false,
      }, { status: 403, headers: NO_CACHE });
    }

    // Pre-flight: exact counts required before any write
    const [aProfileCount, bProfileCount, aClosetCount, bClosetCount, aProfile] = await Promise.all([
      prisma.onboardingProfile.count({ where: { customerId: idA } }),
      prisma.onboardingProfile.count({ where: { customerId: idB } }),
      prisma.closetItem.count({ where: { customerId: idA } }),
      prisma.closetItem.count({ where: { customerId: idB } }),
      prisma.onboardingProfile.findUnique({ where: { customerId: idA }, select: { completed: true } }),
    ]);

    const preFlightOk =
      aProfileCount === 1 &&
      bProfileCount === 0 &&
      aClosetCount === 2 &&
      bClosetCount === 0 &&
      aProfile?.completed === true;

    if (!preFlightOk) {
      return Response.json({
        error: "pre-flight failed — migration aborted, no writes made",
        preflight: {
          aProfileCount,
          bProfileCount,
          aClosetCount,
          bClosetCount,
          aProfileCompleted: aProfile?.completed ?? null,
        },
      }, { status: 400, headers: NO_CACHE });
    }

    // Transactional migration + inline post-verification
    // prisma.$transaction auto-rolls back if the thrown Error fires
    let postCounts;
    try {
      postCounts = await prisma.$transaction(async (tx) => {
        await tx.onboardingProfile.update({
          where:  { customerId: idA },
          data:   { customerId: idB },
        });
        await tx.closetItem.updateMany({
          where: { customerId: idA },
          data:  { customerId: idB },
        });

        const [aP, bP, aC, bC, bProfile] = await Promise.all([
          tx.onboardingProfile.count({ where: { customerId: idA } }),
          tx.onboardingProfile.count({ where: { customerId: idB } }),
          tx.closetItem.count({ where: { customerId: idA } }),
          tx.closetItem.count({ where: { customerId: idB } }),
          tx.onboardingProfile.findUnique({ where: { customerId: idB }, select: { completed: true } }),
        ]);

        if (aP !== 0 || bP !== 1 || aC !== 0 || bC !== 2 || bProfile?.completed !== true) {
          throw new Error(
            `post-verify failed: aProfiles=${aP} bProfiles=${bP} aCloset=${aC} bCloset=${bC} bCompleted=${bProfile?.completed}`
          );
        }

        return { aProfiles: aP, bProfiles: bP, aCloset: aC, bCloset: bC, bProfileCompleted: bProfile.completed };
      });
    } catch (err) {
      return Response.json({
        error: "transaction rolled back",
        reason: err instanceof Error ? err.message : String(err),
      }, { status: 500, headers: NO_CACHE });
    }

    return Response.json({ migrated: true, postMigration: postCounts }, { headers: NO_CACHE });
  }

  // All other actions require x-seed-secret
  const secret = request.headers.get("x-seed-secret");
  if (!process.env.STAGING_SEED_SECRET || secret !== process.env.STAGING_SEED_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

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

  // ── loginRedirect ─────────────────────────────────────────────────────────
  // Creates Customer + NaiaSession, sets the __naia_tok HttpOnly cookie, and
  // redirects the browser to `to` (default: /my-naia).
  // Use this from a browser form POST so the cookie lands correctly.
  if (act === "loginRedirect") {
    const { shopifyCustomerId, email, to } = body ?? {};
    if (!shopifyCustomerId || !email) {
      return Response.json({ error: "shopifyCustomerId and email required" }, { status: 400 });
    }
    const destination = typeof to === "string" && to.startsWith("/") ? to : "/my-naia";

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

    const cookieHeader = `__naia_tok=${rawToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
    return new Response(null, {
      status: 302,
      headers: { "Set-Cookie": cookieHeader, Location: destination },
    });
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

    const sessionCount = await prisma.naiaSession.count({ where: { customerId: String(customerId) } });

    return Response.json({
      buyOrSkip: { total: buyOrSkipTotal, forCustomer: buyOrSkipForCustomer },
      recommendationFeedback: { total: rfTotal, forCustomer: rfForCustomer },
      postOutfitReview: { forCustomer: porTotal },
      journeyEvents: { total: jeTotal, byType: eventCounts },
      naiaSessions: { forCustomer: sessionCount },
    });
  }

  // ── createClosetItem ──────────────────────────────────────────────────────
  // Creates a ClosetItem for the customer and emits closet_item_added event.
  // Uses JEWELRY category (not-supported for try-on) to avoid Stage B Claude call.
  if (act === "createClosetItem") {
    const { customerId } = body ?? {};
    if (!customerId) return Response.json({ error: "customerId required" }, { status: 400 });
    const item = await prisma.closetItem.create({
      data: {
        customerId: String(customerId),
        name: "Test Jewelry (Batch 1 verification)",
        category: "JEWELRY",
        imageUrl: "https://example.com/batch1-test-jewelry.jpg",
        tryOnEligibility: "not-supported",
        tryOnAssessedAt: new Date(),
        tryOnCustomerHint: null,
        tryOnInternalNote: "Category JEWELRY is not supported for try-on.",
      },
    });
    try {
      recordJourneyEvent(emitClosetItemAdded({
        customerId: String(customerId),
        closetItemId: item.id,
        category: item.category,
        tryOnEligibility: item.tryOnEligibility ?? null,
      }));
    } catch { /* never block */ }
    return Response.json({ closetItemId: item.id, category: item.category });
  }

  // ── getCustomerData ───────────────────────────────────────────────────────
  // Returns OnboardingProfile updatedAt (for CAS in passport update tests) and
  // recent StylingSession IDs for the customer.
  if (act === "getCustomerData") {
    const { customerId } = body ?? {};
    if (!customerId) return Response.json({ error: "customerId required" }, { status: 400 });
    const profile = await prisma.onboardingProfile.findUnique({
      where: { customerId: String(customerId) },
      select: { id: true, updatedAt: true, completed: true },
    });
    const sessions = await prisma.stylingSession.findMany({
      where: { customerId: String(customerId) },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        suggestions: { select: { id: true }, take: 1 },
      },
    });
    return Response.json({
      profile: profile
        ? { id: profile.id, updatedAt: profile.updatedAt.toISOString(), completed: profile.completed }
        : null,
      sessions: sessions.map((s) => ({
        id: s.id,
        suggestionIds: s.suggestions.map((sg) => sg.id),
      })),
    });
  }

  // ── createSuggestion ──────────────────────────────────────────────────────
  // Creates a minimal OutfitSuggestion for a StylingSession so that look_saved
  // and in_session_review_submitted tests can run.
  if (act === "createSuggestion") {
    const { sessionId } = body ?? {};
    if (!sessionId) return Response.json({ error: "sessionId required" }, { status: 400 });
    const suggestion = await prisma.outfitSuggestion.create({
      data: { sessionId: String(sessionId) },
      select: { id: true },
    });
    return Response.json({ suggestionId: suggestion.id });
  }

  // ── verifySession ─────────────────────────────────────────────────────────
  // Check whether a rawToken maps to a valid (non-expired) naiaSession in the DB.
  if (act === "verifySession") {
    const { rawToken: raw } = body ?? {};
    if (!raw) return Response.json({ error: "rawToken required" }, { status: 400 });
    const tokenHash = createHash("sha256").update(String(raw)).digest("hex");
    const session = await prisma.naiaSession.findUnique({
      where: { tokenHash },
      select: { id: true, customerId: true, expiresAt: true },
    });
    return Response.json({
      found: session !== null,
      expired: session ? session.expiresAt < new Date() : null,
      tokenHashPrefix: tokenHash.slice(0, 8),
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
