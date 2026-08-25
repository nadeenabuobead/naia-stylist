import type { ActionFunctionArgs } from "react-router";
import prisma from "~/db.server";
import { resolveNaiaSession } from "~/lib/naia-session.server";

// Temporary staging-only diagnostic. POST-only, no-store.
// Protected by: production 404 + Vercel Deployment Protection + valid __naia_tok session.
// Returns zero customer identifiers — only shape/count data for diagnosis.
// Must be removed immediately after the diagnostic read.

const NO_CACHE = { "Cache-Control": "no-store" } as const;

export async function action({ request }: ActionFunctionArgs) {
  if (process.env.VERCEL_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: { ...NO_CACHE, Allow: "POST" } });
  }

  const currentCustomer = await resolveNaiaSession(request);
  if (!currentCustomer) {
    return new Response("Unauthorized", { status: 401, headers: NO_CACHE });
  }

  const [current, counts] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: currentCustomer.id },
      include: {
        onboardingProfile: { select: { completed: true } },
        selfieAnalysis:    { select: { status: true } },
        naiaModel:         { select: { id: true } },
      },
    }),
    prisma.customer.findUnique({
      where: { id: currentCustomer.id },
      select: { _count: { select: { closetItems: true, savedLooks: true } } },
    }),
  ]);

  if (!current || !counts) {
    return Response.json({ error: "session resolved but customer not found" }, { status: 500, headers: NO_CACHE });
  }

  const candidateRow = await prisma.customer.findFirst({
    where: {
      id: { not: currentCustomer.id },
      OR: [
        { closetItems:       { some: {} } },
        { onboardingProfile: { completed: true } },
        { selfieAnalysis:    { isNot: null } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: {
      onboardingProfile: { select: { completed: true } },
      selfieAnalysis:    { select: { status: true } },
      naiaModel:         { select: { id: true } },
      _count: { select: { closetItems: true, savedLooks: true } },
    },
  });

  function classifyIdentity(candidateId: string, currentId: string) {
    const isGid = (v: string) => v.startsWith("gid://shopify/");
    if (isGid(candidateId) !== isGid(currentId)) return "legacyFormatMismatch";
    const num = (v: string) => (isGid(v) ? v.split("/").pop()! : v);
    if (num(candidateId) === num(currentId)) return "legacyFormatMismatch";
    if (/^\d+$/.test(candidateId) && /^\d+$/.test(currentId)) return "differentShopifyCustomerId";
    return "unableToDetermine";
  }

  return Response.json({
    currentCustomer: {
      createdAt:        current.createdAt,
      passportExists:   current.onboardingProfile !== null,
      passportCompleted: current.onboardingProfile?.completed ?? false,
      closetItems:      counts._count.closetItems,
      savedLooks:       counts._count.savedLooks,
      selfieExists:     current.selfieAnalysis !== null,
      selfieStatus:     current.selfieAnalysis?.status ?? null,
      naiaModelExists:  current.naiaModel !== null,
    },
    candidate: candidateRow
      ? {
          found:             true,
          createdAt:         candidateRow.createdAt,
          passportExists:    candidateRow.onboardingProfile !== null,
          passportCompleted: candidateRow.onboardingProfile?.completed ?? false,
          closetItems:       candidateRow._count.closetItems,
          savedLooks:        candidateRow._count.savedLooks,
          selfieExists:      candidateRow.selfieAnalysis !== null,
          naiaModelExists:   candidateRow.naiaModel !== null,
          identityComparison: classifyIdentity(
            candidateRow.shopifyCustomerId,
            currentCustomer.shopifyCustomerId
          ),
        }
      : { found: false },
  }, { headers: NO_CACHE });
}
