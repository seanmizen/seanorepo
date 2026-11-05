//! What each side sees.
//! - Red: the red observation posts and each red squad. The squares go to
//!   `seen`: the guns and the drones read them.
//! - Blue: each blue unit. The squares go to `blue_seen`: the mortars read
//!   them, and the Fog style shows only the red squads in them.
//!
//! A full pass over all observers is slow on a big map, so `step` does one
//! observer each tick into the `_next` arrays. At the end of a pass they
//! become the sight. The sight is then at most one pass old (about two
//! seconds). The end of a pass also marks each red squad that blue sees,
//! and keeps the last place where blue saw it (the ghost).
const std = @import("std");
const sim = @import("sim.zig");
const map = sim.map;

pub const post_range = 24;
pub const squad_range = 5;
pub const blue_squad_range = 6;
pub const vehicle_range = 3;
pub const eye = 2;

const Observer = struct { x: f32, y: f32, eye: f32, range: f32, side: sim.Side };

/// The observer number `i`: the posts, then the units by id. Null when `i`
/// is past the last one. An empty slot gives range 0.
fn observer(s: *const sim.Sim, i: usize) ?Observer {
    const posts = sim.mapgen.max_posts;
    if (i < posts) {
        const p = s.setup.posts[i];
        return .{ .x = p[0], .y = p[1], .eye = p[2], .range = if (p[2] == 0) 0 else post_range, .side = .red };
    }
    if (i - posts >= sim.max_units) return null;
    const u = s.units[i - posts];
    if (!u.alive) return .{ .x = 0, .y = 0, .eye = 0, .range = 0, .side = .red };
    const range: f32 = switch (u.kind) {
        .infantry => if (u.side == .red) squad_range else blue_squad_range,
        else => vehicle_range,
    };
    return .{ .x = u.x, .y = u.y, .eye = eye, .range = range, .side = u.side };
}

fn add(s: *sim.Sim, o: Observer) void {
    if (o.range == 0) return;
    const out = if (o.side == .red) &s.seen_next else &s.blue_seen_next;
    s.m.viewshedAdd(o.x, o.y, o.eye, o.range, out);
}

/// One observer of the pass, or the end of the pass.
/// Empty slots cost nothing: the step goes on to the next real observer.
pub fn step(s: *sim.Sim) void {
    while (observer(s, s.sight_cursor)) |o| {
        s.sight_cursor += 1;
        if (o.range == 0) continue;
        add(s, o);
        return;
    }
    finish(s);
}

/// A full pass now.
pub fn full(s: *sim.Sim) void {
    s.seen_next = @splat(false);
    s.blue_seen_next = @splat(false);
    var i: usize = 0;
    while (observer(s, i)) |o| : (i += 1) add(s, o);
    finish(s);
}

fn finish(s: *sim.Sim) void {
    s.seen = s.seen_next;
    s.blue_seen = s.blue_seen_next;
    s.seen_next = @splat(false);
    s.blue_seen_next = @splat(false);
    s.sight_cursor = 0;
    for (&s.units) |*u| {
        if (!u.alive or u.side != .red) continue;
        u.spotted = s.blue_seen[u.cell()];
        if (u.spotted) {
            u.ghost_x = u.x;
            u.ghost_y = u.y;
            u.ghost_tick = s.tick;
        }
    }
}
