// app/routes/api.nadine-product-intelligence.tsx
// Phase 4A4 — NADINE product-page intelligence endpoint.
// Called via Shopify app proxy: /apps/naia-stylist/api/nadine-product-intelligence
// Proxy-gated: all requests arrive server-to-server from Shopify; HMAC is validated
// before any customer identity is trusted. No CORS headers — requests are same-origin
// from the browser's perspective (storefront → proxy → Vercel).
// No FASHN calls. No Prisma mutations. Fail-closed on unknown products.

import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { buildProductPageResponse } from "~/lib/ai/nadine-product-assessment";
import { isTryOnEligible } from "~/lib/ai/tryon-product-eligibility";
import { issueImageToken } from "~/lib/dev-tryon-image-tokens.server";
import { emitProductIntelligenceViewed, recordJourneyEvent } from "~/lib/ai/journey-events.server";
import type {
  CustomerAssessmentProfile,
  ClosetItemSummary,
} from "~/lib/ai/nadine-product-assessment.types";

// ── ClosetCategory → assessment category normalisation ───────────────────────
// Prisma enums are uppercase (TOPS, BOTTOMS, DRESSES, OUTERWEAR).
// The assessment engine uses lowercase singular ("top", "bottom", "dress", "outerwear").

function normaliseCategoryForAssessment(prismaCategory: string): string | null {
  switch (prismaCategory) {
    case "TOPS":      return "top";
    case "BOTTOMS":   return "bottom";
    case "DRESSES":   return "dress";
    case "OUTERWEAR": return "outerwear";
    default:          return null;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  // 1. Validate Shopify app-proxy HMAC (uses SHOPIFY_API_SECRET internally).
  //    Throws a 400 Response when the signature is missing, invalid, or tampered.
  //    Only after this succeeds is logged_in_customer_id trustworthy.
  try {
    await authenticate.public.appProxy(request);
  } catch (_) {
    return new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);

  // 2. logged_in_customer_id comes from Shopify's proxy — cryptographically bound to
  //    the HMAC. It cannot be forged or spoofed via body or header fields.
  const shopifyId = url.searchParams.get("logged_in_customer_id") || null;

  const productId = url.searchParams.get("productId");
  const productHandle = url.searchParams.get("handle");
  if (!productId && !productHandle) {
    return Response.json(
      { resolved: false, reason: "unknown-product" },
      { status: 400 },
    );
  }
  if (productId && !/^\d+$/.test(productId)) {
    return Response.json(
      { resolved: false, reason: "unknown-product" },
      { status: 400 },
    );
  }

  // ── Customer resolution ─────────────────────────────────────────────────────
  // Guests (no logged_in_customer_id) receive public product data only.
  // Authenticated customers receive personal assessment evidence.

  let profile: CustomerAssessmentProfile | null = null;
  let closetItems: ClosetItemSummary[] = [];
  let hasModel = false;
  let internalCustomerId: string | null = null;

  if (shopifyId) {
    const customer = await prisma.customer.findUnique({
      where: { shopifyCustomerId: shopifyId },
      include: {
        onboardingProfile: true,
        closetItems: {
          orderBy: { createdAt: "desc" },
          take: 100,
        },
        naiaModel: { select: { id: true } },
      },
    });

    if (customer) {
      const op = customer.onboardingProfile;
      if (op) {
        profile = {
          stylePersonalities: op.stylePersonalities,
          desiredFeelings: op.desiredFeelings,
          lifestyle: op.lifestyle ?? null,
          dressesFor: op.dressesFor,
          favoriteColors: op.favoriteColors,
          avoidColors: op.avoidColors,
          fitPreferences: op.fitPreferences,
          comfortLevel: op.comfortLevel ?? null,
        };
      }

      closetItems = customer.closetItems
        .map((item) => {
          const normalisedCategory = normaliseCategoryForAssessment(item.category as string);
          if (!normalisedCategory) return null;
          return {
            id: item.id,
            name: item.name ?? null,
            category: normalisedCategory,
            colors: item.colors,
            styleTags: item.styleTags,
            occasions: item.occasions,
          } satisfies ClosetItemSummary;
        })
        .filter((item): item is ClosetItemSummary => item !== null);

      hasModel = !!customer.naiaModel;
      internalCustomerId = customer.id;
    }
  }

  // productId may be null when resolving by handle; buildProductPageResponse uses the
  // GID reverse-map, so pass an empty string to trigger the unknown-product path when
  // only a handle was supplied. Handle-based resolution goes through its own path below.
  const resolvedProductId = productId ?? "";
  const intelligence = buildProductPageResponse(resolvedProductId, profile, closetItems, hasModel);

  // Handle-based fallback: if the GID lookup failed but a handle was supplied, try to
  // produce a minimal response that surfaces tryOnEligible without full intelligence.
  // This is used by the collection card widget which only has the Shopify product handle.
  const v8Handle = intelligence.resolved ? intelligence.v8Handle : (productHandle ?? null);

  // Fire-and-forget product intelligence viewed event for authenticated customers
  if (internalCustomerId && v8Handle) {
    try {
      const ev = emitProductIntelligenceViewed({
        customerId: internalCustomerId,
        productHandle: v8Handle,
        resolved: intelligence.resolved,
        closetItemCount: closetItems.length,
        hasModel,
      });
      recordJourneyEvent(ev);
    } catch { /* fire-and-forget */ }
  }

  const devTryOnEnabled = process.env.DEV_TRYON_UI_ENABLED === "true";
  const tryOnEligible = v8Handle ? isTryOnEligible(v8Handle) : false;
  let fixtureUrl: string | null = null;
  if (devTryOnEnabled && tryOnEligible && v8Handle) {
    const slug = v8Handle.replace(/\//g, "-");
    const token = issueImageToken(slug);
    fixtureUrl = `/app/dev-tryon-img/${slug}?t=${encodeURIComponent(token)}`;
  }

  return Response.json(
    {
      ...intelligence,
      authenticated: !!shopifyId,
      hasModel,
      tryOnEligible,
      devTryOnEnabled,
      fixtureUrl,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
