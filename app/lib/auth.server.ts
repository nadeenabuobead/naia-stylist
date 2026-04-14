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
export async function getCustomer(request: Request) {
  const customerId = await getCustomerId(request);
  
  if (!customerId) {
    return null;
  }
  
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: {
      onboardingProfile: true,
    },
  });
  
  return customer;
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
