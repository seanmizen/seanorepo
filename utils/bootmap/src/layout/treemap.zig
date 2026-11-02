//! Squarified treemap with integer math only (REQ-BOOTMAP-001).
//!
//! kernel/layout.c does the same steps in the same order. For the same
//! input, the two give byte-identical rectangles. test/layout-parity.sh
//! checks this. If you change this file, change kernel/layout.c too.
//!
//! The algorithm is Bruls, Huizing and van Wijk (2000), "Squarified
//! Treemaps", with three changes:
//!   1. Weights are normalized to a total of `weight_total` before layout,
//!      so every product below fits in a u128.
//!   2. Aspect ratios are compared as fractions by cross-multiplication.
//!      No float is used.
//!   3. The edges in a row come from the running sum (floor(cum * len /
//!      sum)), so the rectangles tile the area with no gap and no overlap.

const std = @import("std");

pub const Rect = struct {
    x: i32 = 0,
    y: i32 = 0,
    w: i32 = 0,
    h: i32 = 0,

    pub fn inset(r: Rect, pad: i32) Rect {
        if (r.w <= 2 * pad or r.h <= 2 * pad) return r;
        return .{ .x = r.x + pad, .y = r.y + pad, .w = r.w - 2 * pad, .h = r.h - 2 * pad };
    }

    pub fn eql(a: Rect, b: Rect) bool {
        return a.x == b.x and a.y == b.y and a.w == b.w and a.h == b.h;
    }
};

/// The sum of the normalized weights of one set of siblings, before the
/// minimum of 1 for each item is added.
pub const weight_total: u64 = 65536;

/// The largest width or height. With this limit and at most `max_items`
/// items, no product in `worse` passes 2^127.
pub const max_side: i32 = 8192;
pub const max_items: usize = 65536;

/// The weight of a box that took `duration_us` microseconds.
/// floor(sqrt(d)) + 16: a 1 s box is about 60 times the size of a 0 s box.
/// The kernel uses int_sqrt(), which also rounds down.
pub fn leafWeight(duration_us: u64) u64 {
    return @as(u64, std.math.sqrt(duration_us)) + 16;
}

/// out[i] = max(1, w[i] * weight_total / sum(w)). If the sum is 0, all are 1.
pub fn normalize(weights: []const u64, out: []u32) void {
    std.debug.assert(out.len == weights.len);
    var sum: u64 = 0;
    for (weights) |w| sum += w;
    for (weights, out) |w, *o| {
        if (sum == 0) {
            o.* = 1;
            continue;
        }
        const n: u64 = @intCast((@as(u128, w) * weight_total) / sum);
        o.* = @intCast(@max(n, 1));
    }
}

/// How siblings are placed (style option `order`).
///   boot: in the given order (boot order).
///   size: largest first.
///   best: boot or size, whichever gives the squarer worst box.
pub const Order = enum(u8) { boot, size, best };

/// Fill `order` with 0..n-1. If `sorted`, sort it by weight, largest
/// first, then by index. The order is total, so every sort gives the same
/// result. With `pin_last`, the last item stays last (the "other" group).
pub fn makeOrder(weights: []const u32, order: []u32, sorted: bool, pin_last: bool) void {
    for (order, 0..) |*o, i| o.* = @intCast(i);
    if (!sorted) return;
    const n = if (pin_last and order.len > 0) order.len - 1 else order.len;
    // Insertion sort: kernel/layout.c uses the same one. Sibling sets are small.
    var i: usize = 1;
    while (i < n) : (i += 1) {
        const v = order[i];
        var j = i;
        while (j > 0 and before(weights, v, order[j - 1])) : (j -= 1) order[j] = order[j - 1];
        order[j] = v;
    }
}

fn before(weights: []const u32, a: u32, b: u32) bool {
    if (weights[a] != weights[b]) return weights[a] > weights[b];
    return a < b;
}

pub const Frac = struct { num: u128, den: u128 };

/// a > b, for fractions with positive denominators.
fn gt(a: Frac, b: Frac) bool {
    return a.num * b.den > b.num * a.den;
}

/// The worst aspect ratio of a row, as a fraction.
/// s: the short side of the free area. a: its area. r: the weight left.
/// sum, min, max: the weights in the row.
///   f1 = s² · max · r / (sum² · a)
///   f2 = sum² · a / (s² · min · r)
fn worst(s: u64, a: u64, r: u64, sum: u64, min: u64, max: u64) Frac {
    const s2: u128 = @as(u128, s) * s;
    const sum2: u128 = @as(u128, sum) * sum;
    const f1: Frac = .{ .num = s2 * max * r, .den = sum2 * a };
    const f2: Frac = .{ .num = sum2 * a, .den = s2 * min * r };
    return if (gt(f1, f2)) f1 else f2;
}

/// The worst aspect ratio of a set of rectangles, long side / short side.
/// A rectangle with a side of 0 is worse than any other (den = 0).
pub fn worstAspect(rects: []const Rect) Frac {
    var worst_r: Frac = .{ .num = 1, .den = 1 };
    for (rects) |r| {
        const a: u128 = @intCast(@max(r.w, r.h, 0));
        const b: u128 = @intCast(@max(@min(r.w, r.h), 0));
        const f: Frac = .{ .num = a, .den = b };
        if (worseThan(f, worst_r)) worst_r = f;
    }
    return worst_r;
}

/// a is worse (a larger ratio) than b. den = 0 is the worst.
fn worseThan(a: Frac, b: Frac) bool {
    if (a.den == 0) return b.den != 0;
    if (b.den == 0) return false;
    return gt(a, b);
}

/// Lay out the siblings with an Order. `order` and `tmp` are scratch space
/// of the same length as `weights`.
pub fn arrange(area: Rect, weights: []const u32, mode: Order, pin_last: bool, order: []u32, out: []Rect, tmp: []Rect) void {
    switch (mode) {
        .boot, .size => {
            makeOrder(weights, order, mode == .size, pin_last);
            squarify(area, weights, order, out);
        },
        .best => {
            makeOrder(weights, order, false, pin_last);
            squarify(area, weights, order, out);
            makeOrder(weights, order, true, pin_last);
            squarify(area, weights, order, tmp);
            // Keep boot order unless size order is strictly squarer.
            if (worseThan(worstAspect(out), worstAspect(tmp))) @memcpy(out, tmp);
        },
    }
}

/// Lay out `weights` (already normalized) in `area`. `order` is the place
/// order from makeOrder. `out[i]` gets the rectangle of item i.
pub fn squarify(area: Rect, weights: []const u32, order: []const u32, out: []Rect) void {
    std.debug.assert(area.w <= max_side and area.h <= max_side);
    std.debug.assert(weights.len <= max_items);
    var free = area;
    var left: u64 = 0;
    for (weights) |w| left += w;

    var i: usize = 0;
    while (i < order.len) {
        if (free.w <= 0 or free.h <= 0) {
            while (i < order.len) : (i += 1) out[order[i]] = .{ .x = free.x, .y = free.y };
            return;
        }
        const wide = free.w >= free.h;
        const short: u64 = @intCast(if (wide) free.h else free.w);
        const long: u64 = @intCast(if (wide) free.w else free.h);
        const a = short * long;

        // Add items to the row while the worst ratio does not get worse.
        var sum: u64 = weights[order[i]];
        var min: u64 = sum;
        var max: u64 = sum;
        var j = i + 1;
        while (j < order.len) : (j += 1) {
            const w: u64 = weights[order[j]];
            const n_sum = sum + w;
            const n_min = @min(min, w);
            const n_max = @max(max, w);
            if (gt(worst(short, a, left, n_sum, n_min, n_max), worst(short, a, left, sum, min, max))) break;
            sum = n_sum;
            min = n_min;
            max = n_max;
        }

        // The thickness of the row. The last row takes all that is left.
        const t: u64 = if (j == order.len) long else (sum * long) / left;

        var cum: u64 = 0;
        var k = i;
        while (k < j) : (k += 1) {
            const s0 = (cum * short) / sum;
            cum += weights[order[k]];
            const s1 = (cum * short) / sum;
            const ti: i32 = @intCast(t);
            out[order[k]] = if (wide)
                .{ .x = free.x, .y = free.y + @as(i32, @intCast(s0)), .w = ti, .h = @intCast(s1 - s0) }
            else
                .{ .x = free.x + @as(i32, @intCast(s0)), .y = free.y, .w = @intCast(s1 - s0), .h = ti };
        }

        const ti: i32 = @intCast(t);
        if (wide) {
            free.x += ti;
            free.w -= ti;
        } else {
            free.y += ti;
            free.h -= ti;
        }
        left -= sum;
        i = j;
    }
}

test "rectangles tile the area with no gap and no overlap" {
    const weights_raw = [_]u64{ 6, 6, 4, 3, 2, 2, 1 };
    var w: [weights_raw.len]u32 = undefined;
    normalize(&weights_raw, &w);
    var order: [w.len]u32 = undefined;
    makeOrder(&w, &order, true, false);
    var out: [w.len]Rect = undefined;
    const area: Rect = .{ .x = 10, .y = 20, .w = 600, .h = 400 };
    squarify(area, &w, &order, &out);

    var covered: i64 = 0;
    for (out, 0..) |r, idx| {
        try std.testing.expect(r.x >= area.x and r.y >= area.y);
        try std.testing.expect(r.x + r.w <= area.x + area.w and r.y + r.h <= area.y + area.h);
        covered += @as(i64, r.w) * r.h;
        for (out[idx + 1 ..]) |o| {
            const overlap = r.x < o.x + o.w and o.x < r.x + r.w and r.y < o.y + o.h and o.y < r.y + r.h;
            try std.testing.expect(!overlap);
        }
    }
    try std.testing.expectEqual(@as(i64, area.w) * area.h, covered);
}

test "the order is total: equal weights keep index order" {
    const w = [_]u32{ 5, 9, 5, 9 };
    var order: [4]u32 = undefined;
    makeOrder(&w, &order, true, false);
    try std.testing.expectEqualSlices(u32, &.{ 1, 3, 0, 2 }, &order);
    // With pin_last, item 3 stays last.
    makeOrder(&w, &order, true, true);
    try std.testing.expectEqualSlices(u32, &.{ 1, 0, 2, 3 }, &order);
}

test "the largest products fit in u128" {
    const s: u64 = max_side;
    const big: u64 = weight_total + max_items;
    _ = worst(s, s * s, big, big, 1, big);
    _ = worst(s, 1, big, big, 1, big);
}

test "leaf weights" {
    try std.testing.expectEqual(@as(u64, 16), leafWeight(0));
    try std.testing.expectEqual(@as(u64, 1016), leafWeight(1_000_000));
    try std.testing.expectEqual(@as(u64, 47), leafWeight(1_000));
}
