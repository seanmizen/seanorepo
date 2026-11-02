const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    // The modules that every target shares: layout, model, render.
    const core = b.addModule("bootmap", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    // bootmap: the headless CLI (snapshot, plan, rects, stats).
    const cli = b.addExecutable(.{
        .name = "bootmap",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/cli/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "bootmap", .module = core }},
        }),
    });
    b.installArtifact(cli);

    const run_cli = b.addRunArtifact(cli);
    run_cli.addPassthruArgs();
    b.step("cli", "Run the headless CLI").dependOn(&run_cli.step);

    // bootmap-replay: play a trace in a window (swindowzig, SDL2).
    // A lazy dependency: the CLI and the tests build with no fetch.
    const replay_step = b.step("replay", "Play a trace in a window: zig build replay -- <trace.json>");
    if (b.lazyDependency("swindowzig", .{ .target = target, .optimize = optimize, .platform = .native })) |sw| {
        const replay = b.addExecutable(.{
            .name = "bootmap-replay",
            .root_module = b.createModule(.{
                .root_source_file = b.path("src/replay/main.zig"),
                .target = target,
                .optimize = optimize,
                .imports = &.{
                    .{ .name = "bootmap", .module = core },
                    .{ .name = "sw_app", .module = sw.module("sw_app") },
                    .{ .name = "sw_gfx2d", .module = sw.module("sw_gfx2d") },
                    .{ .name = "sw_text", .module = sw.module("sw_text") },
                },
            }),
        });
        // The native libraries, as swindowzig's own examples link them on
        // Linux: SDL2 from the system, wgpu-native from ~/.local/lib.
        const home = b.graph.environ_map.get("HOME") orelse "";
        replay.root_module.link_libc = true;
        replay.root_module.link_libcpp = true; // libunwind for the Rust static library
        replay.root_module.linkSystemLibrary("SDL2", .{});
        replay.root_module.addLibraryPath(.{ .cwd_relative = b.pathJoin(&.{ home, ".local", "lib" }) });
        replay.root_module.linkSystemLibrary("wgpu_native", .{});
        const install_replay = b.addInstallArtifact(replay, .{});
        b.step("replay-build", "Build bootmap-replay").dependOn(&install_replay.step);
        const run_replay = b.addRunArtifact(replay);
        run_replay.addPassthruArgs();
        replay_step.dependOn(&run_replay.step);
    }

    // tinyinit: the static init of the kernel-only test. Always x86_64 Linux
    // with no libc, so it runs in the test initramfs on any host.
    const tinyinit = b.addExecutable(.{
        .name = "tinyinit",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/tools/tinyinit.zig"),
            .target = b.resolveTargetQuery(.{ .cpu_arch = .x86_64, .os_tag = .linux }),
            .optimize = .ReleaseSmall,
            .strip = true,
        }),
    });
    b.installArtifact(tinyinit);

    // bootmapd: the daemon. Static x86_64 Linux with no libc, so it runs
    // from the 9p share, or later from an initramfs.
    const guest = b.resolveTargetQuery(.{ .cpu_arch = .x86_64, .os_tag = .linux });
    const guest_core = b.createModule(.{
        .root_source_file = b.path("src/root.zig"),
        .target = guest,
        .optimize = .ReleaseSafe,
    });
    const daemon = b.addExecutable(.{
        .name = "bootmapd",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/daemon/main.zig"),
            .target = guest,
            .optimize = .ReleaseSafe,
            .imports = &.{.{ .name = "bootmap", .module = guest_core }},
        }),
    });
    b.installArtifact(daemon);

    const tests = b.addTest(.{ .root_module = core });
    const dbus_tests = b.addTest(.{ .root_module = b.createModule(.{
        .root_source_file = b.path("src/daemon/dbus.zig"),
        .target = target,
        .optimize = optimize,
    }) });
    b.step("test", "Run the unit tests").dependOn(&b.addRunArtifact(dbus_tests).step);
    const run_tests = b.addRunArtifact(tests);
    b.top_level_steps.get("test").?.step.dependOn(&run_tests.step);
}
