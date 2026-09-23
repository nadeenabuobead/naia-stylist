// scripts/phase3c-qa-export.mts
//
// Phase 3C V1 — Full Closet QA Export
// READ-ONLY: no DB writes, no Phase 3C or StyleMe logic changes.
//
// Generates:
//   out/phase3c-qa-export.html  — self-contained HTML with embedded images
//   out/phase3c-qa-export.json  — machine-readable full export
//
// Run with staging env:
//   node --import tsx/esm scripts/phase3c-qa-export.mts
// (ensure DATABASE_URL + Cloudinary vars point to staging — use .env.staging)

import dotenv from "dotenv";
import { readFileSync } from "node:fs";

// ── Env loading: try multiple staging env files in priority order ─────────────
// Priority: shell env > .env.staging.local > .env.preview.tmp > .env.staging
function parseDotenvFile(filePath: string): Record<string, string> {
  try {
    const lines = readFileSync(filePath, "utf-8").split("\n");
    const out: Record<string, string> = {};
    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)="(.*)"$/s) ||
                line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && m[2] && !m[2].startsWith("[SENSITIVE]")) {
        out[m[1]!] = m[2]!;
      }
    }
    return out;
  } catch {
    return {};
  }
}

const ENV_FILES = [".env.staging.local", ".env.preview.tmp", ".env.staging"];
for (const f of ENV_FILES) {
  const parsed = parseDotenvFile(f);
  for (const [k, v] of Object.entries(parsed)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

// Validate DATABASE_URL — must be a real postgres:// URL
const rawDbUrl = process.env.DATABASE_URL ?? process.env.DATABASE_POSTGRES_URL ?? "";
if (!rawDbUrl.startsWith("postgres")) {
  console.error(`
ERROR: No valid DATABASE_URL found.

The .env.staging files contain [SENSITIVE] placeholders. Pull the real staging
env from Vercel first, then re-run this script:

  vercel env pull .env.staging.local --environment=preview

Then run:
  node --import tsx/esm scripts/phase3c-qa-export.mts
`);
  process.exit(1);
}

// Use the direct postgres:// URL (bypass Prisma Accelerate)
const DB_URL = rawDbUrl.startsWith("postgres")
  ? rawDbUrl
  : (process.env.DATABASE_POSTGRES_URL ?? rawDbUrl);
process.env.DATABASE_URL = DB_URL;

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// ── Phase 3C V1 functions (read-only import) ──────────────────────────────────
// tsx resolves ~/  aliases via tsconfig.json paths; both are shadow/read-only
import {
  deriveVisualWeight,
  deriveColourProfile,
  computeGarmentIntentionPotential,
  ALL_INTENTIONS,
  type VisualWeightResult,
  type ColourProfileResult,
  type IntentionPotential,
  type StylingPassportInput,
} from "~/lib/admin/garment-intelligence-v1.server";

import { getEffectiveClosetItem } from "~/lib/admin/closet-review.server";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PassportContext {
  stylePersonalities: string[];
  favoriteColors: string[];
  coveragePreferences: string[];
  dressingPreferences: string[];
}

interface Phase3COutput {
  visualWeight: VisualWeightResult;
  colourProfile: ColourProfileResult;
  intentionPotentials: IntentionPotential[];
  passportUsed: boolean;
}

interface GarmentRow {
  itemId: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  customerId: string;
  customerLabel: string; // Customer A / Customer B ...
  classification: Record<string, unknown>;
  passport: PassportContext | null;
  phase3c: Phase3COutput;
  imageBase64: string | null;
  imageFormat: string | null;
  thumbnailUrl: string | null;
}

// ── Cloudinary signing (inlined — no server import needed) ────────────────────

function buildCloudinarySignedUrl(
  cloudName: string,
  apiKey: string,
  apiSecret: string,
  publicId: string,
  format: string,
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const expiresAt = timestamp + 600; // 10 min
  const sigString =
    `expires_at=${expiresAt}` +
    `&format=${format}` +
    `&public_id=${publicId}` +
    `&timestamp=${timestamp}` +
    `&type=private` +
    apiSecret;
  const signature = createHash("sha1").update(sigString).digest("hex");
  const params = new URLSearchParams({
    api_key: apiKey,
    expires_at: String(expiresAt),
    format,
    public_id: publicId,
    signature,
    timestamp: String(timestamp),
    type: "private",
  });
  return `https://api.cloudinary.com/v1_1/${cloudName}/image/download?${params.toString()}`;
}

// ── Image fetch with timeout ──────────────────────────────────────────────────

async function fetchImageBase64(
  url: string,
  timeoutMs = 12000,
): Promise<{ base64: string; mime: string } | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const mime = ct.split(";")[0]!.trim();
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), mime };
  } catch {
    return null;
  }
}

// ── Concurrency limiter ───────────────────────────────────────────────────────

async function pLimit<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!, idx);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

// ── HTML generation ───────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chip(label: string, colour = "#374151"): string {
  return `<span class="chip" style="background:${colour}20;border:1px solid ${colour}40;color:${colour}">${esc(label)}</span>`;
}

const VW_COLOUR: Record<string, string> = {
  light: "#6b7280",
  medium: "#0369a1",
  substantial: "#7c3aed",
};

const ET_COLOUR: Record<string, string> = {
  "high-energy": "#dc2626",
  "deep-authoritative": "#1e3a5f",
  "mid-range": "#059669",
  "neutral-versatile": "#6b7280",
};

function renderPhase3CBlock(p3c: Phase3COutput): string {
  const vw = p3c.visualWeight;
  const cp = p3c.colourProfile;

  const vwColour = vw.value ? (VW_COLOUR[vw.value] ?? "#6b7280") : "#6b7280";
  const vwLabel = vw.value
    ? `<span class="badge" style="background:${vwColour}20;border:1px solid ${vwColour}40;color:${vwColour}">${esc(vw.value)}</span>`
    : `<span class="badge dim">null</span>`;
  const vwEvidence = vw.evidence.length
    ? vw.evidence.map(e => `<code>${esc(e)}</code>`).join(" ")
    : `<span class="dim">no evidence</span>`;

  const cpBadges = [
    cp.neutralChromaticity ? `<span class="badge">${esc(cp.neutralChromaticity)}</span>` : "",
    cp.broadFamily ? `<span class="badge">${esc(cp.broadFamily)}</span>` : "",
    cp.lightDark ? `<span class="badge">${esc(cp.lightDark)}</span>` : "",
    cp.energyTier
      ? `<span class="badge" style="background:${ET_COLOUR[cp.energyTier] ?? "#6b7280"}20;border:1px solid ${ET_COLOUR[cp.energyTier] ?? "#6b7280"}40;color:${ET_COLOUR[cp.energyTier] ?? "#6b7280"}">${esc(cp.energyTier)}</span>`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cpEvidence = cp.evidence.length
    ? cp.evidence.map(e => `<code>${esc(e)}</code>`).join(" ")
    : `<span class="dim">no evidence</span>`;

  const intentionRows = p3c.intentionPotentials
    .map(ip => {
      const signals = ip.signals.length
        ? ip.signals
            .map(s => `<span class="signal">${esc(s)}</span>`)
            .join("")
        : `<span class="no-signal">NO SIGNALS</span>`;
      return `<tr><td class="intent-name"><code>${esc(ip.intention)}</code></td><td>${signals}</td></tr>`;
    })
    .join("");

  const passportBadge = p3c.passportUsed
    ? `<span class="badge" style="color:#3b82f6;background:#1e3a5f20;border-color:#1e3a5f40">PASSPORT-AWARE</span>`
    : `<span class="badge dim">NO PASSPORT</span>`;

  return `
    <div class="phase3c-block">
      <div class="p3c-section">
        <div class="p3c-label">A — VISUAL WEIGHT</div>
        <div>${vwLabel} ${vwEvidence}</div>
      </div>
      <div class="p3c-section">
        <div class="p3c-label">A — COLOUR PROFILE</div>
        <div>${cpBadges || '<span class="dim">null</span>'}</div>
        <div class="mt4">${cpEvidence}</div>
      </div>
      <div class="p3c-section">
        <div class="p3c-label">B — PASSPORT-AWARE STYLING POTENTIAL ${passportBadge}</div>
        <table class="intent-table"><tbody>${intentionRows}</tbody></table>
      </div>
    </div>`;
}

function renderClassificationBlock(cls: Record<string, unknown>): string {
  const fields: [string, unknown][] = [
    ["silhouette", cls.silhouette],
    ["fitProfile", cls.fitProfile],
    ["hemLength", cls.hemLength],
    ["topLength", cls.topLength],
    ["sleeveLength", cls.sleeveLength],
    ["waistShape", cls.waistShape],
    ["necklineCoverage", cls.necklineCoverage],
    ["shoulderCoverage", cls.shoulderCoverage == null ? null : cls.shoulderCoverage ? "covered" : "not covered"],
    ["midriffExposed", cls.midriffExposed == null ? null : cls.midriffExposed ? "exposed" : "not exposed"],
    ["material", cls.material],
    ["pattern", cls.pattern],
    ["primaryColor", cls.primaryColor],
    ["colors", Array.isArray(cls.colors) ? (cls.colors as string[]).join(", ") : null],
    ["formality", cls.formality],
    ["occasions", Array.isArray(cls.occasions) ? (cls.occasions as string[]).join(", ") : null],
    ["seasons", Array.isArray(cls.seasons) ? (cls.seasons as string[]).join(", ") : null],
    ["stylePersonality", cls.stylePersonality],
    ["styleTags", Array.isArray(cls.styleTags) ? (cls.styleTags as string[]).join(", ") : null],
  ];

  const rows = fields
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<tr><td class="cls-key">${esc(k)}</td><td>${esc(String(v))}</td></tr>`)
    .join("");

  return `<table class="cls-table"><tbody>${rows}</tbody></table>`;
}

function buildHTML(
  rows: GarmentRow[],
  summary: SummaryStats,
  exportedAt: string,
): string {
  const byCategory: Record<string, GarmentRow[]> = {};
  for (const row of rows) {
    (byCategory[row.category] ??= []).push(row);
  }

  const categoryOrder = [
    "TOPS", "BOTTOMS", "DRESSES", "OUTERWEAR", "ACTIVEWEAR",
    "SHOES", "BAGS", "ACCESSORIES", "JEWELRY", "SWIMWEAR", "LOUNGEWEAR", "OTHER",
  ];

  const cards = categoryOrder
    .filter(cat => byCategory[cat]?.length)
    .map(cat => {
      const items = byCategory[cat]!;
      const itemCards = items
        .map(row => {
          const imgTag = row.imageBase64
            ? `<img class="garment-img" src="data:${row.imageFormat ?? "image/jpeg"};base64,${row.imageBase64}" alt="${esc(row.name ?? row.category)}" />`
            : row.thumbnailUrl
              ? `<img class="garment-img" src="${esc(row.thumbnailUrl)}" alt="${esc(row.name ?? row.category)}" />`
              : `<div class="garment-img-placeholder">No image</div>`;

          const passportLines = row.passport
            ? [
                row.passport.stylePersonalities.length
                  ? `<div class="passport-row"><span class="passport-key">Personalities:</span> ${row.passport.stylePersonalities.map(p => chip(p, "#3b82f6")).join(" ")}</div>`
                  : "",
                row.passport.favoriteColors.length
                  ? `<div class="passport-row"><span class="passport-key">Fav colours:</span> ${esc(row.passport.favoriteColors.slice(0, 8).join(", "))}</div>`
                  : "",
                row.passport.coveragePreferences.length
                  ? `<div class="passport-row"><span class="passport-key">Coverage:</span> ${esc(row.passport.coveragePreferences.join(", "))}</div>`
                  : "",
                row.passport.dressingPreferences.length
                  ? `<div class="passport-row"><span class="passport-key">Dressing:</span> ${esc(row.passport.dressingPreferences.join(", "))}</div>`
                  : "",
              ]
                .filter(Boolean)
                .join("")
            : `<div class="dim">No Passport found</div>`;

          return `
            <div class="garment-card" id="${esc(row.itemId)}">
              <div class="garment-header">
                <span class="garment-name">${esc(row.name ?? "Unnamed")}</span>
                <span class="garment-sub">${esc(row.subcategory ?? "")}</span>
                <span class="customer-badge">${esc(row.customerLabel)}</span>
              </div>
              <div class="garment-body">
                <div class="garment-left">
                  ${imgTag}
                  <div class="passport-block">
                    <div class="p3c-label">PASSPORT CONTEXT</div>
                    ${passportLines}
                  </div>
                </div>
                <div class="garment-right">
                  <div class="cls-header">EFFECTIVE CLASSIFICATION <span class="dim">(admin-corrected)</span></div>
                  ${renderClassificationBlock(row.classification)}
                  ${renderPhase3CBlock(row.phase3c)}
                </div>
              </div>
            </div>`;
        })
        .join("\n");

      return `
        <section class="category-section">
          <h2 class="category-title" id="cat-${esc(cat)}">${esc(cat)} <span class="cat-count">(${items.length})</span></h2>
          ${itemCards}
        </section>`;
    })
    .join("\n");

  // Summary table
  const vwRows = Object.entries(summary.visualWeight)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)
    .join("");

  const catRows = Object.entries(summary.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, counts]) =>
      `<tr><td>${esc(cat)}</td><td>${counts.total}</td><td>${counts.light}</td><td>${counts.medium}</td><td>${counts.substantial}</td><td>${counts.nullVW}</td></tr>`,
    )
    .join("");

  const topSignals = summary.topIntentionSignals
    .slice(0, 20)
    .map(([sig, n]) => `<tr><td>${esc(sig)}</td><td>${n}</td></tr>`)
    .join("");

  const topNoSignal = summary.intentionsWithMostNoSignals
    .slice(0, 12)
    .map(([intent, n]) => `<tr><td>${esc(intent)}</td><td>${n}</td></tr>`)
    .join("");

  const topTags = summary.topStyleTags
    .slice(0, 20)
    .map(([tag, n]) => `<tr><td>${esc(tag)}</td><td>${n}</td></tr>`)
    .join("");

  const tocLinks = categoryOrder
    .filter(cat => byCategory[cat]?.length)
    .map(cat => `<li><a href="#cat-${esc(cat)}">${esc(cat)} (${byCategory[cat]!.length})</a></li>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Phase 3C V1 — Full Closet QA Export</title>
<style>
  :root {
    --bg: #0d1117;
    --surface: #161b22;
    --surface2: #1c2128;
    --border: #30363d;
    --text: #e6edf3;
    --dim: #6e7681;
    --accent: #388bfd;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; line-height: 1.5; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .page-header { padding: 2rem; border-bottom: 1px solid var(--border); }
  .page-header h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  .page-header .meta { color: var(--dim); font-size: 0.8rem; }
  .warning-box { margin: 1rem 0; padding: 0.75rem 1rem; background: #6b2821; border-radius: 6px; border: 1px solid #f8514944; color: #ffa198; font-size: 0.8rem; }

  .page-body { display: grid; grid-template-columns: 220px 1fr; height: calc(100vh - 120px); }
  .sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 1rem; position: sticky; top: 0; height: calc(100vh - 120px); }
  .sidebar h3 { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim); margin-bottom: 0.5rem; }
  .sidebar ul { list-style: none; }
  .sidebar li { margin-bottom: 0.25rem; font-size: 0.8rem; }
  .main { overflow-y: auto; padding: 1.5rem; }

  .summary-section { margin-bottom: 2rem; }
  .summary-section h2 { font-size: 1rem; margin-bottom: 1rem; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
  .summary-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
  .summary-card h3 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); margin-bottom: 0.75rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  th, td { padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--border); text-align: left; }
  th { color: var(--dim); font-size: 0.7rem; text-transform: uppercase; }

  .category-section { margin-bottom: 2rem; }
  .category-title { font-size: 1.1rem; padding: 0.75rem 0; border-bottom: 2px solid var(--border); margin-bottom: 1rem; }
  .cat-count { color: var(--dim); font-weight: normal; font-size: 0.85rem; }

  .garment-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; margin-bottom: 1.5rem; overflow: hidden; }
  .garment-header { display: flex; align-items: baseline; gap: 0.75rem; padding: 0.75rem 1rem; background: var(--surface2); border-bottom: 1px solid var(--border); }
  .garment-name { font-weight: 600; font-size: 0.95rem; }
  .garment-sub { color: var(--dim); font-size: 0.8rem; }
  .customer-badge { margin-left: auto; font-size: 0.7rem; color: #a5d6ff; background: #1e3a5f; padding: 0.15rem 0.5rem; border-radius: 4px; border: 1px solid #1e3a5f60; }

  .garment-body { display: grid; grid-template-columns: 220px 1fr; }
  .garment-left { padding: 1rem; border-right: 1px solid var(--border); }
  .garment-img { width: 100%; max-height: 220px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border); display: block; }
  .garment-img-placeholder { width: 100%; height: 120px; background: var(--surface2); border-radius: 4px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; color: var(--dim); font-size: 0.75rem; }
  .garment-right { padding: 1rem; overflow-x: auto; }

  .passport-block { margin-top: 0.75rem; }
  .passport-row { font-size: 0.73rem; margin-bottom: 0.2rem; }
  .passport-key { color: var(--dim); }

  .cls-header { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); margin-bottom: 0.4rem; }
  .cls-table td { padding: 0.15rem 0.4rem; font-size: 0.75rem; vertical-align: top; }
  .cls-table .cls-key { color: var(--dim); font-family: monospace; white-space: nowrap; }

  .phase3c-block { margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 1rem; }
  .p3c-section { margin-bottom: 0.75rem; }
  .p3c-label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--dim); margin-bottom: 0.3rem; }
  .mt4 { margin-top: 0.3rem; }

  .badge { display: inline-block; font-size: 0.68rem; padding: 0.1rem 0.4rem; border-radius: 4px; border: 1px solid var(--border); background: var(--surface2); color: var(--text); margin-right: 0.2rem; }
  .badge.dim { color: var(--dim); }
  .chip { display: inline-block; font-size: 0.68rem; padding: 0.1rem 0.4rem; border-radius: 4px; margin-right: 0.2rem; margin-bottom: 0.2rem; }
  .dim { color: var(--dim); }
  code { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.72rem; background: var(--surface2); padding: 0.1rem 0.3rem; border-radius: 3px; margin-right: 0.2rem; }

  .intent-table { width: 100%; margin-top: 0.3rem; }
  .intent-table td { padding: 0.2rem 0.4rem; font-size: 0.73rem; border-bottom: 1px solid var(--border); vertical-align: top; }
  .intent-name { white-space: nowrap; width: 160px; }
  .signal { display: inline-block; font-size: 0.7rem; color: #a5d6ff; background: #1e3a5f; padding: 0.1rem 0.35rem; border-radius: 3px; margin: 0.1rem 0.1rem 0.1rem 0; }
  .no-signal { color: var(--dim); font-style: italic; }

  @media print {
    .page-body { display: block; height: auto; }
    .sidebar { display: none; }
    .garment-card { break-inside: avoid; }
  }
</style>
</head>
<body>
<header class="page-header">
  <h1>Phase 3C V1 — Full Closet QA Export</h1>
  <div class="meta">Generated: ${esc(exportedAt)} · ${rows.length} garments · READ-ONLY AUDIT · No Phase 3C or StyleMe logic was changed</div>
  <div class="warning-box">⚠️  AUDIT ONLY — Do not fix visualWeight or intention-potential rules until systemic review is complete. Effective (admin-corrected) classifications used throughout.</div>
</header>
<div class="page-body">
  <nav class="sidebar">
    <h3>Table of Contents</h3>
    <ul>
      <li><a href="#summary">Summary</a></li>
      ${tocLinks}
    </ul>
  </nav>
  <main class="main">
    <section class="summary-section" id="summary">
      <h2>Aggregate Summary</h2>
      <div class="summary-grid">

        <div class="summary-card">
          <h3>Visual Weight Distribution</h3>
          <table>
            <thead><tr><th>Value</th><th>Count</th></tr></thead>
            <tbody>${vwRows}</tbody>
          </table>
        </div>

        <div class="summary-card">
          <h3>By Category</h3>
          <table>
            <thead><tr><th>Category</th><th>Total</th><th>Light</th><th>Med</th><th>Sub</th><th>Null</th></tr></thead>
            <tbody>${catRows}</tbody>
          </table>
        </div>

        <div class="summary-card">
          <h3>Top 20 Intention Signals</h3>
          <table>
            <thead><tr><th>Signal</th><th>Count</th></tr></thead>
            <tbody>${topSignals}</tbody>
          </table>
        </div>

        <div class="summary-card">
          <h3>Intentions Most Often Showing NO SIGNALS</h3>
          <table>
            <thead><tr><th>Intention</th><th>No-signal count</th></tr></thead>
            <tbody>${topNoSignal}</tbody>
          </table>
        </div>

        <div class="summary-card">
          <h3>Top 20 Style Tags</h3>
          <table>
            <thead><tr><th>Tag</th><th>Count</th></tr></thead>
            <tbody>${topTags}</tbody>
          </table>
        </div>

        <div class="summary-card">
          <h3>Garments per Customer</h3>
          <table>
            <thead><tr><th>Customer</th><th>Garments</th><th>Has Passport</th></tr></thead>
            <tbody>${summary.perCustomer
              .map(c => `<tr><td>${esc(c.label)}</td><td>${c.count}</td><td>${c.hasPassport ? "✓" : "—"}</td></tr>`)
              .join("")}</tbody>
          </table>
        </div>

      </div>
    </section>

    ${cards}
  </main>
</div>
</body>
</html>`;
}

// ── Summary statistics ────────────────────────────────────────────────────────

interface SummaryStats {
  visualWeight: Record<string, number>;
  byCategory: Record<string, { total: number; light: number; medium: number; substantial: number; nullVW: number }>;
  topIntentionSignals: [string, number][];
  intentionsWithMostNoSignals: [string, number][];
  topStyleTags: [string, number][];
  perCustomer: { label: string; count: number; hasPassport: boolean }[];
}

function computeSummary(rows: GarmentRow[]): SummaryStats {
  const vwCounts: Record<string, number> = { light: 0, medium: 0, substantial: 0, null: 0 };
  const catCounts: Record<string, { total: number; light: number; medium: number; substantial: number; nullVW: number }> = {};
  const signalCounts = new Map<string, number>();
  const noSignalIntentCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const customerCounts = new Map<string, { label: string; count: number; hasPassport: boolean }>();

  for (const row of rows) {
    const vw = row.phase3c.visualWeight.value ?? "null";
    vwCounts[vw] = (vwCounts[vw] ?? 0) + 1;

    const cat = row.category;
    if (!catCounts[cat]) catCounts[cat] = { total: 0, light: 0, medium: 0, substantial: 0, nullVW: 0 };
    catCounts[cat]!.total++;
    if (vw === "light") catCounts[cat]!.light++;
    else if (vw === "medium") catCounts[cat]!.medium++;
    else if (vw === "substantial") catCounts[cat]!.substantial++;
    else catCounts[cat]!.nullVW++;

    for (const ip of row.phase3c.intentionPotentials) {
      if (ip.signals.length === 0) {
        noSignalIntentCounts.set(ip.intention, (noSignalIntentCounts.get(ip.intention) ?? 0) + 1);
      }
      for (const sig of ip.signals) {
        signalCounts.set(sig, (signalCounts.get(sig) ?? 0) + 1);
      }
    }

    const tags = Array.isArray(row.classification.styleTags) ? row.classification.styleTags as string[] : [];
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    const existing = customerCounts.get(row.customerId);
    if (existing) {
      existing.count++;
    } else {
      customerCounts.set(row.customerId, { label: row.customerLabel, count: 1, hasPassport: !!row.passport });
    }
  }

  return {
    visualWeight: vwCounts,
    byCategory: catCounts,
    topIntentionSignals: [...signalCounts.entries()].sort((a, b) => b[1] - a[1]),
    intentionsWithMostNoSignals: [...noSignalIntentCounts.entries()].sort((a, b) => b[1] - a[1]),
    topStyleTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]),
    perCustomer: [...customerCounts.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });

async function main() {
  console.log("Phase 3C QA Export — read-only");
  console.log("Connecting to database...");

  // ── 1. Load all closet items + admin reviews ──────────────────────────────
  const items = await prisma.closetItem.findMany({
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
    include: {
      adminReview: true,
    },
  });
  console.log(`Found ${items.length} closet items`);

  // ── 2. Load all unique customer passports ─────────────────────────────────
  const customerIds = [...new Set(items.map(i => i.customerId))];
  const profiles = await prisma.onboardingProfile.findMany({
    where: { customerId: { in: customerIds } },
    select: {
      customerId: true,
      stylePersonalities: true,
      favoriteColors: true,
      coveragePreferences: true,
      dressingPreferences: true,
    },
  });
  const passportMap = new Map<string, PassportContext>();
  for (const p of profiles) {
    const hasData =
      p.stylePersonalities.length > 0 ||
      p.favoriteColors.length > 0 ||
      p.coveragePreferences.length > 0 ||
      p.dressingPreferences.length > 0;
    if (hasData) {
      passportMap.set(p.customerId, {
        stylePersonalities: p.stylePersonalities,
        favoriteColors: p.favoriteColors,
        coveragePreferences: p.coveragePreferences,
        dressingPreferences: p.dressingPreferences,
      });
    }
  }
  console.log(`Loaded ${passportMap.size}/${customerIds.length} customer passports`);

  // ── 3. Anonymise customers ────────────────────────────────────────────────
  const sortedCustomerIds = [...customerIds].sort();
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const customerLabels = new Map<string, string>();
  sortedCustomerIds.forEach((id, i) => {
    const label =
      i < 26
        ? `Customer ${ALPHABET[i]}`
        : `Customer ${ALPHABET[Math.floor(i / 26) - 1]}${ALPHABET[i % 26]}`;
    customerLabels.set(id, label);
  });

  // ── 4. Cloudinary config ──────────────────────────────────────────────────
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? null;
  const apiKey = process.env.CLOUDINARY_API_KEY ?? null;
  const apiSecret = process.env.CLOUDINARY_API_SECRET ?? null;
  const canSign = !!(cloudName && apiKey && apiSecret);
  if (!canSign) console.warn("Cloudinary env vars not found — images from thumbnailUrl only");

  // ── 5. Compute Phase 3C V1 output for every item ──────────────────────────
  console.log("Computing Phase 3C V1 outputs...");

  const rows: GarmentRow[] = items.map(item => {
    // Build base classification matching ClosetClassification shape
    const baseCls = {
      subcategory: item.subcategory,
      silhouette: item.silhouette,
      fitProfile: item.fitProfile,
      hemLength: item.hemLength,
      topLength: item.topLength,
      waistShape: item.waistShape,
      sleeveLength: item.sleeveLength,
      necklineCoverage: item.necklineCoverage,
      shoulderCoverage: item.shoulderCoverage,
      midriffExposed: item.midriffExposed,
      material: item.material,
      pattern: item.pattern,
      primaryColor: item.primaryColor,
      colors: item.colors,
      occasions: item.occasions,
      seasons: item.seasons,
      formality: item.formality,
      stylePersonality: item.stylePersonality,
      styleTags: item.styleTags,
      garmentRelationships: item.garmentRelationships,
    };

    // Apply admin overrides
    const eff = getEffectiveClosetItem(baseCls, item.adminReview ?? null);

    const passport = passportMap.get(item.customerId) ?? null;
    const passportInput: StylingPassportInput | null = passport;

    const visualWeight = deriveVisualWeight(eff);
    const colourProfile = deriveColourProfile(eff);
    const intentionPotentials = ALL_INTENTIONS.map(intention =>
      computeGarmentIntentionPotential(eff, intention, passportInput ?? {}, {}),
    );

    return {
      itemId: item.id,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      customerId: item.customerId,
      customerLabel: customerLabels.get(item.customerId) ?? "Customer ?",
      classification: eff as Record<string, unknown>,
      passport,
      phase3c: {
        visualWeight,
        colourProfile,
        intentionPotentials,
        passportUsed: passport !== null,
      },
      imageBase64: null, // filled in step 6
      imageFormat: null,
      thumbnailUrl: item.thumbnailUrl,
    };
  });

  // ── 6. Fetch garment images concurrently (max 5 at a time) ───────────────
  console.log("Fetching garment images (this may take a moment)...");
  let imagesFetched = 0;
  let imagesFailed = 0;

  const imageItems = items.map((item, i) => ({ item, rowIdx: i }));

  await pLimit(imageItems, 5, async ({ item, rowIdx }) => {
    let imgUrl: string | null = null;

    if (item.imagePublicId && canSign) {
      try {
        imgUrl = buildCloudinarySignedUrl(
          cloudName!,
          apiKey!,
          apiSecret!,
          item.imagePublicId,
          item.imageFormat ?? "jpg",
        );
      } catch {
        // fall through to thumbnailUrl
      }
    }

    if (!imgUrl && item.thumbnailUrl) {
      imgUrl = item.thumbnailUrl;
    }

    if (imgUrl) {
      const result = await fetchImageBase64(imgUrl);
      if (result) {
        rows[rowIdx]!.imageBase64 = result.base64;
        rows[rowIdx]!.imageFormat = result.mime;
        imagesFetched++;
      } else {
        imagesFailed++;
      }
    } else {
      imagesFailed++;
    }

    if ((imagesFetched + imagesFailed) % 10 === 0) {
      process.stdout.write(`  images: ${imagesFetched} fetched, ${imagesFailed} failed\r`);
    }
  });

  console.log(`\nImages: ${imagesFetched} fetched, ${imagesFailed} failed/missing`);

  // ── 7. Compute summary stats ──────────────────────────────────────────────
  const summary = computeSummary(rows);

  // ── 8. Write JSON export ──────────────────────────────────────────────────
  await fs.mkdir("out", { recursive: true });

  const exportedAt = new Date().toISOString();

  const jsonExport = {
    exportedAt,
    totalItems: rows.length,
    customers: Object.fromEntries(customerLabels),
    summary: {
      visualWeight: summary.visualWeight,
      byCategory: summary.byCategory,
      topIntentionSignals: summary.topIntentionSignals.slice(0, 50),
      intentionsWithMostNoSignals: summary.intentionsWithMostNoSignals,
      topStyleTags: summary.topStyleTags.slice(0, 30),
      perCustomer: summary.perCustomer,
    },
    items: rows.map(row => ({
      itemId: row.itemId,
      name: row.name,
      category: row.category,
      subcategory: row.subcategory,
      customerLabel: row.customerLabel,
      passport: row.passport
        ? {
            stylePersonalities: row.passport.stylePersonalities,
            favoriteColors: row.passport.favoriteColors,
            coveragePreferences: row.passport.coveragePreferences,
            dressingPreferences: row.passport.dressingPreferences,
          }
        : null,
      effectiveClassification: row.classification,
      phase3c: {
        visualWeight: {
          value: row.phase3c.visualWeight.value,
          evidence: row.phase3c.visualWeight.evidence,
        },
        colourProfile: {
          neutralChromaticity: row.phase3c.colourProfile.neutralChromaticity,
          broadFamily: row.phase3c.colourProfile.broadFamily,
          lightDark: row.phase3c.colourProfile.lightDark,
          energyTier: row.phase3c.colourProfile.energyTier,
          evidence: row.phase3c.colourProfile.evidence,
        },
        passportUsed: row.phase3c.passportUsed,
        intentionPotentials: Object.fromEntries(
          row.phase3c.intentionPotentials.map(ip => [ip.intention, ip.signals]),
        ),
      },
      hasEmbeddedImage: row.imageBase64 !== null,
    })),
  };

  const jsonPath = path.resolve("out/phase3c-qa-export.json");
  await fs.writeFile(jsonPath, JSON.stringify(jsonExport, null, 2));
  console.log(`JSON export written: ${jsonPath}`);

  // ── 9. Write HTML export ─────────────────────────────────────────────────
  const html = buildHTML(rows, summary, exportedAt);
  const htmlPath = path.resolve("out/phase3c-qa-export.html");
  await fs.writeFile(htmlPath, html);
  console.log(`HTML export written: ${htmlPath}`);

  // ── 10. Summary to stdout ────────────────────────────────────────────────
  console.log("\n════════════════════════════════════════");
  console.log("EXPORT COMPLETE");
  console.log(`  Garments:    ${rows.length}`);
  console.log(`  Customers:   ${customerIds.length} (anonymised)`);
  console.log(`  With Passport: ${[...passportMap.keys()].length} customers`);
  console.log(`  Images embedded: ${imagesFetched}/${rows.length}`);
  console.log(`\n  Visual weight distribution:`);
  for (const [k, v] of Object.entries(summary.visualWeight)) {
    console.log(`    ${k.padEnd(12)} ${v}`);
  }
  console.log(`\n  HTML: ${htmlPath}`);
  console.log(`  JSON: ${jsonPath}`);
  console.log("\n  CONFIRMATIONS:");
  console.log("  ✓ Effective (admin-corrected) classifications used");
  console.log("  ✓ No Phase 3C or StyleMe logic was changed");
  console.log("  ✓ No database writes performed");
  console.log("════════════════════════════════════════");

  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
