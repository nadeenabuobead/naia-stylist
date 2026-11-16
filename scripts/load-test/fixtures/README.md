# Load-test fixtures

`run-load-test.mjs` reads a `FIXTURES_FILE` — a JSON array of `{ "cookie": "<Cookie header value>" }` objects — and round-robins through them for any journey marked `requiresAuth: true` in `journeys.config.mjs`. **No such file exists in this repo.** This document is the prerequisite checklist for creating one safely. Nothing below has been executed.

## 1. What a fixture customer needs to be

A disposable customer record that:
- Exists only in a database nobody else depends on (never the shared `naia-stylist-staging` DB, never production — see [[feedback_lane_boundaries_staging]] and the DB-isolation findings in [[project_db_isolation_stages_abcd_complete]]).
- Has a real, valid session cookie the app will accept — i.e. a real `NaiaSession` row (legacy path) or a real Clerk session (current path), not a forged value.
- Is trivially identifiable and deletable as a test fixture — follow the existing convention from `api.seed-staging.jsx`: an identifier prefixed `test-loadtest-`, never a real Shopify/Clerk ID.

## 2. Why Clerk sign-in itself is out of scope for this harness

The `clerk-sign-in-page-render` journey in `journeys.config.mjs` only renders `/sign-in` — it deliberately does not complete a real Clerk authentication handshake per virtual user. Clerk's sign-in flow is hosted/interactive (email/OTP or password against Clerk's own servers); scripting 100 concurrent fake sign-ins against it would mean either (a) real calls to Clerk's API at volume — a third-party cost/ToS/rate-limit concern outside this repo's control, not something to do without Clerk's own guidance on load-testing their service, or (b) fabricating session cookies without ever going through Clerk — which would test nothing real about the sign-in path's own latency/failure behavior. Neither is attempted here. If Clerk-sign-in-specific load data is ever needed, get it from Clerk's own status/latency dashboards and docs on testing against their platform, not from this harness.

## 3. How to build fixtures safely, once approved

1. Reuse the existing staging-seed pattern (`app/routes/api.seed-staging.jsx`), which already hard-gates on `NAIA_PROJECT_VARIANT === "staging"` and `STAGING_SEED_SECRET` — **pointed at a disposable local or isolated DB only**, never the shared staging DB, per the explicit instruction that load tests must stay offline-capable and never touch a shared environment without separate approval.
2. For a purely local run (recommended first step): seed fixture customers directly into a local Postgres instance via `prisma db seed` / a small one-off script, create their sessions the same way the app's own test helpers do (see `app/lib/naia-session.server.ts`'s session-creation path), and write out `{ "cookie": "NaiaSession=<value>" }` (or the Clerk-equivalent cookie name) per fixture into this directory as `local-dev-sessions.json` — **gitignored**, never committed (see the repo-root `.gitignore` entry added alongside this file).
3. Confirm each fixture's `customerId` is isolated — run a quick read-only check that it owns zero real `ClosetItem`/`NaiaModel`/`Subscription` rows before using it, the same ownership-isolation discipline already applied everywhere else in this codebase.
4. Never reuse a fixture identifier that could collide with a real customer's data.

## 4. What is explicitly NOT provided here

- No fixtures file (none committed; `*.json` under this directory is gitignored).
- No seed script that writes to any specific database — that choice (which local/disposable DB) needs to be made at run time, not hardcoded here.
- No automation that creates a disposable Vercel/Prisma project — that is a provisioning decision requiring its own approval, same as every other "create new infra" action in this workstream.
