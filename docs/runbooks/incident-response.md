# Incident Response Runbook

**Status: documentation only.** No incident has been declared or rehearsed using this document. It names what already exists in this codebase (🟢) versus what still needs a live decision or a tool this repo doesn't have (⚪). See [`backup-restore-dr.md`](backup-restore-dr.md) for the database-specific restore procedure this document cross-references rather than duplicates.

## 1. What already exists to detect and diagnose an incident (🟢)

- **Liveness**: `GET /api/health` (`app/routes/api.health.tsx`) — proves the process is up. It deliberately does not check the database or any provider (see that file's own header comment), so a 200 from it does NOT mean the app is actually serving customers correctly. Treat a failing health check as "the process is down," and everything else below as how you find out the process is up but broken.
- **Structured error capture**: `app/lib/error-tracking.server.ts`'s `captureError`/`captureFailure`, wired into SSR render errors (`entry.server.jsx`), FASHN failures (`fashn-try-on.server.ts`), and Claude failures (`claude.server.ts`). Today this only reaches stdout/stderr — i.e. **Vercel's own function logs are the only place these events currently land.** There is no external alerting; see `error-tracking-provider-setup.md` for what adding one would require.
- **Audit trail**: `AdminAuditLog` (admin actions) and `JourneyEvent`/`PendingCustomerErasureFailure` (customer-facing operational events + GDPR-erasure retry tracking) already exist in the schema and are written to in normal operation — useful for reconstructing a timeline during an incident, not just for the features they were originally built for.
- **Entitlement/quota state**: `Subscription`, `BillingTransaction`, and the per-feature quota-tracking fields in `entitlement.server.ts` give a factual record of what a customer was and wasn't entitled to at a point in time — relevant if an incident involves a billing/entitlement bug, not just an outage.

## 2. What does NOT exist yet (⚪)

- **No alerting.** Nobody gets paged. The only way to learn about an incident today is: a customer reports it, someone is actively watching Vercel's dashboard/logs, or a future external monitor (see the separate `naia-ops-monitoring` repo workstream, tracked in memory as not yet activated) catches it.
- **No on-call rotation or escalation path documented anywhere.** This document cannot invent one — that's an organizational decision, not a code change.
- **No status page or customer-communication template.** If customers need to be told something is degraded, that copy and channel do not exist yet.
- **No automated rollback trigger.** Rolling back is a manual decision + manual command — see `deployment-rollback.md`.

## 3. Incident response procedure (what to actually do, once declared)

1. **Confirm it's real, not a false alarm.** Check `GET /api/health` first (proves the process is up at all), then check Vercel's function logs for `[error-capture]` lines matching the reported symptom's timeframe.
2. **Classify the blast radius** before doing anything irreversible:
   - Single customer? → Check `AdminAuditLog`/`JourneyEvent` for that customer's recent activity; this is very unlikely to need a rollback or restore.
   - One feature (e.g. StyleMe generations failing)? → Check whether it's a provider-side outage (FASHN/Claude/Cloudinary status, if they publish one) vs. an app-side regression from a recent deploy. `captureFailure`'s `context` tag (`fashn:submit`, `fashn:poll`, `claude:text`, `claude:vision`) tells you which provider path, if any, is involved.
   - Everything down / 5xx-ing broadly? → Check whether it correlates with a recent deploy (see `deployment-rollback.md` — rolling back the deployment is usually faster than root-causing live) or a DB-level issue (`P2024`/connection-pool-timeout errors in logs — see `vercel-limits-and-db-budget-review.md` §4 for why this is a plausible first failure mode under load).
3. **Stop the bleeding before investigating root cause**, if data integrity is at risk (a bad write loop, a migration applied to the wrong environment). Pausing further writes (scaling the affected deployment down, or Vercel's own deployment protection) buys time without destroying evidence. Never delete/restore anything as a first response — see `backup-restore-dr.md` §3 for why restoring in place is explicitly the wrong move.
4. **Mitigate**: roll back the deployment (`deployment-rollback.md`) if the incident correlates with a recent deploy; otherwise mitigate at the feature level if possible (e.g. a provider outage might only need customers told to retry later — there is no feature-flag kill-switch infrastructure in this codebase today beyond the per-feature `ENTITLEMENT_ENFORCEMENT`-style env flags, which are not designed as incident kill-switches and shouldn't be repurposed as one without thinking through the fail-open/fail-closed consequences documented in `entitlement.server.ts`'s own comments).
5. **Communicate** — internally at minimum (there is no customer-facing status mechanism to use yet, per §2).
6. **Resolve and confirm**: re-check `GET /api/health`, spot-check the previously-failing feature manually, check error-capture logs for the incident's signature having stopped.
7. **Write it up** — even briefly. There is no incident-log location in this repo today; until one exists, a dated entry in whatever this team's standard documentation tool is (not necessarily this git repo) is better than nothing. Note what was learned, especially anything that should become a new `captureFailure` call site, a new hard-stop criterion in `load-test-plan.md`, or a new alerting rule once a provider exists.

## 4. Explicitly deferred, not forgotten

- Wiring a real error-tracking provider (Sentry or similar) — `error-tracking-provider-setup.md` lists exactly what that needs and why it hasn't been done.
- Any paging/on-call tooling.
- A customer-facing status page.
- A kill-switch mechanism purpose-built for incident mitigation (distinct from the existing entitlement-enforcement flags, which serve a different purpose).
