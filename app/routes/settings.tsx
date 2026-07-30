import type { LoaderFunctionArgs, LinksFunction } from "react-router";
import { Link, useLoaderData, Form } from "react-router";
import { requireCurrentNaiaCustomer } from "~/lib/naia-session.server";
import naiaStyles from "~/styles/naia-design-system.css?url";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: naiaStyles },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const customer = await requireCurrentNaiaCustomer(request);
  return {
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    shopifyCustomerId: customer.shopifyCustomerId,
  };
}

export default function Settings() {
  const { firstName, lastName, email } = useLoaderData<typeof loader>();

  return (
    <div className="sm-page">
      <div className="sm-inner" style={{ maxWidth: "640px" }}>

        <div style={{ marginBottom: "32px" }}>
          <p className="sm-eyebrow" style={{ marginBottom: "12px" }}>Settings & Privacy</p>
          <h1 className="sm-heading">Your nAia account</h1>
        </div>

        <section style={{ marginBottom: "40px" }}>
          <p className="sm-eyebrow" style={{ marginBottom: "16px" }}>Identity</p>
          <div style={{ padding: "20px 24px", background: "var(--c-surface, #fff)", border: "1px solid var(--c-border, #e5e0d8)" }}>
            <p style={{ margin: "0 0 4px", fontFamily: "var(--ff-ui, sans-serif)", fontSize: "12px", letterSpacing: "0.05em", color: "var(--c-muted, #7a6f6a)" }}>NAME</p>
            <p style={{ margin: "0 0 16px", fontFamily: "var(--ff-body, serif)", fontSize: "16px" }}>{[firstName, lastName].filter(Boolean).join(" ") || "—"}</p>
            <p style={{ margin: "0 0 4px", fontFamily: "var(--ff-ui, sans-serif)", fontSize: "12px", letterSpacing: "0.05em", color: "var(--c-muted, #7a6f6a)" }}>EMAIL</p>
            <p style={{ margin: "0", fontFamily: "var(--ff-body, serif)", fontSize: "16px" }}>{email || "—"}</p>
          </div>
        </section>

        <section style={{ marginBottom: "40px" }}>
          <p className="sm-eyebrow" style={{ marginBottom: "16px" }}>Your data</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            <Link
              to="/passport"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", background: "var(--c-surface, #fff)", border: "1px solid var(--c-border, #e5e0d8)", textDecoration: "none", color: "inherit" }}
            >
              <div>
                <p style={{ margin: "0 0 2px", fontFamily: "var(--ff-ui, sans-serif)", fontSize: "13px", fontWeight: 600 }}>Style Passport</p>
                <p style={{ margin: "0", fontFamily: "var(--ff-body, serif)", fontSize: "13px", fontStyle: "italic", color: "var(--c-muted, #7a6f6a)" }}>Edit your style profile and preferences</p>
              </div>
              <span style={{ color: "var(--c-burg, #8b2035)" }}>→</span>
            </Link>
            <Link
              to="/my-naia-model"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", background: "var(--c-surface, #fff)", border: "1px solid var(--c-border, #e5e0d8)", textDecoration: "none", color: "inherit" }}
            >
              <div>
                <p style={{ margin: "0 0 2px", fontFamily: "var(--ff-ui, sans-serif)", fontSize: "13px", fontWeight: 600 }}>My nAia Model</p>
                <p style={{ margin: "0", fontFamily: "var(--ff-body, serif)", fontSize: "13px", fontStyle: "italic", color: "var(--c-muted, #7a6f6a)" }}>Manage your virtual try-on model and photo consent</p>
              </div>
              <span style={{ color: "var(--c-burg, #8b2035)" }}>→</span>
            </Link>
          </div>
        </section>

        <section style={{ marginBottom: "40px" }}>
          <p className="sm-eyebrow" style={{ marginBottom: "16px" }}>Privacy</p>
          <div style={{ padding: "20px 24px", background: "var(--c-surface, #fff)", border: "1px solid var(--c-border, #e5e0d8)" }}>
            <p style={{ margin: "0 0 12px", fontFamily: "var(--ff-body, serif)", fontSize: "15px", fontStyle: "italic", lineHeight: 1.7, color: "var(--c-ink, #221516)" }}>
              nAia stores your Style Passport, closet items, styling sessions, post-wear reviews, and virtual try-on model in order to personalise your experience. Your data is never sold or shared with third parties.
            </p>
            <p style={{ margin: "0", fontFamily: "var(--ff-body, serif)", fontSize: "14px", fontStyle: "italic", lineHeight: 1.6, color: "var(--c-muted, #7a6f6a)" }}>
              To request a copy of your data or request deletion, email{" "}
              <a href="mailto:privacy@naiabynadine.com" style={{ color: "var(--c-burg, #8b2035)" }}>privacy@naiabynadine.com</a>.
              Data deletion requests are processed within 30 days.
            </p>
          </div>
        </section>

        <section>
          <Form method="post" action="/auth/logout">
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "16px 24px",
                background: "transparent",
                border: "1px solid var(--c-border, #e5e0d8)",
                textAlign: "left",
                fontFamily: "var(--ff-ui, sans-serif)",
                fontSize: "13px",
                letterSpacing: "0.05em",
                color: "var(--c-ink, #221516)",
                cursor: "pointer",
              }}
            >
              Sign Out
            </button>
          </Form>
        </section>

        <div style={{ marginTop: "32px" }}>
          <Link to="/my-naia" style={{ fontFamily: "var(--ff-ui, sans-serif)", fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--c-muted, #7a6f6a)", textDecoration: "none" }}>
            ← My nAia
          </Link>
        </div>

      </div>
    </div>
  );
}
