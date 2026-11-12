# Phase 1+2 Security/Privacy Release Manifest

**Prepared:** 2026-10-20. **Branch:** `fix/phase2-privacy-remediation` @ `8b9d2b6` (contains `fix/phase1-legacy-api-lockdown` @ `ca215fd` as its base, verified by ancestry). **Not deployed. Not pushed.**

## 1. Compatibility against the currently serving staging version

Staging's live production deployment (`naia-stylist-staging`, confirmed via Vercel deployment metadata) is at commit `ce41ee88` on `feat/admin-customer-360`. `git merge-base` between that commit and this release's tip returns `ce41ee88` itself — **this release branched directly from staging's current live tip, with zero commits on staging's side since.** This is a clean 27-commit fast-forward, not a divergent branch: no concurrent changes to reconcile, no expected merge conflicts.

Reviewed the full 71-file diff for anything outside security/privacy scope: one build-config change (`vite.config.js` — a defensive fallback so a malformed local `SHOPIFY_APP_URL` doesn't crash local dev; zero behavior change on any deployed environment, which always sets this var correctly) and a `package.json` test-script addition (test-only, no runtime effect). Nothing else is unrelated to the stated scope.

## 2. Required migrations (apply automatically on deploy — see §5)

In order, all additive (no column drops, no renames):

| Migration | Adds |
|---|---|
| `20261019180000_admin_login_attempt` | `AdminLoginAttempt` table — brute-force lockout tracking |
| `20261019190000_customer_age_confirmation` | Age-confirmation fields on `Customer` |
| `20261019200000_photo_consent_fields` | Photo-consent fields on `ClosetItem`/`NaiaModel`/`VirtualTryOnJob` |
| `20261019210000_admin_audit_log` | `AdminAuditLog` table |

No column is dropped, renamed, or narrowed — a rollback never needs a corresponding "down" migration to avoid data loss (see §6).

## 3. Environment variables

**None required beyond what staging already has.** Every `process.env.*` reference touched or added by this release (`BODYGRAM_API_KEY`, `BODYGRAM_ORG_ID`, `NAIA_CUSTOMER_SECRET`, `SESSION_SECRET`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`) is pre-existing and already configured — confirmed by diffing every added line in the full release against staging's live commit. No new secret, flag, or config value needs to be added before deploying this code.

## 4. Shopify configuration

`shopify.app.toml` gains 3 `compliance_topics` webhook subscriptions (`customers/data_request`, `customers/redact`, `shop/redact`), already pointing at routes registered in `app/routes.ts` and implemented with Shopify's HMAC-verifying `authenticate.webhook`. This file change deploys with the code, but **registering it with Shopify itself is a separate step**: `shopify app deploy` must run against this config before Shopify's Partner platform actually subscribes to these topics or clears the MISSING_COMPLIANCE_WEBHOOKS review flag. Vercel code deploy and `shopify app deploy` are two distinct actions — neither implies the other.

## 5. Deployment order

Both `naia-stylist` and `naia-stylist-staging`'s `vercel.json`/`scripts/build-preview.sh` already run `prisma migrate deploy` automatically as part of every build, for both Production and Preview targets — confirmed by reading the actual, currently-live `vercel.json` and `build-preview.sh`. Migrations are **not** a separate manual step; they apply atomically as part of the same build that deploys the code. Recommended order once approved:
1. Push/merge this branch (not done today).
2. Vercel's build runs `prisma migrate deploy` (applies the 4 migrations above) then builds and deploys the code in one pass.
3. Separately, run `shopify app deploy` to register the 3 webhook subscriptions with Shopify (§4) — can happen before or after step 2, but the webhook routes must already be live before Shopify's first real delivery attempt.
4. Trigger a live test delivery of each of the 3 webhooks from the Partner Dashboard to confirm end-to-end.

## 6. Rollback considerations

- **Code:** a plain revert/redeploy of the previous commit is sufficient — no feature flag gates this work, so rollback is a normal Vercel rollback.
- **Migrations:** all 4 are additive only (new tables/columns, nothing dropped or altered). A code rollback does **not** require a migration rollback — old code simply ignores the new columns/tables. Do not run a migration rollback unless reclaiming the schema is specifically desired; doing so is strictly optional and lower-urgency than the code rollback.
- **Shopify webhook registration:** once `shopify app deploy` registers `compliance_topics`, there is no code-side rollback needed — an unregistration would require a separate, deliberate `shopify app deploy` with the subscriptions removed, which is not expected to ever be necessary.

## 7. Acceptance tests (pre-deploy, already passing locally)

- Phase 1: 45/45 (`phase1-legacy-api-lockdown.test.ts`) + 6/6 synthetic multi-customer integration tests — re-confirmed passing from this exact branch tip.
- Phase 2 photo-consent/ownership (today's work): 41/41 across the 4 new behavioral files, plus the corrected static assertions.
- Full `react-router build`: clean.
- **Not yet run, cannot be run locally:** a live Shopify webhook delivery test (requires a deployed, reachable endpoint and Shopify's own test-delivery tooling).

## 8. What this manifest is not

Not an approval to deploy. Nothing here has been pushed, merged, or applied to any database. This is a reference for whoever executes the release later.

---

# Addendum (2026-11-12): what has been integrated since §1-8 above

Sections 1-8 above describe the Phase 1+2 security/privacy release as it stood on 2026-10-20, branched from staging's then-live tip `ce41ee88`. Since then, **157 more commits** have landed on this lineage (now `integrate/security-fixes-local@c24fe62`, itself built on `integrate/staging-release-candidate@7c9f450`). This addendum covers what's been added, in the same shape as §1-8, without altering anything above. Prepared read-only, as part of Phase 1 ops work (`fix/ops-phase1-monitoring-reliability`) — no code in this addendum's scope (Clerk, Stripe, rate-limiting, Cloudinary stripping) was touched to write it; it is a description of already-integrated work owned by other workstreams.

## A1. What's been added

| Area | What | Owning workstream |
|---|---|---|
| Customer authentication | Clerk is now nAia's primary customer auth provider (`fac33e3`), with identity-linking for pre-existing Shopify-era customers, Clerk-user-deletion logging on account delete (`6814d77`), and Clerk-independent erasure scoping (`d7ab2eb`) | Clerk/auth workstream |
| Billing | Stripe test-mode Checkout, Billing Portal, and webhook handling — built across Phases 1-3 plus two post-review hardening passes (`dccd56a` through `e73c447`), including a Stripe API version pin (`ea1830a`) and idempotency-key correction (`89f4617`) | Stripe/billing workstream |
| Rate limiting | Phase 1 shadow-mode rate limiting, one route (`api.cloudinary-signature.jsx`) (`7bf698c`, `a2c9264`) | Security/rate-limiting workstream |
| Image privacy | EXIF/GPS metadata stripping on uploaded customer photos (`99a5a6f`, `5de615d`) | Cloudinary Privacy workstream |
| Reliability | DB `connection_limit` raised 1→2 to stop cold-start pool contention (`7c9f450`) | (this Phase 1 ops pass's performance findings build on this, unchanged by this pass) |
| Test infrastructure | Selfie-analysis-gate regression tests (`becdda4`, `9ec362b`), Clerk-era identity mock stabilization (`8a68c60`) | Security/QA workstream |

## A2. Migrations added since §2's table (all additive — verified, no `DROP COLUMN`/`DROP TABLE`/`DROP TYPE` in any of the 14 below)

`20261103000000_billing_subscription_phase1`, `20261103000002_vto_test_job_isolation`, `20261103000003_subscription_past_due_grace_period`, `20261103000004_sandbox_replay_schema_parity`, `20261103000005_styleme_outcome_updatedat_parity`, `20261104120000_clerk_identity_linking`, `20261105090000_customer_erasure_failures`, `20261110000000_api_rate_limit_counter` — plus two baseline-history migrations (`20240530213852`, `20240530213853`) that predate this lineage's own work and are unrelated to it.

## A3. New environment variables required (beyond §3's "none required" — that statement no longer holds)

- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_AUTHORIZED_PARTIES` — Clerk auth.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Stripe billing. Code hard-refuses any key not starting `sk_test_` (`assertTestModeKey`) — going live requires a deliberate, separate decision to lift that guard, not just dropping in a live key.
- Per the most recent independent audit on this lineage, `CLERK_PUBLISHABLE_KEY` was found shared across Preview AND Production (same key, both environments) — Stripe already has test/live separation enforced in code; Clerk does not have an equivalent code-level guard. Flagged here again as a live-dashboard item to resolve before any production cutover, not something this addendum resolves.

## A4. Known deploy-config blocker (carried forward from the corrected Nov 12 operations audit, not new to this addendum)

This worktree's own `vercel.json` → `scripts/require-preview-env.sh` is an intentional, dated (2026-10-20), one-off "deploy-candidate-only" guard: it unconditionally fails any build where `VERCEL_ENV` is not literally `"preview"`. **As currently committed, this branch cannot build as Production.** Before any real production cutover of this lineage, this file needs a deliberate replacement with a genuine production build path — this is a known, owned decision point, not something fixed by this addendum (out of this Phase 1 ops pass's scope, which does not touch deploy configuration — see its own stated exclusions).

## A5. Rollback considerations for the additions in A1

- **Clerk/Stripe code:** same as §6's existing guidance — a plain revert/redeploy is sufficient, since `ENTITLEMENT_ENFORCEMENT` and Stripe's own test-mode guard are the only feature-flag-shaped gates involved, and both fail closed (disabled/test-mode) by default.
- **Migrations (A2):** same reasoning as §6 — all additive, so a code rollback does not require a migration rollback.
- **Rate limiting / EXIF stripping:** both are additive, non-destructive changes (a new DB table for rate-limit counters; stripped metadata is simply absent going forward, not a destructive transform of existing data) — a code rollback here is a normal Vercel rollback with no special migration handling needed.
- **Not yet covered anywhere, including this addendum:** a full acceptance-test re-run and a go/no-go checklist for this larger, combined scope (§7's "45/45 + 41/41" figures are from the original, narrower Phase 1+2 release only) — flagged as a gap, not filled in here, since re-running the full combined suite and re-certifying it is a larger task than this documentation-only addendum.

