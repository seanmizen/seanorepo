//! The route search: Dijkstra over the squares (4 neighbours). The caller
//! gives the cost of each step. mapgen.zig uses it to lay the roads, and
//! sim.zig uses it for the trucks and the engineers.
//!
//! The search holds no memory of its own. `Scratch` holds the arrays, and
//! the caller owns it (it is large: keep it out of the stack).
const std = @import("std");
const map = @import("map.zig");

pub const none: u16 = std.math.maxInt(u16);
pub const max_path = 512;

pub const Scratch = struct {
    /// The cheapest cost from the start to each square.
    dist: [map.cells]f32,
    /// The square before each square on its cheapest route. `none` at the
    /// start and at each square that the search did not reach.
    prev: [map.cells]u16,
    heap: Heap,
};

const dirs = [_][2]i32{ .{ 0, -1 }, .{ 1, 0 }, .{ 0, 1 }, .{ -1, 0 } };

/// Search from each square in `starts`. `ctx.cost(a, b)` is the cost to
/// step from square a to square b: inf blocks the step. The search stops
/// early at `stop`, when it is given.
pub fn search(s: *Scratch, starts: []const u16, ctx: anytype, stop: ?u16) void {
    s.dist = @splat(std.math.inf(f32));
    s.prev = @splat(none);
    s.heap.len = 0;
    for (starts) |c| {
        s.dist[c] = 0;
        s.heap.push(.{ .cost = 0, .cell = c });
    }
    while (s.heap.pop()) |e| {
        if (e.cost > s.dist[e.cell]) continue;
        if (stop != null and e.cell == stop.?) return;
        const x = map.cellX(e.cell);
        const y = map.cellY(e.cell);
        for (dirs) |d| {
            if (!map.inside(x + d[0], y + d[1])) continue;
            const n = map.idx(x + d[0], y + d[1]);
            const c = e.cost + ctx.cost(e.cell, n);
            if (c < s.dist[n]) {
                s.dist[n] = c;
                s.prev[n] = e.cell;
                s.heap.push(.{ .cost = c, .cell = n });
            }
        }
    }
}

/// The squares of the route to `goal` from the last search, the start not
/// included, into `out`. Null when the search did not reach `goal` or the
/// route is longer than `out`.
pub fn path(s: *const Scratch, goal: u16, out: []u16) ?[]u16 {
    if (std.math.isInf(s.dist[goal])) return null;
    var n: usize = 0;
    var c = goal;
    while (s.prev[c] != none) : (c = s.prev[c]) {
        if (n == out.len) return null;
        out[n] = c;
        n += 1;
    }
    std.mem.reverse(u16, out[0..n]);
    return out[0..n];
}

/// A binary min-heap of squares by cost, with a fixed size. A square can be
/// in it more than once: the search skips the old entries.
pub const Heap = struct {
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

    /// The lower cost first. A tie goes to the lower square, so the
    /// search is the same each time.
    fn less(a: Entry, b: Entry) bool {
        return a.cost < b.cost or (a.cost == b.cost and a.cell < b.cell);
    }
};

test "the search goes round a wall" {
    const s = try std.testing.allocator.create(Scratch);
    defer std.testing.allocator.destroy(s);
    const Wall = struct {
        pub fn cost(_: @This(), _: u16, b: u16) f32 {
            // A wall on x = 5 from y = 0 to y = 9.
            if (map.cellX(b) == 5 and map.cellY(b) < 10) return std.math.inf(f32);
            return 1;
        }
    };
    search(s, &.{map.idx(2, 2)}, Wall{}, null);
    var buf: [100]u16 = undefined;
    const p = path(s, map.idx(8, 2), &buf).?;
    // Down to row 10, across, and up again: longer than the 6 steps of a
    // straight line.
    try std.testing.expect(p.len > 6);
    for (p) |c| try std.testing.expect(!(map.cellX(c) == 5 and map.cellY(c) < 10));
}
