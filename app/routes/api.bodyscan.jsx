import prisma from "../db.server";

const BODYGRAM_API_KEY = process.env.BODYGRAM_API_KEY;
const BODYGRAM_ORG_ID = process.env.BODYGRAM_ORG_ID;
const BASE_URL = `https://platform.bodygram.com/api/orgs/${BODYGRAM_ORG_ID}`;

export async function action({ request }) {
  try {
    const { customerId } = await request.json();

    if (!customerId) {
      return Response.json({ error: "customerId required" }, { status: 400 });
    }

    const res = await fetch(`${BASE_URL}/scan-tokens`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": BODYGRAM_API_KEY,
      },
      body: JSON.stringify({
        scope: ["api.platform.bodygram.com/scans:create"],
        metadata: { naiaCustomerId: customerId },
      }),
    });

    const data = await res.json();
    console.log("Bodygram response:", JSON.stringify(data));

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
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    const customerId = url.searchParams.get("customerId");

    if (!sessionId || !customerId) {
      return Response.json({ error: "sessionId and customerId required" }, { status: 400 });
    }

    const res = await fetch(`${BASE_URL}/scans/${sessionId}`, {
      headers: {
        "Authorization": BODYGRAM_API_KEY,
      },
    });

    const data = await res.json();
    console.log("Bodygram scan result:", JSON.stringify(data));

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

    await prisma.onboardingProfile.upsert({
      where: { customerId },
      update: {
        chestCm: mm(measurements.BUST_GIRTH),
        waistCm: mm(measurements.WAIST_GIRTH),
        hipsCm: mm(measurements.HIP_GIRTH),
        heightCm: mm(measurements.HEIGHT),
        scanConfidence: 0.95,
        avatarCreatedAt: new Date(),
      },
      create: {
        customerId,
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