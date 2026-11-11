#!/usr/bin/env bash
# scripts/run-live-metadata-validation.sh
#
# Run this yourself, in your own terminal. It is never executed by Claude.
#
# Prompts for your Cloudinary credentials with masked (non-echoing) input,
# never writes them to any file, and never passes them as a command-line
# argument — so they never appear in shell history or in `ps`'s argument
# listing. They are scoped only to the one vitest process invoked below via
# `VAR=val command` (not `export`), so no later command in this shell
# inherits them, and they are explicitly `unset` immediately after as a
# second layer of defense — keeping their live window as short as possible.
#
# Honest limit: this protects against shell-history and `ps`-argument
# exposure, and keeps the live window short. It does NOT make the value
# invisible to every local process — a process's environment can still be
# read by other processes running as the same OS user via lower-level
# process-inspection (e.g. /proc/<pid>/environ on Linux, or equivalent
# tooling on macOS with the right privileges) for as long as that one
# vitest process is alive. The script never logs these values itself.
#
# Usage:
#   chmod +x scripts/run-live-metadata-validation.sh
#   ./scripts/run-live-metadata-validation.sh

set -euo pipefail
cd "$(dirname "$0")/.."

echo "This prompts for your Cloudinary credentials (same account as Preview/Production)."
echo "Input is masked, never echoed, never written to a file, and used only for the"
echo "one test run below — then discarded."
echo

read -r -s -p "Cloudinary cloud name: " CLD_CLOUD_NAME; echo
read -r -s -p "Cloudinary API key: " CLD_API_KEY; echo
read -r -s -p "Cloudinary API secret: " CLD_API_SECRET; echo
read -r -s -p "Cloudinary wardrobe upload preset name: " CLD_PRESET; echo
echo

# Cloud name and preset name are identifiers, not secrets — safe to display
# for visual confirmation. API key and API secret are never echoed.
echo "Please confirm these match the Cloudinary dashboard exactly:"
echo "  Cloud name:    $CLD_CLOUD_NAME"
echo "  Upload preset: $CLD_PRESET"
echo
read -r -p "Press Enter to continue, or Ctrl+C to abort and start over... " _

echo
echo "Running the read-only preset/credential preflight, then (only if it passes)"
echo "the one live synthetic validation..."
echo

CLOUDINARY_CLOUD_NAME="$CLD_CLOUD_NAME" \
CLOUDINARY_API_KEY="$CLD_API_KEY" \
CLOUDINARY_API_SECRET="$CLD_API_SECRET" \
CLOUDINARY_WARDROBE_UPLOAD_PRESET="$CLD_PRESET" \
CLOUDINARY_METADATA_STRIP_LIVE=1 \
  node_modules/.bin/vitest run app/routes/api.cloudinary-signature.live-metadata-validation.test.ts

unset CLD_CLOUD_NAME CLD_API_KEY CLD_API_SECRET CLD_PRESET
