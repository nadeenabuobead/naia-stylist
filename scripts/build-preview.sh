#!/bin/sh
set -e
npx prisma migrate resolve --applied 20260903100000_add_buy_skip_outcome && npx prisma migrate deploy && npx prisma generate && npm run build
