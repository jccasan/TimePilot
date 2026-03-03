#!/bin/bash
set -euo pipefail

echo "=== Security Auto-Fix Starting ==="
echo ""

echo "[1/2] Applying safe dependency patches..."
npm audit fix --force 2>&1 || echo "  Some fixes could not be applied automatically."
echo ""

echo "[2/2] Verifying application still builds..."
if npm run check 2>&1; then
  echo "  TypeScript check passed."
else
  echo "  WARNING: TypeScript check had issues. Review manually."
fi
echo ""

echo "=== Security Auto-Fix Complete ==="
echo "Re-run ./scripts/security_scan.sh to verify fixes."
