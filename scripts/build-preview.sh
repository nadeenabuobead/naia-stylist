#!/bin/sh
# TEMPORARY: read-only DB audit. Does not build the app.
# Exits 1 so the deployment alias stays on the current working build.
node scripts/audit-staging-db.mjs
