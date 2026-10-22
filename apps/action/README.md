# action.seanmizen.com

A first-person shooter in the browser, on swindowzig (Zig to wasm, WebGPU).

- **Deathmatch**: one lobby that is always on. A match is 5 minutes. Then the
  score board shows for 10 seconds, the scores reset, and the next match
  starts. The clock runs with or without players.
- **Target practice**: offline. 60 seconds of plates, some of them move. The
  red centre scores 150, the plate 100. The best score stays in local storage.

Controls: WASD, Space jump, mouse look, left click fire, right click aim down
the sights, R reload, G grenade, E press a button (lifts), Tab scores, Esc
releases the mouse, M menu (paused).

Debug: Cmd+D (Ctrl+D) shows the debug screen. While it shows, 1 to 9 go to
a spawn point.

The HUD has a minimap: north up, the walls at body height over the floors at
foot height. A player who fires shows on it for a moment.

## The floorplan tool

`zig build floorplan` (in `game/`) slices a map into images and audits it:

```bash
zig build floorplan -- earls_court plan 1 out.ppm         # top view at y = 1
zig build floorplan -- earls_court section-z -22.5 out.ppm # side view at z = -22.5
zig build floorplan -- earls_court audit                  # decoration a player can walk through
sips -s format png out.ppm --out out.png                  # macOS, to view it
```

## Grenades

G throws an impact grenade. It goes off when it touches a wall, the floor or
a player. A thin smoke trail shows its path. `game/src/grenade.zig` has the
model:

- The blast radius is 5 m. The damage is 100 to 1.5 m, then it falls to 0 at
  5 m. The thrower can also get hurt.
- Cover counts. The blast checks three points on each player: the legs, the
  chest and the head. Each point that the blast can see gives a third of the
  damage at its distance.
- Deathmatch: 3 grenades in each life. Practice: no limit. A grenade knocks
  down the plates that it can see in the radius.
- With the debug screen on, a dotted line shows the path of the aimed throw.
  Small translucent cubes show where a player would get hit, for the aimed
  throw and for each grenade in the air. Red is the centre, yellow the edge.

## Maps

- **Earl's Court** (deathmatch, and the menu background): the station from
  its public layout, not from a survey. Earls Court Road with a bus and the
  TARDIS, the ticket hall, the footbridge, the District line train shed with
  its iron arch roof and a train, two lifts (E on the call buttons and the
  cab buttons), escalators that carry you, and the deep Piccadilly line
  platform. The server runs the lifts, so every player sees the same cab.
- **Arena** (target practice): an open square with cover.

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
│       ├── map.zig       the current map: boxes, decoration, lights, lifts, buttons, escalators
│       ├── maps/         arena.zig, earls_court.zig
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
of sight. For a grenade, the thrower's client calculates the damage, cover
included, and sends it in one `blast` message. The server checks the throws
left in the life, the damage range and the distance to each target.

## Deploy

Port 4080 (cloudflared, `infra/edge`, `scripts/test-deployment.sh`). The DNS
record `action.seanmizen.com` is in `infra/cloudflare/seanmizen_com.tf`. Apply
it from `release`.
