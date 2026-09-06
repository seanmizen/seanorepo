#!/bin/sh
# Fly.io Entrypoint - Starts all services (Port Range: 5xxx)
# To add a new service:
# 1. Add serve command for frontend on 5xxx port
# 2. Add PORT env var and bun command for backend on 5xx1 port (if applicable)
# 3. Ensure the service is built in dockerfile and routed in nginx.conf

set -e

# Frontends (using 'serve')
serve -s /app/sites/seanmizen.com -l 5000 &       # seanmizen.com
serve -s /app/sites/seanscards -l 5010 &          # seanscards.com
serve -s /app/sites/carolinemizen -l 5020 &       # carolinemizen.art
serve -s /app/sites/planning-poker -l 5030 &      # pp.seanmizen.com
serve -s /app/sites/inside -l 5060 &              # inside.seanmizen.com

# Backends (using Bun) - PORT env var overrides config port
PORT=5011 bun /app/backends/seanscards/index.js &           # seanscards API
PORT=5021 bun /app/backends/carolinemizen/index.js &        # carolinemizen API
PORT=5031 bun /app/backends/planning-poker/index.js &       # planning-poker API

# inside API. Bun runs the TypeScript directly — see the dockerfile for why
# this one is not bundled.
#
# Storage on Fly is EPHEMERAL by design: no volume is attached, so the SQLite
# file and uploaded assets are lost on every deploy or machine restart. The
# home server (cloudflared, 4060/4061) holds the real data; Fly is a mirror.
# See apps/inside/README.md.
#
# JWT_SECRET and COOKIE_SECRET are deliberately not defaulted here — inside-be
# refuses to boot in production without them, which is the behaviour we want.
# Set them with `fly secrets set`.
mkdir -p /app/data/inside/uploads
PORT=5061 \
  DB_PATH=/app/data/inside \
  UPLOADS_PATH=/app/data/inside/uploads \
  UPLOADS_URL="${INSIDE_UPLOADS_URL:-https://inside.seanmizen.com/api/uploads}" \
  FRONTEND_URL="${INSIDE_FRONTEND_URL:-https://inside.seanmizen.com}" \
  CORS_ORIGIN="${INSIDE_CORS_ORIGIN:-https://inside.seanmizen.com}" \
  bun /app/backends/inside/inside-be/src/index.ts &          # inside API

# nginx as the main process (proxies all requests)
nginx -g 'daemon off;'
