#!/usr/bin/env bash
# check-inline-migrations.sh
#
# Counts the number of ALTER TABLE statements in server/index.ts (excluding
# comment lines) and fails if the count exceeds the frozen baseline established
# when this guard was added.
# This prevents new schema columns from being added as inline startup patches
# instead of proper Drizzle migration files in drizzle/migrations/.
#
# Usage: bash scripts/check-inline-migrations.sh
# Exit code 0 = OK, 1 = baseline exceeded (new inline migration detected).

set -euo pipefail

TARGET_FILE="server/index.ts"
# Baseline count at the time this guard was introduced (2025-05-27).
# Do NOT increase this number — create a Drizzle migration instead.
BASELINE=72

# Count only non-comment lines containing ALTER TABLE.
# Lines that begin with optional whitespace followed by // are comments.
# Uses POSIX character class [[:space:]] for portable whitespace matching.
actual=$(grep "ALTER TABLE" "$TARGET_FILE" | grep -Ev '^[[:space:]]*//' | wc -l | tr -d ' ')

if [ "$actual" -gt "$BASELINE" ]; then
  echo "ERROR: Inline migration guard failed."
  echo "  Found $actual ALTER TABLE statements in $TARGET_FILE (baseline: $BASELINE)."
  echo ""
  echo "  New schema changes must be added as Drizzle migration files in"
  echo "  drizzle/migrations/ — NOT as inline ALTER TABLE statements in server/index.ts."
  echo ""
  echo "  To create a migration: npx drizzle-kit generate"
  exit 1
fi

echo "OK: Inline migration count ($actual) is within the frozen baseline ($BASELINE)."
