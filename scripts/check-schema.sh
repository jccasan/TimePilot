#!/bin/bash
# check-schema.sh — Detects schema drift between shared/schema.ts and the live database.
#
# Exits 0  — schema matches the database (no pending changes).
# Exits 1  — schema drift detected OR drizzle-kit failed to run.
#
# Because drizzle-kit has no --dry-run flag, this script runs
#   npx drizzle-kit push --verbose
# with stdin closed so that any interactive confirmation prompt receives EOF.
# When no changes are pending the command completes silently (exit 0).
# When changes are pending, the interactive-prompt text is present in the output
# and is matched below to report drift and fail the check.
set -euo pipefail

echo "[schema-check] Comparing Drizzle schema to live database..."

TMPOUT=$(mktemp /tmp/schema-check-XXXXXX.log)
DRIZZLE_EXIT=0
timeout 120 npx drizzle-kit push --verbose < /dev/null > "$TMPOUT" 2>&1 || DRIZZLE_EXIT=$?

# Strip ANSI / spinner control codes for reliable matching.
CLEAN=$(sed 's/\x1b\[[0-9;]*[mGKHJABCDsurh]//g; s/\x1b\[?[0-9]*[hl]//g; s/\r//g' "$TMPOUT")
rm -f "$TMPOUT"

# --- Hard failure: drizzle-kit itself exited non-zero (DB unreachable, config
#     error, etc.).  Treat as a verification failure — never report "in sync"
#     when we could not actually perform the check.
if [ "$DRIZZLE_EXIT" -ne 0 ]; then
  echo ""
  echo "[schema-check] ERROR: drizzle-kit push exited with code $DRIZZLE_EXIT."
  echo "Schema verification could not complete."
  echo ""
  echo "$CLEAN" | tail -20
  echo ""
  echo "Check DATABASE_URL and drizzle.config.ts, then re-run."
  exit 1
fi

# --- Drift detection: drizzle-kit push (without --force) prints an interactive
#     prompt listing pending changes when the schema and DB are out of sync.
#     These keywords appear exclusively in that prompt output.
DRIFT_PATTERN="(create table|rename table|drop table|alter table|add column|drop column|create index|drop index|create sequence|drop sequence|created or renamed from another table)"

if echo "$CLEAN" | grep -qiE "$DRIFT_PATTERN"; then
  echo ""
  echo "[schema-check] SCHEMA DRIFT DETECTED — pending changes found:"
  echo "--------------------------------------------------------------"
  echo "$CLEAN" | grep -iE "$DRIFT_PATTERN"
  echo "--------------------------------------------------------------"
  echo ""
  echo "Run 'npx drizzle-kit push --force' to apply the changes, then re-run this check."
  exit 1
fi

echo "[schema-check] Schema is in sync with the database. No pending changes."
exit 0
