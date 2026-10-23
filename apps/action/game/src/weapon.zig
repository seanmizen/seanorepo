// The weapons: the models, the classes and their stats, the items that a
// player carries, and the hands (the fire, the reload, the switch and the
// view-model pose).
//
// - Models: assets/guns.bin (scripts/convert-gun.ts). Every gun of the
//   Quaternius Ultimate Gun Pack except the sniper rifles, and a bayonet as
//   the knife. The name of a model gives its class.
// - Classes: each class has its own stats (`table`). The models of one
//   class differ only in their look. server/index.ts has the same damage
//   and fire rate numbers for its checks.
// - Items: a weapon as a thing: its class, its model and its rounds. A slot
//   holds one. An item does not know who holds it, so it can also lie in
//   the world.
// - Loadout: the four slots (1 primary, 2 secondary, 3 knife, 4 grenade),
//   the held slot and the hands. A change of slot takes the draw time of
//   the new weapon. It cannot fire before the draw ends.
const std = @import("std");
const vec = @import("vec.zig");
const mesh = @import("mesh.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;

const guns_bin = @embedFile("assets/guns.bin");

/// The weapon classes. The order is the class id of the network messages
/// (server/index.ts WEAPONS has the same order).
pub const Class = enum(u8) { rifle, carbine, bullpup, smg, shotgun, sawn_off, pistol, revolver, knife, grenade };
pub const class_count = @typeInfo(Class).@"enum".field_names.len;

pub const Slot = enum(u8) { primary, secondary, knife, grenade };

pub const Stats = struct {
    /// The name in the menu and on the HUD.
    label: []const u8,
    /// One line about the class, for the weapon menu.
    blurb: []const u8,
    slot: Slot,
    /// The damage of one hit (one pellet), to the body and to the head.
    body: u32 = 0,
    head: u32 = 0,
    pellets: u32 = 1,
    /// The time from one shot (or one burst) to the next.
    interval: f32 = 1,
    /// Hold to fire (true), or one shot (or one burst) for each click.
    auto: bool = false,
    /// The rounds of one click, and the time between them.
    burst: u32 = 1,
    burst_gap: f32 = 0,
    mag: u32 = 0,
    reserve: u32 = 0,
    reload: f32 = 1,
    /// The cone half angle at the hip, in radians: the base, the extra at a
    /// full run, and the extra at full heat (the trigger held).
    spread: f32 = 0,
    move_spread: f32 = 0,
    bloom: f32 = 0,
    /// The heat that one shot adds. The heat is 0 to 1.
    heat: f32 = 0,
    /// How much the sights make the cone smaller (0 to 1).
    ads_tight: f32 = 0.75,
    /// The camera kick of one shot, in radians up. The side kick is a
    /// random part of it.
    kick: f32 = 0,
    /// The kick of the view-model, a multiplier.
    shove: f32 = 1,
    /// The reach of a hit, in metres.
    range: f32 = 200,
    /// The walk speed multiplier while it is held.
    speed: f32 = 1,
    /// The time to take it out, in seconds.
    draw: f32,
    /// The view-model grip at the hip, and its distance at the sights.
    hip: V3 = v3(0.15, -0.18, -0.38),
    ads_z: f32 = -0.3,
    /// The player can aim down the sights.
    sights: bool = true,
};

/// The stats of each class, in the order of Class. The README has the same
/// table. Balance notes: 100 health. Each primary kills in about 0.33 s
/// when all hits land; the rifle hits hard and kicks, the carbine is
/// steady, the bullpup bursts and is accurate, the SMG is fast and loose,
/// the shotguns kill in one shot up close only. A head hit is about 2.5
/// times a body hit. Hipfire on a laptop: the first shot is accurate, the
/// cone grows with the heat and the movement, and the sights make it
/// smaller.
pub const table = [class_count]Stats{
    .{ // rifle
        .label = "RIFLE",
        .blurb = "hits hard, strong kick",
        .slot = .primary,
        .body = 30,
        .head = 75,
        .interval = 0.115,
        .auto = true,
        .mag = 30,
        .reserve = 90,
        .reload = 2.3,
        .spread = 0.006,
        .move_spread = 0.02,
        .bloom = 0.032,
        .heat = 0.13,
        .kick = 0.013,
        .speed = 0.93,
        .draw = 0.45,
    },
    .{ // carbine
        .label = "CARBINE",
        .blurb = "fast and steady",
        .slot = .primary,
        .body = 24,
        .head = 60,
        .interval = 0.085,
        .auto = true,
        .mag = 30,
        .reserve = 120,
        .reload = 2.1,
        .spread = 0.005,
        .move_spread = 0.016,
        .bloom = 0.024,
        .heat = 0.1,
        .kick = 0.009,
        .shove = 0.8,
        .speed = 0.96,
        .draw = 0.4,
    },
    .{ // bullpup
        .label = "BULLPUP",
        .blurb = "3-round burst, very accurate",
        .slot = .primary,
        .body = 28,
        .head = 72,
        .interval = 0.36,
        .burst = 3,
        .burst_gap = 0.06,
        .mag = 30,
        .reserve = 90,
        .reload = 2.5,
        .spread = 0.003,
        .move_spread = 0.014,
        .bloom = 0.012,
        .heat = 0.06,
        .kick = 0.008,
        .shove = 0.8,
        .speed = 0.94,
        .draw = 0.45,
    },
    .{ // smg
        .label = "SMG",
        .blurb = "fastest fire and feet, close range",
        .slot = .primary,
        .body = 18,
        .head = 40,
        .interval = 0.065,
        .auto = true,
        .mag = 35,
        .reserve = 140,
        .reload = 1.8,
        .spread = 0.012,
        .move_spread = 0.008,
        .bloom = 0.04,
        .heat = 0.08,
        .kick = 0.006,
        .shove = 0.6,
        .speed = 1.04,
        .draw = 0.3,
        .hip = v3(0.14, -0.17, -0.36),
    },
    .{ // shotgun
        .label = "SHOTGUN",
        .blurb = "9 pellets, one shot up close",
        .slot = .primary,
        .body = 13,
        .head = 16,
        .pellets = 9,
        .interval = 0.85,
        .mag = 6,
        .reserve = 24,
        .reload = 2.6,
        .spread = 0.06,
        .move_spread = 0.01,
        .ads_tight = 0.3,
        .kick = 0.045,
        .shove = 1.8,
        .range = 35,
        .speed = 0.95,
        .draw = 0.45,
    },
    .{ // sawn_off
        .label = "SAWN-OFF",
        .blurb = "2 barrels, wide spread, very close range",
        .slot = .primary,
        .body = 11,
        .head = 13,
        .pellets = 10,
        .interval = 0.25,
        .mag = 2,
        .reserve = 20,
        .reload = 2.0,
        .spread = 0.095,
        .move_spread = 0.01,
        .ads_tight = 0.3,
        .kick = 0.06,
        .shove = 2,
        .range = 22,
        .speed = 1.0,
        .draw = 0.35,
        .hip = v3(0.14, -0.18, -0.36),
    },
    .{ // pistol
        .label = "PISTOL",
        .blurb = "quick to draw, accurate",
        .slot = .secondary,
        .body = 26,
        .head = 65,
        .interval = 0.14,
        .mag = 12,
        .reserve = 48,
        .reload = 1.4,
        .spread = 0.005,
        .move_spread = 0.012,
        .bloom = 0.02,
        .heat = 0.15,
        .kick = 0.016,
        .speed = 1.06,
        .draw = 0.25,
        .hip = v3(0.13, -0.15, -0.4),
        .ads_z = -0.42,
    },
    .{ // revolver
        .label = "REVOLVER",
        .blurb = "2 body hits, 1 head hit",
        .slot = .secondary,
        .body = 52,
        .head = 104,
        .interval = 0.48,
        .mag = 6,
        .reserve = 30,
        .reload = 2.4,
        .spread = 0.003,
        .move_spread = 0.016,
        .bloom = 0.03,
        .heat = 0.6,
        .kick = 0.05,
        .shove = 1.6,
        .speed = 1.04,
        .draw = 0.35,
        .hip = v3(0.13, -0.15, -0.4),
        .ads_z = -0.42,
    },
    .{ // knife
        .label = "KNIFE",
        .blurb = "2 hits, short reach, fastest feet",
        .slot = .knife,
        .body = 55,
        .head = 55,
        .interval = 0.45,
        .auto = true,
        .range = 1.6,
        .speed = 1.1,
        .draw = 0.2,
        .hip = v3(0.2, -0.22, -0.38),
        .sights = false,
    },
    .{ // grenade
        .label = "GRENADE",
        .blurb = "impact, 5 m blast",
        .slot = .grenade,
        .speed = 1.0,
        .draw = 0.5,
        .hip = v3(0.16, -0.17, -0.42),
        .sights = false,
    },
};

pub fn stats(c: Class) *const Stats {
    return &table[@backingInt(c)];
}

/// The class of a network class id, or null.
pub fn classFromId(id: u32) ?Class {
    if (id >= class_count) return null;
    return @fromBackingInt(@intCast(id));
}

// ---- Models ----------------------------------------------------------------

pub const Model = struct {
    /// The source name ("AssaultRifle_1").
    name: []const u8,
    class: Class,
    /// The number in its class, from 1: "RIFLE 3".
    number: u8,
    /// The triangles. `mat` holds the part: 0 the body, 1 the magazine.
    verts: []mesh.Vertex,
    muzzle: V3,
    /// The y of the top of the sights.
    sight: f32,
    /// The magazine pivot: its top front corner.
    pivot: V3,
    has_mag: bool,
    min: V3,
    max: V3,
};

pub var models: []Model = &.{};
pub var knife_model: u8 = 0;

fn classOf(name: []const u8) ?Class {
    const prefixes = [_]struct { []const u8, Class }{
        .{ "AssaultRifle2_", .carbine },
        .{ "AssaultRifle_", .rifle },
        .{ "Bullpup_", .bullpup },
        .{ "SubmachineGun_", .smg },
        .{ "Shotgun_SawedOff", .sawn_off },
        .{ "Shotgun_", .shotgun },
        .{ "Pistol_", .pistol },
        .{ "Revolver_", .revolver },
        .{ "Bayonet", .knife },
    };
    for (prefixes) |p| if (std.mem.startsWith(u8, name, p[0])) return p[1];
    return null;
}

fn rd(comptime T: type, b: []const u8, at: usize) T {
    return std.mem.readInt(T, b[at..][0..@sizeOf(T)], .little);
}

fn rf(b: []const u8, at: usize) f32 {
    return @bitCast(rd(u32, b, at));
}

fn rv(b: []const u8, at: usize) V3 {
    return v3(rf(b, at), rf(b, at + 4), rf(b, at + 8));
}

/// Read guns.bin (the layout is in scripts/convert-gun.ts) and make the
/// triangles of each model.
pub fn loadModels(alloc: std.mem.Allocator) !void {
    const b: []const u8 = guns_bin;
    if (!std.mem.eql(u8, b[0..4], "GUN1")) return error.BadGunFile;
    const np = rd(u16, b, 4);
    const nm = rd(u16, b, 6);
    var at: usize = 8;
    const palette = try alloc.alloc(V3, np);
    defer alloc.free(palette);
    for (palette) |*c| {
        c.* = rv(b, at);
        at += 12;
    }
    const header_len = 20 + 8 + 2 + 28;
    const headers = at;
    at += nm * header_len;
    models = try alloc.alloc(Model, nm);
    var counts: [class_count]u8 = @splat(0);
    for (models, 0..) |*m, i| {
        const h = headers + i * header_len;
        const name = std.mem.sliceTo(b[h .. h + 20], 0);
        const nv = rd(u16, b, h + 20);
        const nf = rd(u16, b, h + 22);
        const nr = rd(u16, b, h + 24);
        const nt = rd(u16, b, h + 26);
        const class = classOf(name) orelse return error.BadGunFile;
        counts[@backingInt(class)] += 1;
        if (class == .knife) knife_model = @intCast(i);
        m.* = .{
            .name = name,
            .class = class,
            .number = counts[@backingInt(class)],
            .verts = try alloc.alloc(mesh.Vertex, @as(usize, nt) * 3),
            .muzzle = rv(b, h + 30),
            .sight = rf(b, h + 42),
            .pivot = rv(b, h + 46),
            .has_mag = b[h + 28] != 0,
            .min = vec.s(1e9),
            .max = vec.s(-1e9),
        };
        const pos = b[at .. at + @as(usize, nv) * 6];
        at += pos.len;
        const corner = struct {
            fn get(p: []const u8, k: u16) V3 {
                const o = @as(usize, k) * 6;
                return v3(
                    @as(f32, @floatFromInt(rd(i16, p, o))),
                    @as(f32, @floatFromInt(rd(i16, p, o + 2))),
                    @as(f32, @floatFromInt(rd(i16, p, o + 4))),
                ) / vec.s(8192);
            }
        }.get;
        // The faces come first, then the runs that give their materials.
        var runs = at;
        for (0..nf) |_| runs += 1 + 2 * @as(usize, b[runs]);
        var face = at;
        var out: usize = 0;
        for (0..nr) |r| {
            const count = rd(u16, b, runs + r * 4);
            const col = palette[b[runs + r * 4 + 2]];
            const part: f32 = @floatFromInt(b[runs + r * 4 + 3]);
            for (0..count) |_| {
                const n = b[face];
                const idx = b[face + 1 .. face + 1 + 2 * @as(usize, n)];
                face += 1 + 2 * @as(usize, n);
                const p0 = corner(pos, rd(u16, idx, 0));
                for (1..n - 1) |k| {
                    const p1 = corner(pos, rd(u16, idx, k * 2));
                    const p2 = corner(pos, rd(u16, idx, k * 2 + 2));
                    const nrm = vec.norm(vec.cross(p1 - p0, p2 - p0));
                    for ([3]V3{ p0, p1, p2 }) |p| {
                        m.verts[out] = .{
                            .pos = .{ p[0], p[1], p[2] },
                            .nrm = .{ nrm[0], nrm[1], nrm[2] },
                            .col = .{ col[0], col[1], col[2] },
                            .mat = part,
                        };
                        out += 1;
                        m.min = @min(m.min, p);
                        m.max = @max(m.max, p);
                    }
                }
            }
        }
        if (face != runs or out != m.verts.len) return error.BadGunFile;
        at = runs + @as(usize, nr) * 4;
    }
    if (at != b.len) return error.BadGunFile;
}

/// The first model of a class (the default of the class).
pub fn firstOf(c: Class) u8 {
    for (models, 0..) |m, i| if (m.class == c) return @intCast(i);
    return 0;
}

/// The model with this source name, or null.
pub fn byName(name: []const u8) ?u8 {
    for (models, 0..) |m, i| if (std.mem.eql(u8, m.name, name)) return @intCast(i);
    return null;
}

/// The name of a model on the HUD and in the menu: "RIFLE 3".
pub fn label(buf: []u8, model: u8) []const u8 {
    const m = models[model];
    const st = stats(m.class);
    if (m.class == .knife) return st.label;
    return std.fmt.bufPrint(buf, "{s} {d}", .{ st.label, m.number }) catch st.label;
}

/// Add a model to a mesh. `m` is the world matrix of the grip, `mag` the
/// magazine offset (relative to the gun). `mat` is the material id (100
/// for the view-model).
pub fn addModel(out: *mesh.Mesh, model: u8, m: Mat4, mag: Mat4, mat: f32) void {
    const src = models[model].verts;
    out.model(src, m, 0, mat);
    out.model(src, m.mul(mag), 1, mat);
}

// ---- Items and the loadout -------------------------------------------------

/// A weapon as a thing: what it is and the rounds in it. A grenade item
/// holds the count of grenades in `ammo`.
pub const Item = struct {
    class: Class,
    model: u8 = 0,
    ammo: u32 = 0,
    reserve: u32 = 0,

    /// A new gun of this model: a full magazine and the reserve of its
    /// class. `infinite` gives a reserve without end (practice).
    pub fn full(model: u8, infinite: bool) Item {
        const c = models[model].class;
        const st = stats(c);
        return .{ .class = c, .model = model, .ammo = st.mag, .reserve = if (infinite) 9999 else st.reserve };
    }
};

/// The primary and the secondary weapon that the player picked (model ids).
pub const Choice = struct {
    primary: u8,
    secondary: u8,

    pub fn default() Choice {
        return .{ .primary = firstOf(.rifle), .secondary = firstOf(.pistol) };
    }

    /// True when each model exists and is in the right slot.
    pub fn valid(c: Choice) bool {
        if (c.primary >= models.len or c.secondary >= models.len) return false;
        return stats(models[c.primary].class).slot == .primary and stats(models[c.secondary].class).slot == .secondary;
    }

    pub fn eql(a: Choice, b: Choice) bool {
        return a.primary == b.primary and a.secondary == b.secondary;
    }
};

pub const Loadout = struct {
    /// The primary, the secondary, the knife and the grenades. A slot can be
    /// empty.
    slots: [4]?Item = @splat(null),
    current: Slot = .primary,
    /// The slot before the current one. The grenade slot goes back to it.
    last: Slot = .primary,
    hands: Hands = .{},

    /// Fill the slots for a new life. The primary is in the hands, ready.
    pub fn equip(self: *Loadout, c: Choice, nades: u32, infinite: bool) void {
        self.* = .{};
        self.slots[0] = Item.full(c.primary, infinite);
        self.slots[1] = Item.full(c.secondary, infinite);
        self.slots[2] = .{ .class = .knife, .model = knife_model };
        self.slots[3] = .{ .class = .grenade, .ammo = nades };
    }

    /// Put new primary and secondary weapons in their slots (a change of
    /// the choice at the spawn point). The held slot stays.
    pub fn rearm(self: *Loadout, c: Choice, infinite: bool) void {
        self.slots[0] = Item.full(c.primary, infinite);
        self.slots[1] = Item.full(c.secondary, infinite);
        if (self.current == .primary or self.current == .secondary) {
            self.hands.takeOut(self.heldStats().draw);
        }
    }

    pub fn held(self: *Loadout) ?*Item {
        if (self.slots[@backingInt(self.current)]) |*it| return it;
        return null;
    }

    pub fn heldClass(self: *const Loadout) Class {
        if (self.slots[@backingInt(self.current)]) |it| return it.class;
        return .knife;
    }

    pub fn heldModel(self: *const Loadout) u8 {
        if (self.slots[@backingInt(self.current)]) |it| return it.model;
        return knife_model;
    }

    pub fn heldStats(self: *const Loadout) *const Stats {
        return stats(self.heldClass());
    }

    pub fn item(self: *Loadout, slot: Slot) ?*Item {
        if (self.slots[@backingInt(slot)]) |*it| return it;
        return null;
    }

    /// The grenades left.
    pub fn grenades(self: *const Loadout) u32 {
        return if (self.slots[3]) |it| it.ammo else 0;
    }

    /// Take out the weapon of a slot. False when the slot is empty, holds
    /// no grenade, or is held already.
    pub fn select(self: *Loadout, slot: Slot) bool {
        if (slot == self.current) return false;
        const it = self.slots[@backingInt(slot)] orelse return false;
        if (it.class == .grenade and it.ammo == 0) return false;
        self.last = self.current;
        self.current = slot;
        self.hands.takeOut(stats(it.class).draw);
        return true;
    }
};

// ---- The hands -------------------------------------------------------------

pub const Event = enum { none, fired, empty, mag_out, mag_in, racked, swung, ready };

/// The reload animation is made for 2.1 s. A class with another reload
/// time plays it faster or slower.
const anim_reload: f32 = 2.1;
/// The knife swing animation time.
pub const swing_time: f32 = 0.32;
/// The sight height of the first rifle above its grip. The hip pose of each
/// gun moves it to this height.
const sight_ref: f32 = 0.085;

/// The state of the held weapon in the hands: timers, the recoil, the
/// heat, the sights, the reload and the switch.
pub const Hands = struct {
    cooldown: f32 = 0,
    recoil: f32 = 0, // the kick of the view-model, 0..1
    heat: f32 = 0, // grows while the trigger is held, makes the cone wider
    ads: f32 = 0, // 0 hip, 1 aim down the sights
    flash: f32 = 0, // the muzzle flash time left
    sway_t: f32 = 0,
    flash_roll: f32 = 0,
    reloading: f32 = -1, // seconds into the reload, or -1
    /// The time left to take out the held weapon, and the full time.
    drawing: f32 = 0,
    draw_len: f32 = 1,
    /// Rounds left in the burst.
    burst_left: u32 = 0,
    /// A click that came near the end of the cooldown fires at its end.
    queued: bool = false,
    /// Seconds into the knife swing, or -1.
    swing: f32 = -1,

    /// Start to take out a weapon. A reload stops.
    pub fn takeOut(self: *Hands, t: f32) void {
        self.drawing = t;
        self.draw_len = @max(t, 0.01);
        self.reloading = -1;
        self.burst_left = 0;
        self.queued = false;
        self.swing = -1;
        self.heat = 0;
        self.cooldown = 0;
    }

    /// True when the held weapon is out and not busy.
    pub fn ready(self: *const Hands) bool {
        return self.drawing <= 0 and self.reloading < 0;
    }

    pub fn canReload(self: *const Hands, it: *const Item) bool {
        const st = stats(it.class);
        return st.mag > 0 and self.reloading < 0 and self.drawing <= 0 and it.ammo < st.mag and it.reserve > 0;
    }

    pub fn startReload(self: *Hands, it: *const Item) bool {
        if (!self.canReload(it)) return false;
        self.reloading = 0;
        self.burst_left = 0;
        return true;
    }

    fn shoot(self: *Hands, it: *Item, st: *const Stats) void {
        it.ammo -= 1;
        self.recoil = 1;
        self.heat = @min(1, self.heat + st.heat);
        self.flash = 0.05;
        self.flash_roll += 2.1;
    }

    /// Advance one step with the held item. Returns the event of this step
    /// for the sound and the shot.
    pub fn update(self: *Hands, it: *Item, dt: f32, trigger: bool, pressed: bool, aim: bool) Event {
        const st = stats(it.class);
        self.cooldown = @max(0, self.cooldown - dt);
        self.recoil = @max(0, self.recoil - dt * 7);
        self.flash = @max(0, self.flash - dt);
        self.heat = if (trigger) @min(1, self.heat) else @max(0, self.heat - dt * 3);
        const want_ads: f32 = if (aim and st.sights and self.ready()) 1 else 0;
        self.ads += (want_ads - self.ads) * @min(1, dt * 14);
        self.sway_t += dt;
        if (self.swing >= 0) {
            self.swing += dt;
            if (self.swing > swing_time) self.swing = -1;
        }

        if (self.drawing > 0) {
            self.drawing -= dt;
            if (self.drawing <= 0) {
                self.drawing = 0;
                return .ready;
            }
            return .none;
        }

        if (it.class == .grenade) return .none;
        if (it.class == .knife) {
            if (trigger and self.cooldown <= 0) {
                self.cooldown = st.interval;
                self.swing = 0;
                return .swung;
            }
            return .none;
        }

        if (self.reloading >= 0) {
            const k = anim_reload / st.reload;
            const before = self.reloading * k;
            self.reloading += dt;
            const t = self.reloading * k;
            if (before < 0.45 and t >= 0.45) return .mag_out;
            if (before < 1.25 and t >= 1.25) return .mag_in;
            if (self.reloading >= st.reload) {
                const take = @min(st.mag - it.ammo, it.reserve);
                it.ammo += take;
                it.reserve -= take;
                self.reloading = -1;
                return .racked;
            }
            return .none;
        }

        // The rest of a burst.
        if (self.burst_left > 0) {
            if (self.cooldown > 0) return .none;
            if (it.ammo == 0) {
                self.burst_left = 0;
                return .none;
            }
            self.burst_left -= 1;
            self.cooldown = if (self.burst_left > 0) st.burst_gap else st.interval - st.burst_gap * @as(f32, @floatFromInt(st.burst - 1));
            self.shoot(it, st);
            return .fired;
        }

        // A click in the last 0.15 s of the cooldown waits for its end.
        if (pressed and !st.auto and self.cooldown > 0 and self.cooldown < 0.15) self.queued = true;
        const pull = if (st.auto) trigger else (pressed or (self.queued and self.cooldown <= 0));
        if (pull and self.cooldown <= 0) {
            self.queued = false;
            if (it.ammo == 0) {
                if (pressed) return .empty;
                return .none;
            }
            if (st.burst > 1) {
                self.burst_left = st.burst - 1;
                self.cooldown = st.burst_gap;
            } else {
                self.cooldown = st.interval;
            }
            self.shoot(it, st);
            return .fired;
        }
        return .none;
    }

    /// The cone half angle of the next shot, in radians.
    pub fn spread(self: *const Hands, c: Class, moving: f32, airborne: bool) f32 {
        const st = stats(c);
        var a: f32 = st.spread + self.heat * st.bloom + moving * st.move_spread;
        if (airborne) a += 0.05;
        return a * (1 - st.ads_tight * self.ads);
    }

    /// The view-model pose in camera space: the matrix of the grip, the
    /// magazine offset (relative to the gun), and the muzzle (in gun
    /// space).
    pub fn pose(self: *const Hands, it: Item, bob: f32, speed: f32) struct { gun: Mat4, mag: Mat4, muzzle: V3 } {
        const st = stats(it.class);
        const mdl = models[it.model];
        // Each gun at the hip has the top of its sights at one height, so a
        // low shotgun and a tall bullpup sit alike.
        const hip = if (st.mag > 0) st.hip + v3(0, sight_ref - mdl.sight, 0) else st.hip;
        // The eye goes 4 mm over the top of the sights.
        const ads_pos = v3(0.0, -(mdl.sight + 0.004), st.ads_z);
        var pos = vec.lerp(hip, ads_pos, self.ads);
        var pitch: f32 = 0;
        var roll: f32 = 0;
        var yaw: f32 = 0;

        // Walk bob and idle sway, smaller when aiming.
        const sway = (1 - 0.8 * self.ads);
        pos += v3(@sin(bob) * 0.012 * speed, -@abs(@cos(bob)) * 0.01 * speed, 0) * vec.s(sway);
        pos += v3(@sin(self.sway_t * 0.9) * 0.002, @sin(self.sway_t * 1.7) * 0.002, 0) * vec.s(sway);

        // Recoil: back and up.
        const r = self.recoil * self.recoil * st.shove;
        pos[2] += r * 0.05;
        pitch += r * 0.06;

        if (it.class == .knife) {
            // The blade points forward, up and in.
            pitch += 0.35;
            yaw += 0.3;
            roll -= 0.35;
            if (self.swing >= 0) {
                // A slash from the upper right to the lower left.
                const t = self.swing / swing_time;
                const p = vec.smooth(t * 1.4);
                const lift = @sin(std.math.pi * vec.clamp01(t));
                pos += v3(0.06 - 0.26 * p, 0.05 - 0.13 * p, -0.16 * lift);
                yaw += 0.9 * p - 0.2;
                pitch -= 0.5 * p;
                roll -= 0.6 * lift;
            }
        }

        var mag = Mat4.identity();
        if (self.reloading >= 0 and st.mag > 0) {
            const t = self.reloading * anim_reload / st.reload;
            // Tilt in, hold, tilt out.
            const tilt = vec.smooth(t / 0.3) * (1 - vec.smooth((t - 1.7) / 0.35));
            // Lift the gun to the centre and cant its top away, so the
            // underside and the magazine well turn toward the camera.
            roll -= tilt * 0.75;
            pitch += tilt * 0.12;
            yaw += tilt * 0.1;
            pos += v3(-0.08, 0.1, 0.06) * vec.s(tilt);
            if (mdl.has_mag) {
                // The magazine: out (0.3..0.65), away, in (0.95..1.3), then
                // a small seat bump.
                var drop: f32 = 0;
                var turn: f32 = 0;
                if (t < 0.95) {
                    const k = vec.smooth((t - 0.3) / 0.35);
                    drop = k * 0.35;
                    turn = k * 0.4;
                } else {
                    const k = 1 - vec.smooth((t - 0.95) / 0.35);
                    drop = k * 0.3;
                    turn = k * 0.25;
                }
                // The magazine pivots at its top front corner.
                const pivot = mdl.pivot;
                mag = vec.translate(pivot + v3(0, -drop, drop * 0.25)).mul(Mat4.rotationX(-turn).mul(vec.translate(-pivot)));
            }
            // The rack at the end pulls the gun back a little.
            const rack = vec.smooth((t - 1.55) / 0.08) * (1 - vec.smooth((t - 1.68) / 0.12));
            pos[2] += rack * 0.025;
            if (t > 1.27 and t < 1.37) pos[1] += 0.008;
        }

        // The switch: the weapon comes up from below.
        if (self.drawing > 0) {
            const k = vec.smooth(self.drawing / self.draw_len);
            pos[1] -= 0.25 * k;
            pos[2] += 0.05 * k;
            pitch -= 0.8 * k;
        }

        const gun = vec.ypr(pos, yaw, pitch, roll);
        return .{ .gun = gun, .mag = mag, .muzzle = mdl.muzzle };
    }
};
