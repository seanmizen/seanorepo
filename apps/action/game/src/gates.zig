// The ticket gates of Earl's Court: two gate lines, each with IN lanes
// and OUT lanes, paddle doors and an Oyster reader on each lane.
//
// - A gate line goes across a hall. Screens close it from the gates to the
//   walls, so the only way through is a lane.
// - Half of the lanes are IN (from the street into the station), half are
//   OUT. Seen from the street, the right half is IN. Each lane has a green
//   light at the end where you can go in, and a red light at the other end.
// - The paddles of a lane are closed. They meet in the middle at an angle,
//   in a herringbone. Aim at the yellow reader from the entry side and press
//   F (TAP OYSTER): the paddles open for some seconds. From the wrong side
//   the reader shows red and the paddles stay closed.
// - A tap IN starts a journey: "-£0.01 (amount pending)". 60 to 240 s later
//   the fare comes: -£3.10, the Zone 1 pay-as-you-go peak single. If the
//   player tapped OUT before that, the message is a refund.
// - A player who crosses the gate line by any other way than an open lane
//   (a vault, a jump over the screens) is a fare dodger. main.zig kills the
//   player 2 s later: "Guilt".
// - The paddles are local to each client.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

/// The fare in pence: a Zone 1 pay-as-you-go peak single (TfL, from
/// March 2026).
pub const fare_pence = 310;
pub const pending_pence = 1;
/// The fare message comes this many seconds after the tap in.
pub const fare_delay = [2]f32{ 60, 240 };

const max_lines = 2;
const max_lanes = 16;
/// The sizes of a gate: the cabinet (x along the walk, z across), the lane.
pub const cab_len: f32 = 1.2;
pub const cab_w: f32 = 0.3;
pub const cab_h: f32 = 1.05;
pub const lane_w: f32 = 0.8;
const paddle_y = [2]f32{ 0.3, 1.15 };
/// The paddles stay open this long after a tap, and close this long after
/// the player goes through.
const open_time: f32 = 4;
const close_after: f32 = 0.8;
/// How far from the reader F reaches.
pub const reach: f32 = 2.2;

const steel = v3(0.55, 0.56, 0.58);
const top_c = v3(0.12, 0.12, 0.13);
const paddle_c = v3(0.7, 0.08, 0.06);
const reader_c = v3(0.95, 0.75, 0.05);

pub const Line = struct {
    /// The plane of the paddles, the floor, and the hall from wall to wall.
    x: f32,
    y: f32,
    z0: f32,
    z1: f32,
    /// The walk of a player who goes in: -1 (to -X) or 1.
    in_dir: f32,
};

pub const Lane = struct {
    line: usize,
    z0: f32,
    z1: f32,
    /// The walk direction through this lane: in_dir for IN, -in_dir for OUT.
    dir: f32,
    in: bool,
    /// The collision box of the closed paddles (dynamic, not drawn).
    box: usize,
    /// The time the paddles stay open; the open amount (0 to 1).
    open_t: f32 = 0,
    open: f32 = 0,
    /// The reader flash: > 0 green, < 0 red.
    flash: f32 = 0,
};

pub var lines: [max_lines]Line = undefined;
pub var line_n: usize = 0;
pub var lanes: [max_lanes]Lane = undefined;
pub var lane_n: usize = 0;

/// The journey of the player: tapped in, tapped out, and the time to the
/// fare message.
pub const Journey = struct { active: bool = false, out: bool = false, t: f32 = 0 };
pub var journey: Journey = .{};

/// A message near the crosshair, like the damage numbers.
pub const Pop = struct { text: [40]u8, len: usize, age: f32, good: bool };
pub const pop_life: f32 = 3.5;
pub var pops: [4]Pop = undefined;
pub var pop_n: usize = 0;

/// The map has no gates (map.load calls it before the build).
pub fn clear() void {
    line_n = 0;
    lane_n = 0;
}

/// A gate line across a hall at x, from wall z0 to wall z1, with `n` lanes
/// about z = mid. The screens close the rest. `in_dir`: the walk of a
/// player who goes in.
pub fn addLine(x: f32, y: f32, z0: f32, z1: f32, mid: f32, n: usize, in_dir: f32) void {
    if (line_n == max_lines or lane_n + n > max_lanes) return;
    const li = line_n;
    lines[li] = .{ .x = x, .y = y, .z0 = z0, .z1 = z1, .in_dir = in_dir };
    line_n += 1;
    const nf: f32 = @floatFromInt(n);
    const width = nf * lane_w + (nf + 1) * cab_w;
    const za = mid - width / 2;
    const zb = mid + width / 2;
    const x0 = x - cab_len / 2;
    const x1 = x + cab_len / 2;
    // The screens: steel up to the cabinets, glass over them.
    for ([_][2]f32{ .{ z0, za }, .{ zb, z1 } }) |s| {
        map.add(v3(x - 0.05, y, s[0]), v3(x + 0.05, y + 1.1, s[1]), steel, .metal, .sheet_metal).ao = false;
        map.addDecor(Mat4.identity(), v3(x - 0.02, y + 1.1, s[0]), v3(x + 0.02, y + 1.8, s[1]), v3(0.35, 0.45, 0.5), .metal, .glass);
    }
    // The cabinets.
    for (0..n + 1) |i| {
        const cz = za + @as(f32, @floatFromInt(i)) * (lane_w + cab_w);
        map.add(v3(x0, y, cz), v3(x1, y + cab_h, cz + cab_w), steel, .metal, .sheet_metal).ao = false;
        map.addDecor(Mat4.identity(), v3(x0, y + cab_h, cz), v3(x1, y + cab_h + 0.02, cz + cab_w), top_c, .paint, .sheet_metal);
    }
    // The lanes: the right half for a player who goes in is IN. The right
    // of a walk along +X is +Z.
    for (0..n) |i| {
        const lz0 = za + cab_w + @as(f32, @floatFromInt(i)) * (lane_w + cab_w);
        const lz1 = lz0 + lane_w;
        const right_half = if (in_dir > 0) (lz0 + lz1) / 2 > mid else (lz0 + lz1) / 2 < mid;
        const dir = if (right_half) in_dir else -in_dir;
        const b = map.add(v3(x - 0.08, y + paddle_y[0], lz0), v3(x + 0.08, y + paddle_y[1], lz1), paddle_c, .paint, .sheet_metal);
        b.dynamic = true;
        b.visible = false;
        b.ao = false;
        const box = map.indexOf(b) orelse continue;
        lanes[lane_n] = .{ .line = li, .z0 = lz0, .z1 = lz1, .dir = dir, .in = right_half, .box = box };
        // The lights on the lane side of the reader cabinet: green at the
        // entry end, red at the exit end.
        const rz = readerZ(lanes[lane_n]);
        for ([_]f32{ -1, 1 }) |end| {
            const ex = x + end * cab_len / 2;
            const entry = end == -dir;
            const col = if (entry) v3(0.1, 1.0, 0.25) else v3(1.0, 0.08, 0.05);
            const out: f32 = end * 0.012;
            map.addDecor(Mat4.identity(), v3(@min(ex, ex + out), y + 0.7, rz - 0.06), v3(@max(ex, ex + out), y + 0.85, rz + 0.06), col, .emissive, .glass);
        }
        lane_n += 1;
    }
}

/// The z of the reader of a lane: on the cabinet at the right hand of a
/// player who goes through (the right of a walk along +X is +Z).
fn readerZ(l: Lane) f32 {
    return if (l.dir > 0) l.z1 + cab_w / 2 else l.z0 - cab_w / 2;
}

/// The centre of the reader: on the cabinet top, at the entry end.
pub fn readerPos(i: usize) V3 {
    const l = lanes[i];
    const ln = lines[l.line];
    return v3(ln.x - l.dir * (cab_len / 2 - 0.2), ln.y + cab_h + 0.06, readerZ(l));
}

/// The reader under a ray, within reach.
pub fn pick(o: V3, d: V3) ?usize {
    var best: ?usize = null;
    var best_t = reach;
    for (lanes[0..lane_n], 0..) |_, i| {
        const c = readerPos(i);
        if (map.rayBox(o, d, c - v3(0.14, 0.1, 0.14), c + v3(0.14, 0.1, 0.14))) |h| {
            if (h.t < best_t) {
                best_t = h.t;
                best = i;
            }
        }
    }
    return best;
}

pub const Tap = enum { tapped_in, tapped_out, wrong_side };

/// Tap the reader of lane i from `feet`. From the entry side the paddles
/// open: IN starts a journey, OUT ends one.
pub fn tap(i: usize, feet: V3) Tap {
    const l = &lanes[i];
    const ln = lines[l.line];
    if ((feet[0] - ln.x) * l.dir > 0) {
        l.flash = -0.8;
        return .wrong_side;
    }
    l.flash = 0.8;
    l.open_t = open_time;
    if (l.in) {
        journey = .{ .active = true, .t = fare_delay[0] + (fare_delay[1] - fare_delay[0]) * rand() };
        pop("-£0.01 (amount pending)", false);
        return .tapped_in;
    }
    if (journey.active) journey.out = true;
    return .tapped_out;
}

var prng: std.Random.DefaultPrng = .init(11);
fn rand() f32 {
    return prng.random().float(f32);
}

pub fn seed(s: u64) void {
    prng = .init(s);
}

fn pop(s: []const u8, good: bool) void {
    if (pop_n == pops.len) {
        for (1..pop_n) |k| pops[k - 1] = pops[k];
        pop_n -= 1;
    }
    var p: Pop = .{ .text = undefined, .len = @min(s.len, 40), .age = 0, .good = good };
    @memcpy(p.text[0..p.len], s[0..p.len]);
    pops[pop_n] = p;
    pop_n += 1;
}

fn penceText(buf: []u8, sign: []const u8, p: u32) []const u8 {
    return std.fmt.bufPrint(buf, "{s}£{d}.{d:0>2}", .{ sign, p / 100, p % 100 }) catch "";
}

/// What the gate line did to the player in one step.
pub const Cross = enum { none, through, dodged };

/// Step the paddles and the journey. `before` and `feet` are the feet of
/// the player at the start and at the end of the tick, or null when the
/// player is not in play. Returns `dodged` when the player crossed a gate
/// line by any other way than an open lane.
pub fn step(dt: f32, before: ?V3, feet: ?V3, player_r: f32, player_h: f32) Cross {
    var out: Cross = .none;
    if (before != null and feet != null) out = crossing(before.?, feet.?);
    for (lanes[0..lane_n]) |*l| {
        l.flash = if (l.flash > 0) @max(0, l.flash - dt) else @min(0, l.flash + dt);
        l.open_t = @max(0, l.open_t - dt);
        const want: f32 = if (l.open_t > 0) 1 else 0;
        // The paddles do not close on a player in the lane.
        const b = &map.boxes[l.box];
        if (want == 0 and l.open > 0 and feet != null) {
            const f = feet.?;
            const inside = f[0] + player_r > b.min[0] - 0.3 and f[0] - player_r < b.max[0] + 0.3 and
                f[2] + player_r > b.min[2] and f[2] - player_r < b.max[2] and
                f[1] < b.max[1] and f[1] + player_h > b.min[1];
            if (inside) l.open_t = 0.2;
        }
        l.open += std.math.clamp(want - l.open, -dt * 3, dt * 3);
        b.solid = l.open < 0.5 and l.open_t <= 0;
    }
    if (journey.active) {
        journey.t -= dt;
        if (journey.t <= 0) {
            var buf: [40]u8 = undefined;
            if (journey.out) {
                var num: [16]u8 = undefined;
                pop(std.fmt.bufPrint(&buf, "REFUND {s}", .{penceText(&num, "+", pending_pence)}) catch "REFUND", true);
            } else pop(penceText(&buf, "-", fare_pence), false);
            journey = .{};
        }
    }
    for (pops[0..pop_n]) |*p| p.age += dt;
    while (pop_n > 0 and pops[0].age > pop_life) {
        for (1..pop_n) |k| pops[k - 1] = pops[k];
        pop_n -= 1;
    }
    return out;
}

/// The feet went from a to b: across a gate line, through an open lane or
/// not.
fn crossing(a: V3, b: V3) Cross {
    for (lines[0..line_n], 0..) |ln, li| {
        if ((a[0] - ln.x) * (b[0] - ln.x) > 0) continue;
        if (a[0] == b[0]) continue;
        const k = (ln.x - a[0]) / (b[0] - a[0]);
        const z = a[2] + (b[2] - a[2]) * k;
        const y = a[1] + (b[1] - a[1]) * k;
        if (z < ln.z0 or z > ln.z1 or y < ln.y - 0.5 or y > ln.y + 3) continue;
        for (lanes[0..lane_n]) |*l| {
            if (l.line != li or z < l.z0 or z > l.z1) continue;
            // Through an open lane, on the floor: the paddles close soon.
            if (l.open > 0.3 and y < ln.y + 0.3) {
                l.open_t = @min(l.open_t, close_after);
                return .through;
            }
        }
        return .dodged;
    }
    return .none;
}

/// True when p (feet) is on a gate line: on a cabinet, the paddles or a
/// screen. A vault onto one is a fare dodge.
pub fn onGates(p: V3) bool {
    for (lines[0..line_n]) |ln| {
        if (@abs(p[0] - ln.x) < cab_len / 2 + 0.1 and p[2] > ln.z0 and p[2] < ln.z1 and p[1] > ln.y + 0.3 and p[1] < ln.y + 2) return true;
    }
    return false;
}

/// The paddles and the readers.
pub fn build(dyn: *mesh.Mesh) void {
    for (lanes[0..lane_n], 0..) |l, i| {
        const ln = lines[l.line];
        // Each paddle swings about its cabinet edge. Closed, the tips lean
        // 25 degrees to the exit side; open, they fold back to the cabinet.
        const ease = vec.smooth(l.open);
        const half = lane_w / 2 - 0.02;
        for ([_]f32{ -1, 1 }) |side| {
            const hz = if (side < 0) l.z0 else l.z1;
            const ang = (0.44 + ease * 1.05) * l.dir;
            // A paddle at the -Z edge points to +Z, and the other to -Z.
            const turn = if (side < 0) ang else -ang;
            const m = vec.translate(v3(ln.x, ln.y, hz)).mul(Mat4.rotationY(turn));
            const zmin = if (side < 0) @as(f32, 0) else -half;
            const zmax = if (side < 0) half else @as(f32, 0);
            dyn.orientedBox(m, v3(-0.015, paddle_y[0], zmin), v3(0.015, paddle_y[1], zmax), paddle_c, 0);
            dyn.orientedBox(m, v3(-0.018, paddle_y[1] - 0.12, zmin), v3(0.018, paddle_y[1] - 0.05, zmax), v3(0.9, 0.9, 0.88), 0);
        }
        // The reader: a yellow pad, green after a tap, red from the wrong
        // side.
        const c = readerPos(i);
        const col = if (l.flash > 0) v3(0.1, 1.0, 0.3) else if (l.flash < 0) v3(1.0, 0.1, 0.05) else reader_c;
        dyn.box(c - v3(0.12, 0.06, 0.12), c + v3(0.12, 0.0, 0.12), v3(0.15, 0.15, 0.16), 3);
        dyn.disc(vec.translate(c).mul(Mat4.rotationX(-std.math.pi / 2.0)), 0.1, 0.02, col, if (l.flash != 0) 4 else 0);
    }
}
