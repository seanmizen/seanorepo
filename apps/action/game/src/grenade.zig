// Impact grenades: the flight, the smoke trail, the blast and its damage,
// and the debug view of the blast volume.
//
// - G throws one (main.zig). It flies under gravity and goes off at the
//   first contact with a solid map box or a player box.
// - The flight is deterministic: the same start point and velocity give the
//   same path on each client. In deathmatch the thrower sends them, and the
//   other clients fly a copy for the visuals. Only the thrower's client
//   calculates the damage (main.zig onBlast).
// - The trail: soft smoke puffs every 20 ms along the path. They grow, drift
//   up and fade out in 1.5 s. They are translucent billboards
//   (render.zig, the translucent pipeline).
// - The blast: a short flash (a point light and a hot core), yellow-white
//   streaks that fly out from the point and cool to orange, and a little
//   smoke. The core and the streaks are glowing billboards, and the shader
//   skips the lights for them. Each blast adds few quads, and most of them
//   are thin, so several blasts near the eye cost little.
// - Damage: radius 5 m. 100 to 1.5 m, then it falls linearly to 0 at 5 m.
//   Cover: three points on the target (feet + 0.3, chest 1.2, head 1.6). A
//   point counts only if a ray from the blast to it hits no solid box. Each
//   visible point gives a third of the falloff at its distance, so cover
//   that hides the legs takes off about a third.
// - Debug (Cmd+D): the predicted path of the aimed throw as a dotted line,
//   and for the predicted impact and each live grenade a grid of small
//   translucent cubes. Each cube marks a point where a player would get hit:
//   inside the radius, not in a solid box, and in sight of the blast. Red is
//   the centre, yellow the edge.
//
// Translucent vertex encoding (scene.wgsl fs_trans):
//   - a billboard: nrm.xy the quad UV in [-1, 1], nrm.z the emission,
//     mat = -alpha (negative). The alpha falls off to the edge of the
//     ellipse in the quad, so a long quad is a streak with soft ends.
//   - a shaded volume: nrm the face normal, mat = +alpha.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const mesh = @import("mesh.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

pub const throw_speed: f32 = 18;
pub const throw_up: f32 = 2.5;
pub const gravity: f32 = 18;
pub const radius: f32 = 5;
pub const kill_radius: f32 = 1.5;
pub const max_damage: f32 = 100;
/// Throws per life in deathmatch. The server has the same number.
pub const per_life: u32 = 3;
pub const cooldown: f32 = 0.8;
/// A grenade that touches nothing goes off after this time.
pub const max_flight: f32 = 6;
/// The time between two trail puffs.
const puff_every: f32 = 0.02;
const trail_life: f32 = 1.5;
/// The streaks of one blast.
const streaks_per_blast = 28;
/// The drag on a streak (1/s). A streak with speed v stops at v / drag,
/// so the streaks reach 2.8 to 5.2 m: about the blast radius.
const streak_drag: f32 = 5;
/// The tail of a streak is where its head was this long ago, so a fast
/// streak is long and a slow one is short.
const streak_lag: f32 = 0.06;
const flash_life: f32 = 0.15;

/// A box that stops a grenade: a player's head or body, or a practice
/// plate. A grenade passes through the boxes of its own thrower.
pub const Body = struct { min: V3, max: V3, id: u32 };

pub const Grenade = struct {
    pos: V3,
    vel: V3,
    owner: u32,
    /// True for a grenade of this client: it calculates the damage.
    mine: bool,
    age: f32 = 0,
    puff_t: f32 = 0,
    spin: f32 = 0,
};

/// A detonation. main.zig plays it and, for `mine`, applies the damage.
pub const Blast = struct {
    pos: V3,
    /// The surface normal at the impact (up for an air burst).
    normal: V3,
    owner: u32,
    mine: bool,
};

const Puff = struct {
    p: V3,
    v: V3,
    age: f32,
    life: f32,
    size0: f32,
    size1: f32,
    alpha: f32,
    col: V3,
    /// > 0: the hot core of a blast. It glows and is not lit.
    emit: f32,
};

/// A hot fragment that flies out from a blast in a straight line. Its
/// position is a function of its age (see streakAt).
const Streak = struct {
    o: V3,
    /// A unit vector.
    dir: V3,
    speed: f32,
    age: f32,
    life: f32,
    /// The half width of the billboard.
    width: f32,
};

const Flash = struct { p: V3, life: f32 };

var grenades: [16]Grenade = undefined;
pub var count: usize = 0;
var puffs: [640]Puff = undefined;
var puff_n: usize = 0;
var streaks: [8 * streaks_per_blast]Streak = undefined;
var streak_n: usize = 0;
var flashes: [4]Flash = undefined;
var flash_n: usize = 0;
var blasts: [16]Blast = undefined;
var rng: std.Random.DefaultPrng = .init(31);
/// The throw animation of the view-model: 1 just after a throw, then 0.
pub var throw_anim: f32 = 0;

fn rand() f32 {
    return rng.random().float(f32);
}

/// A random unit vector, with the same chance for each direction.
fn randDir() V3 {
    while (true) {
        const r = v3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        const l2 = vec.dot(r, r);
        if (l2 > 0.01 and l2 <= 1) return r / vec.s(@sqrt(l2));
    }
}

/// Remove all grenades, smoke and flashes (a mode or map change).
pub fn reset() void {
    count = 0;
    puff_n = 0;
    streak_n = 0;
    flash_n = 0;
    throw_anim = 0;
}

/// The start point and velocity of a throw from this eye and look.
pub fn throwFrom(eye: V3, yaw: f32, pitch: f32, player_vel: V3) struct { o: V3, v: V3 } {
    const f = vec.forward(yaw, pitch);
    const right = v3(@cos(yaw), 0, -@sin(yaw));
    var o = eye + f * vec.s(0.45) + right * vec.s(0.12) - v3(0, 0.08, 0);
    // Do not start inside a wall: stay on the eye side of it.
    const to = o - eye;
    const l = vec.len(to);
    if (map.raycast(eye, to / vec.s(l), l)) |h| o = eye + to / vec.s(l) * vec.s(@max(0, h.t - 0.05));
    // Round to the 3 decimals of the "nade" message, so the thrower flies
    // the same path as the other clients.
    return .{ .o = milli(o), .v = milli(f * vec.s(throw_speed) + v3(0, throw_up, 0) + player_vel) };
}

fn milli(p: V3) V3 {
    return @round(p * vec.s(1000)) / vec.s(1000);
}

pub fn spawn(o: V3, v: V3, owner: u32, mine: bool) void {
    if (count == grenades.len) return;
    grenades[count] = .{ .pos = o, .vel = v, .owner = owner, .mine = mine, .spin = rand() * 6 };
    count += 1;
    if (mine) throw_anim = 1;
}

const Contact = struct { t: f32, n: V3 };

/// The first contact on the segment p -> p + d * len, with the map or a body.
fn contact(p: V3, d: V3, l: f32, bodies: []const Body, owner: u32) ?Contact {
    var best: ?Contact = null;
    if (map.raycast(p, d, l)) |h| best = .{ .t = h.t, .n = h.normal };
    for (bodies) |b| {
        if (b.id == owner) continue;
        if (map.rayBox(p, d, b.min, b.max)) |h| {
            if (h.t <= l and (best == null or h.t < best.?.t)) best = .{ .t = h.t, .n = h.n };
        }
    }
    return best;
}

/// One fixed step of one grenade. Returns the impact point and normal when
/// it hits something in this step.
fn advance(pos: *V3, vel: *V3, dt: f32, bodies: []const Body, owner: u32) ?Contact {
    vel.*[1] -= gravity * dt;
    const mv = vel.* * vec.s(dt);
    const l = vec.len(mv);
    if (l < 1e-6) return null;
    const d = mv / vec.s(l);
    if (contact(pos.*, d, l, bodies, owner)) |c| {
        pos.* += d * vec.s(c.t);
        // An inside start (t = 0, no normal): use the reverse of the flight.
        return .{ .t = c.t, .n = if (vec.dot(c.n, c.n) > 0.5) c.n else -d };
    }
    pos.* += mv;
    return null;
}

fn addPuff(p: Puff) void {
    puffs[puff_n % puffs.len] = p;
    puff_n += 1;
}

/// Step the grenades, the smoke and the flashes. Returns the blasts of
/// this step.
pub fn step(dt: f32, bodies: []const Body) []const Blast {
    throw_anim = @max(0, throw_anim - dt / 0.45);
    var nb: usize = 0;
    var i: usize = 0;
    while (i < count) {
        const g = &grenades[i];
        const before = g.pos;
        g.age += dt;
        g.spin += dt * 14;
        const hit = advance(&g.pos, &g.vel, dt, bodies, g.owner);
        // The trail: a puff each 20 ms, placed along this step.
        g.puff_t += dt;
        while (g.puff_t >= puff_every) {
            g.puff_t -= puff_every;
            const k = 1 - g.puff_t / dt;
            addPuff(.{
                .p = vec.lerp(before, g.pos, std.math.clamp(k, 0, 1)) + v3(rand() - 0.5, rand() - 0.5, rand() - 0.5) * vec.s(0.04),
                .v = v3((rand() - 0.5) * 0.12, 0.18 + rand() * 0.12, (rand() - 0.5) * 0.12),
                .age = 0,
                .life = trail_life * (0.8 + rand() * 0.4),
                .size0 = 0.08,
                .size1 = 0.32 + rand() * 0.15,
                .alpha = 0.42,
                .col = v3(0.78, 0.78, 0.8),
                .emit = 0,
            });
        }
        if (hit != null or g.age > max_flight or g.pos[1] < map.kill_y) {
            const n = if (hit) |h| h.n else v3(0, 1, 0);
            if (nb < blasts.len) {
                blasts[nb] = .{ .pos = g.pos, .normal = n, .owner = g.owner, .mine = g.mine };
                nb += 1;
            }
            explodeFx(g.pos, n);
            grenades[i] = grenades[count - 1];
            count -= 1;
            continue;
        }
        i += 1;
    }
    for (puffs[0..@min(puff_n, puffs.len)]) |*p| {
        if (p.age >= p.life) continue;
        p.age += dt;
        p.p += p.v * vec.s(dt);
        p.v = p.v * vec.s(1 - 1.8 * dt) + v3(0, 0.25 * dt, 0);
    }
    for (streaks[0..@min(streak_n, streaks.len)]) |*st| {
        if (st.age < st.life) st.age += dt;
    }
    for (flashes[0..flash_n]) |*f| f.life -= dt;
    while (flash_n > 0 and flashes[0].life <= 0) {
        for (1..flash_n) |k| flashes[k - 1] = flashes[k];
        flash_n -= 1;
    }
    return blasts[0..nb];
}

/// The flash, the streaks and the smoke of a blast.
fn explodeFx(p: V3, n: V3) void {
    if (flash_n == flashes.len) {
        for (1..flash_n) |k| flashes[k - 1] = flashes[k];
        flash_n -= 1;
    }
    flashes[flash_n] = .{ .p = p + n * vec.s(0.6), .life = flash_life };
    flash_n += 1;
    // The core: one white-hot billboard that grows and goes in 0.1 s.
    addPuff(.{
        .p = p + n * vec.s(0.25),
        .v = v3(0, 0, 0),
        .age = 0,
        .life = 0.1,
        .size0 = 0.6,
        .size1 = 1.6,
        .alpha = 1,
        .col = v3(1.0, 0.88, 0.6),
        .emit = 8,
    });
    // The streaks: out over the open side of the surface. A mirror turns
    // a direction into the surface to the open side, then it leans out.
    for (0..streaks_per_blast) |_| {
        var r = randDir();
        const into = vec.dot(r, n);
        if (into < 0) r -= n * vec.s(2 * into);
        streaks[streak_n % streaks.len] = .{
            .o = p + n * vec.s(0.05),
            .dir = vec.norm(r + n * vec.s(0.35)),
            .speed = 14 + rand() * 12,
            .age = 0,
            .life = 0.25 + rand() * 0.2,
            .width = 0.018 + rand() * 0.012,
        };
        streak_n += 1;
    }
    // A little smoke: grey puffs that rise and hang for about 2 s.
    for (0..6) |_| {
        const r = v3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
        const g = 0.24 + rand() * 0.08;
        addPuff(.{
            .p = p + n * vec.s(0.3) + r * vec.s(0.5),
            .v = n * vec.s(0.8) + r * vec.s(1.2) + v3(0, 0.4, 0),
            .age = 0,
            .life = 1.4 + rand() * 0.6,
            .size0 = 0.35,
            .size1 = 1.2 + rand() * 0.5,
            .alpha = 0.5,
            .col = v3(g, g, g * 1.02),
            .emit = 0,
        });
    }
}

/// The point of a streak at age t: it slows with drag and drops a little.
fn streakAt(st: Streak, t: f32) V3 {
    const d = st.speed / streak_drag * (1 - @exp(-streak_drag * t));
    return st.o + st.dir * vec.s(d) - v3(0, 3 * t * t, 0);
}

/// The point lights of the blasts: a short bright flash each. The square
/// makes it fall off fast, so it reads as a flash and not a glow.
pub fn lights(out: []map.Light) usize {
    var n: usize = 0;
    for (flashes[0..flash_n]) |f| {
        if (n == out.len or f.life <= 0) break;
        const k = f.life / flash_life;
        out[n] = .{ .pos = f.p, .color = v3(40, 24, 10) * vec.s(k * k), .radius = 16 };
        n += 1;
    }
    return n;
}

// ---- Damage ----------------------------------------------------------------

/// The damage at distance d from a blast, in the open.
pub fn falloff(d: f32) f32 {
    return max_damage * vec.clamp01((radius - d) / (radius - kill_radius));
}

/// The blast origin for the sight lines: a little off the surface.
fn origin(b: Blast) V3 {
    return b.pos + b.normal * vec.s(0.1);
}

fn visible(o: V3, p: V3) bool {
    const d = p - o;
    const l = vec.len(d);
    if (l < 1e-4) return true;
    return map.raycast(o, d / vec.s(l), l) == null;
}

/// The damage to a player (0 to 100). `pts` are the legs, the chest and the
/// head of the player (player.zig blastPoints, with the lean).
pub fn damageTo(b: Blast, pts: [3]V3) f32 {
    const o = origin(b);
    var sum: f32 = 0;
    for (pts) |p| {
        const d = vec.len(p - o);
        if (d >= radius or !visible(o, p)) continue;
        sum += falloff(d);
    }
    return sum / 3;
}

/// True when a point (a practice plate) is in the blast and in sight of it.
pub fn reaches(b: Blast, p: V3) bool {
    const o = origin(b);
    return vec.len(p - o) < radius and visible(o, p);
}

// ---- Prediction and debug --------------------------------------------------

pub const Prediction = struct {
    /// The path, one point each 3 steps (25 ms).
    points: [200]V3 = undefined,
    n: usize = 0,
    impact: ?Blast = null,
};

/// Fly a throw without side effects: the path and the impact point.
pub fn predict(o: V3, v: V3, dt: f32, bodies: []const Body, owner: u32) Prediction {
    var pr: Prediction = .{};
    var pos = o;
    var vel = v;
    var t: f32 = 0;
    var k: usize = 0;
    while (t < max_flight) : (t += dt) {
        if (k % 3 == 0 and pr.n < pr.points.len) {
            pr.points[pr.n] = pos;
            pr.n += 1;
        }
        k += 1;
        if (advance(&pos, &vel, dt, bodies, owner)) |c| {
            pr.impact = .{ .pos = pos, .normal = c.n, .owner = owner, .mine = true };
            break;
        }
        if (pos[1] < map.kill_y) break;
    }
    return pr;
}

/// One cached blast volume: the grid points where a player would get hit.
const Cell = struct { p: V3, dmg: f32 };
const Volume = struct {
    key: [3]i32 = .{ 0, 0, 0 },
    used: bool = false,
    last: u64 = 0,
    cells: std.ArrayList(Cell) = .empty,
};
const grid: f32 = 0.6;
var volumes: [4]Volume = @splat(.{});
var frame: u64 = 0;
pub var debug_cells: usize = 0;

fn keyOf(p: V3) [3]i32 {
    // 0.25 m steps: a small aim change does not recalculate the volume.
    return .{ @intFromFloat(@round(p[0] * 4)), @intFromFloat(@round(p[1] * 4)), @intFromFloat(@round(p[2] * 4)) };
}

/// The cached volume of a blast, calculated on the first use.
fn volumeFor(alloc: std.mem.Allocator, b: Blast) *const Volume {
    const key = keyOf(b.pos);
    var slot: *Volume = &volumes[0];
    for (&volumes) |*v| {
        if (v.used and std.mem.eql(i32, &v.key, &key)) {
            v.last = frame;
            return v;
        }
        if (!v.used or v.last < slot.last) slot = v;
    }
    slot.key = key;
    slot.used = true;
    slot.last = frame;
    slot.cells.clearRetainingCapacity();
    const o = origin(b);
    // Only the boxes near the blast can block a sight line in it.
    var near: [map.max_boxes]u16 = undefined;
    var nn: usize = 0;
    for (map.boxes[0..map.box_count], 0..) |bx, i| {
        if (!bx.solid) continue;
        const c = @max(bx.min, @min(o, bx.max));
        if (vec.len(c - o) < radius) {
            near[nn] = @intCast(i);
            nn += 1;
        }
    }
    const lo = @floor((o - vec.s(radius)) / vec.s(grid));
    const hi = @ceil((o + vec.s(radius)) / vec.s(grid));
    var z = lo[2];
    while (z <= hi[2]) : (z += 1) {
        var y = lo[1];
        while (y <= hi[1]) : (y += 1) {
            var x = lo[0];
            point: while (x <= hi[0]) : (x += 1) {
                const p = v3(x, y, z) * vec.s(grid);
                const d = p - o;
                const l = vec.len(d);
                if (l >= radius) continue;
                for (near[0..nn]) |bi| {
                    const bx = map.boxes[bi];
                    if (@reduce(.And, p > bx.min) and @reduce(.And, p < bx.max)) continue :point;
                }
                if (l > 1e-4) {
                    const dir = d / vec.s(l);
                    for (near[0..nn]) |bi| {
                        const bx = map.boxes[bi];
                        if (map.rayBox(o, dir, bx.min, bx.max)) |h| if (h.t < l) continue :point;
                    }
                }
                slot.cells.append(alloc, .{ .p = p, .dmg = falloff(l) }) catch return slot;
            }
        }
    }
    return slot;
}

fn drawVolume(alloc: std.mem.Allocator, trans: *mesh.Mesh, b: Blast) void {
    const vol = volumeFor(alloc, b);
    const h: f32 = 0.09;
    for (vol.cells.items) |c| {
        const k = c.dmg / max_damage;
        const col = vec.lerp(v3(1.0, 0.95, 0.15), v3(1.0, 0.1, 0.05), k);
        trans.orientedBox(Mat4.identity(), c.p - vec.s(h), c.p + vec.s(h), col, 0.25);
    }
    debug_cells += vol.cells.items.len;
}

/// The debug view: the dotted path of the aimed throw (opaque, glowing) and
/// the blast volumes (translucent). `aim` is null when no throw is possible.
pub fn buildDebug(alloc: std.mem.Allocator, dyn: *mesh.Mesh, trans: *mesh.Mesh, aim: ?Prediction) void {
    frame += 1;
    debug_cells = 0;
    if (aim) |pr| {
        for (pr.points[0..pr.n], 0..) |p, i| {
            // Dotted, and not the first 0.2 s: those dots fill the view.
            if (i % 2 == 1 or i < 8) continue;
            dyn.box(p - vec.s(0.025), p + vec.s(0.025), v3(0.3, 0.9, 1.0), 4);
        }
        if (pr.impact) |b| {
            dyn.box(b.pos - vec.s(0.07), b.pos + vec.s(0.07), v3(1.0, 0.3, 0.2), 4);
            drawVolume(alloc, trans, b);
        }
    }
    for (grenades[0..count]) |g| {
        // The impact of a live grenade: fly the rest of its path.
        const pr = predict(g.pos, g.vel, 1.0 / 120.0, &.{}, g.owner);
        if (pr.impact) |b| drawVolume(alloc, trans, b);
    }
}

// ---- Drawing ---------------------------------------------------------------

/// The grenade bodies: a dark olive egg with a lever, spinning.
pub fn buildOpaque(dyn: *mesh.Mesh) void {
    for (grenades[0..count]) |g| {
        const m = vec.ypr(g.pos, g.spin * 0.6, g.spin, 0);
        dyn.orientedBox(m, v3(-0.045, -0.06, -0.045), v3(0.045, 0.06, 0.045), v3(0.2, 0.24, 0.1), 0);
        dyn.orientedBox(m, v3(-0.03, -0.07, -0.03), v3(0.03, 0.07, 0.03), v3(0.17, 0.2, 0.08), 0);
        dyn.orientedBox(m, v3(0.035, 0.0, -0.01), v3(0.05, 0.08, 0.01), v3(0.4, 0.4, 0.38), 3);
    }
}

/// The smoke and the blast core as camera-facing quads, and the streaks as
/// long quads that turn about their own axis to face the camera.
/// A streak quad has u = -0.3 at the head and u = 1 at the tail. The
/// ellipse of fs_trans then makes a comet: full width just behind the
/// head, thin and faint at the tail.
pub fn buildTranslucent(trans: *mesh.Mesh, right: V3, up: V3) void {
    const uv = [4][2]f32{ .{ -1, -1 }, .{ 1, -1 }, .{ 1, 1 }, .{ -1, 1 } };
    const tris = [6]usize{ 0, 1, 2, 0, 2, 3 };
    for (puffs[0..@min(puff_n, puffs.len)]) |p| {
        if (p.age >= p.life) continue;
        const k = p.age / p.life;
        const size = p.size0 + (p.size1 - p.size0) * (1 - (1 - k) * (1 - k));
        // Fade in over the first tenth, then out.
        const a = p.alpha * vec.smooth(k * 10) * std.math.pow(f32, 1 - k, 1.5);
        if (a < 0.005) continue;
        const r = right * vec.s(size);
        const u = up * vec.s(size);
        const corners = [4]V3{ p.p - r - u, p.p + r - u, p.p + r + u, p.p - r + u };
        for (tris) |ci| {
            trans.push(corners[ci], v3(uv[ci][0], uv[ci][1], p.emit), p.col, -a);
        }
    }
    const fwd = vec.cross(up, right);
    for (streaks[0..@min(streak_n, streaks.len)]) |st| {
        if (st.age >= st.life) continue;
        const k = st.age / st.life;
        const head = streakAt(st, st.age);
        const tail = streakAt(st, @max(0, st.age - streak_lag));
        const ax = head - tail;
        const l = vec.len(ax);
        if (l < 1e-3) continue;
        const along = ax / vec.s(l);
        var side = vec.cross(along, fwd);
        const sl = vec.len(side);
        side = if (sl > 0.05) side / vec.s(sl) else up;
        const w = st.width * (1 - 0.6 * k);
        const s = side * vec.s(w);
        const h0 = head + along * vec.s(w);
        const corners = [4]V3{ tail - s, h0 - s, h0 + s, tail + s };
        // White-hot at the head, it cools to orange.
        const fade = std.math.pow(f32, 1 - k, 1.3);
        const head_col = vec.lerp(v3(1.0, 0.82, 0.42), v3(1.0, 0.5, 0.12), k);
        const tail_col = v3(1.0, 0.42, 0.08);
        const emit = 10 - 5 * k;
        for (tris) |ci| {
            const at_head = ci == 1 or ci == 2;
            trans.push(
                corners[ci],
                v3(if (at_head) -0.3 else 1, uv[ci][1], emit),
                if (at_head) head_col else tail_col,
                -(if (at_head) fade else 0.5 * fade),
            );
        }
    }
}

/// The view-model offset of the throw: the gun dips and tilts down.
pub fn viewDip() Mat4 {
    if (throw_anim <= 0) return Mat4.identity();
    const k = @sin((1 - throw_anim) * std.math.pi);
    return vec.translate(v3(0, -0.14 * k, 0.04 * k)).mul(Mat4.rotationX(-0.55 * k));
}

pub fn puffCount() usize {
    var n: usize = 0;
    for (puffs[0..@min(puff_n, puffs.len)]) |p| {
        if (p.age < p.life) n += 1;
    }
    return n;
}
