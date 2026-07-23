import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const CLOTHING_CATEGORIES = [
  "TOPS","BOTTOMS","DRESSES","OUTERWEAR","ACTIVEWEAR","SWIMWEAR","LOUNGEWEAR","OTHER",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  TOPS: "Tops", BOTTOMS: "Bottoms", DRESSES: "Dresses", OUTERWEAR: "Outerwear",
  SHOES: "Shoes", BAGS: "Bags", ACCESSORIES: "Accessories", JEWELRY: "Jewelry",
  ACTIVEWEAR: "Activewear", SWIMWEAR: "Swimwear", LOUNGEWEAR: "Loungewear", OTHER: "Other",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  const items = await prisma.closetItem.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      category: true,
      thumbnailUrl: true,
      imageUrl: true,
      brand: true,
      colors: true,
    },
  });
  return { items };
}

type FilterTab = "all" | "clothing" | "shoes" | "bags";

function isClothing(category: string): boolean {
  return CLOTHING_CATEGORIES.includes(category as typeof CLOTHING_CATEGORIES[number]);
}

function statusLabel(): { text: string; lipstick: boolean } {
  return { text: "Ready for styling", lipstick: false };
}

export default function MyNaiaCloset() {
  const { items } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  const filtered = items.filter((item) => {
    const cat = item.category;
    const matchesTab =
      activeTab === "all" ||
      (activeTab === "shoes" && cat === "SHOES") ||
      (activeTab === "bags" && cat === "BAGS") ||
      (activeTab === "clothing" && isClothing(cat));
    const q = query.trim().toLowerCase();
    const label = (item.name ?? "").toLowerCase();
    const matchesSearch =
      !q ||
      label.includes(q) ||
      cat.toLowerCase().includes(q) ||
      (item.brand ?? "").toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  const TABS: { id: FilterTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "clothing", label: "Clothing" },
    { id: "shoes", label: "Shoes" },
    { id: "bags", label: "Bags" },
  ];

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header */}
        <section>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <div className="mn-eyebrow">Digital Closet</div>
              <h1
                style={{
                  fontFamily: "var(--ff-display)",
                  fontWeight: 200,
                  marginTop: "0.75rem",
                  fontSize: "clamp(1.875rem, 5vw, 2.5rem)",
                  lineHeight: 1,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                }}
              >
                Your Digital Closet
              </h1>
            </div>
            <span className="mn-sample-badge">Real data</span>
          </div>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            A private inventory of the pieces you already own — used to style new NADINE pieces with your
            existing wardrobe. Add one clothing item, shoe pair or bag at a time.
          </p>
        </section>

        {/* Upload buttons */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.75rem" }}>
          <Link to="/closet" className="mn-btn-primary">Upload Item</Link>
          <button type="button" className="mn-btn-outline">Take a Photo</button>
        </div>

        {/* Filter + search row */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
            borderTop: "1px solid var(--fg-12)",
            paddingTop: "1.5rem",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`mn-filter-pill${activeTab === t.id ? " mn-active" : ""}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.24em", color: "var(--fg-60)" }}>
            <span>Search</span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ivory trouser…"
              style={{
                borderTop: "none",
                borderLeft: "none",
                borderRight: "none",
                borderBottom: "1px solid var(--fg-25)",
                background: "transparent",
                padding: "0.25rem 0.25rem",
                fontSize: "0.85rem",
                textTransform: "none",
                letterSpacing: "normal",
                color: "var(--fg)",
                outline: "none",
                fontFamily: "var(--ff-ui)",
              }}
            />
          </label>
        </div>

        {/* Item list */}
        {items.length === 0 ? (
          <p className="mn-state-note">
            Your digital closet is empty. Add one piece at a time and nAia will begin styling from your own wardrobe.
          </p>
        ) : filtered.length === 0 ? (
          <div style={{ border: "1px solid var(--fg-10)", background: "var(--bg-50)", padding: "2rem", textAlign: "center" }}>
            <p style={{ fontSize: "0.9rem", color: "var(--fg-75)" }}>No items match this view.</p>
          </div>
        ) : (
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              borderTop: "1px solid var(--fg-12)",
              borderBottom: "1px solid var(--fg-12)",
            }}
          >
            {filtered.map((item) => {
              const thumb = item.thumbnailUrl ?? item.imageUrl;
              const displayName = item.name ?? "Unnamed piece";
              const { text: sText, lipstick: sLipstick } = statusLabel();

              return (
                <li key={item.id} className="mn-closet-item">
                  {/* Photo placeholder */}
                  <div
                    style={{
                      aspectRatio: "4/5",
                      width: "6rem",
                      background: "color-mix(in oklab, var(--bg) 92%, white)",
                      border: "1px solid var(--fg-08)",
                      overflow: "hidden",
                      display: "grid",
                      placeItems: "center",
                    }}
                    aria-hidden="true"
                  >
                    {thumb ? (
                      <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <span style={{ color: "var(--fg-30)", fontSize: "0.875rem" }}>&#9633;</span>
                    )}
                  </div>

                  {/* Info */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </div>
                    <div style={{ marginTop: "0.25rem", fontSize: "0.95rem", color: "var(--fg)" }}>{displayName}</div>
                    <div
                      style={{
                        marginTop: "0.5rem",
                        fontSize: "0.72rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.24em",
                        color: sLipstick ? "var(--lipstick)" : "var(--fg-60)",
                      }}
                    >
                      {sText}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "1.25rem 1.25rem", justifyContent: "flex-end", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setEditing(item.id)}
                      style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.28em", textDecoration: "underline", textUnderlineOffset: "3px", color: "var(--fg-80)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      style={{ fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.28em", textDecoration: "underline", textUnderlineOffset: "3px", color: "var(--fg-80)", background: "none", border: "none", cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <button
            type="button"
            aria-label="Close"
            style={{
              position: "absolute",
              inset: 0,
              background: "oklch(0.22 0.035 45 / 0.40)",
              backdropFilter: "blur(4px)",
              border: "none",
              cursor: "default",
            }}
            onClick={() => setEditing(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit closet item"
            style={{
              position: "relative",
              zIndex: 1,
              width: "100%",
              maxWidth: "32rem",
              background: "var(--bg)",
              color: "var(--fg)",
              padding: "1.5rem 2rem",
            }}
          >
            <div style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.32em", color: "var(--fg-55)" }}>Edit Item</div>
            <h3
              style={{
                fontFamily: "var(--ff-display)",
                fontWeight: 200,
                marginTop: "0.75rem",
                fontSize: "1.5rem",
                textTransform: "uppercase",
              }}
            >
              Edit Closet Item
            </h3>
            <p style={{ marginTop: "0.75rem", fontSize: "0.85rem", lineHeight: 1.625, color: "var(--fg-70)" }}>
              Update the label, category, or replace the photograph.
            </p>
            <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
              <button type="button" className="mn-btn-outline" onClick={() => setEditing(null)}>Cancel</button>
              <button type="button" className="mn-btn-primary" onClick={() => setEditing(null)}>Save</button>
            </div>
          </div>
        </div>
      )}
    </MyNaiaLayout>
  );
}
