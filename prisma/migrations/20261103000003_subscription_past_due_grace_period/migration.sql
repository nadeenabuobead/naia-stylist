-- Phase 3 security/billing review fix (2026-11)
--
-- Adds Subscription.pastDueSince, used to enforce the documented 7-day
-- PAST_DUE grace period independently of the connected Stripe account's
-- own dunning/retry configuration. Without this, a subscription left in
-- PAST_DUE (or Stripe's "unpaid" status, mapped to PAST_DUE) could grant
-- paid access indefinitely if Stripe's retry schedule never gives up.
--
-- Nullable, defaulting to null for every existing row — no behaviour
-- change for any currently-stored subscription until the webhook handler
-- starts setting/clearing it on PAST_DUE transitions.

ALTER TABLE "Subscription" ADD COLUMN "pastDueSince" TIMESTAMP(3);
