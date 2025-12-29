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
serve -s /app/sites/planning-poker -l 5040 &      # pp.seanmizen.com

# Backends (using Bun) - PORT env var overrides config port
PORT=5011 bun /app/backends/seanscards/index.js &           # seanscards API
PORT=5021 bun /app/backends/carolinemizen/index.js &        # carolinemizen API
PORT=5041 bun /app/backends/planning-poker/index.js &       # planning-poker API

# nginx as the main process (proxies all requests)
nginx -g 'daemon off;'
