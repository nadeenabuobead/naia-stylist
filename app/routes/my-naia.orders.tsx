import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

const SAMPLE = [
  {
    number: "NDN-1042",
    date: "10 March 2026",
    status: "In transit",
    total: "AED 3,940",
    items: "Silk Draped Blouse · Fluid Trouser",
    tracking: "In transit — Emirates Post",
    returnable: false,
  },
  {
    number: "NDN-1027",
    date: "02 February 2026",
    status: "Delivered",
    total: "AED 2,120",
    items: "Cotton Poplin Dress",
    tracking: "Delivered · 05 February 2026",
    returnable: true,
  },
];

export default function OrdersPage() {
  const empty = false;
  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        <section>
          <div className="mn-eyebrow">Orders</div>
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
            Orders
          </h1>
          <p style={{ marginTop: "1rem", maxWidth: "42rem", fontSize: "0.9rem", lineHeight: 1.75, color: "var(--fg-75)" }}>
            Your NADINE order history. Real orders will appear here once your Shopify customer account is linked.
          </p>
        </section>

        {empty ? (
          <div style={{ border: "1px solid var(--fg-10)", background: "var(--bg-50)", padding: "2rem", textAlign: "center" }}>
            <p style={{ fontSize: "0.95rem", lineHeight: 1.75, color: "var(--fg-75)" }}>Your orders will appear here.</p>
          </div>
        ) : (
          <div style={{ borderTop: "1px solid var(--fg-10)", borderBottom: "1px solid var(--fg-10)" }}>
            {SAMPLE.map((o) => (
              <article
                key={o.number}
                style={{
                  display: "grid",
                  gap: "1rem",
                  padding: "1.5rem 0",
                  borderBottom: "1px solid var(--fg-10)",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  alignItems: "flex-start",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.28em", color: "var(--fg-55)" }}>
                    {o.date} · Order {o.number}
                  </div>
                  <div style={{ fontFamily: "var(--ff-display)", fontWeight: 300, marginTop: "0.5rem", fontSize: "1.25rem", letterSpacing: "0.02em", textTransform: "uppercase" }}>
                    {o.items}
                  </div>
                  <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.25rem", fontSize: "0.85rem", color: "var(--fg-75)" }}>
                    <div><span style={{ color: "var(--fg-55)" }}>Status ·</span> {o.status}</div>
                    <div><span style={{ color: "var(--fg-55)" }}>Total ·</span> {o.total}</div>
                    <div><span style={{ color: "var(--fg-55)" }}>Tracking ·</span> {o.tracking}</div>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <button type="button" className="mn-btn-outline">View Order</button>
                  <button type="button" className="mn-btn-outline">Track Order</button>
                  {o.returnable && (
                    <button type="button" className="mn-btn-outline">Request a Return</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="mn-state-note">
          Return eligibility depends on the returns window and product condition — see our Returns &amp; Refunds page for details.
        </p>
      </div>
    </MyNaiaLayout>
  );
}
