// TEMPORARY, ONE-TIME-USE, STAGING-ONLY. Created 2026-11-17 to perform exactly
// one founder-authorized live HTTP verification of dd67ed9 (the Closet
// zero-allowance upgrade-message fix). Scoped to exactly one hardcoded
// synthetic customer; never general-purpose. Must be deleted (along with its
// routes.ts entry) once that one verification is complete — see the founder's
// explicit cleanup requirement in the authorizing conversation.
//
// Auth: two independent gates, neither shared with any other route's secret —
//   1. NAIA_PROJECT_VARIANT !== "staging" -> 404, before anything else runs.
//   2. x-temp-verify-secret header must match TEMP_VERIFY_SECRET, a secret
//      generated fresh for this route alone and never reused elsewhere.
//
// "createAndIssueToken" is single-use for the life of this file: a
// JourneyEvent with a fixed idempotencyKey is the one-time marker — a second
// call anywhere, anytime, on any deployment of this branch, is refused.
import { createClerkClient } from "@clerk/backend";
import prisma from "../db.server";

const IDEMPOTENCY_KEY = "temp-dd67ed9-verify:20261117:v1";
const SYNTHETIC_SHOPIFY_ID = "test-batch1-closet-http-verify-20261117";
const SYNTHETIC_EMAIL = "closet-http-verify-20261117@example.com";

function unauthorized() {
  return new Response(JSON.stringify({ error: "Forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

function buildClerkClient() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) return null;
  return createClerkClient({ secretKey, publishableKey });
}

export async function action({ request }) {
  // Hard block in non-staging -- before reading headers, body, Clerk, or DB.
  if (process.env.NAIA_PROJECT_VARIANT !== "staging") {
    return new Response("Not Found", { status: 404 });
  }

  const secret = request.headers.get("x-temp-verify-secret");
  if (!process.env.TEMP_VERIFY_SECRET || secret !== process.env.TEMP_VERIFY_SECRET) {
    return unauthorized();
  }

  const body = await request.json().catch(() => ({}));
  const act = body?._action;

  if (act === "createAndIssueToken") {
    const existingMarker = await prisma.journeyEvent.findUnique({
      where: { idempotencyKey: IDEMPOTENCY_KEY },
    });
    if (existingMarker) {
      return Response.json(
        { error: "Already executed once -- this route is strictly one-time-use." },
        { status: 409 },
      );
    }

    const clerkClient = buildClerkClient();
    if (!clerkClient) {
      return Response.json({ error: "Clerk not configured" }, { status: 500 });
    }

    const user = await clerkClient.users.createUser({
      emailAddress: [SYNTHETIC_EMAIL],
      skipPasswordRequirement: true,
      firstName: "QA-Disposable",
      lastName: "ClosetHttpVerify20261117",
    });

    const customer = await prisma.customer.upsert({
      where: { shopifyCustomerId: SYNTHETIC_SHOPIFY_ID },
      update: { clerkUserId: user.id },
      create: {
        shopifyCustomerId: SYNTHETIC_SHOPIFY_ID,
        email: SYNTHETIC_EMAIL,
        clerkUserId: user.id,
      },
    });
    // membershipStatus defaults to NONE per schema.prisma -> closetItems
    // allowance 0, exactly the zero-allowance state this test needs. Not set
    // explicitly here on purpose -- relying on the schema default is the same
    // discipline as every other fixture-creation path in this codebase.

    const signInToken = await clerkClient.signInTokens.createSignInToken({
      userId: user.id,
      expiresInSeconds: 60,
    });

    // Write the one-time marker LAST, only once everything above succeeded --
    // a failed attempt must remain retryable, not permanently locked out.
    await prisma.journeyEvent.create({
      data: {
        type: "temp_dd67ed9_verify_issued",
        occurredAt: new Date(),
        customerIdHash: "n/a-temp-verify-route",
        sessionId: "temp-dd67ed9-verify",
        payload: { note: "one-time marker for the temporary dd67ed9 HTTP verification route, see routes.ts/this file" },
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    });

    return Response.json({
      clerkUserId: user.id,
      customerId: customer.id,
      shopifyCustomerId: SYNTHETIC_SHOPIFY_ID,
      signInToken: signInToken.token,
      expiresInSeconds: 60,
    });
  }

  if (act === "cleanup") {
    const clerkClient = buildClerkClient();
    const customer = await prisma.customer.findUnique({
      where: { shopifyCustomerId: SYNTHETIC_SHOPIFY_ID },
    });

    let clerkDeleted = false;
    if (customer?.clerkUserId && clerkClient) {
      await clerkClient.users.deleteUser(customer.clerkUserId);
      clerkDeleted = true;
    }

    let customerDeleted = false;
    if (customer) {
      await prisma.closetItem.deleteMany({ where: { customerId: customer.id } });
      await prisma.customer.delete({ where: { id: customer.id } });
      customerDeleted = true;
    }

    return Response.json({ clerkDeleted, customerDeleted });
  }

  return Response.json({ error: "Unknown _action" }, { status: 400 });
}
