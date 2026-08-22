import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form, Link } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getAllEditorialReports,
  setEditorialReportStatus,
  deleteEditorialReport,
  seedEditorialReportsFromStatic,
} from "../lib/editorial-reports.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const reports = await getAllEditorialReports();
  return { reports };
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const form = await request.formData();
  const _action = form.get("_action") as string;
  const id = form.get("id") as string | null;

  if (_action === "seed") {
    await seedEditorialReportsFromStatic();
    return redirect("/app/trend-reports");
  }
  if (_action === "publish" && id) {
    await setEditorialReportStatus(id, "PUBLISHED");
    return redirect("/app/trend-reports");
  }
  if (_action === "unpublish" && id) {
    await setEditorialReportStatus(id, "DRAFT");
    return redirect("/app/trend-reports");
  }
  if (_action === "archive" && id) {
    await setEditorialReportStatus(id, "ARCHIVED");
    return redirect("/app/trend-reports");
  }
  if (_action === "delete" && id) {
    await deleteEditorialReport(id);
    return redirect("/app/trend-reports");
  }
  return redirect("/app/trend-reports");
}

const STATUS_COLOR: Record<string, string> = {
  PUBLISHED: "#1a7f37",
  DRAFT:     "#6e6e6e",
  ARCHIVED:  "#9a3412",
};

const s = {
  page:    { padding: "24px 32px", fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto" },
  h1:      { fontSize: 22, fontWeight: 600, marginBottom: 4 },
  sub:     { fontSize: 13, color: "#666", marginBottom: 24 },
  topRow:  { display: "flex", gap: 12, marginBottom: 24, alignItems: "center" },
  btn:     { padding: "8px 16px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer", fontSize: 13, background: "#fff", textDecoration: "none", display: "inline-block", color: "#111" },
  btnPrim: { padding: "8px 16px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, background: "#111", color: "#fff", textDecoration: "none", display: "inline-block" },
  table:   { width: "100%", borderCollapse: "collapse" as const, fontSize: 13 },
  th:      { textAlign: "left" as const, padding: "8px 12px", borderBottom: "2px solid #e5e5e5", fontWeight: 600, color: "#444" },
  td:      { padding: "10px 12px", borderBottom: "1px solid #eee", verticalAlign: "top" as const },
  badge:   (status: string) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600, color: "#fff", background: STATUS_COLOR[status] ?? "#888" }),
  actRow:  { display: "flex", gap: 6, flexWrap: "wrap" as const },
  actBtn:  { padding: "4px 10px", borderRadius: 4, border: "1px solid #ccc", cursor: "pointer", fontSize: 12, background: "#fff", color: "#333" },
  empty:   { padding: "48px 0", textAlign: "center" as const, color: "#888" },
};

type Report = {
  id: string; slug: string; title: string; season: string;
  status: string; order: number; featured: boolean; updatedAt: Date;
};

function ActionBtn({ id, action, label }: { id: string; action: string; label: string }) {
  return (
    <Form method="post" style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <button name="_action" value={action} style={s.actBtn} type="submit">{label}</button>
    </Form>
  );
}

export default function TrendReportsList() {
  const { reports } = useLoaderData() as { reports: Report[] };

  return (
    <div style={s.page}>
      <h1 style={s.h1}>Trend Reports</h1>
      <p style={s.sub}>Manage editorial trend reports. Changes take effect immediately for published reports.</p>

      <div style={s.topRow}>
        <Link to="/app/trend-reports/new" style={s.btnPrim}>+ New Report</Link>
        <Form method="post">
          <button name="_action" value="seed" style={s.btn} type="submit">
            Seed from static data
          </button>
        </Form>
      </div>

      {reports.length === 0 ? (
        <div style={s.empty}>
          <p>No reports yet. Use "Seed from static data" to import the existing 3 reports, or create a new one.</p>
        </div>
      ) : (
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>#</th>
              <th style={s.th}>Title</th>
              <th style={s.th}>Slug</th>
              <th style={s.th}>Season</th>
              <th style={s.th}>Status</th>
              <th style={s.th}>Updated</th>
              <th style={s.th}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td style={s.td}>{r.order}</td>
                <td style={s.td}>
                  <strong>{r.title}</strong>
                  {r.featured && <span style={{ marginLeft: 6, fontSize: 10, color: "#b45309" }}>★ Featured</span>}
                </td>
                <td style={{ ...s.td, fontFamily: "monospace", fontSize: 11, color: "#555" }}>{r.slug}</td>
                <td style={s.td}>{r.season}</td>
                <td style={s.td}><span style={s.badge(r.status)}>{r.status}</span></td>
                <td style={{ ...s.td, color: "#888", fontSize: 11 }}>
                  {new Date(r.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })}
                </td>
                <td style={s.td}>
                  <div style={s.actRow}>
                    <Link to={`/app/trend-reports/${r.id}`} style={s.actBtn}>Edit</Link>
                    {r.status !== "PUBLISHED" && <ActionBtn id={r.id} action="publish" label="Publish" />}
                    {r.status === "PUBLISHED" && <ActionBtn id={r.id} action="unpublish" label="Unpublish" />}
                    {r.status !== "ARCHIVED" && <ActionBtn id={r.id} action="archive" label="Archive" />}
                    <ActionBtn id={r.id} action="delete" label="Delete" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
