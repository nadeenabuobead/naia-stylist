# Deployment Rollback Runbook

**Status: documentation only — the specific commands below have not been executed by this pass.** They are the same mechanism already used successfully in prior sessions (see the "Rollback" note in `project_security_privacy_remediation_2026_10` memory, where `vercel alias set <previous-deployment-id> <domain>` was the documented, instant rollback path for an auth-fix deployment). This document generalizes that into a standing procedure rather than inventing a new one.

## 1. The mechanism: Vercel aliasing, not redeploying old code

Vercel does not delete old deployments when a new one goes out — each deployment keeps its own immutable URL/ID indefinitely (until explicitly deleted). A domain/alias (e.g. `naia-stylist-staging.vercel.app`) is just a pointer that can be repointed to any existing deployment instantly, with no rebuild. **Rollback = repoint the alias, not "redeploy the old commit."** This is faster and safer than a revert-commit-and-redeploy cycle because it carries zero build risk — the target deployment already built successfully once.

```
vercel alias set <previous-deployment-id-or-url> <domain>
```

## 2. Before rolling back

1. **Identify the last-known-good deployment.** `vercel ls <project>` lists recent deployments with their IDs/URLs and creation times. Cross-check against the incident timeline (`incident-response.md` §3) to find the most recent deployment that predates the symptom's onset.
2. **Check whether a migration shipped between the last-known-good deployment and the current one.** If the current (bad) deployment's build ran `prisma migrate deploy` against a database also used by the target rollback deployment, rolling back the *code* does not roll back the *schema* — old code may now be running against a newer schema than it expects. Check `prisma/migrations/` for any migration dated between the two deployments' build times. If one exists and it's additive-only (per the migration-safety discipline described in `backup-restore-dr.md` §1), old code ignoring new columns/tables is usually safe. If it's one of the rarer destructive migrations (also catalogued in that document), **a code-only rollback is not safe** — this needs a database-level decision (restore, per `backup-restore-dr.md`), not just an alias flip.
3. **Confirm which Vercel project/alias is actually affected.** This repo has at least two distinct Vercel projects in play historically (`naia-stylist` production, `naia-stylist-staging`) — make sure the rollback targets the right one. Never touch the other project's alias as a side effect.

## 3. Rollback steps

1. `vercel ls <project-name>` — find the last-known-good deployment ID.
2. `vercel alias set <that-deployment-id> <the-affected-domain>` — instant, no rebuild.
3. Confirm via `vercel alias ls` that the domain now resolves to the intended deployment, and via a direct request (e.g. `GET /api/health`, then a manual spot-check of the specific feature that was broken) that the rollback actually resolved the symptom.
4. **Do not delete the bad deployment.** Keep it as forensic evidence for the incident writeup (same principle as "don't delete the incident database" in `backup-restore-dr.md` §3).
5. Update whatever incident log/writeup location this team uses with the deployment IDs on both sides of the rollback and the exact alias command run.

## 4. Known sharp edges in this repo specifically, found in prior sessions

- **Aliases get reclaimed by other concurrent work.** Per `feedback_lane_boundaries_staging`: this repo has many parallel sessions/branches sharing the same Vercel projects; a verified alias is not a durable fact — another deploy can repoint it minutes later. Confirm the alias is still pointed where expected immediately before declaring the rollback complete, and again before telling anyone the incident is resolved.
- **`commandForIgnoringBuildStep` can silently invert expectations.** A prior session found a build-skip condition on `naia-stylist-staging` where `exit 0` (intuitively "this branch is fine, proceed") actually means "skip the build" in Vercel's convention — the opposite of what it reads as. If a rollback-adjacent deploy seems to silently not happen, check this setting before assuming the alias command itself failed. Bypass with `vercel deploy --prod --force` rather than editing that setting, per that same memory's guidance.
- **Preview builds on this lineage run `prisma migrate deploy` unconditionally** (see `vercel-limits-and-db-budget-review.md` §2) — so even a Preview-target rollback deployment's *redeploy* (not just an alias flip) would re-run migrations against whatever DB it resolves to. An alias flip to an *already-built* deployment does not trigger a new build, so this specific risk does not apply to the alias-only rollback path described above — but it does apply if "rollback" instead means "redeploy the old commit as a fresh build," which is why this document recommends the alias mechanism specifically, not a redeploy.

## 5. What this document does not cover

- Rolling back a database schema change by itself (no code involved) — that's `backup-restore-dr.md`'s restore procedure, not this one.
- Rolling back a third-party configuration change (a Clerk Dashboard setting, a Stripe webhook registration) — those have their own undo mechanisms in each provider's own dashboard, not covered here.
