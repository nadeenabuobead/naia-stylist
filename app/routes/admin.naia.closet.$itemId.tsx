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

import React, { useState, useRef, useEffect } from "react";
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
  saveIntelligenceOverrides,
  revertIntelligenceField,
  type ClosetItemOverrides,
  type ClosetItemFields,
  type IntelligenceOverrides,
} from "~/lib/admin/closet-review.server";
import {
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
} from "~/lib/cloudinary-admin.server";
import {
  deriveGarmentStylingIntelligence,
  type GarmentStylingIntelligence,
  type SignalSource,
  type SignalPolarity,
  type IntentionStrength,
} from "~/lib/admin/garment-intelligence-v1.server";

// Inline — cannot import ALL_INTENTIONS from .server module into client components
const ALL_INTENTIONS = [
  "feel-like-myself", "confidence", "ground-me", "give-structure",
  "make-it-easy", "feel-put-together", "feel-attractive", "give-energy",
  "feel-softer", "feel-sharper", "feel-less-exposed", "express-myself",
] as const;

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
    getAdjacentItemIds(itemId, item.customerId),
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
  // V6 safety: coveragePreferences is legacy/hidden for Rev6; do not feed it to Phase 3C for V6 customers
  const passportForIntelligence = passportContext && passportContext.profileVersion != null && passportContext.profileVersion >= 6
    ? { ...passportContext, coveragePreferences: [] }
    : passportContext;
  const stylingIntelligence = deriveGarmentStylingIntelligence(effectiveClassification, passportForIntelligence);

  const intelligenceOverrides = (item.adminReview?.intelligenceOverrides ?? null) as IntelligenceOverrides | null;

  return Response.json({ item, effectiveClassification, garmentImageUrl, interpretation, stylingIntelligence, intelligenceOverrides, passportContext, returnTo, nextUnreviewedId, prevItemId, nextItemId });
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

  if (intent === "save-intelligence-overrides") {
    const raw = formData.get("overrides");
    if (typeof raw !== "string") return Response.json({ error: "Missing overrides" }, { status: 400 });
    let partial: Partial<IntelligenceOverrides>;
    try { partial = JSON.parse(raw); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
    await saveIntelligenceOverrides(itemId, partial, reviewedBy);
    return Response.json({ ok: true });
  }

  if (intent === "revert-intelligence-field") {
    const fieldPath = formData.get("fieldPath");
    if (typeof fieldPath !== "string") return Response.json({ error: "Missing fieldPath" }, { status: 400 });
    await revertIntelligenceField(itemId, fieldPath, reviewedBy);
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
  const storedRec = stored as unknown as Record<string, unknown>;
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

// ── Passport label helpers ────────────────────────────────────────────────────

const PASSPORT_LABELS: Record<string, Record<string, string>> = {
  stylePersonalities: {
    "classic-polished": "Classic & Polished",
    "feminine-romantic": "Feminine & Romantic",
    "minimal-relaxed": "Minimal & Relaxed",
    "bold-edgy": "Bold & Edgy",
    "creative-expressive": "Creative & Expressive",
    "effortlessly-chic": "Effortlessly Chic",
    "sporty-active": "Sporty & Active",
    "bohemian": "Bohemian",
    "preppy": "Preppy",
    "streetwear": "Streetwear",
  },
  lifestyle: {
    "work-office": "Work / Office",
    "casual-everyday": "Casual / Everyday",
    "events-occasions": "Events / Occasions",
    "active-sporty": "Active / Sporty",
    "travel": "Travel",
    "home-relaxed": "Home / Relaxed",
  },
  desiredFeelings: {
    "feel-like-myself": "Feel like myself",
    "feel-put-together": "Feel put-together",
    "feel-confident": "Feel confident",
    "feel-attractive": "Feel attractive",
    "feel-comfortable": "Feel comfortable",
    "feel-energised": "Feel energised",
    "feel-less-exposed": "Feel less exposed",
    "feel-sharper": "Feel sharper",
    "feel-softer": "Feel softer",
    "express-myself": "Express myself",
    "give-energy": "Give me energy",
    "give-structure": "Give me structure",
    "ground-me": "Ground me",
    "make-it-easy": "Make it easy",
  },
  dressingPreferences: {
    "dresses-modestly": "I dress modestly",
    "usually-wears-abayas": "I wear abayas",
    "wears-hijab": "I wear hijab",
    "arms-covered": "Arms covered",
    "chest-neckline-covered": "Chest / neckline covered",
    "legs-covered": "Legs covered",
    "longer-tops": "Longer tops",
    "no-cropped-tops": "No cropped tops",
    "looser-fitting": "Looser fitting",
  },
  fitPreferences: {
    "fitted": "Fitted",
    "relaxed": "Relaxed",
    "oversized": "Oversized",
    "tailored": "Tailored",
    "flowy": "Flowy",
    "structured": "Structured",
  },
  coveragePreferences: {
    "more-coverage": "More coverage",
    "shoulder-coverage": "Shoulder coverage",
    "modest-neckline": "Modest neckline",
    "longer-hemline": "Longer hemline",
    "sleeve-coverage": "Sleeve coverage",
  },
  silhouette: {
    "fitted": "Fitted",
    "a-line": "A-line",
    "straight": "Straight",
    "oversized": "Oversized",
    "flared": "Flared",
    "wrap": "Wrap",
    "column": "Column",
  },
  styleSupport: {
    "build-a-wardrobe": "Build a wardrobe",
    "find-my-style": "Find my style",
    "shop-smarter": "Shop smarter",
    "feel-more-confident": "Feel more confident",
    "dress-for-occasion": "Dress for occasions",
    "sustainable-choices": "Make sustainable choices",
  },
  successfulOutfitGives: {
    "feel-like-myself": "Feel like myself",
    "confidence": "Confidence",
    "feel-put-together": "Feel put-together",
    "comfort-ease": "Comfort & ease",
    "sense-of-expression": "Sense of expression",
    "feel-attractive": "Feel attractive",
    "sense-of-power": "Sense of power",
    "effortlessness": "Effortlessness",
    "not-sure": "Not sure",
  },
};

function passportLabel(field: string, id: string): string {
  return PASSPORT_LABELS[field]?.[id] ?? id.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Customer Passport Card ────────────────────────────────────────────────────

function CustomerPassportCard({ ctx }: { ctx: CustomerStylingPassportContext | null }) {
  if (!ctx) {
    return (
      <div className="na-card">
        <div className="na-card__header">
          <h2 className="na-card__title">Customer Passport Context</h2>
          <span className="na-badge na-badge--not-analyzed">A — CUSTOMER-SUPPLIED</span>
        </div>
        <div className="na-card__body">
          <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>No Passport on file for this customer.</p>
        </div>
      </div>
    );
  }

  // V6 = explicit version flag OR V6-only fields present (guards against null profileVersion for pre-tracking completions)
  const isV6 = (ctx.profileVersion != null && ctx.profileVersion >= 6) || ctx.successfulOutfitGives.length > 0 || ctx.currentGoal.length > 0;

  const v6Rows: Array<{ label: string; values: string[]; field: string }> = [
    { label: "Current Focus", field: "currentGoal", values: ctx.currentGoal },
    { label: "What Makes an Outfit Work", field: "successfulOutfitGives", values: ctx.successfulOutfitGives },
    { label: "Style", field: "stylePersonalities", values: ctx.stylePersonalities },
    { label: "Lifestyle", field: "lifestyle", values: ctx.lifestyle },
    { label: "Favourite Colours", field: "favoriteColors", values: ctx.favoriteColors },
    { label: "Avoid Colours", field: "avoidColors", values: ctx.avoidColors },
    { label: "Silhouette", field: "silhouette", values: ctx.silhouette },
    { label: "Fit Concerns", field: "fitConcerns", values: ctx.fitConcerns },
    { label: "Dressing Requirements", field: "dressingPreferences", values: ctx.dressingPreferences },
  ].filter(r => r.values.length > 0);

  const textFields = isV6 ? (
    [
      ctx.fitConcernsNote ? { label: "Fit Note", value: ctx.fitConcernsNote } : null,
      ctx.finalNotes ? { label: "Notes to nAia", value: ctx.finalNotes } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>
  ) : [];

  const legacyRows: Array<{ label: string; values: string[]; field: string }> = isV6 ? [] : [
    { label: "Desired feelings", field: "desiredFeelings", values: ctx.desiredFeelings },
    { label: "Coverage preferences", field: "coveragePreferences", values: ctx.coveragePreferences },
    { label: "Fit preferences", field: "fitPreferences", values: ctx.fitPreferences },
    { label: "Style support goal", field: "styleSupport", values: ctx.styleSupport },
  ].filter(r => r.values.length > 0);

  const chipStyle: React.CSSProperties = {
    fontSize: "0.7rem",
    color: "#93c5fd",
    background: "#0c1a2e",
    border: "1px solid #1e3a5f",
    padding: "0.1rem 0.5rem",
    borderRadius: "4px",
  };

  const legacyChipStyle: React.CSSProperties = {
    fontSize: "0.7rem",
    color: "#6b7280",
    background: "#111827",
    border: "1px solid #374151",
    padding: "0.1rem 0.5rem",
    borderRadius: "4px",
  };

  const hasAnyData = v6Rows.length > 0 || textFields.length > 0 || legacyRows.length > 0;

  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Customer Passport Context</h2>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {isV6 && (
            <span style={{ fontSize: "0.6rem", background: "#052e16", color: "#86efac", border: "1px solid #166534", borderRadius: "3px", padding: "0.05rem 0.35rem", fontFamily: "monospace" }}>
              V6
            </span>
          )}
          <span className="na-badge na-badge--not-analyzed" style={{ background: "#0c1a2e", color: "#93c5fd", borderColor: "#1e3a5f" }}>
            A — CUSTOMER-SUPPLIED
          </span>
        </div>
      </div>
      <div className="na-card__body">
        <p style={{ fontSize: "0.65rem", color: "#4b5563", marginBottom: "1rem" }}>
          Facts and preferences this customer supplied. Not inferred by nAia.
        </p>
        {!hasAnyData ? (
          <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>Passport exists but no styling fields are filled in yet.</p>
        ) : (
          <table className="na-field-table">
            <tbody>
              {v6Rows.map(row => (
                <tr key={row.label}>
                  <th style={{ whiteSpace: "nowrap", verticalAlign: "top", paddingTop: "0.4rem" }}>{row.label}</th>
                  <td>
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      {row.values.map(v => (
                        <span key={v} style={chipStyle}>{passportLabel(row.field, v)}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {textFields.map(f => (
                <tr key={f.label}>
                  <th style={{ whiteSpace: "nowrap", verticalAlign: "top", paddingTop: "0.4rem" }}>{f.label}</th>
                  <td style={{ fontSize: "0.78rem", color: "#d1d5db" }}>{f.value}</td>
                </tr>
              ))}
              {legacyRows.length > 0 && (
                <tr>
                  <td colSpan={2} style={{ paddingTop: "0.75rem", paddingBottom: "0.25rem" }}>
                    <span style={{ fontSize: "0.6rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", background: "#1f2937", border: "1px solid #374151", padding: "0.1rem 0.4rem", borderRadius: "3px" }}>
                      LEGACY
                    </span>
                  </td>
                </tr>
              )}
              {legacyRows.map(row => (
                <tr key={row.label}>
                  <th style={{ whiteSpace: "nowrap", verticalAlign: "top", paddingTop: "0.4rem", color: "#6b7280" }}>{row.label}</th>
                  <td>
                    <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                      {row.values.map(v => (
                        <span key={v} style={legacyChipStyle}>{passportLabel(row.field, v)}</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Signal source badge ───────────────────────────────────────────────────────

const SOURCE_STYLE: Record<SignalSource, { color: string; bg: string; border: string; label: string }> = {
  passport: { color: "#93c5fd", bg: "#0c1a2e", border: "#1e3a5f", label: "passport" },
  garment:  { color: "#9ca3af", bg: "#1f2937", border: "#374151", label: "garment" },
};

const CONFLICT_STYLE = { color: "#fca5a5", bg: "#1f0707", border: "#7f1d1d", label: "conflict" };

const STRENGTH_STYLE: Record<IntentionStrength, { color: string; bg: string; border: string } | null> = {
  strong:     { color: "#a3e635", bg: "#0d1f00", border: "#3f6212" },
  supporting: { color: "#fbbf24", bg: "#1c1200", border: "#78350f" },
  none:       null,
};

function SignalBadge({ source, polarity }: { source: SignalSource; polarity: SignalPolarity }) {
  const s = polarity === "conflict" ? CONFLICT_STYLE : SOURCE_STYLE[source];
  return (
    <span style={{
      fontSize: "0.58rem",
      color: s.color,
      background: s.bg,
      border: `1px solid ${s.border}`,
      padding: "0.05rem 0.35rem",
      borderRadius: "3px",
      fontFamily: "monospace",
      letterSpacing: "0.04em",
      flexShrink: 0,
    }}>
      {s.label}
    </span>
  );
}

function StrengthBadge({ strength }: { strength: IntentionStrength }) {
  const s = STRENGTH_STYLE[strength];
  if (!s) return null;
  return (
    <span style={{
      fontSize: "0.58rem",
      color: s.color,
      background: s.bg,
      border: `1px solid ${s.border}`,
      padding: "0.05rem 0.35rem",
      borderRadius: "3px",
      fontFamily: "monospace",
      letterSpacing: "0.04em",
      flexShrink: 0,
    }}>
      {strength}
    </span>
  );
}

// ── Intelligence Edit Panel ───────────────────────────────────────────────────

const HUE_FAMILY_OPTIONS = ["red","pink","orange","yellow","green","blue","purple","grey","brown"] as const;
const ENERGY_TIER_OPTIONS = ["high-energy","deep-authoritative","mid-range","neutral-versatile"] as const;
const VISUAL_WEIGHT_OPTIONS = ["light","medium","substantial"] as const;
const STRENGTH_OPTIONS: IntentionStrength[] = ["strong","supporting","none"];

const ENERGY_TIER_LABELS: Record<string, string> = {
  "neutral-versatile": "Quiet / versatile",
  "mid-range": "Moderate",
  "deep-authoritative": "Deep / strong",
  "high-energy": "Bright / energetic",
};

const STRENGTH_DISPLAY_LABELS: Record<string, string> = {
  "strong": "Strong match",
  "supporting": "Helps",
  "none": "Doesn't help",
};

function IntelligenceEditPanel({
  intel,
  existing,
  itemId,
  onClose,
}: {
  intel: GarmentStylingIntelligence;
  existing: IntelligenceOverrides | null;
  itemId: string;
  onClose: () => void;
}) {
  // Local state mirrors the overrides — null means "use nAia"
  const [vw, setVw] = useState<string>(existing?.visualWeight ?? "__naia__");

  const cp = existing?.colourProfile ?? {};
  const [hue, setHue] = useState<string>(
    "hueFamily" in cp ? (cp.hueFamily ?? "__null__") : "__naia__",
  );
  const [wn, setWn] = useState<string>(
    "wardrobeNeutral" in cp ? String(cp.wardrobeNeutral) : "__naia__",
  );
  const [ld, setLd] = useState<string>(
    "lightDark" in cp ? (cp.lightDark ?? "__null__") : "__naia__",
  );
  const [et, setEt] = useState<string>(
    "energyTier" in cp ? (cp.energyTier ?? "__null__") : "__naia__",
  );

  const intOv = existing?.intentions ?? {};
  const [intentStrengths, setIntentStrengths] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const id of ALL_INTENTIONS) {
      init[id] = id in intOv ? (intOv[id] ?? "__null__") as string : "__naia__";
    }
    return init;
  });

  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const hasSubmitted = useRef(false);

  useEffect(() => {
    if (hasSubmitted.current && fetcher.state === "idle" && fetcher.data?.ok) {
      hasSubmitted.current = false;
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);

  function handleSave() {
    // Build partial overrides — only include keys that are NOT "__naia__"
    const partial: Partial<IntelligenceOverrides> = {};

    if (vw !== "__naia__") partial.visualWeight = vw as IntelligenceOverrides["visualWeight"];

    const cpPartial: IntelligenceOverrides["colourProfile"] = {};
    let hasCp = false;
    if (hue !== "__naia__") { cpPartial.hueFamily = hue === "__null__" ? null : hue as "red"; hasCp = true; }
    if (wn !== "__naia__") { cpPartial.wardrobeNeutral = wn === "true"; hasCp = true; }
    if (ld !== "__naia__") { cpPartial.lightDark = ld === "__null__" ? null : ld as "light" | "dark"; hasCp = true; }
    if (et !== "__naia__") { cpPartial.energyTier = et === "__null__" ? null : et as "high-energy" | "deep-authoritative" | "mid-range" | "neutral-versatile"; hasCp = true; }
    if (hasCp) partial.colourProfile = cpPartial;

    const intentPartial: IntelligenceOverrides["intentions"] = {};
    let hasIntent = false;
    for (const id of ALL_INTENTIONS) {
      if (intentStrengths[id] !== "__naia__") {
        intentPartial[id] = intentStrengths[id] as IntentionStrength;
        hasIntent = true;
      }
    }
    if (hasIntent) partial.intentions = intentPartial;

    hasSubmitted.current = true;
    fetcher.submit(
      { intent: "save-intelligence-overrides", overrides: JSON.stringify(partial) },
      { method: "post", action: `/admin/naia/closet/${itemId}` },
    );
  }

  const selStyle: React.CSSProperties = {
    fontSize: "0.75rem",
    background: "#111827",
    border: "1px solid #374151",
    borderRadius: "4px",
    color: "#e5e7eb",
    padding: "0.2rem 0.4rem",
    minWidth: "160px",
  };

  return (
    <div style={{ background: "#0d1117", border: "1px solid #374151", borderRadius: "6px", padding: "1rem", marginTop: "0.75rem" }}>

      <p className="na-edit-group-title" style={{ marginBottom: "0.75rem" }}>Visual Weight</p>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <select value={vw} onChange={e => setVw(e.target.value)} style={selStyle}>
          <option value="__naia__">Use nAia's answer (currently: {intel.visualWeight.value ?? "—"})</option>
          {VISUAL_WEIGHT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      <p className="na-edit-group-title" style={{ marginBottom: "0.5rem" }}>Colour Profile</p>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.4rem 0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Colour family</span>
        <select value={hue} onChange={e => setHue(e.target.value)} style={selStyle}>
          <option value="__naia__">Use nAia's answer (currently: {intel.colourProfile.hueFamily ?? "—"})</option>
          <option value="__null__">No result / Unknown</option>
          {HUE_FAMILY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Works as a neutral?</span>
        <select value={wn} onChange={e => setWn(e.target.value)} style={selStyle}>
          <option value="__naia__">Use nAia's answer (currently: {intel.colourProfile.wardrobeNeutral ? "Yes" : "No"})</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
        <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Colour depth</span>
        <select value={ld} onChange={e => setLd(e.target.value)} style={selStyle}>
          <option value="__naia__">Use nAia's answer (currently: {intel.colourProfile.lightDark ?? "—"})</option>
          <option value="__null__">No result / Unknown</option>
          <option value="light">light</option>
          <option value="dark">dark</option>
        </select>
        <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>Colour impact</span>
        <select value={et} onChange={e => setEt(e.target.value)} style={selStyle}>
          <option value="__naia__">Use nAia's answer (currently: {ENERGY_TIER_LABELS[intel.colourProfile.energyTier ?? ""] ?? intel.colourProfile.energyTier ?? "—"})</option>
          <option value="__null__">No result / Unknown</option>
          <option value="neutral-versatile">Quiet / versatile</option>
          <option value="mid-range">Moderate</option>
          <option value="deep-authoritative">Deep / strong</option>
          <option value="high-energy">Bright / energetic</option>
        </select>
      </div>

      <p className="na-edit-group-title" style={{ marginBottom: "0.35rem" }}>Intention Strengths</p>
      <div style={{ fontSize: "0.65rem", color: "#6b7280", marginBottom: "0.75rem", lineHeight: 1.6 }}>
        <span style={{ color: "#a3e635" }}>Strong match</span> = this piece meaningfully supports this goal{" · "}
        <span style={{ color: "#fbbf24" }}>Helps</span> = contributes, but outfit/context still matters{" · "}
        <span style={{ color: "#6b7280" }}>Doesn't help</span> = not meaningful for this goal{" · "}
        <span style={{ color: "#9ca3af" }}>Use nAia's answer</span> = keep nAia's derived result
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "0.3rem 0.75rem", alignItems: "center", marginBottom: "1rem" }}>
        {ALL_INTENTIONS.map(id => {
          const derived = intel.intentionPotentials.find(ip => ip.intention === id)?.strength ?? "none";
          return (
            <React.Fragment key={id}>
              <span style={{ fontSize: "0.7rem", color: "#9ca3af", fontFamily: "monospace" }}>{id}</span>
              <select
                value={intentStrengths[id]}
                onChange={e => setIntentStrengths(prev => ({ ...prev, [id]: e.target.value }))}
                style={selStyle}
              >
                <option value="__naia__">Use nAia's answer (currently: {STRENGTH_DISPLAY_LABELS[derived] ?? derived})</option>
                <option value="strong">Strong match</option>
                <option value="supporting">Helps</option>
                <option value="none">Doesn't help</option>
              </select>
            </React.Fragment>
          );
        })}
      </div>

      {fetcher.data?.error && (
        <p style={{ fontSize: "0.75rem", color: "#f87171", marginBottom: "0.5rem" }}>{fetcher.data.error}</p>
      )}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="button"
          onClick={handleSave}
          className="na-btn na-btn--primary"
          disabled={fetcher.state !== "idle"}
        >
          {fetcher.state !== "idle" ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onClose} className="na-btn na-btn--outline">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Deeper Styling Intelligence ───────────────────────────────────────────────

function DeeperStylingIntelligence({
  intel,
  intelligenceOverrides,
  itemId,
}: {
  intel: GarmentStylingIntelligence;
  intelligenceOverrides: IntelligenceOverrides | null;
  itemId: string;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const revertFetcher = useFetcher<{ ok?: boolean }>();

  const ov = intelligenceOverrides;
  const passportBadge = intel.passportUsed ? "SHADOW · V2 · PASSPORT-AWARE" : "SHADOW · V2 · NO PASSPORT";

  // Compute effective values (override wins over derived)
  const vw = intel.visualWeight;
  const cp = intel.colourProfile;
  const cpOv = ov?.colourProfile ?? {};

  const effVW: string | null = ov && "visualWeight" in ov ? ov.visualWeight ?? null : vw.value;
  const effHue: string | null = "hueFamily" in cpOv ? (cpOv.hueFamily ?? null) : cp.hueFamily;
  const effWN: boolean = "wardrobeNeutral" in cpOv ? Boolean(cpOv.wardrobeNeutral) : cp.wardrobeNeutral;
  const effLD: string | null = "lightDark" in cpOv ? (cpOv.lightDark ?? null) : cp.lightDark;
  const effET: string | null = "energyTier" in cpOv ? (cpOv.energyTier ?? null) : cp.energyTier;

  const intOv = ov?.intentions ?? {};

  function revertField(fieldPath: string) {
    revertFetcher.submit(
      { intent: "revert-intelligence-field", fieldPath },
      { method: "post", action: `/admin/naia/closet/${itemId}` },
    );
  }

  function EditedBadge({ fieldPath }: { fieldPath: string }) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
        <span style={{ fontSize: "0.6rem", background: "#2d1a5e", color: "#a78bfa", border: "1px solid #4c1d95", borderRadius: "3px", padding: "0.05rem 0.3rem", fontFamily: "monospace" }}>
          EDITED
        </span>
        <button
          type="button"
          onClick={() => revertField(fieldPath)}
          style={{ fontSize: "0.6rem", color: "#6b7280", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
        >
          Reset to nAia
        </button>
      </span>
    );
  }

  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Garment Intelligence</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className="na-badge na-badge--ai-only" style={{ fontSize: "0.65rem" }}>
            {passportBadge}
          </span>
          <button
            type="button"
            onClick={() => setShowEdit(v => !v)}
            className="na-btn na-btn--outline"
            style={{ fontSize: "0.7rem", padding: "0.2rem 0.6rem" }}
          >
            {showEdit ? "Close" : "Edit intelligence"}
          </button>
        </div>
      </div>

      {showEdit && (
        <div className="na-card__body" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <IntelligenceEditPanel
            intel={intel}
            existing={ov}
            itemId={itemId}
            onClose={() => setShowEdit(false)}
          />
        </div>
      )}

      <div className="na-card__body" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

        {/* ─── B. GARMENT INTELLIGENCE (intrinsic / generic) ─── */}
        <div>
          <p className="na-provenance-label" style={{ marginBottom: "0.75rem" }}>
            B — GARMENT INTELLIGENCE
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* Visual Weight */}
            <div>
              <p style={{ fontSize: "0.65rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.35rem" }}>Visual Weight</p>
              {effVW ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span
                      className="na-interp-label"
                      style={{ backgroundColor: (VISUAL_WEIGHT_COLOUR[effVW] ?? "#374151") + "20", color: VISUAL_WEIGHT_COLOUR[effVW] ?? "#9ca3af", borderColor: (VISUAL_WEIGHT_COLOUR[effVW] ?? "#374151") + "40" }}
                    >
                      {effVW}
                    </span>
                    {ov && "visualWeight" in ov && <EditedBadge fieldPath="visualWeight" />}
                  </div>
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
              {cp.evidence.length > 0 || ov?.colourProfile ? (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                    {effWN && effHue ? (
                      <span className="na-interp-label">{effHue} neutral</span>
                    ) : effWN ? (
                      <span className="na-interp-label">neutral</span>
                    ) : effHue ? (
                      <span className="na-interp-label">{effHue}</span>
                    ) : null}
                    {effLD && <span className="na-interp-label">{effLD}</span>}
                    {effET && (
                      <span
                        className="na-interp-label"
                        style={{ backgroundColor: ENERGY_TIER_COLOUR[effET] + "20", color: ENERGY_TIER_COLOUR[effET], borderColor: ENERGY_TIER_COLOUR[effET] + "40" }}
                      >
                        {effET}
                      </span>
                    )}
                    {/* Edited badges for colour profile fields */}
                    {"hueFamily" in cpOv && <EditedBadge fieldPath="colourProfile.hueFamily" />}
                    {"lightDark" in cpOv && <EditedBadge fieldPath="colourProfile.lightDark" />}
                    {"energyTier" in cpOv && <EditedBadge fieldPath="colourProfile.energyTier" />}
                    {"wardrobeNeutral" in cpOv && <EditedBadge fieldPath="colourProfile.wardrobeNeutral" />}
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

        {/* ─── C. PASSPORT-AWARE STYLING POTENTIAL ─── */}
        <div>
          <p className="na-provenance-label" style={{ marginBottom: "0.75rem" }}>
            C — PASSPORT-AWARE STYLING POTENTIAL
          </p>
          <p style={{ fontSize: "0.65rem", color: "#4b5563", marginBottom: "0.75rem" }}>
            What this garment could do for this customer specifically. Shadow-only — not final StyleMe reasoning.
          </p>

          {/* No passport state */}
          {!intel.passportUsed && (
            <div style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem", background: "#111827", borderRadius: "6px", border: "1px solid #374151" }}>
              <p style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                No passport — showing garment-only baseline
              </p>
            </div>
          )}

          {/* All 12 intentions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "0.75rem" }}>
            {intel.intentionPotentials.map(ip => {
              const isOverridden = ip.intention in intOv;
              const effStrength: IntentionStrength = isOverridden
                ? ((intOv[ip.intention] as IntentionStrength) ?? "none")
                : ip.strength;
              const borderColour = effStrength === "strong" ? "#3f6212" : effStrength === "supporting" ? "#78350f" : "#374151";
              return (
                <div key={ip.intention} style={{ borderLeft: `2px solid ${borderColour}`, paddingLeft: "0.75rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#d1d5db", fontFamily: "monospace" }}>
                      {ip.intention}
                    </span>
                    <StrengthBadge strength={effStrength} />
                    {isOverridden && <EditedBadge fieldPath={`intentions.${ip.intention}`} />}
                  </div>
                  {ip.signalDetails.length === 0 ? (
                    <span style={{ fontSize: "0.7rem", color: "#4b5563" }}>none</span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                      {ip.signalDetails.map((sd, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                          <span style={{ fontSize: "0.7rem", color: sd.polarity === "conflict" ? "#fca5a5" : "#9ca3af" }}>
                            {sd.text}
                          </span>
                          <SignalBadge source={sd.source} polarity={sd.polarity} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <p style={{ fontSize: "0.65rem", color: "#4b5563", borderTop: "1px solid #1f2937", paddingTop: "0.75rem" }}>
          Shadow-only · V2 · Not wired to StyleMe · Not final StyleMe reasoning
        </p>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ClosetItemDetailPage() {
  const { item, effectiveClassification, garmentImageUrl, interpretation, stylingIntelligence, intelligenceOverrides, passportContext, returnTo, nextUnreviewedId, prevItemId, nextItemId } =
    useLoaderData() as {
      item: ClosetItemDetail;
      effectiveClassification: ClosetClassification;
      garmentImageUrl: string | null;
      interpretation: GarmentInterpretation;
      stylingIntelligence: GarmentStylingIntelligence;
      intelligenceOverrides: IntelligenceOverrides | null;
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
              SECTION A — CUSTOMER PASSPORT CONTEXT
          ════════════════════════════════════════════ */}
          <CustomerPassportCard ctx={passportContext} />

          {/* ════════════════════════════════════════════
              SECTION B+C — GARMENT INTELLIGENCE + PASSPORT-AWARE STYLING POTENTIAL
          ════════════════════════════════════════════ */}
          <DeeperStylingIntelligence intel={stylingIntelligence} intelligenceOverrides={intelligenceOverrides} itemId={item.id} />

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
