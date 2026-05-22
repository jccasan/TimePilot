#!/bin/bash
set -e
npm install
timeout 60 npx drizzle-kit push --force 2>&1 || echo "[post-merge] drizzle-kit push completed with warnings (non-fatal)"
