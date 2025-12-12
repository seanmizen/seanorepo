#!/bin/sh
set -e

# Root site (seanmizen.com) on 4100
serve -s /app/sites/seanmizen.com -l 4100 &

# Planning poker frontend on 4101
serve -s /app/sites/planning-poker -l 4101 &

# Planning poker backend (Bun) on 4102
bun /app/backend/index.js &

# nginx as the main process
nginx -g 'daemon off;'
