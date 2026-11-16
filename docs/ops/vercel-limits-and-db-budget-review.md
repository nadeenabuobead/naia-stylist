# Vercel Function Limits, DB Connection Budgeting, Exports & Retry Review

**Status: read-only review.** No shared configuration was changed (`vercel.json` is untouched). Every item below either cites a specific file:line or is explicitly marked as needing a live dashboard check this review could not perform.

## 1. This branch's `vercel.json` has no `functions` block at all

```json
{
  "framework": "react-router",
  "installCommand": "npm install",
  "buildCommand": "if [ \"$VERCEL_ENV\" = production ]; then npx prisma migrate deploy && npx prisma generate && npm run build; else sh scripts/build-preview.sh; fi"
}
```

No per-route `maxDuration`/`memory` override exists anywhere — every function gets Vercel's platform default. This directly contradicts a comment left in the code: `app/routes/api.staging-full-look-vto.tsx:21-22` says *"On Vercel the default function timeout is 60s — set maxDuration in vercel.json"*, but no such setting exists on this branch. That route's FASHN poll loop can legitimately run close to its 90s budget (`MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS` in `app/lib/ai/fashn-try-on.server.ts` = 45 × 2000ms = 90s) — on the platform's 60s default (Hobby) that **will** be killed mid-poll; on a Pro plan's 300s default it has headroom, but only because of the plan default, not anything this repo declares. **This needs an explicit `functions` entry in `vercel.json` for any route with a poll/long-running shape, independent of which plan tier happens to be active** — do not rely on the account's current plan default as if it were a documented guarantee. Not fixed here: `vercel.json` is a shared root config file, out of scope for this isolated pass per the explicit "do not change shared configurations" constraint.

## 2. Every non-Production build unconditionally runs `prisma migrate deploy` — no gate

`scripts/build-preview.sh` (this branch, not the RC lineage some prior memory describes):
```sh
set -e
npx prisma migrate deploy
npx prisma generate
npm run build
```
Called for **every** `VERCEL_ENV != production` build — i.e. every Preview deployment of every branch pushed to whichever Vercel project is GitHub-linked to this repo, with zero opt-in flag. This is a materially different (and riskier) posture than a sibling lineage's `NAIA_ALLOW_PREVIEW_MIGRATIONS`-gated version (see `project_staging_readiness_vercel_assessment` memory, which describes a *different* branch's `build-preview.sh`) — **do not assume that gate exists here; it does not, on this branch, today.** Combined with whichever database a given Preview deployment's `NAIA_DATABASE_URL` resolves to (shared vs. isolated depends on live Vercel project config, not code — see `project_db_isolation_stages_abcd_complete` for the last known state, which needs re-confirming live before relying on it), pushing a branch with a pending migration to this lineage applies that migration automatically, with no review gate, the moment the push triggers a Preview build.

**This is the single highest-leverage finding in this review.** Recommended fix (not applied — shared config, needs explicit approval + coordination with whoever owns this lineage's deploy pipeline): reintroduce an explicit opt-in gate (`NAIA_ALLOW_PREVIEW_MIGRATIONS=true` or equivalent) before `prisma migrate deploy` runs on any non-Production build, matching the safer pattern already proven out on the other lineage.

## 3. Two Prisma Client modules, inconsistent connection-limit policy

- `app/db.server.js` — `connection_limit=1` appended to `NAIA_DATABASE_URL` explicitly, with a detailed comment explaining why (each serverless instance only ever needs one connection for the one request it's serving; Prisma's own pooler absorbs concurrency across instances).
- `app/lib/prisma.server.ts` — a second, separate `new PrismaClient()` singleton with **no connection_limit override at all** (defaults to Prisma's own default, which is higher than 1). Used by `post-wear-review`, `api.styleme-outcome`, `style-me/_index`, `onboarding/step.$step`, `style-me/result`, `onboarding/complete` (per a prior audit's grep — worth re-confirming the current call-site list before acting on this).

Two independent Prisma Client instances per process means **up to 2× the intended per-instance connection footprint** on any request path that happens to touch both modules in the same invocation (uncommon but not provably impossible without tracing every route). Not fixed here — reconciling two Prisma singletons is a cross-cutting change that risks colliding with whatever the parallel Closet-reliability workstream is actively touching in exactly this area (per the task brief, that workstream owns Closet DB reliability — coordinate before touching either file).

## 4. Connection-pool budget math (why the 10-VU load-test stage is a real gate, not a formality)

- Staging Postgres: `max_connections=50` (per the 2026-11-09 security audit's `git show` of the deployed config), ~9 in steady background use.
- Each serverless instance: `connection_limit=1` (from `app/db.server.js`) for routes using that module, or Prisma's unconstrained default for routes using `app/lib/prisma.server.ts` (see §3).
- `PrismaSessionStorage`'s own background `pollForTable()` (from `@shopify/shopify-app-session-storage-prisma`) independently competes for a connection on cold start — a previously-diagnosed, partially-mitigated contention pattern (see `project_launch_checklist_nov14_reconciliation` memory: `connection_limit` was raised 1→2 on a *different* lineage specifically to give this its own slot; **this branch's `app/db.server.js` is still at `connection_limit=1`**, so if that contention pattern applies here too, it has not been mitigated on this lineage).
- Rough math: with a 1-connection cap per instance, ~41 non-reserved connections, and cold starts potentially doubling momentary demand per instance (app query + session-storage poll) on `app/lib/prisma.server.ts`-touching routes, **the pool could plausibly saturate well under 50 concurrent *instances*, let alone 50 concurrent *users*** (one user's request can span multiple serverless invocations). This is a hypothesis to be confirmed BY the load test's 10-VU stage, not a measured fact — see `load-test-plan.md` §5's hard-stop criterion on `P2024`/pool-timeout errors.

## 5. Cloudinary: no retry logic, no mock-override point

`app/lib/cloudinary-admin.server.ts` has zero retry logic on any of its upload/destroy/download-URL-generation call sites — every failure path is a single `catch { return { ok: false, errorCode: ... } }` with no backoff or re-attempt (confirmed at the three catch sites in that file). Unlike FASHN/Claude (which now have a single `BASE_URL` constant each, overridable via `ALLOW_PROVIDER_MOCKS` + a mock-URL env var — see `provider-mock-override.test.ts`), Cloudinary's upload/destroy/download URLs are built inline at 5+ separate call sites with no shared constant, so adding an equivalent override is a larger, more invasive change than the FASHN/Claude one-constant edit — not attempted in this pass given this file's direct involvement in customer-photo privacy/security controls (EXIF stripping, private delivery, signed URLs), which is plausibly active territory for a concurrent security workstream. **Flagged as a prerequisite gap, not fixed**: if Closet/BuyOrSkip upload journeys are ever added to the load-test plan, this needs either (a) a `CLOUDINARY_BASE_URL`-style override added the same way FASHN/Claude got theirs, reviewed by whoever owns that file's security properties, or (b) accepting that those journeys stay out of automated load testing indefinitely.

Retry recommendation (not implemented): a single bounded retry (mirroring the pattern already used for transient DB errors in `naia-session.server.ts`) on network-class failures only (not on a 4xx from Cloudinary, which won't succeed on retry) would likely reduce transient-failure noise without weakening the existing "fail visibly rather than silently" posture — but this touches the same sensitive file as above, so left as a recommendation.

## 6. ZIP/data export: unstreamed, unbounded, and not actually a ZIP

`app/routes/admin.naia.customers.$customerId.closet-export.tsx:27-98` loads one customer + all `ClosetItem` rows via two Prisma queries, builds one in-memory JS object, and returns a single `JSON.stringify(payload, null, 2)` response — **not streamed, no row cap, no byte-size check anywhere in the loader.** There is no ZIP-archiving dependency anywhere in `package.json`, and no code anywhere in the repo generates an actual ZIP file — "ZIP export" as referenced in the task brief does not exist as shipped code on this branch (a prior memory, `project_launch_checklist_nov14_reconciliation`, describes real Vercel-platform numbers gathered for a *proposed* streaming-ZIP design — 4.5MB non-streamed payload cap, 5MB-per-image Closet upload limit, 250-item paid-tier cap, ~1.25GB theoretical worst case — but confirms that proposal was never implemented).

**Practical exposure today**: a customer with a very large Closet (up to the 250-item paid-tier cap, each item carrying descriptive text/metadata but not the images themselves inline in this particular export) could in principle produce a response near or past Vercel's 4.5MB non-streamed-response ceiling, which would 413 rather than degrade gracefully. Not confirmed by live sampling (would require touching real customer data, out of scope for this review) — recommend checking actual payload sizes for the largest few real Closets via Cloudinary's/the DB's own aggregate stats before deciding whether this needs fixing before launch or can wait.

## 7. Function-limit summary table (Vercel platform defaults, Pro plan — confirm current plan tier before relying on this)

| Limit | Default | Max (Pro) | Relevant route(s) |
|---|---|---|---|
| Function duration | 300s | 800s (1800s extended beta) | `api.staging-full-look-vto.tsx` (FASHN poll, ~90s budget — fine under default, but see §1) |
| Function memory | 2GB | 4GB | none identified as memory-pressured in this review |
| Non-streamed response payload | — | **4.5MB hard cap** (413 beyond it) | the closet-export loader in §6; any future streaming-ZIP design must treat this as mandatory, not optional |

## 8. What this review did not do

- Did not read live Vercel project settings (plan tier, current env vars, actual `max_connections`) — every live-state claim above is cited to a specific prior memory/audit and flagged as needing re-confirmation, not asserted as current fact.
- Did not modify `vercel.json`, `scripts/build-preview.sh`, `app/db.server.js`, `app/lib/prisma.server.ts`, or `app/lib/cloudinary-admin.server.ts` — all five are named above as needing a fix, none touched, per the explicit "do not change shared configurations" constraint on this task.
