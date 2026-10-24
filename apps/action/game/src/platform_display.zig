// The dot-matrix train indicators over the platforms, as on the Tube: amber
// LEDs on a black face, three lines of text.
//
//   1 Heathrow T5          2 mins
//   2 Heathrow T5          3 mins
//            17:42:10
//
// - A map adds one Platform for each platform face (add). The boards hang
//   from the ceiling over the platform at the x positions of the platform,
//   double-sided, their faces toward +X and -X (along the platform). The
//   casing and the hangers are decorations. The LEDs are dynamic: build
//   draws them each frame.
// - The text comes from the trains of the map (status): the deep train
//   (map.train) gives the countdown, TRAIN APPROACHING while it brakes in,
//   no time while it stands, "Mind the closing doors" from the door
//   warning. The parked train (map.parked_train) is held. A platform with
//   no train says so. All clients have the same deep train clock (the
//   server), so the boards agree in deathmatch.
// - The third line shows the local time of day (main.zig jsLocalSeconds).
// - A text longer than the board scrolls from right to left.
// - scene.wgsl material 9 (map.Mat.led) draws the round LEDs: each quad is
//   a run of lit LEDs in one row, on the `pitch` grid of world Z and Y.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The LED grid. scene.wgsl LED_PITCH has the same pitch.
pub const cols = 162;
pub const rows = 27;
pub const pitch: f32 = 0.012;
/// The board face: 1.94 m by 0.32 m.
pub const width: f32 = cols * pitch;
pub const height: f32 = rows * pitch;
/// The bottom of the LED face above the platform floor.
const bottom_h: f32 = 2.6;
/// A character is 5 by 7 LEDs, with one column between characters.
const advance = 6;
/// The first column of the text, and the column after the last.
const margin = 2;
const text_cols = cols - 2 * margin;
pub const line_chars = (text_cols + 1) / advance;
/// The scroll speed of a long text, in LEDs per second.
const scroll_speed: f32 = 32;

pub const Service = enum {
    /// The deep train of the map (map.train): on its timetable.
    deep_train,
    /// The parked train of the map (map.parked_train): it stays.
    parked_train,
    /// No train stops here.
    none,
};

pub const Platform = struct {
    number: u8,
    /// The destination of the trains, at most 16 characters.
    dest: []const u8,
    service: Service,
    /// The centre of the boards across the platform, on Z.
    board_z: f32,
    floor_y: f32,
    /// The underside of the ceiling or the roof: the hangers go up to it.
    hang_y: f32,
    /// The boards along the platform, on X.
    xs: [2]f32,
};

pub const max_platforms = 8;
pub var platforms: [max_platforms]Platform = undefined;
pub var platform_count: usize = 0;

/// A new map: no platforms (map.zig clear).
pub fn clear() void {
    platform_count = 0;
}

/// Add a platform and the casing and hangers of its boards.
pub fn add(p: Platform) void {
    if (platform_count >= max_platforms) return;
    platforms[platform_count] = p;
    platform_count += 1;
    const casing = v3(0.03, 0.03, 0.035);
    for (p.xs) |x| {
        const o = origin(p);
        const z0 = o[0];
        const y0 = o[1];
        map.addDecor(vec.Mat4.identity(), v3(x - 0.06, y0 - 0.05, z0 - 0.05), v3(x + 0.06, y0 + height + 0.05, z0 + width + 0.05), casing, .metal, .sheet_metal);
        for ([_]f32{ z0 + 0.2, z0 + width - 0.2 }) |hz| {
            map.addDecor(vec.Mat4.identity(), v3(x - 0.015, y0 + height + 0.05, hz - 0.015), v3(x + 0.015, p.hang_y, hz + 0.015), casing, .metal, .metal);
        }
    }
}

/// The corner of the LED face with the least Z and Y: on the LED grid, so
/// the quads of build fall on the round LEDs of the shader.
fn origin(p: Platform) [2]f32 {
    return .{
        @round((p.board_z - width / 2) / pitch) * pitch,
        @round((p.floor_y + bottom_h) / pitch) * pitch,
    };
}

// ---- The text ------------------------------------------------------------------

pub const Status = union(enum) {
    /// No train: the platform is closed.
    closed,
    /// A train stands at the platform and does not go.
    held,
    /// The deep train, `t` seconds into its cycle (map.Train t).
    timed: f32,
};

/// The deep train timetable (map.zig): the times in its cycle.
pub const Timetable = struct {
    cycle: f32,
    brake_in: f32,
    stop: f32,
    depart: f32,
    /// The door warning: the beeps start.
    warn: f32,
};

pub fn timetable() Timetable {
    return .{
        .cycle = map.train_cycle,
        .brake_in = map.train_brake_in,
        .stop = map.train_stop,
        .depart = map.train_depart,
        // map.train_doors_warn comes with the door timing of the trains.
        // Until then: 6 s before the train pulls out.
        .warn = if (@hasDecl(map, "train_doors_warn")) map.train_doors_warn else map.train_depart - 6,
    };
}

pub const Text = struct {
    buf: [48]u8 = undefined,
    len: usize = 0,

    pub fn str(self: *const Text) []const u8 {
        return self.buf[0..self.len];
    }

    fn set(self: *Text, comptime fmt: []const u8, args: anytype) void {
        self.len = if (std.fmt.bufPrint(&self.buf, fmt, args)) |out| out.len else |_| self.buf.len;
    }
};

pub const Line = struct {
    left: Text = .{},
    /// Right-aligned (the minutes). Empty: none.
    right: Text = .{},
    /// Centre the left text.
    centre: bool = false,
};

/// The minutes to a train `a` seconds away, as the boards show them.
pub fn minutes(out: *Text, a: f32) void {
    const m: u32 = @intFromFloat(@max(0, @round(a / 60)));
    if (m == 0) out.set("due", .{}) else if (m == 1) out.set("1 min", .{}) else out.set("{d} mins", .{m});
}

/// The three lines of a board. `clock`: the local time of day in seconds.
pub fn lines(p: Platform, st: Status, tt: Timetable, clock: f32) [3]Line {
    var l: [3]Line = .{ .{}, .{}, .{} };
    switch (st) {
        .closed => {
            l[0].left.set("Platform closed", .{});
            l[0].centre = true;
            l[1].left.set("No trains on this platform", .{});
            l[1].centre = true;
        },
        .held => {
            l[0].left.set("1 {s}", .{p.dest});
            l[1].left.set("This train is being held", .{});
        },
        .timed => |t| {
            const in = t >= tt.stop and t < tt.depart;
            // The seconds to the next train that is not at the platform.
            const a = if (t < tt.stop) tt.stop - t else tt.stop + tt.cycle - t;
            l[0].left.set("1 {s}", .{p.dest});
            if (!in) minutes(&l[0].right, a);
            l[1].left.set("2 {s}", .{p.dest});
            minutes(&l[1].right, if (in) a else a + tt.cycle);
            if (t >= tt.brake_in and t < tt.stop) {
                l[2].left.set("*** STAND BACK - TRAIN APPROACHING ***", .{});
                l[2].centre = true;
                return l;
            }
            if (in and t >= tt.warn) {
                l[2].left.set("Mind the closing doors", .{});
                l[2].centre = true;
                return l;
            }
        },
    }
    const s: u32 = @intFromFloat(@mod(@floor(clock), 86400));
    l[2].left.set("{d:0>2}:{d:0>2}:{d:0>2}", .{ s / 3600, s / 60 % 60, s % 60 });
    l[2].centre = true;
    return l;
}

/// The status of a platform from the trains of the map.
pub fn status(p: Platform) Status {
    return switch (p.service) {
        .deep_train => if (map.train) |tr| .{ .timed = tr.t } else .closed,
        .parked_train => if (map.parked_train != null) .held else .closed,
        .none => .closed,
    };
}

// ---- The LEDs ------------------------------------------------------------------

/// The lit LEDs of a board, row 0 at the top, column 0 at the left.
pub const Frame = [rows][cols]bool;

/// The top row of each line.
const line_row = [3]usize{ 1, 10, 19 };

/// Draw the lines into a frame. `time`: seconds, for the scroll.
pub fn render(l: [3]Line, time: f32) Frame {
    var f: Frame = @splat(@splat(false));
    for (l, line_row) |ln, r0| {
        const text = ln.left.str();
        const w: i32 = @intCast(text.len * advance);
        var c0: i32 = margin;
        if (w - 1 > text_cols) {
            // Too long: it scrolls in from the right edge and out at the left.
            const span: f32 = @floatFromInt(w + text_cols);
            c0 = margin + text_cols - @as(i32, @intFromFloat(@mod(time * scroll_speed, span)));
        } else if (ln.centre) {
            c0 = margin + @divFloor(text_cols - (w - 1), 2);
        }
        drawText(&f, text, r0, c0);
        const right = ln.right.str();
        if (right.len > 0) drawText(&f, right, r0, margin + text_cols - @as(i32, @intCast(right.len * advance)) + 1);
    }
    return f;
}

fn drawText(f: *Frame, text: []const u8, r0: usize, c0: i32) void {
    var c = c0;
    for (text) |ch| {
        const g = glyph(ch);
        for (g, 0..) |bits, r| {
            for (0..5) |k| {
                if (bits & (@as(u5, 0b10000) >> @intCast(k)) == 0) continue;
                const col = c + @as(i32, @intCast(k));
                if (col < margin or col >= margin + text_cols) continue;
                f[r0 + r][@intCast(col)] = true;
            }
        }
        c += advance;
    }
}

/// Draw the LEDs of the boards near the eye: the faces toward the eye.
/// `time`: seconds (the scroll). `clock`: the local time of day.
pub fn build(dyn: *mesh.Mesh, eye: V3, time: f32, clock: f32) void {
    const lit = v3(1.0, 0.5, 0.0) * vec.s(0.5);
    const unlit = v3(0.05, 0.025, 0.0) * vec.s(0.25);
    const tt = timetable();
    for (platforms[0..platform_count]) |p| {
        if (@abs(eye[1] - p.floor_y - 1.6) > 7) continue;
        const o = origin(p);
        var frame: ?Frame = null;
        for (p.xs) |x| {
            const d = eye - v3(x, o[1], p.board_z);
            if (@reduce(.Add, d * d) > 70 * 70) continue;
            // The face toward the eye: +X or -X.
            const side: f32 = if (d[0] > 0) 1 else -1;
            if (frame == null) frame = render(lines(p, status(p), tt, clock), time);
            face(dyn, &frame.?, x, side, o, lit, unlit);
        }
    }
}

/// One face of a board: a quad for the unlit LEDs, then a quad for each
/// run of lit LEDs in a row. Facing +X the text reads toward -Z.
fn face(dyn: *mesh.Mesh, f: *const Frame, x: f32, side: f32, o: [2]f32, lit: V3, unlit: V3) void {
    const n = v3(side, 0, 0);
    const back = x + side * 0.0605;
    const front = x + side * 0.062;
    quadAt(dyn, back, o[0], o[0] + width, o[1], o[1] + height, n, unlit);
    for (f, 0..) |row, r| {
        const ya = o[1] + @as(f32, @floatFromInt(rows - 1 - r)) * pitch;
        var c: usize = 0;
        while (c < cols) {
            if (!row[c]) {
                c += 1;
                continue;
            }
            var e = c;
            while (e < cols and row[e]) e += 1;
            // Columns c..e on the face: toward -Z facing +X.
            const fa: f32 = @floatFromInt(c);
            const fe: f32 = @floatFromInt(e);
            const za = if (side > 0) o[0] + width - fe * pitch else o[0] + fa * pitch;
            const zb = if (side > 0) o[0] + width - fa * pitch else o[0] + fe * pitch;
            quadAt(dyn, front, za, zb, ya, ya + pitch, n, lit);
            c = e;
        }
    }
}

fn quadAt(dyn: *mesh.Mesh, x: f32, za: f32, zb: f32, ya: f32, yb: f32, n: V3, col: V3) void {
    const m: f32 = @floatFromInt(@backingInt(map.Mat.led));
    dyn.quad(v3(x, ya, za), v3(x, ya, zb), v3(x, yb, zb), v3(x, yb, za), n, col, m);
}

// ---- The font ------------------------------------------------------------------

/// A 5 by 7 character, top row first, the most significant bit at the
/// left. An unknown character is a space.
pub fn glyph(c: u8) [7]u5 {
    return switch (c) {
        '!' => .{ 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00000, 0b00100 },
        '&' => .{ 0b01100, 0b10010, 0b10100, 0b01000, 0b10101, 0b10010, 0b01101 },
        '\'' => .{ 0b01100, 0b00100, 0b01000, 0, 0, 0, 0 },
        '(' => .{ 0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010 },
        ')' => .{ 0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000 },
        '*' => .{ 0, 0b00100, 0b10101, 0b01110, 0b10101, 0b00100, 0 },
        '+' => .{ 0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0 },
        ',' => .{ 0, 0, 0, 0, 0b01100, 0b00100, 0b01000 },
        '-' => .{ 0, 0, 0, 0b11111, 0, 0, 0 },
        '.' => .{ 0, 0, 0, 0, 0, 0b01100, 0b01100 },
        '/' => .{ 0, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0 },
        '0' => .{ 0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110 },
        '1' => .{ 0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110 },
        '2' => .{ 0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111 },
        '3' => .{ 0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110 },
        '4' => .{ 0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010 },
        '5' => .{ 0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110 },
        '6' => .{ 0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110 },
        '7' => .{ 0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000 },
        '8' => .{ 0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110 },
        '9' => .{ 0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100 },
        ':' => .{ 0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0 },
        'A' => .{ 0b01110, 0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001 },
        'B' => .{ 0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110 },
        'C' => .{ 0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110 },
        'D' => .{ 0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100 },
        'E' => .{ 0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111 },
        'F' => .{ 0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000 },
        'G' => .{ 0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111 },
        'H' => .{ 0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001 },
        'I' => .{ 0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110 },
        'J' => .{ 0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100 },
        'K' => .{ 0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001 },
        'L' => .{ 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111 },
        'M' => .{ 0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001 },
        'N' => .{ 0b10001, 0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001 },
        'O' => .{ 0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110 },
        'P' => .{ 0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000 },
        'Q' => .{ 0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101 },
        'R' => .{ 0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001 },
        'S' => .{ 0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110 },
        'T' => .{ 0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100 },
        'U' => .{ 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110 },
        'V' => .{ 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100 },
        'W' => .{ 0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b10101, 0b01010 },
        'X' => .{ 0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001 },
        'Y' => .{ 0b10001, 0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100 },
        'Z' => .{ 0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111 },
        'a' => .{ 0, 0, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111 },
        'b' => .{ 0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b11110 },
        'c' => .{ 0, 0, 0b01110, 0b10000, 0b10000, 0b10001, 0b01110 },
        'd' => .{ 0b00001, 0b00001, 0b01101, 0b10011, 0b10001, 0b10001, 0b01111 },
        'e' => .{ 0, 0, 0b01110, 0b10001, 0b11111, 0b10000, 0b01110 },
        'f' => .{ 0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000 },
        'g' => .{ 0, 0b01111, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110 },
        'h' => .{ 0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001 },
        'i' => .{ 0b00100, 0, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110 },
        'j' => .{ 0b00010, 0, 0b00110, 0b00010, 0b00010, 0b10010, 0b01100 },
        'k' => .{ 0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010 },
        'l' => .{ 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110 },
        'm' => .{ 0, 0, 0b11010, 0b10101, 0b10101, 0b10001, 0b10001 },
        'n' => .{ 0, 0, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001 },
        'o' => .{ 0, 0, 0b01110, 0b10001, 0b10001, 0b10001, 0b01110 },
        'p' => .{ 0, 0, 0b11110, 0b10001, 0b11110, 0b10000, 0b10000 },
        'q' => .{ 0, 0, 0b01101, 0b10011, 0b01111, 0b00001, 0b00001 },
        'r' => .{ 0, 0, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000 },
        's' => .{ 0, 0, 0b01110, 0b10000, 0b01110, 0b00001, 0b11110 },
        't' => .{ 0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110 },
        'u' => .{ 0, 0, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101 },
        'v' => .{ 0, 0, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100 },
        'w' => .{ 0, 0, 0b10001, 0b10001, 0b10101, 0b10101, 0b01010 },
        'x' => .{ 0, 0, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001 },
        'y' => .{ 0, 0, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110 },
        'z' => .{ 0, 0, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111 },
        else => .{ 0, 0, 0, 0, 0, 0, 0 },
    };
}

// ---- Tests ---------------------------------------------------------------------

const testing = std.testing;
const test_p: Platform = .{ .number = 5, .dest = "Heathrow T5", .service = .deep_train, .board_z = 0, .floor_y = 0, .hang_y = 4, .xs = .{ 0, 10 } };
const test_tt: Timetable = .{ .cycle = 80, .brake_in = 6, .stop = 20, .depart = 42, .warn = 36 };

test "platform_display: the countdown follows the deep train" {
    // Just after it leaves: the next train is 58 s away.
    var l = lines(test_p, .{ .timed = 42 }, test_tt, 0);
    try testing.expectEqualStrings("1 Heathrow T5", l[0].left.str());
    try testing.expectEqualStrings("1 min", l[0].right.str());
    try testing.expectEqualStrings("2 mins", l[1].right.str());
    try testing.expectEqualStrings("00:00:00", l[2].left.str());
    // Braking in: due, and the warning on the third line.
    l = lines(test_p, .{ .timed = 10 }, test_tt, 0);
    try testing.expectEqualStrings("due", l[0].right.str());
    try testing.expectEqualStrings("*** STAND BACK - TRAIN APPROACHING ***", l[2].left.str());
    // At the platform: no time for it, the next one a cycle later.
    l = lines(test_p, .{ .timed = 25 }, test_tt, 61);
    try testing.expectEqualStrings("", l[0].right.str());
    try testing.expectEqualStrings("1 min", l[1].right.str());
    try testing.expectEqualStrings("00:01:01", l[2].left.str());
    // The door warning.
    l = lines(test_p, .{ .timed = 38 }, test_tt, 0);
    try testing.expectEqualStrings("Mind the closing doors", l[2].left.str());
}

test "platform_display: held and closed platforms" {
    var l = lines(test_p, .held, test_tt, 17 * 3600 + 42 * 60 + 10);
    try testing.expectEqualStrings("1 Heathrow T5", l[0].left.str());
    try testing.expectEqualStrings("This train is being held", l[1].left.str());
    try testing.expectEqualStrings("17:42:10", l[2].left.str());
    l = lines(test_p, .closed, test_tt, 0);
    try testing.expectEqualStrings("Platform closed", l[0].left.str());
}

test "platform_display: the text fits the board and stays inside it" {
    // Each text that does not scroll fits on its line.
    try testing.expect(line_chars >= "No trains on this platform".len);
    try testing.expect(line_chars >= "1 Edgware Road".len + 1 + "10 mins".len);
    // A scrolling text never lights the border columns.
    var t: f32 = 0;
    while (t < 10) : (t += 0.37) {
        const f = render(lines(test_p, .{ .timed = 10 }, test_tt, 0), t);
        for (f) |row| {
            for (0..margin) |c| try testing.expect(!row[c] and !row[cols - 1 - c]);
        }
    }
    // The right text ends at the last text column.
    const f = render(lines(test_p, .{ .timed = 42 }, test_tt, 0), 0);
    var last: usize = 0;
    for (f[line_row[0] .. line_row[0] + 7]) |row| {
        for (row, 0..) |on, c| if (on) {
            last = @max(last, c);
        };
    }
    try testing.expectEqual(@as(usize, margin + text_cols - 1), last);
}

test "platform_display: each character of the boards has a glyph" {
    const texts = [_][]const u8{ "Edgware Road", "Tower Hill", "Wimbledon", "Richmond", "Heathrow T5", "Cockfosters", "Platform closed", "No trains on this platform", "This train is being held", "Mind the closing doors", "*** STAND BACK - TRAIN APPROACHING ***", "0123456789:", "due mins" };
    for (texts) |s| for (s) |ch| {
        if (ch == ' ') continue;
        const g = glyph(ch);
        var any: u5 = 0;
        for (g) |r| any |= r;
        try testing.expect(any != 0);
    };
}
