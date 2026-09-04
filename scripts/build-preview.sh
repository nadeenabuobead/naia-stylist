#!/bin/sh
set -e
npx prisma migrate deploy
npx prisma generate
npm run build
