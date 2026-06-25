import prisma from "../db.server";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";

export async function action({ request }) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) {
    return Response.json({ error: "not_authenticated" }, { status: 401 });
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
