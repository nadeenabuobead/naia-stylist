# Launch GO/NO-GO — Operational Readiness Checklist

**Scope: operational controls and test infrastructure only** (monitoring, health checks, logging, rate limits, runbooks, load testing, backup/recovery, Vercel/DB budgeting). This is not the master launch checklist (a separate, externally-maintained document — see `project_launch_checklist_nov14_reconciliation` memory) and does not cover VTO correctness (Final Integration), StyleMe security (Security Engineering), or Closet DB reliability (the parallel engineering workstream) — those are each a separate GO/NO-GO of their own. Status reflects branch `fix/ops-release-readiness-20261116`, off `feat/quick-style-guest-teaser-20261116` @ `50c6828`, not merged anywhere.

Legend: ✅ done & verified this pass · 🟡 prepared, needs a decision/action named explicitly · 🔴 real gap, no mitigation in place · ⚪ already correctly out of scope

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Liveness health check (`GET /api/health`) | ✅ | `app/routes/api.health.tsx` — 6 tests pass. Ported forward from a prior unmerged session rather than rebuilt. |
| 2 | Structured error capture for provider failures | ✅ | `app/lib/error-tracking.server.ts`; wired into FASHN (`fashn-try-on.server.ts`) and Claude (`claude.server.ts`) failure paths + SSR errors (`entry.server.jsx`). 11+ tests. Still console-only — see #3. |
| 3 | External alerting / error-tracking provider | 🔴 | Nothing leaves the process (`docs/runbooks/error-tracking-provider-setup.md` lists exactly what adding one needs). **Approval needed: pick a provider + plan tier before any account is created.** |
| 4 | Request timeouts on provider calls | ✅ | FASHN (15s/call) and Claude (30s/call) both bounded via `AbortSignal`. 893+11+ tests confirm no behavior change on the happy path. |
| 5 | API rate limiting | 🟡 | A LOCALLY COMPLETE, isolated implementation already exists (`fix/api-rate-limit-phase1`, shadow mode, wired to the Cloudinary-signing endpoint only) — not merged, not re-verified this pass, not touched here (would collide with the parallel security workstream's likely territory). **Decision needed: who merges/extends this, and when, relative to launch.** Every other route remains unrate-limited today. |
| 6 | Paid-provider mock/sandbox gate for load testing | ✅ (FASHN, Claude) / 🔴 (Cloudinary, Stripe) | `ALLOW_PROVIDER_MOCKS` + per-provider mock-URL env vars, fail-safe by construction (8 tests spawning fresh processes per case). Cloudinary has no override point (5+ inline URLs, no shared constant — `vercel-limits-and-db-budget-review.md` §5). Stripe has no code on this branch at all. |
| 7 | Synthetic load-test harness (10/25/50/100 VUs) | ✅ harness / 🔴 never run against a real target | `scripts/load-test/run-load-test.mjs`, self-tested against its own bundled mock server (proves concurrency/metrics/reporting work). Hard-refuses non-localhost targets by construction. **Needs: a fixtures file (none shipped, see `fixtures/README.md`) and an explicit decision on which environment to point it at — never the shared staging/production projects without separate approval.** |
| 8 | Load-test acceptance criteria defined | ✅ | `docs/ops/load-test-plan.md` §5 — hard-stop (error rate, pool exhaustion, isolation failure, entitlement bypass, crash/OOM) vs. soft (latency percentiles, recovery, throughput scaling). **No real measurement exists yet against these criteria.** |
| 9 | DB connection-pool budget understood | 🟡 | `max_connections=50` / `connection_limit=1` per instance documented with the math in `vercel-limits-and-db-budget-review.md` §4 — but two inconsistent Prisma Client modules exist (`db.server.js` vs `prisma.server.ts`), and the actual pool-exhaustion threshold is a hypothesis the 10-VU load-test stage exists to test, not yet confirmed. |
| 10 | Preview-build migration safety gate | 🔴 | **This branch's `scripts/build-preview.sh` runs `prisma migrate deploy` on every non-Production build, with no opt-in flag at all** — a materially different (riskier) posture than a sibling lineage's gated version. `vercel-limits-and-db-budget-review.md` §2. **Approval needed before relying on this lineage for any Preview deploy with a pending migration** — this is a shared-config fix, not done here. |
| 11 | Vercel function duration/memory config | 🔴 | No `functions` block in `vercel.json` at all; a route comment (`api.staging-full-look-vto.tsx:21-22`) assumes one exists and it does not. Relies entirely on whatever the account's current plan-tier default happens to be. `vercel-limits-and-db-budget-review.md` §1. |
| 12 | Data export size/streaming safety | 🔴 | The one export route found (`admin.naia.customers.$customerId.closet-export.tsx`) is unstreamed, uncapped JSON, not a ZIP — risks the platform's 4.5MB non-streamed-response ceiling for a large-Closet customer. Never sampled against real data (would need real customer access). `vercel-limits-and-db-budget-review.md` §6. |
| 13 | Cloudinary upload retry logic | 🔴 | Zero retry on any failure path (`cloudinary-admin.server.ts`) — single catch-and-fail everywhere. Not fixed here (sensitive file, likely concurrent security-workstream territory). |
| 14 | Backup / point-in-time-recovery verified | 🔴 | 3 Prisma Postgres snapshots exist per a prior session's dashboard check — **a restore has never actually been tested**, confirmed by this pass to still be true (no restore-test artifact anywhere in history). `docs/runbooks/backup-restore-dr.md` §4. **This is the single largest unresolved operational risk in this whole checklist.** |
| 15 | Documented restore procedure | ✅ (procedure) / 🔴 (never executed) | `docs/runbooks/backup-restore-dr.md` §3 — written this pass's predecessor, carried forward, not re-executed. |
| 16 | Documented deployment rollback procedure | ✅ (procedure) / 🔴 (never rehearsed as a drill) | `docs/runbooks/deployment-rollback.md` — Vercel-alias mechanism, with this repo's known sharp edges (alias reclaiming by concurrent sessions, the inverted `commandForIgnoringBuildStep` condition) called out explicitly. |
| 17 | Incident response procedure | ✅ (procedure) / 🔴 (no alerting, no on-call, no status page) | `docs/runbooks/incident-response.md` — honest about what doesn't exist (§2) rather than assuming it does. |
| 18 | Entitlement/quota enforcement | 🔴 (by design, documented) | Fail-open outside Closet (`ENTITLEMENT_ENFORCEMENT` gate off by default) — `entitlement.server.ts`'s own comments say this is pending a transaction-safety fix (StyleMe/BuyOrSkip/Trend-Edit quota checks are read-before-write, non-atomic), not an oversight. Unchanged by this pass; flagged here because the load-test plan's hard-stop criteria depend on knowing this is still true. |
| 19 | Test-suite reliability | ✅ | **Root-caused and fixed a genuine infinite busy-loop** in `app/routes/onboarding/complete.test.ts` (a dead `while` loop with a non-advancing condition) that has hung every full-suite run across multiple prior sessions' memory going back weeks. Verified: 43/43 tests in that file now pass in ~227ms, zero behavior change to any assertion. The `npm run test` script's `&&`-chaining issue (a different, already-known problem) remains unfixed here — a prior session's fix for that exists unmerged on `fix/npm-test-chaining-continue-on-error`. |
| 20 | Operational docs discoverable | ✅ | `docs/runbooks/` and `docs/ops/` now exist on this lineage (did not exist on this branch before this pass — confirmed by the initial audit). |

## What would need to be true for an operational GO (not a full-launch GO)

1. Items 3, 10, 11 resolved or explicitly risk-accepted with a named owner and date (none require new infrastructure, per `vercel-limits-and-db-budget-review.md`).
2. Item 14 — at minimum, one test restore executed into a disposable project before launch, not after the first real incident.
3. Item 7's load test actually run (even just the 10-VU stage, against a local or disposable environment with mocked providers) with a real result against item 8's hard-stop criteria — not just the harness existing.
4. Item 5 (rate limiting) and item 18 (entitlement fail-open) — an explicit decision, even if that decision is "ship fail-open/unrate-limited for this specific launch, revisit after," rather than silence.
5. Items 6/13 (Cloudinary mock + retry) — a decision on whether Closet/BuyOrSkip upload journeys matter enough for this launch's load test to justify the follow-up work, or get explicitly deferred.

## Approvals required before any further action on this workstream

- Creating an error-tracking provider account (item 3) — provider/plan choice.
- Adding a migration opt-in gate to `scripts/build-preview.sh`/`vercel.json` (item 10) — shared-config change.
- Adding a `functions` block to `vercel.json` (item 11) — shared-config change.
- Running the load-test harness against anything other than localhost (item 7) — explicit, per-run approval naming the exact host, never the shared staging/production projects.
- Provisioning any disposable fixtures DB/project for load-test fixtures (`fixtures/README.md`) — new-infra decision.
- Scheduling and executing a real backup-restore test (item 14) — needs Vercel/Prisma dashboard access and a disposable target.
- Merging/extending the existing isolated rate-limiting work (item 5) — coordinate with whoever owns that branch and the parallel security workstream.
- Merging anything in this branch (`fix/ops-release-readiness-20261116`) anywhere — not requested or done in this pass.

## Explicitly not duplicated

The parallel Closet-database-reliability workstream (branches `fix/closet-db-pool-resilience` / `fix/prisma-transient-retry-extension`, both at commit `707b613`) was identified during this pass and deliberately left untouched — its findings on connection-pool behavior should be reconciled with item 9 above before either workstream's conclusions are treated as final.
