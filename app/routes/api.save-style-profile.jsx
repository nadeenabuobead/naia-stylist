import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export async function action({ request }) {
  // Validates Shopify HMAC. Throws 400 for non-proxy or tampered requests.
  // Direct Vercel access and missing signatures never reach the code below.
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shopifyCustomerId = url.searchParams.get("logged_in_customer_id");

  if (!shopifyCustomerId) {
    return Response.json({ error: "not_signed_in" }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const {
    stylePersonalities = [],
    favoriteColors = [],
    avoidColors = [],
    lifestyle = [],
    fitPreferences = [],
  } = body;

  // Ensure the Customer record exists, keyed by Shopify's HMAC-signed customer ID.
  // Uses upsert so existing customers are found without touching their other fields.
  const customer = await prisma.customer.upsert({
    where: { shopifyCustomerId },
    update: {},
    create: {
      shopifyCustomerId,
      email: null,
      firstName: null,
      lastName: null,
    },
    select: { id: true },
  });

  // lifestyle from the quiz is String[] — join to fit the existing String? column
  // without a schema migration.
  const lifestyleStr = Array.isArray(lifestyle) && lifestyle.length > 0
    ? lifestyle.join(", ")
    : null;

  const profileData = {
    stylePersonalities: Array.isArray(stylePersonalities) ? stylePersonalities : [],
    favoriteColors:     Array.isArray(favoriteColors)     ? favoriteColors     : [],
    avoidColors:        Array.isArray(avoidColors)        ? avoidColors        : [],
    lifestyle:          lifestyleStr,
    fitPreferences:     Array.isArray(fitPreferences)     ? fitPreferences     : [],
    completed:          true,
  };

  await prisma.onboardingProfile.upsert({
    where:  { customerId: customer.id },
    update: profileData,
    create: { customerId: customer.id, ...profileData },
  });

  return Response.json({ success: true });
}
