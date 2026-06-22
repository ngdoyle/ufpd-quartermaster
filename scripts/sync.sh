#!/usr/bin/env bash
# Sync helper for UFPD Quartermaster.
# Commits all current changes and pushes to the private GitHub repo
# (ngdoyle/ufpd-quartermaster). Run after every app update so the repo
# always reflects the deployed code and work is never lost.
#
# Usage:  ./scripts/sync.sh "short message describing the change"
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-Update Quartermaster}"

# Safety: never commit secrets or the database (already in .gitignore,
# but double-check nothing sensitive slipped into the working tree).
if git grep -nE "DB_ENCRYPTION_KEY[[:space:]]*=[[:space:]]*[0-9a-f]{32}" -- . >/dev/null 2>&1; then
  echo "ERROR: a hardcoded DB encryption key appears to be staged. Aborting." >&2
  exit 1
fi

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
  exit 0
fi

git commit -m "$MSG"
git push origin HEAD
echo "Pushed to ngdoyle/ufpd-quartermaster ($(git rev-parse --short HEAD))."
