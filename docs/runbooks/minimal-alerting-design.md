# Minimal External Alerting — Design Only

**Status: design document only. Nothing in this document has been implemented, configured, or connected.** No account was created, no webhook URL was registered, no code was changed. This is deliberately a *smaller* step than `docs/runbooks/error-tracking-provider-setup.md` (which describes a full Sentry-or-similar APM integration) — it exists because a full APM decision can take time, and Task 8's audit found that right now, with zero external alerting of any kind, a webhook or Stripe-dashboard failure is invisible until a customer complains. This design gets *something* watching, cheaply, without waiting on the bigger decision.

## Why this is separate from the Sentry-track document

`error-tracking-provider-setup.md` is about full APM: error grouping, stack traces, release tracking, a dashboard UI, sampling, cost at scale. That's the right long-term answer but has real setup cost (account, SDK, PII-scrubbing review) before it should touch Production.

This document describes the smallest possible "a human finds out within minutes" mechanism, built entirely on infrastructure that already exists in this codebase:
- `app/lib/error-tracking.server.ts`'s `captureError`/`captureFailure` — already the single place every classified failure flows through (SSR errors, FASHN, Claude; **not yet** Stripe webhooks — see the gap noted below).
- A plain HTTPS webhook (Slack incoming webhook, Discord webhook, or even a one-line email-sending call via the already-integrated Resend client) — no new SDK, no new account type to evaluate, just one URL/key to provision when you're ready.

## Proposed design

1. **Add an optional "sink" callback to the existing seam**, not a new seam. `captureError`/`captureFailure` in `error-tracking.server.ts` would gain one more internal step: after logging to stdout (unchanged), optionally POST a minimal JSON payload `{context, name, message, occurredAt}` (the exact same shape already logged — no new PII surface, since `meta` is already caller-sanitized by contract) to a single configured webhook URL, read from one new env var (e.g. `OPS_ALERT_WEBHOOK_URL`). If the var is unset, behavior is byte-identical to today — console-only, no network call. This preserves "the seam is the only integration point" property from Phase 1.
2. **Fire-and-forget, never block the request.** The POST must not be awaited on the hot path that triggered the error — use the same "swallow the secondary failure" discipline already used elsewhere in this codebase (e.g. `journey-events.server.ts`'s fire-and-forget event recording) so a flaky webhook endpoint can never turn one real failure into two.
3. **A basic rate/volume guard**, so an incident that produces 500 FASHN failures in a minute doesn't also produce 500 Slack messages. Simplest version: an in-memory counter per process with a short cooldown (e.g. "at most 1 alert per distinct `context` value per 5 minutes") — intentionally not persisted/distributed, since this is meant to be a cheap first line, not a precise dedup system.
4. **Close the Stripe-webhook gap as part of wiring this, not before.** Task 8 found `app/routes/api.stripe-webhook.tsx` and `app/lib/billing/webhook-handler.server.ts` import nothing from `error-tracking.server.ts` at all — their catch blocks are silent. That file is owned by the Stripe/Clerk workstream (per this phase's coordination boundary) — this document recommends that workstream route their existing catch blocks through `captureFailure`/`captureError` the same way FASHN/Claude already do, rather than this phase touching billing files directly.

## What this does NOT do

- Does not replace the case for a real APM eventually — no error grouping, no stack trace capture beyond what's already logged, no historical dashboard.
- Does not add retry/backoff for the alert delivery itself — if the webhook endpoint is down, that one alert is lost (acceptable for a cheap first line; not acceptable as the permanent answer).
- Does not decide which webhook/provider to use — that's still your call, and still requires creating an account/webhook URL, which this document explicitly does not do.

## Minimum to activate (future work, needs your approval)

1. Pick a destination (Slack incoming webhook is the lowest-friction option if the team already uses Slack).
2. Create that one webhook URL yourself (or authorize a session to do it with that specific scope).
3. Implement the optional sink described in §1-3 above, with its own tests (mirroring the FASHN/Claude logging tests' pattern: a fake webhook endpoint via DI, asserting the payload shape and that absence of the env var changes nothing).
4. Set the env var in Preview first, trigger one deliberate test failure, confirm the alert arrives, before setting it in Production.

## Essential launch-day monitoring, now (even before any of the above is built)

Lower-tech options that need zero code, available today:
- An external uptime monitor (UptimeRobot, Better Stack, or similar) pointed at `/api/health` — pure external configuration, no code, no approval needed beyond picking a provider.
- A saved Vercel log search/filter for the `[error-capture]` and `fashn:`/`claude:` prefixes already emitted by the existing seam — someone checking it once or twice a day during the first launch week costs nothing to set up.
- Manual, scheduled checks of `admin.maintenance.tsx` (erasure failures) and the Stripe dashboard (webhook delivery failures, disputes) — both already exist and need no new code, just a human and a calendar reminder.
