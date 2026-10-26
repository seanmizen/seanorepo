// Where: apps/minecraft.seanmizen.com/build.zig
// When: `zig build` from this directory (build.sh and the dockerfile run it).
// Why: builds the voxel example of the swindowzig release that build.zig.zon
// pins, and installs it to zig-out/bin:
//   app.wasm      the voxel engine
//   chunks.wasm   the chunk worker (voxel only)
// It also installs the web backend of that release (backends/wasm,
// TypeScript) to zig-out/swindowzig/backends/wasm. src/boot.ts and bundle.sh
// take the loader and the chunk worker from there. So the wasm and the
// loader come from the same swindowzig. `zig build --fork=<swindowzig
// checkout>` replaces both.
//
// A dependent package gets only the swindowzig modules. The `web` step and
// the example build settings are in the build.zig of swindowzig, and only
// its own build runs them. So this build runs `zig build web` on the
// build.zig of the package, with a cache and a prefix in this project.
//
// -Dexample=<name>: the swindowzig example. The default is voxel.
const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const example = b.option([]const u8, "example", "The swindowzig example to build. Default: voxel") orelse "voxel";

    const sw = b.dependency("swindowzig", .{});

    const web = b.addSystemCommand(&.{ b.graph.zig_exe, "build", "web" });
    web.addArg(b.fmt("-Dexample={s}", .{example}));
    web.addArg(b.fmt("-Doptimize={s}", .{@tagName(optimize)}));
    web.addArg("--build-file");
    web.addFileArg(sw.path("build.zig"));
    web.addArg("--cache-dir");
    _ = web.addOutputDirectoryArg2("cache", .{});
    web.addArg("--prefix");
    const out = web.addOutputDirectoryArg2("out", .{});
    // The nested build has its own cache. A --fork checkout can change
    // between two builds, and this step cannot see the files, so it always
    // runs. Its output directories then keep the same path, and the nested
    // cache stays between two builds.
    web.has_side_effects = true;

    b.installDirectory(.{
        .source_dir = out.path(b, "bin"),
        .install_dir = .bin,
        .install_subdir = "",
    });
    b.installDirectory(.{
        .source_dir = sw.path("backends/wasm"),
        .install_dir = .prefix,
        .install_subdir = "swindowzig/backends/wasm",
        .include_extensions = &.{".ts"},
        .exclude_extensions = &.{".test.ts"},
    });
}
