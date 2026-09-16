// app/routes/admin.naia.customers._index.tsx
//
// nAia Admin — Customer list.
// Read-only. "What does nAia think it knows about each customer?"
//
// Auth: requireAdminSession (internal cookie session).
// No PII beyond email (admin-only portal — email is needed for identification).

import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import {
  getAdminCustomerList,
  type AdminCustomerSummary,
} from "~/lib/admin/closet-intelligence.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAdminSession(request);
  const customers = await getAdminCustomerList();
  return Response.json({ customers });
}

function displayDate(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function customerLabel(c: AdminCustomerSummary): string {
  if (c.firstName || c.lastName) {
    return [c.firstName, c.lastName].filter(Boolean).join(" ");
  }
  if (c.email) return c.email;
  return c.id.slice(0, 8);
}

export default function AdminCustomersIndexPage() {
  const { customers } = useLoaderData() as { customers: AdminCustomerSummary[] };

  return (
    <div className="na-page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <div>
          <h1 className="na-page-heading" style={{ marginBottom: "0.25rem" }}>Customers</h1>
          <p style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            {customers.length} customer{customers.length !== 1 ? "s" : ""} · What does nAia know about each person?
          </p>
        </div>
      </div>

      {customers.length === 0 ? (
        <div className="na-card">
          <div className="na-card__body">
            <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>No customers found.</p>
          </div>
        </div>
      ) : (
        <div className="na-card">
          <div className="na-card__body" style={{ padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #1f2937" }}>
                  {["Customer", "Email", "Passport", "Closet", "Plan", "Joined"].map(h => (
                    <th
                      key={h}
                      style={{
                        padding: "0.6rem 1rem",
                        textAlign: "left",
                        fontSize: "0.65rem",
                        color: "#6b7280",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c, i) => (
                  <tr
                    key={c.id}
                    style={{
                      borderBottom: i < customers.length - 1 ? "1px solid #111827" : undefined,
                      transition: "background 0.1s",
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#111827")}
                    onMouseLeave={e => (e.currentTarget.style.background = "")}
                  >
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <Link
                        to={`/admin/naia/customers/${c.id}`}
                        style={{ color: "#e5e7eb", textDecoration: "none", fontWeight: 500, fontSize: "0.85rem" }}
                      >
                        {customerLabel(c)}
                      </Link>
                    </td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <span style={{ fontSize: "0.78rem", color: "#9ca3af" }}>{c.email ?? "—"}</span>
                    </td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      {c.passportComplete ? (
                        <span style={{ fontSize: "0.7rem", color: "#34d399", background: "#064e3b20", border: "1px solid #064e3b", padding: "0.1rem 0.5rem", borderRadius: "4px" }}>
                          Complete {c.profileVersion ? `· V${c.profileVersion}` : ""}
                        </span>
                      ) : c.profileVersion != null ? (
                        <span style={{ fontSize: "0.7rem", color: "#f59e0b", background: "#78350f20", border: "1px solid #78350f", padding: "0.1rem 0.5rem", borderRadius: "4px" }}>
                          Partial
                        </span>
                      ) : (
                        <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>None</span>
                      )}
                    </td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <Link
                        to={`/admin/naia/closet?customerId=${c.id}`}
                        style={{ fontSize: "0.78rem", color: "#9ca3af", textDecoration: "none" }}
                      >
                        {c.closetItemCount} item{c.closetItemCount !== 1 ? "s" : ""}
                      </Link>
                    </td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                        {c.membershipStatus.toLowerCase().replace(/_/g, " ")}
                      </span>
                    </td>
                    <td style={{ padding: "0.65rem 1rem" }}>
                      <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>{displayDate(c.createdAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
