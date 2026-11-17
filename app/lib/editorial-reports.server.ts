import prisma from "../db.server";
import { timingSafeStringEqual } from "./timing-safe-equal.server";
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

// getEffectiveEditionPeriod/formatEditionMonthLabel moved to
// editorial-report-edition.ts (no ".server" suffix) — they're pure and
// need to be callable from route COMPONENTS (trends.jsx, trends.$slug.tsx,
// trends.$slug.lens.$lens.tsx render the edition label directly), and
// React Router's build rejects a .server module reachable from a route's
// default export, not just its loader/action.

function dbToTrendReportData(r: NonNullable<DbRow>): TrendReportData {
  return {
    slug: r.slug,
    title: r.title,
    season: r.season,
    publishedAt: r.publishedAt,
    editionMonth: r.editionMonth ?? undefined,
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

// #23 QA fixture only — see api.seed-staging.jsx's
// createDuplicateMonthTrendEditFixture comment for the full rationale.
// Every real customer, and every other route in this app, keeps calling
// getPublishedEditorialReports() above completely unmodified. This wrapper
// is wired into exactly one route (trends.my-edits.tsx) and only changes
// behaviour when ALL THREE conditions hold on the SAME request:
//   1. TREND_EDIT_FIXTURE_ENABLED === "true" (already required to create
//      the fixture rows in the first place);
//   2. the request's x-trend-edit-fixture-preview header matches
//      TREND_EDIT_FIXTURE_PREVIEW_SECRET — constant-time comparison
//      (timingSafeStringEqual), not a plain `!==`, since this guards a
//      real secret and a byte-by-byte early-exit compare leaks how many
//      leading characters a guess got right; and
//   3. the authenticated customer calling this is the one specific,
//      founder-authorized QA customer (TREND_EDIT_FIXTURE_QA_CUSTOMER_ID)
//      — a plain identity check, not a secret comparison, so no timing
//      concern applies here. Fails closed (no match) whenever this env
//      var is unset, exactly like the other two gates.
// Without an exact match on all three, this returns byte-for-byte the same
// result as getPublishedEditorialReports() — i.e. the fixture rows (status:
// DRAFT) stay invisible, same as they are to every other customer and
// every other page, INCLUDING a customer who has the right secret but is
// not the one authorized QA identity.
const QA_FIXTURE_SLUGS = [
  "test-batch1-trend-edit-samemonth-a",
  "test-batch1-trend-edit-samemonth-b",
];

export async function getPublishedEditorialReportsForQaPreview(
  request: Request,
  customerId: string | null | undefined,
): Promise<TrendReportData[]> {
  const published = await getPublishedEditorialReports();

  const flagOn = process.env.TREND_EDIT_FIXTURE_ENABLED === "true";
  const secret = process.env.TREND_EDIT_FIXTURE_PREVIEW_SECRET;
  const authorizedCustomerId = process.env.TREND_EDIT_FIXTURE_QA_CUSTOMER_ID;
  if (!flagOn || !secret || !authorizedCustomerId) return published;

  const provided = request.headers.get("x-trend-edit-fixture-preview");
  if (!timingSafeStringEqual(provided, secret)) return published;

  if (!customerId || customerId !== authorizedCustomerId) return published;

  const fixtureRows = await prisma.editorialTrendReport.findMany({
    where: { slug: { in: QA_FIXTURE_SLUGS }, status: "DRAFT" },
    orderBy: [{ order: "asc" }, { publishedAt: "desc" }],
  });
  return [...published, ...fixtureRows.map(dbToTrendReportData)];
}

export async function getEditorialReportBySlug(slug: string): Promise<TrendReportData | null> {
  // Check if ANY DB record exists for this slug (regardless of status).
  // If it does, the admin publishing status is authoritative — return null for
  // DRAFT/ARCHIVED rather than falling through to the static array.
  const anyRow = await prisma.editorialTrendReport.findUnique({ where: { slug } });
  if (anyRow) {
    return anyRow.status === "PUBLISHED" ? dbToTrendReportData(anyRow) : null;
  }
  // No DB record at all — fall back to static array (pre-seed safety net).
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
  editionMonth?: string | null;
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
        editionMonth: r.editionMonth ?? null,
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
