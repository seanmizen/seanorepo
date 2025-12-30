# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

This is a **polyglot monorepo** managed with Yarn 4 workspaces. It contains personal projects spanning web apps, backend services, utilities, and system tools. The codebase intentionally mixes technologies (Node.js, Bun, Go, React) based on what's appropriate for each project.

## Setup

Requires **Yarn 4** via corepack:

```bash
corepack enable
corepack prepare
yarn
```

## Build Commands

### Root-level shortcuts
- `yarn sean` - Start seanmizen.com dev server
- `yarn caroline` - Start carolinemizen.art dev server
- `yarn cards` - Start seanscards dev server
- `yarn gosniff` - Start gosniff Go service
- `yarn lint` - Run Biome linter/formatter with auto-fix

### Docker orchestration
- `yarn start:docker` - Start all workspaces in dev mode (hot reload)
- `yarn prod:docker` - **Production deployment command** - starts all workspaces in production mode
- `yarn down` - Stop all Docker containers
- `yarn fly:deploy` - Deploy to Fly.io

### Per-workspace commands
Navigate to any `apps/*` or `utils/*` directory:

- `yarn start` - Start dev server (equivalent to `yarn dev`)
- `yarn build` - Production build
- `yarn start:docker` - Run this workspace in Docker dev mode
- `yarn prod:docker` - Run this workspace in Docker production mode
- `yarn down` - Stop this workspace's containers

## Architecture

### Workspace Structure

- **`apps/`** - Individual applications and services
- **`utils/`** - Shared utilities and tools

### Frontend Apps (React + RSBuild)

**Stack**: React 19, React Router 7, RSBuild (Rspack), Emotion/styled-components, Material-UI, TanStack Query

Apps: `seanmizen.com`, `planning-poker` (frontend), `carolinemizen.art` (frontend), `mui-dockview`, `seanscards`

- Special: `seanmizen.com` uses Three.js for 3D graphics
- Build tool: RSBuild for fast React compilation
- Styling: CSS-in-JS with Emotion or styled-components

### Backend Services (Bun + Fastify)

**Stack**: Bun runtime, Fastify, SQLite, WebSockets, Nodemailer

Apps: `planning-poker` (backend), `tcp-getter`, `carolinemizen.art` (backend), `seanscards` (backend)

- Framework: Fastify with hot reload via Bun
- Real-time: @fastify/websocket for live communication
- Database: SQLite with named Docker volumes
- Auth: JWT plugins where needed

**CRITICAL: Bun is RUNTIME ONLY**
- ⛔ NEVER use `bun install` or `bun build` in Dockerfiles or package management
- ✅ ALWAYS use Yarn 4 for package management and installation
- ✅ Bun is used ONLY to run the application (`bun index.ts`, `bun ./dist/index.js`)
- If you see `bun install` or `bun build` anywhere, remove it and replace with Yarn
- Bundling is handled by the build tool (Rspack, esbuild, etc.), not Bun

### Go Services

App: `gosniff` - Network packet sniffer

### Utilities

- `tty-dashboard` - Terminal UI dashboard using Ink (React for terminals), FFmpeg, ytdl-core, Puppeteer
- `fly-io` - Deployment configurations
- `config-anywhere` - Configuration management
- `guides` - Documentation

### Docker Architecture

**Pattern**: Multi-stage Dockerfiles with `dev` and `prod` targets

- Build context is always monorepo root (`context: ../..`)
- Dockerfile location: `apps/[app-name]/dockerfile`
- Dev mode: Bind mounts entire monorepo with named volumes for node_modules
- Prod mode: Self-contained images with production builds
- Build target controlled via `BUILD_TARGET` env var

**Profiles**:
- `dev` profile: Hot reload enabled, source mounted
- `prod` profile: Production build, detached mode

**Example docker-compose pattern**:
```yaml
x-frontend-base: &frontend-base
  build:
    context: ../..
    dockerfile: apps/[app]/dockerfile
    target: ${BUILD_TARGET:-dev}

services:
  frontend:
    <<: *frontend-base
    profiles: ["prod"]

  frontend-dev:
    <<: *frontend-base
    volumes:
      - type: bind
        source: ../..
        target: /app
    profiles: ["dev"]
```

## Code Quality

**Linter/Formatter**: Biome v2.3.8

Configuration (`biome.json`):
- Single quotes for JS/TS
- Space indentation
- Import organization enabled
- CSS Modules support
- Git integration with .gitignore respect
- Notable rules disabled: `useExhaustiveDependencies`, `useLiteralKeys`
- Files excluded: Anything with "Glasto" in the name

Run: `yarn lint` (auto-fixes issues)

## Development Patterns

### Port Allocation

The repository uses **dual port schemes** for different deployment targets:

**Cloudflared (Home Server) - 4xxx range:**
- 4000: seanmizen.com (FE)
- 4010: seanscards (FE)
- 4011: seanscards (BE)
- 4020: carolinemizen.art (FE)
- 4021: carolinemizen.art (BE)
- 4030: planning-poker (FE)
- 4031: planning-poker (BE)

**Fly.io (Cloud) - 5xxx range:**
- 5000: seanmizen.com (FE)
- 5010: seanscards (FE)
- 5011: seanscards (BE)
- 5020: carolinemizen.art (FE)
- 5021: carolinemizen.art (BE)
- 5030: planning-poker (FE)
- 5031: planning-poker (BE)
- 8080: Fly.io nginx gateway

### Concurrent Development
Multiple apps use `concurrently` to run frontend + backend simultaneously with named logging.

### Deployment Model

**Dual Deployment Architecture:**

1. **Cloudflared (Home Server)**
   - Uses 4xxx port range
   - Each app runs in separate Docker containers
   - Cloudflared tunnels traffic to localhost ports
   - Command: `yarn prod:docker`

2. **Fly.io (Cloud)**
   - Uses 5xxx port range
   - Single container with nginx gateway (port 8080)
   - All services bundled together with domain-based routing
   - Build: `docker build -f utils/fly-io/dockerfile`

**Testing Deployments:**
See `DEPLOYMENT-TESTING.md` for comprehensive testing procedures including:
- Port scheme documentation
- Service smoke tests (`./test-deployment.sh`)
- Instructions for adding new services

**Production Deployment:**
`yarn prod:docker` is the **actual deployment command** used on the Cloudflared server. The server pulls the repo and runs this exact command.

## Working Philosophy

From readme.md:
> "this is mine, so I will commit wantonly and whenever I like. PRs and proper codebase sanitation can be done in other projects."

This is a personal monorepo - conventional best practices may be relaxed. Docker is used even for non-containerized apps just for orchestration convenience ("Not a JS/Node project? it is now").
