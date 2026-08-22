import { redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form, Link } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getEditorialReportById,
  createEditorialReport,
  updateEditorialReport,
} from "../lib/editorial-reports.server";

const VISUAL_TREATMENTS = [
  { value: "", label: "None" },
  { value: "soft-structure", label: "Soft Structure" },
  { value: "modern-tailoring", label: "Modern Tailoring" },
  { value: "colour-direction", label: "Colour Direction" },
];

const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

function parseJson(raw: string, fallback: unknown) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function fd(form: FormData, key: string): string {
  return (form.get(key) as string | null)?.trim() ?? "";
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  if (params.id === "new") return { report: null };
  const report = await getEditorialReportById(params.id!);
  if (!report) throw new Response("Not Found", { status: 404 });
  return { report };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const form = await request.formData();

  const data = {
    slug:              fd(form, "slug"),
    title:             fd(form, "title"),
    season:            fd(form, "season"),
    mood:              fd(form, "mood") || null,
    status:            (fd(form, "status") || "DRAFT") as "DRAFT" | "PUBLISHED" | "ARCHIVED",
    publishedAt:       fd(form, "publishedAt"),
    order:             parseInt(fd(form, "order") || "0", 10),
    featured:          form.get("featured") === "on",
    summary:           fd(form, "summary"),
    editorialIntro:    fd(form, "editorialIntro"),
    naiaTake:          fd(form, "naiaTake") || null,
    naiaInterpretation: fd(form, "naiaInterpretation") || null,
    naiaVerdict:       fd(form, "naiaVerdict") || null,
    wardrobeNote:      fd(form, "wardrobeNote") || null,
    investmentNotes:   fd(form, "investmentNotes") || null,
    keyTrends:         parseJson(fd(form, "keyTrends"), []),
    rising:            parseJson(fd(form, "rising"), []),
    fading:            parseJson(fd(form, "fading"), []),
    referencesBehindThisEdit: parseJson(fd(form, "referencesBehindThisEdit"), []),
    howToWear:         parseJson(fd(form, "howToWear"), []),
    sources:           parseJson(fd(form, "sources"), []),
    spendSaveSkip:     parseJson(fd(form, "spendSaveSkip"), {}),
    visualTreatment:   fd(form, "visualTreatment") || null,
  };

  if (params.id === "new") {
    await createEditorialReport(data);
  } else {
    await updateEditorialReport(params.id!, data);
  }
  return redirect("/app/trend-reports");
}

const s = {
  page:    { padding: "24px 32px", fontFamily: "system-ui, sans-serif", maxWidth: 880, margin: "0 auto" },
  h1:      { fontSize: 20, fontWeight: 600, marginBottom: 4 },
  sub:     { fontSize: 13, color: "#666", marginBottom: 24 },
  back:    { fontSize: 13, color: "#555", textDecoration: "none", display: "inline-block", marginBottom: 16 },
  section: { marginBottom: 32 },
  secH:    { fontSize: 13, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: "#888", marginBottom: 12, borderBottom: "1px solid #eee", paddingBottom: 6 },
  grid2:   { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  field:   { marginBottom: 16 },
  label:   { display: "block", fontSize: 12, fontWeight: 600, color: "#444", marginBottom: 4 },
  note:    { fontSize: 11, color: "#999", marginTop: 3 },
  input:   { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13, boxSizing: "border-box" as const },
  textarea: { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 12, fontFamily: "monospace", boxSizing: "border-box" as const, resize: "vertical" as const },
  select:  { padding: "8px 10px", borderRadius: 6, border: "1px solid #ccc", fontSize: 13 },
  row:     { display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" as const },
  btnPrim: { padding: "10px 24px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 14, background: "#111", color: "#fff", fontWeight: 600 },
  btnSec:  { padding: "10px 16px", borderRadius: 6, border: "1px solid #ccc", cursor: "pointer", fontSize: 14, background: "#fff", color: "#333", textDecoration: "none", display: "inline-block" },
};

function Field({ name, label, note, children }: { name: string; label: string; note?: string; children: React.ReactNode }) {
  return (
    <div style={s.field}>
      <label htmlFor={name} style={s.label}>{label}</label>
      {children}
      {note && <p style={s.note}>{note}</p>}
    </div>
  );
}

function TextInput({ name, value, required, placeholder }: { name: string; value?: string; required?: boolean; placeholder?: string }) {
  return <input id={name} name={name} defaultValue={value ?? ""} required={required} placeholder={placeholder} style={s.input} />;
}

function TextArea({ name, value, rows = 4, mono = false }: { name: string; value?: string; rows?: number; mono?: boolean }) {
  return <textarea id={name} name={name} defaultValue={value ?? ""} rows={rows} style={{ ...s.textarea, fontFamily: mono ? "monospace" : "system-ui, sans-serif" }} />;
}

function JsonArea({ name, value }: { name: string; value: unknown }) {
  return <textarea id={name} name={name} defaultValue={JSON.stringify(value ?? [], null, 2)} rows={6} style={s.textarea} />;
}

type DbReport = Awaited<ReturnType<typeof getEditorialReportById>>;

export default function TrendReportEdit() {
  const { report } = useLoaderData() as { report: DbReport };
  const isNew = !report;
  const title = isNew ? "New Report" : `Edit: ${report.title}`;

  return (
    <div style={s.page}>
      <Link to="/app/trend-reports" style={s.back}>← All reports</Link>
      <h1 style={s.h1}>{title}</h1>
      <p style={s.sub}>{isNew ? "Create a new editorial trend report." : `Last updated ${new Date(report.updatedAt).toLocaleString("en-GB")}`}</p>

      <Form method="post">

        {/* ── Identity ─────────────────────────────────────────────────── */}
        <div style={s.section}>
          <p style={s.secH}>Identity</p>
          <div style={s.grid2}>
            <Field name="slug" label="Slug (URL key)" note="Unique. e.g. spring-2026-soft-structure">
              <TextInput name="slug" value={report?.slug} required />
            </Field>
            <Field name="title" label="Title" note="Display title">
              <TextInput name="title" value={report?.title} required />
            </Field>
            <Field name="season" label="Season" note="e.g. Spring 2026">
              <TextInput name="season" value={report?.season} required />
            </Field>
            <Field name="mood" label="Mood (optional)">
              <TextInput name="mood" value={report?.mood ?? ""} placeholder="e.g. relaxed precision" />
            </Field>
          </div>
        </div>

        {/* ── Publishing ───────────────────────────────────────────────── */}
        <div style={s.section}>
          <p style={s.secH}>Publishing</p>
          <div style={s.grid2}>
            <Field name="status" label="Status">
              <select id="status" name="status" defaultValue={report?.status ?? "DRAFT"} style={s.select}>
                {STATUSES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field name="publishedAt" label="Published at (ISO date)" note="e.g. 2026-03-15">
              <TextInput name="publishedAt" value={report?.publishedAt ?? ""} placeholder="2026-03-15" />
            </Field>
            <Field name="order" label="Order" note="Lower = shown first">
              <TextInput name="order" value={String(report?.order ?? 0)} />
            </Field>
            <Field name="visualTreatment" label="Visual treatment">
              <select id="visualTreatment" name="visualTreatment" defaultValue={report?.visualTreatment ?? ""} style={s.select}>
                {VISUAL_TREATMENTS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={s.field}>
            <label style={{ ...s.label, display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" name="featured" defaultChecked={report?.featured ?? false} />
              Featured (shows as hero on the list page)
            </label>
          </div>
        </div>

        {/* ── Written content ──────────────────────────────────────────── */}
        <div style={s.section}>
          <p style={s.secH}>Written Content</p>
          <Field name="summary" label="Summary" note="Short editorial summary shown on the list page">
            <TextArea name="summary" value={report?.summary} rows={3} />
          </Field>
          <Field name="editorialIntro" label="Editorial intro" note="Opening paragraph on the report page">
            <TextArea name="editorialIntro" value={report?.editorialIntro} rows={5} />
          </Field>
          <div style={s.grid2}>
            <Field name="naiaTake" label="nAia Take">
              <TextArea name="naiaTake" value={report?.naiaTake ?? ""} rows={3} />
            </Field>
            <Field name="wardrobeNote" label="Wardrobe Note">
              <TextArea name="wardrobeNote" value={report?.wardrobeNote ?? ""} rows={3} />
            </Field>
            <Field name="naiaInterpretation" label="nAia Interpretation">
              <TextArea name="naiaInterpretation" value={report?.naiaInterpretation ?? ""} rows={3} />
            </Field>
            <Field name="naiaVerdict" label="nAia Verdict">
              <TextArea name="naiaVerdict" value={report?.naiaVerdict ?? ""} rows={3} />
            </Field>
          </div>
          <Field name="investmentNotes" label="Investment Notes">
            <TextArea name="investmentNotes" value={report?.investmentNotes ?? ""} rows={3} />
          </Field>
        </div>

        {/* ── Structured JSON ──────────────────────────────────────────── */}
        <div style={s.section}>
          <p style={s.secH}>Structured Data (JSON)</p>
          <p style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>
            Each field accepts a JSON array or object. Invalid JSON is silently ignored and replaced with the default empty value.
          </p>
          <div style={s.grid2}>
            <Field name="keyTrends" label="Key Trends" note="Array of { name, description, naiaRead? }">
              <JsonArea name="keyTrends" value={report?.keyTrends} />
            </Field>
            <Field name="spendSaveSkip" label="Spend / Save / Skip" note="Object with spend, save, alreadyOwn keys">
              <JsonArea name="spendSaveSkip" value={report?.spendSaveSkip} />
            </Field>
            <Field name="rising" label="Rising signals" note="Array of { trend, why }">
              <JsonArea name="rising" value={report?.rising} />
            </Field>
            <Field name="fading" label="Fading signals" note="Array of { trend, why }">
              <JsonArea name="fading" value={report?.fading} />
            </Field>
            <Field name="howToWear" label="How to Wear" note="Array of { feeling, direction }">
              <JsonArea name="howToWear" value={report?.howToWear} />
            </Field>
            <Field name="referencesBehindThisEdit" label="References Behind This Edit" note="Array of { label, quote?, why }">
              <JsonArea name="referencesBehindThisEdit" value={report?.referencesBehindThisEdit} />
            </Field>
          </div>
          <Field name="sources" label="Sources" note="Array of { label, url, date?, note? }">
            <JsonArea name="sources" value={report?.sources} />
          </Field>
        </div>

        {/* ── Actions ──────────────────────────────────────────────────── */}
        <div style={s.row}>
          <button type="submit" style={s.btnPrim}>Save report</button>
          <Link to="/app/trend-reports" style={s.btnSec}>Cancel</Link>
        </div>

      </Form>
    </div>
  );
}
