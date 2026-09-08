-- Fix track jackets / zip-up jackets misfiled as TOPS → OUTERWEAR
UPDATE "ClosetItem"
SET "category" = 'OUTERWEAR'::"ClosetCategory"
WHERE (LOWER("name") LIKE '%jacket%' OR LOWER("name") LIKE '%zip-up%' OR LOWER("name") LIKE '%track jacket%')
  AND "category" = 'TOPS'::"ClosetCategory";

-- Fix track jackets misfiled as ACTIVEWEAR → OUTERWEAR
UPDATE "ClosetItem"
SET "category" = 'OUTERWEAR'::"ClosetCategory"
WHERE (LOWER("name") LIKE '%jacket%' OR LOWER("name") LIKE '%zip-up%' OR LOWER("name") LIKE '%track jacket%')
  AND "category" = 'ACTIVEWEAR'::"ClosetCategory";
