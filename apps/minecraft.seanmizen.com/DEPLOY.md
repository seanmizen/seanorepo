# DEPLOY.md — minecraft.seanmizen.com

Exact commands to ship the voxel subdomain. Branch `voxel/web-subdomain`
is kept unmerged for your review; everything below assumes you've merged
(or cherry-picked) it into whatever branch you deploy from.

## On your dev laptop (one-off sanity check)

```bash
# 1. Verify the voxel wasm actually compiles locally.
./apps/minecraft.seanmizen.com/build.sh

# Expect to see:
#   ✅ app.wasm → apps/minecraft.seanmizen.com/public/app.wasm
#   ✅ boot.js bundled

# 2. Preview it in Chrome.
npx serve -s apps/minecraft.seanmizen.com/public -l 4040
# Open http://localhost:4040 in Chrome — check the browser console.
#
# Expected outcome at the time of writing:
#   - You see a fullscreen canvas.
#   - The status overlay either stays on "loading" briefly then hides
#     (if the engine runs cleanly) OR surfaces a WebGPU / bind-group /
#     pipeline error in the overlay itself.
#   - Likely first-run failure: something in the sw_gpu/gpu.zig wasm
#     branch. See INVESTIGATION.md § "Known risks at runtime" for the
#     prime suspects.
```

## On the home server (production deploy)

```bash
# 1. Pull the merged branch.
cd /path/to/seanorepo
git pull

# 2. Build and start the minecraft container only.
#    This does NOT touch other running containers.
cd apps/minecraft.seanmizen.com
yarn prod:docker

# Or, to rebuild + restart ALL workspaces at once:
cd /path/to/seanorepo
yarn prod:docker

# 3. Reload the cloudflared daemon so it picks up the new ingress rule.
#    config.yml now has a minecraft.seanmizen.com hostname rule BEFORE
#    the *.seanmizen.com wildcard.
sudo systemctl reload cloudflared
# Or, if cloudflared is running via its own docker stack:
#   docker compose -f /path/to/cloudflared/docker-compose.yml restart

# 4. Sanity check that the container is listening on 4040.
curl -I http://localhost:4040/
# Expect HTTP/1.1 200 OK with content-type: text/html.

curl -I http://localhost:4040/app.wasm
# Expect HTTP/1.1 200 OK with content-type: application/wasm.

# 5. Visit the public URL.
open https://minecraft.seanmizen.com/    # or just open in a browser
```

## Rollback

```bash
# Stop just this container.
cd apps/minecraft.seanmizen.com
yarn down

# Cloudflared: revert apps/cloudflared/config.yml (drop the four
# minecraft.seanmizen.com lines) and reload:
sudo systemctl reload cloudflared

# The *.seanmizen.com wildcard will resume routing minecraft.seanmizen.com
# to the existing seanmizen.com container on port 4000.
```

## Ports used

- **4040** — `minecraft.seanmizen.com` frontend (new).
- **4000** — `seanmizen.com` frontend (unchanged).
- Wildcard `*.seanmizen.com` → 4000 still catches any subdomain not
  listed explicitly. The new `minecraft.seanmizen.com` rule intercepts
  before the wildcard.

## If the wasm is broken at runtime

You'll probably see this. The wasm compiles and exports the right
symbols, but the first browser run almost certainly needs debugging in
`utils/swindowzig/libs/sw_gpu/src/gpu.zig`'s `if (comptime is_wasm)`
branches. Start with:

1. Open DevTools, check the console. The boot.js surfaces errors into
   the overlay so you should see a status like "wasm instantiate failed"
   or "init failed" with an error message.
2. If the failure is inside `initWebGPU()`, it's a device-acquisition
   problem — usually the adapter/device promise chain or canvas context
   format.
3. If the failure is inside `voxelInit` (through `swindowzig_init`),
   it's the engine's wgpu pipeline creation path — check
   `gpu.createRenderPipeline` and `gpu.createBindGroupLayout` in
   `gpu.zig`, which read descriptors out of linear memory via
   `backends/wasm/webgpu.ts`.
4. If the failure is inside `swindowzig_frame`, it's the hot loop —
   usually missing `present()` or a buffer usage mismatch.

The INVESTIGATION.md section "Known risks at runtime" lists the most
likely culprits in order.

## Fly.io parity

**Not yet done.** This branch wires cloudflared (home server) only. If
you want Fly.io parity, add to `utils/fly-io/dockerfile`:

- A new build stage that runs `zig build web -Dexample=voxel` (need to
  install Zig 0.15.2 in the Fly image, same trick as
  `apps/minecraft.seanmizen.com/dockerfile`).
- A new `location` block in the nginx config for
  `minecraft.seanmizen.com` pointing at an internal 5040 port.
- Port 5040 added to `utils/fly-io/docker-compose.fly.yml`.

Not in scope for this PR.
