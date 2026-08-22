-- Phase 5C: admin-managed editorial trend reports.
-- Additive migration — no existing tables are modified.

CREATE TYPE "EditorialReportStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "editorial_trend_reports" (
    "id"                      TEXT NOT NULL,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL,
    "slug"                    TEXT NOT NULL,
    "title"                   TEXT NOT NULL,
    "season"                  TEXT NOT NULL,
    "mood"                    TEXT,
    "status"                  "EditorialReportStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt"             TEXT NOT NULL DEFAULT '',
    "order"                   INTEGER NOT NULL DEFAULT 0,
    "featured"                BOOLEAN NOT NULL DEFAULT false,
    "summary"                 TEXT NOT NULL,
    "editorialIntro"          TEXT NOT NULL,
    "naiaTake"                TEXT,
    "naiaInterpretation"      TEXT,
    "naiaVerdict"             TEXT,
    "wardrobeNote"            TEXT,
    "investmentNotes"         TEXT,
    "keyTrends"               JSONB NOT NULL DEFAULT '[]',
    "rising"                  JSONB NOT NULL DEFAULT '[]',
    "fading"                  JSONB NOT NULL DEFAULT '[]',
    "referencesBehindThisEdit" JSONB NOT NULL DEFAULT '[]',
    "howToWear"               JSONB NOT NULL DEFAULT '[]',
    "sources"                 JSONB NOT NULL DEFAULT '[]',
    "spendSaveSkip"           JSONB NOT NULL DEFAULT '{}',
    "visualTreatment"         TEXT,
    CONSTRAINT "editorial_trend_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "editorial_trend_reports_slug_key" ON "editorial_trend_reports"("slug");
