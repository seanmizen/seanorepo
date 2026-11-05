# Ordnance: the architecture

Ordnance is a 2D logistics RTS in Zig on swindowzig. The browser runs it as
WebGPU wasm. This document explains how the code is cut into parts, how one
tick and one frame run, and how several agents can work on it at the same
time. The last section is my own list of what the game needs next.

## 1. The shape of the code

```
                      ┌──────────────────────────────────────┐
  browser / engine    │ src/boot.ts  (page, style, seed,     │
  (swindowzig)        │ key capture, Ctrl+wheel, numpad)     │
                      └──────────────────┬───────────────────┘
                                         │ wasm imports: jsStyle, jsSeed
                      ┌──────────────────▼───────────────────┐
                      │ main.zig  lifecycle, GPU objects,    │
                      │ engine input -> ui/input.Keys        │
                      └───┬───────────────┬──────────────┬───┘
            tick: Keys    │               │ frame        │ tick: step()
                ┌─────────▼────────┐ ┌────▼─────────┐ ┌──▼──────────────────┐
                │ ui/              │ │ render/      │ │ core/  (no engine,  │
                │  input.zig  ─────┼─┼─> Commands ──┼─┼─> sim.apply)        │
                │  wm.zig (windows,│ │  view.zig    │ │  sim.zig   state +  │
                │   menus, tabs)   │ │  layers.zig  │ │            step     │
                └────────┬─────────┘ │  panels.zig  │ │  rules.zig styles   │
                         │           │  icons.zig   │ │  sight.zig          │
                         │  draws    │  terrain.zig │ │  infantry.zig       │
                         └──────────>│  minimap.zig │ │  logistics.zig      │
                                     │  gpu.zig     │ │  artillery.zig      │
                                     └──────┬───────┘ │  drones.zig         │
                                            │ reads   │  towns.zig          │
                                            │ (const) │  route.zig          │
                                            └────────>│  map.zig mapgen.zig │
                                                      │  noise.zig          │
                                                      └─────────────────────┘
                      ┌──────────────────────────────────────┐
  native only         │ tools/preview.zig  (CPU painter: the │
                      │ same view.draw, to an image file),   │
                      │ tools/scenario.zig, tests.zig        │
                      └──────────────────────────────────────┘
```

The dependency rules:

1. `core/` imports only `core/` and `std`. It has no engine, no GPU and no
   input. So the rules run natively in the tests and in the preview tool.
2. `render/` reads the simulation through a `*const Sim`. It never writes
   game state.
3. `ui/` changes the game only through `Sim.apply(Command)`. The commands
   are the whole interface from the player to the game.
4. `style.zig` (colours and modes) imports nothing. `render/` and `ui/` share
   it, so they do not import each other in a cycle.
5. `main.zig` is the only file that imports the engine input and the GPU.
   `render/gpu.zig` is the only file that pushes vertices.

## 2. The game loop

The engine runs a fixed timestep: 30 ticks a second (`sim.tick_hz`). It calls
`tick` 30 times a second, and `render` once for each frame of the screen.

### One tick (`main.Callbacks.tick`)

1. `readKeys` copies the engine input into `ui/input.Keys` (plain data).
2. `input.State.tick`:
   - `wm.update` takes the menus, the window drags, Tab focus and the minimap
     clicks. It returns an `Action` and tells which input it used.
   - The keys that the windows did not use become mode changes, camera moves
     and `Command`s to `Sim.apply`.
   - The mouse on the map pans (drag), builds (click, Shift+drag) or picks a
     sector.
   - Hold V computes a viewshed from the square under the pointer.
3. `Sim.step` runs once, or 2 or 4 times at the higher speeds. The order is
   fixed:

| Order | Rule | When |
|---|---|---|
| 1 | `sight.step`: one observer into the next sight pass | each tick |
| 2 | `infantry.fight`, `decide`, `reinforce` | each 0.5 s |
| 3 | `infantry.redCommander` | each 10 s |
| 4 | `infantry.waves` (Blitz) | each tick |
| 5 | `towns.update` | each 5 s |
| 6 | `logistics.step`: depot, trucks, engineers | each tick |
| 7 | `Sim.move`: each unit along its path | each tick |
| 8 | `artillery.step`: red guns, blue mortars, shells land | each tick |
| 9 | `drones.step` (Drone War) | each tick |
| 10 | `checkOutcome` | each tick |

### One frame (`main.Callbacks.render`)

1. `terrain.Ways.update` makes the road and track segments again only when a
   hash of the ways and hedges changed. The minimap image follows it.
2. `view.draw` draws the layers bottom to top: map, overlays, units, effects,
   windows and menu bar, bottom bar, outcome, debug text.
3. The renderer flushes one batch. Lines and triangles go straight into the
   batch (`render/gpu.zig`), with one draw call for each run of one texture.

## 3. The determinism contract

The same seed, the same style and the same commands on the same ticks give
the same game. The rules hold to that:

- No random numbers. The map uses hashes of coordinates (`core/noise.zig`).
- Each choice breaks a tie by the lower unit id or the lower square.
- No state outside `Sim`. A cache (the Manoeuvre cost fields) lives in `Sim`.
- The renderer and the input do not write the state.

A test runs a game twice and compares a hash of the state
(`Sim.digest`). swindowzig records and replays input, so a recorded session
replays the same game.

## 4. The parts

### core/

| File | What it owns |
|---|---|
| `map.zig` | The squares (ground, way, hedges, nets) and three fine grids (height, water, wood). Line of sight (`sees`) and the viewshed. Data and queries only. |
| `mapgen.zig` | The seeded generator: heights, rivers, woods, towns, roads, hedges, and the `Setup` (front, depot, objective, posts, batteries, start squares). |
| `noise.zig` | Hash, value noise, fractal noise, ridged noise. |
| `route.zig` | Dijkstra over the squares with a cost from the caller. The roads of the generator, the trucks, the engineers and the Manoeuvre fields all use it. |
| `sim.zig` | The state, the commands, the step order, movement, the route cost (time + risk), the outcome. |
| `rules.zig` | The six playstyles as switches and numbers. |
| `sight.zig` | What each side sees, one observer a tick, and the Fog ghosts. |
| `infantry.zig` | Fire, supply use, postures, Manoeuvre routes, reinforcements, Blitz waves, the red commander. |
| `logistics.zig` | The depot, the trucks (pick the neediest squad, route by time + risk), the engineers and the jobs. |
| `artillery.zig` | Red guns (aim ahead of moving targets) and blue mortars. |
| `drones.zig` | Red drones and the nets that stop them. |
| `towns.zig` | Who holds each town square, and the town supply (Frontier). |

### render/

| File | What it owns |
|---|---|
| `view.zig` | The camera, the `Frame`, the order of the layers, the bars. It names the painter interface. |
| `layers.zig` | The map, the overlays, the units and the effects. Ground sizes are in squares. Markers are in pixels. |
| `terrain.zig` | The vector shapes of the map in chunks of 8 x 8 squares, with two levels of detail. The ways cache. |
| `icons.zig` | The unit and map icons, as geometry. |
| `panels.zig` | The content of each window. |
| `minimap.zig` | The one-pixel-a-square image. |
| `gpu.zig` | The GPU painter. |

### ui/

| File | What it owns |
|---|---|
| `wm.zig` | Windows, tabs, snapping, tiling, focus, the menu bar and its hot letters. It knows no game. |
| `input.zig` | The interface state, the camera moves, and input to commands. |

### tools/

`preview.zig` runs the game natively and prints the map (`ascii`), traces a
game (`trace`), or draws one frame to an image (`frame`). It uses the same
`view.draw` with a CPU painter, so an agent can see the screen with no
browser and no GPU.

## 5. Is it good for several agents at once?

Mostly, yes. These things help:

- **Small files, one owner each.** Each rule is its own file of 50 to 300
  lines. Two agents on `drones.zig` and `towns.zig` do not touch the same
  lines.
- **Narrow seams.** Input to game is `Command`. Game to screen is a
  `*const Sim`. The painter is six methods. The window manager knows panels
  only by an enum.
- **Headless checks.** `zig build test` runs the rules on synthetic maps, so
  a change to the generator does not break the rule tests. The preview tool
  gives a picture of the frame.
- **Style switches.** A new playstyle is a new `Rules` value plus a switch
  that one rule file reads.

These things will hurt, and I suggest fixes:

| Risk | Why it hurts | Fix |
|---|---|---|
| `Sim` is one shared struct | Each new rule adds fields to `sim.zig`, so two agents edit the same struct. | Give each rule its own state struct (`logistics.State`, `drones.State`) as one field of `Sim`. |
| The step order is in one function | Two agents that add a rule both edit `Sim.step`. | Keep it. It is 15 lines, and a clear order is worth one merge. Put new rules at the end. |
| `wm.zig` is 1,100 lines | The windows, the menus and the tests are in one file. | Split it: `windows.zig`, `menus.zig`, `wm_test.zig`. |
| Balance numbers are spread out | The speeds, damage and rates are constants in five files. | Move them all into `Rules`, so a style or a tuning pass edits one place. |
| No golden images | A render change can break the look and no test sees it. | Store preview frames of fixed seeds, and compare them with a tolerance. |
| No command log | A bug in a long game is hard to repeat. | Record the `Command`s with their tick, and add `preview replay`. |

A good split for parallel agents now: one on the generator (`mapgen.zig`),
one on the rules (`core/` except the map), one on the render (`render/`),
and one on the interface (`ui/`). Each works through the seams above.

## 6. What I would like to see next

In the order that I think gives the most:

1. **A real red logistics net.** Red trucks on red roads, with the same rules
   as blue. Then the player can cut red supply with mortars or drones, and
   the two sides are equal.
2. **Roads with diagonals and curves.** The route search makes stair-steps.
   Smooth each road (diagonal steps and a curve fit) and it reads like a
   real map.
3. **Orders with intent.** The Manoeuvre objectives are the best feel of
   "vague orders, smart troops". Make them the default: a sector gets an
   objective and an aggression, and the squads pick the route.
4. **A ledger for each truck.** The trucks are the heroes of the game. Show
   a line from each truck to its client, and a log: "Truck 4 lost at GR
   061072, road seen from the hill post".
5. **Weather and night.** Fog and night cut the sight range of the posts.
   This gives windows when the open road is safe.
6. **Sound.** A distant rumble of the guns, the crack of rifles near the
   camera, and a radio chirp when a truck is lost.
7. **A campaign map.** Each game is one 32 km sector. Win and the front moves
   on: the next map starts where this one ended.
8. **Balance tools.** A headless run of many seeds for each style, with a
   table of the outcome and the length of each game, so the tuning comes
   from numbers.
