#!/bin/sh
# Preview/staging build: resolve stuck migration record then sync schema via db push.
# The 20260624100000_add_naia_session migration failed on 2026-07-30 because
# naia-stylist-staging had already created NaiaSession via db push before the
# git-integrated project tried prisma migrate deploy (CREATE TABLE -> already exists).
# || true makes this safe: if the migration is already resolved, it's a no-op.
npx prisma migrate resolve --applied "20260624100000_add_naia_session" 2>&1 || true
npx prisma db push
npx prisma generate
npm run build
