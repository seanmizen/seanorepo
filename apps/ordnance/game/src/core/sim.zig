//! The simulation state and the order of the step. It is deterministic: the
//! same seed and the same commands on the same ticks give the same game. It
//! has no random numbers, and each rule breaks a tie by the lower unit id.
//!
//! The player does not move units. The player changes the map (tracks,
//! roads) and sets a posture for each sector. The rules do the rest. Each
//! rule is in its own file and reads and writes this state:
//!   sight.zig      what red sees
//!   infantry.zig   the squads: fire, postures, steps; the red commander
//!   logistics.zig  the depot, the trucks and the engineers
//!   artillery.zig  the red guns and the blue mortars
//!   drones.zig     the red drones (Drone War)
//!   towns.zig      who holds each town, and the town supply (Frontier)
//!   rules.zig      the playstyles: the switches that the rules read
//!
//! The renderer and the input never write here. They read the state, and
//! they give `Command`s to `apply`.
const std = @import("std");
pub const map = @import("map.zig");
pub const mapgen = @import("mapgen.zig");
pub const routing = @import("route.zig");
pub const rules = @import("rules.zig");
const sight = @import("sight.zig");
const infantry = @import("infantry.zig");
const logistics = @import("logistics.zig");
const artillery = @import("artillery.zig");
const drones = @import("drones.zig");
const towns = @import("towns.zig");

pub const tick_hz = 30;
pub const sector_w = 16;
pub const sectors = map.size / sector_w;

pub const Side = enum(u8) { blue, red };
pub const Kind = enum(u8) { infantry, engineer, truck };
pub const Posture = enum(u8) { push, hold, back };
pub const JobKind = enum(u8) { track, road, net };
pub const Outcome = enum(u8) { playing, won, lost };

/// The state of a truck or an engineer.
pub const Task = enum(u8) { idle, loading, outbound, working, unloading, inbound };

pub const none: u8 = 255;
pub const max_units = 160;
pub const max_path = routing.max_path;
pub const max_jobs = 255;
pub const max_shells = 12;
pub const max_marks = 32;

// The rules, in seconds, squares and points.
pub const decide_ticks = 15;
pub const truck_count = 10;
pub const engineer_count = 4;
pub const hold_to_win_s = 90;

pub const Unit = struct {
    alive: bool = false,
    side: Side = .blue,
    kind: Kind = .infantry,
    x: f32 = 0,
    y: f32 = 0,
    /// The direction of the last move, for the icon. North at the start
    /// for blue, south for red.
    hx: f32 = 0,
    hy: f32 = -1,
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
    /// A red squad (Fog): true while blue sees it. The last place where
    /// blue saw it, and when.
    spotted: bool = false,
    ghost_x: f32 = 0,
    ghost_y: f32 = 0,
    ghost_tick: u64 = 0,

    pub fn cell(u: *const Unit) u16 {
        return map.cellAt(u.x, u.y);
    }
    pub fn moving(u: *const Unit) bool {
        return u.path_i < u.path_len;
    }
    /// True while the unit stands still at a task.
    pub fn busy(u: *const Unit) bool {
        return u.task == .loading or u.task == .unloading or u.task == .working;
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
    /// A blue mortar round (else a red shell).
    mortar: bool = false,
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

/// A rifle shot, for the renderer: from the shooter to the target.
pub const Shot = struct {
    from: [2]f32 = .{ 0, 0 },
    to: [2]f32 = .{ 0, 0 },
    side: Side = .blue,
    tick: u64 = 0,
    /// A mortar round: a burst at `to`, no tracer.
    mortar: bool = false,
};
pub const max_shots = 96;

/// A red drone in flight (Drone War).
pub const Drone = struct {
    active: bool = false,
    x: f32 = 0,
    y: f32 = 0,
    target: u8 = none,
};
pub const max_drones = 8;

pub const Command = union(enum) {
    build: struct { cell: u16, kind: JobKind },
    cancel: struct { cell: u16 },
    posture: struct { sector: u8, posture: Posture },
    /// Manoeuvre: the objective square of a sector, or null to clear it.
    goal: struct { sector: u8, cell: ?u16 },
};

pub const Stats = struct {
    trucks_lost: u32 = 0,
    supply_delivered: f32 = 0,
    shells: u32 = 0,
};

pub const Sim = struct {
    m: map.Map,
    setup: mapgen.Setup,
    seed: u32,
    rules: rules.Rules,
    /// Manoeuvre: the objective square of each blue sector, and the cost
    /// field to it (infantry.zig).
    goal: [sectors]?u16,
    goal_field: [sectors][map.cells]f32,
    goal_field_goal: [sectors]?u16,
    goal_field_tick: [sectors]u64,
    /// What blue sees (for Fog and the mortars), built like `seen`.
    blue_seen: [map.cells]bool,
    blue_seen_next: [map.cells]bool,
    shots: [max_shots]Shot,
    shot_next: u8,
    drones: [max_drones]Drone,
    drone_timer: u32,
    mortar_timer: u32,
    wave_timer: u32,
    wave: u32,
    /// Frontier: the side that holds each town square, or null.
    owner: [map.cells]?Side,
    towns_held: [2]u32,
    units: [max_units]Unit,
    jobs: [max_jobs]Job,
    shells: [max_shells]Shell,
    marks: [max_marks]Mark,
    mark_next: u8,
    posture: [2][sectors]Posture,
    /// True for each square that red sees now.
    seen: [map.cells]bool,
    /// The sight that sight.zig builds over several ticks.
    seen_next: [map.cells]bool,
    sight_cursor: u16,
    /// Tests set it: the sight stays as the test sets it.
    fixed_sight: bool,
    supply: f32,
    materials: f32,
    tick: u64,
    job_seq: u32,
    battery_timer: [mapgen.max_batteries]u32,
    truck_timer: u32,
    hold_ticks: u32,
    outcome: Outcome,
    stats: Stats,
    scratch: routing.Scratch,

    /// Make the map from the seed, and the start of the game in a style.
    pub fn init(s: *Sim, seed: u32, style: rules.Style) void {
        s.seed = seed;
        mapgen.generate(&s.m, &s.setup, seed, &s.scratch);
        s.reset();
        s.rules = rules.get(style);
        for (s.setup.blue[0..s.setup.blue_n]) |c| _ = s.spawnAt(.blue, .infantry, c);
        for (s.setup.red[0..s.setup.red_n]) |c| _ = s.spawnAt(.red, .infantry, c);
        for (0..engineer_count) |_| _ = s.spawnAt(.blue, .engineer, s.setup.depot);
        for (0..truck_count) |_| _ = s.spawnAt(.blue, .truck, s.setup.depot);
        // Red probes: it pushes at the start in some sectors.
        for (0..s.rules.red_push_at_start) |k| {
            const sec = (3 + k * 3 + @as(usize, s.seed)) % sectors;
            s.posture[@backingInt(Side.red)][sec] = .push;
        }
        sight.full(s);
        towns.update(s);
    }

    /// The start of a game on the map that `s.m` holds now, with no units.
    /// For tests that build their own map.
    pub fn reset(s: *Sim) void {
        s.rules = rules.get(.supply_line);
        s.goal = @splat(null);
        s.goal_field_goal = @splat(null);
        s.goal_field_tick = @splat(0);
        s.blue_seen = @splat(false);
        s.blue_seen_next = @splat(false);
        s.shots = @splat(.{});
        s.shot_next = 0;
        s.drones = @splat(.{});
        s.drone_timer = 20 * tick_hz;
        s.mortar_timer = 6 * tick_hz;
        s.wave_timer = 60 * tick_hz;
        s.wave = 0;
        s.owner = @splat(null);
        s.towns_held = .{ 0, 0 };
        s.units = @splat(.{});
        s.jobs = @splat(.{});
        s.shells = @splat(.{});
        s.marks = @splat(.{});
        s.mark_next = 0;
        s.posture = .{ @splat(.hold), @splat(.hold) };
        s.seen = @splat(false);
        s.seen_next = @splat(false);
        s.sight_cursor = 0;
        s.fixed_sight = false;
        s.supply = 200;
        s.materials = 160;
        s.tick = 0;
        s.job_seq = 0;
        for (&s.battery_timer, 0..) |*t, i| t.* = @intCast((5 + 3 * i) * tick_hz);
        s.truck_timer = 0;
        s.hold_ticks = 0;
        s.outcome = .playing;
        s.stats = .{};
    }

    pub fn spawnAt(s: *Sim, side: Side, kind: Kind, c: u16) ?u8 {
        for (&s.units, 0..) |*u, i| {
            if (u.alive) continue;
            const p = map.centre(c);
            u.* = .{ .alive = true, .side = side, .kind = kind, .x = p[0], .y = p[1], .hy = if (side == .blue) -1 else 1 };
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
            .build => |b| logistics.addJob(s, b.cell, b.kind),
            .cancel => |c| logistics.cancelJob(s, c.cell),
            .posture => |p| s.posture[@backingInt(Side.blue)][p.sector] = p.posture,
            .goal => |g| s.goal[g.sector] = g.cell,
        }
    }

    pub fn canBuild(s: *const Sim, c: u16, kind: JobKind) bool {
        return logistics.canBuild(s, c, kind);
    }

    // ------------------------------------------------------------ the step

    /// Advance the game one tick. The order of the rules is fixed.
    pub fn step(s: *Sim) void {
        if (s.outcome != .playing) return;
        s.tick += 1;
        if (!s.fixed_sight) sight.step(s);
        if (s.tick % decide_ticks == 0) {
            infantry.fight(s);
            infantry.decide(s);
            infantry.reinforce(s);
            if (s.tick % (10 * tick_hz) == 0) infantry.redCommander(s);
        }
        if (s.rules.waves) infantry.waves(s);
        if (s.tick % (5 * tick_hz) == 0) towns.update(s);
        logistics.step(s);
        const dt: f32 = 1.0 / @as(f32, tick_hz);
        for (&s.units) |*u| if (u.alive) s.move(u, dt);
        artillery.step(s);
        if (s.rules.drones) drones.step(s);
        s.checkOutcome();
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
            else => if (way != .none) 0.34 else switch (ground) {
                .water => 0,
                .wood => 0.15,
                else => 0.25,
            },
        };
        // Engineers ride in a light vehicle on a way, and walk off it.
        if (kind == .engineer) v = if (way != .none) 0.8 else v * 1.3;
        if (kind == .truck and s.m.hedgeBetween(from, to)) v = 0;
        if (v == 0) return 0;
        const dh = @abs(s.m.cellHeight(to) - s.m.cellHeight(from));
        if (kind != .truck and s.m.hedgeBetween(from, to)) v *= 0.6;
        return v / (1 + dh / 15);
    }

    fn move(s: *Sim, u: *Unit, dt: f32) void {
        if (!u.moving()) return;
        if (u.kind != .infantry and u.busy()) return;
        const next = u.path[u.path_i];
        const t = map.centre(next);
        const v = s.speed(u.kind, u.cell(), next);
        const dx = t[0] - u.x;
        const dy = t[1] - u.y;
        const d = @sqrt(dx * dx + dy * dy);
        const stepd = @max(v, 0.05) * dt;
        if (d > 0.001) {
            u.hx = dx / d;
            u.hy = dy / d;
        }
        if (d <= stepd) {
            u.x = t[0];
            u.y = t[1];
            u.path_i += 1;
        } else {
            u.x += dx / d * stepd;
            u.y += dy / d * stepd;
        }
    }

    pub const Mode = enum { truck, foot };

    /// The cost to enter square b from square a, in seconds. A square that
    /// red sees adds its risk to the time.
    pub const StepCost = struct {
        s: *const Sim,
        mode: Mode,
        pub fn cost(c: StepCost, a: u16, b: u16) f32 {
            const v = c.s.speed(if (c.mode == .truck) .truck else .engineer, a, b);
            if (v == 0) return std.math.inf(f32);
            var risk: f32 = if (c.s.seen[b]) (if (c.mode == .truck) 12 else 6) else 0;
            // Drone War: a way with no net, in drone reach, is a risk.
            if (c.s.rules.drones and c.mode == .truck and !c.s.m.net[b] and drones.inReach(c.s, b)) risk += 3;
            return 1 / v + risk;
        }
    };

    /// The cheapest cost from `start` to each square (s.scratch.dist), and
    /// the square before each one on that route (s.scratch.prev).
    pub fn route(s: *Sim, mode: Mode, start: u16) void {
        routing.search(&s.scratch, &.{start}, StepCost{ .s = s, .mode = mode }, null);
    }

    /// Give the unit the route to `goal` from the last `route` call.
    /// False when no route goes there.
    pub fn takePath(s: *const Sim, u: *Unit, goal: u16) bool {
        const p = routing.path(&s.scratch, goal, &u.path) orelse return false;
        u.path_len = @intCast(p.len);
        u.path_i = 0;
        return true;
    }

    pub fn depotCell(s: *const Sim) u16 {
        return s.setup.depot;
    }

    // ------------------------------------------------------------ helpers

    pub fn coverFactor(s: *const Sim, c: u16) f32 {
        return switch (s.m.ground[c]) {
            .wood => 0.55,
            .town => 0.45,
            else => 1.0,
        };
    }

    pub fn kill(s: *Sim, u: *Unit) void {
        u.alive = false;
        s.addMark(.wreck, u.x, u.y);
        if (u.kind == .engineer and u.job != none) s.jobs[u.job].engineer = none;
    }

    pub fn addShot(s: *Sim, from: [2]f32, to: [2]f32, side: Side, mortar: bool) void {
        s.shots[s.shot_next] = .{ .from = from, .to = to, .side = side, .tick = s.tick, .mortar = mortar };
        s.shot_next = (s.shot_next + 1) % max_shots;
    }

    pub fn addMark(s: *Sim, kind: @FieldType(Mark, "kind"), x: f32, y: f32) void {
        s.marks[s.mark_next] = .{ .kind = kind, .x = x, .y = y, .tick = s.tick };
        s.mark_next = (s.mark_next + 1) % max_marks;
    }

    // ------------------------------------------------------------ outcome

    fn checkOutcome(s: *Sim) void {
        var blue_in = false;
        var red_in = false;
        var blue_n: u32 = 0;
        const dy = map.cellY(s.setup.depot);
        for (s.units) |u| {
            if (!u.alive or u.kind != .infantry) continue;
            if (u.side == .blue) blue_n += 1;
            if (s.setup.isObjective(u.cell())) {
                if (u.side == .blue) blue_in = true else red_in = true;
            }
            if (u.side == .red and u.y >= @as(f32, @floatFromInt(dy - 3))) s.outcome = .lost;
        }
        if (blue_n == 0) s.outcome = .lost;
        if (s.rules.survive_s > 0) {
            if (s.outcome == .playing and s.tick >= @as(u64, s.rules.survive_s) * tick_hz) s.outcome = .won;
            return;
        }
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
