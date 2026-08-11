-- Image Security: shared private-upload architecture for ClosetItem and NaiaModel.
-- Additive migration — no existing data is modified.
--
-- ClosetItem:
--   imageUrl     → made nullable (legacy path; new uploads store publicId instead)
--   imagePublicId → new nullable column for private Cloudinary asset reference
--   imageFormat   → new nullable column for signed URL generation
--
-- NaiaModel:
--   bodyModerationStatus → PENDING until Layer 2+3 pass; APPROVED enables VTO
--   bodyModerationAt     → timestamp of the moderation decision

-- ClosetItem changes
ALTER TABLE "ClosetItem" ALTER COLUMN "imageUrl" DROP NOT NULL;
ALTER TABLE "ClosetItem" ADD COLUMN "imagePublicId" TEXT;
ALTER TABLE "ClosetItem" ADD COLUMN "imageFormat"   TEXT;

-- NaiaModel changes
ALTER TABLE "NaiaModel"  ADD COLUMN "bodyModerationStatus" TEXT DEFAULT 'PENDING';
ALTER TABLE "NaiaModel"  ADD COLUMN "bodyModerationAt"     TIMESTAMP(3);
