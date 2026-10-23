// Where: apps/action/game/build.zig
// When: `zig build` from this directory (apps/action/build.sh runs it).
// Why: builds the action.seanmizen.com client, zig-out/bin/action.wasm. The
// game takes the swindowzig modules as a path dependency. It is web only.
//
// -Dbuild_version=<text>: the build version of the game (the module
// build_options). build.sh and the dockerfile give the output of
// scripts/build-version.sh. The default is "dev".
const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});
    const target = b.resolveTargetQuery(.{ .cpu_arch = .wasm32, .os_tag = .freestanding });
    const build_version = b.option([]const u8, "build_version", "The build version (scripts/build-version.sh). Default: dev") orelse "dev";
    // server/session.ts checks the same characters.
    const valid_version = build_version.len >= 1 and build_version.len <= 64 and for (build_version) |c| {
        if (!std.ascii.isAlphanumeric(c) and std.mem.indexOfScalar(u8, "._+-", c) == null) break false;
    } else true;
    if (!valid_version) {
        std.log.err("-Dbuild_version: use 1 to 64 of the characters A-Z a-z 0-9 . _ + -, not \"{s}\"", .{build_version});
        std.process.exit(1);
    }
    const exe_options = b.addOptions();
    exe_options.addOption([]const u8, "build_version", build_version);

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
    exe.root_module.addOptions("build_options", exe_options);
    exe.rdynamic = true;
    exe.stack_size = 4 * 1024 * 1024;
    b.installArtifact(exe);

    // `zig build floorplan -- <map> <plan|section-z|section-x|audit|escape> ...`:
    // the map slicer and audits, a native tool (src/floorplan.zig). The
    // escape audit flood fills millions of points, so the tool is always
    // optimised. ReleaseSafe keeps the safety checks.
    const host = b.graph.host;
    const sw_tool = b.dependency("swindowzig", .{ .target = host, .optimize = .ReleaseSafe });
    const tool = b.addExecutable(.{
        .name = "floorplan",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/floorplan.zig"),
            .target = host,
            .optimize = .ReleaseSafe,
        }),
    });
    tool.root_module.addImport("sw_math", sw_tool.module("sw_math"));
    const run = b.addRunArtifact(tool);
    run.addPassthruArgs();
    b.step("floorplan", "Slice a map into images, or audit it").dependOn(&run.step);

    // `zig build guns`: write ../server/guns.json from the gun model
    // (src/guns.zig) and print the stat tables of the README.
    const sw_host = b.dependency("swindowzig", .{ .target = host, .optimize = optimize });
    const guns_json = b.path("../server/guns.json");
    const guns_tool = b.addExecutable(.{
        .name = "guns",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/guns_tool.zig"),
            .target = host,
            .optimize = optimize,
        }),
    });
    guns_tool.root_module.addImport("sw_math", sw_host.module("sw_math"));
    const guns_run = b.addRunArtifact(guns_tool);
    guns_run.addFileArg(guns_json);
    guns_run.has_side_effects = true;
    b.step("guns", "Write server/guns.json and print the gun tables").dependOn(&guns_run.step);

    // `zig build test`: native tests (src/tests.zig): the player movement on
    // the maps, the console framework (src/console/), the session
    // (src/session/) and the gun model (src/guns_test.zig, which reads
    // ../server/guns.json).
    const tests = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/tests.zig"),
            .target = host,
            .optimize = optimize,
        }),
    });
    tests.root_module.addImport("sw_math", sw_host.module("sw_math"));
    tests.root_module.addImport("sw_core", sw_host.module("sw_core"));
    const options = b.addOptions();
    options.addOptionPath("guns_json", guns_json);
    tests.root_module.addOptions("build_options", options);
    b.step("test", "Walk the player over the stairs and escalators, test the console, the session and the gun model").dependOn(&b.addRunArtifact(tests).step);
}
