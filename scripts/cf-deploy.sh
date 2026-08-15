#!/bin/sh
# Build the Nuxt frontend and deploy gitpo.st to Cloudflare Workers (static assets + API).
# First-time / agent deploy:  sh scripts/cf-deploy.sh --temporary
# After you claim the account: sh scripts/cf-deploy.sh
set -eu
cd /workspace 2>/dev/null || cd "$(dirname "$0")/.."

FLAG="${1:-}"

echo "Building frontend…"
if [ ! -d web/node_modules ]; then
  (cd web && pnpm install)
fi
(cd web && pnpm generate)

echo "Deploying Worker + assets…"
if [ "$FLAG" = "--temporary" ]; then
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    npx wrangler deploy --temporary --var "ADMIN_PASSWORD:${ADMIN_PASSWORD}"
  else
    npx wrangler deploy --temporary
  fi
else
  npx wrangler deploy
  if [ -n "${ADMIN_PASSWORD:-}" ]; then
    printf '%s' "$ADMIN_PASSWORD" | npx wrangler secret put ADMIN_PASSWORD
  fi
fi
