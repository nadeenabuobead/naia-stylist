-- SavedItem — the general saved-object store (Step 2)
--
-- Additive. Nothing reads or writes this table until the save affordances land
-- in Step 3; My Saved renders an empty Saved lane until then.
--
-- Identity is refKey, unique per customer, which makes repeated saves idempotent.
-- reportId is intentionally NOT a foreign key: a save must survive its report
-- being unpublished or deleted and keep rendering from its snapshot.

CREATE TABLE IF NOT EXISTS "SavedItem" (
  "id"                 TEXT NOT NULL,
  "customerId"         TEXT NOT NULL,
  "refKey"             TEXT NOT NULL,
  "contentType"        TEXT NOT NULL,
  "contentId"          TEXT NOT NULL,
  "reportId"           TEXT,
  "label"              TEXT NOT NULL,
  "sublabel"           TEXT,
  "imageUrl"           TEXT,
  "sourceKind"         TEXT NOT NULL,
  "sourceReportTitle"  TEXT,
  "sourceSeason"       TEXT,
  "sourceContentId"    TEXT,
  "sourceContentLabel" TEXT,
  "sourcePath"         TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SavedItem_customerId_refKey_key"
  ON "SavedItem"("customerId", "refKey");
CREATE INDEX IF NOT EXISTS "SavedItem_customerId_createdAt_idx"
  ON "SavedItem"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "SavedItem_customerId_contentType_idx"
  ON "SavedItem"("customerId", "contentType");
CREATE INDEX IF NOT EXISTS "SavedItem_customerId_reportId_idx"
  ON "SavedItem"("customerId", "reportId");

ALTER TABLE "SavedItem"
  ADD CONSTRAINT "SavedItem_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
