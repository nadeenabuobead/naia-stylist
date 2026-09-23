// app/routes/admin.naia.customers.$customerId.tsx
//
// nAia Admin — Customer detail.
// Read-only. "What does nAia think it knows about this person?"
//
// Sections:
//   A. Identity (name, email, plan, joined)
//   B. Customer Passport (customer-supplied preferences)
//   C. Closet Summary (garment counts, category breakdown, link to closet)
//
// Auth: requireAdminSession.

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import {
  getAdminCustomerDetail,
  type AdminCustomerDetail,
  type CustomerStylingPassportContext,
} from "~/lib/admin/closet-intelligence.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAdminSession(request);
  const { customerId } = params;
  if (!customerId) throw new Response("Not found", { status: 404 });
  const customer = await getAdminCustomerDetail(customerId);
  if (!customer) throw new Response("Customer not found", { status: 404 });
  return Response.json({ customer });
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

  const v6Rows: Array<{ label: string; field: string; values: string[] }> = [
    { label: "Current Focus", field: "currentGoal", values: ctx.currentGoal },
    { label: "Outfit Priorities", field: "successfulOutfitGives", values: ctx.successfulOutfitGives },
    { label: "Style Expression", field: "styleExpression", values: ctx.styleExpression },
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

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminCustomerDetailPage() {
  const { customer } = useLoaderData() as { customer: AdminCustomerDetail };

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
      <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: "1.5rem" }}>
        What does nAia think it knows about this person?
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "1.25rem", alignItems: "start" }}>

        {/* Main column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <PassportSection ctx={customer.passport} />
          <ClosetSummarySection
            customerId={customer.id}
            totalItems={customer.closetItemCount}
            reviewedItems={customer.reviewedItemCount}
            categoryBreakdown={customer.categoryBreakdown}
          />
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
