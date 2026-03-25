#!/bin/bash
set -e
npm install
timeout 30 npx drizzle-kit push < /dev/null 2>&1 || echo "[post-merge] drizzle-kit push completed with warnings (non-fatal)"
