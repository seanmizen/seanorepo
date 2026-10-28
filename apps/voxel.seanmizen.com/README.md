# voxel.seanmizen.com

A browser build of Sean's WebGPU voxel engine
(`utils/swindowzig/examples/voxel`). Ships as a single-page static site
served over the home-server cloudflared tunnel at
`https://voxel.seanmizen.com`.

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
apps/voxel.seanmizen.com/
├── README.md           ← this file
├── package.json        ← workspace scripts (build, prod:docker, down)
├── dockerfile          ← multi-stage zig + bun + serve
├── docker-compose.yml  ← mirrors apps/seanmizen.com/docker-compose.yml
├── build.sh            ← host-side build script (zig + bun)
├── bundle.sh           ← bun bundles and content-hashed chunk files (build.sh and the dockerfile run it)
├── src/
│   └── boot.ts         ← production WASM bootstrap (bundled to public/boot.js)
└── public/
    ├── index.html      ← fullscreen canvas + status overlay
    ├── serve.json      ← cache headers: no-cache, and immutable for the hashed chunk files
    ├── boot.js         ← bundled bootstrap (generated)
    ├── app.wasm        ← voxel engine wasm artefact (generated)
    ├── chunks-<hash>.wasm       ← the chunk worker wasm (generated)
    └── chunk-worker-<hash>.js   ← the Web Worker script (generated)
```

## Building locally

Requires Bun 1.x and the Zig version in `utils/swindowzig/build.zig.zon`
(`minimum_zig_version`) on your PATH.

```bash
# From the monorepo root:
./apps/voxel.seanmizen.com/build.sh

# Or via yarn:
yarn workspace voxel.seanmizen.com build
```

The script:
1. Runs `zig build web -Dexample=voxel` in `utils/swindowzig/` — produces
   `zig-out/bin/app.wasm` and copies it into `public/app.wasm`.
   The same build writes `chunks.wasm`, the chunk worker.
2. Runs `bundle.sh`. It bundles the swindowzig wasm loader
   (`utils/swindowzig/backends/wasm/loader.ts`) and the modules that it
   imports into `public/boot.js`. The dev page uses the same loader. It
   bundles the Web Worker script (`backends/wasm/chunk-worker.ts`), and
   copies `chunks.wasm`. The two chunk files get content-hashed names, and
   `boot.js` holds the names. So a browser cache cannot pair an old chunk
   worker with a new `app.wasm`. See
   `utils/swindowzig/examples/voxel/docs/chunk-pipeline.md`.
3. Each step is idempotent and prints a warning if a tool is missing.

Preview it with any static file server:

```bash
npx serve -s apps/voxel.seanmizen.com/public -l 4040
# then visit http://localhost:4040 in Chrome
```

Or run the Docker image directly (this is what the cloudflared tunnel
targets in production):

```bash
cd apps/voxel.seanmizen.com
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
rebuilds automatically. The voxel subdomain reuses the swindowzig
bridge, so any fix you make there also flows into this app after a
`yarn workspace voxel.seanmizen.com build`.

## Deploying

The commands:

```bash
# On Sean's home server:
git pull
yarn prod:docker                      # or `cd apps/voxel.seanmizen.com && yarn prod:docker`
sudo systemctl reload cloudflared     # to pick up the new config.yml
```

Port used: **4040** (cloudflared 4xxx range). Cloudflared ingress rule
lives in `apps/cloudflared/config.yml` and routes `voxel.seanmizen.com`
→ `http://localhost:4042`. There is no `*.seanmizen.com` wildcard.

## Known limitations

- **WebGPU only.** No WebGL fallback. That's deliberate; the voxel engine
  targets the full WebGPU surface.
- **Hardcoded defaults.** No in-browser settings menu yet — hilly world,
  skylight, classic AO, 4× MSAA. Matches the native binary's defaults.
- **Runtime correctness is unverified.** The voxel wasm compiles and
  exports the right symbols, but I have not driven it from a real
  browser in this session. First run will probably surface bugs in the
  `sw_gpu/gpu.zig` wasm path.
- **3.1 MB wasm.** Debug build. Switch to
  `zig build web -Dexample=voxel --release=fast` for a smaller ship.

## See also

- `utils/swindowzig/CLAUDE.md` — the engine's own docs and critical
  lessons.
