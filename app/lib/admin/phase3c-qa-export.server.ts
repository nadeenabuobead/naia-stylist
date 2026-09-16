// app/lib/admin/phase3c-qa-export.server.ts
//
// Phase 3C V1 QA Export — server-side generation.
//
// READ-ONLY. No DB writes, no Phase 3C logic changes, no StyleMe changes.
// Runs inside the staging deployment using server env credentials.
//
// Exported functions:
//   generatePhase3CQAExport(opts)  — main entry: returns htmlContent + jsonContent
//
// Injection points (for tests):
//   _prisma, _fetch, _getCloudinaryConfig, _nowFn

import type { PrismaClient } from "@prisma/client";
import prisma from "~/db.server";
import {
  getEffectiveClosetItem,
  type ClosetItemFields,
  type AdminReviewFields,
} from "~/lib/admin/closet-review.server";
import {
  deriveVisualWeight,
  deriveColourProfile,
  computeGarmentIntentionPotential,
  ALL_INTENTIONS,
  type StylingPassportInput,
  type IntentionPotential,
} from "~/lib/admin/garment-intelligence-v1.server";
import {
  buildPrivateDownloadUrl,
  getCloudinaryConfig,
  type CloudinaryConfig,
} from "~/lib/cloudinary-admin.server";
import type { ClosetClassification } from "~/lib/admin/closet-intelligence.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PassportContext {
  stylePersonalities: string[];
  favoriteColors: string[];
  coveragePreferences: string[];
  dressingPreferences: string[];
}

export interface Phase3CResult {
  visualWeight: {
    value: string | null;
    evidence: string[];
  };
  colourProfile: {
    hueFamily: string | null;
    wardrobeNeutral: boolean;
    neutralChromaticity: string | null;
    broadFamily: string | null;
    lightDark: string | null;
    energyTier: string | null;
    evidence: string[];
  };
  intentionPotentials: { intention: string; strength: string; signals: string[] }[];
  passportUsed: boolean;
}

export interface ExportItem {
  itemId: string;
  name: string | null;
  category: string;
  subcategory: string | null;
  customerLabel: string;
  passport: PassportContext | null;
  effectiveClassification: Record<string, unknown>;
  phase3c: Phase3CResult;
  imageDataUri: string | null;
}

export interface ExportSummary {
  totalItems: number;
  customers: number;
  customersWithPassport: number;
  imagesEmbedded: number;
  visualWeight: Record<string, number>;
  byCategory: Record<string, number>;
  topSignals: [string, number][];
  intentionsNoSignals: [string, number][];
  topStyleTags: [string, number][];
  topStylePersonalities: [string, number][];
  exportedAt: string;
}

export interface Phase3CQAExportResult {
  htmlContent: string;
  jsonContent: string;
  summary: ExportSummary;
}

export interface GenerateOptions {
  _prisma?: PrismaClient;
  _fetch?: typeof fetch;
  _getCloudinaryConfig?: () => CloudinaryConfig | null;
  _nowFn?: () => number;
}

// ── Concurrency limiter ───────────────────────────────────────────────────────

async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!, idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Image fetch → base64 data URI ─────────────────────────────────────────────

async function fetchImageDataUri(
  imagePublicId: string | null,
  imageFormat: string | null,
  thumbnailUrl: string | null,
  cloudinaryConfig: CloudinaryConfig | null,
  fetchFn: typeof fetch,
  nowFn: () => number,
): Promise<string | null> {
  let url: string | null = null;

  if (imagePublicId && cloudinaryConfig) {
    try {
      url = buildPrivateDownloadUrl(
        cloudinaryConfig,
        imagePublicId,
        imageFormat ?? "jpg",
        "private",
        nowFn,
        600,
      );
    } catch {
      // fall through to thumbnailUrl
    }
  }

  if (!url && thumbnailUrl) {
    url = thumbnailUrl;
  }

  if (!url) return null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetchFn(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const mime = ct.split(";")[0]!.trim();
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ── Customer anonymisation ────────────────────────────────────────────────────

const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function customerLabel(index: number): string {
  if (index < 26) return `Customer ${ALPHA[index]}`;
  return `Customer ${ALPHA[Math.floor(index / 26) - 1]}${ALPHA[index % 26]}`;
}

// ── Classification → Phase 3C ─────────────────────────────────────────────────

function toPhase3C(
  classification: ClosetClassification,
  passport: StylingPassportInput | null,
): Phase3CResult {
  const vw = deriveVisualWeight(classification);
  const cp = deriveColourProfile(classification);
  const passportInput: StylingPassportInput = passport ?? {};
  const intentionPotentials: IntentionPotential[] = ALL_INTENTIONS.map(intention =>
    computeGarmentIntentionPotential(classification, intention, passportInput, {}),
  );
  return {
    visualWeight: { value: vw.value, evidence: vw.evidence },
    colourProfile: {
      hueFamily: cp.hueFamily,
      wardrobeNeutral: cp.wardrobeNeutral,
      neutralChromaticity: cp.neutralChromaticity,
      broadFamily: cp.broadFamily,
      lightDark: cp.lightDark,
      energyTier: cp.energyTier,
      evidence: cp.evidence,
    },
    intentionPotentials: intentionPotentials.map(ip => ({
      intention: ip.intention,
      strength: ip.strength,
      signals: ip.signals,
    })),
    passportUsed: passport !== null,
  };
}

// ── Aggregate statistics ──────────────────────────────────────────────────────

function buildSummary(
  items: ExportItem[],
  exportedAt: string,
  imagesEmbedded: number,
  customersWithPassport: number,
  totalCustomers: number,
): ExportSummary {
  const vwCounts: Record<string, number> = { light: 0, medium: 0, substantial: 0, null: 0 };
  const catCounts: Record<string, number> = {};
  const signalCounts = new Map<string, number>();
  const noSignalIntents = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const personalityCounts = new Map<string, number>();

  for (const item of items) {
    const vw = item.phase3c.visualWeight.value ?? "null";
    vwCounts[vw] = (vwCounts[vw] ?? 0) + 1;
    catCounts[item.category] = (catCounts[item.category] ?? 0) + 1;

    for (const ip of item.phase3c.intentionPotentials) {
      if (ip.signals.length === 0) {
        noSignalIntents.set(ip.intention, (noSignalIntents.get(ip.intention) ?? 0) + 1);
      }
      for (const s of ip.signals) {
        signalCounts.set(s, (signalCounts.get(s) ?? 0) + 1);
      }
    }

    const tags = (item.effectiveClassification.styleTags as string[] | undefined) ?? [];
    for (const t of tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);

    if (item.passport) {
      for (const p of item.passport.stylePersonalities) {
        personalityCounts.set(p, (personalityCounts.get(p) ?? 0) + 1);
      }
    }
  }

  return {
    totalItems: items.length,
    customers: totalCustomers,
    customersWithPassport,
    imagesEmbedded,
    visualWeight: vwCounts,
    byCategory: catCounts,
    topSignals: [...signalCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    intentionsNoSignals: [...noSignalIntents.entries()].sort((a, b) => b[1] - a[1]),
    topStyleTags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20),
    topStylePersonalities: [...personalityCounts.entries()].sort((a, b) => b[1] - a[1]),
    exportedAt,
  };
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const VW_COLOR: Record<string, string> = {
  light: "#6b7280",
  medium: "#0369a1",
  substantial: "#7c3aed",
};

const ET_COLOR: Record<string, string> = {
  "high-energy": "#dc2626",
  "deep-authoritative": "#1e3a5f",
  "mid-range": "#059669",
  "neutral-versatile": "#6b7280",
};

function renderItem(item: ExportItem): string {
  const imgHtml = item.imageDataUri
    ? `<img class="gimg" src="${item.imageDataUri}" alt="${esc(item.name ?? item.category)}" />`
    : `<div class="gimg-placeholder">No image</div>`;

  const vw = item.phase3c.visualWeight;
  const vwColor = vw.value ? (VW_COLOR[vw.value] ?? "#6b7280") : "#6b7280";
  const vwBadge = vw.value
    ? `<span class="badge" style="background:${vwColor}20;border-color:${vwColor}40;color:${vwColor}">${esc(vw.value)}</span>`
    : `<span class="badge dim">null</span>`;
  const vwEv = vw.evidence.length
    ? vw.evidence.map(e => `<code>${esc(e)}</code>`).join(" ")
    : `<em class="dim">no evidence</em>`;

  const cp = item.phase3c.colourProfile;
  const etColor = cp.energyTier ? (ET_COLOR[cp.energyTier] ?? "#6b7280") : "#6b7280";
  const cpBadges = [
    cp.wardrobeNeutral && cp.hueFamily ? `<span class="badge">${esc(cp.hueFamily)} neutral</span>` :
      cp.wardrobeNeutral ? `<span class="badge">neutral</span>` :
      cp.hueFamily ? `<span class="badge">${esc(cp.hueFamily)}</span>` : "",
    cp.lightDark ? `<span class="badge">${esc(cp.lightDark)}</span>` : "",
    cp.energyTier
      ? `<span class="badge" style="background:${etColor}20;border-color:${etColor}40;color:${etColor}">${esc(cp.energyTier)}</span>`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
  const cpEv = cp.evidence.length
    ? cp.evidence.map(e => `<code>${esc(e)}</code>`).join(" ")
    : `<em class="dim">no evidence</em>`;

  const clsFields: [string, unknown][] = [
    ["silhouette", item.effectiveClassification.silhouette],
    ["fitProfile", item.effectiveClassification.fitProfile],
    ["material", item.effectiveClassification.material],
    ["pattern", item.effectiveClassification.pattern],
    ["primaryColor", item.effectiveClassification.primaryColor],
    ["colors", (item.effectiveClassification.colors as string[] | undefined)?.join(", ")],
    ["formality", item.effectiveClassification.formality],
    ["occasions", (item.effectiveClassification.occasions as string[] | undefined)?.join(", ")],
    ["styleTags", (item.effectiveClassification.styleTags as string[] | undefined)?.join(", ")],
    ["stylePersonality", item.effectiveClassification.stylePersonality],
    ["hemLength", item.effectiveClassification.hemLength],
    ["topLength", item.effectiveClassification.topLength],
    ["sleeveLength", item.effectiveClassification.sleeveLength],
    ["necklineCoverage", item.effectiveClassification.necklineCoverage],
  ];
  const clsRows = clsFields
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<tr><td class="ck">${esc(k)}</td><td>${esc(String(v))}</td></tr>`)
    .join("");

  const STRENGTH_COLOR: Record<string, string> = {
    strong: "#a3e635", supporting: "#fbbf24", none: "#4b5563",
  };
  const intentRows = item.phase3c.intentionPotentials
    .map(ip => {
      const sc = STRENGTH_COLOR[ip.strength] ?? "#4b5563";
      const strengthBadge = ip.strength !== "none"
        ? `<span style="font-size:.65rem;color:${sc};background:${sc}18;border:1px solid ${sc}40;padding:.02rem .3rem;border-radius:3px;margin-right:.4rem">${esc(ip.strength)}</span>`
        : "";
      const signals = ip.signals.length
        ? ip.signals.map(s => `<span class="sig">${esc(s)}</span>`).join("")
        : `<span class="nosig">none</span>`;
      return `<tr><td class="iname"><code>${esc(ip.intention)}</code>${strengthBadge}</td><td>${signals}</td></tr>`;
    })
    .join("");

  const ppBadge = item.phase3c.passportUsed
    ? `<span class="badge" style="color:#3b82f6;background:#1e3a5f20;border-color:#1e3a5f40">PASSPORT-AWARE</span>`
    : `<span class="badge dim">NO PASSPORT</span>`;

  const passportHtml = item.passport
    ? [
        item.passport.stylePersonalities.length
          ? `<div class="pp-row"><span class="pp-key">Personalities:</span> ${item.passport.stylePersonalities.map(p => `<span class="chip">${esc(p)}</span>`).join(" ")}</div>`
          : "",
        item.passport.favoriteColors.length
          ? `<div class="pp-row"><span class="pp-key">Fav colours:</span> ${esc(item.passport.favoriteColors.slice(0, 10).join(", "))}</div>`
          : "",
        item.passport.coveragePreferences.length
          ? `<div class="pp-row"><span class="pp-key">Coverage:</span> ${esc(item.passport.coveragePreferences.join(", "))}</div>`
          : "",
        item.passport.dressingPreferences.length
          ? `<div class="pp-row"><span class="pp-key">Dressing:</span> ${esc(item.passport.dressingPreferences.join(", "))}</div>`
          : "",
      ]
        .filter(Boolean)
        .join("")
    : `<em class="dim">No Passport found</em>`;

  return `<div class="gcard" id="${esc(item.itemId)}">
  <div class="gcard-hdr">
    <span class="gname">${esc(item.name ?? "Unnamed")}</span>
    <span class="gsub dim">${esc(item.subcategory ?? "")}</span>
    <span class="custlabel">${esc(item.customerLabel)}</span>
  </div>
  <div class="gcard-body">
    <div class="gcol-left">
      ${imgHtml}
      <div class="pp-block">
        <div class="sec-label">PASSPORT ${ppBadge}</div>
        ${passportHtml}
      </div>
    </div>
    <div class="gcol-right">
      <div class="sec-label">EFFECTIVE CLASSIFICATION <span class="dim">(admin-corrected)</span></div>
      <table class="cls-table"><tbody>${clsRows}</tbody></table>

      <div class="sec-label mt8">A — VISUAL WEIGHT</div>
      <div>${vwBadge} ${vwEv}</div>

      <div class="sec-label mt8">A — COLOUR PROFILE</div>
      <div>${cpBadges || '<em class="dim">null</em>'}</div>
      <div class="mt4">${cpEv}</div>

      <div class="sec-label mt8">B — PASSPORT-AWARE STYLING POTENTIAL</div>
      <table class="intent-table"><tbody>${intentRows}</tbody></table>

      <div class="shadow-note">Shadow-only · V1 · Not wired to StyleMe · Not final StyleMe reasoning</div>
    </div>
  </div>
</div>`;
}

function buildHTML(items: ExportItem[], summary: ExportSummary): string {
  const byCategory: Record<string, ExportItem[]> = {};
  for (const item of items) {
    (byCategory[item.category] ??= []).push(item);
  }

  const CAT_ORDER = [
    "TOPS","BOTTOMS","DRESSES","OUTERWEAR","ACTIVEWEAR",
    "SHOES","BAGS","ACCESSORIES","JEWELRY","SWIMWEAR","LOUNGEWEAR","OTHER",
  ];

  const tocLinks = CAT_ORDER
    .filter(c => byCategory[c]?.length)
    .map(c => `<li><a href="#cat-${c}">${esc(c)} (${byCategory[c]!.length})</a></li>`)
    .join("");

  const categorySections = CAT_ORDER
    .filter(c => byCategory[c]?.length)
    .map(c => `<section>
  <h2 class="cat-title" id="cat-${c}">${esc(c)} <span class="dim">(${byCategory[c]!.length})</span></h2>
  ${byCategory[c]!.map(renderItem).join("\n")}
</section>`)
    .join("\n\n");

  const vwRows = Object.entries(summary.visualWeight)
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`)
    .join("");

  const catRows = Object.entries(summary.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, n]) => `<tr><td>${esc(c)}</td><td>${n}</td></tr>`)
    .join("");

  const signalRows = summary.topSignals
    .slice(0, 25)
    .map(([s, n]) => `<tr><td>${esc(s)}</td><td>${n}</td></tr>`)
    .join("");

  const noSigRows = summary.intentionsNoSignals
    .map(([i, n]) => `<tr><td>${esc(i)}</td><td>${n}</td></tr>`)
    .join("");

  const tagRows = summary.topStyleTags
    .slice(0, 20)
    .map(([t, n]) => `<tr><td>${esc(t)}</td><td>${n}</td></tr>`)
    .join("");

  const personalityRows = summary.topStylePersonalities
    .slice(0, 20)
    .map(([p, n]) => `<tr><td>${esc(p)}</td><td>${n}</td></tr>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phase 3C V1 QA Export</title>
<style>
:root{--bg:#0d1117;--sf:#161b22;--sf2:#1c2128;--bd:#30363d;--tx:#e6edf3;--dm:#6e7681;--ac:#388bfd;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--bg);color:var(--tx);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1.5;}
a{color:var(--ac);}
.page-hdr{padding:1.5rem 2rem;border-bottom:1px solid var(--bd);}
.page-hdr h1{font-size:1.4rem;margin-bottom:.3rem;}
.page-hdr .meta{color:var(--dm);font-size:.78rem;}
.warn{margin:.75rem 0;padding:.6rem 1rem;background:#6b282180;border:1px solid #f8514944;border-radius:6px;color:#ffa198;font-size:.78rem;}
.layout{display:grid;grid-template-columns:200px 1fr;min-height:calc(100vh - 110px);}
.sidebar{border-right:1px solid var(--bd);padding:1rem;position:sticky;top:0;height:calc(100vh - 110px);overflow-y:auto;}
.sidebar h3{font-size:.65rem;text-transform:uppercase;letter-spacing:.08em;color:var(--dm);margin-bottom:.5rem;}
.sidebar ul{list-style:none;}
.sidebar li{margin-bottom:.2rem;font-size:.78rem;}
.main{padding:1.5rem;overflow:auto;}
.sum-section{margin-bottom:2rem;}
.sum-section h2{font-size:.85rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dm);margin-bottom:.75rem;}
.sum-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem;}
.sum-card{background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:.75rem;}
.sum-card h3{font-size:.65rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dm);margin-bottom:.5rem;}
table{width:100%;border-collapse:collapse;font-size:.75rem;}
th,td{padding:.2rem .4rem;border-bottom:1px solid var(--bd);text-align:left;}
th{color:var(--dm);font-size:.68rem;text-transform:uppercase;}
.cat-title{font-size:1rem;padding:.6rem 0;border-bottom:2px solid var(--bd);margin-bottom:1rem;}
.gcard{background:var(--sf);border:1px solid var(--bd);border-radius:8px;margin-bottom:1.25rem;overflow:hidden;}
.gcard-hdr{display:flex;align-items:baseline;gap:.6rem;padding:.6rem 1rem;background:var(--sf2);border-bottom:1px solid var(--bd);}
.gname{font-weight:600;font-size:.9rem;}
.gsub{font-size:.75rem;}
.custlabel{margin-left:auto;font-size:.68rem;color:#a5d6ff;background:#1e3a5f;padding:.1rem .45rem;border-radius:4px;border:1px solid #1e3a5f60;}
.gcard-body{display:grid;grid-template-columns:200px 1fr;}
.gcol-left{padding:.75rem;border-right:1px solid var(--bd);}
.gcol-right{padding:.75rem;overflow-x:auto;}
.gimg{width:100%;max-height:200px;object-fit:cover;border-radius:4px;border:1px solid var(--bd);display:block;}
.gimg-placeholder{width:100%;height:100px;background:var(--sf2);border:1px solid var(--bd);border-radius:4px;display:flex;align-items:center;justify-content:center;color:var(--dm);font-size:.72rem;}
.pp-block{margin-top:.6rem;}
.pp-row{font-size:.7rem;margin-bottom:.15rem;}
.pp-key{color:var(--dm);}
.sec-label{font-size:.62rem;text-transform:uppercase;letter-spacing:.06em;color:var(--dm);margin-bottom:.3rem;}
.mt4{margin-top:.3rem;}
.mt8{margin-top:.6rem;}
.cls-table td{padding:.12rem .35rem;font-size:.72rem;vertical-align:top;}
.ck{color:var(--dm);font-family:monospace;white-space:nowrap;}
.badge{display:inline-block;font-size:.65rem;padding:.08rem .35rem;border-radius:4px;border:1px solid var(--bd);background:var(--sf2);color:var(--tx);margin-right:.15rem;}
.badge.dim{color:var(--dm);}
.dim{color:var(--dm);}
code{font-family:"SFMono-Regular",Consolas,monospace;font-size:.7rem;background:var(--sf2);padding:.08rem .28rem;border-radius:3px;margin-right:.15rem;}
.intent-table{margin-top:.25rem;width:100%;}
.intent-table td{padding:.18rem .35rem;font-size:.7rem;border-bottom:1px solid var(--bd);vertical-align:top;}
.iname{white-space:nowrap;width:155px;}
.sig{display:inline-block;font-size:.67rem;color:#a5d6ff;background:#1e3a5f;padding:.08rem .3rem;border-radius:3px;margin:.08rem .08rem .08rem 0;}
.nosig{color:var(--dm);font-style:italic;}
.chip{display:inline-block;font-size:.67rem;padding:.08rem .3rem;border-radius:3px;background:#1e3a5f30;border:1px solid #1e3a5f50;color:#a5d6ff;margin-right:.15rem;}
.shadow-note{margin-top:.5rem;font-size:.65rem;color:var(--dm);font-style:italic;}
</style>
</head>
<body>
<header class="page-hdr">
  <h1>Phase 3C V1 — Full Closet QA Export</h1>
  <div class="meta">Generated: ${esc(summary.exportedAt)} · ${summary.totalItems} garments · ${summary.customers} customers · ${summary.imagesEmbedded} images embedded</div>
  <div class="warn">⚠ AUDIT ONLY — shadow-only Phase 3C V1 output. Do not act on individual signal issues until systemic review is complete. No Phase 3C or StyleMe logic was changed to generate this report.</div>
</header>
<div class="layout">
  <nav class="sidebar">
    <h3>Contents</h3>
    <ul>
      <li><a href="#summary">Summary</a></li>
      ${tocLinks}
    </ul>
  </nav>
  <main class="main">
    <section class="sum-section" id="summary">
      <h2>Aggregate Summary</h2>
      <div class="sum-grid">
        <div class="sum-card">
          <h3>Visual Weight</h3>
          <table><thead><tr><th>Value</th><th>Count</th></tr></thead><tbody>${vwRows}</tbody></table>
        </div>
        <div class="sum-card">
          <h3>By Category</h3>
          <table><thead><tr><th>Category</th><th>Count</th></tr></thead><tbody>${catRows}</tbody></table>
        </div>
        <div class="sum-card">
          <h3>Top Intention Signals</h3>
          <table><thead><tr><th>Signal</th><th>N</th></tr></thead><tbody>${signalRows}</tbody></table>
        </div>
        <div class="sum-card">
          <h3>Intentions with Most NO SIGNALS</h3>
          <table><thead><tr><th>Intention</th><th>N</th></tr></thead><tbody>${noSigRows}</tbody></table>
        </div>
        <div class="sum-card">
          <h3>Top Style Tags</h3>
          <table><thead><tr><th>Tag</th><th>N</th></tr></thead><tbody>${tagRows}</tbody></table>
        </div>
        <div class="sum-card">
          <h3>Style Personalities (from Passports)</h3>
          <table><thead><tr><th>Personality</th><th>N</th></tr></thead><tbody>${personalityRows}</tbody></table>
        </div>
      </div>
    </section>

    ${categorySections}
  </main>
</div>
</body>
</html>`;
}

// ── Main export function ───────────────────────────────────────────────────────

export async function generatePhase3CQAExport(
  options: GenerateOptions = {},
): Promise<Phase3CQAExportResult> {
  const db = (options._prisma ?? prisma) as PrismaClient;
  const fetchFn = options._fetch ?? fetch;
  const cfgFn = options._getCloudinaryConfig ?? getCloudinaryConfig;
  const nowFn = options._nowFn ?? Date.now;

  // ── 1. Query all closet items + admin reviews ─────────────────────────────
  const rawItems = await db.closetItem.findMany({
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      category: true,
      subcategory: true,
      customerId: true,
      imagePublicId: true,
      imageFormat: true,
      thumbnailUrl: true,
      // classification fields
      silhouette: true,
      fitProfile: true,
      hemLength: true,
      topLength: true,
      waistShape: true,
      sleeveLength: true,
      necklineCoverage: true,
      shoulderCoverage: true,
      midriffExposed: true,
      material: true,
      pattern: true,
      primaryColor: true,
      colors: true,
      occasions: true,
      seasons: true,
      formality: true,
      stylePersonality: true,
      styleTags: true,
      garmentRelationships: true,
      adminReview: {
        select: { reviewStatus: true, overrides: true },
      },
    },
  });

  // ── 2. Load all customer passports ────────────────────────────────────────
  const customerIds = [...new Set(rawItems.map(i => i.customerId))];
  const profiles = await db.onboardingProfile.findMany({
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

  // ── 3. Anonymise customers ────────────────────────────────────────────────
  const sortedIds = [...customerIds].sort();
  const labelMap = new Map<string, string>();
  sortedIds.forEach((id, i) => labelMap.set(id, customerLabel(i)));

  // ── 4. Build effective classifications + Phase 3C ─────────────────────────
  const cloudinaryConfig = cfgFn();

  const items: Omit<ExportItem, "imageDataUri">[] = rawItems.map(item => {
    const baseFields: ClosetItemFields = {
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
      styleTags: item.styleTags,
      stylePersonality: item.stylePersonality,
    };

    const review = item.adminReview as AdminReviewFields | null;
    const effective = getEffectiveClosetItem(baseFields, review);

    const classification: ClosetClassification = {
      category: item.category,
      ...effective,
      garmentRelationships: item.garmentRelationships,
    };

    const passport = passportMap.get(item.customerId) ?? null;
    const phase3c = toPhase3C(classification, passport);

    return {
      itemId: item.id,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      customerLabel: labelMap.get(item.customerId) ?? "Customer ?",
      passport,
      effectiveClassification: classification as unknown as Record<string, unknown>,
      phase3c,
    };
  });

  // ── 5. Fetch images with concurrency limit ─────────────────────────────────
  const imageUris = await withConcurrency(rawItems, 6, async (item) =>
    fetchImageDataUri(
      item.imagePublicId,
      item.imageFormat,
      item.thumbnailUrl,
      cloudinaryConfig,
      fetchFn,
      nowFn,
    ),
  );

  const exportItems: ExportItem[] = items.map((item, i) => ({
    ...item,
    imageDataUri: imageUris[i] ?? null,
  }));

  // ── 6. Build outputs ──────────────────────────────────────────────────────
  const exportedAt = new Date().toISOString();
  const imagesEmbedded = imageUris.filter(u => u !== null).length;
  const customersWithPassport = [...passportMap.keys()].length;

  const summary = buildSummary(
    exportItems,
    exportedAt,
    imagesEmbedded,
    customersWithPassport,
    customerIds.length,
  );

  const htmlContent = buildHTML(exportItems, summary);

  const jsonData = {
    meta: {
      exportedAt,
      totalItems: summary.totalItems,
      customers: summary.customers,
      customersWithPassport: summary.customersWithPassport,
      imagesEmbedded: summary.imagesEmbedded,
      phase3cVersion: "V1",
      shadowOnly: true,
      styleMeChanged: false,
      dbWritesPerformed: false,
    },
    summary: {
      visualWeight: summary.visualWeight,
      byCategory: summary.byCategory,
      topSignals: summary.topSignals,
      intentionsNoSignals: summary.intentionsNoSignals,
      topStyleTags: summary.topStyleTags,
      topStylePersonalities: summary.topStylePersonalities,
    },
    items: exportItems.map(item => ({
      itemId: item.itemId,
      name: item.name,
      category: item.category,
      subcategory: item.subcategory,
      customerLabel: item.customerLabel,
      passport: item.passport,
      effectiveClassification: item.effectiveClassification,
      phase3c: item.phase3c,
      hasEmbeddedImage: item.imageDataUri !== null,
    })),
  };

  return {
    htmlContent,
    jsonContent: JSON.stringify(jsonData, null, 2),
    summary,
  };
}
