# minecraft.seanmizen.com — investigation notes

Written while scaffolding this subdomain on branch `voxel/web-subdomain`.
Captures the state of the voxel web build path, the seanmizen.com deploy
flow it mirrors, and the exact cloudflared delta. Read this first before
poking at the Docker image or the boot pipeline.

## TL;DR

- The voxel WASM build **compiles** end-to-end after a round of surgical
  edits to `utils/swindowzig/examples/voxel/main.zig`, `build.zig`, and
  `libs/sw_gpu/src/gpu.zig`.
  - Produces `zig-out/bin/app.wasm` (~3.1 MB) exporting `swindowzig_init`,
    `swindowzig_frame`, and the two `swindowzig_config_*` constants.
- The production JS bootstrap lives at `src/boot.ts`. Bun bundles it into
  `public/boot.js` pulling in the real WebGPU bridge from
  `utils/swindowzig/backends/wasm/webgpu.ts` (the bridge is ~1200 lines and
  already implements most of the WebGPU surface the voxel engine needs).
- Docker + cloudflared plumbing is in place and mirrors the seanmizen.com
  pattern exactly — port 4040, new ingress rule above the `*.seanmizen.com`
  wildcard in `apps/cloudflared/config.yml`.
- **Runtime behaviour is not yet verified in a real browser.** Compiling
  and exporting symbols is not the same as running — the swindowzig WebGPU
  bridge has latent bugs that only surface when driven, and the Zig-side
  wasm pipeline has several untested paths. See § "Known risks at runtime".

## Current state of the voxel web build

### Before these changes
- `zig build web -Dexample=voxel` failed with 6 compile errors. Root
  causes: `std.Thread`, `std.posix.{SEEK, STDERR_FILENO, writev, pwritev,
  lseek}` pulled in via `std.process.argsAlloc`, the default `std.log`
  logger, and TAS file IO.
- `runWasm()` in `libs/sw_app/src/app.zig:64` was a literal no-op — it
  accepted the config and callbacks and returned without doing anything.
- `backends/wasm/boot.ts` imported `swindowzig_init` / `swindowzig_frame`
  from the wasm module, but **no Zig code exported those symbols**. The
  wasm bootstrap was aspirational, not functional.
- `libs/sw_gpu/src/web_bridge.zig` declared all extern WebGPU functions
  as non-`pub`, so `gpu.zig` couldn't reference them from its `if
  (is_wasm)` branches. Multiple call sites in `gpu.zig` used the old
  Zig 0.14 `ArrayList.init(allocator)` API which no longer compiles, and
  `setBindGroup()` passed a literal `null` for a non-optional pointer.
- `backends/wasm/webgpu.ts` hardcoded `fetch('../../zig-out/bin/app.wasm')`
  — that's fine for `backends/wasm/dev-server.ts` but not for a deployed
  static site.

### After these changes
- Voxel example compiles for `wasm32-freestanding` without errors.
- Wasm binary exports `swindowzig_init`, `swindowzig_frame`,
  `swindowzig_config_disable_context_menu`, `swindowzig_config_hide_cursor`.
- Wasm binary contains the full voxel engine — 3.1 MB unstripped, strings
  for `chunk`, `skylight`, `WORLD LOADING`, etc. visible in the binary.
- `src/boot.ts` fetches `./app.wasm` (same-directory) and drives the
  engine via the real swindowzig WebGPU bridge.

### Files touched to get this far

In `utils/swindowzig/`:

1. `examples/voxel/main.zig`
   - Added `const builtin` import and `const is_wasm = ...` guard.
   - Added `pub const std_options` with a `swindowzigLogFn` that routes
     `std.log.*` through a `jsLog` extern on wasm and `std.io.getStdErr`
     on native. Avoids `std.log.defaultLog` (which transitively pulls in
     `std.time.nanoTimestamp` → `clock_gettime` → posix).
   - Added `fatalExit` helper (with split wasm/native definitions to
     keep the unused-parameter lint happy) and replaced all
     `std.process.exit(N)` call sites with it.
   - Added `perfNowNs` helper and replaced all
     `std.time.nanoTimestamp()` calls with it.
   - Gated `std.process.argsAlloc` in `voxelInit` behind `if (comptime
     !is_wasm)`. On wasm the arg slice is empty and CLI flag parsing is
     a no-op (hardcoded defaults do the job).
   - Gated the `--tas` / TAS file-loading block behind `!is_wasm` — it
     calls `TasScript.parseFile` which touches `std.fs.cwd()`.
   - Gated the `--dump-frame` PPM-writing block in `voxelRender` behind
     `!is_wasm`.
   - `pub fn main() !void` returns early when `is_wasm` is true.
   - Added a WASM entry shim at the bottom of the file: module-global
     `wasm_timeline`, `wasm_bus`, `wasm_input`, `wasm_gpu`, `wasm_ctx`,
     `wasm_backend`; `wasmInitImpl` that constructs them and calls
     `voxelInit`; `wasmFrameImpl` that polls events, advances the
     timeline, calls `voxelTick`/`voxelRender`. Exported via `comptime
     { if (is_wasm) @export(&...) }`.

2. `build.zig`
   - Added `sw_platform` as an import on the WASM `example` module. The
     voxel wasm entry shim constructs a `WasmBackend` directly so it
     needs access to `platform.wasm_canvas.WasmBackend.create`.

3. `libs/sw_gpu/src/web_bridge.zig`
   - Marked all 38 `extern "webgpu" fn` declarations `pub`. Without this
     `gpu.zig` couldn't compile for wasm32-freestanding at all — it's
     a latent bug that only surfaces when something actually drives the
     web path.

4. `libs/sw_gpu/src/gpu.zig`
   - `createRenderPipeline`: updated `std.ArrayList([]web.VertexAttributeJS)`
     from the old `.init(alloc)` API to the new `ArrayList(T){}` API with
     per-op allocator argument.
   - `setBindGroup` (wasm path): replaced literal `null` for a non-optional
     `[*]const u32` parameter with a valid empty-slice pointer.

In `apps/cloudflared/`:

5. `config.yml` — added a hostname rule for `minecraft.seanmizen.com` that
   routes to `http://localhost:4040`. Positioned **before** the
   `*.seanmizen.com` wildcard because cloudflared matches rules in order.

## How seanmizen.com gets to production

`apps/seanmizen.com/package.json` has:

```
"prod:docker": "BUILD_TARGET=prod docker compose --profile prod up --build --detach"
```

which invokes `apps/seanmizen.com/docker-compose.yml`. That compose file is
two-profile (`dev` / `prod`) with a shared `x-frontend-base` anchor. The
build context is the monorepo root, dockerfile is `apps/seanmizen.com/dockerfile`,
target is `${BUILD_TARGET:-dev}`, and it publishes `4000:4000`.

`apps/seanmizen.com/dockerfile` has three stages:

1. `dev` — `node:23-slim` with corepack enabled, `yarn rsbuild dev --port 4000`.
2. `prod-build` — same base, copies workspace root files + the app's
   source, runs `yarn workspaces focus seanmizen.com` then `yarn workspace
   seanmizen.com build` to produce `apps/seanmizen.com/dist`.
3. `prod` — `node:23-slim`, copies `dist/` into `/app`, globally installs
   `serve`, runs `serve -s . -l 4000`.

Root `package.json` has `"prod:docker": "yarn workspaces foreach -At run
prod:docker"` — so a `yarn prod:docker` at the repo root runs every
workspace's `prod:docker` script. Adding a workspace with that script is
the only thing needed to slot it into the monorepo deploy.

## How the cloudflared tunnel routes subdomains

`apps/cloudflared/config.yml` is the ingress file consumed by the
cloudflared daemon that runs on Sean's home server. It references tunnel
`0f63e5e3-...` and a credentials file.

The ingress list is evaluated top-to-bottom; first match wins. The wildcard
`*.seanmizen.com` that routes to port 4000 is the catch-all, so specific
hostnames (`pp.seanmizen.com`, now `minecraft.seanmizen.com`) **must** be
listed before it.

Cloudflare DNS already has a wildcard CNAME pointing `*.seanmizen.com` at
the tunnel, so no DNS change is needed for a new subdomain. The only
required edit to add `minecraft.seanmizen.com` is the one hostname rule
in `config.yml` (already done in this branch).

The `apps/cloudflared/dockerfile` and `apps/cloudflared/docker-compose.yml`
are both empty stubs — the cloudflared daemon runs outside Docker on the
host, reading `config.yml` directly. So the deploy flow on Sean's server is:

1. `git pull`
2. `yarn prod:docker` (builds and starts `minecraft-seanmizen-com` container on 4040)
3. Reload the cloudflared daemon to pick up the new `config.yml` rule.
   Typical: `sudo systemctl reload cloudflared` or `cloudflared tunnel
   ingress validate` followed by a restart.

## Minimum diff to add `minecraft.seanmizen.com` as another ingress

Already applied in this branch:

1. `apps/cloudflared/config.yml` — one hostname rule, 4 lines, listed
   before `*.seanmizen.com`.
2. `apps/minecraft.seanmizen.com/` — new workspace with `package.json`,
   `dockerfile`, `docker-compose.yml`, `public/`, `src/`, `build.sh`,
   and these docs.

Port 4040 is the next free slot in the 4xxx range (4000 seanmizen,
4010/4011 seanscards, 4020/4021 carolinemizen, 4030/4031 planning-poker,
4120 tcp-getter). The 5xxx fly.io parity has **not** been added — see
"Phase 3 gaps" below.

## Known risks at runtime

The wasm **compiles and exports the right symbols**, but I have not driven
it from a real browser yet. Several layers are untested end-to-end:

1. **`sw_gpu/gpu.zig` wasm path.** The file has a giant `if (comptime
   is_wasm)` fork in almost every function, and most of those branches
   have never been exercised. The visibility + ArrayList + null-ptr bugs
   I had to fix to get it to compile are strong evidence that nobody has
   run this before. Expect more latent bugs to surface the first time the
   voxel engine actually touches a particular pipeline descriptor.

2. **`backends/wasm/webgpu.ts` descriptor unmarshalling.** The bridge
   reads pipeline descriptors out of WASM linear memory using fixed byte
   offsets. Any mismatch between Zig's `extern struct` layout and the
   JavaScript `DataView.getUint32(offset, true)` offsets will crash or
   silently produce garbage. The voxel engine uses:
   - depth-stencil textures (but the native path has a painter's-algo
     workaround for wgpu-native Metal bugs — the wasm path may need
     similar treatment or may "just work")
   - 4× MSAA (native default; may need fallback on WebGPU)
   - FXAA render-to-texture (`--aa=fxaa`)
   - Storage textures / compute passes? (check `voxel.wgsl` + any
     compute pipelines referenced in `main.zig`)

3. **Canvas resize vs WebGPU surface.** `src/boot.ts` resizes the canvas
   backing store to `window.innerWidth * dpr`, but the swindowzig
   `initWebGPU()` configures the surface once at boot and the Zig
   `wasm_gpu.init(null, 1280, 720)` call in `wasmInitImpl` hardcodes
   1280×720. First-load will probably show a stretched 1280×720 texture
   regardless of viewport size, and window resize will not
   reconfigure the surface.

4. **Event pump contract.** `swindowzig_event_resize`/`mouse_*`/`key` are
   exported from `sw_platform/wasm_canvas.zig` — `attachEventListeners`
   in `events.ts` calls them by name from the wasm exports object. This
   should work because those symbols exist in the wasm binary as exports.
   Not tested.

5. **Spawn + world loading TAS integration.** `main.zig` has logic that
   keeps the TAS replayer in `.stopped` state until `state.world_loading`
   becomes false. On wasm the TAS replayer is always null (never set by
   the gated CLI block), so this should degrade cleanly to the normal
   "play without TAS" path — but double-check.

6. **Pointer lock + Esc behaviour.** Pointer lock is gestured from the
   browser event handler in `events.ts`; the voxel engine's click-to-
   capture flow assumes SDL-style mouse capture. Haven't tested the
   pointer-lock handoff.

## Phase 3 gaps

- **Fly.io parity.** `utils/fly-io/dockerfile` and
  `docker-compose.fly.yml` bundle all frontends into one image with an
  nginx gateway on 5xxx ports. `minecraft.seanmizen.com` is **not** added
  to that bundle. Sean can either add it later (new 5040 port + nginx
  location block) or leave it cloudflared-only. The home-server deploy
  is the primary target for this change, so I judged this out of scope.

- **CI / biome config.** The new files in `apps/minecraft.seanmizen.com/`
  should be linted by biome like the rest of the monorepo. No `tsconfig.json`
  or `rsbuild.config.js` yet because this isn't an rsbuild app. Biome
  should pick up the `.ts` files automatically via the root `biome.json`.

- **`utils/fly-io/dockerfile` unchanged.** Same reason as above — Sean
  runs home-server deploy, this is optional.

- **No `tsconfig.json` in `apps/minecraft.seanmizen.com/`.** The bun
  bundler infers types from the TypeScript source directly. If Sean wants
  to run `tsc --noEmit` against it, add a minimal tsconfig that extends
  the swindowzig package.

## Red flags for Sean

- **Voxel engine in-browser has never run.** Compiling and linking is not
  the same as executing. The first browser run will almost certainly
  crash somewhere in the WebGPU bridge. Expect to spend a couple of
  sessions debugging the pipeline descriptor marshalling path.

- **3.1 MB wasm on every page load.** No compression yet. `serve` should
  gzip automatically but the raw wasm is hefty. Release builds (`zig
  build web -Doptimize=ReleaseFast`) should cut this to ~800 KB; worth
  trying once runtime is verified.

- **`native_sdl.zig` gets the include path from `/opt/homebrew/include`.**
  Not a problem for wasm (it's `comptime`-gated out) but it's a reminder
  that the native build is macOS-only. Don't break that while iterating
  on the wasm path.

- **No browser fallback for missing WebGPU.** The boot.js shows a
  friendly "this game needs WebGPU" panel if `navigator.gpu` is absent.
  Do NOT attempt a WebGL fallback — the voxel engine is WebGPU-only and
  any fallback would be a completely different codebase.

- **Home-server cloudflared daemon reload.** After merging this branch
  Sean has to reload the cloudflared daemon on the home server so it
  picks up the new `config.yml`. See `DEPLOY.md`.
