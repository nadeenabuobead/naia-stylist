// app/routes/admin.naia.closet.$itemId.tsx
//
// Closet Intelligence item detail — standalone admin portal (Phase 3A).
// Auth: requireAdminSession (internal cookie session, no Shopify).
//
// Phase 2B: 3-section read-only interpretation UI.
// Phase 3A: "Teach nAia" panel — mark correct, override fields, revert.
//   - Mutations: mark-correct | save-overrides | revert-field
//   - Effective classification = stored + overrides → drives Section 1 interpretation
//   - Reviewer identity always from session, never from form body
//   - No StyleMe wiring; overrides are stored only

import { useState, useRef, useEffect } from "react";
import { useLoaderData, Link, useFetcher, useNavigate } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import {
  getClosetItemDetail,
  getNextUnreviewedItemId,
  getAdjacentItemIds,
  getCustomerStylingPassport,
  type ClosetItemDetail,
  type ClosetClassification,
  type CustomerStylingPassportContext,
} from "~/lib/admin/closet-intelligence.server";
import {
  interpretGarment,
  type GarmentInterpretation,
} from "~/lib/admin/garment-semantics.server";
import {
  validateOverrides,
  getEffectiveClosetItem,
  saveAdminReview,
  markItemReviewed,
  revertOverrideField,
  getItemClassification,
  setVocabGapFlag,
  clearVocabGapFlag,
  type ClosetItemOverrides,
  type ClosetItemFields,
} from "~/lib/admin/closet-review.server";
import {
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
} from "~/lib/cloudinary-admin.server";
import {
  deriveGarmentStylingIntelligence,
  type GarmentStylingIntelligence,
} from "~/lib/admin/garment-intelligence-v1.server";

// ── Vocabulary options for edit dropdowns (mirrors garment-intelligence.types.ts) ──

const EDIT_OPTS = {
  silhouette:       ["a-line", "straight", "column", "fitted", "flared", "wrap", "shift", "oversized", "balloon", "asymmetric"],
  fitProfile:       ["fitted", "body-skimming", "tailored", "structured", "relaxed", "loose", "oversized", "flowy", "n/a"],
  hemLength:        ["full", "maxi", "midi", "knee", "mini", "n/a"],
  topLength:        ["cropped", "hip-length", "longline", "tunic", "n/a"],
  waistShape:       ["high-rise", "mid-rise", "low-rise", "empire", "drop-waist", "belted", "elasticated", "drawstring"],
  sleeveLength:     ["full", "three-quarter", "short", "sleeveless", "n/a"],
  necklineCoverage: ["high", "crew", "scoop", "shirt-collar", "mock", "cowl-high", "v-neck", "low", "off-shoulder", "wrap-variable", "n/a"],
  material:         ["cotton", "linen", "silk", "satin", "wool", "cashmere", "denim", "leather", "suede", "velvet", "polyester", "nylon", "knit", "jersey", "chiffon", "georgette", "lace", "tweed", "corduroy", "mesh", "tulle"],
  pattern:          ["solid", "stripes", "floral", "geometric", "animal-print", "check", "plaid", "abstract", "polka-dot", "houndstooth", "paisley", "graphic"],
  formality:        ["casual", "smart-casual", "business-casual", "business-formal", "occasion", "evening"],
  occasions:        ["work", "casual", "weekend", "evening", "date-night", "special-occasion", "travel", "gym", "beach", "loungewear"],
  seasons:          ["spring", "summer", "fall", "winter", "all-season"],
  styleTags:        ["feminine", "flowy", "romantic", "effortless", "effortlessly-chic", "structured", "tailored", "classic", "polished", "elevated", "refined", "edgy", "bold", "statement", "minimal", "clean", "understated", "casual", "relaxed", "oversized", "artsy", "creative", "eclectic", "trendy", "contemporary", "timeless", "chic", "sophisticated", "playful", "luxe"],
  stylePersonality: ["classic-polished", "feminine-romantic", "minimal-relaxed", "bold-edgy", "creative-expressive"],
} as const;

// ── Loader ─────────────────────────────────────────────────────────────────────

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminSession(request);

  const url = new URL(request.url);
  const itemId = params.itemId;
  if (!itemId) throw new Response("Not found", { status: 404 });

  const item = await getClosetItemDetail(itemId);
  if (!item) throw new Response("Closet item not found", { status: 404 });

  // Compute effective classification (stored + overrides) for interpretation
  const effectiveClassification = getEffectiveClosetItem(
    item.classification,
    item.adminReview,
  );
  const interpretation = interpretGarment(effectiveClassification, item.category);

  // Phase 3B: queue navigation
  const returnTo = url.searchParams.get("from") ?? null;
  const [nextUnreviewedId, adjacent] = await Promise.all([
    getNextUnreviewedItemId(itemId),
    getAdjacentItemIds(itemId),
  ]);
  const { prevId: prevItemId, nextId: nextItemId } = adjacent;

  let garmentImageUrl: string | null = null;
  if (item.imagePublicId) {
    try {
      const cfg = getCloudinaryConfig();
      if (cfg) {
        garmentImageUrl = buildPrivateDownloadUrl(
          cfg,
          item.imagePublicId,
          item.imageFormat ?? "jpg",
          "private",
        );
      } else {
        garmentImageUrl = item.thumbnailUrl;
      }
    } catch {
      garmentImageUrl = item.thumbnailUrl;
    }
  } else {
    garmentImageUrl = item.thumbnailUrl;
  }

  const passportContext = await getCustomerStylingPassport(item.customerId);
  const stylingIntelligence = deriveGarmentStylingIntelligence(effectiveClassification, passportContext);

  return Response.json({ item, effectiveClassification, garmentImageUrl, interpretation, stylingIntelligence, passportContext, returnTo, nextUnreviewedId, prevItemId, nextItemId });
}

// ── Action ─────────────────────────────────────────────────────────────────────

export async function action({ request, params }: ActionFunctionArgs) {
  const session = await requireAdminSession(request);
  const reviewedBy = session.identity.email;

  const itemId = params.itemId;
  if (!itemId) throw new Response("Not found", { status: 404 });

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark-correct") {
    await markItemReviewed(itemId, reviewedBy);
    return Response.json({ ok: true });
  }

  if (intent === "save-overrides") {
    const raw = parseOverridesFromForm(formData);
    try {
      const validated = validateOverrides(raw);
      const storedCls = await getItemClassification(itemId);
      const meaningful = filterSameAsStored(validated, storedCls);
      await saveAdminReview(itemId, meaningful, reviewedBy);
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Validation failed" },
        { status: 400 },
      );
    }
  }

  if (intent === "revert-field") {
    const fieldKey = formData.get("fieldKey");
    if (typeof fieldKey !== "string") {
      return Response.json({ error: "Missing fieldKey" }, { status: 400 });
    }
    try {
      await revertOverrideField(itemId, fieldKey, reviewedBy);
      return Response.json({ ok: true });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Revert failed" },
        { status: 400 },
      );
    }
  }

  if (intent === "flag-vocab-gap") {
    const note = formData.get("vocabNote");
    const noteText = typeof note === "string" ? note.trim() : null;
    await setVocabGapFlag(itemId, noteText, reviewedBy);
    return Response.json({ ok: true });
  }

  if (intent === "clear-vocab-gap") {
    await clearVocabGapFlag(itemId, reviewedBy);
    return Response.json({ ok: true });
  }

  throw new Response("Bad request", { status: 400 });
}

// ── Form parser ────────────────────────────────────────────────────────────────

function parseOverridesFromForm(formData: FormData): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  const enumFields = [
    "silhouette", "fitProfile", "hemLength", "topLength", "waistShape",
    "sleeveLength", "necklineCoverage", "material", "pattern", "formality",
    "stylePersonality",
  ];
  const freeTextFields = ["subcategory", "primaryColor"];
  const booleanFields = ["shoulderCoverage", "midriffExposed"];
  const vocabArrayFields = ["occasions", "seasons", "styleTags"];

  for (const field of [...enumFields, ...freeTextFields]) {
    if (formData.has(`override_${field}`)) {
      const val = String(formData.get(`value_${field}`) ?? "");
      raw[field] = val === "" ? null : val;
    }
  }

  for (const field of booleanFields) {
    if (formData.has(`override_${field}`)) {
      const val = String(formData.get(`value_${field}`) ?? "");
      raw[field] = val === "" ? null : val === "true";
    }
  }

  for (const field of vocabArrayFields) {
    if (formData.has(`override_${field}`)) {
      raw[field] = formData.getAll(`value_${field}`).map(String);
    }
  }

  if (formData.has("override_colors")) {
    const colorsText = String(formData.get("value_colors") ?? "");
    raw["colors"] = colorsText.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return raw;
}

// ── Same-as-stored filter ──────────────────────────────────────────────────────

/** Removes override keys whose value is identical to the stored classification value.
 *  For arrays, compares sorted join. A matched key produces no correction — drop it.
 *  Returns a new ClosetItemOverrides with only meaningful corrections. */
function filterSameAsStored(
  validated: ClosetItemOverrides,
  stored: ClosetItemFields | null,
): ClosetItemOverrides {
  if (!stored) return validated;
  const result: ClosetItemOverrides = {};
  const storedRec = stored as Record<string, unknown>;
  for (const key of Object.keys(validated) as (keyof ClosetItemOverrides)[]) {
    const val = (validated as Record<string, unknown>)[key as string];
    const storedVal = storedRec[key as string];
    if (Array.isArray(val) && Array.isArray(storedVal)) {
      const a = [...(val as string[])].sort().join("\x00");
      const b = [...(storedVal as string[])].sort().join("\x00");
      if (a !== b) (result as Record<string, unknown>)[key as string] = val;
    } else if (val !== storedVal) {
      (result as Record<string, unknown>)[key as string] = val;
    }
  }
  return result;
}

// ── Badge maps ─────────────────────────────────────────────────────────────────

const REVIEW_BADGE: Record<string, string> = {
  "AI ONLY":  "na-badge--ai-only",
  REVIEWED:   "na-badge--reviewed",
  "CORRECTED BY YOU": "na-badge--overridden",
};

const ANALYSIS_BADGE: Record<string, string> = {
  ready:        "na-badge--ready",
  failed:       "na-badge--failed",
  pending:      "na-badge--pending",
  not_analyzed: "na-badge--not-analyzed",
};

// ── Display helpers ────────────────────────────────────────────────────────────

/** Maps display status "CORRECTED BY YOU" → "CORRECTED BY YOU · N correction(s)" in the UI only. */
function reviewBadgeLabel(displayStatus: string, overrideCount: number): string {
  if (displayStatus === "CORRECTED BY YOU") {
    const noun = overrideCount === 1 ? "correction" : "corrections";
    return `CORRECTED BY YOU · ${overrideCount} ${noun}`;
  }
  return displayStatus;
}

const FIELD_LABELS: Record<string, string> = {
  subcategory:      "Subcategory",
  silhouette:       "Silhouette",
  fitProfile:       "Fit profile",
  hemLength:        "Hem length",
  topLength:        "Top length",
  waistShape:       "Waist shape",
  sleeveLength:     "Sleeve length",
  necklineCoverage: "Neckline coverage",
  shoulderCoverage: "Shoulder coverage",
  midriffExposed:   "Midriff exposed",
  material:         "Material",
  pattern:          "Pattern",
  primaryColor:     "Primary color",
  colors:           "Colors",
  occasions:        "Occasions",
  seasons:          "Seasons",
  formality:        "Formality",
  styleTags:        "Style tags",
  stylePersonality: "Style personality",
};

const BOOL_FIELD_LABELS: Record<string, [string, string]> = {
  shoulderCoverage: ["Covered", "Not covered"],
  midriffExposed:   ["Exposed", "Not exposed"],
};

function formatBoolVal(fieldKey: string, val: boolean | null | unknown): string {
  if (val === null || val === undefined) return "—";
  const labels = BOOL_FIELD_LABELS[fieldKey];
  if (!labels) return String(val);
  return val ? labels[0] : labels[1];
}

function formatFieldValue(fieldKey: string, val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (fieldKey === "shoulderCoverage" || fieldKey === "midriffExposed") {
    return formatBoolVal(fieldKey, val);
  }
  if (Array.isArray(val)) return val.length > 0 ? (val as string[]).join(", ") : "—";
  return String(val);
}

// ── Phase 3C V1: Deeper Styling Intelligence (shadow / read-only) ──────────────

const VISUAL_WEIGHT_COLOUR: Record<string, string> = {
  light:       "#6b7280",
  medium:      "#0369a1",
  substantial: "#7c3aed",
};

const ENERGY_TIER_COLOUR: Record<string, string> = {
  "high-energy":         "#dc2626",
  "deep-authoritative":  "#1e3a5f",
  "mid-range":           "#059669",
  "neutral-versatile":   "#6b7280",
};

function DeeperStylingIntelligence({
  intel,
  passportContext,
}: {
  intel: GarmentStylingIntelligence;
  passportContext: CustomerStylingPassportContext | null;
}) {
  const [showIntentions, setShowIntentions] = useState(false);

  const vw = intel.visualWeight;
  const cp = intel.colourProfile;
  const passportBadge = intel.passportUsed ? "SHADOW · V1 · PASSPORT-AWARE" : "SHADOW · V1 · NO PASSPORT";

  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Deeper Styling Intelligence</h2>
        <span className="na-badge na-badge--ai-only" style={{ fontSize: "0.65rem" }}>
          {passportBadge}
        </span>
      </div>
      <div className="na-card__body" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {/* ─── A. DEEPER GARMENT INTELLIGENCE (intrinsic / generic) ─── */}
        <div>
          <p className="na-provenance-label" style={{ marginBottom: "0.75rem" }}>
            A — DEEPER GARMENT INTELLIGENCE
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* Visual Weight */}
            <div>
              <p style={{ fontSize: "0.65rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.35rem" }}>Visual Weight</p>
              {vw.value ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <span
                    className="na-interp-label"
                    style={{ backgroundColor: VISUAL_WEIGHT_COLOUR[vw.value] + "20", color: VISUAL_WEIGHT_COLOUR[vw.value], borderColor: VISUAL_WEIGHT_COLOUR[vw.value] + "40" }}
                  >
                    {vw.value}
                  </span>
                  {vw.evidence.length > 0 && (
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.15rem" }}>
                      {vw.evidence.map((e) => (
                        <span key={e} style={{ fontSize: "0.7rem", color: "#9ca3af", background: "#1f2937", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>
                          {e}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>— insufficient data</span>
              )}
            </div>

            {/* Colour Profile */}
            <div>
              <p style={{ fontSize: "0.65rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.35rem" }}>Colour Profile</p>
              {cp.neutralChromaticity ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                    <span className="na-interp-label">{cp.neutralChromaticity}</span>
                    {cp.broadFamily && <span className="na-interp-label">{cp.broadFamily}</span>}
                    {cp.lightDark && <span className="na-interp-label">{cp.lightDark}</span>}
                    {cp.energyTier && (
                      <span
                        className="na-interp-label"
                        style={{ backgroundColor: ENERGY_TIER_COLOUR[cp.energyTier] + "20", color: ENERGY_TIER_COLOUR[cp.energyTier], borderColor: ENERGY_TIER_COLOUR[cp.energyTier] + "40" }}
                      >
                        {cp.energyTier}
                      </span>
                    )}
                  </div>
                  {cp.evidence.length > 0 && (
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      {cp.evidence.map((e) => (
                        <span key={e} style={{ fontSize: "0.7rem", color: "#9ca3af", background: "#1f2937", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>
                          {e}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <span style={{ color: "#6b7280", fontSize: "0.8rem" }}>— no colour data</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #1f2937" }} />

        {/* ─── B. PASSPORT-AWARE STYLING POTENTIAL ─── */}
        <div>
          <p className="na-provenance-label" style={{ marginBottom: "0.75rem" }}>
            B — PASSPORT-AWARE STYLING POTENTIAL
          </p>

          {/* Passport context header */}
          {intel.passportUsed && passportContext ? (
            <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#0c1a2e", borderRadius: "6px", border: "1px solid #1e3a5f" }}>
              <p style={{ fontSize: "0.7rem", color: "#6b7280", marginBottom: "0.25rem" }}>PROFILE CONTEXT</p>
              {passportContext.stylePersonalities.length > 0 && (
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginBottom: "0.2rem" }}>
                  {passportContext.stylePersonalities.map(p => (
                    <span key={p} style={{ fontSize: "0.7rem", color: "#93c5fd", background: "#1e3a5f", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>{p}</span>
                  ))}
                </div>
              )}
              {passportContext.favoriteColors.length > 0 && (
                <p style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                  Favourite colours: {passportContext.favoriteColors.slice(0, 5).join(", ")}
                  {passportContext.favoriteColors.length > 5 ? ` +${passportContext.favoriteColors.length - 5}` : ""}
                </p>
              )}
              <p style={{ fontSize: "0.65rem", color: "#4b5563", marginTop: "0.25rem" }}>No TODAY session applied.</p>
            </div>
          ) : (
            <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#111827", borderRadius: "6px", border: "1px solid #374151" }}>
              <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                Passport context unavailable — showing garment-only baseline
              </p>
            </div>
          )}

          {/* Styling signals summary (non-empty) */}
          {intel.intentionPotentials.filter(ip => ip.signals.length > 0).length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>No signals computed for this garment/profile combination</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginBottom: "0.75rem" }}>
              {intel.intentionPotentials
                .filter(ip => ip.signals.length > 0)
                .map(ip => (
                  <div key={ip.intention} style={{ display: "flex", gap: "0.5rem", alignItems: "flex-start" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#d1d5db", minWidth: "150px", paddingTop: "0.1rem", fontFamily: "monospace" }}>
                      {ip.intention}
                    </span>
                    <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                      {ip.signals.join(" · ")}
                    </span>
                  </div>
                ))
              }
            </div>
          )}

          {/* Collapsed debug: all 12 */}
          <details
            onToggle={(e) => setShowIntentions((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary style={{ cursor: "pointer", fontSize: "0.7rem", color: "#6b7280", userSelect: "none", listStyle: "none" }}>
              {showIntentions ? "▾" : "▸"} Debug: all {intel.intentionPotentials.length} intention potentials
            </summary>
            <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {intel.intentionPotentials.map(ip => (
                <div key={ip.intention} style={{ borderLeft: "2px solid #374151", paddingLeft: "0.75rem" }}>
                  <p style={{ fontSize: "0.7rem", fontWeight: 600, color: "#d1d5db", fontFamily: "monospace", marginBottom: "0.2rem" }}>
                    {ip.intention}
                  </p>
                  {ip.signals.length === 0 ? (
                    <span style={{ fontSize: "0.7rem", color: "#4b5563" }}>no signals</span>
                  ) : (
                    <ul style={{ margin: 0, padding: "0 0 0 1rem" }}>
                      {ip.signals.map((s, i) => (
                        <li key={i} style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>

        <p style={{ fontSize: "0.65rem", color: "#4b5563", borderTop: "1px solid #1f2937", paddingTop: "0.75rem" }}>
          Shadow-only · V1 · Not wired to StyleMe · Not final StyleMe reasoning
        </p>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ClosetItemDetailPage() {
  const { item, effectiveClassification, garmentImageUrl, interpretation, stylingIntelligence, passportContext, returnTo, nextUnreviewedId, prevItemId, nextItemId } =
    useLoaderData() as {
      item: ClosetItemDetail;
      effectiveClassification: ClosetClassification;
      garmentImageUrl: string | null;
      interpretation: GarmentInterpretation;
      stylingIntelligence: GarmentStylingIntelligence;
      passportContext: CustomerStylingPassportContext | null;
      returnTo: string | null;
      nextUnreviewedId: string | null;
      prevItemId: string | null;
      nextItemId: string | null;
    };
  const markCorrectFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const navigate = useNavigate();

  const [showEdit, setShowEdit] = useState(false);

  // Phase 3B: auto-advance to next unreviewed item after mark-correct
  useEffect(() => {
    if (markCorrectFetcher.data?.ok && nextUnreviewedId) {
      const nextUrl = `/admin/naia/closet/${nextUnreviewedId}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`;
      navigate(nextUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markCorrectFetcher.data]);

  const existingOverrides = (item.adminReview?.overrides ?? {}) as Record<string, unknown>;
  const overrideCount = Object.keys(existingOverrides).length;
  const hasOverrides = overrideCount > 0;

  const displayDate = (d: Date | string | null) =>
    d
      ? new Date(d).toLocaleString("en-GB", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        })
      : "—";

  // Stored classification for comparing vs effective in the edit panel
  const stored = item.classification;
  const eff = effectiveClassification;

  function noInterpretationReason(): string {
    if (item.analysisStatus === "not_analyzed") return "This item hasn't been analysed yet.";
    if (item.analysisStatus === "pending")      return "Analysis is in progress.";
    if (item.analysisStatus === "failed")       return "Analysis couldn't be completed. A clearer photo may help.";
    return "Insufficient classification data to build an interpretation.";
  }

  const section2Title = item.hasSnapshot
    ? "What AI Sees"
    : item.fieldConfidence
    ? "Stored Classification"
    : "Classification";

  const confidenceHeading = item.hasSnapshot ? "AI Confidence" : "Stored confidence";

  function Chips({ values }: { values: string[] }) {
    if (!values.length) return <span className="na-null">—</span>;
    return (
      <div className="na-chips">
        {values.map((v, i) => <span key={i} className="na-chip">{v}</span>)}
      </div>
    );
  }

  function WhatRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <>
        <span className="na-what-key">{label}</span>
        <span className="na-what-val">{children}</span>
      </>
    );
  }

  const fc = item.fieldConfidence as Record<string, unknown> | null;
  function getConf(key: string): string | null {
    if (!fc) return null;
    const v = fc[key];
    if (v === "high" || v === "medium" || v === "low") return v;
    return null;
  }

  return (
    <>
      <style>{`
        @media print {
          @page { margin: 1.5cm; }
          /* Suppress admin chrome */
          .naia-admin-nav { display: none !important; }
          .naia-admin-main { margin-left: 0 !important; padding: 1rem !important; }
          /* Suppress item navigation strip (Back / Prev / Next / Queue-next / Print button) */
          .na-item-nav-strip { display: none !important; }
          /* Suppress interactive teaching controls */
          .na-teach-actions { display: none !important; }
          .na-vocab-gap { display: none !important; }
          /* Suppress edit panel when open */
          .na-teach-card form,
          .na-teach-card [data-edit-panel] { display: none !important; }
          /* Stack sidebar above main for print */
          .na-detail-grid { display: block !important; }
          .na-detail-sidebar { max-width: 320px !important; margin-bottom: 1.5rem !important; }
          /* Force-expand the Phase 3C debug intentions section */
          details > :not(summary) { display: block !important; }
          details > summary { display: none !important; }
          /* Preserve dark-mode colours in PDF */
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>

      {/* Phase 3B: navigation strip — Back preserves filters, Next advances queue */}
      <div className="na-item-nav-strip" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.875rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link
            to={returnTo ? `/admin/naia/closet?${returnTo}` : "/admin/naia/closet"}
            className="na-back"
            style={{ margin: 0 }}
          >
            ← Closet Intelligence
          </Link>
          {prevItemId && (
            <Link
              to={`/admin/naia/closet/${prevItemId}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`}
              className="na-nav-adj"
              title="Previous item in list"
            >
              ← Prev
            </Link>
          )}
          {nextItemId && (
            <Link
              to={`/admin/naia/closet/${nextItemId}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`}
              className="na-nav-adj"
              title="Next item in list"
            >
              Next →
            </Link>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {nextUnreviewedId && (
            <Link
              to={`/admin/naia/closet/${nextUnreviewedId}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`}
              className="na-btn-queue-next"
            >
              Next unreviewed →
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              const main = document.querySelector(".naia-admin-main");
              if (!main) return;
              const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
                .map((el) => el.outerHTML)
                .join("\n");
              const title = document.title || item.name || "garment";
              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${styles}</head><body style="background:#0d1117;color:#e6edf3;padding:2rem;font-family:-apple-system,sans-serif">${main.innerHTML}</body></html>`;
              const blob = new Blob([html], { type: "text/html;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = Object.assign(document.createElement("a"), {
                href: url,
                download: `${(item.name ?? "garment").replace(/\s+/g, "-").toLowerCase()}.html`,
              });
              a.click();
              URL.revokeObjectURL(url);
            }}
            style={{
              padding: "0.3rem 0.75rem",
              fontSize: "0.75rem",
              fontWeight: 600,
              background: "transparent",
              color: "#8b949e",
              border: "1px solid #30363d",
              borderRadius: "5px",
              cursor: "pointer",
              letterSpacing: "0.03em",
              whiteSpace: "nowrap",
            }}
          >
            SAVE PAGE
          </button>
        </div>
      </div>

      <h1 className="na-page-heading" style={{ marginBottom: "0.5rem" }}>
        {item.name ?? "Unnamed item"}
      </h1>

      {/* Meta strip */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem", alignItems: "center" }}>
        <span className={`na-badge ${ANALYSIS_BADGE[item.analysisStatus] ?? "na-badge--not-analyzed"}`}>
          {item.analysisStatus.replace(/_/g, " ")}
        </span>
        <span className={`na-badge ${REVIEW_BADGE[item.displayReviewStatus] ?? "na-badge--ai-only"}`}>
          {reviewBadgeLabel(item.displayReviewStatus, overrideCount)}
        </span>
        <span style={{ fontSize: "12px", color: "#6b7280" }}>{item.category}</span>
        {stored.subcategory && (
          <span style={{ fontSize: "12px", color: "#6b7280" }}>· {stored.subcategory}</span>
        )}
        <span style={{ fontSize: "12px", color: "#9ca3af" }}>
          {item.customerEmail ?? item.customerId}
        </span>
      </div>

      <div className="na-detail-grid">

        {/* ── Sidebar ── */}
        <div className="na-detail-sidebar">

          {/* Garment image */}
          <div className="na-card" style={{ overflow: "hidden", marginBottom: "1.25rem" }}>
            {garmentImageUrl ? (
              <img src={garmentImageUrl} alt={item.name ?? "Garment"} className="na-item-img" />
            ) : (
              <div className="na-item-img--placeholder">
                <span style={{ fontSize: "40px", opacity: 0.3 }}>☐</span>
                <span>No image</span>
              </div>
            )}
          </div>

          {/* Provenance */}
          <div className="na-card">
            <div className="na-card__header">
              <h2 className="na-card__title">Provenance</h2>
            </div>
            <div className="na-card__body">
              {item.hasSnapshot ? (
                <>
                  <p className="na-provenance-label">AI SNAPSHOT</p>
                  {item.latestSnapshot && (
                    <table className="na-field-table">
                      <tbody>
                        <tr>
                          <th>Model</th>
                          <td><code style={{ fontSize: "11px" }}>{item.latestSnapshot.analysisModel}</code></td>
                        </tr>
                        <tr>
                          <th>Schema</th>
                          <td><code style={{ fontSize: "11px" }}>{item.latestSnapshot.analysisSchemaVersion}</code></td>
                        </tr>
                        <tr>
                          <th>Analysed</th>
                          <td>{displayDate(item.latestSnapshot.analyzedAt)}</td>
                        </tr>
                        <tr>
                          <th>Snapshot ID</th>
                          <td><code style={{ fontSize: "10px", wordBreak: "break-all" }}>{item.latestSnapshot.id}</code></td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                  {item.snapshotHistory.length > 1 && (
                    <details style={{ marginTop: "1rem" }}>
                      <summary className="na-tech-summary" style={{ padding: "0.35rem 0" }}>
                        History ({item.snapshotHistory.length} runs)
                      </summary>
                      <div>
                        {item.snapshotHistory.map((s) => (
                          <div className="na-snapshot-row" key={s.id}>
                            <span style={{ color: "#374151" }}>
                              {new Date(s.analyzedAt).toLocaleDateString("en-GB", {
                                day: "2-digit", month: "short", year: "numeric",
                              })}
                            </span>
                            <code style={{ fontSize: "10px", color: "#6b7280" }}>{s.analysisModel}</code>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              ) : item.fieldConfidence ? (
                <div className="na-provenance-unavailable">
                  <strong>Stored classification</strong>
                  <p style={{ margin: "0.4rem 0 0", fontSize: "12px", lineHeight: "1.5" }}>
                    This item was analysed before snapshot tracking was introduced.
                    Stored classification and confidence values are available, but the
                    original AI snapshot and model output are unavailable.
                  </p>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: "12px", color: "#9ca3af" }}>
                  No analysis record for this item.
                </p>
              )}
            </div>
          </div>

          {/* Admin review record */}
          {item.adminReview && (
            <div className="na-card">
              <div className="na-card__header">
                <h2 className="na-card__title">Admin Review</h2>
                <span className={`na-badge ${REVIEW_BADGE[item.displayReviewStatus] ?? "na-badge--ai-only"}`}>
                  {reviewBadgeLabel(item.displayReviewStatus, overrideCount)}
                </span>
              </div>
              <div className="na-card__body">
                <table className="na-field-table">
                  <tbody>
                    {item.adminReview.reviewedBy && (
                      <tr><th>Reviewed by</th><td>{item.adminReview.reviewedBy}</td></tr>
                    )}
                    {item.adminReview.reviewedAt && (
                      <tr><th>Reviewed at</th><td>{displayDate(item.adminReview.reviewedAt)}</td></tr>
                    )}
                    {item.adminReview.adminNotes && (
                      <tr>
                        <th>Notes</th>
                        <td style={{ whiteSpace: "pre-wrap", fontSize: "12px" }}>
                          {item.adminReview.adminNotes}
                        </td>
                      </tr>
                    )}
                    {hasOverrides && (
                      <tr>
                        <th>Overridden</th>
                        <td>
                          <div className="na-chips">
                            {Object.keys(existingOverrides).map((k) => (
                              <span key={k} className="na-chip" style={{ background: "#ede9fe", color: "#4c1d95" }}>
                                {k}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Main content ── */}
        <div className="na-detail-main">

          {/* ════════════════════════════════════════════
              TEACH nAia — review status + actions
          ════════════════════════════════════════════ */}
          <div className="na-card na-teach-card">
            <div className="na-card__header">
              <h2 className="na-card__title">Teach nAia</h2>
              <span className={`na-badge ${REVIEW_BADGE[item.displayReviewStatus] ?? "na-badge--ai-only"}`}>
                {reviewBadgeLabel(item.displayReviewStatus, overrideCount)}
              </span>
            </div>
            <div className="na-card__body">

              {/* Action row */}
              <div className="na-teach-actions">
                {/* Mark as correct — hidden when corrections already exist */}
                {!hasOverrides && (
                  <button
                    type="button"
                    className="na-btn na-btn--secondary"
                    disabled={markCorrectFetcher.state !== "idle"}
                    onClick={() =>
                      markCorrectFetcher.submit(
                        { intent: "mark-correct" },
                        { method: "post", action: `/admin/naia/closet/${item.id}` },
                      )
                    }
                  >
                    {markCorrectFetcher.state !== "idle" ? "Saving…" : "✓ Mark as correct"}
                  </button>
                )}

                {/* Toggle edit panel */}
                <button
                  type="button"
                  className={`na-btn ${showEdit ? "na-btn--primary" : "na-btn--outline"}`}
                  onClick={() => setShowEdit((v) => !v)}
                >
                  {showEdit ? "✕ Cancel editing" : "✎ Edit classification"}
                </button>
              </div>

              {/* Action feedback for mark-correct */}
              {markCorrectFetcher.data?.error && (
                <p className="na-teach-error">{markCorrectFetcher.data.error}</p>
              )}
              {markCorrectFetcher.data?.ok && (
                <p className="na-teach-ok">Marked as correct.</p>
              )}

              {/* Vocabulary gap flag */}
              <VocabGapToggle itemId={item.id} adminNotes={item.adminReview?.adminNotes ?? null} />

              {/* Read-only corrections summary — visible when editor is closed */}
              {!showEdit && hasOverrides && (
                <CorrectionsView overrides={existingOverrides} />
              )}

              {/* Edit panel */}
              {showEdit && (
                <EditClassificationPanel
                  stored={stored}
                  existingOverrides={existingOverrides}
                  itemId={item.id}
                  onSaveSuccess={() => setShowEdit(false)}
                  nextUnreviewedId={nextUnreviewedId}
                  returnTo={returnTo}
                />
              )}
            </div>
          </div>

          {/* ════════════════════════════════════════════
              SECTION 1 — HOW nAia READS THIS PIECE
          ════════════════════════════════════════════ */}
          <div className="na-card">
            <div className="na-card__header">
              <h2 className="na-card__title">How nAia reads this piece</h2>
              {!item.hasSnapshot && item.fieldConfidence && (
                <span className="na-card__subtitle" style={{ color: "#b45309" }}>
                  Stored classification
                </span>
              )}
            </div>
            <div className="na-card__body">
              {interpretation.hasInterpretation ? (
                <>
                  <div className="na-interp-labels">
                    {interpretation.labels.map((lbl) => (
                      <span key={lbl.label} className="na-interp-label">{lbl.label}</span>
                    ))}
                  </div>
                  {interpretation.labels.length > 0 && (
                    <>
                      <p className="na-provenance-label" style={{ marginBottom: "0.5rem" }}>WHY</p>
                      <div className="na-interp-why-group">
                        {interpretation.labels.map((lbl) => (
                          <div key={lbl.label} className="na-interp-why-row">
                            <span className="na-interp-why-lbl">{lbl.label}</span>
                            <span className="na-interp-why-arr">→</span>
                            <span className="na-interp-why-evid">{lbl.evidence.join(" + ")}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {hasOverrides && (
                    <p className="na-teach-note">
                      Interpretation includes human-reviewed corrections.{" "}
                      <span style={{ color: "#9ca3af" }}>StyleMe integration will be enabled in a later phase.</span>
                    </p>
                  )}
                </>
              ) : (
                <p className="na-interp-empty">{noInterpretationReason()}</p>
              )}
            </div>
          </div>

          {/* ════════════════════════════════════════════
              SECTION 4 — DEEPER STYLING INTELLIGENCE (shadow / read-only)
          ════════════════════════════════════════════ */}
          <DeeperStylingIntelligence intel={stylingIntelligence} passportContext={passportContext} />

          {/* ════════════════════════════════════════════
              SECTION 2 — WHAT AI SEES (effective values)
          ════════════════════════════════════════════ */}
          <div className="na-card">
            <div className="na-card__header">
              <h2 className="na-card__title">{section2Title}</h2>
              {!item.hasSnapshot && item.fieldConfidence && (
                <span className="na-card__subtitle" style={{ color: "#b45309" }}>
                  Original AI snapshot unavailable
                </span>
              )}
            </div>
            <div className="na-what-grid">
              <WhatRow label="Category">{item.category}</WhatRow>
              {eff.subcategory && (
                <WhatRow label="Subcategory">
                  <EffVal storedVal={stored.subcategory} effVal={eff.subcategory} isOv={Object.hasOwn(existingOverrides, "subcategory")} />
                </WhatRow>
              )}
              {(eff.primaryColor || eff.pattern) && (
                <WhatRow label="Colour">
                  {[
                    eff.primaryColor,
                    eff.pattern && eff.pattern !== "solid" ? eff.pattern + " pattern" : eff.pattern,
                  ].filter(Boolean).join(" · ")}
                </WhatRow>
              )}
              {eff.colors.length > 1 && (
                <WhatRow label="All colours"><Chips values={eff.colors} /></WhatRow>
              )}
              {eff.material && (
                <WhatRow label="Material">
                  <EffVal storedVal={stored.material} effVal={eff.material} isOv={Object.hasOwn(existingOverrides, "material")} />
                </WhatRow>
              )}
              {eff.fitProfile && eff.fitProfile !== "n/a" && (
                <WhatRow label="Fit">
                  <EffVal storedVal={stored.fitProfile} effVal={eff.fitProfile} isOv={Object.hasOwn(existingOverrides, "fitProfile")} />
                </WhatRow>
              )}
              {eff.silhouette && (
                <WhatRow label="Silhouette">
                  <EffVal storedVal={stored.silhouette} effVal={eff.silhouette} isOv={Object.hasOwn(existingOverrides, "silhouette")} />
                </WhatRow>
              )}
              {eff.waistShape && (
                <WhatRow label="Waist">
                  <EffVal storedVal={stored.waistShape} effVal={eff.waistShape} isOv={Object.hasOwn(existingOverrides, "waistShape")} />
                </WhatRow>
              )}
              {eff.hemLength && eff.hemLength !== "n/a" && (
                <WhatRow label="Hem">
                  <EffVal storedVal={stored.hemLength} effVal={eff.hemLength} isOv={Object.hasOwn(existingOverrides, "hemLength")} />
                </WhatRow>
              )}
              {eff.topLength && eff.topLength !== "n/a" && (
                <WhatRow label="Top length">
                  <EffVal storedVal={stored.topLength} effVal={eff.topLength} isOv={Object.hasOwn(existingOverrides, "topLength")} />
                </WhatRow>
              )}
              {eff.sleeveLength && eff.sleeveLength !== "n/a" && (
                <WhatRow label="Sleeves">
                  <EffVal storedVal={stored.sleeveLength} effVal={eff.sleeveLength} isOv={Object.hasOwn(existingOverrides, "sleeveLength")} />
                </WhatRow>
              )}
              {eff.necklineCoverage && eff.necklineCoverage !== "n/a" && (
                <WhatRow label="Neckline">
                  <EffVal storedVal={stored.necklineCoverage} effVal={eff.necklineCoverage} isOv={Object.hasOwn(existingOverrides, "necklineCoverage")} />
                </WhatRow>
              )}
              {(eff.shoulderCoverage !== null || eff.midriffExposed !== null) && (
                <WhatRow label="Coverage">
                  {[
                    eff.shoulderCoverage === true ? "shoulder covered" : null,
                    eff.midriffExposed === true ? "midriff exposed" : null,
                    eff.midriffExposed === false && eff.shoulderCoverage !== null ? "no midriff" : null,
                  ].filter(Boolean).join(" · ") || "—"}
                </WhatRow>
              )}
              {eff.formality && (
                <WhatRow label="Formality">
                  <EffVal storedVal={stored.formality} effVal={eff.formality} isOv={Object.hasOwn(existingOverrides, "formality")} />
                </WhatRow>
              )}
              {eff.occasions.length > 0 && (
                <WhatRow label="Occasions"><Chips values={eff.occasions} /></WhatRow>
              )}
              {eff.seasons.length > 0 && (
                <WhatRow label="Seasons"><Chips values={eff.seasons} /></WhatRow>
              )}
              {eff.styleTags.length > 0 && (
                <WhatRow label="Style tags"><Chips values={eff.styleTags} /></WhatRow>
              )}
              {eff.stylePersonality && (
                <WhatRow label="Style">
                  <EffVal storedVal={stored.stylePersonality} effVal={eff.stylePersonality} isOv={Object.hasOwn(existingOverrides, "stylePersonality")} />
                </WhatRow>
              )}
              {eff.garmentRelationships.length > 0 && (
                <WhatRow label="Relationships"><Chips values={eff.garmentRelationships} /></WhatRow>
              )}
            </div>
          </div>

          {/* ════════════════════════════════════════════
              SECTION 3 — TECHNICAL (collapsed)
          ════════════════════════════════════════════ */}
          <div className="na-card">
            <div className="na-card__header">
              <h2 className="na-card__title">Technical</h2>
              <span className="na-card__subtitle">Field confidence · snapshots · raw data · IDs</span>
            </div>
            <div className="na-card__body" style={{ padding: 0 }}>

              {item.fieldConfidence && (
                <details className="na-tech-section">
                  <summary className="na-tech-summary">{confidenceHeading}</summary>
                  <div className="na-tech-body">
                    {!item.hasSnapshot && (
                      <p style={{ margin: "0 0 0.75rem", fontSize: "12px", color: "#92400e" }}>
                        Stored confidence — cannot be attributed to a specific AI run.
                      </p>
                    )}
                    <table className="na-field-table">
                      <thead><tr><th>Field</th><th>Confidence</th></tr></thead>
                      <tbody>
                        {(["subcategory","silhouette","fitProfile","hemLength","topLength",
                           "sleeveLength","necklineCoverage","shoulderCoverage","midriffExposed",
                           "waistShape","material","pattern","primaryColor"] as const
                        ).map((key) => {
                          const conf = getConf(key);
                          if (!conf) return null;
                          return (
                            <tr key={key}>
                              <th>{key}</th>
                              <td>
                                <span className="na-conf">
                                  <span className={`na-conf__dot na-conf__dot--${conf}`} />
                                  {conf}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {item.hasSnapshot && item.latestSnapshot && (
                <details className="na-tech-section">
                  <summary className="na-tech-summary">Raw AI output (latest snapshot)</summary>
                  <div className="na-tech-body">
                    <pre className="na-json-pre">
                      {JSON.stringify(item.latestSnapshot.normalizedAnalysis, null, 2)}
                    </pre>
                  </div>
                </details>
              )}

              {item.hasSnapshot && item.snapshotHistory.length > 0 && (
                <details className="na-tech-section">
                  <summary className="na-tech-summary">
                    Snapshot history ({item.snapshotHistory.length})
                  </summary>
                  <div className="na-tech-body">
                    {item.snapshotHistory.map((s) => (
                      <div className="na-snapshot-row" key={s.id}>
                        <span style={{ color: "#374151", fontSize: "12px" }}>
                          {new Date(s.analyzedAt).toLocaleDateString("en-GB", {
                            day: "2-digit", month: "short", year: "numeric",
                          })}
                        </span>
                        <code style={{ fontSize: "10px", color: "#6b7280" }}>{s.analysisModel}</code>
                        <code style={{ fontSize: "9px", color: "#9ca3af" }}>v{s.analysisSchemaVersion}</code>
                        <code style={{ fontSize: "9px", color: "#d1d5db", wordBreak: "break-all" }}>{s.id}</code>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <details className="na-tech-section">
                <summary className="na-tech-summary">Item metadata</summary>
                <div className="na-tech-body">
                  <table className="na-field-table">
                    <tbody>
                      <tr><th>Item ID</th><td><code style={{ fontSize: "11px" }}>{item.id}</code></td></tr>
                      <tr><th>Customer ID</th><td><code style={{ fontSize: "11px" }}>{item.customerId}</code></td></tr>
                      <tr><th>Customer email</th><td>{item.customerEmail ?? <span className="na-null">unknown</span>}</td></tr>
                      <tr><th>Created</th><td>{displayDate(item.createdAt)}</td></tr>
                      <tr>
                        <th>Last analysed</th>
                        <td>{item.analyzedAt ? displayDate(item.analyzedAt) : <span className="na-null">—</span>}</td>
                      </tr>
                      {item.analysisSchemaVersion && (
                        <tr><th>Schema version</th><td><code style={{ fontSize: "11px" }}>{item.analysisSchemaVersion}</code></td></tr>
                      )}
                      {item.imagePublicId && (
                        <tr>
                          <th>Cloudinary ID</th>
                          <td><code style={{ fontSize: "10px", wordBreak: "break-all" }}>{item.imagePublicId}</code></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </details>

            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// ── EffVal: display effective value with override indicator ────────────────────

function EffVal({
  storedVal,
  effVal,
  isOv,
}: {
  storedVal: string | null;
  effVal: string | null;
  isOv: boolean;
}) {
  if (!isOv) return <>{effVal}</>;
  return (
    <span>
      <span className="na-ov-badge">corrected</span>{" "}
      {effVal ?? <span className="na-null">cleared</span>}
      {storedVal && storedVal !== effVal && (
        <span className="na-ov-stored"> (was: {storedVal})</span>
      )}
    </span>
  );
}

// ── EditClassificationPanel ────────────────────────────────────────────────────

interface EditPanelProps {
  stored: ClosetClassification;
  existingOverrides: Record<string, unknown>;
  itemId: string;
  onSaveSuccess: () => void;
  nextUnreviewedId: string | null;
  returnTo: string | null;
}

function EditClassificationPanel({ stored, existingOverrides, itemId, onSaveSuccess, nextUnreviewedId, returnTo }: EditPanelProps) {
  // Track which fields have their "override" checkbox checked
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    const keys = [
      "subcategory", "silhouette", "fitProfile", "hemLength", "topLength",
      "waistShape", "sleeveLength", "necklineCoverage", "shoulderCoverage",
      "midriffExposed", "material", "pattern", "primaryColor", "colors",
      "occasions", "seasons", "formality", "styleTags", "stylePersonality",
    ];
    for (const k of keys) init[k] = Object.hasOwn(existingOverrides, k);
    return init;
  });

  // useFetcher + ref: avoids React Router <Form> so there is zero HTML <form> element nesting.
  // The Save button is type="button"; it reads FormData from the ref and submits via fetcher.
  const formRef = useRef<HTMLFormElement>(null);
  const saveFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const hasSubmitted = useRef(false);
  const advanceNextRef = useRef(false);
  const navigate = useNavigate();

  // Auto-close edit mode (or advance to next unreviewed) after a successful save.
  useEffect(() => {
    if (hasSubmitted.current && saveFetcher.state === "idle" && saveFetcher.data?.ok) {
      hasSubmitted.current = false;
      if (advanceNextRef.current && nextUnreviewedId) {
        advanceNextRef.current = false;
        const nextUrl = `/admin/naia/closet/${nextUnreviewedId}${returnTo ? `?from=${encodeURIComponent(returnTo)}` : ""}`;
        navigate(nextUrl);
      } else {
        advanceNextRef.current = false;
        onSaveSuccess();
      }
    }
  }, [saveFetcher.state, saveFetcher.data, onSaveSuccess, nextUnreviewedId, returnTo, navigate]);

  function toggle(field: string) {
    setChecked((prev) => ({ ...prev, [field]: !prev[field] }));
  }

  function handleSave() {
    if (!formRef.current) return;
    hasSubmitted.current = true;
    advanceNextRef.current = false;
    const formData = new FormData(formRef.current);
    saveFetcher.submit(formData, { method: "post", action: `/admin/naia/closet/${itemId}` });
  }

  function handleSaveAndNext() {
    if (!formRef.current) return;
    hasSubmitted.current = true;
    advanceNextRef.current = true;
    const formData = new FormData(formRef.current);
    saveFetcher.submit(formData, { method: "post", action: `/admin/naia/closet/${itemId}` });
  }

  const ov = existingOverrides;

  // Helper: get override value as string, or stored value as fallback for display
  function ovStr(field: string, storedVal: string | null): string {
    if (Object.hasOwn(ov, field)) return (ov[field] as string | null) ?? "";
    return storedVal ?? "";
  }

  // Helper: get override bool value
  function ovBool(field: string, storedVal: boolean | null): string {
    if (Object.hasOwn(ov, field)) {
      const v = ov[field];
      if (v === true) return "true";
      if (v === false) return "false";
      return "";
    }
    if (storedVal === true) return "true";
    if (storedVal === false) return "false";
    return "";
  }

  // Helper: get override array as joined string (for colors free-text)
  function ovColors(): string {
    if (Object.hasOwn(ov, "colors")) return (ov["colors"] as string[]).join(", ");
    return stored.colors.join(", ");
  }

  // Helper: is a value in a stored or override array
  function inArr(field: string, storedArr: string[], val: string): boolean {
    if (Object.hasOwn(ov, field)) return (ov[field] as string[]).includes(val);
    return storedArr.includes(val);
  }

  // Three-value row for overridden fields
  function ThreeVal({ fieldKey, storedDisplay, ovDisplay }: {
    fieldKey: string;
    storedDisplay: string;
    ovDisplay: string;
  }) {
    if (!Object.hasOwn(ov, fieldKey)) return null;
    return (
      <div className="na-three-val">
        <span className="na-three-val__stored">stored: {storedDisplay || "—"}</span>
        <span className="na-three-val__arr">→</span>
        <span className="na-three-val__corr">corrected to: {ovDisplay || "(cleared)"}</span>
      </div>
    );
  }

  return (
    <form ref={formRef} className="na-edit-form">
      <input type="hidden" name="intent" value="save-overrides" />

      {/* ── Shape & Construction ── */}
      <p className="na-edit-group-title">Shape & Construction</p>
      <div className="na-edit-grid">

        {/* subcategory */}
        <EditRow
          fieldKey="subcategory"
          label="Subcategory"
          checked={checked.subcategory}
          onToggle={() => toggle("subcategory")}
          hasExisting={Object.hasOwn(ov, "subcategory")}
          revertBtn={<RevertBtn ov={ov} fieldKey="subcategory" />}
          threeVal={
            <ThreeVal
              fieldKey="subcategory"
              storedDisplay={stored.subcategory ?? ""}
              ovDisplay={String(ov.subcategory ?? "")}
            />
          }
        >
          <input
            type="text"
            name="value_subcategory"
            className="na-edit-input"
            defaultValue={ovStr("subcategory", stored.subcategory)}
            placeholder={stored.subcategory ?? "e.g. blazer"}
            disabled={!checked.subcategory}
          />
        </EditRow>

        {/* silhouette */}
        <EditRow
          fieldKey="silhouette"
          label="Silhouette"
          checked={checked.silhouette}
          onToggle={() => toggle("silhouette")}
          hasExisting={Object.hasOwn(ov, "silhouette")}
          revertBtn={<RevertBtn ov={ov} fieldKey="silhouette" />}
          threeVal={
            <ThreeVal
              fieldKey="silhouette"
              storedDisplay={stored.silhouette ?? ""}
              ovDisplay={String(ov.silhouette ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_silhouette"
            options={EDIT_OPTS.silhouette}
            defaultValue={ovStr("silhouette", stored.silhouette)}
            disabled={!checked.silhouette}
          />
        </EditRow>

        {/* fitProfile */}
        <EditRow
          fieldKey="fitProfile"
          label="Fit profile"
          checked={checked.fitProfile}
          onToggle={() => toggle("fitProfile")}
          hasExisting={Object.hasOwn(ov, "fitProfile")}
          revertBtn={<RevertBtn ov={ov} fieldKey="fitProfile" />}
          threeVal={
            <ThreeVal
              fieldKey="fitProfile"
              storedDisplay={stored.fitProfile ?? ""}
              ovDisplay={String(ov.fitProfile ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_fitProfile"
            options={EDIT_OPTS.fitProfile}
            defaultValue={ovStr("fitProfile", stored.fitProfile)}
            disabled={!checked.fitProfile}
          />
        </EditRow>

        {/* hemLength */}
        <EditRow
          fieldKey="hemLength"
          label="Hem length"
          checked={checked.hemLength}
          onToggle={() => toggle("hemLength")}
          hasExisting={Object.hasOwn(ov, "hemLength")}
          revertBtn={<RevertBtn ov={ov} fieldKey="hemLength" />}
          threeVal={
            <ThreeVal
              fieldKey="hemLength"
              storedDisplay={stored.hemLength ?? ""}
              ovDisplay={String(ov.hemLength ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_hemLength"
            options={EDIT_OPTS.hemLength}
            defaultValue={ovStr("hemLength", stored.hemLength)}
            disabled={!checked.hemLength}
          />
        </EditRow>

        {/* topLength */}
        <EditRow
          fieldKey="topLength"
          label="Top length"
          checked={checked.topLength}
          onToggle={() => toggle("topLength")}
          hasExisting={Object.hasOwn(ov, "topLength")}
          revertBtn={<RevertBtn ov={ov} fieldKey="topLength" />}
          threeVal={
            <ThreeVal
              fieldKey="topLength"
              storedDisplay={stored.topLength ?? ""}
              ovDisplay={String(ov.topLength ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_topLength"
            options={EDIT_OPTS.topLength}
            defaultValue={ovStr("topLength", stored.topLength)}
            disabled={!checked.topLength}
          />
        </EditRow>

        {/* waistShape */}
        <EditRow
          fieldKey="waistShape"
          label="Waist shape"
          checked={checked.waistShape}
          onToggle={() => toggle("waistShape")}
          hasExisting={Object.hasOwn(ov, "waistShape")}
          revertBtn={<RevertBtn ov={ov} fieldKey="waistShape" />}
          threeVal={
            <ThreeVal
              fieldKey="waistShape"
              storedDisplay={stored.waistShape ?? ""}
              ovDisplay={String(ov.waistShape ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_waistShape"
            options={EDIT_OPTS.waistShape}
            defaultValue={ovStr("waistShape", stored.waistShape)}
            disabled={!checked.waistShape}
          />
        </EditRow>

        {/* sleeveLength */}
        <EditRow
          fieldKey="sleeveLength"
          label="Sleeve length"
          checked={checked.sleeveLength}
          onToggle={() => toggle("sleeveLength")}
          hasExisting={Object.hasOwn(ov, "sleeveLength")}
          revertBtn={<RevertBtn ov={ov} fieldKey="sleeveLength" />}
          threeVal={
            <ThreeVal
              fieldKey="sleeveLength"
              storedDisplay={stored.sleeveLength ?? ""}
              ovDisplay={String(ov.sleeveLength ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_sleeveLength"
            options={EDIT_OPTS.sleeveLength}
            defaultValue={ovStr("sleeveLength", stored.sleeveLength)}
            disabled={!checked.sleeveLength}
          />
        </EditRow>

      </div>

      {/* ── Coverage & Colour ── */}
      <p className="na-edit-group-title" style={{ marginTop: "1.25rem" }}>Coverage & Colour</p>
      <div className="na-edit-grid">

        {/* necklineCoverage */}
        <EditRow
          fieldKey="necklineCoverage"
          label="Neckline"
          checked={checked.necklineCoverage}
          onToggle={() => toggle("necklineCoverage")}
          hasExisting={Object.hasOwn(ov, "necklineCoverage")}
          revertBtn={<RevertBtn ov={ov} fieldKey="necklineCoverage" />}
          threeVal={
            <ThreeVal
              fieldKey="necklineCoverage"
              storedDisplay={stored.necklineCoverage ?? ""}
              ovDisplay={String(ov.necklineCoverage ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_necklineCoverage"
            options={EDIT_OPTS.necklineCoverage}
            defaultValue={ovStr("necklineCoverage", stored.necklineCoverage)}
            disabled={!checked.necklineCoverage}
          />
        </EditRow>

        {/* shoulderCoverage */}
        <EditRow
          fieldKey="shoulderCoverage"
          label="Shoulder covered"
          checked={checked.shoulderCoverage}
          onToggle={() => toggle("shoulderCoverage")}
          hasExisting={Object.hasOwn(ov, "shoulderCoverage")}
          revertBtn={<RevertBtn ov={ov} fieldKey="shoulderCoverage" />}
          threeVal={
            <ThreeVal
              fieldKey="shoulderCoverage"
              storedDisplay={formatBoolVal("shoulderCoverage", stored.shoulderCoverage)}
              ovDisplay={ov.shoulderCoverage === null ? "(cleared)" : formatBoolVal("shoulderCoverage", ov.shoulderCoverage)}
            />
          }
        >
          <BoolSelect
            name="value_shoulderCoverage"
            defaultValue={ovBool("shoulderCoverage", stored.shoulderCoverage)}
            disabled={!checked.shoulderCoverage}
          />
        </EditRow>

        {/* midriffExposed */}
        <EditRow
          fieldKey="midriffExposed"
          label="Midriff exposed"
          checked={checked.midriffExposed}
          onToggle={() => toggle("midriffExposed")}
          hasExisting={Object.hasOwn(ov, "midriffExposed")}
          revertBtn={<RevertBtn ov={ov} fieldKey="midriffExposed" />}
          threeVal={
            <ThreeVal
              fieldKey="midriffExposed"
              storedDisplay={formatBoolVal("midriffExposed", stored.midriffExposed)}
              ovDisplay={ov.midriffExposed === null ? "(cleared)" : formatBoolVal("midriffExposed", ov.midriffExposed)}
            />
          }
        >
          <BoolSelect
            name="value_midriffExposed"
            defaultValue={ovBool("midriffExposed", stored.midriffExposed)}
            disabled={!checked.midriffExposed}
          />
        </EditRow>

        {/* material */}
        <EditRow
          fieldKey="material"
          label="Material"
          checked={checked.material}
          onToggle={() => toggle("material")}
          hasExisting={Object.hasOwn(ov, "material")}
          revertBtn={<RevertBtn ov={ov} fieldKey="material" />}
          threeVal={
            <ThreeVal
              fieldKey="material"
              storedDisplay={stored.material ?? ""}
              ovDisplay={String(ov.material ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_material"
            options={EDIT_OPTS.material}
            defaultValue={ovStr("material", stored.material)}
            disabled={!checked.material}
          />
        </EditRow>

        {/* pattern */}
        <EditRow
          fieldKey="pattern"
          label="Pattern"
          checked={checked.pattern}
          onToggle={() => toggle("pattern")}
          hasExisting={Object.hasOwn(ov, "pattern")}
          revertBtn={<RevertBtn ov={ov} fieldKey="pattern" />}
          threeVal={
            <ThreeVal
              fieldKey="pattern"
              storedDisplay={stored.pattern ?? ""}
              ovDisplay={String(ov.pattern ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_pattern"
            options={EDIT_OPTS.pattern}
            defaultValue={ovStr("pattern", stored.pattern)}
            disabled={!checked.pattern}
          />
        </EditRow>

        {/* primaryColor */}
        <EditRow
          fieldKey="primaryColor"
          label="Primary colour"
          checked={checked.primaryColor}
          onToggle={() => toggle("primaryColor")}
          hasExisting={Object.hasOwn(ov, "primaryColor")}
          revertBtn={<RevertBtn ov={ov} fieldKey="primaryColor" />}
          threeVal={
            <ThreeVal
              fieldKey="primaryColor"
              storedDisplay={stored.primaryColor ?? ""}
              ovDisplay={String(ov.primaryColor ?? "")}
            />
          }
        >
          <input
            type="text"
            name="value_primaryColor"
            className="na-edit-input"
            defaultValue={ovStr("primaryColor", stored.primaryColor)}
            placeholder={stored.primaryColor ?? "e.g. navy"}
            disabled={!checked.primaryColor}
          />
        </EditRow>

        {/* colors (free-text array) */}
        <EditRow
          fieldKey="colors"
          label="All colours"
          checked={checked.colors}
          onToggle={() => toggle("colors")}
          hasExisting={Object.hasOwn(ov, "colors")}
          revertBtn={<RevertBtn ov={ov} fieldKey="colors" />}
          threeVal={null}
        >
          <input
            type="text"
            name="value_colors"
            className="na-edit-input"
            defaultValue={ovColors()}
            placeholder="red, navy, white"
            disabled={!checked.colors}
          />
        </EditRow>

      </div>

      {/* ── Styling ── */}
      <p className="na-edit-group-title" style={{ marginTop: "1.25rem" }}>Styling</p>
      <div className="na-edit-grid">

        {/* formality */}
        <EditRow
          fieldKey="formality"
          label="Formality"
          checked={checked.formality}
          onToggle={() => toggle("formality")}
          hasExisting={Object.hasOwn(ov, "formality")}
          revertBtn={<RevertBtn ov={ov} fieldKey="formality" />}
          threeVal={
            <ThreeVal
              fieldKey="formality"
              storedDisplay={stored.formality ?? ""}
              ovDisplay={String(ov.formality ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_formality"
            options={EDIT_OPTS.formality}
            defaultValue={ovStr("formality", stored.formality)}
            disabled={!checked.formality}
          />
        </EditRow>

        {/* stylePersonality */}
        <EditRow
          fieldKey="stylePersonality"
          label="Style personality"
          checked={checked.stylePersonality}
          onToggle={() => toggle("stylePersonality")}
          hasExisting={Object.hasOwn(ov, "stylePersonality")}
          revertBtn={<RevertBtn ov={ov} fieldKey="stylePersonality" />}
          threeVal={
            <ThreeVal
              fieldKey="stylePersonality"
              storedDisplay={stored.stylePersonality ?? ""}
              ovDisplay={String(ov.stylePersonality ?? "")}
            />
          }
        >
          <VocabSelect
            name="value_stylePersonality"
            options={EDIT_OPTS.stylePersonality}
            defaultValue={ovStr("stylePersonality", stored.stylePersonality)}
            disabled={!checked.stylePersonality}
          />
        </EditRow>

      </div>

      {/* occasions */}
      <div className="na-edit-check-section">
        <label className="na-edit-check-label">
          <input
            type="checkbox"
            name="override_occasions"
            value="1"
            checked={checked.occasions}
            onChange={() => toggle("occasions")}
          />
          <span>Override occasions</span>
          <RevertBtn ov={ov} fieldKey="occasions" />
        </label>
        {checked.occasions && (
          <div className="na-edit-checkgroup">
            {EDIT_OPTS.occasions.map((v) => (
              <label key={v} className="na-edit-check-item">
                <input
                  type="checkbox"
                  name="value_occasions"
                  value={v}
                  defaultChecked={inArr("occasions", stored.occasions, v)}
                />
                {v}
              </label>
            ))}
          </div>
        )}
        {Object.hasOwn(ov, "occasions") && (
          <div className="na-three-val">
            <span className="na-three-val__stored">stored: {stored.occasions.join(", ") || "—"}</span>
            <span className="na-three-val__arr">→</span>
            <span className="na-three-val__corr">corrected to: {(ov.occasions as string[]).join(", ") || "(none)"}</span>
          </div>
        )}
      </div>

      {/* seasons */}
      <div className="na-edit-check-section">
        <label className="na-edit-check-label">
          <input
            type="checkbox"
            name="override_seasons"
            value="1"
            checked={checked.seasons}
            onChange={() => toggle("seasons")}
          />
          <span>Override seasons</span>
          <RevertBtn ov={ov} fieldKey="seasons" />
        </label>
        {checked.seasons && (
          <div className="na-edit-checkgroup">
            {EDIT_OPTS.seasons.map((v) => (
              <label key={v} className="na-edit-check-item">
                <input
                  type="checkbox"
                  name="value_seasons"
                  value={v}
                  defaultChecked={inArr("seasons", stored.seasons, v)}
                />
                {v}
              </label>
            ))}
          </div>
        )}
        {Object.hasOwn(ov, "seasons") && (
          <div className="na-three-val">
            <span className="na-three-val__stored">stored: {stored.seasons.join(", ") || "—"}</span>
            <span className="na-three-val__arr">→</span>
            <span className="na-three-val__corr">corrected to: {(ov.seasons as string[]).join(", ") || "(none)"}</span>
          </div>
        )}
      </div>

      {/* styleTags (max 3) */}
      <div className="na-edit-check-section">
        <label className="na-edit-check-label">
          <input
            type="checkbox"
            name="override_styleTags"
            value="1"
            checked={checked.styleTags}
            onChange={() => toggle("styleTags")}
          />
          <span>Override style tags (max 3)</span>
          <RevertBtn ov={ov} fieldKey="styleTags" />
        </label>
        {checked.styleTags && (
          <div className="na-edit-checkgroup na-edit-checkgroup--wrap">
            {EDIT_OPTS.styleTags.map((v) => (
              <label key={v} className="na-edit-check-item">
                <input
                  type="checkbox"
                  name="value_styleTags"
                  value={v}
                  defaultChecked={inArr("styleTags", stored.styleTags, v)}
                />
                {v}
              </label>
            ))}
          </div>
        )}
        {Object.hasOwn(ov, "styleTags") && (
          <div className="na-three-val">
            <span className="na-three-val__stored">stored: {stored.styleTags.join(", ") || "—"}</span>
            <span className="na-three-val__arr">→</span>
            <span className="na-three-val__corr">corrected to: {(ov.styleTags as string[]).join(", ") || "(none)"}</span>
          </div>
        )}
      </div>

      {/* Save */}
      <div className="na-edit-footer">
        <button
          type="button"
          className="na-btn na-btn--primary"
          disabled={saveFetcher.state !== "idle"}
          onClick={handleSave}
        >
          {saveFetcher.state !== "idle" ? "Saving…" : "Save corrections"}
        </button>
        {nextUnreviewedId && (
          <button
            type="button"
            className="na-btn na-btn--secondary"
            disabled={saveFetcher.state !== "idle"}
            onClick={handleSaveAndNext}
          >
            {saveFetcher.state !== "idle" ? "Saving…" : "Save & Next"}
          </button>
        )}
        <span className="na-edit-hint">
          Checked fields will be saved as overrides. Unchecked fields revert to stored values.
        </span>
        {saveFetcher.data?.error && (
          <p className="na-teach-error" style={{ marginTop: "0.5rem" }}>
            {saveFetcher.data.error}
          </p>
        )}
        {saveFetcher.data?.ok && (
          <p className="na-teach-ok" style={{ marginTop: "0.5rem" }}>Saved.</p>
        )}
      </div>
    </form>
  );
}

// ── CorrectionsView: read-only summary of active corrections ──────────────────

function CorrectionsView({ overrides }: { overrides: Record<string, unknown> }) {
  return (
    <div className="na-corrections-view">
      <p className="na-corrections-view__title">
        Active corrections ({Object.keys(overrides).length})
      </p>
      {Object.entries(overrides).map(([fieldKey, val]) => (
        <div key={fieldKey} className="na-correction-row">
          <span className="na-correction-row__key">{FIELD_LABELS[fieldKey] ?? fieldKey}</span>
          <span className="na-correction-row__val">{formatFieldValue(fieldKey, val)}</span>
          <RevertBtn ov={overrides} fieldKey={fieldKey} />
        </div>
      ))}
    </div>
  );
}

// ── Small reusable form components ────────────────────────────────────────────

interface EditRowProps {
  fieldKey: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
  hasExisting: boolean;
  revertBtn: React.ReactNode;
  threeVal: React.ReactNode;
  children: React.ReactNode;
}

function EditRow({
  fieldKey, label, checked, onToggle, hasExisting, revertBtn, threeVal, children,
}: EditRowProps) {
  return (
    <div className={`na-edit-row ${hasExisting ? "na-edit-row--overridden" : ""}`}>
      <label className="na-edit-row__check">
        <input
          type="checkbox"
          name={`override_${fieldKey}`}
          value="1"
          checked={checked}
          onChange={onToggle}
        />
        <span className="na-edit-row__label">{label}</span>
      </label>
      {checked && <div className="na-edit-row__input">{children}</div>}
      {threeVal}
      {revertBtn && <div className="na-edit-row__revert">{revertBtn}</div>}
    </div>
  );
}

function VocabSelect({
  name, options, defaultValue, disabled,
}: {
  name: string;
  options: readonly string[];
  defaultValue: string;
  disabled: boolean;
}) {
  return (
    <select name={name} className="na-edit-select" defaultValue={defaultValue} disabled={disabled}>
      <option value="">— none (clear) —</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

function BoolSelect({
  name, defaultValue, disabled,
}: {
  name: string;
  defaultValue: string;
  disabled: boolean;
}) {
  return (
    <select name={name} className="na-edit-select" defaultValue={defaultValue} disabled={disabled}>
      <option value="">— none (clear) —</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>
  );
}

// VocabGapToggle is defined at module level (not nested) because it calls useFetcher.
function VocabGapToggle({ itemId, adminNotes }: { itemId: string; adminNotes: string | null }) {
  const isSet = (adminNotes ?? "").startsWith("[VOCAB_GAP]");
  const existingNote = isSet ? (adminNotes ?? "").replace("[VOCAB_GAP]", "").trim() : "";
  const [showInput, setShowInput] = useState(false);
  const flagFetcher = useFetcher<{ ok?: boolean; error?: string }>();

  return (
    <div className="na-vocab-gap">
      {isSet ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span className="na-badge na-badge--vocab-gap">Needs vocabulary update</span>
          {existingNote && (
            <span style={{ fontSize: "12px", color: "#6b7280" }}>{existingNote}</span>
          )}
          <button
            type="button"
            className="na-btn-revert"
            disabled={flagFetcher.state !== "idle"}
            onClick={() =>
              flagFetcher.submit(
                { intent: "clear-vocab-gap" },
                { method: "post", action: `/admin/naia/closet/${itemId}` },
              )
            }
          >
            Clear flag
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="na-btn na-btn--outline"
            style={{ fontSize: "12px", padding: "0.3rem 0.75rem" }}
            onClick={() => setShowInput((v) => !v)}
          >
            {showInput ? "Cancel" : "⚑ Needs vocabulary update"}
          </button>
          {showInput && (
            <flagFetcher.Form
              method="post"
              action={`/admin/naia/closet/${itemId}`}
              style={{ marginTop: "0.5rem", display: "flex", gap: "0.5rem", alignItems: "flex-start" }}
            >
              <input type="hidden" name="intent" value="flag-vocab-gap" />
              <textarea
                name="vocabNote"
                className="na-edit-input"
                placeholder="e.g. scoop neckline not in vocabulary (optional)"
                rows={2}
                style={{ flex: 1, resize: "vertical" }}
              />
              <button type="submit" className="na-btn na-btn--primary" style={{ fontSize: "12px" }}>
                Flag it
              </button>
            </flagFetcher.Form>
          )}
        </>
      )}
      {flagFetcher.data?.error && (
        <p className="na-teach-error">{flagFetcher.data.error}</p>
      )}
    </div>
  );
}

// RevertBtn is defined at module level (not nested inside EditClassificationPanel) so that
// useFetcher is a proper component-level hook call. Rendering <Form> inside the outer save
// form would produce invalid nested <form> HTML, silently breaking the outer form's submit.
function RevertBtn({ ov, fieldKey }: { ov: Record<string, unknown>; fieldKey: string }) {
  const revertFetcher = useFetcher();
  if (!Object.hasOwn(ov, fieldKey)) return null;
  return (
    <button
      type="button"
      className="na-btn-revert"
      onClick={() =>
        revertFetcher.submit(
          { intent: "revert-field", fieldKey },
          { method: "post" },
        )
      }
    >
      Revert
    </button>
  );
}
