#!/bin/sh
set -e

# Defense-in-depth (2026-10-20, deploy-candidate only): repeats the same
# check require-preview-env.sh already ran, so migrating never depends
# solely on how this script was invoked.
if [ "$VERCEL_ENV" != "preview" ]; then
  echo "FATAL [deploy-candidate]: refusing to build — VERCEL_ENV='$VERCEL_ENV', expected 'preview'." >&2
  exit 1
fi

# Explicit migration-control gate (2026-11-04). Before this, every preview
# build applied whatever migrations were pending against staging's DB,
# unconditionally — the moment a branch with new, unreviewed migrations
# (e.g. the Clerk identity-linking schema) got pushed, its very first
# preview build would silently apply them, with no separate approval step
# between "push" and "migrate". That is exactly the failure mode this gate
# closes.
#
# Default is to SKIP migrate deploy. A preview build only applies pending
# migrations when NAIA_ALLOW_PREVIEW_MIGRATIONS is explicitly set to
# "true" as a Vercel project/environment variable for that specific
# deployment — a deliberate, reviewable action taken once the pending
# migration list has actually been checked against staging (see the
# staging reconciliation procedure in the integration report), never a
# side effect of merely pushing a branch.
if [ "$NAIA_ALLOW_PREVIEW_MIGRATIONS" = "true" ]; then
  echo "NAIA_ALLOW_PREVIEW_MIGRATIONS=true — applying pending migrations for this preview build."
  npx prisma migrate deploy
else
  echo "NAIA_ALLOW_PREVIEW_MIGRATIONS is not 'true' — skipping prisma migrate deploy. Pending schema changes (if any) stay unapplied for this preview build. Set NAIA_ALLOW_PREVIEW_MIGRATIONS=true on this Vercel environment only after reconciling against the real staging migration history."
fi

npx prisma generate
npm run build
