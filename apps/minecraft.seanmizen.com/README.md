# minecraft.seanmizen.com

A browser build of Sean's WebGPU voxel engine
(`examples/voxel` in [seanmizen/swindowzig](https://github.com/seanmizen/swindowzig)). Ships as a single-page static site
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
├── build.zig.zon       ← pins the swindowzig release (see swindowzig)
├── build.zig           ← zig build: the example wasm to zig-out/bin, the web backend to zig-out/swindowzig
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

Requires Bun 1.x and the Zig version in `build.zig.zon`
(`minimum_zig_version`) on your PATH.

```bash
# From the monorepo root:
./apps/minecraft.seanmizen.com/build.sh

# Or via yarn:
yarn workspace minecraft.seanmizen.com build
```

The script:
1. Runs `zig build -Dexample=voxel` in this directory. `build.zig` builds
   the example of the pinned swindowzig release to `zig-out/bin/app.wasm`.
   The script copies it into `public/app.wasm`. The same build writes
   `chunks.wasm`, the chunk worker. It also installs the web backend of
   the release to `zig-out/swindowzig/backends/wasm`.
2. Runs `bundle.sh`. It bundles the swindowzig wasm loader
   (`zig-out/swindowzig/backends/wasm/loader.ts`) and the modules that it
   imports into `public/boot.js`. The dev page uses the same loader. It
   bundles the Web Worker script (`backends/wasm/chunk-worker.ts`), and
   copies `chunks.wasm`. The two chunk files get content-hashed names, and
   `boot.js` holds the names. So a browser cache cannot pair an old chunk
   worker with a new `app.wasm`. See `examples/voxel/docs/chunk-pipeline.md`
   in swindowzig.
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

## swindowzig

The engine is the package
[seanmizen/swindowzig](https://github.com/seanmizen/swindowzig). This app
uses one release of it:

- `build.zig.zon` pins the release: a URL and a hash. No other file names
  the swindowzig version.
- `zig build` fetches the release into the Zig cache and into `zig-pkg/`.
  The repository ignores `zig-pkg/`. The build needs no checkout of
  swindowzig.
- A dependent package can use only the swindowzig modules. The `web` step
  and the example settings are in the `build.zig` of swindowzig. So
  `build.zig` here runs `zig build web --build-file <the build.zig of the
  package>`, with its own cache and prefix. The engine build logic stays
  in swindowzig.

To change the release, give the URL of the new release to `zig fetch` in
this directory. It writes the new URL and hash into `build.zig.zon`:

```bash
cd apps/minecraft.seanmizen.com
zig fetch --save https://github.com/seanmizen/swindowzig/releases/download/v0.3.0/swindowzig.tar.gz
```

To build against a local swindowzig checkout, set `SWINDOWZIG_FORK`.
`build.sh` then gives the checkout to `zig build --fork`. The wasm and the
installed web backend then come from that checkout:

```bash
SWINDOWZIG_FORK=~/projects/swindowzig yarn workspace minecraft.seanmizen.com build
```

The Docker build fetches the release from GitHub during `docker build`.
So the build host must have access to `github.com`.

## Development loop

For iteration on the Zig engine, use the dev server in the swindowzig
checkout:

```bash
cd ~/projects/swindowzig
zig build web -Dexample=voxel
bun backends/wasm/dev-server.ts
# opens http://localhost:3020
```

That dev server watches `libs/` and `examples/` for `.zig` changes and
rebuilds automatically. To see a change in this app before a swindowzig
release, build with `SWINDOWZIG_FORK` (see swindowzig).

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
→ `http://localhost:4042`. There is no `*.seanmizen.com` wildcard.

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
- `CLAUDE.md` in swindowzig — the engine's own docs and critical
  lessons.
