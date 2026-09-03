#!/bin/sh
set -e
# The BuySkip enums were created directly on staging (db push) before this migration was
# added. Mark it as applied so migrate deploy doesn't try to re-run it and hit the
# duplicate_object error on the CREATE TYPE statements.
npx prisma migrate resolve --applied 20260903100000_add_buy_skip_outcome 2>/dev/null || true
npx prisma migrate deploy
npx prisma generate
npm run build
