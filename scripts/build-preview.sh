#!/bin/sh
set -e

# Defense-in-depth (2026-10-20, deploy-candidate only): repeats the same
# check require-preview-env.sh already ran, so migrating never depends
# solely on how this script was invoked.
if [ "$VERCEL_ENV" != "preview" ]; then
  echo "FATAL [deploy-candidate]: refusing to build — VERCEL_ENV='$VERCEL_ENV', expected 'preview'." >&2
  exit 1
fi

npx prisma migrate deploy
npx prisma generate
npm run build
