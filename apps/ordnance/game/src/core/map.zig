//! The map: `size` x `size` squares of 250 m. North is y = 0. A position is
//! in squares: the square (x, y) covers x..x+1 and y..y+1, and its centre
//! is (x + 0.5, y + 0.5).
//!
//! The map is data and queries only. mapgen.zig makes it. Each square holds
//! the gameplay data: the ground, the way (none, track, road) and the
//! hedges. Three fine grids (`fine_per` samples for each square side) hold
//! the continuous fields: the height in metres, the water (below 0 is
//! water) and the woods (above 0 is wood). The renderer draws the shapes
//! from the fine grids, and the line of sight reads the heights.
const std = @import("std");

pub const size = 128;
pub const cells = size * size;
pub const square_m = 250;

pub const Ground = enum(u8) { grass, wood, water, town };
pub const Way = enum(u8) { none, track, road };

/// The samples of a fine grid for each square side.
pub const fine_per = 4;
pub const fine_n = size * fine_per + 1;

/// The height of the cover above the ground, in metres.
pub const wood_cover = 14;
pub const town_cover = 8;
pub const hedge_cover = 3;

pub fn idx(x: i32, y: i32) u16 {
    return @intCast(y * size + x);
}
pub fn inside(x: i32, y: i32) bool {
    return x >= 0 and y >= 0 and x < size and y < size;
}
pub fn cellX(c: u16) i32 {
    return @intCast(c % size);
}
pub fn cellY(c: u16) i32 {
    return @intCast(c / size);
}
/// The centre of a square.
pub fn centre(c: u16) [2]f32 {
    return .{ @as(f32, @floatFromInt(cellX(c))) + 0.5, @as(f32, @floatFromInt(cellY(c))) + 0.5 };
}
/// The square that holds the point (x, y), clamped to the map.
pub fn cellAt(x: f32, y: f32) u16 {
    const ix: i32 = std.math.clamp(@as(i32, @intFromFloat(@floor(std.math.clamp(x, -1, size + 1)))), 0, size - 1);
    const iy: i32 = std.math.clamp(@as(i32, @intFromFloat(@floor(std.math.clamp(y, -1, size + 1)))), 0, size - 1);
    return idx(ix, iy);
}

pub const Map = struct {
    ground: [cells]Ground,
    way: [cells]Way,
    /// A hedge on the east edge, and on the south edge, of each square.
    hedge_e: [cells]bool,
    hedge_s: [cells]bool,
    /// A drone net over a way square (the Drone War style).
    net: [cells]bool,
    height: [fine_n * fine_n]f32,
    water: [fine_n * fine_n]f32,
    wood: [fine_n * fine_n]f32,

    /// A flat, open map at the height `h`: grass, no ways, no hedges. For
    /// tests.
    pub fn flat(m: *Map, h: f32) void {
        m.ground = @splat(.grass);
        m.way = @splat(.none);
        m.hedge_e = @splat(false);
        m.hedge_s = @splat(false);
        m.net = @splat(false);
        m.height = @splat(h);
        m.water = @splat(1);
        m.wood = @splat(-1);
    }

    fn sample(grid: *const [fine_n * fine_n]f32, x: f32, y: f32) f32 {
        const max: f32 = @floatFromInt(fine_n - 1);
        const fx = std.math.clamp(x * fine_per, 0, max - 0.001);
        const fy = std.math.clamp(y * fine_per, 0, max - 0.001);
        const ix: usize = @intFromFloat(@floor(fx));
        const iy: usize = @intFromFloat(@floor(fy));
        const tx = fx - @floor(fx);
        const ty = fy - @floor(fy);
        const a = grid[iy * fine_n + ix];
        const b = grid[iy * fine_n + ix + 1];
        const c = grid[(iy + 1) * fine_n + ix];
        const d = grid[(iy + 1) * fine_n + ix + 1];
        const top = a + (b - a) * tx;
        const bottom = c + (d - c) * tx;
        return top + (bottom - top) * ty;
    }

    /// The height at (x, y), in metres.
    pub fn heightAt(m: *const Map, x: f32, y: f32) f32 {
        return sample(&m.height, x, y);
    }
    /// The water field at (x, y): below 0 is water.
    pub fn waterAt(m: *const Map, x: f32, y: f32) f32 {
        return sample(&m.water, x, y);
    }
    /// The wood field at (x, y): above 0 is wood.
    pub fn woodAt(m: *const Map, x: f32, y: f32) f32 {
        return sample(&m.wood, x, y);
    }

    pub fn cellHeight(m: *const Map, c: u16) f32 {
        const p = centre(c);
        return m.heightAt(p[0], p[1]);
    }

    /// True when a hedge is on the edge between two squares side by side.
    /// False for squares that are not side by side.
    pub fn hedgeBetween(m: *const Map, a: u16, b: u16) bool {
        const lo = @min(a, b);
        const hi = @max(a, b);
        if (hi - lo == 1 and cellY(lo) == cellY(hi)) return m.hedge_e[lo];
        if (hi - lo == size) return m.hedge_s[lo];
        return false;
    }

    /// Remove each hedge between the square c and a neighbour that has a
    /// way. A new track cuts through the hedges.
    pub fn cutHedges(m: *Map, c: u16) void {
        const x = cellX(c);
        const y = cellY(c);
        if (x > 0 and m.way[c - 1] != .none) m.hedge_e[c - 1] = false;
        if (x < size - 1 and m.way[c + 1] != .none) m.hedge_e[c] = false;
        if (y > 0 and m.way[c - size] != .none) m.hedge_s[c - size] = false;
        if (y < size - 1 and m.way[c + size] != .none) m.hedge_s[c] = false;
    }

    /// The height of the cover in a square.
    pub fn cover(m: *const Map, c: u16) f32 {
        return switch (m.ground[c]) {
            .wood => wood_cover,
            .town => town_cover,
            else => 0,
        };
    }

    /// True when an eye `eye` metres above (ox, oy) sees a man 2 m tall at
    /// (tx, ty). The ground, the woods, the towns and the hedges block the
    /// line. The squares of the observer and the target do not block it.
    pub fn sees(m: *const Map, ox: f32, oy: f32, eye: f32, tx: f32, ty: f32) bool {
        const h0 = m.heightAt(ox, oy) + eye;
        const h1 = m.heightAt(tx, ty) + 2;
        const dx = tx - ox;
        const dy = ty - oy;
        const dist = @sqrt(dx * dx + dy * dy);
        const steps: u32 = @intFromFloat(@ceil(dist / 0.25));
        if (steps < 2) return true;
        const c0 = cellAt(ox, oy);
        const c1 = cellAt(tx, ty);
        var prev = c0;
        var i: u32 = 1;
        while (i < steps) : (i += 1) {
            const t = @as(f32, @floatFromInt(i)) / @as(f32, @floatFromInt(steps));
            const px = ox + dx * t;
            const py = oy + dy * t;
            const c = cellAt(px, py);
            var obstacle = m.heightAt(px, py);
            if (c != c0 and c != c1) obstacle += m.cover(c);
            if (c != prev and m.hedgeBetween(prev, c)) obstacle += hedge_cover;
            if (obstacle > h0 + (h1 - h0) * t) return false;
            prev = c;
        }
        return true;
    }

    /// The viewshed: for each square within `range` of (ox, oy), true when
    /// an eye `eye` metres above that point sees a man in the square. The
    /// other squares are false.
    pub fn viewshed(m: *const Map, ox: f32, oy: f32, eye: f32, range: f32, out: *[cells]bool) void {
        out.* = @splat(false);
        m.viewshedAdd(ox, oy, eye, range, out);
    }

    /// The same as `viewshed`, but it only sets squares to true: it adds to
    /// what `out` holds.
    pub fn viewshedAdd(m: *const Map, ox: f32, oy: f32, eye: f32, range: f32, out: *[cells]bool) void {
        const x0: i32 = @intFromFloat(@max(0, @floor(ox - range)));
        const x1: i32 = @intFromFloat(@min(size - 1, @floor(ox + range)));
        const y0: i32 = @intFromFloat(@max(0, @floor(oy - range)));
        const y1: i32 = @intFromFloat(@min(size - 1, @floor(oy + range)));
        var y = y0;
        while (y <= y1) : (y += 1) {
            var x = x0;
            while (x <= x1) : (x += 1) {
                const c = idx(x, y);
                if (out[c]) continue;
                const tx = @as(f32, @floatFromInt(x)) + 0.5;
                const ty = @as(f32, @floatFromInt(y)) + 0.5;
                if ((tx - ox) * (tx - ox) + (ty - oy) * (ty - oy) > range * range) continue;
                if (m.sees(ox, oy, eye, tx, ty)) out[c] = true;
            }
        }
    }
};

test "a ridge hides the ground behind it" {
    const m = try std.testing.allocator.create(Map);
    defer std.testing.allocator.destroy(m);
    m.flat(50);
    // A wall 20 m high along x = 10.
    for (0..fine_n) |fy| for (0..fine_n) |fx| {
        const x = @as(f32, @floatFromInt(fx)) / fine_per;
        if (@abs(x - 10) < 0.5) m.height[fy * fine_n + fx] = 70;
    };
    try std.testing.expect(m.sees(5.5, 20.5, 2, 8.5, 20.5));
    try std.testing.expect(!m.sees(5.5, 20.5, 2, 14.5, 20.5));
    // A high eye sees over it, to the far ground.
    try std.testing.expect(m.sees(5.5, 20.5, 60, 30.5, 20.5));
}

test "woods and hedges block the line" {
    const m = try std.testing.allocator.create(Map);
    defer std.testing.allocator.destroy(m);
    m.flat(50);
    try std.testing.expect(m.sees(2.5, 2.5, 2, 9.5, 2.5));
    m.ground[idx(5, 2)] = .wood;
    try std.testing.expect(!m.sees(2.5, 2.5, 2, 9.5, 2.5));
    m.ground[idx(5, 2)] = .grass;
    m.hedge_e[idx(5, 2)] = true;
    try std.testing.expect(!m.sees(2.5, 2.5, 2, 9.5, 2.5));
}
