-- Migration: 20260831000000_styleme_rev3
-- Additive only: adds state + intentions to StylingSession for Rev 3 Psychology-First StyleMe.
-- No DROP, no ALTER COLUMN TYPE, no breaking changes.

ALTER TABLE "StylingSession" ADD COLUMN IF NOT EXISTS "state" TEXT;
ALTER TABLE "StylingSession" ADD COLUMN IF NOT EXISTS "intentions" TEXT[] NOT NULL DEFAULT '{}';
