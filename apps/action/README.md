# action.seanmizen.com

A first-person shooter in the browser, on swindowzig (Zig to wasm, WebGPU).

- **Deathmatch**: one lobby that is always on. A match is 5 minutes. Then the
  score board shows for 10 seconds, the scores reset, and the next match
  starts. The clock runs with or without players.
- **Target practice**: offline. 60 seconds of plates, some of them move. The
  red centre scores 150, the plate 100. The best score stays in local storage.

Controls: WASD, Space jump, mouse look, left click fire, right click aim down
the sights, R reload, Tab scores, Esc releases the mouse, M menu (paused).

## Layout

```
apps/action/
├── game/                 Zig client (its own package; swindowzig is a path dependency)
│   ├── build.zig         zig build -> zig-out/bin/action.wasm
│   └── src/
│       ├── main.zig      modes, input, shooting, deathmatch sync, HUD, wasm entry
│       ├── render.zig    shadow pass, HDR scene pass (4x MSAA), bloom, tone map
│       ├── scene.wgsl    lighting: sun + PCF shadows, SDF ambient occlusion, sky, fog
│       ├── post.wgsl     bloom and the final pass (ACES, vignette, damage tint)
│       ├── weapon.zig    rifle state, recoil, the procedural reload animation
│       ├── map.zig       the arena boxes (mesh, collision, hit scan, AO shapes)
│       ├── player.zig    movement and collision
│       ├── mesh.zig      vertex lists and shape builders
│       ├── net.zig       the WebSocket client (backends/wasm/net.ts)
│       └── assets/       rifle.bin (generated), Lato font (OFL)
├── server/index.ts       Bun: static files + the lobby on /api/ws, port 4080
├── src/boot.ts           page entry; bundled to public/boot.js
├── public/index.html
├── assets/rifle/         the source OBJ of the rifle, and its licence
└── scripts/convert-gun.ts  OBJ -> game/src/assets/rifle.bin
```

## Run it

Needs Zig (the version in `utils/swindowzig/build.zig.zon`) and Bun.

```bash
yarn workspace action start     # build.sh, then the server on http://localhost:4080
```

WebGPU only: a recent Chrome or Edge on a desktop.

## The rifle

The "AssaultRifle_1" model of the Quaternius Ultimate Gun Pack, CC0 (no
attribution necessary). See `assets/rifle/LICENSE.md`. The converter splits
the magazine from the body (its connected parts), so the reload animation can
move it: the gun cants, the magazine drops out, a new one goes in, and the
charging handle racks.

```bash
bun apps/action/scripts/convert-gun.ts          # write rifle.bin
bun apps/action/scripts/convert-gun.ts --list   # print the parts, to find the magazine of a new model
```

## The lobby protocol

JSON text on `/api/ws`. The message list is at the top of `server/index.ts`.
The client sends its own position and its hits. The server checks the fire
rate, the match phase and that both players are alive. It does not check line
of sight.

## Deploy

Port 4080 (cloudflared, `infra/edge`, `scripts/test-deployment.sh`). The DNS
record `action.seanmizen.com` is in `infra/cloudflare/seanmizen_com.tf`. Apply
it from `release`.
