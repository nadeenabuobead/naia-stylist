import { createHmac, timingSafeEqual } from "crypto";
import prisma from "../db.server";
import { getCurrentNaiaCustomer } from "../lib/naia-session.server";

// Bodygram body-scan integration — under product review, not rebuilt or
// removed (2026-10-19 audit). Both handlers below now require an
// authenticated session and ignore any customerId the client supplies:
// customer identity is always resolved server-side via getCurrentNaiaCustomer,
// so one customer's session can no longer read or overwrite another
// customer's OnboardingProfile row. Scan-token creation and measurement
// persistence logic is otherwise unchanged.
//
// 2026-10-19 follow-up: session-derived customerId alone closes the write
// vector, but it does NOT prove the Bodygram sessionId being polled was
// actually issued for THIS customer — Bodygram's token is handed back to
// the browser in the action's response, so it is not secret from whoever
// holds it. ownershipSig binds a given sessionId to the customer it was
// created for: action() signs {sessionId, customer.id}; loader() recomputes
// that signature using the CURRENTLY authenticated customer.id and only
// proceeds on an exact match. A session created for customer A can never
// be successfully polled under customer B's session, even if B obtains A's
// raw sessionId. Reuses SESSION_SECRET (already present in every
// environment) with a domain-separation label — no new secret required.

const BODYGRAM_API_KEY = process.env.BODYGRAM_API_KEY;
const BODYGRAM_ORG_ID = process.env.BODYGRAM_ORG_ID;
const BASE_URL = `https://platform.bodygram.com/api/orgs/${BODYGRAM_ORG_ID}`;

const SIG_LABEL = "bodyscan-session-v1";

// Exported for direct unit testing of the binding logic (see
// phase1-legacy-api-lockdown.test.ts) — not used by any other route.
export function signSessionOwnership(sessionId, customerId) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", secret)
    .update(`${SIG_LABEL}:${sessionId}:${customerId}`)
    .digest("base64url");
}

export function sessionOwnershipValid(sessionId, customerId, providedSig) {
  if (!providedSig || typeof providedSig !== "string") return false;
  let expected;
  try {
    expected = signSessionOwnership(sessionId, customerId);
  } catch {
    return false; // fail closed if SESSION_SECRET is missing
  }
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}

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

    let sig;
    try {
      sig = signSessionOwnership(data.token, customer.id);
    } catch {
      console.error("Create session error: SESSION_SECRET not configured");
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }

    return Response.json({ sessionId: data.token, sig });
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
    const sig = url.searchParams.get("sig");

    if (!sessionId) {
      return Response.json({ error: "sessionId required" }, { status: 400 });
    }

    // Proves this sessionId was issued (by action(), above) for THIS
    // authenticated customer — not merely that the write below targets
    // customer.id. See the file-header comment for why this is necessary.
    if (!sessionOwnershipValid(sessionId, customer.id, sig)) {
      return Response.json({ error: "This scan session does not belong to the current customer" }, { status: 403 });
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