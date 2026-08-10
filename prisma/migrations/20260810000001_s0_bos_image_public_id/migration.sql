-- S0: Add private Cloudinary asset reference to BuyOrSkipAnalysis.
-- Additive migration — no existing data is modified.
-- imagePublicId stores the private asset's Cloudinary public ID (naia-wardrobe/{customerId}/...).
-- imageFormat stores the format string needed to generate signed download URLs.
-- Both columns are nullable so all pre-S0 records remain valid with imageUrl as the legacy path.

ALTER TABLE "BuyOrSkipAnalysis" ADD COLUMN "imagePublicId" TEXT;
ALTER TABLE "BuyOrSkipAnalysis" ADD COLUMN "imageFormat" TEXT;
