// Where: apps/action/game/build.zig
// When: `zig build` from this directory (apps/action/build.sh runs it).
// Why: builds the action.seanmizen.com client, zig-out/bin/action.wasm. The
// game takes the swindowzig modules as a path dependency. It is web only.
const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding });

    const sw = b.dependency("swindowzig", .{ .target = target, .optimize = optimize });

    const exe = b.addExecutable(.{
        .name = "action",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            // The browser downloads it: no debug info in a release.
            .strip = optimize != .debug,
        }),
    });
    for ([_][]const u8{ "sw_app", "sw_core", "sw_gpu", "sw_math", "sw_gfx2d", "sw_text", "sw_platform", "sw_audio" }) |name| {
        exe.root_module.addImport(name, sw.module(name));
    }
    exe.rdynamic = true;
    exe.stack_size = 4 * 1024 * 1024;
    b.installArtifact(exe);

    // `zig build floorplan -- <map> <plan|section-z|section-x|audit> ...`:
    // the map slicer and audit, a native tool (src/floorplan.zig).
    const host = b.graph.host;
    const sw_host = b.dependency("swindowzig", .{ .target = host, .optimize = optimize });
    const tool = b.addExecutable(.{
        .name = "floorplan",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/floorplan.zig"),
            .target = host,
            .optimize = optimize,
        }),
    });
    tool.root_module.addImport("sw_math", sw_host.module("sw_math"));
    const run = b.addRunArtifact(tool);
    run.addPassthruArgs();
    b.step("floorplan", "Slice a map into images, or audit it").dependOn(&run.step);
}
