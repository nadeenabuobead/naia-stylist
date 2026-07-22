import { useState } from "react";
import { useLoaderData, Link } from "react-router";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import { prisma } from "~/lib/prisma.server";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

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
    select: { id: true, name: true, category: true, thumbnailUrl: true, imageUrl: true, brand: true, colors: true },
  });
  return { items };
}

type FilterTab = "All" | "Clothing" | "Shoes" | "Bags";

function isClothing(category: string): boolean {
  return CLOTHING_CATEGORIES.includes(category as typeof CLOTHING_CATEGORIES[number]);
}

export default function MyNaiaCloset() {
  const { items } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<FilterTab>("All");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = items.filter((item) => {
    const matchesTab =
      activeTab === "All" ||
      (activeTab === "Shoes" && item.category === "SHOES") ||
      (activeTab === "Bags" && item.category === "BAGS") ||
      (activeTab === "Clothing" && isClothing(item.category));
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      (item.name ?? "").toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q) ||
      (item.brand ?? "").toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">

        <Link to="/my-naia" className="mn-back-link">
          <span aria-hidden="true">←</span> Back to Overview
        </Link>

        {/* Header */}
        <section>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "1rem" }}>
            <div>
              <div className="mn-eyebrow">My Closet</div>
              <h1 style={{ fontFamily: "var(--ff-display)", fontWeight: 200, marginTop: "0.75rem", fontSize: "clamp(1.875rem,5vw,2.25rem)", lineHeight: 1, letterSpacing: "0.02em", textTransform: "uppercase" }}>
                Your Digital Wardrobe
              </h1>
            </div>
            <Link to="/closet" className="mn-btn-outline">Upload Item</Link>
          </div>
          {items.length > 0 && (
            <p style={{ marginTop: "1rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
              {items.length} {items.length === 1 ? "piece" : "pieces"} in your digital wardrobe.
              nAia uses these when building looks for you.
            </p>
          )}
        </section>

        {items.length === 0 ? (
          <>
            <p className="mn-state-note">
              Your digital closet is empty. Add one piece at a time and nAia will begin
              styling from your own wardrobe.
            </p>
            <div>
              <Link to="/closet" className="mn-btn-primary">Upload First Item</Link>
            </div>
          </>
        ) : (
          <>
            {/* Filter bar */}
            <div className="mn-closet-filter-bar">
              <div className="mn-filter-tabs">
                {(["All", "Clothing", "Shoes", "Bags"] as FilterTab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`mn-filter-tab${activeTab === tab ? " mn-active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div style={{ flex: "1 1 auto", maxWidth: "24rem" }}>
                <label htmlFor="closet-search" style={{ display: "block", marginBottom: "0.5rem" }} className="mn-eyebrow">
                  Search
                </label>
                <input
                  id="closet-search"
                  type="search"
                  className="mn-search-input"
                  placeholder="Item name or brand…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Item list */}
            {filtered.length === 0 ? (
              <p className="mn-state-note">No items match your filter.</p>
            ) : (
              <div className="mn-closet-list">
                {filtered.map((item) => {
                  const thumb = item.thumbnailUrl ?? item.imageUrl;
                  const altText = item.name ?? CATEGORY_LABELS[item.category] ?? item.category;
                  return (
                    <div key={item.id} className="mn-closet-item">
                      <div className="mn-closet-item-thumb">
                        {thumb ? (
                          <img src={thumb} alt={altText} />
                        ) : (
                          <span aria-hidden="true" style={{ opacity: 0.3, fontSize: "0.875rem" }}>&#9633;</span>
                        )}
                      </div>
                      <div>
                        <div className="mn-closet-item-category">
                          {CATEGORY_LABELS[item.category] ?? item.category}
                        </div>
                        <div className="mn-closet-item-name">{item.name ?? "Unnamed piece"}</div>
                        {item.brand && (
                          <div className="mn-closet-item-meta">{item.brand}</div>
                        )}
                        {item.colors.length > 0 && (
                          <div className="mn-closet-item-meta">
                            {item.colors.slice(0, 3).join(" · ")}
                          </div>
                        )}
                      </div>
                      <Link to={`/closet?edit=${item.id}`} className="mn-closet-item-edit">
                        Edit
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <Link to="/closet" className="mn-btn-outline">Manage Closet</Link>
            </div>
          </>
        )}

      </div>
    </MyNaiaLayout>
  );
}
