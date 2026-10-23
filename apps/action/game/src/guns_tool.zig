// Where: apps/action/game/src/guns_tool.zig (zig build guns)
// When: after a change to the gun model (guns.zig) or to the class stats
// (weapon.zig table). zig build test fails until server/guns.json is new.
// Why: writes server/guns.json, the stats that the server checks, and
// prints the stat and time-to-kill tables of the README.
//
//   zig build guns          write server/guns.json and print the tables
const std = @import("std");
const guns = @import("guns.zig");
const weapon = @import("weapon.zig");

fn ttkText(buf: []u8, t: ?f32) []const u8 {
    const v = t orelse return "-";
    if (v == 0) return "one shot";
    return std.fmt.bufPrint(buf, "{d:.2} s", .{v}) catch "?";
}

fn label(buf: []u8, i: usize) []const u8 {
    const class = guns.classOf(guns.builds[i].name).?;
    var n: u32 = 0;
    for (guns.builds[0 .. i + 1]) |b| {
        if (guns.classOf(b.name).? == class) n += 1;
    }
    return std.fmt.bufPrint(buf, "{s} {d}", .{ weapon.stats(class).label, n }) catch "?";
}

/// The calibre table, the build table and the stat table of the README.
fn printTables() void {
    std.debug.print("| Calibre | Body | Head | Pellets | Bullet | Reference barrel | Full damage to | Down to | Impulse |\n|---|---|---|---|---|---|---|---|---|\n", .{});
    for (std.enums.values(guns.Calibre)) |c| {
        const r = guns.rounds.get(c);
        std.debug.print("| {s} | {d} | x{d} | {d} | {d} m/s | {d} cm | {d} m | {d:.0}% at {d} m | {d} N s |\n", .{
            r.label, r.body, r.head, r.pellets, r.velocity, r.barrel, r.near, r.min * 100, r.far, r.impulse,
        });
    }
    std.debug.print("\n", .{});
    std.debug.print("| Gun | Model | Calibre | Barrel | Stock | Weight | Why this calibre |\n|---|---|---|---|---|---|---|\n", .{});
    for (guns.builds, 0..) |b, i| {
        var lb: [24]u8 = undefined;
        std.debug.print("| {s} | {s} | {s} | {d:.0} cm, {s} | {s} | {s}{s} | {s} |\n", .{
            label(&lb, i),      b.name,                             guns.rounds.get(b.calibre).label,
            b.barrel,           @tagName(guns.barrelClass(b)),      if (b.stock) "yes" else "no",
            @tagName(b.weight), if (b.bullpup) ", bullpup" else "", b.why,
        });
    }
    std.debug.print("\n| Gun | Body | Head | Fire | Bullet | Range | Kick up, side | Recovery | Speed | Reload | TTK 5 m | TTK 10 m | TTK 40 m |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n", .{});
    for (guns.builds, 0..) |_, i| {
        const st = &guns.table[i];
        var lb: [24]u8 = undefined;
        var t0: [16]u8 = undefined;
        var t1: [16]u8 = undefined;
        var t2: [16]u8 = undefined;
        var pel: [8]u8 = undefined;
        const p = if (st.pellets > 1) std.fmt.bufPrint(&pel, " x{d}", .{st.pellets}) catch "" else "";
        std.debug.print("| {s} | {d:.0}{s} | {d:.0}{s} | {d:.0} rpm | {d:.0} m/s{s} | {d:.0} m | {d:.1}, {d:.1} | {d:.1} | {d:.0}% | {d:.1} s | {s} | {s} | {s} |\n", .{
            label(&lb, i),                  st.body,                              p,
            st.head,                        p,                                    guns.rpm(st),
            st.velocity,                    if (st.supersonic()) "" else ", sub", guns.effectiveRange(st),
            st.kick * 1000,                 st.sway * 1000,                       st.recovery,
            st.speed * 100,                 st.reload,                            ttkText(&t0, guns.ttk(st, 5)),
            ttkText(&t1, guns.ttk(st, 10)), ttkText(&t2, guns.ttk(st, 40)),
        });
    }
}

/// The scores of a gun for the dominance list. Lower is better.
fn scores(st: *const weapon.Stats) [10]f32 {
    return .{
        guns.ttk(st, 5) orelse 99,
        guns.ttk(st, 10) orelse 99,
        guns.ttk(st, 40) orelse 99,
        guns.recoilOf(st),
        -st.speed,
        st.reload,
        st.spread + 0.5 * st.bloom,
        -guns.effectiveRange(st),
        -st.damageAt(true, 10),
        -st.damageAt(true, 40),
    };
}

/// Print each gun that another gun of its slot beats in every score: the
/// time to kill at 5 m, 10 m and 40 m, the recoil, the speed, the reload,
/// the cone, the range and the head damage at 10 m and 40 m.
fn printDominated() void {
    std.debug.print("\nDominated guns (another gun of the slot is as good or better in every score):\n", .{});
    var n: usize = 0;
    for (&guns.table, 0..) |*a, i| {
        for (&guns.table, 0..) |*b, j| {
            if (i == j or a.slot != b.slot) continue;
            const sa = scores(a);
            const sb = scores(b);
            var all = true;
            var one = false;
            for (sa, sb) |x, y| {
                if (y > x + 1e-4) all = false;
                if (y < x - 1e-4) one = true;
            }
            if (all and one) {
                var la: [24]u8 = undefined;
                var lb: [24]u8 = undefined;
                std.debug.print("  {s} is beaten by {s}\n", .{ label(&la, i), label(&lb, j) });
                n += 1;
            }
        }
    }
    if (n == 0) std.debug.print("  none\n", .{});
}

pub fn main(init: std.process.Init) !void {
    const alloc = init.arena.allocator();
    const args = try init.minimal.args.toSlice(alloc);
    if (args.len < 2) {
        std.debug.print("usage: guns_tool <server/guns.json>\n", .{});
        return error.MissingArguments;
    }
    var aw: std.Io.Writer.Allocating = .init(alloc);
    try guns.writeJson(&aw.writer);
    try std.Io.Dir.cwd().writeFile(init.io, .{ .sub_path = args[1], .data = aw.written() });
    printTables();
    printDominated();
    std.debug.print("\nwrote {s}\n", .{args[1]});
}
