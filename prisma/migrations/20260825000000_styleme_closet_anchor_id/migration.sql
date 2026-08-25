-- Add closetAnchorId to StylingSession to persist the selected Closet anchor.
-- Required for "New Look, Same Vibe" regenerate on BOTH and CLOSET sources:
-- without this column, the regenerate action has no way to recover the anchor
-- the customer selected in the source step (cookie is unavailable in the action).
-- Historical sessions default to null; the regenerate action already handles
-- null as a no-anchor path for NAIA source and fails gracefully for BOTH/CLOSET.
ALTER TABLE "StylingSession" ADD COLUMN "closetAnchorId" TEXT;
