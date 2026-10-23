// Where: apps/action/game/src/shooter_hud.zig
// When: each frame of practice mode on the arena map (main.zig drawHud).
// Why: the text of the NPC shooter panel (shooter.zig): the title and the
// status, the label and the value of each row with a line of details, and
// the captions of the buttons. The text goes on the HUD at the place of
// the panel face in the view.
//
// - The size of the text follows the distance to the panel, in a few fixed
//   sizes. Each size adds its glyphs to the atlas of sw_text one time, so
//   the atlas does not grow while the player walks.
// - The value of the row under the crosshair is orange, as the button.
// - Nothing shows from behind the panel, from far away, or at a flat angle.
//   The text fades out when the panel leaves the centre of the view.
const std = @import("std");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const vec = @import("vec.zig");
const weapon = @import("weapon.zig");
const shooter = @import("shooter.zig");
const arena = @import("maps/arena.zig");
const impact = @import("audio/impact.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

/// The camera of the frame: the view matrix, tan(fov / 2), the eye, and
/// the HUD size in logical pixels.
pub const Cam = struct { view: Mat4, th: f32, eye: V3, w: f32, h: f32 };

const Align = enum { left, centre, right };

/// The text sizes in logical pixels. A size between two steps takes the
/// lower one.
const sizes = [_]f32{ 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 25, 28, 32, 36 };

const white = gfx.Color.rgba8(240, 238, 232, 255);
const dim = gfx.Color.rgba8(175, 180, 190, 255);
const accent = gfx.Color.rgba8(255, 166, 77, 255);
const red = gfx.Color.rgba8(255, 90, 70, 255);
const blue = gfx.Color.rgba8(140, 200, 255, 255);

fn project(cam: Cam, p: V3) ?[2]f32 {
    const c = vec.xform(cam.view, p);
    if (c[2] > -0.1) return null;
    const x = c[0] / -c[2] / (cam.th * cam.w / cam.h);
    const y = c[1] / -c[2] / cam.th;
    return .{ (x + 1) / 2 * cam.w, (1 - y) / 2 * cam.h };
}

fn quantize(px: f32) ?f32 {
    if (px < sizes[0]) return null;
    var best = sizes[0];
    for (sizes) |s| {
        if (s <= px) best = s;
    }
    return best;
}

const Ctx = struct {
    r: *gfx.Renderer,
    t: *sw_text.TextRenderer,
    cam: Cam,
    f: shooter.Frame,
    /// Logical pixels for each metre on the face.
    k: f32,
    /// The opacity of all the text.
    alpha: f32,

    fn text(c: Ctx, s: []const u8, x: f32, y: f32, size_m: f32, a: Align, colour: gfx.Color) void {
        const size = quantize(size_m * c.k) orelse return;
        var col = colour;
        col.a *= c.alpha;
        const p = project(c.cam, shooter.point(c.f, x, y, shooter.button_depth + 0.004)) orelse return;
        const w = c.t.measure(s, size).w;
        const x0 = switch (a) {
            .left => p[0],
            .centre => p[0] - w / 2,
            .right => p[0] - w,
        };
        _ = c.t.draw(c.r, s, @round(x0), @round(p[1] - size * 0.55), .{ .size = size, .color = col }) catch {};
    }
};

/// Draw the text of the panel, when it faces the camera within 9 m and
/// the view looks at it. The text fades out between 30 and 45 degrees from
/// the centre of the view, so it does not cover the HUD at the edge.
/// `aimed`: the button under the crosshair.
pub fn draw(r: *gfx.Renderer, t: *sw_text.TextRenderer, cam: Cam, aimed: ?shooter.Button) void {
    const f = shooter.frame();
    const to_eye = cam.eye - f.c;
    const dist = vec.len(to_eye);
    if (dist > 9 or vec.dot(to_eye, f.n) < 0.2 * dist) return;
    const in_view = vec.xform(cam.view, f.c);
    if (in_view[2] > -0.1) return;
    const slope = std.math.hypot(in_view[0], in_view[1]) / -in_view[2];
    const alpha = 1 - vec.smooth((slope - @tan(std.math.degreesToRadians(30.0))) / (@tan(std.math.degreesToRadians(45.0)) - @tan(std.math.degreesToRadians(30.0))));
    if (alpha < 0.02) return;
    // The scale: the smaller of the width and the height of the face on
    // the screen, so the text never overlaps at a flat angle.
    const left = project(cam, shooter.point(f, -shooter.half_w, 0, 0)) orelse return;
    const right = project(cam, shooter.point(f, shooter.half_w, 0, 0)) orelse return;
    const top = project(cam, shooter.point(f, 0, shooter.half_h, 0)) orelse return;
    const bottom = project(cam, shooter.point(f, 0, -shooter.half_h, 0)) orelse return;
    const kx = std.math.hypot(right[0] - left[0], right[1] - left[1]) / (2 * shooter.half_w);
    const ky = std.math.hypot(top[0] - bottom[0], top[1] - bottom[1]) / (2 * shooter.half_h);
    const c: Ctx = .{ .r = r, .t = t, .cam = cam, .f = f, .k = @min(kx, ky), .alpha = alpha };

    c.text("NPC SHOOTER", shooter.label_x, shooter.title_y, 0.05, .left, accent);
    const st_text: []const u8, const st_col = switch (shooter.status()) {
        .stopped => .{ "STOPPED", dim },
        .moving => .{ "MOVING", blue },
        .firing => .{ "FIRING", red },
        .reloading => .{ "RELOADING", accent },
    };
    c.text(st_text, shooter.lamp_x[0] - 0.02, shooter.title_y, 0.038, .right, st_col);

    var buf: [96]u8 = undefined;
    var sub: [96]u8 = undefined;
    const st = shooter.stats();
    for (std.enums.values(shooter.Row)) |row| {
        const y = shooter.row_y.get(row);
        const hot = if (aimed) |b| shooter.rowOf(b) == row else false;
        const label: []const u8 = switch (row) {
            .gun => "GUN",
            .surface => "SURFACE",
            .distance => "DISTANCE",
            .mode => "FIRE MODE",
        };
        c.text(label, shooter.label_x, y, 0.034, .left, dim);
        var detail_col = dim;
        const value: []const u8, const detail: []const u8 = switch (row) {
            .gun => blk: {
                const sonic = st.supersonic();
                detail_col = if (sonic) accent else blue;
                break :blk .{
                    weapon.label(&buf, shooter.gun),
                    std.fmt.bufPrint(&sub, "{s}  -  {d:.0} m/s  -  {s}", .{ st.calibre, st.velocity, if (sonic) "SUPERSONIC" else "SUBSONIC" }) catch "",
                };
            },
            .surface => if (shooter.surface) |s| .{
                shooter.looks.get(s).name,
                soundOf(s),
            } else .{ "NO SURFACE", "the round flies on past you, into the distance" },
            .distance => blk: {
                const tm = shooter.timing();
                const d = std.fmt.bufPrint(&buf, "{d:.0} m", .{arena.shooter_stops[shooter.stop].d}) catch "";
                const line = if (tm.crack) |cr|
                    std.fmt.bufPrint(&sub, "crack at {d:.0} ms, report at {d:.0} ms", .{ cr * 1000, tm.report * 1000 }) catch ""
                else
                    std.fmt.bufPrint(&sub, "report at {d:.0} ms, whiz at {d:.0} ms", .{ tm.report * 1000, tm.whiz * 1000 }) catch "";
                break :blk .{ d, line };
            },
            .mode => .{ modeName(shooter.fire), modeDetail(&sub, st) },
        };
        c.text(value, shooter.value_x, y, 0.05, .centre, if (hot) accent else white);
        c.text(detail, shooter.value_x, y + shooter.sub_dy, 0.032, .centre, detail_col);
    }

    // The captions of the buttons: dark on the orange of the aimed button,
    // grey on a button that cannot change anything.
    const dark = gfx.Color.rgba8(30, 18, 8, 255);
    const off = gfx.Color.rgba8(110, 112, 118, 255);
    for (std.enums.values(shooter.Button)) |b| {
        const rc = shooter.rect(b);
        const cx = (rc[0] + rc[2]) / 2;
        const cy = (rc[1] + rc[3]) / 2;
        const col = if (aimed == b) dark else if (shooter.enabled(b)) white else off;
        const caption: []const u8 = switch (b) {
            .start => "START",
            .stop => "STOP",
            .gun_prev, .surface_prev, .dist_prev, .mode_prev => "<",
            else => ">",
        };
        c.text(caption, cx, cy, if (b == .start or b == .stop) 0.04 else 0.055, .centre, col);
    }
}

/// The part of the material description that tells the sound: "a click
/// and a long high ring".
fn soundOf(s: impact.Material) []const u8 {
    const what = impact.info.get(s).what;
    const i = std.mem.indexOf(u8, what, ": ") orelse return what;
    return what[i + 2 ..];
}

fn modeName(f: shooter.Fire) []const u8 {
    return switch (f) {
        .single => "SINGLE",
        .burst => "BURST",
        .auto => "AUTO",
    };
}

fn modeDetail(buf: []u8, st: *const weapon.Stats) []const u8 {
    const only = shooter.modeCount(st) < 2;
    return switch (shooter.fire) {
        .single => if (only) "one round each second (the only mode of this gun)" else "one round each second",
        .burst => if (st.burst > 1)
            std.fmt.bufPrint(buf, "{d} rounds, then a pause{s}", .{ st.burst, if (only) " (the only mode of this gun)" else "" }) catch ""
        else
            "3 rounds, then a pause",
        .auto => std.fmt.bufPrint(buf, "the full magazine ({d}) at {d:.0} rounds a minute", .{ st.mag, 60 / st.interval }) catch "",
    };
}

/// The text of the use hint under the crosshair for a button.
pub fn hint(b: shooter.Button) []const u8 {
    return switch (b) {
        .gun_prev => "PREVIOUS GUN",
        .gun_next => "NEXT GUN",
        .surface_prev => "PREVIOUS SURFACE",
        .surface_next => "NEXT SURFACE",
        .dist_prev => "NEARER",
        .dist_next => "FURTHER",
        .mode_prev => "PREVIOUS FIRE MODE",
        .mode_next => "NEXT FIRE MODE",
        .start => "START THE SHOOTER",
        .stop => "STOP THE SHOOTER",
    };
}
