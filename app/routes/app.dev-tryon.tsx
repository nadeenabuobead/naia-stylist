// app/routes/app.dev-tryon.tsx
// Phase 4A5 — Development-only virtual try-on test harness.
//
// Access: admin-only via requireStaffAccess (Shopify admin auth + allowlist).
// Purpose: test FASHN try-on with verified NADINE garments before any customer-facing CTA.
//
// HOLD: Real provider calls require DEV_TEST_MODEL_IMAGE_PUBLIC_ID to be set
// in .env, pointing to a Cloudinary private asset explicitly designated as a
// development test image with consent. That asset does not exist yet — all
// action submissions return HOLD until it is configured.
//
// Provider call cap: file-backed maximum of 5 new FASHN submissions (.dev-tryon-cap.json).
// Survives server restart and hot reload. Failed or timed-out submissions still consume a slot.
// Polling an existing predictionId (after timeout) does not consume a new slot.

import { useLoaderData, useActionData, Form } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireStaffAccess } from "../lib/staff-auth.server";
import {
  NAIA_VERIFIED_MEDIA_MAP,
  NAIA_COMPONENT_MEDIA_MAP,
} from "../lib/ai/naia-product-media";
import {
  validateGarmentEligibility,
  downloadModelPhotoAsDataUrl,
  uploadTryOnResult,
} from "../lib/ai/fashn-tryon-service.server";
import { runFashnTryOn } from "../lib/ai/fashn-try-on.server";
import { POLICY_VERSION } from "../lib/ai/virtual-try-on.types";
import { verifyCloudinaryAsset } from "../lib/cloudinary-admin.server";
import {
  getDevCapState,
  claimDevCallSlot,
  updateDevCallEntry,
  getExistingPredictionId,
  DEV_MAX_NEW_CALLS,
} from "../lib/ai/dev-tryon-cap.server";
import { issueImageToken } from "../lib/dev-tryon-image-tokens.server";

// Derives the deterministic Cloudinary public ID for a dev test result.
function devResultPublicId(handle: string): string {
  return `naia-tryon/dev-test/${handle.replace(/\//g, "-")}`;
}

// ── Loader ────────────────────────────────────────────────────────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  await requireStaffAccess(request);

  const devModelPublicId = process.env.DEV_TEST_MODEL_IMAGE_PUBLIC_ID ?? null;
  const fashnKeyPresent = !!(process.env.FASHN_API_KEY);

  const readyGarments: { handle: string; label: string; category: string; isComponent: boolean }[] = [];
  const pendingGarments: { handle: string; label: string; reason: string }[] = [];

  for (const [handle, entry] of NAIA_VERIFIED_MEDIA_MAP) {
    if (entry.eligibility === "ready") {
      readyGarments.push({
        handle,
        label: entry.nadinaTitle,
        category: entry.garmentCategory,
        isComponent: false,
      });
    } else {
      pendingGarments.push({ handle, label: entry.nadinaTitle, reason: entry.eligibility });
    }
  }
  for (const [handle, entry] of NAIA_COMPONENT_MEDIA_MAP) {
    if (entry.eligibility === "ready") {
      readyGarments.push({
        handle,
        label: `${entry.componentName} (${entry.parentCatalogHandle})`,
        category: entry.garmentCategory,
        isComponent: true,
      });
    } else {
      pendingGarments.push({
        handle,
        label: `${entry.componentName} (${entry.parentCatalogHandle})`,
        reason: entry.eligibility,
      });
    }
  }

  // Phase 4A5 results gallery — short-lived tokens issued here, validated by the proxy route.
  // Tokens bind to a specific handle slug and expire after 10 minutes.
  // Batch 1 — approved 2026-07-17 by product owner after visual review.
  const PHASE_4A5_RESULTS = [
    { handle: "collar-shirt",               slug: "collar-shirt",                    title: "Becoming Real",                      category: "tops",      classification: "product-owner-approved" },
    { handle: "double-top/leather-underlayer", slug: "double-top-leather-underlayer", title: "Leather underlayer (Becoming Alive)", category: "tops",    classification: "product-owner-approved" },
    { handle: "leather-suede-jacket",       slug: "leather-suede-jacket",            title: "Becoming Clear",                     category: "outerwear", classification: "product-owner-approved" },
    { handle: "midi-dress",                 slug: "midi-dress",                       title: "Becoming Her",                       category: "one-piece", classification: "product-owner-approved" },
    { handle: "trench-coat",                slug: "trench-coat",                      title: "Becoming Seen",                      category: "outerwear", classification: "product-owner-approved" },
    // Batch 2 kimono — product-owner-approved; remaining 4 re-run in Batch 3 (2026-07-17).
    { handle: "kimono-jacket",             slug: "kimono-jacket",             title: "Becoming Whole",                    category: "outerwear", classification: "product-owner-approved" },
    // Batch 3 — 4 corrected re-runs + 6 new components; awaiting product-owner review.
    { handle: "cropped-top",                slug: "cropped-top",                title: "Becoming Fragmented",              category: "tops",      classification: "awaiting-product-owner-review" },
    { handle: "asymmetrical-pants",         slug: "asymmetrical-pants",         title: "Becoming Grounded",                category: "bottoms",   classification: "awaiting-product-owner-review" },
    { handle: "straight-pants",             slug: "straight-pants",             title: "Becoming Unfiltered",              category: "bottoms",   classification: "awaiting-product-owner-review" },
    { handle: "suede-skirt",                slug: "suede-skirt",                title: "Becoming Rooted",                  category: "bottoms",   classification: "awaiting-product-owner-review" },
    { handle: "double-top/full-layered-top", slug: "double-top-full-layered-top", title: "Full layered top (Becoming Alive)", category: "tops",    classification: "awaiting-product-owner-review" },
    { handle: "double-top/chiffon-overlay",  slug: "double-top-chiffon-overlay",  title: "Chiffon overlay (Becoming Alive)",  category: "tops",    classification: "awaiting-product-owner-review" },
    { handle: "dress-set/complete-set",      slug: "dress-set-complete-set",      title: "Complete set (Becoming Defined)",   category: "one-piece", classification: "awaiting-product-owner-review" },
    { handle: "dress-set/corset",            slug: "dress-set-corset",            title: "Corset (Becoming Defined)",         category: "tops",      classification: "awaiting-product-owner-review" },
    { handle: "dress-set/mesh-top",          slug: "dress-set-mesh-top",          title: "Mesh top (Becoming Defined)",       category: "tops",      classification: "awaiting-product-owner-review" },
    { handle: "dress-set/skirt",             slug: "dress-set-skirt",             title: "Skirt (Becoming Defined)",          category: "bottoms",   classification: "awaiting-product-owner-review" },
  ] as const;

  const gallery = PHASE_4A5_RESULTS.map((item) => {
    const token = issueImageToken(item.slug);
    const garment = validateGarmentEligibility(item.handle);
    return {
      slug: item.slug,
      title: item.title,
      category: item.category,
      classification: item.classification as "provider-validated" | "product-owner-approved" | "awaiting-product-owner-review" | "provider-error",
      resultImgPath: `/app/dev-tryon-img/${item.slug}?t=${encodeURIComponent(token)}`,
      // Source garment image: public Shopify CDN URL, used only as <img src>.
      sourceImgUrl: garment.ok ? garment.garmentUrl : null,
    };
  });

  return {
    devModelPublicId,
    fashnKeyPresent,
    readyGarments,
    pendingGarments,
    gallery,
    ...getDevCapState(),
  };
}

// ── Action ────────────────────────────────────────────────────────────────────

type ActionResult =
  | { state: "hold"; missingItem: string; detail: string }
  | { state: "cap-reached"; consumed: number; max: number }
  | { state: "reused"; handle: string }
  | { state: "error"; code: string; message: string }
  | { state: "completed"; handle: string }
  | { state: "garment-not-ready"; handle: string; reason: string };

export async function action({ request }: ActionFunctionArgs): Promise<ActionResult> {
  await requireStaffAccess(request);

  const devModelPublicId    = process.env.DEV_TEST_MODEL_IMAGE_PUBLIC_ID ?? null;
  const devModelFormat      = process.env.DEV_TEST_MODEL_FORMAT ?? "jpg";
  // DEV_TEST_MODEL_DELIVERY_TYPE must match how the asset was uploaded to Cloudinary.
  // Defaults to "private"; set to "upload" if the test model was uploaded without private delivery.
  const devModelDeliveryType = process.env.DEV_TEST_MODEL_DELIVERY_TYPE ?? "private";

  if (!devModelPublicId) {
    return {
      state: "hold",
      missingItem: "DEV_TEST_MODEL_IMAGE_PUBLIC_ID",
      detail:
        "A Cloudinary private asset explicitly designated as a development test image " +
        "with consent. Add DEV_TEST_MODEL_IMAGE_PUBLIC_ID=<publicId> and " +
        "DEV_TEST_MODEL_FORMAT=<jpg|png|webp> to .env to enable real provider calls.",
    };
  }

  const form = await request.formData();
  const garmentHandle = form.get("garmentHandle")?.toString() ?? "";

  const garment = validateGarmentEligibility(garmentHandle);
  if (!garment.ok) {
    return { state: "garment-not-ready", handle: garmentHandle, reason: garment.reason };
  }

  // ── Resume polling path ─────────────────────────────────────────────────────
  // If a previous call timed out after POST /v1/run was already sent, the predictionId
  // is saved in the cap file. Resume polling without claiming a new slot.
  const resumePredictionId = getExistingPredictionId(garmentHandle) ?? undefined;
  if (resumePredictionId) {
    const photoResult = await downloadModelPhotoAsDataUrl(
      devModelPublicId,
      devModelFormat,
      devModelDeliveryType,
    );
    if (!photoResult.ok) {
      return { state: "error", code: photoResult.errorCode, message: "Failed to download dev test model photo." };
    }

    const fashnResult = await runFashnTryOn(
      {
        customerId: "dev-test",
        modelImageDataUrl: photoResult.dataUrl,
        productImageUrl: garment.garmentUrl,
        productHandle: garmentHandle,
        consent: { virtualTryOnConsent: true, policyVersion: POLICY_VERSION, consentedAt: new Date().toISOString() },
      },
      { existingPredictionId: resumePredictionId },
    );

    if (!fashnResult.ok) {
      const outcome = fashnResult.code === "TIMEOUT" ? "timeout" : "failed";
      updateDevCallEntry(garmentHandle, { outcome });
      return { state: "error", code: fashnResult.code, message: fashnResult.customerMessage };
    }

    const uploadResult = await uploadTryOnResult(
      "dev-test",
      garmentHandle.replace(/\//g, "-"),
      fashnResult.outputDataUrl,
    );
    if (!uploadResult.ok) {
      updateDevCallEntry(garmentHandle, { outcome: "failed" });
      return { state: "error", code: uploadResult.errorCode, message: "Failed to store result." };
    }

    updateDevCallEntry(garmentHandle, { outcome: "completed" });
    return { state: "completed", handle: garmentHandle };
  }

  // ── New submission path ─────────────────────────────────────────────────────

  // Idempotency: reuse an already-stored result without consuming a new call
  const existingAsset = await verifyCloudinaryAsset(devResultPublicId(garmentHandle), "private");
  if (existingAsset.ok) {
    return { state: "reused", handle: garmentHandle };
  }

  // Claim a slot BEFORE downloading the model photo or calling FASHN.
  // Failed and timed-out calls still consume a slot (counter increments here).
  const capSlot = claimDevCallSlot(garmentHandle);
  if (!capSlot.allowed) {
    const capState = getDevCapState();
    return { state: "cap-reached", consumed: capState.newCalls, max: capState.maxCalls };
  }

  const photoResult = await downloadModelPhotoAsDataUrl(
    devModelPublicId,
    devModelFormat,
    devModelDeliveryType,
  );
  if (!photoResult.ok) {
    updateDevCallEntry(garmentHandle, { outcome: "failed" });
    return { state: "error", code: photoResult.errorCode, message: "Failed to download dev test model photo." };
  }

  const fashnResult = await runFashnTryOn(
    {
      customerId: "dev-test",
      modelImageDataUrl: photoResult.dataUrl,
      productImageUrl: garment.garmentUrl,
      productHandle: garmentHandle,
      consent: { virtualTryOnConsent: true, policyVersion: POLICY_VERSION, consentedAt: new Date().toISOString() },
    },
    {
      // Persist the predictionId to .dev-tryon-cap.json immediately after POST /v1/run.
      // If polling times out, the next submission resumes from this ID without re-submitting.
      onPredictionId: (id) => updateDevCallEntry(garmentHandle, { predictionId: id }),
    },
  );

  if (!fashnResult.ok) {
    const outcome = fashnResult.code === "TIMEOUT" ? "timeout" : "failed";
    updateDevCallEntry(garmentHandle, { outcome });
    return { state: "error", code: fashnResult.code, message: fashnResult.customerMessage };
  }

  const uploadResult = await uploadTryOnResult(
    "dev-test",
    garmentHandle.replace(/\//g, "-"),
    fashnResult.outputDataUrl,
  );
  if (!uploadResult.ok) {
    updateDevCallEntry(garmentHandle, { outcome: "failed" });
    return { state: "error", code: uploadResult.errorCode, message: "Failed to store result." };
  }

  updateDevCallEntry(garmentHandle, { outcome: "completed" });
  return { state: "completed", handle: garmentHandle };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DevTryOn() {
  const { devModelPublicId, fashnKeyPresent, readyGarments, pendingGarments, gallery, callsThisSession, maxCalls } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();

  const holdActive = !devModelPublicId;
  const capReached = callsThisSession >= maxCalls;
  const formDisabled = holdActive || capReached;

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Virtual Try-On Dev Harness</h1>
      <p style={s.subtitle}>Phase 4A5 — internal testing only. Never activate the storefront CTA from here.</p>

      {/* Status cards */}
      <div style={s.statusRow}>
        <StatusCard label="FASHN_API_KEY" ok={fashnKeyPresent} />
        <StatusCard
          label="DEV_TEST_MODEL_IMAGE"
          ok={!!devModelPublicId}
          value={devModelPublicId ?? undefined}
          fallback="Not configured"
        />
        <StatusCard
          label="CALLS THIS SESSION"
          ok={callsThisSession < maxCalls}
          value={`${callsThisSession} / ${maxCalls}`}
        />
      </div>

      {/* HOLD notice */}
      {holdActive && (
        <div style={s.holdBox}>
          <strong>HOLD — real provider calls disabled.</strong>
          <p style={s.holdDetail}>
            Add <code>DEV_TEST_MODEL_IMAGE_PUBLIC_ID</code> to .env with the Cloudinary public ID
            of a private asset explicitly designated as a development test image with consent.
            Also set <code>DEV_TEST_MODEL_FORMAT</code> (jpg/png/webp).
          </p>
        </div>
      )}
      {capReached && (
        <div style={s.holdBox}>
          <strong>CAP REACHED — {callsThisSession}/{maxCalls} new FASHN submissions used this session.</strong>
          <p style={s.holdDetail}>Restart the dev server to reset the counter. Idempotent re-runs (same garment already stored) still work.</p>
        </div>
      )}

      {/* Action result */}
      {result && (
        <div style={result.state === "completed" ? s.successBox : s.errorBox}>
          {result.state === "hold" && (
            <>
              <strong>HOLD — {result.missingItem}</strong>
              <p style={{ margin: "4px 0 0" }}>{result.detail}</p>
            </>
          )}
          {result.state === "cap-reached" && (
            <strong>Cap reached — {result.consumed}/{result.max} new submissions used this session. Restart dev server to reset.</strong>
          )}
          {result.state === "reused" && (
            <strong>Reused — existing result for {result.handle} returned from Cloudinary. No FASHN call made.</strong>
          )}
          {result.state === "completed" && (
            <strong>Completed — {result.handle}. Result stored privately at naia-tryon/dev-test/*.</strong>
          )}
          {result.state === "error" && (
            <>
              <strong>Error ({result.code})</strong>
              <p style={{ margin: "4px 0 0" }}>{result.message}</p>
            </>
          )}
          {result.state === "garment-not-ready" && (
            <>
              <strong>Garment not ready — {result.handle}</strong>
              <p style={{ margin: "4px 0 0" }}>{result.reason}</p>
            </>
          )}
        </div>
      )}

      {/* Try-on form */}
      <div style={s.section}>
        <h2 style={s.h2}>Ready garments ({readyGarments.length})</h2>
        {readyGarments.length === 0 && <p style={s.muted}>None</p>}
        {readyGarments.length > 0 && (
          <Form method="post">
            <table style={s.table}>
              <thead>
                <tr>
                  <th style={s.th} />
                  <th style={s.th}>Handle</th>
                  <th style={s.th}>Label</th>
                  <th style={s.th}>Category</th>
                  <th style={s.th}>Type</th>
                </tr>
              </thead>
              <tbody>
                {readyGarments.map((g) => (
                  <tr key={g.handle}>
                    <td style={s.td}>
                      <input
                        type="radio"
                        name="garmentHandle"
                        value={g.handle}
                        required
                        disabled={formDisabled}
                      />
                    </td>
                    <td style={s.tdMono}>{g.handle}</td>
                    <td style={s.td}>{g.label}</td>
                    <td style={s.td}>{g.category}</td>
                    <td style={s.td}>{g.isComponent ? "component" : "parent"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={s.confirmRow}>
              <label style={s.confirmLabel}>
                <input type="checkbox" name="confirmed" value="true" required disabled={formDisabled} />
                {" "}I confirm this is a dev test call. No real customer data is involved.
              </label>
              <button type="submit" style={formDisabled ? s.btnDisabled : s.btn} disabled={formDisabled}>
                {holdActive
                  ? "HOLD — configure test model first"
                  : capReached
                    ? "Cap reached — restart dev server"
                    : "Run try-on (dev only)"}
              </button>
            </div>
          </Form>
        )}
      </div>

      {/* Pending garments */}
      {pendingGarments.length > 0 && (
        <div style={s.section}>
          <h2 style={s.h2}>Pending garments ({pendingGarments.length})</h2>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Handle</th>
                <th style={s.th}>Label</th>
                <th style={s.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {pendingGarments.map((g) => (
                <tr key={g.handle}>
                  <td style={s.tdMono}>{g.handle}</td>
                  <td style={s.td}>{g.label}</td>
                  <td style={s.td}><span style={s.badge}>{g.reason}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Phase 4A5 results gallery */}
      <div style={s.section}>
        <h2 style={s.h2}>Phase 4A5 — Provider results ({gallery.length})</h2>
        <p style={s.subtitle}>
          Staff-only. Short-lived image tokens (10 min). Reload to refresh.
          Images served via server proxy — no credentials or asset IDs in the browser.
        </p>
        <div style={s.galleryGrid}>
          {gallery.map((item) => (
            <div key={item.slug} style={s.galleryCard}>
              <div style={s.galleryImages}>
                <div style={s.galleryImgCol}>
                  <div style={s.galleryImgLabel}>Garment source</div>
                  {item.sourceImgUrl
                    ? <img src={item.sourceImgUrl} alt={`${item.title} product image`} style={s.galleryImg} />
                    : <div style={s.galleryImgMissing}>No source image</div>
                  }
                </div>
                <div style={s.galleryImgCol}>
                  <div style={s.galleryImgLabel}>FASHN result</div>
                  {item.classification === "provider-error"
                    ? <div style={s.galleryImgMissing}>Provider error — no result</div>
                    : <img src={item.resultImgPath} alt={`${item.title} try-on result`} style={s.galleryImg} />
                  }
                </div>
              </div>
              <div style={s.galleryMeta}>
                <span style={s.galleryTitle}>{item.title}</span>
                <span style={s.badge}>{item.category}</span>
                <span style={
                  item.classification === "product-owner-approved" ? s.badgeDeepGreen :
                  item.classification === "provider-validated"     ? s.badgeGreen :
                  item.classification === "provider-error"         ? s.badgeRed :
                  s.badgeAmber
                }>
                  {item.classification === "product-owner-approved" ? "Product owner approved" :
                   item.classification === "provider-validated"     ? "Provider validated" :
                   item.classification === "provider-error"         ? "Provider error — retry needed" :
                   "Awaiting product-owner review"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function StatusCard({
  label,
  ok,
  value,
  fallback,
}: {
  label: string;
  ok: boolean;
  value?: string;
  fallback?: string;
}) {
  return (
    <div style={{ ...s.card, borderLeft: `3px solid ${ok ? "#16a34a" : "#dc2626"}` }}>
      <div style={s.cardLabel}>{label}</div>
      <div style={{ ...s.cardValue, color: ok ? "#16a34a" : "#dc2626" }}>
        {ok ? (value ? `✓ ${value}` : "✓ present") : (fallback ?? "✗ missing")}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = {
  page:        { padding: "24px 32px", fontFamily: "system-ui, sans-serif", maxWidth: 960 },
  h1:          { fontSize: 20, fontWeight: 600, margin: "0 0 4px" },
  h2:          { fontSize: 16, fontWeight: 600, margin: "0 0 12px" },
  subtitle:    { fontSize: 13, color: "#6b7280", margin: "0 0 20px" },
  statusRow:   { display: "flex", gap: 12, marginBottom: 20 },
  card:        { background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 14px", minWidth: 200 },
  cardLabel:   { fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: "0.05em" },
  cardValue:   { fontSize: 13, fontWeight: 500, marginTop: 2, fontFamily: "monospace" },
  holdBox:     { background: "#fffbeb", border: "1px solid #fbbf24", borderRadius: 6, padding: "12px 16px", marginBottom: 20 },
  holdDetail:  { margin: "6px 0 0", fontSize: 13, color: "#92400e" },
  successBox:  { background: "#f0fdf4", border: "1px solid #16a34a", borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 13, color: "#15803d" },
  errorBox:    { background: "#fef2f2", border: "1px solid #f87171", borderRadius: 6, padding: "10px 14px", marginBottom: 20, fontSize: 13, color: "#b91c1c" },
  section:     { marginBottom: 28 },
  table:       { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th:          { textAlign: "left" as const, padding: "6px 10px", background: "#f3f4f6", borderBottom: "1px solid #e5e7eb", fontWeight: 600, fontSize: 12 },
  td:          { padding: "6px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "middle" as const },
  tdMono:      { padding: "6px 10px", borderBottom: "1px solid #f3f4f6", fontFamily: "monospace", fontSize: 12 },
  muted:       { color: "#9ca3af", fontSize: 13 },
  badge:       { background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, padding: "2px 6px", fontSize: 11, fontFamily: "monospace" },
  confirmRow:  { display: "flex", alignItems: "center", gap: 16, marginTop: 14 },
  confirmLabel:{ fontSize: 13, color: "#374151" },
  btn:         { background: "#1d4ed8", color: "#fff", border: "none", borderRadius: 5, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer" },
  btnDisabled: { background: "#d1d5db", color: "#6b7280", border: "none", borderRadius: 5, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "not-allowed" },
  // Gallery
  galleryGrid:     { display: "flex", flexDirection: "column" as const, gap: 24 },
  galleryCard:     { border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden" },
  galleryImages:   { display: "flex", gap: 0 },
  galleryImgCol:   { flex: 1, display: "flex", flexDirection: "column" as const },
  galleryImgLabel: { fontSize: 11, fontWeight: 600, color: "#6b7280", textTransform: "uppercase" as const, letterSpacing: "0.05em", padding: "8px 12px", background: "#f9fafb", borderBottom: "1px solid #e5e7eb" },
  galleryImg:      { width: "100%", display: "block", objectFit: "contain" as const, maxHeight: 340, background: "#f3f4f6" },
  galleryImgMissing: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 12, minHeight: 200 },
  galleryMeta:     { display: "flex", alignItems: "center", flexWrap: "wrap" as const, gap: 8, padding: "10px 14px", borderTop: "1px solid #e5e7eb", background: "#fafafa" },
  galleryTitle:    { fontSize: 13, fontWeight: 600, color: "#111827", marginRight: 4 },
  badgeDeepGreen:  { background: "#14532d", color: "#bbf7d0", border: "1px solid #166534",  borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 500 },
  badgeGreen:      { background: "#dcfce7", color: "#166534", border: "1px solid #bbf7d0",  borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 500 },
  badgeAmber:      { background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a",  borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 500 },
  badgeRed:        { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fca5a5",  borderRadius: 4, padding: "2px 7px", fontSize: 11, fontWeight: 500 },
} as const;
