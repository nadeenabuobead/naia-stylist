import prisma from "../db.server.js";

const SECRET = process.env.NAIA_CUSTOMER_SECRET || "naia-fallback-secret";

export function getCustomerTokenFromRequest(request) {
  const cookies = request.headers.get("Cookie") || "";
  
  // Try new base64 cookie first
  const dataMatch = cookies.match(/naia_customer_data=([^;]+)/);
  if (dataMatch) {
    try {
      const decoded = JSON.parse(atob(decodeURIComponent(dataMatch[1])));
      if (decoded.shopifyId) return { type: "data", payload: decoded };
    } catch {}
  }

  // Fall back to JWT token
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return { type: "token", token: authHeader.slice(7) };
  }
  const tokenMatch = cookies.match(/naia_customer_token=([^;]+)/);
  if (tokenMatch) return { type: "token", token: tokenMatch[1] };

  return null;
}

export async function authenticateCustomer(request) {
  const auth = getCustomerTokenFromRequest(request);
  if (!auth) return { customer: null };

  let shopifyId, email, firstName, lastName;

  if (auth.type === "data") {
    ({ shopifyId, email, firstName, lastName } = auth.payload);
  } else {
    return { customer: null };
  }

  try {
    const customer = await prisma.customer.upsert({
      where: { shopifyCustomerId: String(shopifyId) },
      update: {
        email: email || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
      },
      create: {
        shopifyCustomerId: String(shopifyId),
        email: email || null,
        firstName: firstName || null,
        lastName: lastName || null,
      },
    });
    return { customer };
  } catch (err) {
    console.error("Customer auth DB error:", err);
    return { customer: null };
  }
}
