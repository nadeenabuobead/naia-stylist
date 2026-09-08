-- Move athletic-brand items to ACTIVEWEAR regardless of whether they were
-- filed as TOPS or OUTERWEAR. Covers Nike, Under Armour, Adidas, Puma, etc.
UPDATE "ClosetItem"
SET "category" = 'ACTIVEWEAR'::"ClosetCategory"
WHERE (
  LOWER("name") LIKE '%nike%'
  OR LOWER("name") LIKE '%under armour%'
  OR LOWER("name") LIKE '%adidas%'
  OR LOWER("name") LIKE '%puma%'
  OR LOWER("name") LIKE '%dri-fit%'
  OR LOWER("name") LIKE '%dri fit%'
  OR LOWER("name") LIKE '%track jacket%'
  OR LOWER("name") LIKE '%zip-up jacket%'
  OR LOWER("name") LIKE '%athletic%'
  OR LOWER("name") LIKE '%sport%'
)
AND "category" IN ('TOPS'::"ClosetCategory", 'OUTERWEAR'::"ClosetCategory");
