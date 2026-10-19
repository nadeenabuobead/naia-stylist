import prisma from "../db.server";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";

// Bodygram body-scan integration — under product review, not rebuilt or
// removed (2026-10-19 audit). Both handlers below now require an
// authenticated session and ignore any customerId the client supplies:
// customer identity is always resolved server-side via getCurrentNaiaCustomer,
// so one customer's session can no longer read or overwrite another
// customer's OnboardingProfile row. Scan-token creation and measurement
// persistence logic is otherwise unchanged.

const BODYGRAM_API_KEY = process.env.BODYGRAM_API_KEY;
const BODYGRAM_ORG_ID = process.env.BODYGRAM_ORG_ID;
const BASE_URL = `https://platform.bodygram.com/api/orgs/${BODYGRAM_ORG_ID}`;

function authRequired() {
  return Response.json({ error: "Authentication required" }, { status: 401 });
}

export async function action({ request }) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return authRequired();

  try {
    const res = await fetch(`${BASE_URL}/scan-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": BODYGRAM_API_KEY,
      },
      body: JSON.stringify({
        scope: ["api.platform.bodygram.com/scans:create"],
        metadata: { naiaCustomerId: customer.id },
      }),
    });

    const data = await res.json();
    console.log("Bodygram response: token present =", Boolean(data.token));

    if (!data.token) {
      return Response.json({ error: data.message || "Failed to create scan token" }, { status: 400 });
    }

    return Response.json({ sessionId: data.token });
  } catch (error) {
    console.error("Create session error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function loader({ request }) {
  const customer = await getCurrentNaiaCustomer(request);
  if (!customer) return authRequired();

  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");

    if (!sessionId) {
      return Response.json({ error: "sessionId required" }, { status: 400 });
    }

    const res = await fetch(`${BASE_URL}/scans/${sessionId}`, {
      headers: {
        "Authorization": BODYGRAM_API_KEY,
      },
    });

    const data = await res.json();
    console.log("Bodygram scan result: status =", data.status ?? (data.error ? "error" : "unknown"));

    if (data.status === "pending") {
      return Response.json({ status: "pending" });
    }

    if (data.error || data.status === "failed") {
      return Response.json({ status: "error", message: data.message || "Scan failed" });
    }

    const mm = (val) => (val ? Math.round(val / 10) : null);
    const measurements = {};
    if (data.scan?.measurements) {
      data.scan.measurements.forEach(m => {
        measurements[m.measurementType] = m.value;
      });
    }

    // customer.id (session-derived) — never the request's customerId — is the
    // only identity this write can target.
    await prisma.onboardingProfile.upsert({
      where: { customerId: customer.id },
      update: {
        chestCm: mm(measurements.BUST_GIRTH),
        waistCm: mm(measurements.WAIST_GIRTH),
        hipsCm: mm(measurements.HIP_GIRTH),
        heightCm: mm(measurements.HEIGHT),
        scanConfidence: 0.95,
        avatarCreatedAt: new Date(),
      },
      create: {
        customerId: customer.id,
        completed: false,
        chestCm: mm(measurements.BUST_GIRTH),
        waistCm: mm(measurements.WAIST_GIRTH),
        hipsCm: mm(measurements.HIP_GIRTH),
        heightCm: mm(measurements.HEIGHT),
        scanConfidence: 0.95,
        avatarCreatedAt: new Date(),
      },
    });

    return Response.json({
      status: "success",
      measurements: {
        chestCm: mm(measurements.BUST_GIRTH),
        waistCm: mm(measurements.WAIST_GIRTH),
        hipsCm: mm(measurements.HIP_GIRTH),
        heightCm: mm(measurements.HEIGHT),
      },
    });
  } catch (error) {
    console.error("Get results error:", error);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}