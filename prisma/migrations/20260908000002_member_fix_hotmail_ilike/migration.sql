-- Case-insensitive retry: previous migration may have matched 0 rows due to email casing.
-- Sets both staging QA accounts to MEMBER regardless of stored case.
UPDATE "Customer"
SET "membershipStatus" = 'MEMBER'::"MembershipStatus"
WHERE LOWER(email) IN (
  'nadine.abuobeid@hotmail.co.uk',
  'nadeenabuobead@gmail.com'
);
