# Ordnance

A 2D logistics RTS on [swindowzig](https://github.com/seanmizen/swindowzig)
(the v0.3.0 release). The enemy holds the hill in the north. It can see the
main road, and its guns shell what it sees. You do not move units. You change
the map and set a posture for each sector. Then the units do the rest with
simple deterministic rules.

## Run it

```bash
yarn workspace ordnance start      # build the wasm, then the dev server on http://localhost:4110
yarn workspace ordnance styles     # one dev server for each playstyle, 4111 to 4116
bash apps/ordnance/build.sh        # after a change to game/: rebuild the wasm, then reload the page
yarn workspace ordnance test       # the native tests (zig build test)
```

The page needs WebGPU (a recent Chrome or Edge). The URL picks the style and
the map: `?style=fog&seed=3`.

## Playstyles

| Port | Style | The twist |
|---|---|---|
| 4111 | Supply Line | Take the objective. Red guns shell what red sees. |
| 4112 | Drone War | No guns. Red drones hunt moving trucks. Net the ways (L, 3). |
| 4113 | Blitz | Red attacks in waves. Hold the line for 12 minutes. |
| 4114 | Fog | You see red squads only where your units see. |
| 4115 | Manoeuvre | Give a sector an objective (K, 4). Squads go through dead ground. |
| 4116 | Frontier | Towns make the supply. Take towns to grow it. |

## Keys

| Key | Use |
|---|---|
| Esc, L, K, I | View, Logistics, Kill, Intel |
| Drag, wheel | Move the map, zoom (Ctrl: faster). WASD and the arrows pan too. |
| H | Heightmap |
| Hold V | The sightlines from the square under the pointer |
| Tab | The next window. Tap Alt, or Alt+letter: the menus (Alt, V, K: Keys). |
| Ctrl+D | Debug text |
| Space, -, + | Pause, speed |
| Logistics | 1 track, 2 road, 3 drone net. Click: one square. Shift+drag: a line. Right click: cancel. |
| Kill | Click a square to pick its sector. 1 push, 2 hold, 3 fall back, 4 objective here, 5 clear it. |

## The code

See `docs/ARCHITECTURE.md`: the parts, the game loop, the determinism
contract, and how agents can work on it at the same time. The preview tool
runs the game with no window:

```bash
cd apps/ordnance/game
zig build preview -- ascii seed=2
zig build preview -- trace style=blitz plan=push t=300
zig build preview -- frame out.ppm style=drone_war t=60 at=64,66,24 mode=intel
```
