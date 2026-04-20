import { getSession } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";

export async function getCustomerId(request: Request): Promise<string | null> {
  // Check URL param first (for Shopify App Proxy)
  try {
    const url = new URL(request.url);
    const tokenParam = url.searchParams.get("naia_token");
    if (tokenParam) {
      const decoded = JSON.parse(atob(decodeURIComponent(tokenParam)));
      if (decoded.shopifyId) {
        const customer = await prisma.customer.upsert({
          where: { shopifyCustomerId: String(decoded.shopifyId) },
          create: { shopifyCustomerId: String(decoded.shopifyId), email: decoded.email || null, firstName: decoded.firstName || null, lastName: decoded.lastName || null },
          update: { email: decoded.email || undefined, firstName: decoded.firstName || undefined, lastName: decoded.lastName || undefined },
        });
        return customer.id;
      }
    }
  } catch {}

  // Check session cookie
  const session = await getSession(request.headers.get("Cookie"));
  const customerId = session.get("customerId");
  if (customerId) return customerId;

  // Check naia_customer_data cookie
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/naia_customer_data=([^;]+)/);
  if (!match) return null;

  try {
    const decoded = JSON.parse(atob(decodeURIComponent(match[1])));
    if (!decoded.shopifyId) return null;
    const customer = await prisma.customer.upsert({
      where: { shopifyCustomerId: String(decoded.shopifyId) },
      create: { shopifyCustomerId: String(decoded.shopifyId), email: decoded.email || null, firstName: decoded.firstName || null, lastName: decoded.lastName || null },
      update: { email: decoded.email || undefined, firstName: decoded.firstName || undefined, lastName: decoded.lastName || undefined },
    });
    return customer.id;
  } catch {
    return null;
  }
}

export async function getCustomer(request: Request) {
  const customerId = await getCustomerId(request);
  if (!customerId) return null;
  return prisma.customer.findUnique({
    where: { id: customerId },
    include: { onboardingProfile: true },
  });
}

export async function requireCustomerId(request: Request, redirectTo: string = "/login"): Promise<string> {
  const customerId = await getCustomerId(request);
  if (!customerId) {
    throw new Response(null, { status: 302, headers: { Location: redirectTo } });
  }
  return customerId;
}

export async function authenticateShopifyCustomer({ shopifyCustomerId, email, firstName, lastName }: { shopifyCustomerId: string; email: string; firstName?: string; lastName?: string; }) {
  return prisma.customer.upsert({
    where: { shopifyCustomerId },
    create: { shopifyCustomerId, email, firstName, lastName },
    update: { email, firstName, lastName, updatedAt: new Date() },
  });
}