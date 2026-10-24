// The body of a London Underground train, from the size of the real stock.
// Earl's Court has two trains (maps/earls_court.zig):
//
// - The District line train in the train shed: S7 Stock. It stands at
//   island A with its doors open, and it does not move. Its parts are
//   static boxes, and its details are decoration.
// - The deep Piccadilly line train: 1973 Stock. It moves (map.zig Train).
//   Its parts are dynamic boxes, and main.zig draws its details each frame.
//
// The body is hollow. The parts stop a player and a bullet: the floor, the
// roof, the side walls up to the window sills, the cab ends, the
// partitions between the cars (a walk-through train has none), a doorway
// part in each door opening of the platform side, and the seats. The
// details only show: the body shape above the sills, the door leaves, the
// window pillars, the skirt, the cab fronts, the seat backs, the grab poles
// and rails, and the lights.
//
// - The cross-section is the shape of the real stock (`Stock.roof`): the
//   sides are straight up to the shoulder, and the roof curves in above
//   it. The details draw the curve as flat strips (`facet`). The roof and
//   the ends are parts that only stop (`Kind.cover`): a box does not fit
//   the curve, so the details draw them.
// - The 1973 Stock fits the 3.56 m bore of a tube tunnel: its doors and
//   windows go up into the curve of the roof. The S7 Stock is a big
//   sub-surface train: square shoulders, a flat roof with air
//   conditioning, doors that hang outside the body, and a raked cab front.
// - The windows have no glass. The opening from the sill to the ceiling is
//   less than player.height, so a player does not fit through. A bullet
//   goes through.
// - The doors of one side open: the platform side (`Body.side`). The doors
//   of the other side stay closed.
// - The body uses train coordinates: the train centre is at x = 0, and the
//   front cab is at -X.
const std = @import("std");
const vec = @import("vec.zig");
const map = @import("map.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;
const Mat = map.Mat;
const Surface = map.Surface;

pub const Stock = struct {
    /// The car lengths over the body ends, from the front (-X) to the
    /// back, m.
    cars: []const f32,
    /// The space between two cars (the couplers), m.
    gap: f32,
    /// The body width, m.
    width: f32,
    /// The height of the roof above the top of the rail, m.
    height: f32,
    /// The top of the straight sides above the top of the rail, m.
    shoulder: f32,
    /// The cross-section of the roof: points {height above the top of the
    /// rail, half width}, m, from the shoulder (not in the list) to the
    /// middle of the roof. The last point has half width 0.
    roof: []const [2]f32,
    /// The doors and the windows go up into the first strip of the roof
    /// (the tube stock). Else they stop at the shoulder.
    tall_doors: bool,
    /// The door leaves hang outside the body (the S7 Stock). Else they
    /// slide into pockets in the side walls.
    outside_doors: bool,
    /// The thickness of the cab end part, m: the driver's cab is not open
    /// to the players.
    cab: f32,
    /// The cab front leans back by this distance from the windscreen
    /// bottom to the shoulder, m. 0: a flat front.
    rake: f32,
    /// The clear opening of a pair of doors, m.
    door_w: f32,
    /// The centre of each pair of doors on one side of a car, as a part of
    /// the car length from its front end.
    doors: []const f32,
    /// A walk-through train has open gangways: no partitions between the
    /// cars.
    gangways: bool,
    body: V3,
    /// The window surrounds and pillars.
    pillar: V3,
    /// The top of the roof.
    top: V3,
    /// The cab fronts.
    front: V3,
    door: V3,
    skirt: V3,
    seat: V3,
};

/// The 1973 Stock of the Piccadilly line: 6 cars, 106.81 m, 2.629 m wide,
/// 2.888 m high. Sources: Wikipedia, "London Underground 1973 Stock"
/// (car lengths 17.473 m for a driving motor car and 17.676 m for the
/// others, and the train length: the 0.232 m between two cars makes up the
/// rest), and the TfL information sheet "1973 Tube Stock" (FOI-1290-1718).
/// The roof is the tube profile: it curves in so the car fits the 11 ft
/// 8.25 in (3.56 m) bore of the Piccadilly line running tunnels
/// (`tube_bore`). The door opening, the door places and the curve are
/// approximate. The real cars also have a single door at each car end,
/// which the game leaves out. Livery: unpainted aluminium, red doors and
/// cab ends, a blue skirt.
pub const stock_1973: Stock = .{
    .cars = &.{ 17.473, 17.676, 17.676, 17.676, 17.676, 17.473 },
    .gap = 0.232,
    .width = 2.629,
    .height = 2.888,
    .shoulder = 2.3,
    .roof = &.{ .{ 2.6, 1.15 }, .{ 2.8, 0.85 }, .{ 2.888, 0.5 }, .{ 2.888, 0 } },
    .tall_doors = true,
    .outside_doors = false,
    .cab = 0.15,
    .rake = 0,
    .door_w = 1.4,
    .doors = &.{ 0.3, 0.7 },
    .gangways = false,
    .body = v3(0.72, 0.74, 0.76),
    .pillar = v3(0.66, 0.68, 0.7),
    .top = v3(0.42, 0.43, 0.44),
    .front = v3(0.75, 0.06, 0.05),
    .door = v3(0.75, 0.06, 0.05),
    .skirt = v3(0.04, 0.12, 0.45),
    .seat = v3(0.12, 0.18, 0.42),
};

/// The S7 Stock of the District line: 7 cars, 117.448 m, 2.92 m wide,
/// 3.682 m high, three pairs of doors on each side of a car, open
/// gangways. Sources: Wikipedia, "London Underground S7 and S8 Stock" (car
/// lengths 18.139 m for a driving motor car and 16.234 m for the others),
/// and the TfL "S Stock information sheet" of July 2010 (FOI-0158-2021).
/// The door opening, the door places, the roof curve and the rake of the
/// cab front are approximate. Livery: white body, black window surrounds,
/// red doors and cab fronts, a blue skirt.
pub const stock_s7: Stock = .{
    .cars = &.{ 18.139, 16.234, 16.234, 16.234, 16.234, 16.234, 18.139 },
    .gap = 0,
    .width = 2.92,
    .height = 3.682,
    .shoulder = 2.75,
    .roof = &.{ .{ 3.15, 1.38 }, .{ 3.42, 1.18 }, .{ 3.56, 0.85 }, .{ 3.6, 0 } },
    .tall_doors = false,
    .outside_doors = true,
    .cab = 0.5,
    .rake = 0.4,
    .door_w = 1.6,
    .doors = &.{ 0.2, 0.5, 0.8 },
    .gangways = true,
    .body = v3(0.9, 0.9, 0.88),
    .pillar = v3(0.06, 0.06, 0.07),
    .top = v3(0.55, 0.56, 0.57),
    .front = v3(0.75, 0.06, 0.05),
    .door = v3(0.75, 0.06, 0.05),
    .skirt = v3(0.04, 0.12, 0.45),
    .seat = v3(0.3, 0.1, 0.2),
};

/// The bore of the deep tube running tunnels that the 1973 Stock must fit:
/// a circle of 11 ft 8.25 in (3.56 m) diameter. Its centre is on the track
/// centre line, `centre` m above the top of the rail. maps/earls_court.zig
/// lines its running tunnels on this circle.
pub const tube_bore = struct {
    pub const radius: f32 = 1.78;
    pub const centre: f32 = 1.32;
};

/// The thickness of a side wall, and of the roof strips.
pub const wall: f32 = 0.08;
/// The seats: their height and depth, the free space beside each doorway,
/// and the free space behind each cab (the driver's cab).
const seat_h: f32 = 0.45;
const seat_d: f32 = 0.48;
const seat_gap: f32 = 0.35;
const cab_len: f32 = 2.0;
const max_cars = 8;
pub const max_doors = 24;
const max_pillars = 160;

/// A train placed on a track, in train coordinates.
pub const Body = struct {
    stock: *const Stock,
    half_len: f32,
    /// The outside of the side walls.
    z0: f32,
    z1: f32,
    /// The top of the rails, the bottom of the body, the top of the floor,
    /// the window sills, the ceiling (the top of the door openings) and the
    /// top of the roof.
    rail_y: f32,
    y0: f32,
    floor_y: f32,
    sill_y: f32,
    ceil_y: f32,
    y1: f32,
    /// 1: the doors of the z1 side open. -1: the doors of the z0 side.
    side: f32,

    /// The inside of the side walls.
    pub fn innerZ0(b: *const Body) f32 {
        return b.z0 + wall;
    }
    pub fn innerZ1(b: *const Body) f32 {
        return b.z1 - wall;
    }
    /// The middle of the track.
    pub fn centreZ(b: *const Body) f32 {
        return (b.z0 + b.z1) / 2;
    }
    /// The top of the straight sides.
    pub fn shoulderY(b: *const Body) f32 {
        return b.rail_y + b.stock.shoulder;
    }

    /// The point `i` of the cross-section of one side: 0 is the shoulder,
    /// then the points of Stock.roof. {y, half width}.
    pub fn profile(b: *const Body, i: usize) [2]f32 {
        if (i == 0) return .{ b.shoulderY(), b.stock.width / 2 };
        const p = b.stock.roof[i - 1];
        return .{ b.rail_y + p[0], p[1] };
    }

    /// The half width of the outside of the body at height y.
    pub fn halfWidth(b: *const Body, y: f32) f32 {
        var prev = b.profile(0);
        if (y <= prev[0]) return prev[1];
        for (1..b.stock.roof.len + 1) |i| {
            const p = b.profile(i);
            if (y <= p[0]) {
                const k = if (p[0] > prev[0]) (y - prev[0]) / (p[0] - prev[0]) else 1;
                return prev[1] + (p[1] - prev[1]) * k;
            }
            prev = p;
        }
        return 0;
    }

    /// The car ends, from -half_len to half_len. Between two cars it is
    /// the middle of the gap.
    pub fn carEnds(b: *const Body, out: *[max_cars + 1]f32) []f32 {
        const g = b.stock.gap;
        var x = -b.half_len - g / 2;
        out[0] = -b.half_len;
        for (b.stock.cars, 1..) |l, i| {
            x += l + g;
            out[i] = x;
        }
        out[b.stock.cars.len] = b.half_len;
        return out[0 .. b.stock.cars.len + 1];
    }

    /// The centre of each pair of doors, from -X to +X. The doors of the
    /// two sides are opposite.
    pub fn doorXs(b: *const Body, out: *[max_doors]f32) []f32 {
        var ends: [max_cars + 1]f32 = undefined;
        const e = b.carEnds(&ends);
        var n: usize = 0;
        for (b.stock.cars, 0..) |l, i| {
            const start = if (i == 0) e[0] else e[i] + b.stock.gap / 2;
            for (b.stock.doors) |f| {
                out[n] = start + l * f;
                n += 1;
            }
        }
        return out[0..n];
    }

    /// The window pillars of one side: the left edge of each, 0.14 m wide.
    /// One at each end of a wall between two doors, and each 1.8 m.
    fn pillarXs(b: *const Body, out: *[max_pillars]f32) []f32 {
        const hl = b.half_len;
        const dw = b.stock.door_w / 2;
        var doors: [max_doors]f32 = undefined;
        const xs = b.doorXs(&doors);
        var n: usize = 0;
        var x = -hl + b.stock.cab;
        for (0..xs.len + 1) |i| {
            const end = if (i < xs.len) xs[i] - dw else hl - b.stock.cab;
            const k: usize = @intFromFloat(@max(1, @round((end - x) / 1.8)));
            for (0..k + 1) |j| {
                if (n == out.len) break;
                const px = x + (end - x) * @as(f32, @floatFromInt(j)) / @as(f32, @floatFromInt(k));
                out[n] = std.math.clamp(px - 0.07, x, end - 0.14);
                n += 1;
            }
            if (i < xs.len) x = xs[i] + dw;
        }
        return out[0..n];
    }
};

/// Place a stock on a track. `centre_z`: the track centre. `rail_y`: the
/// top of the rails. `floor_y`: the top of the car floor (the platform
/// height). `side`: see Body.side.
pub fn body(stock: *const Stock, centre_z: f32, rail_y: f32, floor_y: f32, side: f32) Body {
    var len: f32 = stock.gap * @as(f32, @floatFromInt(stock.cars.len - 1));
    for (stock.cars) |l| len += l;
    const y1 = rail_y + stock.height;
    return .{
        .stock = stock,
        .half_len = len / 2,
        .z0 = centre_z - stock.width / 2,
        .z1 = centre_z + stock.width / 2,
        .rail_y = rail_y,
        .y0 = floor_y - 0.5,
        .floor_y = floor_y,
        .sill_y = floor_y + 0.85,
        // The doors of the 1973 Stock cut into the curve of the roof: the
        // openings go up to the ceiling. The S7 Stock has its air
        // conditioning in the roof.
        .ceil_y = @min(y1 - 0.2, floor_y + 2.1),
        .y1 = y1,
        .side = side,
    };
}

pub const Kind = enum {
    /// The floor and the side walls up to the sills: they also show.
    shell,
    /// The roof, the cab ends and the partitions: they only stop. The
    /// details draw them in the shape of the stock.
    cover,
    /// The opening of a pair of doors on the platform side. A moving
    /// train makes it solid while the doors are closed (map.zig Train).
    doorway,
    seat,
};

const floor_c = v3(0.22, 0.22, 0.23);
const gangway_c = v3(0.1, 0.1, 0.11);
const glass = v3(0.03, 0.04, 0.05);
/// The half width of an open gangway.
const gangway: f32 = 0.8;

/// Call `sink.part(min, max, kind, color, mat, surface)` for each part, in
/// train coordinates.
pub fn parts(b: *const Body, sink: anytype) void {
    const s = b.stock;
    const hl = b.half_len;
    const dw = s.door_w / 2;
    const ce = s.cab;
    sink.part(v3(-hl, b.y0, b.z0), v3(hl, b.floor_y, b.z1), .shell, floor_c, .metal, .metal);
    sink.part(v3(-hl, b.ceil_y, b.z0), v3(hl, b.y1, b.z1), .cover, s.top, .metal, .sheet_metal);
    sink.part(v3(-hl, b.floor_y, b.z0), v3(-hl + ce, b.ceil_y, b.z1), .cover, s.front, .metal, .sheet_metal);
    sink.part(v3(hl - ce, b.floor_y, b.z0), v3(hl, b.ceil_y, b.z1), .cover, s.front, .metal, .sheet_metal);

    // The side with closed doors: one wall up to the sills. The platform
    // side: the walls between the door openings, and a doorway part in
    // each opening.
    const far = if (b.side > 0) [2]f32{ b.z0, b.innerZ0() } else [2]f32{ b.innerZ1(), b.z1 };
    const near = if (b.side > 0) [2]f32{ b.innerZ1(), b.z1 } else [2]f32{ b.z0, b.innerZ0() };
    sink.part(v3(-hl + ce, b.floor_y, far[0]), v3(hl - ce, b.sill_y, far[1]), .shell, s.body, .metal, .sheet_metal);
    var doors: [max_doors]f32 = undefined;
    const xs = b.doorXs(&doors);
    var x = -hl + ce;
    for (xs) |dx| {
        sink.part(v3(x, b.floor_y, near[0]), v3(dx - dw, b.sill_y, near[1]), .shell, s.body, .metal, .sheet_metal);
        sink.part(v3(dx - dw, b.floor_y, near[0]), v3(dx + dw, b.ceil_y, near[1]), .doorway, s.door, .metal, .sheet_metal);
        x = dx + dw;
    }
    sink.part(v3(x, b.floor_y, near[0]), v3(hl - ce, b.sill_y, near[1]), .shell, s.body, .metal, .sheet_metal);

    // A partition between two cars, or the two sides of an open gangway.
    var ends: [max_cars + 1]f32 = undefined;
    const e = b.carEnds(&ends);
    const cz = b.centreZ();
    for (e[1 .. e.len - 1]) |ex| {
        if (s.gangways) {
            sink.part(v3(ex - 0.12, b.floor_y, b.innerZ0()), v3(ex + 0.12, b.ceil_y, cz - gangway), .shell, gangway_c, .paint, .fabric);
            sink.part(v3(ex - 0.12, b.floor_y, cz + gangway), v3(ex + 0.12, b.ceil_y, b.innerZ1()), .shell, gangway_c, .paint, .fabric);
        } else {
            const t = @max(0.05, s.gap / 2);
            sink.part(v3(ex - t, b.floor_y, b.innerZ0()), v3(ex + t, b.ceil_y, b.innerZ1()), .cover, s.body, .metal, .sheet_metal);
        }
    }

    // Long seats along both walls between the doors. A seat runs through a
    // partition: the two halves are one part.
    var a = -hl + cab_len;
    for (0..xs.len + 1) |i| {
        const end = if (i < xs.len) xs[i] - dw - seat_gap else hl - cab_len;
        if (end - a > 0.6) {
            sink.part(v3(a, b.floor_y, b.innerZ0()), v3(end, b.floor_y + seat_h, b.innerZ0() + seat_d), .seat, s.seat, .cloth, .fabric);
            sink.part(v3(a, b.floor_y, b.innerZ1() - seat_d), v3(end, b.floor_y + seat_h, b.innerZ1()), .seat, s.seat, .cloth, .fabric);
        }
        if (i < xs.len) a = xs[i] + dw + seat_gap;
    }
}

/// A frame for a box: the columns are the local axes and the origin.
fn frame(o: V3, ax: V3, ay: V3, az: V3) Mat4 {
    return .{ .data = .{ ax[0], ax[1], ax[2], 0, ay[0], ay[1], ay[2], 0, az[0], az[1], az[2], 0, o[0], o[1], o[2], 1 } };
}

/// A strip of the body from x0 to x1 on the cross-section line from point
/// p to point q ({y, half width}) of side `face` (-1: the z0 side, 1: the
/// z1 side), `depth` m thick into the body. Its outside face lies on the
/// line.
fn facet(b: *const Body, sink: anytype, x0: f32, x1: f32, p: [2]f32, q: [2]f32, face: f32, depth: f32, color: V3, mat: Mat, surface: Surface) void {
    const cz = b.centreZ();
    const a = v3(x0, p[0], cz + face * p[1]);
    const d = v3(0, q[0] - p[0], face * (q[1] - p[1]));
    const l = vec.len(d);
    if (l < 1e-4 or x1 <= x0) return;
    const ay = d / vec.s(l);
    // az = ax x ay: out of the body on the z1 side, into it on the z0 side.
    const az = v3(0, -ay[2], ay[1]);
    const zr = if (face > 0) [2]f32{ -depth, 0 } else [2]f32{ 0, depth };
    sink.slab(frame(a, v3(1, 0, 0), ay, az), v3(0, 0, zr[0]), v3(x1 - x0, l, zr[1]), color, mat, surface);
}

/// An end wall of the body from x0 to x1 in the shape of the
/// cross-section, from y_from up, `inset` m inside the outline.
fn endWall(b: *const Body, sink: anytype, x0: f32, x1: f32, y_from: f32, inset: f32, color: V3, mat: Mat, surface: Surface) void {
    const cz = b.centreZ();
    const sh = b.profile(0);
    if (y_from < sh[0]) sink.box(v3(x0, y_from, cz - sh[1] + inset), v3(x1, sh[0], cz + sh[1] - inset), color, mat, surface);
    var p = sh;
    for (1..b.stock.roof.len + 1) |i| {
        const q = b.profile(i);
        const w = @min(p[1], q[1]) - inset;
        if (q[0] > p[0] and w > 0 and q[0] > y_from) {
            sink.box(v3(x0, @max(p[0], y_from), cz - w), v3(x1, q[0] - inset * 0.5, cz + w), color, mat, surface);
        }
        // The edge strips fill the curve between the steps.
        if (p[0] >= y_from) {
            const pp: [2]f32 = .{ p[0] - inset, p[1] - inset };
            const qq: [2]f32 = .{ q[0] - inset, q[1] - inset };
            for ([_]f32{ -1, 1 }) |face| {
                facet(b, sink, x0, x1, pp, qq, face, @max(0.3, @min(p[1], q[1]) * 0.5), color, mat, surface);
            }
        }
        p = q;
    }
}

/// Call `sink.box(min, max, color, mat, surface)` for each detail, and
/// `sink.slab(m, min, max, color, mat, surface)` for each detail that
/// is turned (a box from local min and max, placed by m), in train
/// coordinates. `open`: the doors of the platform side, 0 closed to 1
/// open.
pub fn details(b: *const Body, sink: anytype, open: f32) void {
    const s = b.stock;
    const hl = b.half_len;
    const dw = s.door_w / 2;
    const ce = s.cab;
    const pole = v3(0.85, 0.68, 0.08);
    const sh_y = b.shoulderY();
    var doors: [max_doors]f32 = undefined;
    const xs = b.doorXs(&doors);
    var pillar_buf: [max_pillars]f32 = undefined;
    const pillars = b.pillarXs(&pillar_buf);
    // The roof strips run between the cab fronts. A raked front leans
    // back from the end of the body.
    const rx = hl - s.rake;
    const door_top = if (s.tall_doors) b.profile(1)[0] else @min(sh_y, b.ceil_y) - 0.02;

    for ([_]f32{ -1, 1 }) |face| {
        // The outside face of this side, and the side of the platform.
        const zo = if (face > 0) b.z1 else b.z0;
        const zi = if (face > 0) b.innerZ1() else b.innerZ0();
        const za = @min(zo, zi) - 0.01;
        const zb = @max(zo, zi) + 0.01;
        const platform = face == b.side;
        sink.box(v3(-hl, b.y0, za), v3(hl, b.floor_y + 0.12, zb), s.skirt, .paint, .sheet_metal);
        // The window pillars from the sill to the shoulder, and on up the
        // first roof strip on the tube stock.
        for (pillars) |px| {
            sink.box(v3(px, b.sill_y, za + 0.005), v3(px + 0.14, sh_y, zb - 0.005), s.pillar, .metal, .sheet_metal);
            if (s.tall_doors) facet(b, sink, px, px + 0.14, b.profile(0), b.profile(1), face, wall, s.pillar, .metal, .sheet_metal);
        }
        // The roof strips. On the tube stock the first strip is the top of
        // the windows: solid only over the cab ends.
        for (0..s.roof.len) |i| {
            const p = b.profile(i);
            const q = b.profile(i + 1);
            const col = if (i + 2 >= s.roof.len) s.top else s.body;
            if (i == 0 and s.tall_doors) {
                facet(b, sink, -hl, -hl + ce, p, q, face, wall, s.body, .metal, .sheet_metal);
                facet(b, sink, hl - ce, hl, p, q, face, wall, s.body, .metal, .sheet_metal);
            } else {
                facet(b, sink, -rx, rx, p, q, face, wall, col, .metal, .sheet_metal);
            }
        }
        // A sub-surface train: the band of black over the windows, and
        // the gangway bellows between the cars.
        if (s.gangways) {
            var joints: [max_cars + 1]f32 = undefined;
            for (b.carEnds(&joints)[1..s.cars.len]) |ex| {
                sink.box(v3(ex - 0.1, b.y0 + 0.1, za - 0.01), v3(ex + 0.1, sh_y, zb + 0.01), gangway_c, .paint, .fabric);
            }
        }

        // The door leaves. The doors of the platform side slide apart:
        // outside the body (S7 Stock), or into pockets in the wall.
        const slide = if (platform) open * dw else 0;
        const lz0 = if (s.outside_doors) (if (face > 0) zo + 0.005 else zo - 0.035) else (if (face > 0) zo - 0.05 else zo + 0.02);
        const gz = if (face > 0) lz0 + 0.035 else lz0 - 0.005;
        for (xs) |dx| {
            for ([_]f32{ -1, 1 }) |h| {
                const c = dx + h * (dw / 2 + slide);
                const top = if (s.tall_doors) sh_y else door_top;
                sink.box(v3(c - dw / 2, b.floor_y, lz0), v3(c + dw / 2, top, lz0 + 0.03), s.door, .paint, .sheet_metal);
                sink.box(v3(c - dw / 2 + 0.1, b.sill_y + 0.1, @min(lz0, gz) - 0.002), v3(c + dw / 2 - 0.1, top - 0.15, @max(lz0 + 0.03, gz) + 0.002), glass, .paint, .glass);
                // The top of a tube door curves with the roof.
                if (s.tall_doors) {
                    const p0 = b.profile(0);
                    const p1 = b.profile(1);
                    const out: f32 = if (s.outside_doors) 0.02 else -0.01;
                    facet(b, sink, c - dw / 2, c + dw / 2, .{ p0[0], p0[1] + out }, .{ p1[0] - 0.03, p1[1] + out }, face, 0.03, s.door, .paint, .sheet_metal);
                }
            }
        }
        // The cab side: the wall from the end of the window band to the cab
        // front, and the cab side window.
        for ([_]f32{ -1, 1 }) |en| {
            const xa = if (en < 0) -hl else hl - ce;
            const xb = if (en < 0) -hl + ce else hl;
            sink.box(v3(xa, b.floor_y, za + 0.005), v3(xb, @min(sh_y, b.floor_y + 0.95), zb - 0.005), s.body, .metal, .sheet_metal);
            if (s.rake > 0) {
                // The side of a raked cab: steps under the line of the
                // windscreen.
                for (0..3) |k| {
                    const fk: f32 = @floatFromInt(k);
                    const y_lo = b.floor_y + 0.95 + (sh_y - b.floor_y - 0.95) * fk / 3;
                    const y_hi = b.floor_y + 0.95 + (sh_y - b.floor_y - 0.95) * (fk + 1) / 3;
                    const back = s.rake * (fk + 1) / 3;
                    const x_lo = if (en < 0) -hl + back else hl - ce;
                    const x_hi = if (en < 0) -hl + ce else hl - back;
                    sink.box(v3(x_lo, y_lo, za + 0.005), v3(x_hi, y_hi, zb - 0.005), if (k == 0) s.body else s.pillar, .metal, .sheet_metal);
                }
            }
        }
    }

    // The ends between the cars: the end wall of each car in the shape of
    // the body, and a window in the end door. The gangways of a
    // walk-through train: a dark frame over each one.
    const iz0 = b.innerZ0();
    const iz1 = b.innerZ1();
    const cz = b.centreZ();
    var ends: [max_cars + 1]f32 = undefined;
    const e = b.carEnds(&ends);
    for (e[1 .. e.len - 1]) |ex| {
        if (s.gangways) {
            sink.box(v3(ex - 0.12, b.ceil_y - 0.15, iz0), v3(ex + 0.12, b.ceil_y, iz1), gangway_c, .paint, .fabric);
        } else {
            const t = @max(0.05, s.gap / 2);
            endWall(b, sink, ex - t, ex - t + 0.04, b.y0, 0.02, s.body, .metal, .sheet_metal);
            endWall(b, sink, ex + t - 0.04, ex + t, b.y0, 0.02, s.body, .metal, .sheet_metal);
            sink.box(v3(ex - t - 0.01, b.floor_y, cz - 0.35), v3(ex + t + 0.01, b.ceil_y - 0.05, cz + 0.35), s.door * vec.s(0.8), .paint, .sheet_metal);
            sink.box(v3(ex - t - 0.02, b.sill_y + 0.1, cz - 0.25), v3(ex + t + 0.02, b.ceil_y - 0.25, cz + 0.25), glass, .paint, .glass);
        }
    }

    // The cab fronts: white lights at the front (-X), red at the back.
    for ([_]f32{ -1, 1 }) |en| cabFront(b, sink, en);

    // Inside: the ceiling panel with two strips of lights, the seat backs,
    // the grab rails over the seats and the poles beside the doors.
    const cw = b.halfWidth(b.ceil_y) - wall;
    sink.box(v3(-hl + ce, b.ceil_y - 0.02, cz - cw), v3(hl - ce, b.ceil_y, cz + cw), v3(0.82, 0.8, 0.74), .paint, .plaster);
    for ([_]f32{ cz - 0.55, cz + 0.45 }) |lz| {
        sink.box(v3(-hl + 0.5, b.ceil_y - 0.05, lz), v3(hl - 0.5, b.ceil_y - 0.02, lz + 0.1), v3(0.95, 0.97, 1.0), .emissive, .glass);
    }
    var a = -hl + cab_len;
    for (0..xs.len + 1) |i| {
        const end = if (i < xs.len) xs[i] - dw - seat_gap else hl - cab_len;
        if (end - a > 0.6) {
            sink.box(v3(a, b.floor_y + seat_h, iz0), v3(end, b.sill_y, iz0 + 0.08), s.seat * vec.s(0.8), .cloth, .fabric);
            sink.box(v3(a, b.floor_y + seat_h, iz1 - 0.08), v3(end, b.sill_y, iz1), s.seat * vec.s(0.8), .cloth, .fabric);
            // A pole at each end of the seat, on its front corner: the
            // seat keeps a player out of the pole.
            for ([_]f32{ a + 0.03, end - 0.07 }) |px| {
                for ([_]f32{ iz0 + seat_d - 0.07, iz1 - seat_d + 0.03 }) |pz| {
                    sink.box(v3(px, b.floor_y + seat_h, pz), v3(px + 0.04, b.ceil_y, pz + 0.04), pole, .metal, .metal);
                }
            }
        }
        if (i < xs.len) a = xs[i] + dw + seat_gap;
    }
    // The grab rails over the seats, above the head of a player.
    for ([_]f32{ iz0 + seat_d - 0.07, iz1 - seat_d + 0.03 }) |rz| {
        sink.box(v3(-hl + cab_len, b.ceil_y - 0.12, rz), v3(hl - cab_len, b.ceil_y - 0.09, rz + 0.04), pole, .metal, .metal);
    }

    // The air conditioning on the roof of a sub-surface train: one unit on
    // each car.
    if (s.gangways) {
        const top = b.profile(s.roof.len)[0];
        for (e[0..s.cars.len], e[1..]) |c0, c1| {
            const m = (c0 + c1) / 2;
            sink.box(v3(m - 1.6, top - 0.02, cz - 0.7), v3(m + 1.6, b.y1, cz + 0.7), s.top * vec.s(0.85), .metal, .sheet_metal);
        }
    }
}

/// The cab front at the end `e` of the train (-1: -X, the front; 1: the
/// back). The 1973 Stock: a flat red front, the driver's window and the
/// window of the end door, the blind of the destination over them. The
/// S7 Stock: a red nose, a big windscreen that leans back, and the orange
/// destination display over it.
fn cabFront(b: *const Body, sink: anytype, e: f32) void {
    const s = b.stock;
    const hl = b.half_len;
    const cz = b.centreZ();
    const half = s.width / 2;
    const xo = e * hl;
    // From the end of the body to t m inside it.
    const span = struct {
        fn x(end: f32, outer: f32, t: f32) [2]f32 {
            return if (end < 0) .{ outer, outer + t } else .{ outer - t, outer };
        }
    }.x;
    const lamp = if (e < 0) v3(1.0, 0.97, 0.9) else v3(0.9, 0.05, 0.03);
    const black = v3(0.02, 0.02, 0.02);
    // The skirt and the coupler.
    const sk = span(e, xo, 0.2);
    sink.box(v3(sk[0] - 0.01, b.y0, cz - half - 0.01), v3(sk[1] + 0.01, b.floor_y + 0.12, cz + half + 0.01), s.skirt, .paint, .sheet_metal);
    const cp = span(e, xo, 0.05);
    sink.box(v3(cp[0] - 0.01, b.y0 - 0.15, cz - 0.2), v3(cp[1] + 0.01, b.y0 + 0.2, cz + 0.2), black, .metal, .metal);

    if (s.rake == 0) {
        const f = span(e, xo, s.cab);
        endWall(b, sink, f[0], f[1], b.floor_y + 0.12, 0, s.front, .paint, .sheet_metal);
        const g = span(e, xo, -0.01);
        const g0 = @min(g[0], g[1]);
        const g1 = @max(g[0], g[1]);
        // The driver's window (on the left of the driver) and the window
        // of the end door, with black surrounds.
        const wy0 = b.floor_y + 0.95;
        const wy1 = b.shoulderY() - 0.05;
        const left = -e;
        const drv = [2]f32{ cz + left * 0.15, cz + left * (half - 0.22) };
        const dor = [2]f32{ cz - left * 0.05, cz - left * 0.62 };
        for ([_][2]f32{ drv, dor }) |w| {
            const w0 = @min(w[0], w[1]);
            const w1 = @max(w[0], w[1]);
            sink.box(v3(g0, wy0 - 0.05, w0 - 0.05), v3(g1, wy1 + 0.05, w1 + 0.05), black, .paint, .sheet_metal);
            sink.box(v3(g0 - 0.005, wy0, w0), v3(g1 + 0.005, wy1, w1), glass, .paint, .glass);
        }
        // The destination blind over the door window.
        const dz0 = @min(dor[0], dor[1]);
        const dz1 = @max(dor[0], dor[1]);
        sink.box(v3(g0, wy1 + 0.1, dz0), v3(g1, wy1 + 0.3, dz1), black, .paint, .sheet_metal);
        sink.box(v3(g0 - 0.005, wy1 + 0.15, dz0 + 0.05), v3(g1 + 0.005, wy1 + 0.25, dz1 - 0.05), v3(0.9, 0.9, 0.85), .emissive, .glass);
        // Two lights low on each side.
        for ([_]f32{ cz - half + 0.2, cz + half - 0.5 }) |lz| {
            sink.box(v3(g0 - 0.005, b.floor_y + 0.3, lz), v3(g1 + 0.005, b.floor_y + 0.5, lz + 0.3), lamp, .emissive, .glass);
        }
        return;
    }

    // The S7 Stock. The nose up to the windscreen bottom.
    const ny = b.floor_y + 0.95;
    const nose = span(e, xo, 0.25);
    sink.box(v3(nose[0], b.floor_y + 0.12, cz - half), v3(nose[1], ny, cz + half), s.front, .paint, .sheet_metal);
    for ([_]f32{ cz - half + 0.15, cz + half - 0.45 }) |lz| {
        const l = span(e, xo, -0.01);
        sink.box(v3(@min(l[0], l[1]), b.floor_y + 0.45, lz), v3(@max(l[0], l[1]), b.floor_y + 0.62, lz + 0.3), lamp, .emissive, .glass);
    }
    // The windscreen: a strip that leans back from the nose to the
    // shoulder, with red frames at its sides.
    const sh_y = b.shoulderY();
    const p = v3(xo, ny, 0);
    const d = v3(-e * s.rake, sh_y - ny, 0);
    const l = vec.len(d);
    const ay = d / vec.s(l);
    const ax = v3(ay[1], -ay[0], 0);
    const xr = if (e > 0) [2]f32{ -0.06, 0 } else [2]f32{ 0, 0.06 };
    const m = frame(p, ax, ay, v3(0, 0, 1));
    sink.slab(m, v3(xr[0], 0, cz - half + 0.18), v3(xr[1], l, cz + half - 0.18), glass, .paint, .glass);
    for ([_][2]f32{ .{ cz - half, cz - half + 0.18 }, .{ cz + half - 0.18, cz + half } }) |z| {
        sink.slab(m, v3(xr[0] * 2, 0, z[0]), v3(xr[1] * 2, l, z[1]), s.front, .paint, .sheet_metal);
    }
    // The cap over the windscreen, back to the roof strips, with the
    // destination display.
    const cap = span(e, e * (hl - s.rake), 0.12);
    endWall(b, sink, cap[0], cap[1], sh_y, 0, s.front, .paint, .sheet_metal);
    const dsp = span(e, e * (hl - s.rake), -0.01);
    sink.box(v3(@min(dsp[0], dsp[1]), sh_y + 0.08, cz - 0.5), v3(@max(dsp[0], dsp[1]), sh_y + 0.26, cz + 0.5), black, .paint, .sheet_metal);
    sink.box(v3(@min(dsp[0], dsp[1]) - 0.005, sh_y + 0.12, cz - 0.45), v3(@max(dsp[0], dsp[1]) + 0.005, sh_y + 0.22, cz + 0.45), v3(1.0, 0.55, 0.1), .emissive, .glass);
    // The back wall of the driver's cab, inside the car.
    const back = span(e, e * (hl - s.cab), -0.03);
    endWall(b, sink, @min(back[0], back[1]), @max(back[0], back[1]), b.floor_y, wall, v3(0.82, 0.8, 0.74), .paint, .plaster);
}

/// A test sink: it keeps the bounds of every detail and every slab
/// corner.
const Bounds = struct {
    pts: std.ArrayList(V3) = .empty,
    alloc: std.mem.Allocator,
    pub fn box(self: *Bounds, min: V3, max: V3, _: V3, _: Mat, _: Surface) void {
        self.corners(Mat4.identity(), min, max);
    }
    pub fn slab(self: *Bounds, m: Mat4, min: V3, max: V3, _: V3, _: Mat, _: Surface) void {
        self.corners(m, min, max);
    }
    fn corners(self: *Bounds, m: Mat4, min: V3, max: V3) void {
        for (0..8) |i| {
            const p = v3(if (i & 1 != 0) max[0] else min[0], if (i & 2 != 0) max[1] else min[1], if (i & 4 != 0) max[2] else min[2]);
            self.pts.append(self.alloc, vec.xform(m, p)) catch {};
        }
    }
};

test "the stock lengths are the real train lengths" {
    const b73 = body(&stock_1973, 0, 0, 0.7, 1);
    try std.testing.expectApproxEqAbs(@as(f32, 106.81 / 2.0), b73.half_len, 0.01);
    const bs7 = body(&stock_s7, 0, 0, 1.0, 1);
    try std.testing.expectApproxEqAbs(@as(f32, 117.448 / 2.0), bs7.half_len, 0.01);
    // A player fits through a door opening, and not through a window.
    const player = @import("player.zig");
    for ([_]Body{ b73, bs7 }) |b| {
        try std.testing.expect(b.ceil_y - b.floor_y > player.height + 0.1);
        try std.testing.expect(b.ceil_y - b.sill_y < player.height);
        try std.testing.expect(b.stock.door_w > 2 * player.radius + 0.3);
        // The roof ends at the stock height, on the centre line.
        try std.testing.expectApproxEqAbs(b.y1, b.profile(b.stock.roof.len)[0], 0.1);
        try std.testing.expectEqual(@as(f32, 0), b.halfWidth(b.y1 + 1));
    }
}

test "the 1973 Stock fits the tube tunnel bore" {
    // As at Earl's Court: the floor 0.71 m over the rail.
    const rail: f32 = -15.69;
    const b = body(&stock_1973, -28.8, rail, rail + 0.71, 1);
    var sink: Bounds = .{ .alloc = std.testing.allocator };
    defer sink.pts.deinit(std.testing.allocator);
    details(&b, &sink, 0);
    details(&b, &sink, 1);
    // The parts that show: the floor and the walls.
    const Shown = struct {
        s: *Bounds,
        pub fn part(self: @This(), min: V3, max: V3, kind: Kind, c: V3, m: Mat, sf: Surface) void {
            if (kind == .shell) self.s.box(min, max, c, m, sf);
        }
    };
    parts(&b, Shown{ .s = &sink });
    const cy = rail + tube_bore.centre;
    var worst: f32 = 0;
    for (sink.pts.items) |p| {
        const dy = p[1] - cy;
        const dz = p[2] - b.centreZ();
        worst = @max(worst, @sqrt(dy * dy + dz * dz));
    }
    // 2 cm or more from the tunnel lining.
    try std.testing.expect(worst < tube_bore.radius - 0.02);
    try std.testing.expect(worst > tube_bore.radius - 0.2);
}

test "a facet lies on its cross-section line" {
    const b = body(&stock_1973, 0, 0, 0.7, 1);
    var sink: Bounds = .{ .alloc = std.testing.allocator };
    defer sink.pts.deinit(std.testing.allocator);
    for ([_]f32{ -1, 1 }) |face| {
        sink.pts.clearRetainingCapacity();
        facet(&b, &sink, 0, 1, b.profile(1), b.profile(2), face, wall, v3(1, 1, 1), .metal, .metal);
        // All the corners are inside the outline, and two of them on it.
        var on: usize = 0;
        for (sink.pts.items) |p| {
            try std.testing.expect(@abs(p[2]) <= b.halfWidth(p[1]) + 1e-3);
            if (@abs(@abs(p[2]) - b.halfWidth(p[1])) < 1e-3) on += 1;
        }
        try std.testing.expect(on >= 4);
    }
}
