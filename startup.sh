#!/bin/sh
set -eu
cd /workspace
export PATH="/usr/local/go/bin:${PATH}"
export GITPOST_DATA="${GITPOST_DATA:-/workspace/data}"
export GITPOST_ADDR="${GITPOST_ADDR:-127.0.0.1:8090}"

if ! curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:8090/api/health"; then
  (cd /workspace/backend && go build -o /workspace/backend/gitpost .)
  /workspace/backend/gitpost >>/tmp/gitpost-api.log 2>&1 &
  i=0
  while [ "$i" -lt 30 ]; do
    if curl -sf -o /dev/null --max-time 1 "http://127.0.0.1:8090/api/health"; then
      break
    fi
    i=$((i + 1))
    sleep 0.2
  done
fi

if ! curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:8080/"; then
  cd /workspace/web
  pnpm dev >>/tmp/gitpost-web.log 2>&1 &
fi
