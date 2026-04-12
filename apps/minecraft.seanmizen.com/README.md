# minecraft.seanmizen.com

A browser build of Sean's WebGPU voxel engine
(`utils/swindowzig/examples/voxel`). Ships as a single-page static site
served over the home-server cloudflared tunnel at
`https://minecraft.seanmizen.com`.

## What it is

- Fullscreen `<canvas>`, no menu-before-game.
- Loads a ~3.1 MB `app.wasm` containing the voxel engine (hilly worldgen,
  skylight lighting, classic AO, 4× MSAA, 120 Hz tick rate — same defaults
  as the native binary).
- WebGPU only. Chrome and Edge on desktop work today; Safari and Firefox
  support is still landing. On a browser without `navigator.gpu` the page
  shows a styled "this game needs WebGPU" panel.

## Layout

```
apps/minecraft.seanmizen.com/
├── README.md           ← this file
├── INVESTIGATION.md    ← state of the wasm port, risks, red flags
├── DEPLOY.md           ← exact commands for Sean to ship it
├── package.json        ← workspace scripts (build, prod:docker, down)
├── dockerfile          ← multi-stage zig + bun + serve
├── docker-compose.yml  ← mirrors apps/seanmizen.com/docker-compose.yml
├── build.sh            ← host-side build script (zig + bun)
├── src/
│   └── boot.ts         ← production WASM bootstrap (bundled to public/boot.js)
└── public/
    ├── index.html      ← fullscreen canvas + status overlay
    ├── boot.js         ← bundled bootstrap (generated)
    └── app.wasm        ← voxel engine wasm artefact (generated)
```

## Building locally

Requires Zig 0.15.2 and Bun 1.x on your PATH.

```bash
# From the monorepo root:
./apps/minecraft.seanmizen.com/build.sh

# Or via yarn:
yarn workspace minecraft.seanmizen.com build
```

The script:
1. Runs `zig build web -Dexample=voxel` in `utils/swindowzig/` — produces
   `zig-out/bin/app.wasm` and copies it into `public/app.wasm`.
2. Runs `bun build src/boot.ts` — bundles the swindowzig WebGPU bridge
   (from `utils/swindowzig/backends/wasm/{webgpu,events,audio}.ts`) into
   `public/boot.js`.
3. Each step is idempotent and prints a warning if a tool is missing.

Preview it with any static file server:

```bash
npx serve -s apps/minecraft.seanmizen.com/public -l 4040
# then visit http://localhost:4040 in Chrome
```

Or run the Docker image directly (this is what the cloudflared tunnel
targets in production):

```bash
cd apps/minecraft.seanmizen.com
yarn prod:docker      # builds and starts the container on :4040
yarn down             # stops it
```

## Development loop

For iteration on the Zig engine, use swindowzig's existing dev server:

```bash
cd utils/swindowzig
zig build web -Dexample=voxel
bun backends/wasm/dev-server.ts
# opens http://localhost:3020
```

That dev server watches `libs/` and `examples/` for `.zig` changes and
rebuilds automatically. The minecraft subdomain reuses the swindowzig
bridge, so any fix you make there also flows into this app after a
`yarn workspace minecraft.seanmizen.com build`.

## Deploying

See `DEPLOY.md` for the exact commands. Short version:

```bash
# On Sean's home server:
git pull
yarn prod:docker                      # or `cd apps/minecraft.seanmizen.com && yarn prod:docker`
sudo systemctl reload cloudflared     # to pick up the new config.yml
```

Port used: **4040** (cloudflared 4xxx range). Cloudflared ingress rule
lives in `apps/cloudflared/config.yml` and routes `minecraft.seanmizen.com`
→ `http://localhost:4040` *before* the `*.seanmizen.com` wildcard.

## Known limitations

- **WebGPU only.** No WebGL fallback. That's deliberate; the voxel engine
  targets the full WebGPU surface.
- **Hardcoded defaults.** No in-browser settings menu yet — hilly world,
  skylight, classic AO, 4× MSAA. Matches the native binary's defaults.
- **Runtime correctness is unverified.** The voxel wasm compiles and
  exports the right symbols, but I have not driven it from a real
  browser in this session. First run will probably surface bugs in the
  `sw_gpu/gpu.zig` wasm path. See `INVESTIGATION.md` § "Known risks at
  runtime" for the likely failure modes.
- **3.1 MB wasm.** Debug build. Switch to
  `zig build web -Dexample=voxel --release=fast` for a smaller ship.

## See also

- `INVESTIGATION.md` — what's actually wired, what's latent, and what Sean
  will hit on the first browser load.
- `DEPLOY.md` — the exact commands to run in the morning.
- `utils/swindowzig/CLAUDE.md` — the engine's own docs and critical
  lessons.
