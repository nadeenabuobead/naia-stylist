-- Fix items mislabelled during QA while the category_mismatch guard was
-- blocking adds. Users changed categories in EDIT DETAILS to bypass the
-- error; this restores them to the correct values.
--
-- Joggers filed as OUTERWEAR → ACTIVEWEAR
UPDATE "ClosetItem"
SET "category" = 'ACTIVEWEAR'::"ClosetCategory"
WHERE LOWER("name") LIKE '%jogger%'
  AND "category" = 'OUTERWEAR'::"ClosetCategory";

-- Athletic shorts filed as TOPS → ACTIVEWEAR
UPDATE "ClosetItem"
SET "category" = 'ACTIVEWEAR'::"ClosetCategory"
WHERE LOWER("name") LIKE '%short%'
  AND "category" = 'TOPS'::"ClosetCategory";
