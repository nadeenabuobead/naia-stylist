import prisma from "../db.server";
import {
  trendReports,
  type TrendReportData,
  type TrendReportKeyTrend,
  type TrendReportSource,
  type TrendSignal,
  type TrendReportReferenceCard,
  type TrendReportSpendSaveSkip,
} from "./trend-reports";

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
    rising: (r.rising ?? []) as TrendSignal[],
    fading: (r.fading ?? []) as TrendSignal[],
    referencesBehindThisEdit: (r.referencesBehindThisEdit ?? []) as TrendReportReferenceCard[],
    howToWear: (r.howToWear ?? []) as { feeling: string; direction: string }[],
    sources: (r.sources ?? []) as TrendReportSource[],
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
  const rows = await prisma.editorialTrendReport.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
  });
  if (rows.length === 0) {
    // Fallback to static array while DB is empty (before first seed)
    return trendReports.filter((r) => r.published);
  }
  return rows.map(dbToTrendReportData);
}

export async function getEditorialReportBySlug(slug: string): Promise<TrendReportData | null> {
  const row = await prisma.editorialTrendReport.findFirst({
    where: { slug, status: "PUBLISHED" },
  });
  if (!row) {
    // Fallback to static array
    return trendReports.find((r) => r.slug === slug && r.published) ?? null;
  }
  return dbToTrendReportData(row);
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
