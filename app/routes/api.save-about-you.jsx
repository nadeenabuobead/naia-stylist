import { requireCurrentNaiaCustomer } from "../lib/naia-session.server";
import prisma from "../db.server";

const AGE_RANGE_VALID = new Set([
  "18-24", "25-34", "35-44", "45-54", "55-64", "65-plus", "prefer-not-to-say",
]);
const GENDER_VALID = new Set([
  "woman", "man", "another-gender", "prefer-not-to-say",
]);

export async function action({ request }) {
  if (request.method !== "POST") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const customer = await requireCurrentNaiaCustomer(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const patch = {};

  if (body.ageRange != null) {
    if (!AGE_RANGE_VALID.has(body.ageRange)) {
      return Response.json({ error: "invalid_age_range" }, { status: 422 });
    }
    patch.ageRange = body.ageRange;
  }

  if (body.gender != null) {
    if (!GENDER_VALID.has(body.gender)) {
      return Response.json({ error: "invalid_gender" }, { status: 422 });
    }
    patch.gender = body.gender;
  }

  if (body.genderSelfDescription != null) {
    if (typeof body.genderSelfDescription !== "string" || body.genderSelfDescription.length > 200) {
      return Response.json({ error: "invalid_gender_self_description" }, { status: 422 });
    }
    patch.genderSelfDescription = body.genderSelfDescription.trim();
  }

  if (Object.keys(patch).length === 0) {
    return Response.json({ ok: true });
  }

  // updateMany is safe: silently skips if no profile exists yet
  await prisma.onboardingProfile.updateMany({
    where: { customerId: customer.id },
    data: patch,
  });

  return Response.json({ ok: true });
}
