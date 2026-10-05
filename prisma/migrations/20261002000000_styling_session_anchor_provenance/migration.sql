-- Who chose the anchor garment, so "New Look, Same Vibe" knows whether it may move the
-- structural centre of the outfit. Additive and nullable: every existing row reads NULL,
-- which the application treats as MANUAL — the conservative default, because silently
-- replacing a garment the customer chose is the worse failure.

CREATE TYPE "AnchorProvenance" AS ENUM ('AUTO', 'MANUAL');

ALTER TABLE "StylingSession" ADD COLUMN "anchorProvenance" "AnchorProvenance";
