// Staging-only preview of the Designer Dashboard — no Shopify Admin embedding.
//
// ── Environment gate ────────────────────────────────────────────────────────
// Blocked by: NAIA_PROJECT_VARIANT !== "staging"
//
// Set NAIA_PROJECT_VARIANT=staging in the naia-stylist-staging Vercel project
// (all environments). Do NOT set it in the real naia-stylist project.
// This is the hard gate — VERCEL_ENV is "production" on the production slot of
// naia-stylist-staging, so it cannot be used to distinguish the two projects.
//
// ── Auth flow ───────────────────────────────────────────────────────────────
// 1. GET /staging/designer-preview — no cookie → render login form
// 2. POST /staging/designer-preview — verify DESIGNER_PREVIEW_SECRET (form field)
//    → set HMAC-signed HttpOnly SameSite=Lax 8-hour cookie → redirect to GET
// 3. GET with valid cookie → load dashboard data → render DesignerDashboard
//
// DESIGNER_PREVIEW_SECRET has no privileges beyond this read-only preview.
// It is never placed in a URL, log line, or redirect parameter.
//
// ── Data ────────────────────────────────────────────────────────────────────
// Same six Prisma-only server functions as the original dashboard.
// No Shopify Admin API. No write actions. CSV download is client-side only.

import { createHmac, timingSafeEqual } from "crypto";
import { useLoaderData, useActionData, Form } from "react-router";
import { getDesignerStats, getAdditionalKPIs } from "../lib/designer-stats.server";
import { getPhase4B2KPIs } from "../lib/ai/designer-intelligence.server";
import { getAdvancedKPIs } from "../lib/designer-advanced.server";
import { getRelationshipKPIs } from "../lib/designer-relationship.server";
import { getDesignerSampleData } from "../lib/designer-sample-data";
import { getLiveCustomerSignals } from "../lib/ai/live-customer-signals.server";
import DesignerDashboard, { ErrorBoundary as DashboardErrorBoundary } from "./app.designer-intelligence.jsx";

export { DashboardErrorBoundary as ErrorBoundary };

// ── Constants ─────────────────────────────────────────────────────────────────

const COOKIE_NAME = "__sdp_ses";
const COOKIE_MAX_AGE_S = 8 * 3600; // 8 hours

// ── Environment gate ──────────────────────────────────────────────────────────

function isBlockedEnvironment() {
  return process.env.NAIA_PROJECT_VARIANT !== "staging";
}

// ── HMAC-signed cookie helpers ────────────────────────────────────────────────
// Cookie value: base64url(JSON payload) + "." + base64url(HMAC-SHA256)
// Payload: { exp: unixMilliseconds }

function createSessionCookieValue(secret) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Date.now() + COOKIE_MAX_AGE_S * 1000 }),
  ).toString("base64url");
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

function verifySessionCookie(cookieValue, secret) {
  if (!cookieValue || typeof cookieValue !== "string") return false;
  const lastDot = cookieValue.lastIndexOf(".");
  if (lastDot < 1) return false;
  const payload = cookieValue.slice(0, lastDot);
  const mac = cookieValue.slice(lastDot + 1);
  const expectedMac = createHmac("sha256", secret).update(payload).digest("base64url");
  // Constant-time compare to prevent timing oracle on the HMAC
  let macOk = false;
  try {
    macOk = timingSafeEqual(Buffer.from(mac), Buffer.from(expectedMac));
  } catch {
    return false; // buffers differ in length → invalid
  }
  if (!macOk) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

function parseCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function makeSetCookieHeader(value) {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/staging/designer-preview; Max-Age=${COOKIE_MAX_AGE_S}`;
}

// Constant-time secret comparison (safe even when lengths differ)
function secretsEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }) {
  if (isBlockedEnvironment()) return new Response("Not Found", { status: 404 });

  const previewSecret = process.env.DESIGNER_PREVIEW_SECRET;
  if (!previewSecret) {
    return new Response("DESIGNER_PREVIEW_SECRET is not configured", { status: 503 });
  }

  const cookieValue = parseCookie(request.headers.get("Cookie"), COOKIE_NAME);
  if (!verifySessionCookie(cookieValue, previewSecret)) {
    return Response.json({ mode: "login" });
  }

  // Authenticated — load dashboard data
  const url = new URL(request.url);
  const rawDays = parseInt(url.searchParams.get("days") || "30", 10);
  const dateRangeDays = [7, 30, 90, 365].includes(rawDays) ? rawDays : 30;

  const samplePreviewAvailable = process.env.DESIGNER_SAMPLE_DATA_ENABLED === "true";
  const sampleMode = samplePreviewAvailable && url.searchParams.get("preview") === "sample";

  if (sampleMode) {
    const sample = getDesignerSampleData(dateRangeDays);
    return Response.json(
      { mode: "dashboard", ...sample, dateRangeDays, sampleMode: true, samplePreviewAvailable: true, liveSignals: null },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
    );
  }

  const [dashboard, kpis, phase4b2, advanced, rel, liveSignals] = await Promise.all([
    getDesignerStats(dateRangeDays),
    getAdditionalKPIs(),
    getPhase4B2KPIs(dateRangeDays),
    getAdvancedKPIs(dateRangeDays),
    getRelationshipKPIs(dateRangeDays),
    getLiveCustomerSignals(dateRangeDays),
  ]);

  if (dashboard.error) throw new Response(dashboard.error, { status: 500 });
  return Response.json(
    { mode: "dashboard", dashboard, kpis, phase4b2, advanced, rel, liveSignals, dateRangeDays, sampleMode: false, samplePreviewAvailable },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } },
  );
}

// ── Action (POST login) ───────────────────────────────────────────────────────

export async function action({ request }) {
  if (isBlockedEnvironment()) return new Response("Not Found", { status: 404 });

  const previewSecret = process.env.DESIGNER_PREVIEW_SECRET;
  if (!previewSecret) {
    return Response.json({ error: "Not configured" }, { status: 503 });
  }

  const form = await request.formData();
  const submitted = form.get("secret") ?? "";

  if (!secretsEqual(submitted, previewSecret)) {
    return Response.json({ error: "Invalid secret" }, { status: 403 });
  }

  const cookieValue = createSessionCookieValue(previewSecret);
  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": makeSetCookieHeader(cookieValue),
      Location: "/staging/designer-preview",
    },
  });
}

// ── Login form ────────────────────────────────────────────────────────────────

function LoginForm({ error }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0d0d0d",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "#1a1a1a",
          border: "1px solid #2e2e2e",
          borderRadius: 12,
          padding: "40px 48px",
          width: 360,
          maxWidth: "90vw",
        }}
      >
        <h1 style={{ margin: "0 0 6px", color: "#f0f0f0", fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>
          Designer Dashboard
        </h1>
        <p style={{ margin: "0 0 28px", color: "#666", fontSize: 13 }}>
          Staging preview · enter access secret
        </p>
        <Form method="post">
          <label
            style={{
              display: "block",
              color: "#888",
              fontSize: 11,
              marginBottom: 6,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            Secret
          </label>
          <input
            type="password"
            name="secret"
            autoFocus
            required
            autoComplete="current-password"
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              borderRadius: 6,
              border: error ? "1px solid #7a3030" : "1px solid #333",
              background: "#111",
              color: "#f0f0f0",
              fontSize: 14,
              outline: "none",
              marginBottom: error ? 8 : 20,
            }}
          />
          {error && (
            <p style={{ margin: "0 0 16px", color: "#c05050", fontSize: 13 }}>{error}</p>
          )}
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "10px 0",
              borderRadius: 6,
              border: "none",
              background: "#8b2035",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              letterSpacing: "0.01em",
            }}
          >
            Access Dashboard
          </button>
        </Form>
      </div>
    </div>
  );
}

// ── Route default export ──────────────────────────────────────────────────────

export default function StagingDesignerPreview() {
  const loaderData = useLoaderData();
  const actionData = useActionData();

  if (loaderData.mode === "login") {
    // actionData.error is set on a failed POST; loaderData has no error in login mode
    return <LoginForm error={actionData?.error ?? null} />;
  }

  // Dashboard mode — DesignerDashboard calls useLoaderData() internally and
  // receives the same { dashboard, kpis, phase4b2, ... } shape from this route's loader.
  // The extra `mode` key is destructured away and ignored by the component.
  return <DesignerDashboard />;
}
