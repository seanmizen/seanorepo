// Where: apps/ordnance/game/build.zig
// When: `zig build` from this directory (apps/ordnance/build.sh runs it).
// Why: builds the game, zig-out/bin/ordnance.wasm. The game takes the
// swindowzig modules from the swindowzig release that build.zig.zon names.
// It is web only. The install step also copies the wasm loader of the same
// release (backends/wasm) to zig-out/swindowzig-wasm/, so the loader and the
// game come from one release.
//
// `zig build test`: the native tests (src/tests.zig).
// `zig build preview -- <command>`: the native preview tool (src/preview.zig).
const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding });
    const sw = b.dependency("swindowzig", .{ .target = target, .optimize = optimize });

    const exe = b.addExecutable(.{
        .name = "ordnance",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .strip = optimize != .debug,
        }),
    });
    for ([_][]const u8{ "sw_app", "sw_gfx2d", "sw_text" }) |name| {
        exe.root_module.addImport(name, sw.module(name));
    }
    exe.rdynamic = true;
    exe.stack_size = 4 * 1024 * 1024;
    b.installArtifact(exe);
    b.installDirectory(.{
        .source_dir = sw.path("backends/wasm"),
        .install_dir = .prefix,
        .install_subdir = "swindowzig-wasm",
    });

    const host = b.graph.host;
    const tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/tests.zig"),
            .target = host,
            .optimize = .ReleaseSafe,
        }),
    });
    b.step("test", "Run the native tests: sight, determinism and the supply loop").dependOn(&b.addRunArtifact(tests).step);

    const preview = b.addExecutable(.{
        .name = "preview",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/preview.zig"),
            .target = host,
            .optimize = .ReleaseSafe,
        }),
    });
    const run = b.addRunArtifact(preview);
    run.addPassthruArgs();
    b.step("preview", "Print the map, or draw one frame to an image file").dependOn(&run.step);
}
