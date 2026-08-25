import type { LoaderFunctionArgs } from "react-router";
import prisma from "~/db.server";
import { resolveNaiaSession } from "~/lib/naia-session.server";

// Staging-only, read-only identity diagnostic.
// Hard-blocked in production before any DB access.
// Identifies the caller via their existing __naia_tok cookie — no secrets needed.
export async function loader({ request }: LoaderFunctionArgs) {
  if (process.env.VERCEL_ENV === "production") {
    return new Response("Not Found", { status: 404 });
  }

  // Resolve current session from cookie — same code path the app uses everywhere.
  // Returns Customer (with onboardingProfile) or null; never redirects.
  const currentCustomer = await resolveNaiaSession(request);

  // All Customer records, oldest first.
  const allCustomers = await prisma.customer.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      onboardingProfile: {
        select: { id: true, completed: true, updatedAt: true },
      },
      naiaModel: {
        select: { id: true, createdAt: true },
      },
      selfieAnalysis: {
        select: { id: true, status: true, createdAt: true },
      },
      _count: {
        select: {
          closetItems: true,
          savedLooks: true,
          naiaSessions: true,
        },
      },
    },
  });

  // Ten most-recent NaiaSession records — timestamps only, no token hash.
  const recentSessions = await prisma.naiaSession.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      customerId: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  return Response.json({
    currentSession: currentCustomer
      ? { customerId: currentCustomer.id, shopifyCustomerId: currentCustomer.shopifyCustomerId }
      : null,
    totalCustomers: allCustomers.length,
    customers: allCustomers.map((c: (typeof allCustomers)[number]) => ({
      id: c.id,
      shopifyCustomerId: c.shopifyCustomerId,
      email: c.email,
      createdAt: c.createdAt,
      isCurrent: currentCustomer ? c.id === currentCustomer.id : null,
      closetItems: c._count.closetItems,
      savedLooks: c._count.savedLooks,
      naiaSessions: c._count.naiaSessions,
      onboardingProfile: c.onboardingProfile
        ? {
            id: c.onboardingProfile.id,
            completed: c.onboardingProfile.completed,
            updatedAt: c.onboardingProfile.updatedAt,
          }
        : null,
      naiaModel: c.naiaModel
        ? { id: c.naiaModel.id, createdAt: c.naiaModel.createdAt }
        : null,
      selfieAnalysis: c.selfieAnalysis
        ? {
            id: c.selfieAnalysis.id,
            status: c.selfieAnalysis.status,
            createdAt: c.selfieAnalysis.createdAt,
          }
        : null,
    })),
    recentSessions: recentSessions.map((s: (typeof recentSessions)[number]) => ({
      id: s.id,
      customerId: s.customerId,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    })),
  });
}
