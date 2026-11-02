// Where: apps/voxel.seanmizen.com/build.zig
// When: `zig build` from this directory (build.sh and the dockerfile run it).
// Why: builds the voxel example of the swindowzig release that build.zig.zon
// names (a URL dependency) to wasm:
//   zig-out/bin/app.wasm         the game
//   zig-out/bin/chunks.wasm      the chunk worker of the Web Worker pool
//   zig-out/swindowzig-wasm/     the wasm loader of the same release
//                                (backends/wasm). bundle.sh bundles it.
// So the wasm files and the loader always come from one release.
//
// -Dexample=<name>: another example of swindowzig. The default is voxel.
const std = @import("std");
const swindowzig = @import("swindowzig");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const example = b.option([]const u8, "example", "The swindowzig example to build. Default: voxel") orelse "voxel";

    const sw = b.dependency("swindowzig", .{});
    const web = swindowzig.addWebExample(b, sw, .{ .example = example, .optimize = optimize });
    b.installArtifact(web.app);
    if (web.chunks) |chunks| b.installArtifact(chunks);
    b.installDirectory(.{
        .source_dir = sw.path("backends/wasm"),
        .install_dir = .prefix,
        .install_subdir = "swindowzig-wasm",
    });
}
