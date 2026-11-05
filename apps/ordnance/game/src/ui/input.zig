//! The input of one tick: the keys and the mouse become window actions,
//! camera moves, interface changes and game commands. It holds the state
//! of the interface (`State`). main.zig owns one State and calls `tick`.
//!
//! The keys:
//!   L logistics, K kill, I intel, Esc view, H heightmap, Ctrl+D debug
//!   Hold V: the sightlines from the square under the pointer
//!   Tab, Shift+Tab: the next window. Tap Alt (or Alt+letter): the menus
//!   Space pause, - and + speed. Drag: move the map. Wheel: zoom (Ctrl:
//!   faster). WASD or the arrows: pan.
//!   Logistics: 1 track, 2 road, 3 drone net. Click: one square.
//!     Shift+drag: a line. Right click cancels a job.
//!   Kill: click a square to pick its sector, then 1 push, 2 hold,
//!     3 fall back, 4 the sector objective here, 5 clear it.
const std = @import("std");
const map = @import("../core/map.zig");
const sim = @import("../core/sim.zig");
const view = @import("../render/view.zig");
const wm_mod = @import("wm.zig");

/// The input that a tick reads. main.zig fills it from the engine, so
/// this file does not import the engine.
pub const Keys = struct {
    mx: f32,
    my: f32,
    left_down: bool,
    left_pressed: bool,
    left_released: bool,
    right_pressed: bool,
    wheel_y: f32,
    ctrl: bool,
    shift: bool,
    alt: bool,
    alt_pressed: bool,
    alt_released: bool,
    /// The first letter key pressed this tick, 'A' to 'Z'.
    letter: ?u8,
    /// Keys pressed this tick.
    pressed: struct {
        escape: bool = false,
        space: bool = false,
        minus: bool = false,
        equal: bool = false,
        tab: bool = false,
        enter: bool = false,
        up: bool = false,
        down: bool = false,
        left: bool = false,
        right: bool = false,
        digit: ?u8 = null,
    },
    /// Keys held down.
    held: struct {
        w: bool = false,
        a: bool = false,
        s: bool = false,
        d: bool = false,
        v: bool = false,
        up: bool = false,
        down: bool = false,
        left: bool = false,
        right: bool = false,
    },
};

/// The state of a press of the left button on the map.
const MapDrag = struct {
    active: bool = false,
    sx: f32 = 0,
    sy: f32 = 0,
    lx: f32 = 0,
    ly: f32 = 0,
    panning: bool = false,
    painting: bool = false,
    last_paint: ?u16 = null,
};

pub const State = struct {
    ui: view.Ui = .{},
    cam: view.Camera = .{ .s = 20, .ox = 0, .oy = 0 },
    wm: wm_mod.Wm = wm_mod.Wm.init(),
    fitted: bool = false,
    drag: MapDrag = .{},
    /// "Layout per mode": the saved windows of each mode.
    layouts: [4]?wm_mod.Layout = @splat(null),
    alt_clean: bool = false,
    /// Hold V: the viewshed from the square under the pointer.
    sight_from: ?u16 = null,
    sight: [map.cells]bool = @splat(false),

    /// Change the mode. With "Layout per mode" on, the windows of the old
    /// mode go away and the windows of the new mode come back.
    pub fn setMode(st: *State, m: view.Mode) void {
        if (m == st.ui.mode) return;
        if (st.ui.layout_per_mode) {
            const area = st.wm.area;
            const bar = st.wm.bar_h;
            st.layouts[@backingInt(st.ui.mode)] = st.wm.save();
            if (st.layouts[@backingInt(m)]) |l| st.wm.load(l) else st.wm = wm_mod.Wm.initFor(m);
            st.wm.area = area;
            st.wm.bar_h = bar;
        }
        st.ui.mode = m;
    }

    fn doAction(st: *State, a: wm_mod.Action) void {
        switch (a) {
            .none => {},
            .pause => st.ui.paused = !st.ui.paused,
            .speed => |s| st.ui.speed = s,
            .mode => |m| st.setMode(m),
            .toggle => |p| st.wm.toggle(p),
            .heightmap => st.ui.heightmap = !st.ui.heightmap,
            .debug => st.ui.debug = !st.ui.debug,
            .layout_per_mode => {
                st.ui.layout_per_mode = !st.ui.layout_per_mode;
                st.layouts = @splat(null);
            },
        }
    }

    /// Read one tick of input. `p` is the painter (for text widths).
    pub fn tick(st: *State, p: anytype, game: *sim.Sim, k: Keys, w: f32, h: f32) void {
        if (!st.fitted) {
            // Start near the depot, at a scale that shows the terrain.
            const d = map.centre(game.setup.depot);
            st.cam = view.Camera.at(d[0], d[1] - 14, 22, w, h);
            st.fitted = true;
        }
        st.wm.area = .{ .x = 0, .y = view.top_bar, .w = w, .h = h - view.top_bar - view.bottom_bar };
        st.wm.bar_h = view.top_bar;

        // A tap of Alt: down and up with no other key between.
        if (k.alt_pressed) st.alt_clean = true;
        if (k.letter != null or k.pressed.tab or k.left_pressed) st.alt_clean = false;
        const alt_tap = st.alt_clean and k.alt_released;
        if (alt_tap) st.alt_clean = false;

        const u = st.wm.update(p, .{
            .mx = k.mx,
            .my = k.my,
            .down = k.left_down,
            .pressed = k.left_pressed and !st.drag.active,
            .released = k.left_released,
            .alt = k.alt,
            .alt_tap = alt_tap,
            .shift = k.shift,
            .letter = k.letter,
            .up = k.pressed.up,
            .down_key = k.pressed.down,
            .left = k.pressed.left,
            .right = k.pressed.right,
            .enter = k.pressed.enter,
            .escape = k.pressed.escape,
            .tab = k.pressed.tab and !k.ctrl and !k.alt,
        });
        st.doAction(u.action);
        // A press on the minimap moves the view there.
        if (u.click) |cl| if (cl.panel == .minimap) {
            const side: f32 = map.size;
            st.cam = view.Camera.at(cl.u * side, cl.v * side, st.cam.s, w, h);
        };

        if (k.ctrl and k.letter == 'D') st.ui.debug = !st.ui.debug;
        if (!u.keys and !k.ctrl and !k.alt) st.keys(game, k);

        // The wheel zooms about the pointer. Down zooms out. Ctrl makes
        // each step bigger.
        if (!u.mouse and k.wheel_y != 0) {
            const base: f32 = if (k.ctrl) 1.15 else 1.04;
            st.cam.zoom(std.math.pow(f32, base, k.wheel_y), k.mx, k.my);
        }

        const on_map = !u.mouse and k.my > view.top_bar and k.my < h - view.bottom_bar;
        st.ui.hover = if (on_map or st.drag.active) st.cam.cellAt(k.mx, k.my) else null;
        st.mouse(game, k, on_map);

        // Hold V: the sightlines. The viewshed is new only when the square
        // changes.
        const want: ?u16 = if (k.held.v and !k.ctrl and !k.alt and !u.keys) st.ui.hover else null;
        if (want != st.sight_from) {
            st.sight_from = want;
            if (want) |c| {
                const cc = map.centre(c);
                game.m.viewshed(cc[0], cc[1], 2, view.sight_range, &st.sight);
            }
        }
        st.ui.sight = st.sight_from;
    }

    fn keys(st: *State, game: *sim.Sim, k: Keys) void {
        const ui = &st.ui;
        if (k.letter) |l| switch (l) {
            'L' => st.setMode(if (ui.mode == .logistics) .view else .logistics),
            'K' => st.setMode(if (ui.mode == .kill) .view else .kill),
            'I' => st.setMode(if (ui.mode == .intel) .view else .intel),
            'H' => ui.heightmap = !ui.heightmap,
            else => {},
        };
        if (k.pressed.escape) st.setMode(.view);
        if (k.pressed.space) ui.paused = !ui.paused;
        if (k.pressed.minus) ui.speed = if (ui.speed == 4) 2 else 1;
        if (k.pressed.equal) ui.speed = if (ui.speed == 1) 2 else 4;
        const pan: f32 = 12;
        if (k.held.w or k.held.up) st.cam.oy += pan;
        if (k.held.s or k.held.down) st.cam.oy -= pan;
        if (k.held.a or k.held.left) st.cam.ox += pan;
        if (k.held.d or k.held.right) st.cam.ox -= pan;
        const digit = k.pressed.digit orelse return;
        switch (ui.mode) {
            .logistics => switch (digit) {
                1 => ui.tool = .track,
                2 => ui.tool = .road,
                3 => ui.tool = .net,
                else => {},
            },
            .kill => switch (digit) {
                1 => game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .push } }),
                2 => game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .hold } }),
                3 => game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .back } }),
                4 => if (ui.hover) |c| {
                    ui.sector = sim.Sim.sectorOf(@floatFromInt(map.cellX(c)));
                    game.apply(.{ .goal = .{ .sector = ui.sector, .cell = c } });
                    game.apply(.{ .posture = .{ .sector = ui.sector, .posture = .push } });
                },
                5 => game.apply(.{ .goal = .{ .sector = ui.sector, .cell = null } }),
                else => {},
            },
            else => {},
        }
    }

    /// The left button on the map: a drag moves the map. A click builds (in
    /// logistics) or picks a sector (in kill). Shift+drag in logistics
    /// lays a line.
    fn mouse(st: *State, game: *sim.Sim, k: Keys, on_map: bool) void {
        const ui = &st.ui;
        const d = &st.drag;
        if (on_map and k.left_pressed) {
            d.* = .{ .active = true, .sx = k.mx, .sy = k.my, .lx = k.mx, .ly = k.my };
            d.painting = ui.mode == .logistics and k.shift;
        }
        if (d.active) {
            if (d.painting) {
                if (ui.hover) |c| if (d.last_paint != c) {
                    game.apply(.{ .build = .{ .cell = c, .kind = ui.tool } });
                    d.last_paint = c;
                };
            } else {
                if (!d.panning and @abs(k.mx - d.sx) + @abs(k.my - d.sy) > 4) d.panning = true;
                if (d.panning) {
                    st.cam.ox += k.mx - d.lx;
                    st.cam.oy += k.my - d.ly;
                }
            }
            d.lx = k.mx;
            d.ly = k.my;
            if (!k.left_down) {
                if (!d.panning and !d.painting) if (ui.hover) |c| switch (ui.mode) {
                    .logistics => game.apply(.{ .build = .{ .cell = c, .kind = ui.tool } }),
                    .kill => ui.sector = sim.Sim.sectorOf(@floatFromInt(map.cellX(c))),
                    else => {},
                };
                d.* = .{};
            }
        }
        if (on_map and ui.mode == .logistics and k.right_pressed) {
            if (ui.hover) |c| game.apply(.{ .cancel = .{ .cell = c } });
        }
    }
};
