// app/lib/auth.server.ts
import { getSession } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";

/**
 * Get the current customer ID from the session
 */
export async function getCustomerId(request: Request): Promise<string | null> {
  const session = await getSession(request.headers.get("Cookie"));
  const customerId = session.get("customerId");
  
  return customerId || null;
}

/**
 * Get the current customer from the database
 */
export async function getCustomerId(request: Request): Promise<string | null> {
  // First try the session cookie
  const session = await getSession(request.headers.get("Cookie"));
  const customerId = session.get("customerId");
  if (customerId) return customerId;

  // Fall back to naia_customer_data cookie
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/naia_customer_data=([^;]+)/);
  if (!match) return null;

  try {
    const decoded = JSON.parse(atob(decodeURIComponent(match[1])));
    if (!decoded.shopifyId) return null;

    const customer = await prisma.customer.upsert({
      where: { shopifyCustomerId: String(decoded.shopifyId) },
      create: {
        shopifyCustomerId: String(decoded.shopifyId),
        email: decoded.email || null,
        firstName: decoded.firstName || null,
        lastName: decoded.lastName || null,
      },
      update: {
        email: decoded.email || undefined,
        firstName: decoded.firstName || undefined,
        lastName: decoded.lastName || undefined,
      },
    });

    return customer.id;
  } catch {
    return null;
  }
}
/**
 * Require a logged-in customer, redirect to login if not authenticated
 */
export async function requireCustomerId(
  request: Request,
  redirectTo: string = "/login"
): Promise<string> {
  const customerId = await getCustomerId(request);
  
  if (!customerId) {
    throw new Response(null, {
      status: 302,
      headers: {
        Location: redirectTo,
      },
    });
  }
  
  return customerId;
}

/**
 * Validate Shopify customer token and create/update local customer
 * This would be called after Shopify OAuth login
 */
export async function authenticateShopifyCustomer({
  shopifyCustomerId,
  email,
  firstName,
  lastName,
}: {
  shopifyCustomerId: string;
  email: string;
  firstName?: string;
  lastName?: string;
}) {
  // Upsert customer in our database
  const customer = await prisma.customer.upsert({
    where: { shopifyCustomerId },
    create: {
      shopifyCustomerId,
      email,
      firstName,
      lastName,
    },
    update: {
      email,
      firstName,
      lastName,
      updatedAt: new Date(),
    },
  });
  
  return customer;
}
