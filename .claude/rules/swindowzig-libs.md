---
paths:
  - "utils/swindowzig/libs/**"
  - "utils/swindowzig/backends/**"
---

# swindowzig libraries

Read with `utils/swindowzig/CLAUDE.md`.

## Critical Lessons

### extern struct initialization (CRITICAL)
Always `std.mem.zeroes()` for extern structs passed to C APIs — aggregate init
does NOT apply default field values:
```zig
// WRONG — padding and optional fields are undefined
const desc = WGPUFooDescriptor{ .field = value };

// CORRECT
var desc = std.mem.zeroes(WGPUFooDescriptor);
desc.field = value;
```

### IndexFormat enum mismatch (fixed in gpu.zig)
`types.IndexFormat` starts at 0, but native `WGPUIndexFormat` has `undefined=0`,
`uint16=1`, `uint32=2`. The `setIndexBuffer` wrapper now uses an explicit switch
to map correctly. Do not use raw `@intFromEnum` for this conversion.

### TextureViewDimension enum mismatch (fixed in gpu.zig — createBindGroupLayout)
`types.TextureViewDimension` starts at 0 (`@"1d"=0, @"2d"=1`), but native
`WGPUTextureViewDimension` has `undefined=0, 1d=1, 2d=2`. Raw `@intFromEnum`
would map `.@"2d"→1` which is `WGPUTextureViewDimension.1d` — wrong, crashes
with "Texture binding N expects dimension = D1, but given a view with dimension = D2".
`createBindGroupLayout` now uses explicit switch maps for both `.texture.view_dimension`
and `.storage_texture.view_dimension`. Do not use raw `@intFromEnum` for these.

### CompareFunction enum mismatch (fixed in gpu.zig — createRenderPipeline)
`types.CompareFunction` starts at 0 (`never=0, less=1, …, always=7`), but native
`WGPUCompareFunction` has `undefined=0, never=1, less=2, …, always=8`. Additionally,
the order of `equal`, `not_equal`, and `greater_equal` differs between the two enums.
Raw `@intFromEnum` would map `.less→1 = never` — silently making the depth test always
reject every fragment (blank sky-only output). `createRenderPipeline` now uses
`toNativeCompareFunction()`, an explicit named switch, for all three CompareFunction
fields (depth_compare, stencil_front.compare, stencil_back.compare).
Do not use raw `@intFromEnum` for CompareFunction conversions.

### Hardware depth testing (macOS/Metal)
Hardware depth testing is **enabled** in the voxel pipeline (`depth24plus`,
`depth_write_enabled = true`, `depth_compare = .less`). The Metal crash
(`wgpuDeviceCreateRenderPipeline` bus error at 0x29) was a wgpu-native v0.19.4.1
bug and is fixed in the current pinned version (v22.1.0.5).

The depth texture `sample_count` must match the MSAA sample count of the colour
attachment — otherwise wgpu-native raises a validation error on render-pass begin.

`sortByDepth()` in `examples/voxel/mesher.zig` is **kept for performance** (reduces
GPU overdraw, especially on painter's-algorithm-sorted transparent-ish geometry) but
is no longer required for correctness. Sort key is view-space depth
(dot product with camera forward) rather than 3D Euclidean distance.

### WebGPU C ABI details

- A C `size_t` field maps to `usize` in Zig, never `u32`: `entry_count`,
  `bind_group_layout_count`, `constant_count`, `required_features_count`,
  `dynamic_offset_count`, `command_count`.
- Set `WGPURenderPassColorAttachment.depth_slice` to `0xFFFFFFFF`
  (`WGPU_DEPTH_SLICE_UNDEFINED`).
- Timestamps: `WGPURenderPassTimestampWrites` and
  `WGPUComputePassTimestampWrites` take `beginning_of_pass_write_index` and
  `end_of_pass_write_index`.

### Context and events

- Get the event bus with `ctx.bus()`. There is no `ctx.eventBus()`.
- Use `const` for an ArrayList result that does not change.
- Make an event with `Event.init(tick_id, t_ns, seq, payload)`. Payload shapes:

```zig
.key = .{ .keycode = key, .scancode = 0, .down = true, .repeat = false, .mods = mods }
.pointer_move = .{ .x = 0, .y = 0, .dx = dx, .dy = dy, .device_id = 0, .mods = mods }
.pointer_button = .{ .button = btn, .down = true, .mods = mods }
```

### Known issue

The replay buffer cleanup leaks memory. It is not critical. (Recorded in an
earlier session and not checked again since.)

---

## Adding New WebGPU Features

1. Check wgpu-native headers: `~/.local/include/webgpu/webgpu.h`
2. Add C binding to `native_webgpu.zig`
3. Add Zig wrapper in `gpu.zig`
4. Add corresponding web path in `web_bridge.zig`
5. Release anything you create (wgpu uses reference counting)

---

## File Map

Key files and what they do — read this before opening anything.

### Core libraries (`libs/`)

| File | Purpose |
|------|---------|
| `libs/sw_app/src/app.zig` | `sw.run()` entry point, owns the main loop |
| `libs/sw_app/src/context.zig` | `Context` passed to every callback, holds allocator, bus, tick info |
| `libs/sw_core/src/event.zig` | `Event` union — all input/system event variants |
| `libs/sw_core/src/bus.zig` | Event bus: push/subscribe per tick |
| `libs/sw_core/src/input.zig` | Keyboard/mouse snapshot, edge detection |
| `libs/sw_core/src/record.zig` | Record events to a TAS file |
| `libs/sw_core/src/replay.zig` | Replay events from a TAS file |
| `libs/sw_core/src/tas.zig` | TAS file format (parse/write) |
| `libs/sw_gpu/src/gpu.zig` | Main GPU API — `GPU` struct, all `create*` / `begin*` / `submit` methods |
| `libs/sw_gpu/src/native_webgpu.zig` | Raw C bindings for wgpu-native (`WGPUFoo` types) |
| `libs/sw_gpu/src/types.zig` | Shared descriptor types used by both native and WASM paths |
| `libs/sw_gpu/src/web_bridge.zig` | WASM/JS extern bindings |
| `libs/sw_platform/src/native_sdl.zig` | SDL2 window + event pump (native path) |
| `libs/sw_math/src/mat4.zig` | 4×4 matrix: `perspective()`, `lookAt()`, multiply |
| `libs/sw_math/src/vec3.zig` | Vec3 ops |
