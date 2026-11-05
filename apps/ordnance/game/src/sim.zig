//! The simulation. It is deterministic: the same commands on the same ticks
//! give the same game. It has no random numbers. Each rule breaks a tie by
//! the lower unit id.
//!
//! The player does not move units. The player changes the map (tracks,
//! roads) and sets a posture for each sector. The units find the rest:
//! - Infantry reads the posture of its sector, its supply and its strength,
//!   and steps one square at a time.
//! - Engineers take the build jobs in the order of the orders.
//! - Trucks carry supply from the depot to the infantry that needs it most.
//!   A truck uses only roads and tracks. Its path cost is time + risk.
//! - The enemy artillery shells the blue units that the enemy can see.
const std = @import("std");
const map = @import("map.zig");

pub const tick_hz = 30;
pub const sectors = 4;
pub const sector_w = map.size / sectors;

pub const Side = enum(u8) { blue, red };
pub const Kind = enum(u8) { infantry, engineer, truck };
pub const Posture = enum(u8) { push, hold, back };
pub const JobKind = enum(u8) { track, road };
pub const Outcome = enum(u8) { playing, won, lost };

/// The state of a truck or an engineer.
pub const Task = enum(u8) { idle, loading, outbound, working, unloading, inbound };

pub const none: u8 = 255;
pub const max_units = 64;
pub const max_path = 200;
pub const max_jobs = 96;
pub const max_shells = 8;
pub const max_marks = 24;

// The rules, in seconds, squares and points.
pub const decide_ticks = 15;
pub const truck_cargo = 40;
pub const truck_count = 6;
pub const truck_build_s = 40;
pub const engineer_count = 2;
pub const supply_rate = 1.2;
pub const materials_rate = 0.6;
pub const supply_cap = 400;
pub const materials_cap = 200;
pub const hold_to_win_s = 90;
pub const shell_flight_s = 4;
pub const shell_reload_s = 9;
pub const shell_radius = 0.75;
pub const observe_s = 2;

pub fn jobCost(k: JobKind) f32 {
    return switch (k) {
        .track => 8,
        .road => 20,
    };
}
pub fn jobSeconds(k: JobKind) f32 {
    return switch (k) {
        .track => 5,
        .road => 8,
    };
}

pub const Unit = struct {
    alive: bool = false,
    side: Side = .blue,
    kind: Kind = .infantry,
    x: f32 = 0,
    y: f32 = 0,
    strength: f32 = 100,
    supply: f32 = 100,
    engaged: bool = false,
    path: [max_path]u16 = @splat(0),
    path_len: u16 = 0,
    path_i: u16 = 0,
    task: Task = .idle,
    timer: u32 = 0,
    /// A truck: the unit that its cargo is for.
    client: u8 = none,
    /// An engineer: its job.
    job: u8 = none,

    pub fn cell(u: *const Unit) u16 {
        return map.cellAt(u.x, u.y);
    }
    pub fn moving(u: *const Unit) bool {
        return u.path_i < u.path_len;
    }
};

pub const Job = struct {
    active: bool = false,
    cell: u16 = 0,
    kind: JobKind = .track,
    seq: u32 = 0,
    engineer: u8 = none,
};

pub const Shell = struct {
    active: bool = false,
    x: f32 = 0,
    y: f32 = 0,
    timer: u32 = 0,
};

/// A short mark for the renderer: a shell burst or a wreck.
pub const Mark = struct {
    kind: enum(u8) { none, burst, wreck } = .none,
    x: f32 = 0,
    y: f32 = 0,
    tick: u64 = 0,
};

pub const Command = union(enum) {
    build: struct { cell: u16, kind: JobKind },
    cancel: struct { cell: u16 },
    posture: struct { sector: u8, posture: Posture },
};

/// The red observation posts on the hill: (x, y, eye height in metres).
pub const observation_posts = [_][3]f32{ .{ 20.5, 4.5, 10 }, .{ 15.5, 6.5, 6 }, .{ 26.5, 6.5, 6 } };
pub const post_range = 24;
pub const infantry_range = 5;
/// The red batteries, behind the hill.
pub const batteries = [_][2]f32{ .{ 17.5, 1.5 }, .{ 23.5, 1.5 } };

pub const Stats = struct {
    trucks_lost: u32 = 0,
    supply_delivered: f32 = 0,
    shells: u32 = 0,
};

pub const Sim = struct {
    m: map.Map,
    units: [max_units]Unit,
    jobs: [max_jobs]Job,
    shells: [max_shells]Shell,
    marks: [max_marks]Mark,
    mark_next: u8,
    posture: [2][sectors]Posture,
    /// True for each square that red can see now.
    seen: [map.cells]bool,
    supply: f32,
    materials: f32,
    tick: u64,
    job_seq: u32,
    battery_timer: [batteries.len]u32,
    truck_timer: u32,
    hold_ticks: u32,
    outcome: Outcome,
    stats: Stats,
    /// Scratch for the route search.
    dist: [map.cells]f32,
    prev: [map.cells]u16,

    pub fn init(s: *Sim) void {
        s.m.generate();
        s.units = @splat(.{});
        s.jobs = @splat(.{});
        s.shells = @splat(.{});
        s.marks = @splat(.{});
        s.mark_next = 0;
        s.posture = .{ @splat(.hold), @splat(.hold) };
        s.seen = @splat(false);
        s.supply = 200;
        s.materials = 120;
        s.tick = 0;
        s.job_seq = 0;
        s.battery_timer = .{ 5 * tick_hz, 9 * tick_hz };
        s.truck_timer = 0;
        s.hold_ticks = 0;
        s.outcome = .playing;
        s.stats = .{};
        for ([_][2]i32{ .{ 4, 25 }, .{ 8, 25 }, .{ 12, 26 }, .{ 17, 26 }, .{ 24, 26 }, .{ 28, 26 }, .{ 35, 25 }, .{ 37, 25 } }) |p| _ = s.spawn(.blue, .infantry, p[0], p[1]);
        for ([_][2]i32{ .{ 5, 13 }, .{ 9, 13 }, .{ 13, 14 }, .{ 17, 13 }, .{ 20, 11 }, .{ 24, 13 }, .{ 29, 14 }, .{ 35, 13 } }) |p| _ = s.spawn(.red, .infantry, p[0], p[1]);
        for (0..engineer_count) |_| _ = s.spawn(.blue, .engineer, map.depot[0], map.depot[1]);
        for (0..truck_count) |_| _ = s.spawn(.blue, .truck, map.depot[0], map.depot[1]);
        s.observe();
    }

    fn spawn(s: *Sim, side: Side, kind: Kind, x: i32, y: i32) ?u8 {
        for (&s.units, 0..) |*u, i| {
            if (u.alive) continue;
            u.* = .{ .alive = true, .side = side, .kind = kind, .x = @as(f32, @floatFromInt(x)) + 0.5, .y = @as(f32, @floatFromInt(y)) + 0.5 };
            if (kind == .infantry) u.supply = 80;
            return @intCast(i);
        }
        return null;
    }

    pub fn sectorOf(x: f32) u8 {
        return @intCast(std.math.clamp(@divFloor(@as(i32, @intFromFloat(@floor(x))), sector_w), 0, sectors - 1));
    }

    // ------------------------------------------------------------ commands

    pub fn apply(s: *Sim, cmd: Command) void {
        switch (cmd) {
            .build => |b| s.addJob(b.cell, b.kind),
            .cancel => |c| for (&s.jobs) |*j| {
                if (!j.active or j.cell != c.cell) continue;
                if (j.engineer != none) {
                    // The engineer stops. The materials are spent.
                    const e = &s.units[j.engineer];
                    e.job = none;
                    e.task = .idle;
                    e.path_len = 0;
                }
                j.* = .{};
            },
            .posture => |p| s.posture[@backingInt(Side.blue)][p.sector] = p.posture,
        }
    }

    /// True when a job of this kind can go on the square.
    pub fn canBuild(s: *const Sim, c: u16, kind: JobKind) bool {
        if (s.m.ground[c] == .water) return false;
        const want: map.Way = if (kind == .track) .track else .road;
        if (@backingInt(s.m.way[c]) >= @backingInt(want)) return false;
        for (s.jobs) |j| if (j.active and j.cell == c) return false;
        return true;
    }

    fn addJob(s: *Sim, c: u16, kind: JobKind) void {
        if (!s.canBuild(c, kind)) return;
        for (&s.jobs) |*j| {
            if (j.active) continue;
            j.* = .{ .active = true, .cell = c, .kind = kind, .seq = s.job_seq };
            s.job_seq += 1;
            return;
        }
    }

    // ------------------------------------------------------------ the step

    /// Advance the game one tick.
    pub fn step(s: *Sim) void {
        if (s.outcome != .playing) return;
        s.tick += 1;
        const dt: f32 = 1.0 / @as(f32, tick_hz);
        s.supply = @min(supply_cap, s.supply + supply_rate * dt);
        s.materials = @min(materials_cap, s.materials + materials_rate * dt);
        if (s.tick % (observe_s * tick_hz) == 0) s.observe();
        if (s.tick % decide_ticks == 0) {
            s.fight();
            s.decideInfantry();
            if (s.tick % (10 * tick_hz) == 0) s.redCommander();
        }
        for (0..max_units) |i| {
            const u = &s.units[i];
            if (!u.alive) continue;
            switch (u.kind) {
                .truck => s.truckStep(@intCast(i)),
                .engineer => s.engineerStep(@intCast(i)),
                .infantry => {},
            }
            s.move(u, dt);
        }
        s.artillery();
        s.reinforce();
        s.checkOutcome();
    }

    // ------------------------------------------------------------ sight

    /// Find each square that red can see: from the observation posts, and
    /// from each red squad.
    pub fn observe(s: *Sim) void {
        s.seen = @splat(false);
        for (observation_posts) |p| s.observeFrom(p[0], p[1], p[2], post_range);
        for (s.units) |u| if (u.alive and u.side == .red) s.observeFrom(u.x, u.y, 2, infantry_range);
    }

    fn observeFrom(s: *Sim, ox: f32, oy: f32, eye: f32, range: f32) void {
        for (0..map.cells) |c| {
            if (s.seen[c]) continue;
            const tx = @as(f32, @floatFromInt(map.cellX(@intCast(c)))) + 0.5;
            const ty = @as(f32, @floatFromInt(map.cellY(@intCast(c)))) + 0.5;
            const dx = tx - ox;
            const dy = ty - oy;
            if (dx * dx + dy * dy > range * range) continue;
            if (s.m.sees(ox, oy, eye, tx, ty)) s.seen[c] = true;
        }
    }

    // ------------------------------------------------------------ movement

    /// The speed of a unit that enters square `to` from square `from`, in
    /// squares per second. 0: it cannot enter.
    pub fn speed(s: *const Sim, kind: Kind, from: u16, to: u16) f32 {
        const way = s.m.way[to];
        const ground = s.m.ground[to];
        var v: f32 = switch (kind) {
            .truck => switch (way) {
                .road => 1.2,
                .track => 0.7,
                .none => 0,
            },
            else => if (way != .none) 0.16 else switch (ground) {
                .water => 0,
                .wood => 0.07,
                else => 0.12,
            },
        };
        // Engineers ride in a light vehicle on a way, and walk off it.
        if (kind == .engineer) v = if (way != .none) 0.8 else v * 1.6;
        if (kind == .truck and s.m.hedgeBetween(from, to)) v = 0;
        if (v == 0) return 0;
        const dh = @abs(s.m.cellHeight(to) - s.m.cellHeight(from));
        if (kind != .truck and s.m.hedgeBetween(from, to)) v *= 0.6;
        return v / (1 + dh / 15);
    }

    fn move(s: *Sim, u: *Unit, dt: f32) void {
        if (!u.moving()) return;
        if (u.kind != .infantry and (u.task == .loading or u.task == .unloading or u.task == .working)) return;
        const next = u.path[u.path_i];
        const tx = @as(f32, @floatFromInt(map.cellX(next))) + 0.5;
        const ty = @as(f32, @floatFromInt(map.cellY(next))) + 0.5;
        const v = s.speed(u.kind, u.cell(), next);
        const dx = tx - u.x;
        const dy = ty - u.y;
        const d = @sqrt(dx * dx + dy * dy);
        const stepd = @max(v, 0.05) * dt;
        if (d <= stepd) {
            u.x = tx;
            u.y = ty;
            u.path_i += 1;
        } else {
            u.x += dx / d * stepd;
            u.y += dy / d * stepd;
        }
    }

    pub const Mode = enum { truck, foot };

    /// The cost to enter square b from square a, in seconds. The risk of a
    /// square that red can see adds to the time.
    fn stepCost(s: *const Sim, mode: Mode, a: u16, b: u16) f32 {
        const v = s.speed(if (mode == .truck) .truck else .engineer, a, b);
        if (v == 0) return std.math.inf(f32);
        const risk: f32 = if (s.seen[b]) (if (mode == .truck) 12 else 6) else 0;
        return 1 / v + risk;
    }

    /// The cheapest cost from `start` to each square (s.dist), and the
    /// square before each one on that route (s.prev).
    pub fn route(s: *Sim, mode: Mode, start: u16) void {
        s.dist = @splat(std.math.inf(f32));
        s.prev = @splat(std.math.maxInt(u16));
        var heap: Heap = .{};
        s.dist[start] = 0;
        heap.push(.{ .cost = 0, .cell = start });
        while (heap.pop()) |e| {
            if (e.cost > s.dist[e.cell]) continue;
            const x = map.cellX(e.cell);
            const y = map.cellY(e.cell);
            for ([_][2]i32{ .{ 0, -1 }, .{ 1, 0 }, .{ 0, 1 }, .{ -1, 0 } }) |d| {
                const nx = x + d[0];
                const ny = y + d[1];
                if (!map.inside(nx, ny)) continue;
                const n = map.idx(nx, ny);
                const c = e.cost + s.stepCost(mode, e.cell, n);
                if (c < s.dist[n]) {
                    s.dist[n] = c;
                    s.prev[n] = e.cell;
                    heap.push(.{ .cost = c, .cell = n });
                }
            }
        }
    }

    /// Give the unit the route to `goal` from the last `route` call.
    /// False when no route goes there.
    fn takePath(s: *const Sim, u: *Unit, goal: u16) bool {
        if (std.math.isInf(s.dist[goal])) return false;
        var rev: [max_path]u16 = undefined;
        var n: usize = 0;
        var c = goal;
        while (s.prev[c] != std.math.maxInt(u16)) : (c = s.prev[c]) {
            if (n == max_path) return false;
            rev[n] = c;
            n += 1;
        }
        for (0..n) |i| u.path[i] = rev[n - 1 - i];
        u.path_len = @intCast(n);
        u.path_i = 0;
        return true;
    }

    // ------------------------------------------------------------ trucks

    fn depotCell() u16 {
        return map.idx(map.depot[0], map.depot[1]);
    }

    /// The way square near the squad where a truck can drop its cargo: the
    /// cheapest one from the depot within 2 squares. From s.dist.
    fn dropCell(s: *const Sim, squad: *const Unit) ?u16 {
        const sx = map.cellX(squad.cell());
        const sy = map.cellY(squad.cell());
        var best: ?u16 = null;
        var best_cost = std.math.inf(f32);
        var dy: i32 = -2;
        while (dy <= 2) : (dy += 1) {
            var dx: i32 = -2;
            while (dx <= 2) : (dx += 1) {
                if (!map.inside(sx + dx, sy + dy)) continue;
                const c = map.idx(sx + dx, sy + dy);
                if (s.dist[c] < best_cost) {
                    best_cost = s.dist[c];
                    best = c;
                }
            }
        }
        return best;
    }

    /// True when the blue squad has no truck route within 2 squares.
    pub fn cutOff(s: *Sim, id: u8) bool {
        s.route(.truck, depotCell());
        return s.dropCell(&s.units[id]) == null;
    }

    fn truckStep(s: *Sim, id: u8) void {
        const t = &s.units[id];
        switch (t.task) {
            .idle => {
                if (s.tick % decide_ticks != id % decide_ticks) return;
                if (t.cell() != depotCell()) {
                    s.route(.truck, t.cell());
                    if (s.takePath(t, depotCell())) t.task = .inbound;
                    return;
                }
                if (s.supply < truck_cargo) return;
                s.route(.truck, depotCell());
                // The squad with the least supply that no truck serves.
                var pick: ?u8 = null;
                var pick_drop: u16 = 0;
                for (s.units, 0..) |q, qi| {
                    if (!q.alive or q.side != .blue or q.kind != .infantry or q.supply >= 75) continue;
                    if (s.served(@intCast(qi))) continue;
                    const drop = s.dropCell(&q) orelse continue;
                    if (pick == null or q.supply < s.units[pick.?].supply) {
                        pick = @intCast(qi);
                        pick_drop = drop;
                    }
                }
                const q = pick orelse return;
                if (!s.takePath(t, pick_drop)) return;
                s.supply -= truck_cargo;
                t.client = q;
                t.task = .loading;
                t.timer = 2 * tick_hz;
            },
            .loading => {
                t.timer -|= 1;
                if (t.timer == 0) t.task = .outbound;
            },
            .outbound => if (!t.moving()) {
                t.task = .unloading;
                t.timer = 2 * tick_hz;
            },
            .unloading => {
                t.timer -|= 1;
                if (t.timer > 0) return;
                s.deliver(t);
                s.route(.truck, t.cell());
                t.task = if (s.takePath(t, depotCell())) .inbound else .idle;
            },
            .inbound => if (!t.moving()) {
                t.task = .idle;
            },
            .working => t.task = .idle,
        }
    }

    fn served(s: *const Sim, squad: u8) bool {
        for (s.units) |u| if (u.alive and u.kind == .truck and u.client == squad) return true;
        return false;
    }

    /// Give the cargo to the client, or to the squad near the truck with
    /// the least supply.
    fn deliver(s: *Sim, t: *Unit) void {
        var to: ?u8 = null;
        if (t.client != none and s.units[t.client].alive and near(t, &s.units[t.client], 3)) to = t.client;
        if (to == null) for (s.units, 0..) |q, qi| {
            if (!q.alive or q.side != .blue or q.kind != .infantry or !near(t, &q, 3)) continue;
            if (to == null or q.supply < s.units[to.?].supply) to = @intCast(qi);
        };
        t.client = none;
        const q = &s.units[to orelse return];
        const given = @min(truck_cargo, 100 - q.supply);
        q.supply += given;
        s.stats.supply_delivered += given;
    }

    fn near(a: *const Unit, b: *const Unit, r: f32) bool {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return dx * dx + dy * dy <= r * r;
    }

    fn reinforce(s: *Sim) void {
        var trucks: u32 = 0;
        for (s.units) |u| if (u.alive and u.kind == .truck) {
            trucks += 1;
        };
        if (trucks >= truck_count) {
            s.truck_timer = 0;
            return;
        }
        s.truck_timer += 1;
        if (s.truck_timer >= truck_build_s * tick_hz) {
            s.truck_timer = 0;
            _ = s.spawn(.blue, .truck, map.depot[0], map.depot[1]);
        }
    }

    // ------------------------------------------------------------ engineers

    fn engineerStep(s: *Sim, id: u8) void {
        const e = &s.units[id];
        switch (e.task) {
            .idle => {
                if (s.tick % decide_ticks != id % decide_ticks) return;
                // The first free job in the order of the orders.
                var pick: ?u8 = null;
                for (s.jobs, 0..) |j, ji| {
                    if (!j.active or j.engineer != none) continue;
                    if (pick == null or j.seq < s.jobs[pick.?].seq) pick = @intCast(ji);
                }
                if (pick) |ji| {
                    const j = &s.jobs[ji];
                    if (s.materials < jobCost(j.kind)) return;
                    s.route(.foot, e.cell());
                    if (!s.takePath(e, j.cell)) {
                        // No way there on foot: drop the job.
                        j.* = .{};
                        return;
                    }
                    s.materials -= jobCost(j.kind);
                    j.engineer = id;
                    e.job = ji;
                    e.task = .outbound;
                } else if (e.cell() != depotCell() and !e.moving()) {
                    s.route(.foot, e.cell());
                    _ = s.takePath(e, depotCell());
                }
            },
            .outbound => if (!e.moving()) {
                e.task = .working;
                e.timer = @intFromFloat(jobSeconds(s.jobs[e.job].kind) * tick_hz);
            },
            .working => {
                e.timer -|= 1;
                if (e.timer > 0) return;
                const j = &s.jobs[e.job];
                s.m.way[j.cell] = if (j.kind == .track) .track else .road;
                s.m.cutHedges(j.cell);
                j.* = .{};
                e.job = none;
                e.task = .idle;
            },
            else => e.task = .idle,
        }
    }

    // ------------------------------------------------------------ infantry

    fn forward(side: Side) i32 {
        return if (side == .blue) -1 else 1;
    }

    fn nearestEnemy(s: *const Sim, u: *const Unit, r: f32) ?u8 {
        var best: ?u8 = null;
        var best_d = r * r;
        for (s.units, 0..) |v, i| {
            if (!v.alive or v.side == u.side or v.kind != .infantry) continue;
            const dx = v.x - u.x;
            const dy = v.y - u.y;
            const d = dx * dx + dy * dy;
            if (d <= best_d) {
                best_d = d;
                best = @intCast(i);
            }
        }
        return best;
    }

    fn coverFactor(s: *const Sim, c: u16) f32 {
        return switch (s.m.ground[c]) {
            .wood => 0.55,
            .town => 0.45,
            else => 1.0,
        };
    }

    /// Each squad near an enemy squad fires at the nearest one. All damage
    /// lands at the same time.
    fn fight(s: *Sim) void {
        var damage: [max_units]f32 = @splat(0);
        for (&s.units) |*u| {
            if (!u.alive or u.kind != .infantry) continue;
            const target = s.nearestEnemy(u, 1.6);
            u.engaged = target != null;
            const t = target orelse {
                u.supply = @max(0, u.supply - 0.25);
                if (u.supply > 50 and u.strength < 100) {
                    u.strength = @min(100, u.strength + 0.5);
                    u.supply -= 0.3;
                }
                if (u.side == .red) s.redSupply(u);
                continue;
            };
            const fire: f32 = if (u.supply > 0) 1 else 0.25;
            damage[t] += 5 * (u.strength / 100) * fire * s.coverFactor(s.units[t].cell());
            u.supply = @max(0, u.supply - 1.5);
            if (u.side == .red) s.redSupply(u);
        }
        for (&s.units, 0..) |*u, i| {
            if (damage[i] == 0) continue;
            u.strength -= damage[i];
            if (u.strength <= 0) s.kill(u);
        }
    }

    /// The red supply comes from off the map at a fixed rate. It reaches
    /// only the squads near the red line.
    fn redSupply(s: *const Sim, u: *Unit) void {
        _ = s;
        if (u.y < 16) u.supply = @min(100, u.supply + 0.45);
    }

    fn occupied(s: *const Sim, c: u16, side: Side) bool {
        for (s.units) |u| {
            if (!u.alive or u.kind != .infantry or u.side != side) continue;
            if (u.cell() == c) return true;
            if (u.moving() and u.path[u.path_i] == c) return true;
        }
        return false;
    }

    /// The square one step from the squad in the direction dy (forward or
    /// back). Straight first, then a side step toward the sector centre,
    /// then the other side step.
    fn stepTarget(s: *const Sim, u: *const Unit, dy: i32) ?u16 {
        const c = u.cell();
        const x = map.cellX(c);
        const y = map.cellY(c);
        const centre = @as(i32, sectorOf(u.x)) * sector_w + sector_w / 2;
        const side: i32 = if (x < centre) 1 else -1;
        const options = [_][2]i32{ .{ x, y + dy }, .{ x + side, y }, .{ x - side, y } };
        for (options, 0..) |o, i| {
            if (!map.inside(o[0], o[1])) continue;
            const n = map.idx(o[0], o[1]);
            if (s.speed(.infantry, c, n) == 0) continue;
            if (s.occupied(n, .blue) or s.occupied(n, .red)) continue;
            // A side step only when the straight step is not possible, and
            // only when the square past it is open.
            if (i > 0) {
                const fy = o[1] + dy;
                if (!map.inside(o[0], fy)) continue;
                const f = map.idx(o[0], fy);
                if (s.m.ground[f] == .water and s.m.way[f] == .none) continue;
            }
            return n;
        }
        return null;
    }

    fn decideInfantry(s: *Sim) void {
        for (&s.units) |*u| {
            if (!u.alive or u.kind != .infantry or u.moving()) continue;
            const fwd = forward(u.side);
            const y = map.cellY(u.cell());
            const home_ok = if (u.side == .blue) y >= 26 else y <= 10;
            const posture = s.posture[@backingInt(u.side)][sectorOf(u.x)];
            var dir: i32 = 0;
            if (u.strength < 25 or u.supply < 5) {
                if (!home_ok) dir = -fwd;
            } else if (u.engaged) {
                dir = 0;
            } else switch (posture) {
                .push => if (u.supply >= 40 and u.strength >= 50) {
                    dir = fwd;
                },
                .hold => {},
                .back => if (!home_ok) {
                    dir = -fwd;
                },
            }
            if (dir == 0) continue;
            const target = s.stepTarget(u, dir) orelse continue;
            u.path[0] = target;
            u.path_len = 1;
            u.path_i = 0;
        }
    }

    /// The red commander uses the same postures. For each sector: fall back
    /// when the supply is low, push when red is much stronger, else hold.
    fn redCommander(s: *Sim) void {
        for (0..sectors) |sec| {
            var red_str: f32 = 0;
            var red_sup: f32 = 0;
            var red_n: f32 = 0;
            var blue_str: f32 = 0;
            for (s.units) |u| {
                if (!u.alive or u.kind != .infantry or sectorOf(u.x) != sec) continue;
                if (u.side == .red) {
                    red_str += u.strength;
                    red_sup += u.supply;
                    red_n += 1;
                } else blue_str += u.strength;
            }
            const p = &s.posture[@backingInt(Side.red)][sec];
            if (red_n == 0) {
                p.* = .hold;
            } else if (red_sup / red_n < 20) {
                p.* = .back;
            } else if (red_str > 1.4 * blue_str + 40) {
                p.* = .push;
            } else p.* = .hold;
        }
    }

    // ------------------------------------------------------------ artillery

    fn priority(u: *const Unit) f32 {
        return switch (u.kind) {
            .truck => if (u.moving()) 3 else 1.5,
            .engineer => if (u.task == .working) 2.5 else 2,
            .infantry => 1,
        };
    }

    /// Where the unit will be after `seconds`, along its path.
    fn lead(s: *const Sim, u: *const Unit, seconds: f32) [2]f32 {
        var x = u.x;
        var y = u.y;
        var left = seconds;
        if (u.task == .loading or u.task == .unloading or u.task == .working) return .{ x, y };
        var i = u.path_i;
        var from = u.cell();
        while (i < u.path_len and left > 0) : (i += 1) {
            const n = u.path[i];
            const tx = @as(f32, @floatFromInt(map.cellX(n))) + 0.5;
            const ty = @as(f32, @floatFromInt(map.cellY(n))) + 0.5;
            const v = @max(s.speed(u.kind, from, n), 0.05);
            const d = @sqrt((tx - x) * (tx - x) + (ty - y) * (ty - y));
            if (d / v > left) {
                x += (tx - x) / d * v * left;
                y += (ty - y) / d * v * left;
                break;
            }
            left -= d / v;
            x = tx;
            y = ty;
            from = n;
        }
        return .{ x, y };
    }

    fn artillery(s: *Sim) void {
        for (&s.battery_timer) |*bt| {
            bt.* -|= 1;
            if (bt.* > 0) continue;
            bt.* = shell_reload_s * tick_hz;
            var pick: ?u8 = null;
            for (s.units, 0..) |u, i| {
                if (!u.alive or u.side != .blue or !s.seen[u.cell()]) continue;
                // Red does not shell a target near its own squads.
                if (u.kind == .infantry and u.engaged) continue;
                if (pick == null or priority(&u) > priority(&s.units[pick.?])) pick = @intCast(i);
            }
            const t = &s.units[pick orelse continue];
            const at = s.lead(t, shell_flight_s);
            for (&s.shells) |*sh| {
                if (sh.active) continue;
                sh.* = .{ .active = true, .x = at[0], .y = at[1], .timer = shell_flight_s * tick_hz };
                s.stats.shells += 1;
                break;
            }
        }
        for (&s.shells) |*sh| {
            if (!sh.active) continue;
            sh.timer -|= 1;
            if (sh.timer > 0) continue;
            sh.active = false;
            s.addMark(.burst, sh.x, sh.y);
            for (&s.units) |*u| {
                if (!u.alive) continue;
                const dx = u.x - sh.x;
                const dy = u.y - sh.y;
                if (dx * dx + dy * dy > shell_radius * shell_radius) continue;
                if (u.kind == .truck) {
                    s.stats.trucks_lost += 1;
                    s.kill(u);
                } else {
                    u.strength -= 20 * s.coverFactor(u.cell());
                    if (u.strength <= 0) s.kill(u);
                }
            }
        }
    }

    fn kill(s: *Sim, u: *Unit) void {
        u.alive = false;
        s.addMark(.wreck, u.x, u.y);
        if (u.kind == .engineer and u.job != none) s.jobs[u.job].engineer = none;
    }

    fn addMark(s: *Sim, kind: @FieldType(Mark, "kind"), x: f32, y: f32) void {
        s.marks[s.mark_next] = .{ .kind = kind, .x = x, .y = y, .tick = s.tick };
        s.mark_next = (s.mark_next + 1) % max_marks;
    }

    // ------------------------------------------------------------ outcome

    fn checkOutcome(s: *Sim) void {
        var blue_in = false;
        var red_in = false;
        var blue_n: u32 = 0;
        for (s.units) |u| {
            if (!u.alive or u.kind != .infantry) continue;
            if (u.side == .blue) blue_n += 1;
            if (map.isVillage(u.cell())) {
                if (u.side == .blue) blue_in = true else red_in = true;
            }
            if (u.side == .red and u.y >= 35) s.outcome = .lost;
        }
        if (blue_n == 0) s.outcome = .lost;
        if (blue_in and !red_in) s.hold_ticks += 1 else s.hold_ticks = 0;
        if (s.hold_ticks >= hold_to_win_s * tick_hz) s.outcome = .won;
    }

    /// A hash of the game state, for the determinism test.
    pub fn digest(s: *const Sim) u64 {
        var h = std.hash.Wyhash.init(0);
        for (s.units) |u| {
            h.update(std.mem.asBytes(&u.alive));
            h.update(std.mem.asBytes(&u.x));
            h.update(std.mem.asBytes(&u.y));
            h.update(std.mem.asBytes(&u.strength));
            h.update(std.mem.asBytes(&u.supply));
            h.update(std.mem.asBytes(&u.task));
        }
        h.update(std.mem.sliceAsBytes(&s.m.way));
        h.update(std.mem.asBytes(&s.supply));
        h.update(std.mem.asBytes(&s.materials));
        return h.final();
    }
};

/// A binary min-heap of squares by cost, with a fixed size. A square can be
/// in it more than once: the search skips the old entries.
const Heap = struct {
    const Entry = struct { cost: f32, cell: u16 };
    items: [map.cells * 4]Entry = undefined,
    len: usize = 0,

    fn push(h: *Heap, e: Entry) void {
        if (h.len == h.items.len) return;
        var i = h.len;
        h.items[i] = e;
        h.len += 1;
        while (i > 0) {
            const p = (i - 1) / 2;
            if (!less(h.items[i], h.items[p])) break;
            std.mem.swap(Entry, &h.items[i], &h.items[p]);
            i = p;
        }
    }

    fn pop(h: *Heap) ?Entry {
        if (h.len == 0) return null;
        const top = h.items[0];
        h.len -= 1;
        h.items[0] = h.items[h.len];
        var i: usize = 0;
        while (true) {
            const l = 2 * i + 1;
            const r = l + 1;
            var m = i;
            if (l < h.len and less(h.items[l], h.items[m])) m = l;
            if (r < h.len and less(h.items[r], h.items[m])) m = r;
            if (m == i) break;
            std.mem.swap(Entry, &h.items[i], &h.items[m]);
            i = m;
        }
        return top;
    }

    fn less(a: Entry, b: Entry) bool {
        return a.cost < b.cost or (a.cost == b.cost and a.cell < b.cell);
    }
};
