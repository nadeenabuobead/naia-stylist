-- AlterTable: StyleTendency — optional "not-quite" feedback context.
--
-- V1 Passport Noticing UX: the first click on "Not quite" now opens an
-- inline form instead of submitting immediately. notQuiteReason is a short
-- free string naming which of a fixed set of reasons the customer picked
-- (doesnt-feel-like-me | only-sometimes | depends-on-situation |
-- used-to-be-true | something-else); notQuiteNote is their optional
-- free-text comment. Both are additive and nullable — existing rows are
-- unaffected, and a plain "not-quite" (Skip Details) leaves both null,
-- exactly as before this migration.
--
-- Customer feedback context only: never read as structured Taste evidence,
-- never consumed by reconcileObservations' aggregation/threshold math, and
-- never used to rewrite a Style Passport answer.

ALTER TABLE "StyleTendency" ADD COLUMN "notQuiteReason" TEXT;
ALTER TABLE "StyleTendency" ADD COLUMN "notQuiteNote" TEXT;
