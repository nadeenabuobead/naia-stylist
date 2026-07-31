import { authenticate } from "../shopify.server";
import { createCustomerToken } from "../customer-auth.server.js";

// POST-only. No loader — GET requests receive 404.
// Identity source: Shopify app-proxy HMAC-validated `logged_in_customer_id` query param.
// Callers must route through /apps/naia-stylist/api/customer-auth so Shopify signs the request.
// Direct POST with an arbitrary shopifyId body field is rejected at the HMAC gate.

export async function action({ request }) {
  // 1. Validate Shopify app-proxy HMAC (uses SHOPIFY_API_SECRET internally).
  //    Throws a 400 Response when the signature is missing, invalid, or tampered.
  try {
    await authenticate.public.appProxy(request);
  } catch (_) {
    return new Response("Forbidden", { status: 403 });
  }

  // 2. Trust logged_in_customer_id only after HMAC validation.
  //    Shopify sets this param server-side from the authenticated storefront session.
  //    Body fields cannot override it.
  const url = new URL(request.url);
  const shopifyId = url.searchParams.get("logged_in_customer_id") || null;

  // 3. Guest — Shopify storefront session has no logged-in customer.
  if (!shopifyId) {
    return Response.json({ guest: true });
  }

  // 4. Profile hints from body enrich the token but do NOT establish identity.
  //    Identity is shopifyId from step 2; these are supplemental display fields.
  let email = null;
  let firstName = null;
  let lastName = null;
  try {
    const body = await request.json();
    email = typeof body.email === "string" ? body.email : null;
    firstName = typeof body.firstName === "string" ? body.firstName : null;
    lastName = typeof body.lastName === "string" ? body.lastName : null;
  } catch (_) {}

  const token = createCustomerToken({ shopifyId, email, firstName, lastName });
  return Response.json({ token, customer: { shopifyId, email, firstName, lastName } });
}
