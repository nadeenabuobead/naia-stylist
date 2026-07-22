import type { LinksFunction } from "react-router";
import MyNaiaLayout from "~/components/my-naia/MyNaiaLayout";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: naiaStyles }];

type OrderStatus = "Delivered" | "Processing" | "Dispatched";

const SAMPLE_ORDERS: Array<{
  id: string;
  number: string;
  date: string;
  status: OrderStatus;
  total: string;
  items: string[];
  tracking?: string;
}> = [
  {
    id: "o1",
    number: "NAD-10421",
    date: "14 March 2026",
    status: "Delivered",
    total: "AED 1,290",
    items: ["Draped Silk Slip — Ivory", "Bronze Leather Sandal"],
    tracking: "Delivered 16 Mar",
  },
  {
    id: "o2",
    number: "NAD-10318",
    date: "02 February 2026",
    status: "Delivered",
    total: "AED 2,850",
    items: ["Wide-Leg Wool Trouser — Chocolate"],
    tracking: "Delivered 05 Feb",
  },
  {
    id: "o3",
    number: "NAD-10255",
    date: "18 January 2026",
    status: "Delivered",
    total: "AED 980",
    items: ["Lipstick-Red Slip — Signature"],
    tracking: "Delivered 20 Jan",
  },
];

const STATUS_COLOR: Record<OrderStatus, string> = {
  Delivered: "oklch(0.4 0.12 155)",
  Processing: "oklch(0.5 0.12 65)",
  Dispatched: "var(--lipstick)",
};

export default function OrdersPage() {
  return (
    <MyNaiaLayout>
      <div className="mn-page-sections">
        {/* Header — no BackToOverview per Lovable */}
        <section>
          <div className="mn-eyebrow">Account</div>
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
        </section>

        {/* Sample badge section */}
        <section>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div className="mn-eyebrow">Your Orders</div>
            <span className="mn-sample-badge">
              <span className="mn-sample-dot" aria-hidden="true" />
              Sample data
            </span>
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              marginTop: "1.5rem",
              borderTop: "1px solid var(--fg-12)",
            }}
          >
            {SAMPLE_ORDERS.map((order) => (
              <li
                key={order.id}
                style={{
                  borderBottom: "1px solid var(--fg-12)",
                  paddingTop: "1.5rem",
                  paddingBottom: "1.5rem",
                  display: "grid",
                  gap: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "0.5rem 2rem",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: "0.6rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.28em",
                        color: "var(--fg-55)",
                      }}
                    >
                      {order.date} · {order.number}
                    </div>
                    <ul style={{ listStyle: "none", padding: 0, marginTop: "0.5rem" }}>
                      {order.items.map((item) => (
                        <li
                          key={item}
                          style={{
                            fontFamily: "var(--ff-display)",
                            fontWeight: 300,
                            fontSize: "1.125rem",
                            letterSpacing: "0.02em",
                            textTransform: "uppercase",
                            color: "var(--fg)",
                          }}
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div
                      style={{
                        fontSize: "0.62rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.28em",
                        color: STATUS_COLOR[order.status],
                      }}
                    >
                      {order.status}
                    </div>
                    <div
                      style={{
                        marginTop: "0.25rem",
                        fontSize: "0.85rem",
                        color: "var(--fg-80)",
                      }}
                    >
                      {order.total}
                    </div>
                    {order.tracking && (
                      <div
                        style={{
                          marginTop: "0.25rem",
                          fontSize: "0.72rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.22em",
                          color: "var(--fg-55)",
                        }}
                      >
                        {order.tracking}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.75rem",
                    marginTop: "0.25rem",
                  }}
                >
                  <button type="button" className="mn-btn-outline">View</button>
                  {order.status === "Dispatched" && (
                    <button type="button" className="mn-btn-outline">Track</button>
                  )}
                  {order.status === "Delivered" && (
                    <button type="button" className="mn-btn-outline">Return</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <p className="mn-state-note">
          Returns are accepted within 14 days of delivery. Pieces must be unworn, with tags attached.
          Contact our team to initiate a return.
        </p>
      </div>
    </MyNaiaLayout>
  );
}
