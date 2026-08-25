import type { ActionFunctionArgs } from "react-router";
import prisma from "~/db.server";
import { resolveNaiaSession } from "~/lib/naia-session.server";

// Staging-only, read-only identity diagnostic.
// POST only — prevents caching and keeps the secret out of URLs/logs.
// Three gates (in order):
//   1. Hard 404 in production — before reading headers, body, or touching DB.
//   2. Valid __naia_tok session — 401 if absent or expired.
//   3. x-seed-secret header matches STAGING_SEED_SECRET — 403 if wrong.
// Returns only the authenticated customer's own data plus an anonymous
// server-side classification of any historical candidate.

const CACHE_HEADERS = { "Cache-Control": "no-store" } as const;

// No loader — GET requests receive 405.
export async function action({ request }: ActionFunctionArgs) {
  // ── Gate 1: hard block in production ────────────────────────────────────
  if (process.env.VERCEL_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CACHE_HEADERS, Allow: "POST" },
    });
  }

  // ── Gate 2: require a valid __naia_tok session ───────────────────────────
  // resolveNaiaSession never throws and never redirects — safe to await here.
  const currentCustomer = await resolveNaiaSession(request);
  if (!currentCustomer) {
    return new Response("Unauthorized", {
      status: 401,
      headers: CACHE_HEADERS,
    });
  }

  // ── Gate 3: require operator secret in header only ───────────────────────
  const providedSecret = request.headers.get("x-seed-secret");
  const expectedSecret = process.env.STAGING_SEED_SECRET;
  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return new Response("Forbidden", {
      status: 403,
      headers: CACHE_HEADERS,
    });
  }

  // ── Current customer — fetch own data ────────────────────────────────────
  const [current, currentCounts] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: currentCustomer.id },
      include: {
        onboardingProfile: { select: { completed: true, updatedAt: true } },
        selfieAnalysis:    { select: { status: true } },
        naiaModel:         { select: { id: true } },
      },
    }),
    prisma.customer.findUnique({
      where: { id: currentCustomer.id },
      select: {
        _count: {
          select: {
            closetItems:   true,
            savedLooks:    true,
            naiaSessions:  true,
          },
        },
      },
    }),
  ]);

  if (!current || !currentCounts) {
    return Response.json(
      { error: "Current customer not found in database" },
      { status: 500, headers: CACHE_HEADERS }
    );
  }

  // ── Candidate search — server-side only, no PII returned ─────────────────
  // Find the single most data-rich Customer that is not the current one.
  // "Data-rich" = has closetItems OR a completed passport OR selfieAnalysis.
  const candidateRow = await prisma.customer.findFirst({
    where: {
      id: { not: currentCustomer.id },
      OR: [
        { closetItems:      { some: {} } },
        { onboardingProfile: { completed: true } },
        { selfieAnalysis:   { isNot: null } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: {
      onboardingProfile: { select: { completed: true } },
      selfieAnalysis:    { select: { status: true } },
      naiaModel:         { select: { id: true } },
      _count: {
        select: { closetItems: true, savedLooks: true },
      },
    },
  });

  // ── Identity comparison — server-side classification, ID never exposed ────
  function classifyIdentity(
    candidateShopifyId: string,
    currentShopifyId: string
  ): "legacyFormatMismatch" | "differentShopifyCustomerId" | "unableToDetermine" {
    // Legacy format: if one looks like a full GID and the other is numeric
    const isGid = (v: string) => v.startsWith("gid://shopify/");
    if (isGid(candidateShopifyId) !== isGid(currentShopifyId)) {
      return "legacyFormatMismatch";
    }
    // Both numeric — strip GID suffix if present and compare
    const numeric = (v: string) => (isGid(v) ? v.split("/").pop()! : v);
    if (numeric(candidateShopifyId) === numeric(currentShopifyId)) {
      // Same underlying Shopify account but stored in different format
      return "legacyFormatMismatch";
    }
    // Both plain numeric strings, different values → genuinely different accounts
    if (/^\d+$/.test(candidateShopifyId) && /^\d+$/.test(currentShopifyId)) {
      return "differentShopifyCustomerId";
    }
    return "unableToDetermine";
  }

  const candidateResult = candidateRow
    ? {
        found: true as const,
        createdAt: candidateRow.createdAt,
        onboardingProfile: candidateRow.onboardingProfile
          ? { exists: true, completed: candidateRow.onboardingProfile.completed }
          : null,
        closetItems:   candidateRow._count.closetItems,
        savedLooks:    candidateRow._count.savedLooks,
        selfieAnalysis: candidateRow.selfieAnalysis
          ? { exists: true, status: candidateRow.selfieAnalysis.status }
          : null,
        naiaModel: { exists: candidateRow.naiaModel !== null },
        identityComparison: classifyIdentity(
          candidateRow.shopifyCustomerId,
          currentCustomer.shopifyCustomerId
        ),
      }
    : { found: false as const };

  // ── Response — authenticated customer's own data only ────────────────────
  return Response.json(
    {
      currentCustomer: {
        id:               current.id,
        shopifyCustomerId: current.shopifyCustomerId,
        createdAt:        current.createdAt,
        onboardingProfile: current.onboardingProfile
          ? {
              exists:    true,
              completed: current.onboardingProfile.completed,
              updatedAt: current.onboardingProfile.updatedAt,
            }
          : null,
        closetItems:  currentCounts._count.closetItems,
        savedLooks:   currentCounts._count.savedLooks,
        selfieAnalysis: current.selfieAnalysis
          ? { exists: true, status: current.selfieAnalysis.status }
          : null,
        naiaModel: { exists: current.naiaModel !== null },
        naiaSessions: currentCounts._count.naiaSessions,
      },
      candidate: candidateResult,
    },
    { headers: CACHE_HEADERS }
  );
}
