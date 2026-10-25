// Where: apps/action/game/src/roadmen_test.zig (zig build test)
// When: after a change to the roadmen (roadmen.zig), their model
// (npc.zig) or Warwick Road (maps/earls_court.zig warwickRoad).
// Why: simulates the roadman line tick by tick. A player past the line
// gets two roadmen out of view, and their stabs kill within a few
// seconds. A runner dies before the fence. A player who goes back over the
// line escapes, and the roadmen go out of sight. Hits do no damage. In
// deathmatch another client runs the gang from the "go" with no damage.
const std = @import("std");
const testing = std.testing;
const map = @import("map.zig");
const vec = @import("vec.zig");
const ec = @import("maps/earls_court.zig");
const roadmen = @import("roadmen.zig");
const player = @import("player.zig");
const V3 = vec.V3;
const v3 = vec.v3;

const dt: f32 = 1.0 / 120.0;
const north = v3(0, 0, -1);
/// The middle of the road (x) and the street (y).
const road_x: f32 = ec.warwick_lanes[1];

fn setup() void {
    map.init(testing.allocator);
    map.load(.earls_court);
    roadmen.reset();
}

/// A player of this client: its feet, its velocity and its health.
const Me = struct {
    pos: V3,
    vel: V3 = v3(0, 0, 0),
    look: V3 = north,
    hp: i32 = 100,
    alive: bool = true,
    /// The stabs that landed, and the time of the first.
    stabs: u32 = 0,
    first_stab: ?f32 = null,

    fn eye(self: *const Me) V3 {
        return self.pos + v3(0, player.eye, 0);
    }
};

var prng = std.Random.DefaultPrng.init(17);

/// One tick for the player of this client, offline: the stabs do their
/// damage here (as main.zig sendRoadmen). Returns the outbox kinds of the
/// tick.
fn tick(me: *Me, t: f32) void {
    me.pos += me.vel * vec.s(dt);
    roadmen.local(0, me.pos, me.vel, me.alive, me.eye(), me.look, prng.random());
    roadmen.step(dt, me.eye(), me.look);
    for (roadmen.outbox[0..roadmen.out_n]) |o| {
        if (o.kind != .stab or !me.alive) continue;
        me.stabs += 1;
        if (me.first_stab == null) me.first_stab = t;
        me.hp -= roadmen.damage;
        if (me.hp <= 0) me.alive = false;
    }
}

/// The kinds in the outbox, then empty it.
fn takeOut(buf: []roadmen.OutKind) []roadmen.OutKind {
    var n: usize = 0;
    for (roadmen.outbox[0..roadmen.out_n]) |o| {
        if (n < buf.len) buf[n] = o.kind;
        n += 1;
    }
    roadmen.out_n = 0;
    roadmen.event_n = 0;
    return buf[0..@min(n, buf.len)];
}

test "roadmen: the line is 50 m along Warwick Road, north and south of the exit" {
    setup();
    defer map.deinit();
    const ez = ec.warwick_exit_z;
    try testing.expect(!roadmen.pastLine(v3(road_x, ec.street_y, ez - 49)));
    try testing.expect(roadmen.pastLine(v3(road_x, ec.street_y, ez - 51)));
    try testing.expect(!roadmen.pastLine(v3(road_x, ec.street_y, ez + 49)));
    try testing.expect(roadmen.pastLine(v3(road_x, ec.street_y, ez + 51)));
    // Earls Court Road and the platforms are not Warwick Road.
    try testing.expect(!roadmen.pastLine(v3(85, ec.street_y, -60)));
    try testing.expect(!roadmen.pastLine(v3(road_x, 0, ez - 60)));
    // Each alley and the fence are past the line, and the road goes on
    // 100 m or more each way.
    for (ec.warwick_alleys) |a| try testing.expect(roadmen.pastLine(ec.alleySpot(a)));
    try testing.expect(ec.warwick_fence > roadmen.line + 50 and ec.warwick_fence >= 100);
}

test "roadmen: past the line two roadmen come out of view, and kill in a few seconds" {
    setup();
    defer map.deinit();
    var me = Me{ .pos = v3(road_x, ec.street_y, ec.warwick_exit_z - 40), .vel = north * vec.s(player.walk_speed) };
    var buf: [8]roadmen.OutKind = undefined;
    var t: f32 = 0;
    var go_at: ?f32 = null;
    while (t < 12 and me.alive) : (t += dt) {
        // The player walks on to 4 m past the line, then stands and looks
        // round.
        if (roadmen.along(me.pos) > roadmen.line + 4) me.vel = v3(0, 0, 0);
        tick(&me, t);
        const g = roadmen.gangOf(0, true);
        for (takeOut(&buf)) |k| {
            if (k != .go) continue;
            try testing.expect(go_at == null);
            go_at = t;
            try testing.expect(roadmen.pastLine(me.pos));
            // Two roadmen, apart, not too near, out of view of the eye.
            const gg = g.?;
            for (gg.men) |m| {
                try testing.expect(vec.len(m.body.pos - me.pos) >= 7);
                try testing.expect(!roadmen.visible(me.eye(), me.look, m.body.pos));
                try testing.expect(!map.overlaps(m.body.pos + v3(-0.3, 0.05, -0.3), m.body.pos + v3(0.3, 1.7, 0.3)));
            }
            try testing.expect(vec.len(gg.men[0].body.pos - gg.men[1].body.pos) >= 3);
        }
    }
    try testing.expect(go_at != null);
    try testing.expect(!me.alive);
    // 100 health, 25 a stab: four stabs, within 3 s of the first one.
    try testing.expectEqual(@as(u32, 4), me.stabs);
    try testing.expect(t - me.first_stab.? < 3);
    // They come within 8 s of the line.
    try testing.expect(t - go_at.? < 8);
    // After the kill the roadmen stand, then walk away and go.
    var gone = false;
    var u: f32 = 0;
    while (u < 40) : (u += dt) {
        tick(&me, t + u);
        _ = takeOut(&buf);
        if (roadmen.count() == 0) {
            gone = true;
            break;
        }
    }
    try testing.expect(gone);
}

test "roadmen: a runner does not reach the fence alive" {
    setup();
    defer map.deinit();
    for ([_]f32{ -1, 1 }) |dir| {
        roadmen.reset();
        // The blessing of MORE: 1.5 times the walk speed.
        const v = v3(0, 0, dir) * vec.s(player.walk_speed * 1.5);
        var me = Me{ .pos = v3(road_x, ec.street_y, ec.warwick_exit_z + dir * 45), .vel = v, .look = v3(0, 0, dir) };
        var buf: [8]roadmen.OutKind = undefined;
        var t: f32 = 0;
        while (t < 30 and me.alive) : (t += dt) {
            tick(&me, t);
            _ = takeOut(&buf);
            try testing.expect(roadmen.along(me.pos) < ec.warwick_fence - 1);
        }
        try testing.expect(!me.alive);
    }
}

test "roadmen: back over the line in time, the player escapes" {
    setup();
    defer map.deinit();
    var me = Me{ .pos = v3(road_x, ec.street_y, ec.warwick_exit_z - roadmen.line - 1) };
    var buf: [8]roadmen.OutKind = undefined;
    tick(&me, 0);
    try testing.expectEqualSlices(roadmen.OutKind, &.{.go}, takeOut(&buf));
    // Back toward the station at once, looking at the station.
    me.vel = v3(0, 0, player.walk_speed);
    me.look = v3(0, 0, 1);
    var off = false;
    var t: f32 = dt;
    while (t < 40) : (t += dt) {
        tick(&me, t);
        for (takeOut(&buf)) |k| {
            if (k == .off) off = true;
            try testing.expect(k != .stab);
        }
        if (roadmen.along(me.pos) < 20) me.vel = v3(0, 0, 0);
        if (off and roadmen.count() == 0) break;
    }
    try testing.expect(off);
    try testing.expect(me.alive and me.stabs == 0);
    // Out of sight, they went.
    try testing.expectEqual(@as(usize, 0), roadmen.count());
}

test "roadmen: shots, cuts and blasts hit them and do no damage" {
    setup();
    defer map.deinit();
    var me = Me{ .pos = v3(road_x, ec.street_y, ec.warwick_exit_z - roadmen.line - 3) };
    var buf: [8]roadmen.OutKind = undefined;
    tick(&me, 0);
    _ = takeOut(&buf);
    const g = roadmen.gangOf(0, true).?;
    const m = &g.men[0];
    for (0..200) |_| {
        const chest = m.body.pos + v3(0, 1.2, 0);
        const o = chest + v3(3, 0, 0);
        const d = vec.norm(chest - o);
        const h = roadmen.ray(o, d, 10) orelse return error.TestNoHit;
        try testing.expectEqual(@as(usize, 0), h.man);
        roadmen.shoot(h, d);
        try testing.expectEqual(@as(f32, 1), m.flinch);
    }
    roadmen.blast(m.body.pos + v3(1, 0.3, 0), 8);
    try testing.expect(g.on and g.state == .chase);
    // A ray that misses finds nothing.
    try testing.expect(roadmen.ray(m.body.pos + v3(3, 5, 0), v3(-1, 0, 0), 10) == null);
}

test "roadmen: in deathmatch another client runs the gang from the go, with no damage" {
    setup();
    defer map.deinit();
    // Client A: its player goes past the line.
    var me = Me{ .pos = v3(road_x, ec.street_y, ec.warwick_exit_z - roadmen.line - 3) };
    tick(&me, 0);
    try testing.expectEqual(roadmen.OutKind.go, roadmen.outbox[0].kind);
    const at = roadmen.outbox[0].at;
    // Client B: no gang of its own. Player 7 (A) stands there.
    roadmen.reset();
    roadmen.applyGo(7, at, me.pos);
    const eye = v3(road_x, ec.street_y + player.eye, ec.warwick_exit_z - 30);
    var stabs: u32 = 0;
    var t: f32 = 0;
    while (t < 6) : (t += dt) {
        roadmen.remote(7, me.pos, v3(0, 0, 0), true);
        roadmen.step(dt, eye, north);
        try testing.expectEqual(@as(usize, 0), roadmen.out_n);
        for (roadmen.events[0..roadmen.event_n]) |e| stabs += @intFromBool(e.kind == .stab);
        roadmen.event_n = 0;
    }
    // They reached player 7 and stab, and only the server does damage.
    try testing.expect(stabs >= 4);
    // The kill of player 7, then an off of a new chase: they walk away.
    roadmen.remote(7, me.pos, v3(0, 0, 0), false);
    roadmen.step(dt, eye, north);
    try testing.expectEqual(roadmen.State.gloat, roadmen.gangOf(7, false).?.state);
    roadmen.applyGo(7, at, me.pos);
    roadmen.applyOff(7);
    try testing.expectEqual(roadmen.State.leave, roadmen.gangOf(7, false).?.state);
}
