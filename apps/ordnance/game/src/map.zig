//! The map: 40 x 40 squares of 250 m. North is y = 0. The enemy (red) holds
//! the north. The player (blue) holds the south. A position is in squares:
//! the square (x, y) covers x..x+1 and y..y+1, and its centre is
//! (x + 0.5, y + 0.5).
//!
//! The terrain is an analytic height field (heightField). The game reads the
//! heights from a fine grid of samples (4 for each square side), and the
//! renderer reads the field at each pixel. The squares hold the gameplay
//! data: the ground, the way (none, track, road) and the hedges.
const std = @import("std");

pub const size = 40;
pub const cells = size * size;
pub const square_m = 250;

pub const Ground = enum(u8) { grass, wood, water, town };
pub const Way = enum(u8) { none, track, road };

/// The samples of the height grid for each square side.
pub const fine_per = 4;
pub const fine_n = size * fine_per + 1;

/// The height of the cover above the ground, in metres.
pub const wood_cover = 14;
pub const town_cover = 8;
pub const hedge_cover = 3;

/// The objective: the village on the main road.
pub const village = [_][2]i32{ .{ 19, 11 }, .{ 20, 11 }, .{ 21, 11 }, .{ 19, 12 }, .{ 20, 12 }, .{ 21, 12 } };
/// The blue depot (the railhead), a square on the main road.
pub const depot = [2]i32{ 20, 38 };

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
/// The square that holds the point (x, y). The point must be on the map.
pub fn cellAt(x: f32, y: f32) u16 {
    const ix: i32 = std.math.clamp(@as(i32, @intFromFloat(@floor(x))), 0, size - 1);
    const iy: i32 = std.math.clamp(@as(i32, @intFromFloat(@floor(y))), 0, size - 1);
    return idx(ix, iy);
}
pub fn isVillage(c: u16) bool {
    for (village) |v| if (idx(v[0], v[1]) == c) return true;
    return false;
}

// ---------------------------------------------------------------- the field

fn hash2(ix: i32, iy: i32, seed: u32) f32 {
    var h: u32 = @as(u32, @bitCast(ix)) *% 0x27d4eb2d ^ @as(u32, @bitCast(iy)) *% 0x165667b1 ^ seed *% 0x9e3779b9;
    h ^= h >> 15;
    h *%= 0x85ebca6b;
    h ^= h >> 13;
    h *%= 0xc2b2ae35;
    h ^= h >> 16;
    return @as(f32, @floatFromInt(h & 0xffffff)) / 16777216.0;
}

/// A hash of a pixel or a square, 0..1. The renderer uses it for stipple.
pub fn hash(ix: i32, iy: i32, seed: u32) f32 {
    return hash2(ix, iy, seed);
}

fn smooth(t: f32) f32 {
    return t * t * (3 - 2 * t);
}

/// Value noise, 0..1, smooth.
fn noise(x: f32, y: f32, seed: u32) f32 {
    const fx = @floor(x);
    const fy = @floor(y);
    const ix: i32 = @intFromFloat(fx);
    const iy: i32 = @intFromFloat(fy);
    const tx = smooth(x - fx);
    const ty = smooth(y - fy);
    const a = hash2(ix, iy, seed);
    const b = hash2(ix + 1, iy, seed);
    const c = hash2(ix, iy + 1, seed);
    const d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

/// The distance from (x, y) to a polyline.
fn polyDist(pts: []const [2]f32, x: f32, y: f32) f32 {
    var best: f32 = std.math.floatMax(f32);
    for (pts[0 .. pts.len - 1], pts[1..]) |a, b| {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        const t = std.math.clamp(((x - a[0]) * dx + (y - a[1]) * dy) / l2, 0, 1);
        const px = a[0] + t * dx - x;
        const py = a[1] + t * dy - y;
        best = @min(best, @sqrt(px * px + py * py));
    }
    return best;
}

fn bump(d: f32, r: f32) f32 {
    return @exp(-(d * d) / (r * r));
}

/// The west ridge: it runs north from the lateral road, then bends east.
/// The ground behind it (west and south) is dead ground to the enemy hill.
const west_ridge = [_][2]f32{ .{ 12, 38 }, .{ 11.5, 31 }, .{ 12, 24 }, .{ 13, 19.5 }, .{ 16, 17.5 }, .{ 17.5, 17.2 } };
/// The valley floor west of the ridge.
const west_valley = [_][2]f32{ .{ 6, 40 }, .{ 6.5, 30 }, .{ 7, 22 }, .{ 9, 18 } };
/// The stream on the east side.
pub const stream = [_][2]f32{ .{ 35, -1 }, .{ 33.5, 8 }, .{ 34.5, 16 }, .{ 31.5, 24 }, .{ 32.5, 32 }, .{ 29.5, 41 } };
pub const pond = [3]f32{ 7.5, 34.5, 1.1 };

/// The height of the ground at (x, y), in metres.
pub fn heightField(x: f32, y: f32) f32 {
    // The glacis: the ground rises to the north.
    var h: f32 = 40 + (40 - y) * 1.3;
    // The enemy hill and its ridge.
    h += 34 * bump(@sqrt((x - 20) * (x - 20) * 0.08 + (y - 4) * (y - 4)), 3.2);
    h += 10 * bump(y - 5, 4);
    // The west ridge, and the valley behind it.
    h += 26 * bump(polyDist(&west_ridge, x, y), 2.0);
    h -= 9 * bump(polyDist(&west_valley, x, y), 3.0);
    // The stream valley.
    h -= 7 * bump(polyDist(&stream, x, y), 2.2);
    // Rolling ground.
    h += 7 * (noise(x / 6, y / 6, 11) - 0.5);
    h += 3 * (noise(x / 2.3, y / 2.3, 12) - 0.5);
    return h;
}

/// The extra detail that only the renderer adds, in metres. It keeps the
/// contours from looking smooth like a model.
pub fn heightDetail(x: f32, y: f32) f32 {
    return 1.2 * (noise(x * 1.4, y * 1.4, 13) - 0.5);
}

/// Water: the stream and the pond. A value below 0 is water.
pub fn waterField(x: f32, y: f32) f32 {
    const s = polyDist(&stream, x, y) - 0.32 - 0.08 * noise(x * 2, y * 2, 21);
    const p = @sqrt((x - pond[0]) * (x - pond[0]) + (y - pond[1]) * (y - pond[1]) * 1.6) - pond[2];
    return @min(s, p);
}

/// Woods: a value above 0 is wood.
pub fn woodField(x: f32, y: f32) f32 {
    var w = noise(x / 3.2, y / 3.2, 31) * 0.8 + noise(x, y, 32) * 0.2 - 0.72;
    // The east woods, a cover for a route to the east sector.
    if (x > 24 and x < 31 and y > 16 and y < 29) w += 0.3;
    // A copse on the west ridge.
    w += 0.3 * bump(@sqrt((x - 13) * (x - 13) + (y - 26) * (y - 26)), 1.2);
    return w;
}

// ---------------------------------------------------------------- the map

pub const Map = struct {
    ground: [cells]Ground,
    way: [cells]Way,
    /// A hedge on the east edge, and on the south edge, of each square.
    hedge_e: [cells]bool,
    hedge_s: [cells]bool,
    fine: [fine_n * fine_n]f32,

    /// The height at (x, y), from the fine grid.
    pub fn heightAt(m: *const Map, x: f32, y: f32) f32 {
        const max: f32 = @floatFromInt(fine_n - 1);
        const fx = std.math.clamp(x * fine_per, 0, max - 0.001);
        const fy = std.math.clamp(y * fine_per, 0, max - 0.001);
        const ix: usize = @intFromFloat(@floor(fx));
        const iy: usize = @intFromFloat(@floor(fy));
        const tx = fx - @floor(fx);
        const ty = fy - @floor(fy);
        const a = m.fine[iy * fine_n + ix];
        const b = m.fine[iy * fine_n + ix + 1];
        const c = m.fine[(iy + 1) * fine_n + ix];
        const d = m.fine[(iy + 1) * fine_n + ix + 1];
        return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }

    pub fn cellHeight(m: *const Map, c: u16) f32 {
        return m.heightAt(@as(f32, @floatFromInt(cellX(c))) + 0.5, @as(f32, @floatFromInt(cellY(c))) + 0.5);
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

    /// Make the map. It is the same each time.
    pub fn generate(m: *Map) void {
        for (0..fine_n) |iy| for (0..fine_n) |ix| {
            const x = @as(f32, @floatFromInt(ix)) / fine_per;
            const y = @as(f32, @floatFromInt(iy)) / fine_per;
            m.fine[iy * fine_n + ix] = heightField(x, y);
        };
        for (0..size) |uy| for (0..size) |ux| {
            const x: i32 = @intCast(ux);
            const y: i32 = @intCast(uy);
            const c = idx(x, y);
            const fx = @as(f32, @floatFromInt(x)) + 0.5;
            const fy = @as(f32, @floatFromInt(y)) + 0.5;
            m.ground[c] = if (waterField(fx, fy) < 0.18) .water else if (woodField(fx, fy) > 0) .wood else .grass;
            m.way[c] = .none;
        };
        // The main road: north from the depot, through the village, to the
        // enemy hill.
        var y: i32 = 0;
        while (y < size) : (y += 1) {
            const x: i32 = if (y >= 22 and y <= 30) 21 else 20;
            m.setRoad(x, y);
        }
        m.setRoad(20, 22);
        m.setRoad(20, 30);
        // The lateral road behind the blue line, and a farm road east of the
        // stream.
        var x: i32 = 3;
        while (x <= 37) : (x += 1) m.setRoad(x, 31);
        y = 31;
        while (y <= 36) : (y += 1) m.setRoad(3, y);
        // The villages.
        for (village) |v| m.ground[idx(v[0], v[1])] = .town;
        for ([_][2]i32{ .{ 19, 37 }, .{ 20, 37 }, .{ 21, 37 }, .{ 19, 38 }, .{ 20, 38 }, .{ 21, 38 }, .{ 4, 31 }, .{ 4, 32 }, .{ 35, 30 }, .{ 36, 30 } }) |t| {
            m.ground[idx(t[0], t[1])] = .town;
        }
        // An old farm track west of the ridge, and the farm lane behind the
        // blue line. The lane crosses the stream on a bridge (a road square).
        y = 27;
        while (y <= 30) : (y += 1) m.way[idx(6, y)] = .track;
        x = 4;
        while (x <= 36) : (x += 1) {
            const c = idx(x, 27);
            if (m.way[c] == .none) m.way[c] = if (m.ground[c] == .water) .road else .track;
        }
        // The hedges: the small fields of the south and the middle.
        for (0..size) |uy| for (0..size) |ux| {
            const cx: i32 = @intCast(ux);
            const cy: i32 = @intCast(uy);
            const c = idx(cx, cy);
            m.hedge_e[c] = false;
            m.hedge_s[c] = false;
            if (cy < 9 or m.ground[c] != .grass) continue;
            if (cx < size - 1 and m.ground[c + 1] == .grass and hash2(cx, cy, 41) < 0.42) m.hedge_e[c] = true;
            if (cy < size - 1 and m.ground[c + size] == .grass and hash2(cx, cy, 42) < 0.42) m.hedge_s[c] = true;
        };
        for (0..cells) |c| if (m.way[c] != .none) m.cutHedges(@intCast(c));
    }

    fn setRoad(m: *Map, x: i32, y: i32) void {
        m.way[idx(x, y)] = .road;
    }
};
