-- Migration: 20260904000000_closet_customer_note
-- Adds customerNote (optional free-text) to ClosetItem.
-- Safe: nullable column with no default — zero downtime, no backfill required.

ALTER TABLE "ClosetItem" ADD COLUMN "customerNote" TEXT;
