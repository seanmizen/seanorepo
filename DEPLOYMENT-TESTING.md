# Deployment Testing Guide

This guide explains how to test both Cloudflared (home server) and Fly.io (cloud) deployments locally before pushing to production.

## Port Scheme

The repository uses separate port ranges to avoid conflicts:

- **Cloudflared (4xxx)**: Home server with separate Docker containers
- **Fly.io (5xxx)**: Cloud deployment with single container + nginx gateway

| Service | Cloudflared | Fly.io |
|---------|-------------|--------|
| seanmizen.com (FE) | 4000 | 5000 |
| seanscards (FE) | 4010 | 5010 |
| seanscards (BE) | 4011 | 5011 |
| carolinemizen.art (FE) | 4020 | 5020 |
| carolinemizen.art (BE) | 4021 | 5021 |
| planning-poker (FE) | 4030 | 5030 |
| planning-poker (BE) | 4031 | 5031 |
| Fly.io nginx gateway | - | 8080 |

## Testing Cloudflared Setup

### Start Services

From repository root:

```bash
# Start all services in production mode
yarn prod:docker

# Or start individual apps (from their respective directories)
cd apps/seanmizen.com && yarn prod:docker
cd apps/seanscards && yarn prod:docker
cd apps/carolinemizen.art && yarn prod:docker
cd apps/planning-poker && yarn prod:docker
```

### Run Tests

```bash
./test-deployment.sh cloudflared
```

### Manual Verification

Visit these URLs in your browser:
- http://localhost:4000 - seanmizen.com
- http://localhost:4010 - seanscards.com
- http://localhost:4011/api - seanscards API
- http://localhost:4020 - carolinemizen.art
- http://localhost:4021 - carolinemizen.art API (hello world)
- http://localhost:4030 - planning-poker
- http://localhost:4031 - planning-poker API

### Stop Services

```bash
yarn down
# Or from individual app directories
cd apps/[app-name] && yarn down
```

## Testing Fly.io Setup

The Fly.io deployment uses a **single unified dockerfile** (`utils/fly-io/dockerfile`) that builds all services (4 frontends + 3 backends) into one container with nginx routing.

### Setup: /etc/hosts (One-time, Recommended)

For production-like testing with nginx routing, add these entries to `/etc/hosts`:

```bash
sudo nano /etc/hosts
```

Add:
```
127.0.0.1 seanmizen.com seanscards.com carolinemizen.art pp.seanmizen.com
```

**Why?** This lets you test with real domain names (e.g., `http://pp.seanmizen.com:8080`) which triggers same-origin mode, so nginx correctly routes `/api` requests to backends. Direct port access (e.g., `localhost:6030`) won't work properly for apps with backends because the frontend uses the wrong API port.

**Safe to leave forever?** Yes! These entries are harmless and only affect local development.

### Build and Run

Using docker-compose (from `utils/fly-io` directory):

```bash
cd utils/fly-io
docker compose -f docker-compose.fly.yml up --build
```

This automatically:
- Builds all services using Yarn for dependency management
- Exposes all individual service ports (6xxx range locally, 5xxx in container)
- Exposes nginx gateway (port 8080) for production-like routing

### Alternative: Manual Build

From repository root:

```bash
docker build -f utils/fly-io/dockerfile -t seanmizen-flyio .
docker run -p 8080:8080 -p 5000:5000 -p 5010:5010 -p 5011:5011 -p 5020:5020 -p 5021:5021 -p 5030:5030 -p 5031:5031 seanmizen-flyio
```

### Run Tests

```bash
./test-deployment.sh flyio
```

### Manual Verification

**Recommended: Via nginx gateway (with /etc/hosts setup)**
- http://seanmizen.com:8080
- http://seanscards.com:8080
- http://carolinemizen.art:8080
- http://pp.seanmizen.com:8080

**Direct service access** (6xxx ports, frontend-only apps work, apps with backends won't):
- http://localhost:6000 - seanmizen.com ✅
- http://localhost:6010 - seanscards.com ❌ (backend API calls fail)
- http://localhost:6020 - carolinemizen.art ❌ (backend API calls fail)
- http://localhost:6030 - planning-poker ❌ (backend API calls fail)

**Alternative: curl with Host headers** (without /etc/hosts):
```bash
curl -H "Host: seanmizen.com" http://localhost:8080
curl -H "Host: seanscards.com" http://localhost:8080
curl -H "Host: carolinemizen.art" http://localhost:8080
curl -H "Host: pp.seanmizen.com" http://localhost:8080
```

### Stop Container

If using docker-compose:
```bash
cd utils/fly-io
docker compose -f docker-compose.fly.yml down
```

If using manual docker run:
```bash
docker stop $(docker ps -q --filter ancestor=seanmizen-flyio)
```

## Testing Both Setups

Run all tests:

```bash
./test-deployment.sh both
```

This will:
1. Test all Cloudflared services (4xxx ports)
2. Test all Fly.io services (5xxx ports)
3. Test Fly.io nginx gateway routing

## Adding a New Service

### 1. Choose Port Numbers
- Cloudflared: 4xxx (e.g., 4050 for FE, 4051 for BE)
- Fly.io: 5xxx (e.g., 5050 for FE, 5051 for BE)

### 2. Update Cloudflared Config
Edit `apps/cloudflared/config.yml`:

```yaml
# new-service.com - Ports 4050 (FE) / 4051 (BE)
- hostname: new-service.com
  path: /api/*
  service: http://localhost:4051
- hostname: new-service.com
  service: http://localhost:4050
```

### 3. Update Fly.io Setup

**nginx.conf** (`utils/fly-io/nginx.conf`):
```nginx
upstream new_service_api {
    server 127.0.0.1:5051;
}

server {
    listen 8080;
    server_name new-service.com;

    location /api/ {
        proxy_pass http://new_service_api;
        # ... proxy headers
    }

    location / {
        proxy_pass http://127.0.0.1:5050;
        # ... proxy headers
    }
}
```

**dockerfile** (`utils/fly-io/dockerfile`):
```dockerfile
# In fe-build stage: Add frontend app
COPY apps/new-service/frontend ./apps/new-service/frontend
COPY apps/new-service/package.json ./apps/new-service/package.json
COPY apps/new-service/tsconfig.json ./apps/new-service/tsconfig.json
RUN NODE_ENV=production yarn workspace new-service-fe build

# In fe-build stage: Add backend app (for dependency installation)
COPY apps/new-service/backend ./apps/new-service/backend
COPY apps/new-service/configs.ts ./apps/new-service/configs.ts

# Add backend build stage
FROM oven/bun:latest AS be-build-ns
WORKDIR /app
ENV NODE_ENV=production
COPY --from=fe-build /repo/node_modules ./node_modules
COPY --from=fe-build /repo/apps/new-service/configs.ts ./configs.ts
COPY --from=fe-build /repo/apps/new-service/backend ./backend
RUN bun build ./backend/index.ts --target=bun --outfile ./dist/index.js

# In runtime stage: Copy built artifacts
COPY --from=fe-build /repo/apps/new-service/frontend/dist ./sites/new-service
COPY --from=be-build-ns /app/dist ./backends/new-service

# In runtime EXPOSE line: Add ports
EXPOSE 8080 ... 5050 5051
```

**entrypoint.sh** (`utils/fly-io/entrypoint.sh`):
```bash
serve -s /app/sites/new-service -l 5050 &
PORT=5051 bun /app/backends/new-service/index.js &
```

### 4. Update Test Script
Edit `test-deployment.sh` to include the new service in both test functions.

## Environment-Specific Backend Configuration

Backends use the `PORT` environment variable to override config ports:
- Cloudflared: Uses default config ports (4xxx)
- Fly.io: Sets `PORT=5xxx` in entrypoint.sh

Example in backend code:
```typescript
const port = process.env.PORT ? Number(process.env.PORT) : config.serverPort;
await fastify.listen({ host: '0.0.0.0', port });
```

## Fly.io Technical Details

**Dependency Management:**
- ✅ All dependencies installed via Yarn in the fe-build stage
- ✅ Backend build stages copy node_modules from fe-build
- ⚠️ Bun is used ONLY for building bundles and runtime (never for `bun install`)

**Directory Structure Preservation:**
- Backend builds preserve monorepo structure: `/app/configs.ts` + `/app/backend/`
- This allows relative imports like `import { configs } from '../configs'` to work

**Container Architecture:**
- Single container runs: nginx + 4 frontends (serve) + 3 backends (Bun)
- Nginx listens on 8080, routes by domain to individual service ports (5xxx)

## Deployment Checklist

Before deploying to production:

- [ ] All Cloudflared tests pass (`./test-deployment.sh cloudflared`)
- [ ] All Fly.io tests pass (`./test-deployment.sh flyio`)
- [ ] Both setups have identical service list
- [ ] All backends support PORT env var override
- [ ] Nginx config matches all services in Fly.io
- [ ] Cloudflared config matches all services
- [ ] No port conflicts between setups

## Troubleshooting

### Service won't start
- Check if port is already in use: `lsof -i :[port]`
- Check Docker logs: `docker logs [container-id]`
- Verify environment variables are set correctly

### Tests fail
- Ensure all services are running
- Check that ports match the configuration
- Verify backend supports PORT env var override

### Nginx routing fails (Fly.io)
- Check nginx config syntax: `nginx -t`
- Verify upstream definitions match backend ports
- Check Host header in requests
