#!/bin/bash
set -euo pipefail

REPORTS_DIR="$(dirname "$0")/../reports"
mkdir -p "$REPORTS_DIR"

EXIT_CODE=0

echo "=== Security Scan Starting ==="
echo ""

echo "[1/3] Dependency Vulnerability Scan (npm audit)..."
npm audit --json > "$REPORTS_DIR/dependency-audit.json" 2>/dev/null || true
AUDIT_RESULT=$(npm audit 2>&1 || true)
if echo "$AUDIT_RESULT" | grep -q "found 0 vulnerabilities"; then
  echo "  No vulnerabilities found."
elif echo "$AUDIT_RESULT" | grep -qi "high\|critical"; then
  echo "  HIGH/CRITICAL vulnerabilities detected!"
  EXIT_CODE=1
else
  echo "  Low/moderate vulnerabilities found (non-blocking)."
fi
echo ""

echo "[2/3] Secrets Detection (pattern scan)..."
SECRETS_FILE="$REPORTS_DIR/secrets-scan.txt"
echo "Secrets Scan Report - $(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$SECRETS_FILE"
echo "========================================" >> "$SECRETS_FILE"

SECRETS_FOUND=0
SCAN_DIRS="server shared client/src scripts"

for pattern in \
  'AKIA[0-9A-Z]{16}' \
  'sk_live_[0-9a-zA-Z]{24,}' \
  'sk-[0-9a-zA-Z]{32,}' \
  'ghp_[0-9a-zA-Z]{36}' \
  'SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}' \
  '-----BEGIN (RSA |EC )?PRIVATE KEY-----'; do
  MATCHES=$(grep -rn -E "$pattern" $SCAN_DIRS 2>/dev/null | grep -v 'security_scan.sh' || true)
  if [ -n "$MATCHES" ]; then
    echo "Pattern: $pattern" >> "$SECRETS_FILE"
    echo "$MATCHES" >> "$SECRETS_FILE"
    echo "" >> "$SECRETS_FILE"
    SECRETS_FOUND=$((SECRETS_FOUND + 1))
  fi
done

if [ "$SECRETS_FOUND" -eq 0 ]; then
  echo "  No leaked secrets detected."
  echo "No secrets found." >> "$SECRETS_FILE"
else
  echo "  Potential secrets found: $SECRETS_FOUND patterns matched."
  EXIT_CODE=1
fi
echo ""

echo "[3/3] Static Analysis (SAST via semgrep)..."
SAST_FILE="$REPORTS_DIR/sast-results.json"
if command -v semgrep &> /dev/null; then
  semgrep scan \
    --config auto \
    --json \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude 'build' \
    --exclude '.next' \
    --exclude 'reports' \
    --exclude '*.min.js' \
    --severity ERROR \
    --severity WARNING \
    server/ shared/ \
    > "$SAST_FILE" 2>/dev/null || true

  ERROR_COUNT=$(grep -c '"severity": "ERROR"' "$SAST_FILE" 2>/dev/null || true)
  WARN_COUNT=$(grep -c '"severity": "WARNING"' "$SAST_FILE" 2>/dev/null || true)
  ERROR_COUNT=${ERROR_COUNT:-0}
  WARN_COUNT=${WARN_COUNT:-0}
  echo "  Semgrep: $ERROR_COUNT errors, $WARN_COUNT warnings"
  if [ "$ERROR_COUNT" -gt 0 ] 2>/dev/null; then
    EXIT_CODE=1
  fi
else
  echo "  Semgrep not available. Skipping SAST."
  echo '{"findings":[],"note":"semgrep not available"}' > "$SAST_FILE"
fi
echo ""

echo "=== Security Scan Complete ==="
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "STATUS: FAIL - Issues found. See reports/ for details."
else
  echo "STATUS: PASS - No High/Critical issues found."
fi

exit $EXIT_CODE
