// Temporary migration route — DELETE after migration applied to staging.
// Applies 20260903000000_about_you_fields.
import prisma from "../db.server";

export async function action({ request }) {
  const secret = process.env.STAGING_FIX_SECRET;
  const auth = request.headers.get("x-fix-secret");
  if (!secret || auth !== secret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const results = {};
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "ageRange" TEXT`
    );
    results.ageRange = "ok";
  } catch (e) {
    results.ageRange = String(e);
  }
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "gender" TEXT`
    );
    results.gender = "ok";
  } catch (e) {
    results.gender = String(e);
  }
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "OnboardingProfile" ADD COLUMN IF NOT EXISTS "genderSelfDescription" TEXT`
    );
    results.genderSelfDescription = "ok";
  } catch (e) {
    results.genderSelfDescription = String(e);
  }

  // Verify
  const check = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'OnboardingProfile'
     AND column_name IN ('ageRange','gender','genderSelfDescription')`
  );
  results.verified = check.map(r => r.column_name);

  return Response.json(results);
}
