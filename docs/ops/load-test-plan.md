# Synthetic Load-Test Plan (10 / 25 / 50 / 100 concurrent users)

**Status: plan + harness prepared, not executed against any real app instance.** The harness (`scripts/load-test/run-load-test.mjs`) has been run only in `--self-test` mode, against its own bundled mock-provider server — see that script's header and `scripts/load-test/README.md`. Nothing in this document should be read as "load testing has been performed on nAia" — it has not.

## 1. Why staged 10/25/50/100, specifically

Matches the pre-launch requirement tracked in memory (`project_prelaunch_load_stress_testing`). The staging matters more than the final number: per the 2026-11-09 security/resilience audit, staging Postgres runs `max_connections=50` with each serverless instance's own Prisma client capped at `connection_limit=1` (`app/db.server.js`) — connection-pool exhaustion, not CPU or AI-provider latency, is the most likely first failure mode, and it can show up well before 100 concurrent users if enough instances cold-start at once. The 10-VU stage is a real gate, not a warm-up throwaway.

## 2. Journeys covered (`scripts/load-test/journeys.config.mjs`)

| Journey | Auth | Provider calls | Status |
|---|---|---|---|
| `health` | no | none | ready |
| `read-only-trend-reports` | no | none | ready |
| `clerk-sign-in-page-render` | no | none | ready (page render only — see §3) |
| `passport-read` | yes | none | ready, needs fixtures |
| `closet-browse` | yes | none | ready, needs fixtures |
| `styleme-generate` | yes | Claude (+FASHN on the real path) | needs `ALLOW_PROVIDER_MOCKS=true` + fixtures |
| `buy-or-skip-browse` | yes | none | ready, needs fixtures |
| `billing-plan-usage-read` | yes | none | ready, needs fixtures |
| `settings-privacy-read` | yes | none | ready, needs fixtures |

Not covered yet, and why:
- **Billing/checkout write path (Stripe)** — `app/lib/stripe-client.server.ts` does not exist on this branch at all (confirmed by repo-wide search); there is nothing to load-test here until the Stripe/Clerk billing workstream lands on this lineage. Add a `billing-checkout` journey once it does, gated the same way `styleme-generate` is (Stripe already hard-locks to `sk_test_` keys per prior audits, so it would need a Stripe-test-mode-aware fixture, not a mock server).
- **Cloudinary-backed uploads (Closet add, BuyOrSkip analyze)** — `app/lib/cloudinary-admin.server.ts` has no mock-base-URL override point today (5+ inline hardcoded URLs, no single `BASE_URL` constant like FASHN/Claude have — see §5 of `vercel-limits-and-db-budget-review.md`). Until that's added, these journeys would make real Cloudinary calls if included, so they are deliberately left out of `journeys.config.mjs` rather than included and accidentally run.
- **FASHN VTO trigger** — same shape as StyleMe; add once a `styleme-generate`-style mock-gated journey is validated end-to-end once.
- **Real Clerk sign-in completion** — see `fixtures/README.md` §2. Out of scope for a self-hosted harness.

## 3. Mocking paid providers (item 4 of the brief)

- **FASHN and Claude**: `ALLOW_PROVIDER_MOCKS=true` + `FASHN_MOCK_BASE_URL`/`CLAUDE_MOCK_BASE_URL` redirect `app/lib/ai/fashn-try-on.server.ts` and `app/lib/ai/claude.server.ts` to `scripts/load-test/mock-providers-server.mjs` instead of the real providers. Both app-side variables require the literal string `"true"` for the opt-in flag and are independently verified fail-safe by 8 tests in `app/lib/ai/provider-mock-override.test.ts` (unset by default everywhere in this repo's own config, so no existing deployment's behavior changes). The harness itself carries a second, independent `ALLOW_PROVIDER_MOCKS` check before running any journey marked `requiresProviderMock: true`, so a misconfigured run fails closed rather than silently calling a real provider.
- **Cloudinary**: not wired — see §2 above and the follow-up noted in the Vercel/DB review doc.
- **Stripe**: no code to mock on this branch.

## 4. Known measurement gap: quota/entitlement state, not just the harness

`app/lib/plan/entitlement.server.ts` enforces monthly quotas per customer (e.g. StyleMe generations/month). A tight concurrent loop hitting `styleme-generate` with ONE fixture customer mostly measures "how fast does the quota-exceeded branch respond," not generation latency under load. This needs a wide-enough pool of fixture customers (one quota window each) for a representative run — a fixtures-data problem, not a harness bug. Size the fixture pool to `≥ concurrency × iterations-per-VU` for any provider-calling journey, or accept that most of a sustained run will be measuring the quota-rejection path specifically (which is itself worth knowing the latency of, just label it correctly in the report).

## 5. Acceptance criteria

Recorded per stage (10/25/50/100) from the harness's own JSON report (`statusCounts`, `latencyMs.p50/p95/p99`, `errorRate`, `throughputRps`) plus manual checks against the target environment during the run. A stage **fails** if any hard-stop criterion is breached; failing the 10-VU stage is a blocker for proceeding to 25, not just a note.

### Hard-stop (any one breach blocks launch sign-off)
- **Error rate** > 1% of requests return a 5xx or a harness-recorded network error, at the 10-VU stage specifically (the stage closest to expected real launch traffic). A higher threshold is tolerated at 50/100 only if explicitly accepted as "beyond expected launch-day load."
- **DB connection-pool exhaustion**: any `P2024`/"Timed out fetching a new connection from the connection pool" error observed in app logs during the run, at any stage. Given `connection_limit=1` per instance and a 50-connection ceiling, this is the single most important signal this whole plan exists to surface — see §1.
- **Customer isolation failure**: any response during the run returns data belonging to a different fixture customer than the one whose cookie was sent. (Requires a manual spot-check pass over a sample of responses — the harness does not assert on response bodies today, only status codes and latency; see §7.)
- **Entitlement bypass**: a fixture customer observed generating past their configured quota ceiling during the run (cross-check `Subscription`/quota-tracking rows after the run, not just HTTP status).
- **Process crash / OOM**: any instance restart or memory-limit kill visible in Vercel's function logs during the run.

### Soft (recorded, reviewed, not individually blocking)
- Latency: p95 < 2s and p99 < 5s for every non-provider-calling journey at the 50-VU stage; provider-calling journeys (mocked) are expected to track the mock's own configured `LATENCY_MS` plus a small margin — a result wildly above that margin (e.g. 5×) indicates app-side overhead worth investigating even though the provider itself is fake.
- Recovery: after a stage ends, the next stage's first-10-seconds p50 should not be elevated relative to that stage's own steady-state p50 — a sustained elevation suggests the prior stage's load left something (a connection, a lock, a queued job) un-recovered.
- Throughput scaling: `throughputRps` should increase, not plateau or fall, from the 10-VU to 25-VU stage at minimum — a plateau that early suggests a bottleneck below even the lightest expected load, worth a root-cause pass before continuing up the ramp.

## 6. What this plan explicitly does not claim

No real data exists yet for any of §5's criteria — this is the measurement plan and the tool, not the measurement. Running it (even in self-test mode against a local dev server with mocked providers, let alone against any shared environment) requires the fixtures described in `fixtures/README.md`, which this pass deliberately did not create (no DB to seed into was in scope for this read-only-infra-adjacent preparation task).

## 7. Gaps in the harness itself, for whoever runs this next

- No response-body assertions (only status code + latency) — the customer-isolation hard-stop criterion in §5 currently requires a manual pass, not an automated one. A follow-up could add a lightweight body-content check per journey (e.g. "the Closet page response contains this fixture's own customerId marker, never another fixture's").
- No warm-up period before measurement starts within a stage — the first few requests of each stage include any cold-start cost, which will skew p99 slightly high. Acceptable for this plan's purposes (cold start IS a real launch-day phenomenon) but worth knowing if comparing results across runs.
- Single-process harness — at very high concurrency (well beyond 100 VUs) Node's own event loop could itself become the bottleneck before the target app does. Not a concern at the 100-VU ceiling this plan targets.
