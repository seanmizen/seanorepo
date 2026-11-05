//! The depot, the trucks and the engineers.
//!
//! - The depot makes supply and materials at a fixed rate, and a new truck
//!   when one is lost.
//! - A truck at the depot loads for the squad with the least supply that no
//!   other truck serves. It drives only on roads and tracks, to the way
//!   square within 2 squares of the squad with the cheapest route (time +
//!   risk). It unloads, and it drives back.
//! - An engineer takes the first free build job in the order of the orders,
//!   walks there, and builds. The new way cuts the hedges to the next way.
//!   A drone net goes over a way square (Drone War).
const std = @import("std");
const sim = @import("sim.zig");
const map = sim.map;
const Sim = sim.Sim;
const Unit = sim.Unit;
const none = sim.none;
const towns = @import("towns.zig");

pub const truck_cargo = 40;
pub const truck_build_s = 40;
pub const supply_cap = 500;
pub const materials_cap = 300;
/// The reach of a drop: a truck drops within this many squares of a squad.
pub const drop_reach = 2;

pub fn jobCost(k: sim.JobKind) f32 {
    return switch (k) {
        .track => 8,
        .road => 20,
        .net => 6,
    };
}
pub fn jobSeconds(k: sim.JobKind) f32 {
    return switch (k) {
        .track => 5,
        .road => 8,
        .net => 4,
    };
}

pub fn step(s: *Sim) void {
    const dt: f32 = 1.0 / @as(f32, sim.tick_hz);
    s.supply = @min(supply_cap, s.supply + towns.blueSupplyRate(s) * dt);
    s.materials = @min(materials_cap, s.materials + s.rules.materials_rate * dt);
    for (0..sim.max_units) |i| {
        const u = &s.units[i];
        if (!u.alive) continue;
        switch (u.kind) {
            .truck => truckStep(s, @intCast(i)),
            .engineer => engineerStep(s, @intCast(i)),
            .infantry => {},
        }
    }
    reinforce(s);
}

// ------------------------------------------------------------ jobs

/// True when a job of this kind can go on the square.
pub fn canBuild(s: *const Sim, c: u16, kind: sim.JobKind) bool {
    for (s.jobs) |j| if (j.active and j.cell == c) return false;
    if (kind == .net) return s.m.way[c] != .none and !s.m.net[c];
    if (s.m.ground[c] == .water) return false;
    const want: map.Way = if (kind == .track) .track else .road;
    if (@backingInt(s.m.way[c]) >= @backingInt(want)) return false;
    for (s.jobs) |j| if (j.active and j.cell == c) return false;
    return true;
}

pub fn addJob(s: *Sim, c: u16, kind: sim.JobKind) void {
    if (!canBuild(s, c, kind)) return;
    for (&s.jobs) |*j| {
        if (j.active) continue;
        j.* = .{ .active = true, .cell = c, .kind = kind, .seq = s.job_seq };
        s.job_seq += 1;
        return;
    }
}

pub fn cancelJob(s: *Sim, c: u16) void {
    for (&s.jobs) |*j| {
        if (!j.active or j.cell != c) continue;
        if (j.engineer != none) {
            // The engineer stops. The materials are spent.
            const e = &s.units[j.engineer];
            e.job = none;
            e.task = .idle;
            e.path_len = 0;
        }
        j.* = .{};
    }
}

// ------------------------------------------------------------ trucks

/// The way square near the squad where a truck can drop its cargo: the
/// cheapest one from the depot within `drop_reach`. From the last route.
fn dropCell(s: *const Sim, squad: *const Unit) ?u16 {
    const sx = map.cellX(squad.cell());
    const sy = map.cellY(squad.cell());
    var best: ?u16 = null;
    var best_cost = std.math.inf(f32);
    var dy: i32 = -drop_reach;
    while (dy <= drop_reach) : (dy += 1) {
        var dx: i32 = -drop_reach;
        while (dx <= drop_reach) : (dx += 1) {
            if (!map.inside(sx + dx, sy + dy)) continue;
            const c = map.idx(sx + dx, sy + dy);
            if (s.scratch.dist[c] < best_cost) {
                best_cost = s.scratch.dist[c];
                best = c;
            }
        }
    }
    return best;
}

/// True when the blue squad has no truck route.
pub fn cutOff(s: *Sim, id: u8) bool {
    s.route(.truck, s.depotCell());
    return dropCell(s, &s.units[id]) == null;
}

fn served(s: *const Sim, squad: u8) bool {
    for (s.units) |u| if (u.alive and u.kind == .truck and u.client == squad) return true;
    return false;
}

fn near(a: *const Unit, b: *const Unit, r: f32) bool {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy <= r * r;
}

fn truckStep(s: *Sim, id: u8) void {
    const t = &s.units[id];
    const depot = s.depotCell();
    switch (t.task) {
        .idle => {
            if (s.tick % sim.decide_ticks != id % sim.decide_ticks) return;
            if (t.cell() != depot) {
                s.route(.truck, t.cell());
                if (s.takePath(t, depot)) t.task = .inbound;
                return;
            }
            if (s.supply < truck_cargo) return;
            s.route(.truck, depot);
            // The squad with the least supply that no truck serves.
            var pick: ?u8 = null;
            var pick_drop: u16 = 0;
            for (s.units, 0..) |q, qi| {
                if (!q.alive or q.side != .blue or q.kind != .infantry or q.supply >= 75) continue;
                if (served(s, @intCast(qi))) continue;
                const drop = dropCell(s, &q) orelse continue;
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
            t.timer = 2 * sim.tick_hz;
        },
        .loading => {
            t.timer -|= 1;
            if (t.timer == 0) t.task = .outbound;
        },
        .outbound => if (!t.moving()) {
            t.task = .unloading;
            t.timer = 2 * sim.tick_hz;
        },
        .unloading => {
            t.timer -|= 1;
            if (t.timer > 0) return;
            deliver(s, t);
            s.route(.truck, t.cell());
            t.task = if (s.takePath(t, depot)) .inbound else .idle;
        },
        .inbound => if (!t.moving()) {
            t.task = .idle;
        },
        .working => t.task = .idle,
    }
}

/// Give the cargo to the client, or to the squad near the truck with the
/// least supply.
fn deliver(s: *Sim, t: *Unit) void {
    const reach: f32 = drop_reach + 1;
    var to: ?u8 = null;
    if (t.client != none and s.units[t.client].alive and near(t, &s.units[t.client], reach)) to = t.client;
    if (to == null) for (s.units, 0..) |q, qi| {
        if (!q.alive or q.side != .blue or q.kind != .infantry or !near(t, &q, reach)) continue;
        if (to == null or q.supply < s.units[to.?].supply) to = @intCast(qi);
    };
    t.client = none;
    const q = &s.units[to orelse return];
    const given = @min(truck_cargo, 100 - q.supply);
    q.supply += given;
    s.stats.supply_delivered += given;
}

fn reinforce(s: *Sim) void {
    var trucks: u32 = 0;
    for (s.units) |u| if (u.alive and u.kind == .truck) {
        trucks += 1;
    };
    if (trucks >= sim.truck_count) {
        s.truck_timer = 0;
        return;
    }
    s.truck_timer += 1;
    if (s.truck_timer >= truck_build_s * sim.tick_hz) {
        s.truck_timer = 0;
        _ = s.spawnAt(.blue, .truck, s.depotCell());
    }
}

// ------------------------------------------------------------ engineers

fn engineerStep(s: *Sim, id: u8) void {
    const e = &s.units[id];
    switch (e.task) {
        .idle => {
            if (s.tick % sim.decide_ticks != id % sim.decide_ticks) return;
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
            } else if (e.cell() != s.depotCell() and !e.moving()) {
                s.route(.foot, e.cell());
                _ = s.takePath(e, s.depotCell());
            }
        },
        .outbound => if (!e.moving()) {
            e.task = .working;
            e.timer = @intFromFloat(jobSeconds(s.jobs[e.job].kind) * sim.tick_hz);
        },
        .working => {
            e.timer -|= 1;
            if (e.timer > 0) return;
            const j = &s.jobs[e.job];
            switch (j.kind) {
                .net => s.m.net[j.cell] = true,
                .track => if (s.m.way[j.cell] == .none) {
                    s.m.way[j.cell] = .track;
                },
                .road => s.m.way[j.cell] = .road,
            }
            s.m.cutHedges(j.cell);
            j.* = .{};
            e.job = none;
            e.task = .idle;
        },
        else => e.task = .idle,
    }
}
