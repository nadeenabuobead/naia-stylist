# Centralized Error Tracking — Provider Setup Requirements

**Status: nothing in this document has been actioned.** No account was created, no external service was configured, no SDK/dependency was added to `package.json`. This document exists to identify exactly what a real provider integration (e.g. Sentry, or a similar APM/error-tracking product) would require, so that decision and the account creation itself stay with the user.

## What this Phase 1 pass actually did (the "prepare" part)

Added `app/lib/error-tracking.server.ts` — a single internal function (`captureError`/`captureFailure`) that every error-logging call site in this pass now routes through, instead of a bare `console.error`. Today it only writes a structured JSON line to stdout (so it's visible in existing Vercel function logs, same as before, just structured and consistent). **This is not centralized monitoring** — nothing leaves this process. It exists so that wiring in a real provider later is a one-file change: swap the body of `captureError`/`captureFailure` to also forward to the provider's SDK, and every existing call site benefits without being touched again.

Do not report or imply to anyone that centralized monitoring is "operational" based on this change alone — external delivery of events has not been built or verified.

## What a real provider integration needs (requires your approval before any of this is done)

1. **Account creation.** A Sentry (or equivalent) account/organization needs to exist. This is an external service relationship — billing, data-processing terms, and data-residency all become relevant the moment an account exists, even before any code ships. Needs your explicit sign-off on which provider and which plan tier.
2. **A project + DSN (or equivalent ingest key).** Each environment (Production, Preview/staging) typically gets its own project or at least its own DSN, so errors from a feature branch's Preview deployment don't mix into Production's error stream. Needs a decision on environment separation, mirroring the same Preview/Production key-separation question already flagged for Clerk in the prior audit — don't repeat that gap here.
3. **An SDK dependency.** Adding `@sentry/node` (or similar) to `package.json` is itself a new third-party dependency with its own license, its own small bundle/cold-start cost, and its own supply-chain surface — worth a deliberate decision, not an incidental addition.
4. **PII/data-scrubbing configuration.** Most error-tracking SDKs capture request headers, cookies, and local variables by default unless explicitly configured not to. Given this codebase's existing discipline (hashed customer IDs, no raw photos/prompts/tokens in logs — see `journey-events.server.ts`, and this Phase 1 pass's own FASHN/Claude logging work), the SDK's scrubbing/`beforeSend` configuration needs to be set up to match that discipline *before* any real event is ever sent, not after. This is the single most important configuration step from a privacy standpoint — get it reviewed before the first real error reaches the provider.
5. **Environment variables.** A DSN is typically not secret in the way an API key is (Sentry DSNs are often safe to ship client-side), but it still needs to be added as a Vercel environment variable per environment, which means someone needs to decide and execute that in the Vercel dashboard.
6. **Sampling / volume and cost.** Error-tracking and APM providers bill by event volume (and, for some products, by trace/session volume). A sampling rate decision (capture 100% of errors but a lower % of performance traces, for example) affects both cost and how much signal is retained — needs a decision informed by expected traffic, which this document cannot supply.
7. **Alerting rules.** Once events are flowing, someone needs to decide what should actually page/notify a human (e.g. "FASHN failure rate > X in 10 minutes"), and who receives that alert. Not a code change, but a configuration + on-call-process decision.

## Recommended order, once you approve moving forward

1. Pick the provider and plan tier (your decision).
2. Create the account/project + DSN yourself, or explicitly authorize an agent session to do it on your behalf with specific scope.
3. Add the DSN as a Preview-scoped Vercel env var first, verify events land correctly and are PII-clean for a handful of deliberately-triggered test errors, *before* adding it to Production.
4. Only then update `error-tracking.server.ts`'s two functions to forward to the SDK — every existing call site (FASHN, Claude, SSR render errors) picks this up automatically, no further code changes needed per call site.
5. Configure alerting rules once real signal is flowing.

Nothing above has been started beyond step 0 (the internal seam already built in this Phase 1 pass).
