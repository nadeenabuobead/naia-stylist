import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import prisma from "../db.server";
import { emitClosetItemAdded, recordJourneyEvent } from "../lib/ai/journey-events.server";
import { extractStyleMeEvidence, extractPostWearEvidence, extractClosetEvidence, extractBuySkipEvidence } from "../lib/ai/taste-extraction.server";
import { writeSourceEvidence, reconcileObservations } from "../lib/ai/taste-reconcile.server";

// Staging-only fixture and diagnostic endpoint.
// Requires STAGING_SEED_SECRET (legacy) OR WI_QA_LOGIN_SECRET (dedicated to
// the Wardrobe Intelligence QA workflow, kept intentionally separate — see
// isValidSeedSecret) env var + matching x-seed-secret header.
//
// Supported _action values:
//   "createCustomer"     — create Customer record (idempotent on shopifyCustomerId)
//   "createSession"      — create Customer + NaiaSession, returns rawToken
//   "loginRedirect"      — create Customer + NaiaSession, set HttpOnly cookie, redirect to `to`
//   "createLoginLink"    — header-authenticated; returns a short-lived, single-use
//                          ticket URL (GET /api/seed-staging?ticket=...) that logs
//                          the browser in WITHOUT the secret ever appearing in that URL
//   "createStylingSession" — create StylingSession for an existing customer
//   "createSavedLookDetailed" — create a SavedLook from the customer's OWN
//                          existing ClosetItem ids, no AI/provider call
//   "getSavedLook"        — read-only fetch of one SavedLook by id
//   "deleteSavedLook"     — delete one SavedLook by exact id
//   "countRecords"       — return event/analysis counts scoped to a customerId
//   "cleanup"            — delete all test records for a shopifyCustomerId
//   "createDuplicateMonthTrendEditFixture" — see its own comment below; creates
//                          2 EditorialTrendReport rows sharing one editionMonth
//   "deleteDuplicateMonthTrendEditFixture" — deletes exactly those 2 rows
//
// All test records use shopifyCustomerId prefix "test-batch1-" to isolate them.
// The three SavedLook actions above additionally require the target
// customer's id/shopifyCustomerId to appear in SAVED_LOOKS_FIXTURE_CUSTOMER_IDS
// (comma-separated) — an independent, fail-closed-when-empty allowlist, same
// pattern as FULL_LOOK_VTO_TEST_CUSTOMER_IDS in staging.full-look-vto-test.tsx.
// This means even a misconfiguration that accidentally sets
// NAIA_PROJECT_VARIANT=staging on the real production project still can't
// reach these three actions unless that allowlist is ALSO set and ALSO
// happens to list the exact id being targeted.

function hashToken(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

function generateRawToken() {
  return randomBytes(32).toString("base64url");
}

/**
 * WI_QA_LOGIN_SECRET is a dedicated secret for the Wardrobe Intelligence QA
 * workflow, intentionally separate from the long-standing STAGING_SEED_SECRET
 * — set it (Preview-only) to stop depending on that older shared secret
 * entirely. Every header-authenticated action below accepts either one, so
 * nothing here breaks if only one of the two is configured. Constant-time
 * comparison: these gate real writes, so a timing side-channel is worth
 * closing even though the Forbidden path already does almost no work.
 */
function timingSafeStringEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isValidSeedSecret(provided) {
  if (!provided) return false;
  const candidates = [process.env.STAGING_SEED_SECRET, process.env.WI_QA_LOGIN_SECRET].filter(Boolean);
  return candidates.some((candidate) => timingSafeStringEqual(provided, candidate));
}

/** The one secret used to sign/verify login tickets — prefers the dedicated
 * WI_QA_LOGIN_SECRET so tickets stop depending on STAGING_SEED_SECRET as
 * soon as the dedicated one is configured; falls back so nothing breaks
 * before that. */
function ticketSigningSecret() {
  return process.env.WI_QA_LOGIN_SECRET || process.env.STAGING_SEED_SECRET;
}

/** Standard prefix every fixture record in this file must carry. */
const TEST_CUSTOMER_PREFIX = "test-batch1-";

/**
 * Resolves customerId to its shopifyCustomerId and confirms it's a fixture
 * customer. Used by every action below that mutates data scoped to an
 * EXISTING customerId (as opposed to createCustomer/createSession/
 * loginRedirect, which only ever create a brand-new test-prefixed customer
 * or look one up by its own test-prefixed shopifyCustomerId) — so a wrong or
 * mistyped id can never write into a real customer's data.
 */
async function requireTestCustomer(customerId) {
  const customer = await prisma.customer.findUnique({
    where: { id: String(customerId) },
    select: { id: true, shopifyCustomerId: true },
  });
  if (!customer || !customer.shopifyCustomerId?.startsWith(TEST_CUSTOMER_PREFIX)) {
    return null;
  }
  return customer;
}

/**
 * Stricter gate for the SavedLook fixture actions specifically — the
 * test-batch1- prefix check above is the standing convention for every
 * other action in this file, but a standalone prefix string is only as
 * strong as "nobody else ever writes that prefix", which the rest of the
 * codebase already structurally guarantees (see the security review for
 * commit b547dee) but which a second, independent layer should not have
 * to rely on as its ONLY protection. Follows the exact same pattern
 * already established and trusted for this codebase's most sensitive
 * staging-only surface (real-FASHN calls) —
 * isAuthorizedStagingTestAccount in staging.full-look-vto-test.tsx:
 * NAIA_PROJECT_VARIANT === "staging" (unchanged) PLUS an explicit,
 * comma-separated customerId/shopifyCustomerId allowlist that FAILS
 * CLOSED when unset or empty — never "falls back to allow everything
 * test-batch1--shaped" the way requireTestCustomer alone does. A
 * misconfiguration that accidentally sets NAIA_PROJECT_VARIANT=staging
 * on the real production project still can't reach these three actions
 * unless SAVED_LOOKS_FIXTURE_CUSTOMER_IDS also happens to be set AND
 * happens to list the exact id being targeted — a categorically
 * different, much narrower failure than a single accidental env var.
 */
async function requireAllowlistedSavedLooksFixtureCustomer(customerId) {
  const customer = await requireTestCustomer(customerId);
  if (!customer) return null;
  const allowlist = (process.env.SAVED_LOOKS_FIXTURE_CUSTOMER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowlist.length === 0) return null;
  if (!allowlist.includes(customer.id) && !allowlist.includes(customer.shopifyCustomerId ?? "")) {
    return null;
  }
  return customer;
}

// ── Single-use login tickets ──────────────────────────────────────────────
//
// The GET ?secret=... login path above puts STAGING_SEED_SECRET in the URL,
// where it lands in Chrome history and server access logs. createLoginLink
// (a header-authenticated POST, like every other mutating action here)
// issues a short-lived, signed, single-use TICKET instead — a browser then
// opens /api/seed-staging?ticket=... to redeem it, and that URL never
// contains the secret at all.
//
// The ticket is a self-contained HMAC-signed token (no new DB table): a
// base64url JSON payload, a ".", then HMAC-SHA256(payload) keyed on
// STAGING_SEED_SECRET. Verifying it needs only the secret the server
// already has — nothing is ever stored for lookup. "Single-use" is
// enforced by an in-memory consumed-nonce set, best-effort across a single
// serverless instance's lifetime; the hard, deterministic guarantee is the
// short expiry (default 2 minutes), which bounds exposure either way.
const LOGIN_TICKET_DEFAULT_TTL_SECONDS = 120;
const LOGIN_TICKET_MAX_TTL_SECONDS = 600;
const consumedTicketNonces = new Map(); // nonce -> expiresAtMs, swept lazily

function sweepConsumedNonces() {
  const now = Date.now();
  for (const [nonce, expiresAtMs] of consumedTicketNonces) {
    if (expiresAtMs < now) consumedTicketNonces.delete(nonce);
  }
}

function signTicketPayload(payloadB64) {
  return createHmac("sha256", ticketSigningSecret()).update(payloadB64).digest("base64url");
}

function createLoginTicket({ customerId, to, ttlSeconds }) {
  const clampedTtl = Math.min(Math.max(Number(ttlSeconds) || LOGIN_TICKET_DEFAULT_TTL_SECONDS, 30), LOGIN_TICKET_MAX_TTL_SECONDS);
  const payload = {
    sub: customerId,
    to,
    exp: Date.now() + clampedTtl * 1000,
    nonce: randomBytes(12).toString("base64url"),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signTicketPayload(payloadB64);
  return `${payloadB64}.${sig}`;
}

/** Returns { customerId, to } on a valid, unexpired, unconsumed ticket — or null. */
function redeemLoginTicket(ticket) {
  const parts = String(ticket ?? "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expectedSig = signTicketPayload(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null; // bad signature — tampered or signed with a different secret
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload?.sub || !payload?.nonce || typeof payload.exp !== "number") return null;
  if (payload.exp < Date.now()) return null; // expired

  sweepConsumedNonces();
  if (consumedTicketNonces.has(payload.nonce)) return null; // already redeemed
  consumedTicketNonces.set(payload.nonce, payload.exp);

  return { customerId: payload.sub, to: typeof payload.to === "string" ? payload.to : "/my-naia" };
}

// Staging GET login helper: /api/seed-staging?secret=…&id=…&email=…&to=…
// Sets the __naia_tok cookie and redirects — allows browser-based test login.
export async function loader({ request }) {
  // Hard block in non-staging — no secret check, no DB access, no side effects.
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);

  // ── Login-ticket redemption — no secret in this URL at all ──────────────
  // The ticket itself (signed, short-lived, single-use) is the only thing
  // that authorizes this request; it is issued separately by the header-
  // authenticated createLoginLink action.
  const ticket = url.searchParams.get("ticket");
  if (ticket) {
    const redeemed = redeemLoginTicket(ticket);
    if (!redeemed) {
      return new Response("Login link is invalid, expired, or already used.", { status: 410 });
    }
    const customer = await prisma.customer.findUnique({
      where: { id: redeemed.customerId },
      select: { id: true },
    });
    if (!customer) return new Response("Not Found", { status: 404 });

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const sessionTtlSeconds = 2 * 60 * 60; // 2h — this is a QA session, not the ticket itself
    const expiresAt = new Date(Date.now() + sessionTtlSeconds * 1000);
    await prisma.naiaSession.create({ data: { tokenHash, customerId: customer.id, expiresAt } });

    const cookieHeader = `__naia_tok=${rawToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${sessionTtlSeconds}`;
    return new Response(null, {
      status: 302,
      headers: { "Set-Cookie": cookieHeader, Location: redeemed.to },
    });
  }

  const secret = url.searchParams.get("secret");
  if (!process.env.STAGING_SEED_SECRET || secret !== process.env.STAGING_SEED_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  // ── setProfileVersion (GET) ──────────────────────────────────────────────
  // Accepts STAGING_FIX_SECRET (or STAGING_SEED_SECRET) via ?fixSecret=...
  const actionParam = url.searchParams.get("_action");
  if (actionParam === "setProfileVersion") {
    const fixSecret = url.searchParams.get("fixSecret");
    const validFix =
      (process.env.STAGING_FIX_SECRET && fixSecret === process.env.STAGING_FIX_SECRET) ||
      fixSecret === process.env.STAGING_SEED_SECRET;
    if (!validFix) return new Response("Forbidden", { status: 403 });
    const cid     = url.searchParams.get("shopifyCustomerId");
    const byEmail = url.searchParams.get("email");
    const ver     = Number(url.searchParams.get("version") ?? "6");
    if (!cid && !byEmail) return Response.json({ error: "shopifyCustomerId or email required" }, { status: 400 });
    const customer = await prisma.customer.findFirst({
      where: cid ? { shopifyCustomerId: cid } : { email: byEmail },
      include: { onboardingProfile: { select: { id: true, completed: true, profileVersion: true } } },
    });
    if (!customer) return Response.json({ error: "customer not found" }, { status: 404 });
    const op = customer.onboardingProfile;
    if (!op) return Response.json({ error: "no onboarding profile" }, { status: 404 });
    const before = { profileVersion: op.profileVersion };
    const after = await prisma.onboardingProfile.update({
      where: { id: op.id },
      data: { profileVersion: ver },
      select: { id: true, completed: true, profileVersion: true },
    });
    return Response.json({ ok: true, shopifyCustomerId: customer.shopifyCustomerId, before, after });
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

  // Optional ?ttl=<seconds> — a QA caller can request a much shorter-lived
  // session than the 30-day default (clamped 60s..30d either way). Every
  // existing caller that omits it keeps today's exact 30-day behaviour.
  const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;
  const ttlParam = Number.parseInt(url.searchParams.get("ttl") ?? "", 10);
  const ttlSeconds = Number.isFinite(ttlParam)
    ? Math.min(Math.max(ttlParam, 60), DEFAULT_TTL_SECONDS)
    : DEFAULT_TTL_SECONDS;

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
  await prisma.naiaSession.create({
    data: { tokenHash, customerId: customer.id, expiresAt },
  });

  const cookieHeader = `__naia_tok=${rawToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttlSeconds}`;
  return new Response(null, {
    status: 302,
    headers: { "Set-Cookie": cookieHeader, Location: to },
  });
}

export async function action({ request }) {
  // Hard block in non-staging — before reading headers, body, or touching DB.
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const act = body?._action ?? "createCustomer";

  // ── backfillTaste — accepts STAGING_FIX_SECRET or STAGING_SEED_SECRET ──────
  // Idempotent backfill of TasteEvidence + StyleTendency for one customer.
  // Returns detailed counts and tendency states.
  if (act === "backfillTaste" || act === "tendencyReport") {
    const { fixSecret, customerId, shopifyCustomerId, email } = body ?? {};
    const validFix =
      (process.env.STAGING_FIX_SECRET && fixSecret === process.env.STAGING_FIX_SECRET) ||
      (process.env.STAGING_SEED_SECRET && fixSecret === process.env.STAGING_SEED_SECRET);
    if (!validFix) return new Response("Forbidden", { status: 403 });

    // Resolve customer
    let customer = null;
    if (customerId) {
      customer = await prisma.customer.findUnique({ where: { id: String(customerId) }, select: { id: true, shopifyCustomerId: true, email: true } });
    } else if (shopifyCustomerId) {
      customer = await prisma.customer.findUnique({ where: { shopifyCustomerId: String(shopifyCustomerId) }, select: { id: true, shopifyCustomerId: true, email: true } });
    } else if (email) {
      customer = await prisma.customer.findFirst({ where: { email: String(email) }, select: { id: true, shopifyCustomerId: true, email: true } });
    }
    if (!customer) return Response.json({ error: "customer not found" }, { status: 404 });
    const cid = customer.id;

    if (act === "tendencyReport") {
      // Return current tendency states without running backfill
      const tendencies = await prisma.styleTendency.findMany({
        where: { customerId: cid },
        orderBy: [{ observationKey: "asc" }, { generation: "desc" }],
        select: { observationKey: true, dimension: true, value: true, generation: true, state: true, wSupport: true, wContradict: true, wNet: true, effectiveSupport: true, distinctRecords: true, distinctSources: true, dominantPolarity: true, observationFamily: true, claimText: true, customerFeedback: true, customerFeedbackAt: true },
      });
      const evidenceCounts = await prisma.tasteEvidence.groupBy({ by: ["source"], where: { customerId: cid }, _count: { id: true } });
      return Response.json({ customerId: cid, tendencies, evidenceBySource: Object.fromEntries(evidenceCounts.map(r => [r.source, r._count.id])) });
    }

    // ── backfillTaste ─────────────────────────────────────────────────────────
    const report = { styleme: 0, postwear: 0, closet: 0, buyskip: 0, errors: [] };

    // StyleMe outcomes
    const outcomes = await prisma.styleMeOutcome.findMany({
      where: { customerId: cid },
      include: { suggestion: { include: { session: { select: { currentMood: true, occasion: true } } } } },
    });
    for (const outcome of outcomes) {
      try {
        const rows = extractStyleMeEvidence(outcome, { currentMood: outcome.suggestion?.session?.currentMood ?? null, occasion: outcome.suggestion?.session?.occasion ?? null });
        await writeSourceEvidence(cid, "STYLEME_OUTCOME", outcome.id, rows);
        report.styleme += rows.length;
      } catch (e) { report.errors.push(`styleme:${outcome.id}:${e.message?.slice(0, 60)}`); }
    }

    // PostWear reviews
    const reviews = await prisma.postOutfitReview.findMany({
      where: { customerId: cid },
      include: { session: { select: { currentMood: true, occasion: true } } },
    });
    for (const review of reviews) {
      try {
        const rows = extractPostWearEvidence(review, { currentMood: review.session?.currentMood ?? null, occasion: review.session?.occasion ?? null });
        await writeSourceEvidence(cid, "POST_OUTFIT_REVIEW", review.id, rows);
        report.postwear += rows.length;
      } catch (e) { report.errors.push(`postwear:${review.id}:${e.message?.slice(0, 60)}`); }
    }

    // Closet items
    const items = await prisma.closetItem.findMany({
      where: { customerId: cid },
      select: { id: true, customerId: true, category: true, garmentRelationships: true, updatedAt: true },
    });
    for (const item of items) {
      try {
        const rows = extractClosetEvidence(item);
        await writeSourceEvidence(cid, "CLOSET_RELATIONSHIP", item.id, rows);
        report.closet += rows.length;
      } catch (e) { report.errors.push(`closet:${item.id}:${e.message?.slice(0, 60)}`); }
    }

    // BuySkip outcomes
    const analyses = await prisma.buyOrSkipAnalysis.findMany({
      where: { customerId: cid },
      include: { outcome: { select: { id: true, postPurchaseOutcome: true, createdAt: true } } },
    });
    for (const analysis of analyses) {
      if (!analysis.outcome) continue;
      const outcome = analysis.outcome;
      try {
        const rows = extractBuySkipEvidence({ id: outcome.id, customerId: cid, postPurchaseOutcome: outcome.postPurchaseOutcome, category: analysis.category, createdAt: outcome.createdAt });
        await writeSourceEvidence(cid, "BUYSKIP_OUTCOME", outcome.id, rows);
        report.buyskip += rows.length;
      } catch (e) { report.errors.push(`buyskip:${outcome.id}:${e.message?.slice(0, 60)}`); }
    }

    // Final reconcile
    await reconcileObservations(cid);

    // Read back tendencies
    const tendencies = await prisma.styleTendency.findMany({
      where: { customerId: cid },
      orderBy: [{ observationKey: "asc" }, { generation: "desc" }],
      select: { observationKey: true, dimension: true, value: true, generation: true, state: true, wSupport: true, wContradict: true, wNet: true, effectiveSupport: true, distinctRecords: true, distinctSources: true, dominantPolarity: true, observationFamily: true, claimText: true, customerFeedback: true, customerFeedbackAt: true },
    });
    const evidenceCounts = await prisma.tasteEvidence.groupBy({ by: ["source"], where: { customerId: cid }, _count: { id: true } });

    return Response.json({ ok: true, customerId: cid, evidenceWritten: report, evidenceBySource: Object.fromEntries(evidenceCounts.map(r => [r.source, r._count.id])), tendencies });
  }

  // ── fixCustomerEmail — accepts STAGING_FIX_SECRET ────────────────────────
  // Update the email on a Customer record that has email = null (or a known wrong value).
  // Body: { _action: "fixCustomerEmail", fixSecret, email, customerId? }
  // If customerId is omitted, targets the first Customer with email IS NULL.
  if (act === "fixCustomerEmail") {
    const { fixSecret, email: newEmail, customerId } = body ?? {};
    const validFix =
      (process.env.STAGING_FIX_SECRET && fixSecret === process.env.STAGING_FIX_SECRET) ||
      (process.env.STAGING_SEED_SECRET && fixSecret === process.env.STAGING_SEED_SECRET);
    if (!validFix) return new Response("Forbidden", { status: 403 });
    if (!newEmail) return Response.json({ error: "email required" }, { status: 400 });

    let result;
    if (customerId) {
      result = await prisma.customer.update({
        where: { id: String(customerId) },
        data: { email: String(newEmail) },
        select: { id: true, shopifyCustomerId: true, email: true },
      });
      return Response.json({ ok: true, updated: 1, customer: result });
    }

    // No customerId — update all customers with null email
    const updated = await prisma.customer.updateMany({
      where: { email: null },
      data: { email: String(newEmail) },
    });
    return Response.json({ ok: true, updated: updated.count });
  }

  // All other actions require x-seed-secret, matching EITHER the long-
  // standing STAGING_SEED_SECRET or the dedicated WI_QA_LOGIN_SECRET (see
  // isValidSeedSecret below). Both are header-only — never accepted from a
  // query string on this path.
  const secret = request.headers.get("x-seed-secret");
  if (!isValidSeedSecret(secret)) {
    return new Response("Forbidden", { status: 403 });
  }

  // ── createDuplicateMonthTrendEditFixture / deleteDuplicateMonthTrendEditFixture ──
  // Unlike every other action in this file, EditorialTrendReport is NOT
  // customer-scoped — it is global, publicly-visible content on /trends and
  // /trends/my-edits for every real customer on this staging environment,
  // not just test-batch1- fixtures. That is a materially bigger blast
  // radius than this file's usual "wrong customerId can only ever touch a
  // test-batch1- row" guarantee, so it gets an extra, independent gate on
  // top of the standard staging-only + x-seed-secret checks every other
  // action already requires: TREND_EDIT_FIXTURE_ENABLED must be the exact
  // string "true", fail-closed when unset — same pattern as
  // SAVED_LOOKS_FIXTURE_CUSTOMER_IDS above, applied to the axis that
  // actually matters here (existence of ANY such content at all, not which
  // customer it's scoped to, since there is no customer to scope to).
  //
  // No caller-supplied input of any kind — both the two fixture slugs and
  // the editionMonth they share are hardcoded below, so this can never
  // become a general "create arbitrary editorial content" primitive no
  // matter what a caller sends. editionMonth is deliberately a far-future,
  // never-real value (2030-01) so it can never collide with or be mistaken
  // for genuine editorial content, and is trivially greppable for cleanup
  // verification. Both rows are clearly marked in their own title/summary
  // text as QA-only. Idempotent (upsert, not create) — re-running this
  // action is always safe and never creates a 3rd/4th row.
  if (act === "createDuplicateMonthTrendEditFixture" || act === "deleteDuplicateMonthTrendEditFixture") {
    if (process.env.TREND_EDIT_FIXTURE_ENABLED !== "true") {
      return Response.json({ error: "TREND_EDIT_FIXTURE_ENABLED must be \"true\" on this environment" }, { status: 403 });
    }

    const SLUGS = ["test-batch1-trend-edit-samemonth-a", "test-batch1-trend-edit-samemonth-b"];
    const EDITION_MONTH = "2030-01";

    if (act === "deleteDuplicateMonthTrendEditFixture") {
      const deleted = await prisma.editorialTrendReport.deleteMany({ where: { slug: { in: SLUGS } } });
      return Response.json({ deletedCount: deleted.count });
    }

    const base = {
      season: "QA Fixture — not a real season",
      status: "PUBLISHED",
      editionMonth: EDITION_MONTH,
      summary: "QA fixture — safe to ignore. Exercises the same-editionMonth grouping path only.",
      editorialIntro: "QA fixture — safe to ignore. Exercises the same-editionMonth grouping path only.",
    };
    const created = [];
    for (const [i, slug] of SLUGS.entries()) {
      const row = await prisma.editorialTrendReport.upsert({
        where: { slug },
        create: { slug, title: `[QA TEST] Same-month edit ${i === 0 ? "A" : "B"}`, ...base },
        update: base,
      });
      created.push({ id: row.id, slug: row.slug });
    }
    return Response.json({ created, editionMonth: EDITION_MONTH });
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

  // ── createLoginLink — QA fixture only ────────────────────────────────────
  // Header-authenticated (x-seed-secret, like every action below this
  // point) — never the URL. Returns a short-lived, single-use ticket URL
  // that contains NO secret: GET-ing it (see loader's ?ticket= branch) is
  // what actually sets the session cookie. shopifyCustomerId must already
  // be test-batch1--prefixed; this never creates a non-fixture customer.
  if (act === "createLoginLink") {
    const { shopifyCustomerId, email, to, ttlSeconds } = body ?? {};
    if (!shopifyCustomerId || !String(shopifyCustomerId).startsWith(TEST_CUSTOMER_PREFIX)) {
      return Response.json({ error: `shopifyCustomerId must start with ${TEST_CUSTOMER_PREFIX}` }, { status: 400 });
    }
    if (!email) return Response.json({ error: "email required" }, { status: 400 });
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

    const ticket = createLoginTicket({ customerId: customer.id, to: destination, ttlSeconds });
    const ticketUrl = `${new URL(request.url).origin}/api/seed-staging?ticket=${ticket}`;
    return Response.json({ ok: true, url: ticketUrl, expiresInSeconds: LOGIN_TICKET_DEFAULT_TTL_SECONDS });
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

  // ── getFixtureSnapshot — QA fixture only, read-only ──────────────────────
  // Full closet + Style Passport dump for a test-batch1- customer, so QA
  // audits can be written against the real seeded data instead of assumed
  // or re-derived values. Read-only — touches nothing. Same requireTestCustomer
  // gate as every mutating action in this file.
  if (act === "getFixtureSnapshot") {
    const { customerId } = body ?? {};
    if (!customerId) return Response.json({ error: "customerId required" }, { status: 400 });
    const customer = await requireTestCustomer(customerId);
    if (!customer) {
      return Response.json({ error: "customerId must belong to a test-batch1- fixture customer" }, { status: 403 });
    }
    const [profile, closetItems] = await Promise.all([
      prisma.onboardingProfile.findUnique({ where: { customerId: String(customerId) } }),
      prisma.closetItem.findMany({
        where: { customerId: String(customerId) },
        orderBy: { createdAt: "asc" },
        select: {
          id: true, name: true, category: true, subcategory: true,
          colors: true, primaryColor: true, pattern: true, material: true,
          styleTags: true, seasons: true, occasions: true,
          silhouette: true, fitProfile: true, hemLength: true, topLength: true,
          sleeveLength: true, necklineCoverage: true, shoulderCoverage: true,
          midriffExposed: true, waistShape: true, formality: true, stylePersonality: true,
          garmentRelationships: true, analysisStatus: true, timesWorn: true, favorite: true,
        },
      }),
    ]);
    return Response.json({
      customer: { id: customer.id, shopifyCustomerId: customer.shopifyCustomerId },
      profile,
      closetItemCount: closetItems.length,
      closetItems,
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

  // ── setOnboardingProfile — QA fixture only ───────────────────────────────
  // Upserts arbitrary OnboardingProfile fields for a test customer so WI /
  // Passport-dependent QA can be set up deterministically, without walking
  // the full onboarding questionnaire by hand. Same staging-only + secret
  // gate as every other action in this file.
  if (act === "setOnboardingProfile") {
    const { customerId, profile } = body ?? {};
    if (!customerId || !profile || typeof profile !== "object") {
      return Response.json({ error: "customerId and profile object required" }, { status: 400 });
    }
    if (!(await requireTestCustomer(customerId))) {
      return Response.json({ error: "customerId must belong to a test-batch1- fixture customer" }, { status: 403 });
    }
    const data = { completed: true, ...profile };
    const saved = await prisma.onboardingProfile.upsert({
      where: { customerId: String(customerId) },
      create: { customerId: String(customerId), ...data },
      update: data,
      select: { id: true, completed: true },
    });
    return Response.json({ ok: true, profileId: saved.id, completed: saved.completed });
  }

  // ── createClosetItemDetailed — QA fixture only ───────────────────────────
  // Creates a ClosetItem with caller-supplied garment-intelligence fields
  // (colour, silhouette, coverage vocab, etc.) and analysisStatus "ready" by
  // default, so WI QA can exercise specific real wardrobe shapes without a
  // vision-model photo round trip.
  if (act === "createClosetItemDetailed") {
    const { customerId, item } = body ?? {};
    if (!customerId || !item || typeof item !== "object") {
      return Response.json({ error: "customerId and item object required" }, { status: 400 });
    }
    if (!(await requireTestCustomer(customerId))) {
      return Response.json({ error: "customerId must belong to a test-batch1- fixture customer" }, { status: 403 });
    }
    const created = await prisma.closetItem.create({
      data: {
        customerId: String(customerId),
        analysisStatus: "ready",
        ...item,
      },
      select: { id: true, category: true, primaryColor: true },
    });
    return Response.json({ closetItemId: created.id, category: created.category, primaryColor: created.primaryColor });
  }

  // ── deleteClosetItemsByName — QA fixture only ────────────────────────────
  // Lets a fixture-correction script swap out ONE closet item by name
  // without resetting the whole customer (createCustomer is idempotent, but
  // createClosetItemDetailed is not — re-running the full seed script would
  // duplicate every other item). Scoped to test-batch1- customers only, same
  // as every other action here.
  if (act === "deleteClosetItemsByName") {
    const { customerId, name } = body ?? {};
    if (!customerId || !name) {
      return Response.json({ error: "customerId and name required" }, { status: 400 });
    }
    if (!(await requireTestCustomer(customerId))) {
      return Response.json({ error: "customerId must belong to a test-batch1- fixture customer" }, { status: 403 });
    }
    const deleted = await prisma.closetItem.deleteMany({
      where: { customerId: String(customerId), name: String(name) },
    });
    return Response.json({ ok: true, deletedCount: deleted.count });
  }

  // ── createSavedLookDetailed — QA fixture only, explicit allowlist ────────
  // Creates a SavedLook referencing the customer's OWN existing ClosetItem
  // rows (never cross-customer — each closetItemId is independently
  // ownership-checked, same discipline as createClosetItemDetailed above),
  // so WI QA can exercise the create/view/edit/delete lifecycle without a
  // real StyleMe session or any AI/provider call. Unlike the actions above,
  // the target customer must ALSO be explicitly listed in
  // SAVED_LOOKS_FIXTURE_CUSTOMER_IDS — see requireAllowlistedSavedLooksFixtureCustomer.
  if (act === "createSavedLookDetailed") {
    const { customerId, name, occasion, closetItemIds } = body ?? {};
    if (!customerId || !Array.isArray(closetItemIds) || closetItemIds.length === 0) {
      return Response.json({ error: "customerId and a non-empty closetItemIds array required" }, { status: 400 });
    }
    if (!(await requireAllowlistedSavedLooksFixtureCustomer(customerId))) {
      return Response.json({ error: "customerId must be a test-batch1- fixture customer explicitly listed in SAVED_LOOKS_FIXTURE_CUSTOMER_IDS" }, { status: 403 });
    }
    const owned = await prisma.closetItem.findMany({
      where: { id: { in: closetItemIds }, customerId: String(customerId) },
      select: { id: true, category: true },
    });
    if (owned.length !== closetItemIds.length) {
      return Response.json({ error: "one or more closetItemIds do not belong to this customer" }, { status: 403 });
    }
    // ClosetCategory (TOPS/BOTTOMS/...) -> OutfitItemType (TOP/BOTTOM/...) —
    // direct categories only; ACTIVEWEAR/SWIMWEAR/LOUNGEWEAR/OTHER have no
    // 1:1 OutfitItemType and are refused rather than guessed.
    const CATEGORY_TO_ITEM_TYPE = {
      TOPS: "TOP", BOTTOMS: "BOTTOM", DRESSES: "DRESS", OUTERWEAR: "OUTERWEAR",
      SHOES: "SHOES", BAGS: "BAG", ACCESSORIES: "ACCESSORY", JEWELRY: "JEWELRY",
    };
    const unmapped = owned.find((item) => !CATEGORY_TO_ITEM_TYPE[item.category]);
    if (unmapped) {
      return Response.json({ error: `closetItem ${unmapped.id} has category ${unmapped.category}, which has no direct OutfitItemType mapping` }, { status: 400 });
    }
    const created = await prisma.savedLook.create({
      data: {
        customerId: String(customerId),
        name: name ?? null,
        occasion: occasion ?? null,
        items: {
          create: owned.map((item) => ({ itemType: CATEGORY_TO_ITEM_TYPE[item.category], closetItemId: item.id })),
        },
      },
      select: { id: true, name: true, occasion: true, items: { select: { id: true, closetItemId: true } } },
    });
    return Response.json({ savedLookId: created.id, name: created.name, occasion: created.occasion, itemCount: created.items.length });
  }

  // ── getSavedLook — QA fixture only, read-only ────────────────────────────
  if (act === "getSavedLook") {
    const { customerId, savedLookId } = body ?? {};
    if (!customerId || !savedLookId) {
      return Response.json({ error: "customerId and savedLookId required" }, { status: 400 });
    }
    if (!(await requireAllowlistedSavedLooksFixtureCustomer(customerId))) {
      return Response.json({ error: "customerId must be a test-batch1- fixture customer explicitly listed in SAVED_LOOKS_FIXTURE_CUSTOMER_IDS" }, { status: 403 });
    }
    const look = await prisma.savedLook.findFirst({
      where: { id: String(savedLookId), customerId: String(customerId) },
      select: { id: true, customerId: true, name: true, occasion: true, items: { select: { id: true, closetItemId: true, itemType: true } } },
    });
    if (!look) return Response.json({ notFound: true });
    return Response.json({ savedLook: look });
  }

  // ── deleteSavedLook — QA fixture only ────────────────────────────────────
  // Exact-id delete, scoped to the owning customer — never a sweep. Items
  // cascade via the schema's onDelete: Cascade on SavedLookItem.
  if (act === "deleteSavedLook") {
    const { customerId, savedLookId } = body ?? {};
    if (!customerId || !savedLookId) {
      return Response.json({ error: "customerId and savedLookId required" }, { status: 400 });
    }
    if (!(await requireAllowlistedSavedLooksFixtureCustomer(customerId))) {
      return Response.json({ error: "customerId must be a test-batch1- fixture customer explicitly listed in SAVED_LOOKS_FIXTURE_CUSTOMER_IDS" }, { status: 403 });
    }
    const deleted = await prisma.savedLook.deleteMany({
      where: { id: String(savedLookId), customerId: String(customerId) },
    });
    return Response.json({ ok: true, deletedCount: deleted.count });
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

  // ── setProfileVersion ─────────────────────────────────────────────────────
  if (act === "setProfileVersion") {
    const { shopifyCustomerId: cid, email: byEmail, version = 6 } = body ?? {};
    if (!cid && !byEmail) return Response.json({ error: "shopifyCustomerId or email required" }, { status: 400 });
    const customer = await prisma.customer.findFirst({
      where: cid ? { shopifyCustomerId: String(cid) } : { email: String(byEmail) },
      include: { onboardingProfile: { select: { id: true, completed: true, profileVersion: true } } },
    });
    if (!customer) return Response.json({ error: "customer not found" }, { status: 404 });
    const op = customer.onboardingProfile;
    if (!op) return Response.json({ error: "no onboarding profile" }, { status: 404 });
    const before = { profileVersion: op.profileVersion };
    const after = await prisma.onboardingProfile.update({
      where: { id: op.id },
      data: { profileVersion: Number(version) },
      select: { id: true, completed: true, profileVersion: true },
    });
    return Response.json({ ok: true, shopifyCustomerId: customer.shopifyCustomerId, before, after });
  }

  return Response.json({ error: "Unknown _action" }, { status: 400 });
}
