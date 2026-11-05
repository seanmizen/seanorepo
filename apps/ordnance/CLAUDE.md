# CLAUDE.md: apps/ordnance

Ordnance: a 2D logistics RTS in Zig (wasm, WebGPU) on swindowzig v0.3.0.
Read `docs/ARCHITECTURE.md` before a change that crosses a folder.

## Commands

```bash
yarn workspace ordnance start    # build the wasm, dev server on 4110
yarn workspace ordnance styles   # one dev server per playstyle, 4111-4116
bash apps/ordnance/build.sh      # rebuild the wasm, then reload the page
cd apps/ordnance/game && zig build test
cd apps/ordnance/game && zig build preview -- frame out.ppm style=fog t=60 at=64,66,24
```

## Rules

- `core/` imports only `core/` and `std`. No engine, no GPU, no input.
- `render/` reads `*const Sim`. It never writes game state.
- `ui/` changes the game only through `Sim.apply(Command)`.
- The rules are deterministic: no random numbers, ties go to the lower id or
  square, and no state outside `Sim`.
- A new rule gets its own file in `core/` and a switch in `rules.zig`. Add
  its call at the end of `Sim.step`.
- A rule test builds its own small world on `Map.flat`. It does not depend on
  what the generator makes.
- Before you finish: `zig build test`, `bash build.sh` (the wasm compiles),
  `yarn tsc --noEmit` here, and `yarn fix` from the root.
- Look at a render change with the preview tool. The CPU painter draws no
  text.
