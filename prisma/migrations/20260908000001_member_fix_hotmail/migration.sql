-- Data fix: set staging QA account to MEMBER.
-- Applied once via prisma migrate deploy on next staging build.
UPDATE "Customer"
SET "membershipStatus" = 'MEMBER'
WHERE email = 'nadine.abuobeid@hotmail.co.uk';
