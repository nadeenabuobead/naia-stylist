# Backup, Restore & Disaster Recovery Runbook

**Status: documentation only — no infrastructure change, nothing enabled or verified by this document itself.** Prepared as part of Phase 1 ops work on `fix/ops-phase1-monitoring-reliability` (based on `integrate/security-fixes-local@c24fe62`). This document distinguishes two kinds of statements:

- 🟢 **Documented procedure** — something this document itself establishes (a step, a command, a decision rule), verifiable by reading this repo.
- ⚪ **Needs dashboard verification** — a live Vercel/Prisma Postgres setting this document cannot confirm from code. Each one below names exactly what to check and where.

Nothing in this document should be read as "backups are configured" until every ⚪ item has been checked off by someone with Vercel Storage dashboard access.

---

## 1. What this repo's own code already guarantees (🟢)

- **Migrations are forward-only and reviewable before they run.** `vercel.json` → `scripts/require-preview-env.sh` → `scripts/build-preview.sh` gate every Preview build's `prisma migrate deploy` behind an explicit `NAIA_ALLOW_PREVIEW_MIGRATIONS=true` environment variable — the default is to skip it. This means a bad migration cannot reach a database as a side effect of merely pushing a branch; someone has to deliberately flip that variable for that one deployment. (See `scripts/build-preview.sh:16-32`.)
- **Recent migration history is additive, not destructive.** The 14 most recent migrations (Clerk identity-linking, Stripe billing schema, customer-erasure-failure tracking, rate-limit counter, admin audit log, age-confirmation/photo-consent fields, etc.) add tables/columns only — none contain `DROP COLUMN`, `DROP TABLE`, or `DROP TYPE` (verified by grep against each migration's `.sql` file). A code rollback after one of these ships does **not** require a matching migration rollback — old code simply ignores new columns/tables it doesn't know about.
- **Two older migrations are genuinely destructive** (pre-existing, not part of this Phase 1 work): `20260810_v2e_lifestyle_array` (`DROP COLUMN "lifestyle"`) and `20260907000000_membership_status` (`DROP COLUMN "plan"` + `DROP TYPE "CustomerPlan"`). Both are old and already applied wherever this lineage has been deployed — flagged here only so a future restore-from-an-older-snapshot scenario doesn't assume every migration in history is reversible by just not running it.
- **Test/staging data cannot leak into a production restore through this repo's own gating.** `NAIA_PROJECT_VARIANT !== "staging"` and `STAGING_SEED_SECRET` gate every staging-only seeding/diagnostic route (`api.seed-staging.jsx` and similar) — these are environment-variable checks, not data baked into migrations or fixtures, so a database restore itself carries no staging-only seed data risk from code.

## 2. What needs live verification (⚪ — not checked by this document)

These require whoever has access to the Vercel dashboard (Storage tab) and/or the Prisma Postgres console for each of the two database instances currently in use (`naia-stylist` production's store, and `naia-stylist-staging`'s store — see [[project_db_isolation_stages_abcd_complete]] for the store IDs on record as of the last audit, re-confirm they're still current):

1. **Is automated backup enabled at all?** Vercel/Prisma Postgres → the project's Storage tab → the connected database → Backups. Record: enabled/disabled, and the retention window (how many days of backups are kept).
2. **Is point-in-time recovery (PITR) available on the current plan tier?** PITR lets you restore to any point within the retention window, not just a daily snapshot — confirm whether the plan tier supports it and whether it's turned on.
3. **What is the actual RPO (recovery point objective)?** i.e., how much data could be lost between the last backup/WAL checkpoint and a failure — depends directly on #1/#2's answers, not something this document can state without them.
4. **Has a restore ever actually been tested?** A backup that has never been restored is unverified, not proven. If no test restore has ever been performed, that is itself the single most important finding in this document — see §4.
5. **Who has the access/permissions to trigger a restore**, and is that documented anywhere outside this file (e.g. a password manager entry, a second person's access)? A DR plan with one person able to execute it is a single point of failure.

## 3. Restore procedure (🟢 documented here for the first time; ⚪ never executed)

This is the procedure to follow once a restore is actually needed. It has **not** been executed or rehearsed — see §4 for why that matters.

1. **Stop the bleeding first.** If the incident is an in-progress bad write (e.g. a runaway script, a bad migration applied to the wrong environment), pause further writes before restoring — e.g. via Vercel's deployment protection or by scaling the affected deployment down — so a restore target doesn't immediately get overwritten again.
2. **Identify the restore target point.** Use the Vercel/Prisma Postgres dashboard's backup or PITR UI to pick either a specific daily snapshot or a precise timestamp (PITR only). Cross-check against `AdminAuditLog` and `JourneyEvent` records (both already exist in this schema) to help pinpoint when the bad state began, if the incident is data corruption rather than infrastructure failure.
3. **Restore to a NEW database instance, never in-place over the live one**, if the tooling supports it (most managed Postgres restore flows do this by default — confirm in the dashboard UI before confirming the restore). This preserves the ability to compare old vs. restored data and to roll back the decision to restore at all.
4. **Point a single, deliberately chosen environment at the restored instance first** — e.g. a disposable Preview deployment, not Production directly — and run the application's own smoke checks (the `/api/health` endpoint added in this same Phase 1 pass confirms the process boots; it does not confirm data correctness, so also spot-check a handful of real records against what's expected).
5. **Only after that check passes**, repoint the real environment's `NAIA_DATABASE_URL`/`DATABASE_URL` at the restored instance and redeploy.
6. **Do not delete the original (incident) database instance** until the restored one has been live and verified for a reasonable soak period — it is itself forensic evidence for the incident writeup.

## 4. The single biggest gap this document surfaces

**No restore has ever been tested, as far as this repo's history shows** (no restore-test script, log, or writeup exists anywhere in the codebase or its commit history). A backup that has never been restored is an assumption, not a verified capability. Recommended next step, once ⚪ items 1-2 above are confirmed: schedule one deliberate test restore into a disposable project (the codebase already has a working pattern for this — a disposable Vercel project + a fresh Prisma Postgres instance, documented in [[project_security_privacy_remediation_2026_10]]'s canary-bootstrap work, though that effort was paused before completion and is a separate, already-known-to-the-user thread, not something this document extends or restarts).

## 5. What this document deliberately does not cover

- Cloudinary asset backup/retention — owned by the Cloudinary Privacy workstream; out of scope here.
- Stripe/billing data durability — Stripe is itself the system of record for payment data; `BillingTransaction`/`Subscription` in this app's own Postgres are a local cache/ledger, not the only copy. Coordinate with the Stripe/Clerk workstream if a restore scenario ever needs to reconcile local records against Stripe's own data.
- Clerk user/session data — Clerk is itself the system of record for authentication identity; a Postgres restore does not restore or affect Clerk's own user records (`clerkUserId` in this schema is a foreign reference, not a copy of Clerk's data).

---

## Addendum (Phase 2, re-verified against `integrate/staging-rc-unified-prep@f7fb57c339ea2edb6b446daa88592092b26cdfa2`)

Everything in §1-5 above was re-checked against this specific commit, not assumed carried-over. No restore was run, no migration was applied — read-only re-verification only.

**§1's migration-safety claim still holds, with one precision added.** All migrations on this branch remain additive-only except the same two pre-existing destructive ones already named in §1 — re-confirmed by grepping every `migration.sql` file for `DROP (COLUMN|TABLE|TYPE)`. One migration, `20261103000004_sandbox_replay_schema_parity`, contains `DROP INDEX` and several `ALTER COLUMN ... DROP DEFAULT/DROP NOT NULL` statements — these loosen constraints/indexes but destroy no data, so they don't contradict §1's specific claim; noted here for precision since a narrower "no DROP X" grep could miss them.

**§1's build-gating claim still holds, byte-for-byte.** `vercel.json` on this branch is still `sh scripts/require-preview-env.sh && sh scripts/build-preview.sh`; `require-preview-env.sh` still hard-fails (exit 1) unless `VERCEL_ENV=="preview"`; `build-preview.sh` still only runs `prisma migrate deploy` when `NAIA_ALLOW_PREVIEW_MIGRATIONS=="true"`. This is the same guard flagged as a Production-build blocker in the Task 8 audit — see `docs/runbooks/production-build-path-design.md` (this phase) for how to handle it going forward. Not changed here.

**Staging/production DB boundary — re-verified, one new note.** `prisma/schema.prisma`'s datasource still resolves `url` from `NAIA_DATABASE_URL` and `directUrl` from `DATABASE_URL`. `app/db.server.js` reads `NAIA_DATABASE_URL` explicitly with `connection_limit=2`. A **second**, independent `PrismaClient` singleton exists at `app/lib/prisma.server.ts` (bare `new PrismaClient()`, no `connection_limit` override) — it still resolves to the same `NAIA_DATABASE_URL` via schema defaults, so it is **not** a staging/prod boundary risk, just a duplicated pool actively used by 7 route files. Flagged for hygiene, not DR. All `NAIA_PROJECT_VARIANT`-gated staging routes re-confirmed still correctly 404 outside staging.

**New finding, not previously covered in §1-5: post-restore privacy-erasure reconciliation.** If a database restore brings the DB back to a point *before* a customer's erasure request completed, nothing in this codebase detects or re-applies that erasure — the customer's PII simply reappears (or, for a billed customer, reverts to un-anonymized) with no code-level signal that anything is wrong. This is real and unaddressed as of this commit. A full design for closing this gap is in `docs/runbooks/post-restore-erasure-reconciliation-design.md` (this phase) — design only, no schema or implementation change made.

**§4's "no restore ever tested" finding — unchanged, re-confirmed.** `grep -rliE "restore-test|disaster-recovery-test|dr-test"` across the whole tree and `git log --all --grep` for restore/DR-test commits both still return nothing on this commit.

**Separately noted, not a DR item:** the `canary/preview-db-direct-connection` branch (an earlier, paused attempt at isolating a canary Preview database) is still not an ancestor of this branch's HEAD and has not progressed since it was paused — three-plus weeks stale relative to `f7fb57c`.
