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
// details only show: the door leaves, the window pillars, the skirt, the
// cab fronts, the seat backs, the grab poles and rails, and the lights.
//
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
    /// The clear opening of a pair of doors, m.
    door_w: f32,
    /// The centre of each pair of doors on one side of a car, as a part of
    /// the car length from its front end.
    doors: []const f32,
    /// A walk-through train has open gangways: no partitions between the
    /// cars.
    gangways: bool,
    body: V3,
    door: V3,
    skirt: V3,
    seat: V3,
};

/// The 1973 Stock of the Piccadilly line: 6 cars, 106.81 m, 2.629 m wide,
/// 2.888 m high. Sources: Wikipedia, "London Underground 1973 Stock"
/// (car lengths 17.473 m for a driving motor car and 17.676 m for the
/// others, and the train length: the 0.232 m between two cars makes up the
/// rest), and the TfL information sheet "1973 Tube Stock" (FOI-1290-1718).
/// The door opening and the door places are approximate. The real cars
/// also have a single door at each car end, which the game leaves out.
pub const stock_1973: Stock = .{
    .cars = &.{ 17.473, 17.676, 17.676, 17.676, 17.676, 17.473 },
    .gap = 0.232,
    .width = 2.629,
    .height = 2.888,
    .door_w = 1.4,
    .doors = &.{ 0.3, 0.7 },
    .gangways = false,
    .body = v3(0.86, 0.87, 0.88),
    .door = v3(0.75, 0.06, 0.05),
    .skirt = v3(0.04, 0.12, 0.45),
    .seat = v3(0.12, 0.18, 0.42),
};

/// The S7 Stock of the District line: 7 cars, 117.448 m, 2.92 m wide,
/// 3.682 m high, three pairs of doors on each side of a car, open
/// gangways. Sources: Wikipedia, "London Underground S7 and S8 Stock" (car
/// lengths 18.139 m for a driving motor car and 16.234 m for the others),
/// and the TfL "S Stock information sheet" of July 2010 (FOI-0158-2021).
/// The door opening and the door places are approximate.
pub const stock_s7: Stock = .{
    .cars = &.{ 18.139, 16.234, 16.234, 16.234, 16.234, 16.234, 18.139 },
    .gap = 0,
    .width = 2.92,
    .height = 3.682,
    .door_w = 1.6,
    .doors = &.{ 0.2, 0.5, 0.8 },
    .gangways = true,
    .body = v3(0.86, 0.87, 0.88),
    .door = v3(0.75, 0.06, 0.05),
    .skirt = v3(0.04, 0.12, 0.45),
    .seat = v3(0.3, 0.1, 0.2),
};

/// The thickness of a side wall, and of a cab end.
pub const wall: f32 = 0.08;
pub const cab_end: f32 = 0.15;
/// The seats: their height and depth, the free space beside each doorway,
/// and the free space behind each cab (the driver's cab).
const seat_h: f32 = 0.45;
const seat_d: f32 = 0.48;
const seat_gap: f32 = 0.35;
const cab_len: f32 = 2.0;
const max_cars = 8;
pub const max_doors = 24;

/// A train placed on a track, in train coordinates.
pub const Body = struct {
    stock: *const Stock,
    half_len: f32,
    /// The outside of the side walls.
    z0: f32,
    z1: f32,
    /// The bottom of the body, the top of the floor, the window sills, the
    /// ceiling (the top of the door openings) and the top of the roof.
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
    /// The floor, the roof, the walls, the cab ends and the partitions.
    shell,
    /// The opening of a pair of doors on the platform side. A moving
    /// train makes it solid while the doors are closed (map.zig Train).
    doorway,
    seat,
};

const floor_c = v3(0.22, 0.22, 0.23);
const gangway_c = v3(0.1, 0.1, 0.11);
/// The half width of an open gangway.
const gangway: f32 = 0.8;

/// Call `sink.part(min, max, kind, color, mat, surface)` for each part, in
/// train coordinates.
pub fn parts(b: *const Body, sink: anytype) void {
    const s = b.stock;
    const hl = b.half_len;
    const dw = s.door_w / 2;
    sink.part(v3(-hl, b.y0, b.z0), v3(hl, b.floor_y, b.z1), .shell, floor_c, .metal, .metal);
    sink.part(v3(-hl, b.ceil_y, b.z0), v3(hl, b.y1, b.z1), .shell, s.body * vec.s(0.8), .metal, .sheet_metal);
    sink.part(v3(-hl, b.floor_y, b.z0), v3(-hl + cab_end, b.ceil_y, b.z1), .shell, s.door, .metal, .sheet_metal);
    sink.part(v3(hl - cab_end, b.floor_y, b.z0), v3(hl, b.ceil_y, b.z1), .shell, s.door, .metal, .sheet_metal);

    // The side with closed doors: one wall up to the sills. The platform
    // side: the walls between the door openings, and a doorway part in
    // each opening.
    const far = if (b.side > 0) [2]f32{ b.z0, b.innerZ0() } else [2]f32{ b.innerZ1(), b.z1 };
    const near = if (b.side > 0) [2]f32{ b.innerZ1(), b.z1 } else [2]f32{ b.z0, b.innerZ0() };
    sink.part(v3(-hl + cab_end, b.floor_y, far[0]), v3(hl - cab_end, b.sill_y, far[1]), .shell, s.body, .metal, .sheet_metal);
    var doors: [max_doors]f32 = undefined;
    const xs = b.doorXs(&doors);
    var x = -hl + cab_end;
    for (xs) |dx| {
        sink.part(v3(x, b.floor_y, near[0]), v3(dx - dw, b.sill_y, near[1]), .shell, s.body, .metal, .sheet_metal);
        sink.part(v3(dx - dw, b.floor_y, near[0]), v3(dx + dw, b.ceil_y, near[1]), .doorway, s.door, .metal, .sheet_metal);
        x = dx + dw;
    }
    sink.part(v3(x, b.floor_y, near[0]), v3(hl - cab_end, b.sill_y, near[1]), .shell, s.body, .metal, .sheet_metal);

    // A partition between two cars, or the two sides of an open gangway.
    var ends: [max_cars + 1]f32 = undefined;
    const e = b.carEnds(&ends);
    const cz = (b.innerZ0() + b.innerZ1()) / 2;
    for (e[1 .. e.len - 1]) |ex| {
        if (s.gangways) {
            sink.part(v3(ex - 0.12, b.floor_y, b.innerZ0()), v3(ex + 0.12, b.ceil_y, cz - gangway), .shell, gangway_c, .paint, .fabric);
            sink.part(v3(ex - 0.12, b.floor_y, cz + gangway), v3(ex + 0.12, b.ceil_y, b.innerZ1()), .shell, gangway_c, .paint, .fabric);
        } else {
            const t = @max(0.05, s.gap / 2);
            sink.part(v3(ex - t, b.floor_y, b.innerZ0()), v3(ex + t, b.ceil_y, b.innerZ1()), .shell, s.body, .metal, .sheet_metal);
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

/// Call `sink.box(min, max, color, mat, surface)` for each detail, in train
/// coordinates. `open`: the doors of the platform side, 0 closed to 1 open.
pub fn details(b: *const Body, sink: anytype, open: f32) void {
    const s = b.stock;
    const hl = b.half_len;
    const dw = s.door_w / 2;
    const glass = v3(0.03, 0.04, 0.05);
    const pole = v3(0.85, 0.68, 0.08);
    var doors: [max_doors]f32 = undefined;
    const xs = b.doorXs(&doors);

    for ([_]f32{ -1, 1 }) |face| {
        // The outside face of this side, and the side of the platform.
        const zo = if (face > 0) b.z1 else b.z0;
        const zi = if (face > 0) b.innerZ1() else b.innerZ0();
        const za = @min(zo, zi) - 0.01;
        const zb = @max(zo, zi) + 0.01;
        const platform = face == b.side;
        sink.box(v3(-hl, b.y0, za), v3(hl, b.floor_y + 0.12, zb), s.skirt, .paint, .sheet_metal);
        // Window pillars: at each end of a wall, and each 1.8 m.
        var x = -hl + cab_end;
        for (0..xs.len + 1) |i| {
            const end = if (i < xs.len) xs[i] - dw else hl - cab_end;
            const n: usize = @intFromFloat(@max(1, @round((end - x) / 1.8)));
            for (0..n + 1) |k| {
                const px = x + (end - x) * @as(f32, @floatFromInt(k)) / @as(f32, @floatFromInt(n));
                const p0 = std.math.clamp(px - 0.07, x, end - 0.14);
                sink.box(v3(p0, b.sill_y, za), v3(p0 + 0.14, b.ceil_y, zb), s.body, .metal, .sheet_metal);
            }
            if (i < xs.len) x = xs[i] + dw;
        }
        // The door leaves, outside the wall. The doors of the platform side
        // slide apart.
        const slide = if (platform) vec.smooth(open) * dw else 0;
        const lz0 = if (face > 0) zo + 0.005 else zo - 0.035;
        for (xs) |dx| {
            for ([_]f32{ -1, 1 }) |h| {
                const c = dx + h * (dw / 2 + slide);
                sink.box(v3(c - dw / 2, b.floor_y, lz0), v3(c + dw / 2, b.ceil_y - 0.02, lz0 + 0.03), s.door, .paint, .sheet_metal);
                sink.box(v3(c - dw / 2 + 0.1, b.sill_y + 0.1, lz0 - 0.005), v3(c + dw / 2 - 0.1, b.ceil_y - 0.25, lz0 + 0.035), glass, .paint, .glass);
            }
        }
    }

    // The cab fronts: a window over the full width, and the lights: white
    // at the front (-X), red at the back.
    for ([_]f32{ -1, 1 }) |e| {
        const xo = e * hl;
        const xa = @min(xo, xo + e * 0.01);
        const xb = @max(xo, xo + e * 0.01);
        sink.box(v3(xa, b.floor_y + 0.95, b.z0 + 0.25), v3(xb, b.ceil_y - 0.1, b.z1 - 0.25), glass, .paint, .glass);
        sink.box(v3(xa, b.y0, b.z0), v3(xb, b.floor_y + 0.12, b.z1), s.skirt, .paint, .sheet_metal);
        const lamp = if (e < 0) v3(1.0, 0.97, 0.9) else v3(0.9, 0.05, 0.03);
        for ([_]f32{ b.z0 + 0.3, b.z1 - 0.6 }) |lz| {
            sink.box(v3(xa - 0.01, b.floor_y + 0.35, lz), v3(xb + 0.01, b.floor_y + 0.55, lz + 0.3), lamp, .emissive, .glass);
        }
    }

    // Inside: the ceiling panel with two strips of lights, the seat backs,
    // the grab rails over the seats and the poles beside the doors.
    const iz0 = b.innerZ0();
    const iz1 = b.innerZ1();
    const cz = (iz0 + iz1) / 2;
    sink.box(v3(-hl + cab_end, b.ceil_y - 0.02, iz0), v3(hl - cab_end, b.ceil_y, iz1), v3(0.82, 0.8, 0.74), .paint, .plaster);
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
    // The gangways of a walk-through train: a dark frame over each one.
    // The partitions of the other trains: a window in the end door.
    var ends: [max_cars + 1]f32 = undefined;
    const e = b.carEnds(&ends);
    for (e[1 .. e.len - 1]) |ex| {
        if (s.gangways) {
            sink.box(v3(ex - 0.12, b.ceil_y - 0.15, iz0), v3(ex + 0.12, b.ceil_y, iz1), gangway_c, .paint, .fabric);
        } else {
            sink.box(v3(ex - 0.06, b.sill_y + 0.1, cz - 0.3), v3(ex + 0.06, b.ceil_y - 0.2, cz + 0.3), glass, .paint, .glass);
        }
    }
}

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
    }
}
