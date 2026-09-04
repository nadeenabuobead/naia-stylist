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

type DbRow = Awaited<
  ReturnType<typeof prisma.editorialTrendReport.findFirst>
> & object;

function dbToTrendReportData(r: NonNullable<DbRow>): TrendReportData {
  return {
    slug: r.slug,
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
    keyTrends: (r.keyTrends ?? []) as TrendReportKeyTrend[],
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

export async function getPublishedEditorialReports(): Promise<TrendReportData[]> {
  // Check for any DB records (regardless of status) — a non-zero count means
  // the table has been seeded and admin controls are authoritative.
  const totalCount = await prisma.editorialTrendReport.count();
  if (totalCount === 0) {
    // Pre-seed safety net: DB table is empty, fall back to static array.
    return trendReports.filter((r) => r.published);
  }
  const rows = await prisma.editorialTrendReport.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
  });
  return rows.map(dbToTrendReportData);
}

export async function getEditorialReportBySlug(slug: string): Promise<TrendReportData | null> {
  const anyRow = await prisma.editorialTrendReport.findUnique({ where: { slug } });
  if (anyRow) {
    if (anyRow.status === "PUBLISHED") return dbToTrendReportData(anyRow);
    // DB record exists but is not published — fall back to the static array as a
    // safety net. This prevents a staging DB row in DRAFT/ARCHIVED status from
    // blocking public access when the static array still marks the report as published.
    // Once the admin explicitly publishes or the seed is run, the DB row takes over.
    return trendReports.find((r) => r.slug === slug && r.published) ?? null;
  }
  // No DB record — static array fallback.
  return trendReports.find((r) => r.slug === slug && r.published) ?? null;
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
  return prisma.editorialTrendReport.create({ data });
}

export async function updateEditorialReport(id: string, data: ReportInput) {
  return prisma.editorialTrendReport.update({ where: { id }, data });
}

export async function deleteEditorialReport(id: string) {
  return prisma.editorialTrendReport.delete({ where: { id } });
}

export async function setEditorialReportStatus(id: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  return prisma.editorialTrendReport.update({ where: { id }, data: { status } });
}

export async function seedEditorialReportsFromStatic() {
  for (const r of trendReports) {
    await prisma.editorialTrendReport.upsert({
      where: { slug: r.slug },
      create: {
        slug: r.slug,
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
        keyTrends: r.keyTrends as object[],
        rising: (r.rising ?? []) as object[],
        fading: (r.fading ?? []) as object[],
        referencesBehindThisEdit: (r.referencesBehindThisEdit ?? []) as object[],
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
