// app/routes/auth.signed-out.tsx
//
// The logged-out landing page auth.logout redirects into. Deliberately inert:
// no loader, no useEffect, no meta-refresh, nothing that starts Shopify OAuth
// on its own. A customer lands here right after Sign Out and must stay here
// — logged out — until they explicitly click Sign In.
//
// The Sign In control is a plain <a href>, not a React Router <Link>. The
// destination, /auth/shopify/login with no existing nAia session, returns a
// terminal HTML document (its own inline script is what starts the real
// Shopify redirect) rather than normal loader data — the same shape that
// caused the Sign Out blank-page regression when reached via a client-side
// transition. A plain anchor always performs a full browser navigation, so
// that page loads correctly here exactly as it does for Sign Out's own
// reloadDocument form.
//
// Temporary: the Lovable public site will replace this as the natural
// logged-out destination. Kept visually simple and consistent with nAia
// until then.

export function meta() {
  return [{ title: "Signed Out | nAia" }];
}

export default function SignedOut() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        background: "#F6EFE8",
        color: "#28150C",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        textAlign: "center",
      }}
    >
      <div>
        <p style={{ fontSize: "1.1rem", opacity: 0.75, margin: "0 0 28px" }}>
          You've been signed out of nAia.
        </p>
        <a
          href="/auth/shopify/login?return_to=%2Fmy-naia"
          style={{
            display: "inline-block",
            fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
            fontSize: "0.875rem",
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "#6B1D26",
            textDecoration: "none",
            border: "1px solid #6B1D26",
            borderRadius: "999px",
            padding: "11px 28px",
          }}
        >
          Sign In
        </a>
      </div>
    </div>
  );
}
