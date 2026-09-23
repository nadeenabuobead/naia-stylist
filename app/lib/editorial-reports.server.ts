import prisma from "../db.server";
import {
  trendReports,
  type TrendReportData,
  type TrendReportKeyTrend,
  type TrendReportSpendSaveSkip,
} from "./trend-reports";
import {
  normaliseSignal,
  normaliseReference,
  normaliseSource,
  signalHasContent,
  referenceHasContent,
  sourceHasContent,
} from "./editorial-reports.normalise";
import {
  applyContentIdentity,
  computeEditionKey,
  isContentId,
} from "./trend-content-identity";
import { validateFacets, isEmptyFacets } from "./trend-facets";

type DbRow = Awaited<
  ReturnType<typeof prisma.editorialTrendReport.findFirst>
> & object;

function dbToTrendReportData(r: NonNullable<DbRow>): TrendReportData {
  return {
    slug: r.slug,
    editionKey: r.editionKey || computeEditionKey(r as Record<string, unknown>),
    title: r.title,
    season: r.season,
    publishedAt: r.publishedAt,
    mood: r.mood ?? undefined,
    summary: r.summary,
    editorialIntro: r.editorialIntro,
    naiaTake: r.naiaTake ?? undefined,
    naiaInterpretation: r.naiaInterpretation ?? undefined,
    naiaVerdict: r.naiaVerdict ?? undefined,
    wardrobeNote: r.wardrobeNote ?? undefined,
    investmentNotes: r.investmentNotes ?? undefined,
    keyTrends: ((r.keyTrends ?? []) as Record<string, unknown>[]).map(normaliseKeyTrend),
    rising: ((r.rising ?? []) as Record<string, unknown>[])
      .map(normaliseSignal).filter(signalHasContent),
    fading: ((r.fading ?? []) as Record<string, unknown>[])
      .map(normaliseSignal).filter(signalHasContent),
    referencesBehindThisEdit: ((r.referencesBehindThisEdit ?? []) as Record<string, unknown>[])
      .map(normaliseReference).filter(referenceHasContent),
    howToWear: (r.howToWear ?? []) as { feeling: string; direction: string }[],
    sources: ((r.sources ?? []) as Record<string, unknown>[])
      .map(normaliseSource).filter(sourceHasContent),
    spendSaveSkip: (r.spendSaveSkip && typeof r.spendSaveSkip === "object" && Object.keys(r.spendSaveSkip).length > 0)
      ? (r.spendSaveSkip as TrendReportSpendSaveSkip)
      : undefined,
    published: r.status === "PUBLISHED",
    order: r.order,
    visual: r.visualTreatment
      ? { treatment: r.visualTreatment as TrendReportData["visual"] extends { treatment: infer T } | undefined ? T : never }
      : undefined,
  };
}

// ── Content identity ──────────────────────────────────────────────────────────
// Every write goes through ensureContentIdentity(). The admin editor is a set of
// raw JSON textareas, so identity cannot be enforced in the UI — a paste that
// drops an id would otherwise orphan every SavedItem pointing at it. Enforcing
// here means it is enforced for every caller, including the seed path.

function normaliseKeyTrend(item: Record<string, unknown>): TrendReportKeyTrend {
  const out: TrendReportKeyTrend = {
    name: String(item.name ?? ""),
    description: String(item.description ?? ""),
  };
  if (isContentId(item.id)) out.id = item.id as string;
  const { facets } = validateFacets(item.facets);
  if (!isEmptyFacets(facets)) out.facets = facets;
  return out;
}

/** Applies the same identity rules to a static-array report as to a DB row. */
function withStaticIdentity(report: TrendReportData): TrendReportData {
  const identified = ensureContentIdentity(
    {
      slug: report.slug,
      title: report.title,
      season: report.season,
      keyTrends: report.keyTrends as unknown,
      rising: (report.rising ?? []) as unknown,
      fading: (report.fading ?? []) as unknown,
      referencesBehindThisEdit: (report.referencesBehindThisEdit ?? []) as unknown,
    },
    null,
  );
  return {
    ...report,
    editionKey: identified.editionKey,
    keyTrends: identified.keyTrends as TrendReportData["keyTrends"],
    rising: identified.rising as TrendReportData["rising"],
    fading: identified.fading as TrendReportData["fading"],
    referencesBehindThisEdit:
      identified.referencesBehindThisEdit as TrendReportData["referencesBehindThisEdit"],
  };
}

type IdentityInput = {
  slug: string;
  title: string;
  season: string;
  keyTrends: unknown;
  rising: unknown;
  fading: unknown;
  referencesBehindThisEdit: unknown;
};

/**
 * Assign stable ids to every identity-bearing entry, validate per-entry facets,
 * and recompute the edition key. Existing ids are preserved; a missing one is
 * recovered from `previous` by label or position before a new id is derived.
 *
 * Returns a shallow copy — the caller's object is not mutated.
 */
function ensureContentIdentity<T extends IdentityInput>(
  data: T,
  previous: Record<string, unknown> | null,
): T & { editionKey: string } {
  const applied = applyContentIdentity(data, previous);
  return {
    ...data,
    keyTrends: applied.keyTrends,
    rising: applied.rising,
    fading: applied.fading,
    referencesBehindThisEdit: applied.referencesBehindThisEdit,
    editionKey: applied.editionKey,
  } as T & { editionKey: string };
}

export async function getPublishedEditorialReports(): Promise<TrendReportData[]> {
  // Check for any DB records (regardless of status) — a non-zero count means
  // the table has been seeded and admin controls are authoritative.
  const totalCount = await prisma.editorialTrendReport.count();
  if (totalCount === 0) {
    // Pre-seed safety net: DB table is empty, fall back to the static array.
    // Identity is applied here too, so the fallback path and the DB path agree
    // on every content id — a save made pre-seed still resolves post-seed.
    return trendReports.filter((r) => r.published).map(withStaticIdentity);
  }
  const rows = await prisma.editorialTrendReport.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
  });
  return rows.map(dbToTrendReportData);
}

export async function getEditorialReportBySlug(slug: string): Promise<TrendReportData | null> {
  // Check if ANY DB record exists for this slug (regardless of status).
  // If it does, the admin publishing status is authoritative — return null for
  // DRAFT/ARCHIVED rather than falling through to the static array.
  const anyRow = await prisma.editorialTrendReport.findUnique({ where: { slug } });
  if (anyRow) {
    return anyRow.status === "PUBLISHED" ? dbToTrendReportData(anyRow) : null;
  }
  // No DB record at all — fall back to the static array (pre-seed safety net).
  const staticReport = trendReports.find((r) => r.slug === slug && r.published);
  return staticReport ? withStaticIdentity(staticReport) : null;
}

export async function getAllEditorialReports() {
  return prisma.editorialTrendReport.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
  });
}

export async function getEditorialReportById(id: string) {
  return prisma.editorialTrendReport.findUnique({ where: { id } });
}

type ReportInput = {
  slug: string;
  title: string;
  season: string;
  mood?: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  publishedAt: string;
  order: number;
  featured: boolean;
  summary: string;
  editorialIntro: string;
  naiaTake?: string | null;
  naiaInterpretation?: string | null;
  naiaVerdict?: string | null;
  wardrobeNote?: string | null;
  investmentNotes?: string | null;
  keyTrends: unknown;
  rising: unknown;
  fading: unknown;
  referencesBehindThisEdit: unknown;
  howToWear: unknown;
  sources: unknown;
  spendSaveSkip: unknown;
  visualTreatment?: string | null;
};

export async function createEditorialReport(data: ReportInput) {
  return prisma.editorialTrendReport.create({
    data: ensureContentIdentity(data, null) as ReportInput & { editionKey: string },
  });
}

export async function updateEditorialReport(id: string, data: ReportInput) {
  // Read the current row first so an id dropped from the admin textarea can be
  // recovered rather than reminted.
  const previous = await prisma.editorialTrendReport.findUnique({ where: { id } });
  return prisma.editorialTrendReport.update({
    where: { id },
    data: ensureContentIdentity(data, previous as Record<string, unknown> | null) as ReportInput & { editionKey: string },
  });
}

export async function deleteEditorialReport(id: string) {
  return prisma.editorialTrendReport.delete({ where: { id } });
}

export async function setEditorialReportStatus(id: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  return prisma.editorialTrendReport.update({ where: { id }, data: { status } });
}

export async function seedEditorialReportsFromStatic() {
  for (const r of trendReports) {
    // Seeded rows go through the same identity chokepoint as admin saves, so a
    // freshly seeded report is immediately saveable.
    const identified = ensureContentIdentity(
      {
        slug: r.slug,
        title: r.title,
        season: r.season,
        keyTrends: r.keyTrends as unknown,
        rising: (r.rising ?? []) as unknown,
        fading: (r.fading ?? []) as unknown,
        referencesBehindThisEdit: (r.referencesBehindThisEdit ?? []) as unknown,
      },
      null,
    );
    await prisma.editorialTrendReport.upsert({
      where: { slug: r.slug },
      create: {
        slug: r.slug,
        editionKey: identified.editionKey,
        title: r.title,
        season: r.season,
        mood: r.mood ?? null,
        status: r.published ? "PUBLISHED" : "DRAFT",
        publishedAt: r.publishedAt,
        order: r.order ?? 0,
        featured: false,
        summary: r.summary,
        editorialIntro: r.editorialIntro,
        naiaTake: r.naiaTake ?? null,
        naiaInterpretation: r.naiaInterpretation ?? null,
        naiaVerdict: r.naiaVerdict ?? null,
        wardrobeNote: r.wardrobeNote ?? null,
        investmentNotes: r.investmentNotes ?? null,
        keyTrends: identified.keyTrends as object[],
        rising: identified.rising as object[],
        fading: identified.fading as object[],
        referencesBehindThisEdit: identified.referencesBehindThisEdit as object[],
        howToWear: (r.howToWear ?? []) as object[],
        sources: r.sources as object[],
        spendSaveSkip: (r.spendSaveSkip ?? {}) as object,
        visualTreatment: r.visual?.treatment ?? null,
      },
      update: {},
    });
  }
  return trendReports.length;
}
