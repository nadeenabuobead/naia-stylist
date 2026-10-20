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
