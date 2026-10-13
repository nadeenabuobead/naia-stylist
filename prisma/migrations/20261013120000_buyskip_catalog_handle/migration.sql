-- AlterTable: BuyOrSkipAnalysis — forward-compatible NADINE catalog identity.
--
-- Additive, nullable column. No current write path populates it: the sole
-- creation site (analyzeItem() in api.wishlist.jsx) only accepts an
-- arbitrary customer-uploaded photo, with no "evaluate this NADINE product"
-- entry point today. catalogHandle mirrors the handle already used as the
-- NADINE catalog's own primary key (VerifiedMediaEntry.catalogHandle,
-- VirtualTryOnJob.productHandle) rather than a Shopify product/GID, since
-- that handle is this codebase's one real cross-system product key.
--
-- Existing Buy/Skip history is unaffected — every pre-existing row reads
-- catalogHandle = NULL, same as every new arbitrary-upload analysis until
-- a NADINE-origin entry point is built to populate it.

ALTER TABLE "BuyOrSkipAnalysis" ADD COLUMN "catalogHandle" TEXT;
