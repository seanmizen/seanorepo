// Where: apps/action/game/src/roadmen.zig
// When: on Earl's Court, main.zig steps the roadmen in each tick, draws
// them, sends the outbox in deathmatch and plays the events.
// Why: Warwick Road is open (maps/earls_court.zig warwickRoad). The roadmen
// stop a player who goes too far along it: a wall does not.
//
// - The roadman line is `line` (50 m) along Warwick Road from the station
//   exit, north and south. A player past it gets a gang of two roadmen
//   (npc.zig, full black). They come out of an alley or from the road, out
//   of the view of the player, and walk or run at the player. In reach they
//   stab with knives. Each stab that lands does `damage`. A player who
//   runs gets no gap: they run faster than the player.
// - A player on a moped (moped_ride.zig): a roadman who gets near the
//   moped (`knocks`), or a stab that lands, pulls the rider off it. Then
//   the chase goes on as on foot.
// - A player who goes back over the line before the end escapes. The
//   roadmen walk away, and each one goes when the player cannot see it.
// - After a kill the roadmen stand for a moment, then they walk away.
// - The roadmen cannot die. A shot, a cut or a blast hits them: the impact
//   and a flinch, and no damage.
//
// Deathmatch (`main.zig`, server/roadmen.ts), as the pigeons:
// - The client of the player decides. It starts the gang at once and puts
//   the event in `outbox`: "go" with the places of the two roadmen, "off"
//   when the player escapes, "stab" for each stab that lands. main.zig
//   sends them.
// - The server checks each event: a "go" only for a player past the line,
//   a "stab" only during a chase. It sends "go" and "off" to the other
//   players. It applies the damage of a stab, and a death credits
//   "roadman" in the kill feed.
// - The other clients run the gang of that player from the "go" (applyGo),
//   with the place of the player from the snapshots (remote). Their
//   roadmen stab too, with no damage: the damage comes from the server.
// - Offline (practice), main.zig applies the damage of each "stab" on
//   the client.
//
// The module has no sound, no input and no network.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const player = @import("player.zig");
const npc = @import("npc.zig");
const ec = @import("maps/earls_court.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The roadman line: this far along Warwick Road from the station exit,
/// north and south (metres). server/roadmen.ts has the same number.
pub const line: f32 = 50;
/// The damage of one stab. server/roadmen.ts has the same number.
pub const damage: i32 = 25;
/// The kill feed name of the roadmen.
pub const name = "roadman";
/// A roadman stabs at this distance or less (between the feet, on the
/// ground).
const reach: f32 = 1.25;
/// A stab lands at this distance or less.
const land_reach: f32 = 1.6;
/// One stab, s. The blade is out at npc stab 0.45.
const stab_len: f32 = 0.5;
/// The time from one stab of a roadman to his next, s. The two take
/// turns.
const stab_gap: f32 = 0.85;
/// The run: at least run_speed, and 1.5 m/s faster than the player, at
/// most max_speed. The walk of a roadman near a player who stands still,
/// and the walk away.
const run_speed: f32 = 8.0;
const max_speed: f32 = 12.0;
const close_speed: f32 = 3.0;
const walk_speed: f32 = 1.5;
/// After a kill the roadmen stand this long, then they walk away.
const gloat_time: f32 = 1.5;
/// A gang that walks away goes when both roadmen are out of sight for
/// `gone_after`, or after max_leave.
const gone_after: f32 = 0.5;
const max_leave: f32 = 30.0;
/// The escape: the player must be this far back inside the line.
const back_in: f32 = 1.0;
/// A remote gang with no place of its player for this long walks away.
const stale_after: f32 = 2.0;
/// The places of a new gang: this far from the player at least and at
/// most (on the ground).
const spot_near: f32 = 7;
const spot_far: f32 = 40;

pub const max_gangs = 16;

/// True on Warwick Road (the road, the pavements and the alleys), north or
/// south of the station.
pub fn onRoad(p: V3) bool {
    return map.id == .earls_court and p[0] > ec.warwick_band[0] and p[0] < ec.warwick_band[1] and
        p[1] > ec.street_y - 1 and p[1] < ec.street_y + 4;
}

/// The distance along Warwick Road from the exit.
pub fn along(p: V3) f32 {
    return @abs(p[2] - ec.warwick_exit_z);
}

/// True past the roadman line.
pub fn pastLine(p: V3) bool {
    return onRoad(p) and along(p) > line;
}

pub const Man = struct {
    body: player.Player = .{},
    yaw: f32 = 0,
    /// The stab in progress: 0 to 1, or < 0 for none.
    stab: f32 = -1,
    /// The time to the next stab.
    cool: f32 = 0,
    /// A hit: 1 at the hit, then down to 0.
    flinch: f32 = 0,
    flinch_dir: V3 = v3(0, 0, -1),
    action: npc.Action = .stand,
    /// Out of sight of this client for this long (the walk away).
    hidden: f32 = 0,
};

pub const State = enum { chase, gloat, leave };

pub const Gang = struct {
    on: bool = false,
    /// The player that the gang is after: its id in deathmatch, 0 offline.
    owner: u32 = 0,
    /// The player of this client: it decides the events.
    mine: bool = false,
    state: State = .chase,
    /// The time in the state.
    state_t: f32 = 0,
    men: [2]Man = .{ .{}, .{} },
    /// The feet of the player, its velocity, and alive.
    target: V3 = v3(0, 0, 0),
    target_vel: V3 = v3(0, 0, 0),
    target_alive: bool = true,
    /// The time since the last place of the player.
    stale: f32 = 0,
};

pub var gangs: [max_gangs]Gang = @splat(.{});

/// The events of this client for the server (main.zig sends them in
/// deathmatch, and applies "stab" offline).
pub const OutKind = enum { go, off, stab };
pub const Out = struct { kind: OutKind, at: [2]V3 = .{ v3(0, 0, 0), v3(0, 0, 0) } };
pub var outbox: [8]Out = undefined;
pub var out_n: usize = 0;

/// The sounds: a stab that starts (`swish`) and one that lands (`stab`).
pub const EventKind = enum { swish, stab };
pub const Event = struct { kind: EventKind, p: V3 };
pub var events: [16]Event = undefined;
pub var event_n: usize = 0;

fn emit(o: Out) void {
    if (out_n < outbox.len) {
        outbox[out_n] = o;
        out_n += 1;
    }
}

fn sound(kind: EventKind, p: V3) void {
    if (event_n < events.len) {
        events[event_n] = .{ .kind = kind, .p = p };
        event_n += 1;
    }
}

/// Remove all the gangs and the queues: a new map or a new mode.
pub fn reset() void {
    gangs = @splat(.{});
    out_n = 0;
    event_n = 0;
}

fn find(owner: u32, mine: bool) ?*Gang {
    for (&gangs) |*g| {
        if (g.on and g.mine == mine and (mine or g.owner == owner)) return g;
    }
    return null;
}

/// The gang of a player, or null.
pub fn gangOf(owner: u32, mine: bool) ?*Gang {
    return find(owner, mine);
}

/// A new gang at two places, after a player.
fn start(owner: u32, mine: bool, at: [2]V3, target: V3) *Gang {
    var slot: *Gang = &gangs[0];
    for (&gangs) |*g| {
        if (!g.on) {
            slot = g;
            break;
        }
    }
    slot.* = .{ .on = true, .owner = owner, .mine = mine, .target = target };
    for (&slot.men, 0..) |*m, i| {
        m.* = .{ .body = .{ .pos = at[i], .grounded = true } };
        m.yaw = yawTo(target - at[i]);
        // The two take turns.
        m.cool = @as(f32, @floatFromInt(i)) * stab_gap / 2;
    }
    return slot;
}

/// The yaw that faces the direction d (0 looks to -Z).
fn yawTo(d: V3) f32 {
    return std.math.atan2(-d[0], -d[2]);
}

fn flat(d: V3) V3 {
    return v3(d[0], 0, d[2]);
}

// ---- The player of this client ---------------------------------------------------

/// Each tick, for the player of this client: past the line a gang comes,
/// back over the line it goes. `owner` is the id of the player (0
/// offline). `eye` and `look` are the camera: a new gang comes out of
/// view.
pub fn local(owner: u32, pos: V3, vel: V3, alive: bool, eye: V3, look: V3, rnd: std.Random) void {
    var g = find(owner, true);
    if (alive and pastLine(pos)) {
        if (g) |gg| {
            if (gg.state == .leave) {
                // Back over the line: the same roadmen come back.
                gg.state = .chase;
                gg.state_t = 0;
                emit(.{ .kind = .go, .at = .{ gg.men[0].body.pos, gg.men[1].body.pos } });
            }
        } else {
            const at = pickSpots(pos, eye, look, rnd);
            g = start(owner, true, at, pos);
            emit(.{ .kind = .go, .at = at });
        }
    } else if (g) |gg| {
        if (gg.state == .chase and alive and (!onRoad(pos) or along(pos) < line - back_in)) {
            gg.state = .leave;
            gg.state_t = 0;
            emit(.{ .kind = .off });
        }
    }
    if (g) |gg| {
        gg.target = pos;
        gg.target_vel = vel;
        gg.target_alive = alive;
        gg.stale = 0;
    }
}

// ---- The other players (deathmatch) -------------------------------------------

/// Another player started a gang at `at` (a "go" from the server). A gang
/// of that player that walks away comes back.
pub fn applyGo(owner: u32, at: [2]V3, target: V3) void {
    if (find(owner, false)) |g| {
        g.state = .chase;
        g.state_t = 0;
        return;
    }
    _ = start(owner, false, at, target);
}

/// Another player went back over the line (an "off").
pub fn applyOff(owner: u32) void {
    if (find(owner, false)) |g| {
        if (g.state == .chase) {
            g.state = .leave;
            g.state_t = 0;
        }
    }
}

/// The place of another player from the snapshots, each tick.
pub fn remote(owner: u32, pos: V3, vel: V3, alive: bool) void {
    const g = find(owner, false) orelse return;
    g.target = pos;
    g.target_vel = vel;
    g.target_alive = alive;
    g.stale = 0;
}

// ---- The places of a new gang ------------------------------------------------------

/// True when the eye sees a roadman at p: in front of the eye, near
/// enough, and a line from the eye to his head, his chest or his knees is
/// clear.
pub fn visible(eye: V3, look: V3, p: V3) bool {
    const lf = vec.norm(flat(look));
    for ([_]f32{ 1.7, 1.2, 0.5 }) |h| {
        const c = p + v3(0, h, 0);
        const to = c - eye;
        const d = vec.len(to);
        if (d > 90) return false;
        if (vec.dot(lf, vec.norm(flat(to))) < 0.45) continue;
        if (map.raycast(eye, to / vec.s(d), d - 0.35) == null) return true;
    }
    return false;
}

/// A place where a roadman can stand: a floor at the street, and room for
/// the body. Its feet, or null.
fn standAt(x: f32, z: f32) ?V3 {
    const y = ec.street_y;
    const top = map.floorTop(v3(x - 0.05, y - 0.2, z - 0.05), v3(x + 0.05, y + 0.3, z + 0.05)) orelse return null;
    const r = player.radius;
    if (map.overlaps(v3(x - r, top + 0.02, z - r), v3(x + r, top + player.height, z + r))) return null;
    return v3(x, top, z);
}

/// Two places for a new gang after a player at `target`: out of the view
/// of the eye (behind it, or round a corner in an alley), not too near
/// and not too far, and further along the road than the player when
/// possible, so a player who runs on meets them.
pub fn pickSpots(target: V3, eye: V3, look: V3, rnd: std.Random) [2]V3 {
    const Cand = struct { p: V3, score: f32 };
    var c: [96]Cand = undefined;
    var n: usize = 0;
    const out_dir: f32 = if (target[2] < ec.warwick_exit_z) -1 else 1;
    var pts: [96]V3 = undefined;
    var np: usize = 0;
    for (ec.warwick_alleys) |a| {
        pts[np] = ec.alleySpot(a);
        np += 1;
    }
    var k: f32 = -6;
    while (k <= 9) : (k += 1) {
        for (ec.warwick_lanes) |x| {
            if (np == pts.len) break;
            pts[np] = v3(x, ec.street_y, target[2] + out_dir * k * 4);
            np += 1;
        }
    }
    for (pts[0..np]) |q| {
        // Past the line, and short of the fence.
        if (along(q) < line - 10 or along(q) > ec.warwick_fence - 3) continue;
        const p = standAt(q[0], q[2]) orelse continue;
        const d = vec.len(flat(p - target));
        if (d < spot_near or d > spot_far) continue;
        var score = 2 * std.math.clamp(along(p) - along(target), -8, 16) - 0.25 * @abs(d - 14) + 2 * rnd.float(f32);
        if (visible(eye, look, p)) score -= 100;
        c[n] = .{ .p = p, .score = score };
        n += 1;
    }
    var best: [2]?V3 = .{ null, null };
    for (0..2) |slot| {
        var top: f32 = -1e9;
        for (c[0..n]) |cand| {
            if (slot == 1 and best[0] != null and vec.len(flat(cand.p - best[0].?)) < 3) continue;
            if (cand.score > top) {
                top = cand.score;
                best[slot] = cand.p;
            }
        }
    }
    // No place: on the road behind the player.
    const behind = target - vec.norm(flat(look)) * vec.s(12);
    return .{ best[0] orelse behind, best[1] orelse behind + v3(1.5, 0, 0) };
}

// ---- The step ----------------------------------------------------------------------

/// Turn the yaw toward `want` at a limited rate.
fn turn(yaw: f32, want: f32, dt: f32) f32 {
    var d = @mod(want - yaw + std.math.pi, std.math.tau) - std.math.pi;
    d = std.math.clamp(d, -10 * dt, 10 * dt);
    return yaw + d;
}

/// Step all the gangs. `eye` and `look` are the camera of this client: a
/// roadman who walks away goes when this client cannot see him.
pub fn step(dt: f32, eye: V3, look: V3) void {
    for (&gangs) |*g| {
        if (!g.on) continue;
        g.state_t += dt;
        g.stale += dt;
        if (!g.mine and g.stale > stale_after and g.state == .chase) {
            g.state = .leave;
            g.state_t = 0;
        }
        if (g.state == .chase and !g.target_alive) {
            g.state = .gloat;
            g.state_t = 0;
        }
        if (g.state == .gloat and g.state_t > gloat_time) {
            g.state = .leave;
            g.state_t = 0;
        }
        var all_gone = true;
        for (&g.men, 0..) |*m, i| {
            stepMan(g, m, i, dt);
            if (g.state == .leave) {
                m.hidden = if (visible(eye, look, m.body.pos)) 0 else m.hidden + dt;
                if (m.hidden < gone_after) all_gone = false;
            } else all_gone = false;
        }
        // Keep the two apart.
        const sep = flat(g.men[1].body.pos - g.men[0].body.pos);
        const sl = vec.len(sep);
        if (sl < 0.7 and sl > 1e-3) {
            const push = sep / vec.s(sl) * vec.s((0.7 - sl) * 8);
            g.men[0].body.vel -= push;
            g.men[1].body.vel += push;
        }
        if (g.state == .leave and (all_gone or g.state_t > max_leave)) g.on = false;
    }
}

/// The way out of an alley to the pavement, or null out of the alleys.
/// The fronts of the terraces are 1.5 m past the middles of the
/// pavements.
fn alleyExit(p: V3) ?V3 {
    if (p[0] < ec.warwick_lanes[0] - 1.2) return v3(1, 0, 0);
    if (p[0] > ec.warwick_lanes[2] + 1.2) return v3(-1, 0, 0);
    return null;
}

fn stepMan(g: *Gang, m: *Man, i: usize, dt: f32) void {
    m.flinch = @max(0, m.flinch - dt * 2.5);
    m.cool -= dt;
    const to = flat(g.target - m.body.pos);
    const d = vec.len(to);
    var wish = v3(0, 0, 0);
    var speed: f32 = 0;
    switch (g.state) {
        .chase => {
            if (d > reach) {
                // Each one comes in from his own side, then straight in.
                const side = vec.norm(v3(-to[2], 0, to[0])) * vec.s((if (i == 0) @as(f32, -1) else 1) * 2.5 * vec.clamp01((d - 2) / 8));
                // In an alley: straight out to the pavement first.
                const dir = alleyExit(m.body.pos) orelse vec.norm(flat(g.target + side - m.body.pos));
                const target_speed = vec.len(flat(g.target_vel));
                speed = if (d > 6 or target_speed > 2) std.math.clamp(target_speed + 1.5, run_speed, max_speed) else close_speed;
                wish = dir;
                m.yaw = turn(m.yaw, yawTo(dir), dt);
                m.action = if (speed > 4) .run else .walk;
            } else {
                m.yaw = turn(m.yaw, yawTo(to), dt);
                m.action = .stab;
                if (m.stab < 0 and m.cool <= 0) {
                    m.stab = 0;
                    m.cool = stab_gap;
                    sound(.swish, m.body.pos + v3(0, 1.2, 0));
                }
            }
        },
        .gloat => {
            if (d > 0.1) m.yaw = turn(m.yaw, yawTo(to), dt);
            m.action = .stand;
        },
        .leave => {
            // Away along the road, from the station.
            const out: f32 = if (m.body.pos[2] < ec.warwick_exit_z) -1 else 1;
            const dir = alleyExit(m.body.pos) orelse vec.norm(v3((ec.warwick_lanes[1] - m.body.pos[0]) * 0.05, 0, out));
            wish = dir;
            speed = walk_speed;
            m.yaw = turn(m.yaw, yawTo(dir), dt);
            m.action = .walk;
        },
    }
    // A stab in progress goes on to its end. It lands at 0.45.
    if (m.stab >= 0) {
        const before = m.stab;
        m.stab += dt / stab_len;
        if (before < 0.45 and m.stab >= 0.45 and g.state == .chase and g.target_alive and d < land_reach) {
            sound(.stab, g.target + v3(0, 1.1, 0));
            if (g.mine) emit(.{ .kind = .stab });
        }
        if (m.stab >= 1) m.stab = -1;
    }
    // A hit staggers him for a moment.
    if (m.flinch > 0.6) wish = v3(0, 0, 0);
    m.body.step(dt, wish, false, speed / player.walk_speed);
}

/// A roadman pulls a rider off a moped (moped_ride.zig) at this distance.
pub const knock_reach: f32 = 1.3;

/// True when a roadman of the gang of the player of this client, in the
/// chase, is within knock_reach of the feet p: he pulls a rider off the
/// moped. A moped is faster than a roadman, so the gang comes out ahead of
/// the rider (pickSpots), and the ROAD CLOSED fence stops a moped.
pub fn knocks(p: V3) bool {
    const g = find(0, true) orelse return false;
    if (g.state != .chase) return false;
    for (g.men) |m| {
        if (vec.len(flat(m.body.pos - p)) < knock_reach and @abs(m.body.pos[1] - p[1]) < 1.5) return true;
    }
    return false;
}

// ---- Hits ----------------------------------------------------------------------------

/// The pose of a roadman (npc.zig).
pub fn pose(m: *const Man) npc.Pose {
    const action: npc.Action = if (m.stab >= 0) .stab else m.action;
    return .{
        .pos = m.body.pos,
        .yaw = m.yaw,
        .action = action,
        .stride = m.body.stride,
        .stab = @max(0, m.stab),
        .flinch = m.flinch,
        .flinch_dir = m.flinch_dir,
        .knife = true,
    };
}

pub const Hit = struct { gang: usize, man: usize, t: f32, head: bool };

/// The first roadman on a ray within max_t, or null.
pub fn ray(o: V3, d: V3, max_t: f32) ?Hit {
    var best: ?Hit = null;
    for (&gangs, 0..) |*g, gi| {
        if (!g.on) continue;
        for (&g.men, 0..) |*m, mi| {
            // A quick test first: the man is in a 2.5 m ball.
            const c = m.body.pos + v3(0, 1, 0);
            const along_ray = vec.dot(c - o, d);
            if (along_ray < -1.5 or along_ray > max_t + 1.5) continue;
            if (vec.len(o + d * vec.s(along_ray) - c) > 1.5) continue;
            for (npc.hitBoxes(npc.skeleton(pose(m))), 0..) |b, k| {
                if (map.rayBox(o, d, b.min, b.max)) |h| {
                    if (h.t <= max_t and (best == null or h.t < best.?.t)) best = .{ .gang = gi, .man = mi, .t = h.t, .head = k == 2 };
                }
            }
        }
    }
    return best;
}

/// A shot or a cut hit a roadman: he flinches, and takes no damage.
pub fn shoot(h: Hit, d: V3) void {
    const m = &gangs[h.gang].men[h.man];
    m.flinch = 1;
    m.flinch_dir = d;
    m.body.vel += flat(d) * vec.s(1.5);
}

/// A grenade blast: each roadman in the radius flinches and stumbles back.
pub fn blast(p: V3, r: f32) void {
    for (&gangs) |*g| {
        if (!g.on) continue;
        for (&g.men) |*m| {
            const away = m.body.pos + v3(0, 1, 0) - p;
            const d = vec.len(away);
            if (d > r) continue;
            const dir = if (d > 1e-3) away / vec.s(d) else v3(0, 1, 0);
            m.flinch = 1;
            m.flinch_dir = dir;
            m.body.vel += flat(dir) * vec.s(5 * (1 - d / r)) + v3(0, 2, 0);
            m.body.grounded = false;
        }
    }
}

/// The roadmen of all the gangs, into the dynamic mesh.
pub fn build(out: *mesh.Mesh) void {
    for (&gangs) |*g| {
        if (!g.on) continue;
        for (&g.men) |*m| npc.build(out, pose(m));
    }
}

/// The number of gangs: the tests and the debug screen.
pub fn count() usize {
    var c: usize = 0;
    for (&gangs) |*g| c += @intFromBool(g.on);
    return c;
}
