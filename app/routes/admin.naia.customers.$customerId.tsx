// app/routes/admin.naia.customers.$customerId.tsx
//
// nAia Admin — Customer detail.
// Read-only. "What does nAia think it knows about this person?"
//
// Sections:
//   A. Identity (name, email, plan, joined)
//   B. Customer Passport (customer-supplied preferences)
//   C. Closet Summary (garment counts, category breakdown, link to closet)
//   D. Buy / Skip Uploads (submission history — explicitly NOT Closet ownership)
//
// Auth: requireAdminSession.

import { useState } from "react";
import { Link, useLoaderData, useFetcher } from "react-router";
import { data, type LoaderFunctionArgs, type ActionFunctionArgs } from "react-router";
import prisma from "~/db.server";
import { requireAdminSession } from "~/lib/internal-auth.server";
import { splitStyleExpression } from "~/lib/passport/rev7-vocabulary";
import {
  getAdminCustomerDetail,
  type AdminCustomerDetail,
  type CustomerStylingPassportContext,
} from "~/lib/admin/closet-intelligence.server";
import {
  getAdminCustomerBuySkipUploads,
  type AdminBuySkipUploadSummary,
} from "~/lib/admin/buyskip-admin.server";
import {
  getAdminCustomerClosetGallery,
  getAdminCustomerStyleMeSessions,
  getAdminCustomerNoticingFeedback,
  getAdminCustomerTrendEditUsage,
  getAdminCustomerVtoHistory,
  getAdminCustomerActivity,
  getAdminCustomerStrongestTendency,
  getAdminCustomerLifetimeUsage,
  type AdminClosetGalleryItem,
  type AdminStyleMeSessionSummary,
  type AdminNoticingObservation,
  type AdminTrendEditUsageRow,
  type AdminNaiaModelSummary,
  type AdminVtoJobSummary,
  type AdminActivityEvent,
  type AdminStrongestTendencySummary,
  type AdminLifetimeUsage,
} from "~/lib/admin/customer-360.server";
import { getEntitlementSummary, type EntitlementSummary } from "~/lib/plan/entitlement.server";
import type { MembershipStatus } from "@prisma/client";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminSession(request);
  const { customerId } = params;
  if (!customerId) throw new Response("Not found", { status: 404 });
  const customer = await getAdminCustomerDetail(customerId);
  if (!customer) throw new Response("Customer not found", { status: 404 });

  // Read separately and defensively: the column arrives with the Wardrobe
  // Intelligence migration, and this page must not break before it runs.
  let accountType = "CUSTOMER";
  try {
    const row = await (prisma as unknown as {
      customer: { findUnique(a: unknown): Promise<{ accountType: string } | null> };
    }).customer.findUnique({ where: { id: customerId }, select: { accountType: true } });
    accountType = row?.accountType ?? "CUSTOMER";
  } catch {
    accountType = "CUSTOMER";
  }

  const buySkipUploads = await getAdminCustomerBuySkipUploads(customerId);

  // Additional tabs — Closet gallery, StyleMe, Learning & Feedback, Trend
  // Edits, VTO/Model, Activity, Membership & Usage. Each is its own
  // read-only fetcher (see customer-360.server.ts); none of this duplicates
  // or rewrites what closet-intelligence.server.ts / buyskip-admin.server.ts
  // already compute above.
  const [
    closetGallery,
    styleMeSessions,
    noticingFeedback,
    trendEditUsage,
    vtoHistory,
    activity,
    strongestTendency,
    lifetimeUsage,
  ] = await Promise.all([
    getAdminCustomerClosetGallery(customerId),
    getAdminCustomerStyleMeSessions(customerId),
    getAdminCustomerNoticingFeedback(customerId),
    getAdminCustomerTrendEditUsage(customerId),
    getAdminCustomerVtoHistory(customerId),
    getAdminCustomerActivity(customerId),
    getAdminCustomerStrongestTendency(customerId),
    getAdminCustomerLifetimeUsage(customerId),
  ]);

  const entitlement = await getEntitlementSummary(customerId, customer.membershipStatus as MembershipStatus);

  return Response.json({
    customer,
    accountType,
    buySkipUploads,
    closetGallery,
    styleMeSessions,
    noticingFeedback,
    trendEditUsage,
    vtoHistory,
    activity,
    strongestTendency,
    lifetimeUsage,
    entitlement,
  });
}

/** The account types an operator may set. */
const ACCOUNT_TYPES = ["CUSTOMER", "TEST", "DEMO", "QA"] as const;

/**
 * Marking an account as ours.
 *
 * Deliberately a written column rather than an email-pattern rule: patterns
 * drift, and the day one stops matching is the day test activity starts
 * counting as customer demand. Owner-only, because misclassifying a real
 * customer silently removes them from every aggregate.
 */
export async function action({ request, params }: ActionFunctionArgs) {
  const session = await requireAdminSession(request);
  if (session.identity.role !== "owner") {
    return data({ ok: false, error: "Only an owner can change an account type." }, { status: 403 });
  }

  const { customerId } = params;
  if (!customerId) return data({ ok: false, error: "Missing customer." }, { status: 400 });

  const form = await request.formData();
  const next = String(form.get("accountType") ?? "");
  if (!ACCOUNT_TYPES.includes(next as (typeof ACCOUNT_TYPES)[number])) {
    return data({ ok: false, error: "Unknown account type." }, { status: 400 });
  }

  await (prisma as unknown as { customer: { update(a: unknown): Promise<unknown> } }).customer.update({
    where: { id: customerId },
    data: { accountType: next },
  });

  return data({ ok: true, accountType: next });
}

// ── Label maps (same as closet detail page) ────────────────────────────────

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

function displayDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function customerDisplayName(c: AdminCustomerDetail): string {
  if (c.firstName || c.lastName) return [c.firstName, c.lastName].filter(Boolean).join(" ");
  if (c.email) return c.email;
  return c.id.slice(0, 8);
}

// ── Components ─────────────────────────────────────────────────────────────

function PassportSection({ ctx }: { ctx: CustomerStylingPassportContext | null }) {
  if (!ctx) {
    return (
      <div className="na-card">
        <div className="na-card__header">
          <h2 className="na-card__title">Passport</h2>
          <span className="na-badge na-badge--not-analyzed">A — CUSTOMER-SUPPLIED</span>
        </div>
        <div className="na-card__body">
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>No Passport on file for this customer.</p>
        </div>
      </div>
    );
  }

  // V6 = explicit version flag OR V6-only fields present (guards against null profileVersion for pre-tracking completions)
  const isV6 = (ctx.profileVersion != null && ctx.profileVersion >= 6) || ctx.successfulOutfitGives.length > 0 || ctx.currentGoal.length > 0;

  const personalitySplit = splitStyleExpression(ctx.styleExpression);

  const v6Rows: Array<{ label: string; field: string; values: string[] }> = [
    { label: "Current Focus", field: "currentGoal", values: ctx.currentGoal },
    { label: "Outfit Priorities", field: "successfulOutfitGives", values: ctx.successfulOutfitGives },
    { label: "Personality", field: "styleExpression", values: personalitySplit.current },
    // Withdrawn Q3 vocabulary. Shown only while the customer has no current
    // Personality answer, and never under the Personality label — these words
    // answered "how do you want your clothes to come across", a different question.
    { label: "Earlier Style Expression", field: "styleExpression", values: personalitySplit.legacy },
    { label: "Style Exploration", field: "explorationLevel", values: ctx.explorationLevel ? [ctx.explorationLevel] : [] },
    { label: "Style Direction", field: "styleDirections", values: ctx.styleDirections },
    // Legacy style field — only shown when the customer has no Rev 7 answer.
    { label: "Style (legacy)", field: "stylePersonalities", values: ctx.styleDirections.length > 0 ? [] : ctx.stylePersonalities },
    { label: "Lifestyle", field: "lifestyle", values: ctx.lifestyle },
    { label: "Favourite Colours", field: "favoriteColors", values: ctx.favoriteColors },
    { label: "Avoid Colours", field: "avoidColors", values: ctx.avoidColors },
    { label: "Silhouette", field: "silhouette", values: ctx.silhouette },
    { label: "Fit Concerns", field: "fitConcerns", values: ctx.fitConcerns },
    { label: "Dressing Requirements", field: "dressingPreferences", values: ctx.dressingPreferences },
    { label: "Dressing Habits", field: "dressingHabits", values: ctx.dressingHabits },
  ].filter(r => r.values.length > 0);

  const textFields = isV6 ? (
    [
      ctx.fitConcernsNote ? { label: "Fit Note", value: ctx.fitConcernsNote } : null,
      ctx.dressingRequirementsNote ? { label: "Cultural / Religious Requirement", value: ctx.dressingRequirementsNote } : null,
      ctx.finalNotes ? { label: "Notes to nAia", value: ctx.finalNotes } : null,
    ].filter(Boolean) as Array<{ label: string; value: string }>
  ) : [];

  const legacyRows: Array<{ label: string; field: string; values: string[] }> = isV6 ? [] : [
    { label: "Desired feelings", field: "desiredFeelings", values: ctx.desiredFeelings },
    { label: "Coverage preferences", field: "coveragePreferences", values: ctx.coveragePreferences },
    { label: "Fit preferences", field: "fitPreferences", values: ctx.fitPreferences },
    { label: "Style support goal", field: "styleSupport", values: ctx.styleSupport },
  ].filter(r => r.values.length > 0);

  const chipStyle = {
    fontSize: "0.72rem",
    color: "#93c5fd",
    background: "#0c1a2e",
    border: "1px solid #1e3a5f",
    padding: "0.15rem 0.55rem",
    borderRadius: "4px",
  };

  const legacyChipStyle = {
    fontSize: "0.72rem",
    color: "#6b7280",
    background: "#111827",
    border: "1px solid #374151",
    padding: "0.15rem 0.55rem",
    borderRadius: "4px",
  };

  const hasAnyData = v6Rows.length > 0 || textFields.length > 0 || legacyRows.length > 0;

  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Passport</h2>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {isV6 && (
            <span style={{ fontSize: "0.6rem", background: "#052e16", color: "#86efac", border: "1px solid #166534", borderRadius: "3px", padding: "0.05rem 0.35rem", fontFamily: "monospace" }}>
              V6
            </span>
          )}
          <span style={{ fontSize: "0.65rem", background: "#0c1a2e", color: "#93c5fd", border: "1px solid #1e3a5f", borderRadius: "3px", padding: "0.05rem 0.35rem" }}>
            A — CUSTOMER-SUPPLIED
          </span>
        </div>
      </div>
      <div className="na-card__body">
        <p style={{ fontSize: "0.65rem", color: "#4b5563", marginBottom: "1rem" }}>
          Facts and preferences this customer supplied. Not inferred by nAia.
        </p>
        {!hasAnyData ? (
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>Passport exists but no styling fields are filled in.</p>
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

function ClosetSummarySection({
  customerId,
  totalItems,
  reviewedItems,
  categoryBreakdown,
}: {
  customerId: string;
  totalItems: number;
  reviewedItems: number;
  categoryBreakdown: Record<string, number>;
}) {
  const categories = Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]);

  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Closet</h2>
        <Link
          to={`/admin/naia/closet?customerId=${customerId}`}
          style={{ fontSize: "0.75rem", color: "#6b7280", textDecoration: "none" }}
        >
          View all →
        </Link>
      </div>
      <div className="na-card__body">
        <div style={{ display: "flex", gap: "2rem", marginBottom: "1rem" }}>
          <div>
            <p style={{ fontSize: "0.65rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>Total</p>
            <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#e5e7eb" }}>{totalItems}</p>
          </div>
          <div>
            <p style={{ fontSize: "0.65rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.2rem" }}>Reviewed</p>
            <p style={{ fontSize: "1.5rem", fontWeight: 700, color: reviewedItems > 0 ? "#34d399" : "#6b7280" }}>
              {reviewedItems}
              <span style={{ fontSize: "0.8rem", color: "#6b7280", fontWeight: 400, marginLeft: "0.3rem" }}>
                / {totalItems}
              </span>
            </p>
          </div>
        </div>
        {categories.length > 0 && (
          <>
            <p style={{ fontSize: "0.65rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "0.5rem" }}>By Category</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {categories.map(([cat, count]) => (
                <div key={cat} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <span style={{ fontSize: "0.78rem", color: "#d1d5db", minWidth: "120px" }}>{cat}</span>
                  <div style={{ flex: 1, height: "6px", background: "#1f2937", borderRadius: "3px", overflow: "hidden" }}>
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.round((count / totalItems) * 100)}%`,
                        background: "#3b82f6",
                        borderRadius: "3px",
                      }}
                    />
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#6b7280", minWidth: "28px", textAlign: "right" }}>{count}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {totalItems === 0 && (
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>No closet items.</p>
        )}
      </div>
    </div>
  );
}

function verdictStyle(verdict: string): { color: string; background: string; border: string } {
  const v = verdict.toUpperCase();
  if (v === "BUY") return { color: "#86efac", background: "#052e16", border: "1px solid #166534" };
  if (v.startsWith("SKIP")) return { color: "#fca5a5", background: "#2e0a0a", border: "1px solid #7f1d1d" };
  return { color: "#9ca3af", background: "#1f2937", border: "1px solid #374151" };
}

function displayDateTime(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Buy/Skip is a customer-submitted purchase-candidate record, never a Closet
// item: it is never counted as owned, never written to the Closet, and
// never used to infer wardrobe gaps. This section is deliberately separate
// from ClosetSummarySection above — do not merge them.
function BuySkipUploadsSection({
  customerId,
  uploads,
  totalCount,
}: {
  customerId: string;
  uploads: AdminBuySkipUploadSummary[];
  totalCount: number;
}) {
  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Buy / Skip Uploads</h2>
        <span style={{ fontSize: "0.65rem", background: "#1f2937", color: "#9ca3af", border: "1px solid #374151", borderRadius: "3px", padding: "0.05rem 0.35rem" }}>
          {totalCount > uploads.length
            ? `Showing ${uploads.length} most recent of ${totalCount}`
            : `${uploads.length} submission${uploads.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="na-card__body">
        <p style={{ fontSize: "0.65rem", color: "#4b5563", marginBottom: "1rem" }}>
          Purchase-candidate submissions this customer has uploaded. Not Closet ownership — nAia does not treat an upload as something the customer owns.
        </p>
        {uploads.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "#6b7280" }}>No Buy/Skip submissions.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {uploads.map(u => {
              const vStyle = verdictStyle(u.displayVerdict);
              return (
                <Link
                  key={u.id}
                  to={`/admin/naia/customers/${customerId}/buyskip/${u.id}`}
                  style={{
                    display: "flex",
                    gap: "0.75rem",
                    alignItems: "center",
                    padding: "0.6rem",
                    border: "1px solid #1f2937",
                    borderRadius: "6px",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div style={{
                    width: "48px", height: "48px", borderRadius: "5px", overflow: "hidden",
                    background: "#111827", border: "1px solid #1f2937", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {u.thumbnailUrl ? (
                      <img src={u.thumbnailUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ fontSize: "0.6rem", color: "#4b5563" }}>No image</span>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.2rem" }}>
                      <span style={{ fontSize: "0.85rem", color: "#e5e7eb", fontWeight: 600 }}>
                        {u.itemType ?? u.category ?? "Unknown item"}
                      </span>
                      <span style={{ fontSize: "0.65rem", padding: "0.05rem 0.4rem", borderRadius: "3px", ...vStyle }}>
                        {u.displayVerdict}
                      </span>
                      {u.verdictOverridden && (
                        <span title="Verdict was downgraded by a confirmed hard-constraint violation" style={{ fontSize: "0.6rem", color: "#fbbf24" }}>
                          ⚠ overridden
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "#9ca3af", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {u.reasoning ?? "No reasoning recorded."}
                    </p>
                    <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.25rem" }}>
                      <span style={{ fontSize: "0.65rem", color: "#6b7280" }}>{displayDateTime(u.createdAt)}</span>
                      {u.outcome && (
                        <span style={{ fontSize: "0.65rem", color: "#6b7280" }}>
                          Outcome: {u.outcome.decision.toLowerCase().replace(/_/g, " ")}
                          {u.outcome.postPurchaseOutcome ? ` · ${u.outcome.postPurchaseOutcome.toLowerCase().replace(/_/g, " ")}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#4b5563" }}>View →</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Customer 360 — new tab sections ─────────────────────────────────────────

function ClosetGallerySection({ items, totalCount }: { items: AdminClosetGalleryItem[]; totalCount: number }) {
  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Closet Gallery</h2>
        <span className="na-card__subtitle">
          {totalCount > items.length ? `Showing ${items.length} most recent of ${totalCount}` : `${items.length} item${items.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="na-card__body">
        {items.length === 0 ? (
          <p className="na-empty">No closet items.</p>
        ) : (
          <div className="na-gallery">
            {items.map(item => (
              <div key={item.id} className="na-gallery-card">
                {item.thumbnailUrl ? (
                  <img className="na-gallery-card__img" src={item.thumbnailUrl} alt="" />
                ) : (
                  <div className="na-gallery-card__img--placeholder">No image</div>
                )}
                <div className="na-gallery-card__body">
                  <p className="na-gallery-card__name">{item.name ?? item.category}</p>
                  <p className="na-gallery-card__meta">
                    {[item.brand, item.subcategory ?? item.category].filter(Boolean).join(" · ")}
                  </p>
                  {item.colors.length > 0 && (
                    <div className="na-chips" style={{ marginTop: "0.3rem" }}>
                      {item.colors.map(c => <span key={c} className="na-chip">{c}</span>)}
                    </div>
                  )}
                  {item.garmentRelationships.length > 0 && (
                    <p className="na-gallery-card__meta" style={{ marginTop: "0.3rem" }}>
                      {item.garmentRelationships.join(", ")}
                    </p>
                  )}
                  {item.customerNote && (
                    <p className="na-gallery-card__meta" style={{ marginTop: "0.3rem", fontStyle: "italic" }}>
                      "{item.customerNote}"
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StyleMeSection({
  customerId,
  sessions,
  totalCount,
}: {
  customerId: string;
  sessions: AdminStyleMeSessionSummary[];
  totalCount: number;
}) {
  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">StyleMe Sessions</h2>
        <span className="na-card__subtitle">
          {totalCount > sessions.length ? `Showing ${sessions.length} most recent of ${totalCount}` : `${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="na-card__body">
        {sessions.length === 0 ? (
          <p className="na-empty">No StyleMe sessions.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {sessions.map(session => {
              const primary = session.suggestions[0];
              return (
                <Link
                  key={session.id}
                  to={`/admin/naia/customers/${customerId}/styleme/${session.id}`}
                  style={{ display: "flex", gap: "0.75rem", alignItems: "center", padding: "0.6rem", border: "1px solid #dde1e7", borderRadius: "6px", textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ display: "flex", flexShrink: 0, width: "52px", minHeight: "48px", alignItems: "center" }}>
                    {primary && primary.collageImages.length > 0 ? (
                      primary.collageImages.slice(0, 2).map((url, i) => (
                        <img key={i} src={url} alt="" style={{ width: "40px", height: "48px", objectFit: "cover", borderRadius: "4px", marginLeft: i > 0 ? "-12px" : 0, border: "1px solid #fff" }} />
                      ))
                    ) : session.hasCompletedLook ? (
                      <div className="na-thumb--placeholder" style={{ width: "52px", fontSize: "0.6rem" }} title="This session produced a look, but no item image resolved">No image</div>
                    ) : (
                      <div className="na-thumb--placeholder" style={{ width: "52px", fontSize: "0.6rem", lineHeight: 1.2, textAlign: "center", padding: "0.2rem" }}>
                        No completed look
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <strong style={{ fontSize: "0.85rem" }}>{primary?.outfitName ?? "StyleMe session"}</strong>
                      <span className="na-badge na-badge--not-analyzed">{session.source}</span>
                      {primary?.savedAsLook && <span className="na-badge na-badge--reviewed">SAVED</span>}
                    </div>
                    <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0.15rem 0 0" }}>
                      {[session.occasion, session.state, ...session.intentions].filter(Boolean).join(" · ") || "No occasion recorded."}
                    </p>
                    {primary?.outcome && (
                      <p style={{ fontSize: "0.72rem", color: "#6b7280", margin: "0.15rem 0 0" }}>
                        Outcome: {primary.outcome.outcomeStatus}
                        {primary.outcome.goalOutcome ? ` · goal ${primary.outcome.goalOutcome}` : ""}
                      </p>
                    )}
                    <span style={{ fontSize: "0.65rem", color: "#6b7280" }}>{displayDateTime(session.createdAt)}</span>
                  </div>
                  <span style={{ fontSize: "0.75rem", color: "#4b5563", flexShrink: 0 }}>View →</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function NoticingFeedbackSection({ observations }: { observations: AdminNoticingObservation[] }) {
  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">What nAia Is Noticing &amp; Feedback</h2>
        <span className="na-card__subtitle">{observations.length} observation{observations.length === 1 ? "" : "s"}</span>
      </div>
      <div className="na-card__body">
        <p style={{ fontSize: "0.65rem", color: "#4b5563", marginBottom: "1rem" }}>
          Every observation nAia actually showed this customer on their own "What nAia Is Noticing" page —
          confirmed ones still showing today, and ones they later said weren't quite right. Not shown on any NADINE dashboard.
        </p>
        {observations.length === 0 ? (
          <p className="na-empty">Nothing surfaced to this customer yet.</p>
        ) : (
          <div className="na-table-wrap">
            <table className="na-table">
              <thead>
                <tr>
                  <th>Observation</th>
                  <th>Status</th>
                  <th>Customer Feedback</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {observations.map(o => (
                  <tr key={o.id}>
                    <td>{o.observationText}</td>
                    <td>
                      <span className={`na-badge na-badge--${o.status === "Confirmed" ? "reviewed" : "failed"}`}>
                        {o.status}
                      </span>
                    </td>
                    <td>
                      {o.customerFeedback}
                      {o.notQuiteReason && <div style={{ fontSize: "0.68rem", color: "#6b7280" }}>{o.notQuiteReason.replace(/-/g, " ")}</div>}
                      {o.notQuiteNote && <div style={{ fontSize: "0.68rem", color: "#6b7280", fontStyle: "italic" }}>"{o.notQuiteNote}"</div>}
                    </td>
                    <td>{o.feedbackAt ? displayDateTime(o.feedbackAt) : displayDateTime(o.surfacedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function TrendEditsSection({ customerId, rows }: { customerId: string; rows: AdminTrendEditUsageRow[] }) {
  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Trend Edits</h2>
        <span className="na-card__subtitle">{rows.length} generation{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="na-card__body">
        {rows.length === 0 ? (
          <p className="na-empty">No Personalised Trend Edits generated.</p>
        ) : (
          <div className="na-table-wrap">
            <table className="na-table">
              <thead><tr><th>Date</th><th>Report</th><th>Period</th><th></th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td>{displayDateTime(r.createdAt)}</td>
                    <td>{r.reportTitle}</td>
                    <td>{r.periodKey}</td>
                    <td>
                      {/* Every row opens — historical rows with no stored snapshot
                          still show report/date/period and say plainly that the
                          personalised content itself was never captured. */}
                      <Link to={`/admin/naia/customers/${customerId}/trend-edit/${r.id}`} style={{ fontSize: "0.75rem" }}>View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function VtoSection({
  model,
  jobs,
  jobsTotalCount,
}: {
  model: AdminNaiaModelSummary | null;
  jobs: AdminVtoJobSummary[];
  jobsTotalCount: number;
}) {
  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">VTO / My nAia Model</h2>
        <span className="na-card__subtitle">
          {jobsTotalCount > jobs.length ? `Showing ${jobs.length} most recent of ${jobsTotalCount}` : `${jobs.length} job${jobs.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="na-card__body">
        <p style={{ fontSize: "0.65rem", color: "#4b5563", marginBottom: "1rem" }}>
          Operational history only — not an image archive.
        </p>
        {!model ? (
          <p className="na-empty">No nAia Model created.</p>
        ) : (
          <table className="na-field-table" style={{ marginBottom: "1rem" }}>
            <tbody>
              <tr><th>Face photo</th><td>{model.hasFacePhoto ? "On file" : "—"}</td></tr>
              <tr><th>Body photo</th><td>{model.hasBodyPhoto ? "On file" : "—"}</td></tr>
              <tr><th>Moderation</th><td>{model.bodyModerationStatus ?? "—"}</td></tr>
              <tr><th>Created</th><td>{displayDateTime(model.createdAt)}</td></tr>
            </tbody>
          </table>
        )}
        {jobs.length === 0 ? (
          <p className="na-empty">No virtual try-on jobs.</p>
        ) : (
          <div className="na-table-wrap">
            <table className="na-table">
              <thead><tr><th>Date</th><th>Product</th><th>Status</th><th>Error</th></tr></thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id}>
                    <td>{displayDateTime(j.createdAt)}</td>
                    <td>{j.productHandle}</td>
                    <td>{j.status}</td>
                    <td>{j.errorCode ?? <span className="na-null">none</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ActivitySection({ events }: { events: AdminActivityEvent[] }) {
  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Activity</h2>
        <span className="na-card__subtitle">{events.length} event{events.length === 1 ? "" : "s"}</span>
      </div>
      <div className="na-card__body">
        {events.length === 0 ? (
          <p className="na-empty">No activity recorded.</p>
        ) : (
          <div className="na-timeline">
            {events.map((e, i) => (
              <div key={i} className="na-timeline-row">
                <span className="na-timeline-row__when">{displayDateTime(e.timestamp)}</span>
                <span className="na-timeline-row__label">{e.label}</span>
                {e.detail && <span className="na-timeline-row__detail">— {e.detail}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// used/limit here is ALWAYS the current membership cycle — every caller
// passes entitlement.<feature>.monthlyUsed (from getEntitlementSummary,
// itself scoped via getUsageWindow()), never a lifetime count. A lifetime
// count renders on its own line underneath, explicitly labeled, never as
// part of this ratio — see MembershipUsageSection below.
function usageBar(label: string, used: number, limit: number, lifetime?: number, lifetimeNoun?: string) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div key={label} style={{ marginBottom: "0.6rem" }}>
      <div className="na-usage-row">
        <span className="na-usage-row__label">{label} <span style={{ color: "#9ca3af", fontWeight: 400 }}>— this cycle</span></span>
        <div className="na-usage-row__bar"><div className="na-usage-row__fill" style={{ width: `${pct}%` }} /></div>
        <span className="na-usage-row__count">{used} used this cycle / {limit} included</span>
      </div>
      {lifetime != null && (
        <p style={{ fontSize: "0.68rem", color: "#9ca3af", margin: "0.1rem 0 0", paddingLeft: "0.1rem" }}>
          Lifetime usage: {lifetime} {lifetimeNoun ?? ""}
        </p>
      )}
    </div>
  );
}

function MembershipUsageSection({
  entitlement,
  lifetimeUsage,
}: {
  entitlement: EntitlementSummary;
  lifetimeUsage: AdminLifetimeUsage;
}) {
  return (
    <div className="na-card">
      <div className="na-card__header">
        <h2 className="na-card__title">Membership &amp; Usage</h2>
        <span className="na-card__subtitle">{entitlement.membershipStatus} · current cycle resets {entitlement.windowLabel}</span>
      </div>
      <div className="na-card__body">
        {usageBar("StyleMe", entitlement.styleMe.monthlyUsed, entitlement.styleMe.monthlyLimit, lifetimeUsage.styleMeSessions, "sessions")}
        {usageBar("Buy or Skip", entitlement.buySkip.monthlyUsed, entitlement.buySkip.monthlyLimit, lifetimeUsage.buySkipAnalyses, "analyses")}
        {usageBar("Virtual Try-On", entitlement.vto.monthlyCompleted + entitlement.vto.monthlyInFlight, entitlement.vto.monthlyLimit, lifetimeUsage.vtoJobsCompleted, "completed jobs")}
        {usageBar("Personalised Trend Edit", entitlement.personalisedTrend.monthlyUsed, entitlement.personalisedTrend.monthlyLimit, lifetimeUsage.personalisedTrendEdits, "generations")}
        {/* Closet is current saved pieces vs capacity, not monthly usage — no "this cycle" label, no lifetime line. */}
        <div className="na-usage-row">
          <span className="na-usage-row__label">Closet <span style={{ color: "#9ca3af", fontWeight: 400 }}>— capacity</span></span>
          <div className="na-usage-row__bar"><div className="na-usage-row__fill" style={{ width: `${entitlement.closet.limit > 0 ? Math.min(100, Math.round((entitlement.closet.currentCount / entitlement.closet.limit) * 100)) : 0}%` }} /></div>
          <span className="na-usage-row__count">{entitlement.closet.currentCount} / {entitlement.closet.limit}</span>
        </div>
        <p style={{ fontSize: "0.72rem", color: "#9ca3af", marginTop: "0.75rem" }}>
          Subscription / add-ons: not yet connected.
        </p>
      </div>
    </div>
  );
}

function SummaryTab({
  customer,
  accountType,
  latestStyleMe,
  latestBuySkip,
  strongestTendency,
  entitlement,
  lifetimeUsage,
}: {
  customer: AdminCustomerDetail;
  accountType: string;
  latestStyleMe: AdminStyleMeSessionSummary | null;
  latestBuySkip: AdminBuySkipUploadSummary | null;
  strongestTendency: AdminStrongestTendencySummary | null;
  entitlement: EntitlementSummary;
  lifetimeUsage: AdminLifetimeUsage;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div className="na-card">
        <div className="na-card__header"><h2 className="na-card__title">At a Glance</h2></div>
        <div className="na-card__body">
          <table className="na-field-table">
            <tbody>
              <tr><th>Name</th><td>{customerDisplayName(customer)}</td></tr>
              <tr><th>Email</th><td>{customer.email ?? "—"}</td></tr>
              <tr><th>Joined</th><td>{displayDate(customer.createdAt)}</td></tr>
              <tr><th>Account type</th><td>{accountType}</td></tr>
              <tr><th>Membership</th><td>{customer.membershipStatus.toLowerCase().replace(/_/g, " ")}</td></tr>
              <tr><th>Passport</th><td>{customer.passportComplete ? "Complete" : "Incomplete"}</td></tr>
              <tr><th>Closet items</th><td>{customer.closetItemCount}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="na-card">
        <div className="na-card__header"><h2 className="na-card__title">What nAia Gave Them, and How They Responded</h2></div>
        <div className="na-card__body">
          <table className="na-field-table">
            <tbody>
              <tr>
                <th>Latest StyleMe</th>
                <td>
                  {latestStyleMe
                    ? `${displayDateTime(latestStyleMe.createdAt)} — ${latestStyleMe.suggestions[0]?.outcome?.outcomeStatus ?? "no outcome recorded"}`
                    : <span className="na-null">none yet</span>}
                </td>
              </tr>
              <tr>
                <th>Latest Buy or Skip</th>
                <td>
                  {latestBuySkip
                    ? `${latestBuySkip.displayVerdict} — ${latestBuySkip.outcome?.decision.toLowerCase().replace(/_/g, " ") ?? "no decision recorded"}`
                    : <span className="na-null">none yet</span>}
                </td>
              </tr>
              <tr>
                <th>Strongest Noticing</th>
                <td>{strongestTendency?.claimText ?? <span className="na-null">still learning</span>}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <MembershipUsageSection entitlement={entitlement} lifetimeUsage={lifetimeUsage} />
    </div>
  );
}

const TABS = [
  "Summary",
  "Passport",
  "Closet",
  "StyleMe",
  "Buy or Skip",
  "What nAia Is Noticing & Feedback",
  "Trend Edits",
  "VTO / My nAia Model",
  "Activity",
  "Membership & Usage",
] as const;
type TabId = (typeof TABS)[number];

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminCustomerDetailPage() {
  const {
    customer, accountType, buySkipUploads,
    closetGallery, styleMeSessions, noticingFeedback, trendEditUsage,
    vtoHistory, activity, strongestTendency, lifetimeUsage, entitlement,
  } = useLoaderData() as {
    customer: AdminCustomerDetail;
    accountType: string;
    buySkipUploads: { items: AdminBuySkipUploadSummary[]; totalCount: number };
    closetGallery: { items: AdminClosetGalleryItem[]; totalCount: number };
    styleMeSessions: { items: AdminStyleMeSessionSummary[]; totalCount: number };
    noticingFeedback: AdminNoticingObservation[];
    trendEditUsage: AdminTrendEditUsageRow[];
    vtoHistory: { model: AdminNaiaModelSummary | null; jobs: AdminVtoJobSummary[]; jobsTotalCount: number };
    activity: AdminActivityEvent[];
    strongestTendency: AdminStrongestTendencySummary | null;
    lifetimeUsage: AdminLifetimeUsage;
    entitlement: EntitlementSummary;
  };
  const typeFetcher = useFetcher<{ ok: boolean; error?: string; accountType?: string }>();
  const currentType = typeFetcher.data?.accountType ?? accountType;
  const [activeTab, setActiveTab] = useState<TabId>("Summary");

  return (
    <div className="na-page">
      {/* Breadcrumb */}
      <div style={{ marginBottom: "0.75rem" }}>
        <Link to="/admin/naia/customers" style={{ fontSize: "0.78rem", color: "#6b7280", textDecoration: "none" }}>
          ← Customers
        </Link>
      </div>

      <h1 className="na-page-heading" style={{ marginBottom: "0.25rem" }}>
        {customerDisplayName(customer)}
      </h1>
      <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "0.75rem" }}>
        What does nAia think it knows about this person?
      </p>

      {/* Read-only export of THIS customer's Closet. The id comes from the page, so it
          cannot be aimed at another customer's Closet by mistake. */}
      <p style={{ marginBottom: "1.5rem" }}>
        <a
          href={`/admin/naia/customers/${customer.id}/closet-export`}
          style={{ fontSize: "0.78rem", color: "#374151", textDecoration: "underline", textUnderlineOffset: "3px" }}
        >
          Export Closet JSON
        </a>
      </p>

      {/* ── Account type ───────────────────────────────────────────────────
          Ours or theirs. Written deliberately rather than inferred from an
          email pattern, because the day a pattern stops matching is the day
          test activity starts counting as customer demand. Only accounts
          marked CUSTOMER are eligible for aggregated design research. */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap",
                    border: "1px solid #e5e7eb", borderRadius: "6px", padding: "0.75rem 1rem", marginBottom: "1.5rem" }}>
        <span style={{ fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>
          Account type
        </span>
        <strong style={{ fontSize: "0.85rem" }}>{currentType}</strong>
        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
          {currentType === "CUSTOMER"
            ? "Counts towards aggregated design research when they have opted in."
            : "Excluded from every aggregate, whatever their consent says."}
        </span>
        <typeFetcher.Form method="post" style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          <select name="accountType" defaultValue={currentType} style={{ fontSize: "0.8rem", padding: "0.3rem 0.5rem" }}>
            {["CUSTOMER", "TEST", "DEMO", "QA"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="submit" className="na-btn" disabled={typeFetcher.state !== "idle"}>
            {typeFetcher.state !== "idle" ? "Saving…" : "Set"}
          </button>
        </typeFetcher.Form>
        {typeFetcher.data?.error && (
          <span style={{ fontSize: "0.75rem", color: "#b91c1c", width: "100%" }}>{typeFetcher.data.error}</span>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1.25rem", alignItems: "start" }}>

        {/* Main column */}
        <div>
          <div className="na-tabbar" role="tablist">
            {TABS.map(tab => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                className={`na-tab${activeTab === tab ? " na-tab--active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>

          {activeTab === "Summary" && (
            <SummaryTab
              customer={customer}
              accountType={currentType}
              latestStyleMe={styleMeSessions.items[0] ?? null}
              latestBuySkip={buySkipUploads.items[0] ?? null}
              strongestTendency={strongestTendency}
              entitlement={entitlement}
              lifetimeUsage={lifetimeUsage}
            />
          )}
          {activeTab === "Passport" && <PassportSection ctx={customer.passport} />}
          {activeTab === "Closet" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <ClosetSummarySection
                customerId={customer.id}
                totalItems={customer.closetItemCount}
                reviewedItems={customer.reviewedItemCount}
                categoryBreakdown={customer.categoryBreakdown}
              />
              <ClosetGallerySection items={closetGallery.items} totalCount={closetGallery.totalCount} />
            </div>
          )}
          {activeTab === "StyleMe" && <StyleMeSection customerId={customer.id} sessions={styleMeSessions.items} totalCount={styleMeSessions.totalCount} />}
          {activeTab === "Buy or Skip" && <BuySkipUploadsSection customerId={customer.id} uploads={buySkipUploads.items} totalCount={buySkipUploads.totalCount} />}
          {activeTab === "What nAia Is Noticing & Feedback" && <NoticingFeedbackSection observations={noticingFeedback} />}
          {activeTab === "Trend Edits" && <TrendEditsSection customerId={customer.id} rows={trendEditUsage} />}
          {activeTab === "VTO / My nAia Model" && <VtoSection model={vtoHistory.model} jobs={vtoHistory.jobs} jobsTotalCount={vtoHistory.jobsTotalCount} />}
          {activeTab === "Activity" && <ActivitySection events={activity} />}
          {activeTab === "Membership & Usage" && <MembershipUsageSection entitlement={entitlement} lifetimeUsage={lifetimeUsage} />}
        </div>

        {/* Sidebar — identity */}
        <div className="na-card">
          <div className="na-card__header">
            <h2 className="na-card__title">Identity</h2>
          </div>
          <div className="na-card__body">
            <table className="na-field-table">
              <tbody>
                <tr>
                  <th>Name</th>
                  <td>{[customer.firstName, customer.lastName].filter(Boolean).join(" ") || "—"}</td>
                </tr>
                <tr>
                  <th>Email</th>
                  <td style={{ wordBreak: "break-all" }}>{customer.email ?? "—"}</td>
                </tr>
                <tr>
                  <th>Plan</th>
                  <td>{customer.membershipStatus.toLowerCase().replace(/_/g, " ")}</td>
                </tr>
                <tr>
                  <th>Passport</th>
                  <td>
                    {customer.passportComplete
                      ? `Complete${customer.profileVersion ? ` · V${customer.profileVersion}` : ""}`
                      : customer.profileVersion != null
                        ? "Partial"
                        : "None"}
                  </td>
                </tr>
                <tr>
                  <th>Joined</th>
                  <td>{displayDate(customer.createdAt)}</td>
                </tr>
                <tr>
                  <th>ID</th>
                  <td><code style={{ fontSize: "10px", wordBreak: "break-all" }}>{customer.id}</code></td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <Link
                to={`/admin/naia/closet?customerId=${customer.id}`}
                style={{
                  display: "block",
                  textAlign: "center",
                  padding: "0.5rem",
                  fontSize: "0.78rem",
                  color: "#9ca3af",
                  border: "1px solid #374151",
                  borderRadius: "5px",
                  textDecoration: "none",
                }}
              >
                View closet →
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
