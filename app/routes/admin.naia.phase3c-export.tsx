// app/routes/admin.naia.phase3c-export.tsx
//
// Phase 3C V1 QA Export — internal admin download route.
//
// Auth:   requireAdminSession called in BOTH loader and action.
//         Parent admin.tsx also runs requireAdminSession in its loader
//         (belt and suspenders — actions do not inherit parent loader auth).
//
// Safety: read-only. No DB writes. No Phase 3C or StyleMe logic changes.
//
// Outputs:
//   POST intent=html  → self-contained HTML file with base64-embedded images
//   POST intent=json  → machine-readable JSON
//
// URL: /admin/naia/phase3c-export

import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requireAdminSession } from "~/lib/internal-auth.server";
import { generatePhase3CQAExport } from "~/lib/admin/phase3c-qa-export.server";

// ── Loader ────────────────────────────────────────────────────────────────────
// GET /admin/naia/phase3c-export            → page UI
// GET /admin/naia/phase3c-export?intent=html → download HTML file
// GET /admin/naia/phase3c-export?intent=json → download JSON file

export async function loader({ request }: LoaderFunctionArgs) {
  const { identity } = await requireAdminSession(request);

  const url = new URL(request.url);
  const intent = url.searchParams.get("intent");

  if (intent === "html" || intent === "json") {
    const { htmlContent, jsonContent } = await generatePhase3CQAExport();
    if (intent === "json") {
      return new Response(jsonContent, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": 'attachment; filename="phase3c-qa-export.json"',
          "Cache-Control": "no-store",
        },
      });
    }
    return new Response(htmlContent, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": 'attachment; filename="phase3c-qa-export.html"',
        "Cache-Control": "no-store",
      },
    });
  }

  return Response.json({ identity });
}

// ── UI ────────────────────────────────────────────────────────────────────────

export default function Phase3CQAExportPage() {
  const { identity } = useLoaderData<typeof loader>();

  return (
    <div style={styles.shell}>
      <div style={styles.header}>
        <div style={styles.titleRow}>
          <span style={styles.badge}>DIAGNOSTIC · SHADOW ONLY</span>
          <h1 style={styles.title}>Phase 3C V1 — QA Export</h1>
        </div>
        <p style={styles.desc}>
          Generates a complete audit report for every Closet item: effective admin-corrected
          classifications, visual weight, colour profile, and all 12 passport-aware intention
          potentials. Read-only — no database writes, no Phase 3C or StyleMe logic changes.
        </p>
        <p style={styles.identity}>Signed in as {identity.email}</p>
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Export Contents</h2>
        <ul style={styles.list}>
          <li>Every Closet item (all categories)</li>
          <li>Effective admin-corrected classification per item</li>
          <li>Garment images embedded as base64 — no expiring URLs, no session dependency</li>
          <li>Anonymised customer labels (Customer A / B / C …) — no emails or names</li>
          <li>Passport context (stylePersonalities, favoriteColors, coverage, dressing)</li>
          <li>Visual weight: value + all evidence signals</li>
          <li>Colour profile: neutralChromaticity + broadFamily + lightDark + energyTier + evidence</li>
          <li>All 12 intention potentials with every contributing signal (or NO SIGNALS)</li>
          <li>Aggregate summary: signal frequencies, NO SIGNALS counts, tag/personality counts</li>
        </ul>

        <div style={styles.timing}>
          Image fetching runs server-side (up to 120 s). Large closets may take 30–60 s.
        </div>
      </div>

      <div style={styles.actionsRow}>
        <button
          type="button"
          onClick={() => { window.location.href = "/admin/naia/phase3c-export?intent=html"; }}
          style={styles.btnPrimary}
        >
          Download HTML Report
        </button>
        <button
          type="button"
          onClick={() => { window.location.href = "/admin/naia/phase3c-export?intent=json"; }}
          style={styles.btnSecondary}
        >
          Download JSON Export
        </button>
      </div>

      <div style={styles.warning}>
        <strong>Audit only.</strong> Do not action individual signal issues before a full
        systemic review. Phase 3C V1 output is diagnostic — not wired to StyleMe.
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  shell: {
    maxWidth: 760,
    margin: "0 auto",
    padding: "2rem 1.5rem",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  header: {
    marginBottom: "1.5rem",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    marginBottom: "0.5rem",
  },
  badge: {
    fontSize: "0.65rem",
    padding: "0.2rem 0.5rem",
    borderRadius: 4,
    background: "#7c3aed30",
    border: "1px solid #7c3aed50",
    color: "#c4b5fd",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
    whiteSpace: "nowrap" as const,
  },
  title: {
    fontSize: "1.4rem",
    fontWeight: 600,
    color: "#e6edf3",
  },
  desc: {
    fontSize: "0.875rem",
    color: "#8b949e",
    lineHeight: 1.6,
    marginBottom: "0.4rem",
  },
  identity: {
    fontSize: "0.78rem",
    color: "#6e7681",
  },
  card: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: 8,
    padding: "1.25rem",
    marginBottom: "1.25rem",
  },
  cardTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#e6edf3",
    marginBottom: "0.75rem",
  },
  list: {
    listStyle: "none",
    padding: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.35rem",
  },
  timing: {
    marginTop: "1rem",
    fontSize: "0.78rem",
    color: "#8b949e",
    padding: "0.5rem 0.75rem",
    background: "#1c2128",
    borderRadius: 4,
    borderLeft: "3px solid #388bfd",
  },
  actionsRow: {
    display: "flex",
    gap: "0.75rem",
    marginBottom: "1.25rem",
    flexWrap: "wrap" as const,
  },
  btnPrimary: {
    padding: "0.6rem 1.25rem",
    background: "#388bfd",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: "0.875rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "0.6rem 1.25rem",
    background: "transparent",
    color: "#e6edf3",
    border: "1px solid #30363d",
    borderRadius: 6,
    fontSize: "0.875rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  warning: {
    padding: "0.6rem 1rem",
    background: "#6b282130",
    border: "1px solid #f8514930",
    borderRadius: 6,
    fontSize: "0.8rem",
    color: "#ffa198",
  },
};
