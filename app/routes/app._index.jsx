import { Link } from "react-router";
import { authenticate } from "../shopify.server";

// app._index.jsx is the embedded app's Shopify Admin "Home" page — this is
// where a merchant lands when they open nAia Stylist from their Admin's Apps
// list. Retired 2026-11-02 (security remediation): this used to be a full
// AI-stylist-preview prototype (closet builder, mood/feeling inputs, a
// product-matching scorer) that called /api/style directly, which had no
// auth gate of its own. Both the prototype UI and api/style are now gone —
// see app/routes.ts for the route-retirement note. Real admin tooling lives
// at /app/naia-admin; real customer-facing styling lives at /style-me.

export async function loader({ request }) {
  // The try/catch here is load-bearing, not just defensive: calling
  // authenticate.admin() unconditionally from this specific loader and
  // letting a failure propagate causes a token-exchange auth bounce loop on
  // the embedded app's very first load ("too many redirects"). See
  // closet-intelligence.test.ts §CI.35. Do not remove this try/catch or move
  // the auth check to the parent app.jsx layout.
  try {
    await authenticate.admin(request);
  } catch (e) {
    // Fall through to the same landing view regardless — there is no
    // protected data left to fetch on this page. Leaf routes (naia-admin,
    // designer-intelligence, etc.) each do their own real auth check.
  }
  return {};
}

export default function Index() {
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;

  // Preserve embedded context so Shopify auth params (embedded, host, shop)
  // travel with the navigation and don't trigger a shopify.com redirect
  // inside the iframe.
  const naiaAdminHref = (() => {
    const qs = new URLSearchParams();
    for (const k of ["embedded", "host", "shop"]) {
      const v = params?.get(k);
      if (v) qs.set(k, v);
    }
    return `/app/naia-admin${qs.size > 0 ? `?${qs}` : ""}`;
  })();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f6f3ef",
        color: "#1d1b19",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        padding: "40px 24px 80px",
      }}
    >
      <div style={{ maxWidth: "640px", margin: "0 auto", textAlign: "center" }}>
        <div
          style={{
            fontSize: "12px",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#7b6f63",
            marginBottom: "16px",
            fontWeight: 600,
          }}
        >
          nAia Stylist
        </div>
        <h1
          style={{
            fontSize: "40px",
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            margin: "0 0 18px 0",
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontWeight: 600,
          }}
        >
          Welcome to nAia
        </h1>
        <p style={{ fontSize: "17px", lineHeight: 1.7, color: "#5b5148", margin: "0 0 28px 0" }}>
          Customer styling, closet, and try-on tools live in the nAia Admin dashboard.
        </p>
        <Link
          to={naiaAdminHref}
          style={{
            display: "inline-block",
            padding: "13px 24px",
            borderRadius: "999px",
            border: "none",
            background: "#1d1b19",
            color: "#f7f3ef",
            textDecoration: "none",
            fontSize: "15px",
            fontWeight: 600,
          }}
        >
          Go to nAia Admin →
        </Link>
      </div>
    </div>
  );
}
