#!/bin/sh
# Temporary, deploy-candidate-only fail-closed guard (2026-10-20).
#
# This worktree/branch (deploy/phase2-staging-candidate) exists solely for
# ONE controlled Preview deployment of the Phase 2 security/privacy release
# against naia-stylist-staging. Vercel has previously assigned a deployment
# to Production unexpectedly even without --prod being passed. This guard
# does not trust that assignment at all: it refuses unconditionally, before
# any Prisma command can run, unless VERCEL_ENV is literally "preview".
#
# This file and the one-line vercel.json change that calls it exist ONLY on
# this disposable branch — the canonical fix/phase2-privacy-remediation
# branch and the published application are untouched.
set -e

if [ "$VERCEL_ENV" != "preview" ]; then
  echo "FATAL [deploy-candidate]: refusing to build — VERCEL_ENV='$VERCEL_ENV', expected 'preview'. This is a temporary, isolated deploy-candidate branch for one controlled Preview deployment against naia-stylist-staging; it must never run as Production." >&2
  exit 1
fi
