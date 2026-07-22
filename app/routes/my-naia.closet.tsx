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
  TOPS: "Tops",
  BOTTOMS: "Bottoms",
  DRESSES: "Dresses",
  OUTERWEAR: "Outerwear",
  SHOES: "Shoes",
  BAGS: "Bags",
  ACCESSORIES: "Accessories",
  JEWELRY: "Jewelry",
  ACTIVEWEAR: "Activewear",
  SWIMWEAR: "Swimwear",
  LOUNGEWEAR: "Loungewear",
  OTHER: "Other",
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
    <MyNaiaLayout currentPath="/my-naia/closet">

      <section className="mn-section-shell" style={{ borderTop: 0, paddingTop: 0 }}>
        <div className="mn-section-shell-header">
          <div>
            <p className="mn-section-shell-eyebrow">My Closet</p>
            <h1 className="mn-section-shell-title">Your digital wardrobe.</h1>
          </div>
          <Link to="/closet" className="mn-btn-outline">
            Upload Item
          </Link>
        </div>
        {items.length > 0 && (
          <p className="mn-section-shell-desc">
            {items.length} {items.length === 1 ? "piece" : "pieces"} in your digital wardrobe.
            nAia uses these when building looks for you.
          </p>
        )}
      </section>

      {items.length === 0 ? (
        <div>
          <p className="mn-state-note" style={{ marginBottom: "var(--naia-sp-6)" }}>
            Your digital closet is empty. Add one piece at a time and nAia will
            begin styling from your own wardrobe.
          </p>
          <Link to="/closet" className="mn-btn-primary">
            Upload Item
          </Link>
        </div>
      ) : (
        <>
          {/* Filter tabs + search */}
          <div className="mn-closet-filters">
            <div className="mn-closet-filter-tabs">
              {(["All", "Clothing", "Shoes", "Bags"] as FilterTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`mn-closet-filter-tab${activeTab === tab ? " mn-closet-filter-tab--active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
            <div className="mn-closet-search">
              <label htmlFor="closet-search" className="mn-closet-search-label">
                Search
              </label>
              <input
                id="closet-search"
                type="search"
                className="mn-closet-search-input"
                placeholder="Item name or brand..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Item list */}
          {filtered.length === 0 ? (
            <p className="mn-state-note" style={{ marginTop: "var(--naia-sp-6)" }}>
              No items match your filter.
            </p>
          ) : (
            <div className="mn-closet-list" style={{ marginTop: "var(--naia-sp-6)" }}>
              {filtered.map((item) => (
                <div key={item.id} className="mn-closet-item">
                  <div className="mn-closet-item-thumb">
                    {(item.thumbnailUrl || item.imageUrl) ? (
                      <img
                        src={(item.thumbnailUrl ?? item.imageUrl)!}
                        alt={item.name ?? CATEGORY_LABELS[item.category] ?? item.category}
                      />
                    ) : (
                      <span style={{ fontSize: "1.5rem", opacity: 0.25 }}>&#128247;</span>
                    )}
                  </div>
                  <div className="mn-closet-item-body">
                    <p className="mn-closet-item-category">
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </p>
                    <p className="mn-closet-item-name">
                      {item.name ?? "Unnamed piece"}
                    </p>
                    {item.brand && (
                      <p className="mn-closet-item-status">{item.brand}</p>
                    )}
                    {item.colors.length > 0 && (
                      <p className="mn-closet-item-status">
                        {item.colors.slice(0, 3).join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="mn-closet-item-actions">
                    <Link
                      to={`/closet?edit=${item.id}`}
                      className="mn-closet-item-action"
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: "var(--naia-sp-8)" }}>
            <Link to="/closet" className="mn-btn-outline">
              Manage Closet
            </Link>
          </div>
        </>
      )}

    </MyNaiaLayout>
  );
}
