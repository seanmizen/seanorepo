# Ordnance

A 2D logistics RTS on [swindowzig](https://github.com/seanmizen/swindowzig)
(the v0.3.0 release). The enemy holds the hill in the north. It can see the
main road, and its guns shell what it sees. You do not move units. You change
the map and set a posture for each sector. Then the units do the rest with
simple deterministic rules.

## Run it

```bash
yarn workspace ordnance start      # build the wasm, then the dev server on http://localhost:4110
bash apps/ordnance/build.sh        # after a change to game/: rebuild the wasm, then reload the page
yarn workspace ordnance test       # the native tests (zig build test)
```

The page needs WebGPU (a recent Chrome or Edge).

The preview tool runs the game natively and prints or draws it:

```bash
cd apps/ordnance/game
zig build preview -- ascii                        # the map, and the squares the enemy sees
zig build preview -- trace 120 west               # the units every 10 s of a scripted game
zig build preview -- frame out.ppm 60 west intel  # one frame as an image (no text)
```

## Keys

| Key | Mode | Use |
|---|---|---|
| Esc | View | Look. WASD or the arrows pan. The wheel zooms. |
| L | Logistics | 1 track, 2 road. Drag to lay the way. A right click cancels a job. |
| K | Kill | Click a sector. Then 1 push, 2 hold, 3 fall back. |
| I | Intel | Red hatch: the squares that the enemy sees. |
| Space, -, + | All | Pause, and the speed (x1, x2, x4). |

## The rules

- **The map.** 40 x 40 squares of 250 m. Contours every 5 m. Woods, towns
  and hedges block the line of sight. The west ridge makes dead ground.
- **Infantry** reads the posture of its sector. Push: one square forward
  while supply is 40 or more. Hold: stay. Fall back: go to the home line. A
  squad with low strength or no supply falls back. The enemy uses the same
  rules, and a simple commander sets its postures.
- **Engineers** take the build jobs in the order you gave them. A track costs
  8 materials, and a road costs 20. A new track cuts the hedges to the next
  way.
- **Trucks** carry 40 supply from the depot to the squad with the least
  supply. A truck drives only on roads and tracks, and it drops the cargo
  within 2 squares of the squad. Its route cost is the time plus 12 s for
  each square that the enemy sees. The depot replaces a lost truck after 40 s.
- **Artillery.** Two enemy batteries fire every 9 s at a blue unit that the
  enemy sees. They aim where a moving truck will be when the shell lands.
- **Win:** hold the village (OBJ) for 90 s. **Lose:** no infantry, or the
  enemy reaches the depot.

## Files

- `game/src/map.zig` - the terrain, the ways, the hedges and the line of sight
- `game/src/sim.zig` - the rules
- `game/src/raster.zig` - the terrain image (CPU)
- `game/src/view.zig` - the overlays and the HUD, through a painter
- `game/src/main.zig` - the browser entry point and the input
- `game/src/preview.zig`, `scenario.zig` - the native preview tool
- `game/src/sim_test.zig` - the tests
