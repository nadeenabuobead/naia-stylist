-- Targeted fix: set shopifyCustomerId 9621372010628 to MEMBER.
-- Customer was created via Shopify login (email is null); previous
-- email-based migrations matched 0 rows.
UPDATE "Customer"
SET "membershipStatus" = 'MEMBER'::"MembershipStatus"
WHERE "shopifyCustomerId" = '9621372010628';
