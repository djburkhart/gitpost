#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
FLAG="${1:-}"
echo "Building frontend…"
if [ ! -d web/node_modules ]; then
  (cd web && pnpm install)
fi
(cd web && pnpm generate)
echo "Deploying Worker + assets…"
if [ "$FLAG" = "--temporary" ]; then
  npx wrangler deploy --temporary
else
  npx wrangler deploy
fi
