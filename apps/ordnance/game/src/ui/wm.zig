//! The window manager: windows with tabs, snapping, focus and the menu bar.
//!
//! Windows:
//! - A window has 1 to 4 tabs. Each tab shows one panel.
//! - Drag a title bar to move the window. Drop it near a corner or a side of
//!   the map area to snap it there. Windows in the same zone tile: a stack
//!   in a corner or on the left and right, a row on the top and bottom.
//!   Drop it on the title bar of another window to join the two.
//! - Drag a tab to take it out: a translucent copy follows the pointer.
//!   Drop it on a title bar to join that window. Drop it anywhere else to
//!   make a new window (snapped, when near an edge).
//! - The title bar has a snap button (a 3 x 3 picker of the zones) and a
//!   minimise button (only the title bar stays).
//! - A press in the content of a window reports a click (`Update.click`),
//!   for example on the map panel.
//! - Tab moves the focus to the next window, like Alt+Tab. Shift+Tab goes
//!   back. The focused window comes to the top, and a minimised one opens.
//!
//! The menu bar: Game, Mode, View, Window. Each title and item has an
//! underlined hot letter. Alt+letter opens a menu, or tap Alt and then
//! press the letter. In an open menu, the letter of an item does it: Alt,
//! V, K opens the Keys window. Up, Down, Left, Right, Enter and Escape work
//! too.
//!
//! Layouts: `save` and `load` copy the windows. main.zig uses them for the
//! setting "Layout per mode": each mode then keeps its own windows.
//!
//! It draws through the painter of view.zig. It does not know the game.
//! `update` returns an Action, and main.zig does it.
const std = @import("std");
const ui_types = @import("../style.zig");

const Color = ui_types.Color;
const Mode = ui_types.Mode;

pub const Panel = enum(u8) { forces, supply, square, keys, minimap };

pub fn panelTitle(p: Panel) []const u8 {
    return switch (p) {
        .forces => "Forces",
        .supply => "Supply",
        .square => "Square",
        .keys => "Keys",
        .minimap => "Map",
    };
}

/// The size of the content of a panel, in pixels.
pub fn panelSize(p: Panel) [2]f32 {
    return switch (p) {
        .forces => .{ 240, 132 },
        .supply => .{ 240, 112 },
        .square => .{ 260, 96 },
        .keys => .{ 330, 208 },
        .minimap => .{ 240, 240 },
    };
}

pub const Zone = enum(u8) { free, tl, top, tr, left, right, bl, bottom, br };

pub const Rect = struct {
    x: f32 = 0,
    y: f32 = 0,
    w: f32 = 0,
    h: f32 = 0,
    pub fn has(r: Rect, x: f32, y: f32) bool {
        return x >= r.x and y >= r.y and x < r.x + r.w and y < r.y + r.h;
    }
};

pub const max_wins = 8;
pub const max_tabs = 4;
pub const title_h = 28;
const button_w = 24;
const tab_pad = 12;
const tab_size = 15;
const gap = 6;
const margin = 8;
const snap_corner = 90;
const snap_side = 50;
const drag_start = 5;

pub const Win = struct {
    used: bool = false,
    tabs: [max_tabs]Panel = @splat(.forces),
    n: u8 = 0,
    active: u8 = 0,
    /// The position of a free window (zone free).
    x: f32 = 0,
    y: f32 = 0,
    zone: Zone = .free,
    min: bool = false,
    /// The rectangle on the screen, from `layout`.
    rect: Rect = .{},

    pub fn activePanel(w: *const Win) Panel {
        return w.tabs[w.active];
    }

    fn size(w: *const Win, p: anytype) [2]f32 {
        var width: f32 = 2 * button_w + 16;
        var content_w: f32 = 0;
        for (w.tabs[0..w.n]) |t| {
            width += tabWidth(p, t);
            content_w = @max(content_w, panelSize(t)[0]);
        }
        const h: f32 = if (w.min) title_h else title_h + panelSize(w.activePanel())[1];
        return .{ @max(width, content_w), h };
    }

    fn remove(w: *Win, i: u8) Panel {
        const p = w.tabs[i];
        var k = i;
        while (k + 1 < w.n) : (k += 1) w.tabs[k] = w.tabs[k + 1];
        w.n -= 1;
        if (w.active >= w.n and w.n > 0) w.active = w.n - 1;
        if (w.n == 0) w.used = false;
        return p;
    }
};

fn tabWidth(p: anytype, t: Panel) f32 {
    return p.measure(panelTitle(t), tab_size) + 2 * tab_pad;
}

pub const Input = struct {
    mx: f32 = 0,
    my: f32 = 0,
    down: bool = false,
    pressed: bool = false,
    released: bool = false,
    alt: bool = false,
    /// Alt went down and up with no other key between.
    alt_tap: bool = false,
    shift: bool = false,
    /// A letter key pressed in this tick, 'A' to 'Z'.
    letter: ?u8 = null,
    up: bool = false,
    down_key: bool = false,
    left: bool = false,
    right: bool = false,
    enter: bool = false,
    escape: bool = false,
    tab: bool = false,
};

pub const Action = union(enum) {
    none,
    pause,
    speed: u8,
    mode: Mode,
    toggle: Panel,
    heightmap,
    debug,
    layout_per_mode,
};

/// The state that the menus show as checks.
pub const State = struct {
    paused: bool = false,
    speed: u8 = 1,
    mode: Mode = .view,
    heightmap: bool = false,
    debug: bool = false,
    layout_per_mode: bool = false,
};

pub const Menu = enum(u8) { game, mode, view, window };
const menu_titles = [_][]const u8{ "Game", "Mode", "View", "Window" };

/// A menu item. `hot` is the index of the underlined letter in the label.
/// The window items (next, minimise, close, reset) work in the window
/// manager. The others go to main.zig.
const Item = struct { label: []const u8, hot: u8, key: []const u8, op: Op };
const Op = union(enum) { action: Action, next, minimise, close_tab, reset };

fn menuItems(m: Menu) []const Item {
    return switch (m) {
        .game => &.{
            .{ .label = "Pause", .hot = 0, .key = "Space", .op = .{ .action = .pause } },
            .{ .label = "Speed x1", .hot = 7, .key = "-", .op = .{ .action = .{ .speed = 1 } } },
            .{ .label = "Speed x2", .hot = 7, .key = "", .op = .{ .action = .{ .speed = 2 } } },
            .{ .label = "Speed x4", .hot = 7, .key = "+", .op = .{ .action = .{ .speed = 4 } } },
        },
        .mode => &.{
            .{ .label = "View", .hot = 0, .key = "Esc", .op = .{ .action = .{ .mode = .view } } },
            .{ .label = "Logistics", .hot = 0, .key = "L", .op = .{ .action = .{ .mode = .logistics } } },
            .{ .label = "Kill", .hot = 0, .key = "K", .op = .{ .action = .{ .mode = .kill } } },
            .{ .label = "Intel", .hot = 0, .key = "I", .op = .{ .action = .{ .mode = .intel } } },
        },
        .view => &.{
            .{ .label = "Forces", .hot = 0, .key = "", .op = .{ .action = .{ .toggle = .forces } } },
            .{ .label = "Supply", .hot = 0, .key = "", .op = .{ .action = .{ .toggle = .supply } } },
            .{ .label = "Square", .hot = 1, .key = "", .op = .{ .action = .{ .toggle = .square } } },
            .{ .label = "Keys", .hot = 0, .key = "", .op = .{ .action = .{ .toggle = .keys } } },
            .{ .label = "Map", .hot = 1, .key = "", .op = .{ .action = .{ .toggle = .minimap } } },
            .{ .label = "Heightmap", .hot = 0, .key = "H", .op = .{ .action = .heightmap } },
            .{ .label = "Debug", .hot = 0, .key = "Ctrl+D", .op = .{ .action = .debug } },
        },
        .window => &.{
            .{ .label = "Next window", .hot = 0, .key = "Tab", .op = .next },
            .{ .label = "Minimise", .hot = 0, .key = "", .op = .minimise },
            .{ .label = "Close tab", .hot = 0, .key = "", .op = .close_tab },
            .{ .label = "Reset layout", .hot = 0, .key = "", .op = .reset },
            .{ .label = "Layout per mode", .hot = 7, .key = "", .op = .{ .action = .layout_per_mode } },
        },
    };
}

fn hotLetter(label: []const u8, hot: u8) u8 {
    return std.ascii.toUpper(label[hot]);
}

const item_h = 28;
const menu_w = 220;

const Drag = union(enum) {
    none,
    /// The button went down on a title bar or a tab. No move yet.
    pending: struct { win: u8, tab: ?u8, sx: f32, sy: f32 },
    /// A whole window follows the pointer.
    window: struct { win: u8, offx: f32, offy: f32 },
    /// One tab follows the pointer as a translucent window.
    tab: struct { win: u8, tab: u8, offx: f32, offy: f32 },
    /// The button went down in the content of a window. While it is down,
    /// each tick reports a click there.
    content: u8,
};

pub const Update = struct {
    action: Action = .none,
    /// A press (or a drag) in the content of a panel: the panel, and the
    /// point as a part (0..1) of the content width and height.
    click: ?struct { panel: Panel, u: f32, v: f32 } = null,
    /// True when the window manager used the mouse: the map must ignore it.
    mouse: bool = false,
    /// True when it used the keys: the game must ignore them.
    keys: bool = false,
};

/// A copy of the windows, for the layouts of each mode.
pub const Layout = struct {
    wins: [max_wins]Win,
    order: [max_wins]u8,
};

pub const Wm = struct {
    wins: [max_wins]Win = @splat(.{}),
    /// The window indices from the bottom to the top.
    order: [max_wins]u8 = .{ 0, 1, 2, 3, 4, 5, 6, 7 },
    /// The window with the keyboard focus (Tab).
    focus: ?u8 = null,
    drag: Drag = .none,
    /// The window that shows its snap picker.
    picker: ?u8 = null,
    menu: ?Menu = null,
    menu_hl: u8 = 0,
    /// Alt was tapped: the next letter opens a menu.
    bar_focus: bool = false,
    mx: f32 = 0,
    my: f32 = 0,
    /// The map area: windows stay in it, and the zones are its edges.
    area: Rect = .{},
    bar_h: f32 = 34,

    /// The default windows.
    pub fn init() Wm {
        return initFor(.view);
    }

    /// The default windows of a mode.
    pub fn initFor(mode: Mode) Wm {
        var wm: Wm = .{};
        switch (mode) {
            .view => {
                _ = wm.open(.forces, .bl, 0, 0);
                const s = wm.open(.supply, .tl, 0, 0).?;
                wm.addTab(s, .keys);
                _ = wm.open(.minimap, .tr, 0, 0);
                _ = wm.open(.square, .br, 0, 0);
            },
            .logistics => {
                const s = wm.open(.supply, .tl, 0, 0).?;
                wm.addTab(s, .keys);
                _ = wm.open(.minimap, .tr, 0, 0);
                _ = wm.open(.square, .br, 0, 0);
            },
            .kill => {
                const f = wm.open(.forces, .bl, 0, 0).?;
                wm.addTab(f, .keys);
            },
            .intel => {
                _ = wm.open(.square, .br, 0, 0);
                _ = wm.open(.keys, .tl, 0, 0);
            },
        }
        wm.focus = null;
        return wm;
    }

    pub fn save(wm: *const Wm) Layout {
        return .{ .wins = wm.wins, .order = wm.order };
    }

    pub fn load(wm: *Wm, l: Layout) void {
        wm.wins = l.wins;
        wm.order = l.order;
        wm.focus = null;
        wm.drag = .none;
        wm.picker = null;
    }

    fn addTab(wm: *Wm, i: u8, p: Panel) void {
        const w = &wm.wins[i];
        if (w.n == max_tabs) return;
        w.tabs[w.n] = p;
        w.n += 1;
    }

    /// Make a window with one panel. Null when all windows are in use.
    pub fn open(wm: *Wm, p: Panel, zone: Zone, x: f32, y: f32) ?u8 {
        for (&wm.wins, 0..) |*w, i| {
            if (w.used) continue;
            w.* = .{ .used = true, .n = 1, .x = x, .y = y, .zone = zone };
            w.tabs[0] = p;
            wm.raise(@intCast(i));
            wm.focus = @intCast(i);
            return @intCast(i);
        }
        return null;
    }

    /// The window and the tab that show the panel, or null.
    pub fn find(wm: *const Wm, p: Panel) ?[2]u8 {
        for (wm.wins, 0..) |w, i| {
            if (!w.used) continue;
            for (w.tabs[0..w.n], 0..) |t, k| if (t == p) return .{ @intCast(i), @intCast(k) };
        }
        return null;
    }

    /// Open the panel in a new window, or close its tab. A panel in a
    /// minimised window, or behind another tab, comes to the front first.
    pub fn toggle(wm: *Wm, p: Panel) void {
        if (wm.find(p)) |f| {
            const w = &wm.wins[f[0]];
            if (w.min or w.active != f[1] or wm.focus != f[0]) {
                w.active = f[1];
                wm.focusOn(f[0]);
            } else {
                _ = w.remove(f[1]);
                if (!w.used) wm.focus = null;
            }
        } else {
            _ = wm.open(p, .free, wm.area.x + wm.area.w / 2 - 120, wm.area.y + wm.area.h / 3);
        }
    }

    fn raise(wm: *Wm, i: u8) void {
        var k: usize = 0;
        while (wm.order[k] != i) k += 1;
        while (k + 1 < max_wins) : (k += 1) wm.order[k] = wm.order[k + 1];
        wm.order[max_wins - 1] = i;
    }

    fn focusOn(wm: *Wm, i: u8) void {
        wm.focus = i;
        wm.wins[i].min = false;
        wm.raise(i);
    }

    /// Move the focus to the next window (or the one before, `back`).
    pub fn cycle(wm: *Wm, back: bool) void {
        var used: [max_wins]u8 = undefined;
        var n: usize = 0;
        for (wm.wins, 0..) |w, i| if (w.used) {
            used[n] = @intCast(i);
            n += 1;
        };
        if (n == 0) return;
        var at: usize = 0;
        if (wm.focus) |f| for (used[0..n], 0..) |u, k| if (u == f) {
            at = if (back) (k + n - 1) % n else (k + 1) % n;
        };
        wm.focusOn(used[at]);
    }

    /// Place each window: free ones where they are (kept in the area),
    /// snapped ones tiled in their zone.
    pub fn layout(wm: *Wm, p: anytype) void {
        const a = wm.area;
        for (&wm.wins, 0..) |*w, i| {
            if (!w.used) continue;
            const sz = w.size(p);
            w.rect.w = sz[0];
            w.rect.h = sz[1];
            if (w.zone == .free or wm.isDragged(@intCast(i))) {
                w.rect.x = std.math.clamp(w.x, a.x, @max(a.x, a.x + a.w - sz[0]));
                w.rect.y = std.math.clamp(w.y, a.y, @max(a.y, a.y + a.h - title_h));
            }
        }
        for (std.enums.values(Zone)) |z| {
            if (z == .free) continue;
            var total: f32 = 0;
            var n: u32 = 0;
            const row = z == .top or z == .bottom;
            for (wm.wins, 0..) |w, i| if (w.used and w.zone == z and !wm.isDragged(@intCast(i))) {
                total += (if (row) w.rect.w else w.rect.h) + gap;
                n += 1;
            };
            if (n == 0) continue;
            total -= gap;
            var at: f32 = switch (z) {
                .tl, .tr => a.y + margin,
                .bl, .br => a.y + a.h - margin,
                .left, .right => a.y + (a.h - total) / 2,
                .top, .bottom => a.x + (a.w - total) / 2,
                .free => unreachable,
            };
            for (&wm.wins, 0..) |*w, i| {
                if (!w.used or w.zone != z or wm.isDragged(@intCast(i))) continue;
                const r = &w.rect;
                switch (z) {
                    .tl, .left, .bl => r.x = a.x + margin,
                    .tr, .right, .br => r.x = a.x + a.w - margin - r.w,
                    .top => r.y = a.y + margin,
                    .bottom => r.y = a.y + a.h - margin - r.h,
                    .free => unreachable,
                }
                switch (z) {
                    .tl, .tr, .left, .right => {
                        r.y = at;
                        at += r.h + gap;
                    },
                    .bl, .br => {
                        at -= r.h;
                        r.y = at;
                        at -= gap;
                    },
                    .top, .bottom => {
                        r.x = at;
                        at += r.w + gap;
                    },
                    .free => unreachable,
                }
            }
        }
    }

    fn isDragged(wm: *const Wm, i: u8) bool {
        return switch (wm.drag) {
            .window => |d| d.win == i,
            .tab => |d| d.win == i and wm.wins[i].n == 1,
            else => false,
        };
    }

    /// The zone for a drop at (x, y).
    pub fn zoneAt(wm: *const Wm, x: f32, y: f32) Zone {
        const a = wm.area;
        const l = x - a.x < snap_corner;
        const r = a.x + a.w - x < snap_corner;
        const t = y - a.y < snap_corner;
        const b = a.y + a.h - y < snap_corner;
        if (t and l) return .tl;
        if (t and r) return .tr;
        if (b and l) return .bl;
        if (b and r) return .br;
        if (x - a.x < snap_side) return .left;
        if (a.x + a.w - x < snap_side) return .right;
        if (y - a.y < snap_side) return .top;
        if (a.y + a.h - y < snap_side) return .bottom;
        return .free;
    }

    /// The rectangle that shows where a zone is, while a drag goes on.
    fn zonePreview(wm: *const Wm, z: Zone) Rect {
        const a = wm.area;
        const cw: f32 = 260;
        const ch: f32 = 200;
        return switch (z) {
            .free => .{},
            .tl => .{ .x = a.x, .y = a.y, .w = cw, .h = ch },
            .tr => .{ .x = a.x + a.w - cw, .y = a.y, .w = cw, .h = ch },
            .bl => .{ .x = a.x, .y = a.y + a.h - ch, .w = cw, .h = ch },
            .br => .{ .x = a.x + a.w - cw, .y = a.y + a.h - ch, .w = cw, .h = ch },
            .left => .{ .x = a.x, .y = a.y + ch, .w = cw, .h = a.h - 2 * ch },
            .right => .{ .x = a.x + a.w - cw, .y = a.y + ch, .w = cw, .h = a.h - 2 * ch },
            .top => .{ .x = a.x + cw, .y = a.y, .w = a.w - 2 * cw, .h = 120 },
            .bottom => .{ .x = a.x + cw, .y = a.y + a.h - 120, .w = a.w - 2 * cw, .h = 120 },
        };
    }

    /// The topmost window under the point.
    fn hit(wm: *const Wm, x: f32, y: f32) ?u8 {
        var k: usize = max_wins;
        while (k > 0) {
            k -= 1;
            const i = wm.order[k];
            if (wm.wins[i].used and wm.wins[i].rect.has(x, y)) return i;
        }
        return null;
    }

    /// The window whose title bar is under the point, but not `skip`.
    fn titleHit(wm: *const Wm, x: f32, y: f32, skip: ?u8) ?u8 {
        var k: usize = max_wins;
        while (k > 0) {
            k -= 1;
            const i = wm.order[k];
            const w = wm.wins[i];
            if (!w.used or (skip != null and skip.? == i)) continue;
            const r = Rect{ .x = w.rect.x, .y = w.rect.y, .w = w.rect.w, .h = title_h };
            if (r.has(x, y)) return i;
        }
        return null;
    }

    fn tabRect(w: *const Win, p: anytype, k: u8) Rect {
        var x = w.rect.x + 4;
        for (w.tabs[0..k]) |t| x += tabWidth(p, t);
        return .{ .x = x, .y = w.rect.y, .w = tabWidth(p, w.tabs[k]), .h = title_h };
    }

    fn minButton(w: *const Win) Rect {
        return .{ .x = w.rect.x + w.rect.w - button_w - 2, .y = w.rect.y + 2, .w = button_w, .h = title_h - 4 };
    }
    fn snapButton(w: *const Win) Rect {
        return .{ .x = w.rect.x + w.rect.w - 2 * button_w - 4, .y = w.rect.y + 2, .w = button_w, .h = title_h - 4 };
    }
    fn pickerRect(w: *const Win) Rect {
        const b = snapButton(w);
        return .{ .x = b.x + b.w - 3 * 22 - 8, .y = b.y + b.h + 4, .w = 3 * 22 + 8, .h = 3 * 22 + 8 };
    }
    const picker_zones = [9]Zone{ .tl, .top, .tr, .left, .free, .right, .bl, .bottom, .br };

    fn menuTitleRect(wm: *const Wm, p: anytype, m: usize) Rect {
        var x: f32 = 118;
        for (menu_titles[0..m]) |t| x += p.measure(t, 15) + 24;
        return .{ .x = x, .y = 0, .w = p.measure(menu_titles[m], 15) + 24, .h = wm.bar_h };
    }
    fn menuItemRect(wm: *const Wm, p: anytype, m: Menu, k: usize) Rect {
        const t = wm.menuTitleRect(p, @backingInt(m));
        return .{ .x = t.x, .y = wm.bar_h + @as(f32, @floatFromInt(k)) * item_h, .w = menu_w, .h = item_h };
    }

    fn openMenu(wm: *Wm, m: Menu) void {
        wm.menu = m;
        wm.menu_hl = 0;
        wm.bar_focus = false;
    }

    /// Do a menu item. A window item works here. Others go out.
    fn run(wm: *Wm, op: Op) Action {
        wm.menu = null;
        switch (op) {
            .action => |a| return a,
            .next => wm.cycle(false),
            .minimise => if (wm.focus) |f| {
                wm.wins[f].min = !wm.wins[f].min;
            },
            .close_tab => if (wm.focus) |f| {
                const w = &wm.wins[f];
                _ = w.remove(w.active);
                if (!w.used) wm.focus = null;
            },
            .reset => {
                const area = wm.area;
                const bar = wm.bar_h;
                wm.* = init();
                wm.area = area;
                wm.bar_h = bar;
            },
        }
        return .none;
    }

    /// Read the input of one tick.
    pub fn update(wm: *Wm, p: anytype, in: Input) Update {
        wm.mx = in.mx;
        wm.my = in.my;
        wm.layout(p);
        var out: Update = .{};

        // The keyboard and the menus.
        if (in.alt_tap) {
            if (wm.menu != null or wm.bar_focus) {
                wm.menu = null;
                wm.bar_focus = false;
            } else wm.bar_focus = true;
            out.keys = true;
        }
        if (wm.menu) |m| {
            out.keys = true;
            const items = menuItems(m);
            var done = false;
            if (in.letter) |l| {
                // The letter of an item does it. Else the letter of a menu
                // opens that menu.
                for (items) |it| if (hotLetter(it.label, it.hot) == l) {
                    out.action = wm.run(it.op);
                    done = true;
                    break;
                };
                if (!done) for (menu_titles, 0..) |t, k| if (t[0] == l) wm.openMenu(@fromBackingInt(@intCast(k)));
            }
            if (!done and wm.menu != null) {
                if (in.escape) wm.menu = null;
                if (in.down_key) wm.menu_hl = @intCast((wm.menu_hl + 1) % items.len);
                if (in.up) wm.menu_hl = @intCast((wm.menu_hl + items.len - 1) % items.len);
                if (in.right) wm.openMenu(@fromBackingInt(@intCast((@backingInt(m) + 1) % menu_titles.len)));
                if (in.left) wm.openMenu(@fromBackingInt(@intCast((@backingInt(m) + menu_titles.len - 1) % menu_titles.len)));
                if (in.enter) out.action = wm.run(items[wm.menu_hl].op);
            }
        } else if (in.letter) |l| {
            if (in.alt or wm.bar_focus) for (menu_titles, 0..) |t, k| if (t[0] == l) {
                wm.openMenu(@fromBackingInt(@intCast(k)));
                out.keys = true;
            };
        }
        if (wm.bar_focus and in.escape) {
            wm.bar_focus = false;
            out.keys = true;
        }
        if (in.tab and wm.menu == null) {
            wm.cycle(in.shift);
            out.keys = true;
        }

        // The mouse on the menu bar, and on an open menu.
        if (wm.menu) |m| {
            for (menuItems(m), 0..) |_, k| if (wm.menuItemRect(p, m, k).has(in.mx, in.my)) {
                wm.menu_hl = @intCast(k);
            };
        }
        if (in.my < wm.bar_h) {
            out.mouse = true;
            for (menu_titles, 0..) |_, k| {
                if (!wm.menuTitleRect(p, k).has(in.mx, in.my)) continue;
                const menu: Menu = @fromBackingInt(@intCast(k));
                if (in.pressed) {
                    if (wm.menu == menu) wm.menu = null else wm.openMenu(menu);
                } else if (wm.menu != null and wm.menu != menu) wm.openMenu(menu);
            }
            return out;
        }
        if (wm.menu) |m| {
            out.mouse = true;
            if (in.pressed) {
                var hit_item = false;
                for (menuItems(m), 0..) |it, k| if (wm.menuItemRect(p, m, k).has(in.mx, in.my)) {
                    out.action = wm.run(it.op);
                    hit_item = true;
                };
                if (!hit_item) wm.menu = null;
            }
            return out;
        }

        // The snap picker.
        if (wm.picker) |pi| {
            out.mouse = true;
            if (in.pressed) {
                const r = pickerRect(&wm.wins[pi]);
                if (r.has(in.mx, in.my)) {
                    const cx: usize = @intFromFloat(std.math.clamp((in.mx - r.x - 4) / 22, 0, 2));
                    const cy: usize = @intFromFloat(std.math.clamp((in.my - r.y - 4) / 22, 0, 2));
                    const w = &wm.wins[pi];
                    w.zone = picker_zones[cy * 3 + cx];
                    if (w.zone == .free) {
                        w.x = wm.area.x + (wm.area.w - w.rect.w) / 2;
                        w.y = wm.area.y + (wm.area.h - w.rect.h) / 2;
                    }
                }
                wm.picker = null;
            }
            return out;
        }

        switch (wm.drag) {
            .none => if (in.pressed) {
                const i = wm.hit(in.mx, in.my) orelse {
                    wm.focus = null;
                    return out;
                };
                out.mouse = true;
                wm.raise(i);
                wm.focus = i;
                const w = &wm.wins[i];
                if (snapButton(w).has(in.mx, in.my)) {
                    wm.picker = i;
                } else if (minButton(w).has(in.mx, in.my)) {
                    w.min = !w.min;
                } else if (in.my >= w.rect.y + title_h) {
                    if (!w.min) {
                        wm.drag = .{ .content = i };
                        out.click = contentClick(w, in.mx, in.my);
                    }
                } else {
                    var tab: ?u8 = null;
                    for (0..w.n) |k| if (tabRect(w, p, @intCast(k)).has(in.mx, in.my)) {
                        tab = @intCast(k);
                        w.active = @intCast(k);
                    };
                    wm.drag = .{ .pending = .{ .win = i, .tab = tab, .sx = in.mx, .sy = in.my } };
                }
            } else {
                out.mouse = wm.hit(in.mx, in.my) != null;
            },
            .content => |i| {
                out.mouse = true;
                if (!in.down or !wm.wins[i].used) {
                    wm.drag = .none;
                } else out.click = contentClick(&wm.wins[i], in.mx, in.my);
            },
            .pending => |d| {
                out.mouse = true;
                if (!in.down) {
                    wm.drag = .none;
                } else if (@abs(in.mx - d.sx) + @abs(in.my - d.sy) > drag_start) {
                    const w = &wm.wins[d.win];
                    const offx = d.sx - w.rect.x;
                    const offy = d.sy - w.rect.y;
                    // A free copy of the position, so the window does not
                    // jump when it leaves its zone.
                    w.x = w.rect.x;
                    w.y = w.rect.y;
                    if (d.tab) |t| {
                        const tab_offx = if (w.n > 1) d.sx - tabRect(w, p, t).x else offx;
                        wm.drag = .{ .tab = .{ .win = d.win, .tab = t, .offx = tab_offx, .offy = offy } };
                    } else {
                        wm.drag = .{ .window = .{ .win = d.win, .offx = offx, .offy = offy } };
                    }
                }
            },
            .window => |d| {
                out.mouse = true;
                const w = &wm.wins[d.win];
                w.x = in.mx - d.offx;
                w.y = in.my - d.offy;
                if (!in.down) {
                    wm.drag = .none;
                    if (wm.titleHit(in.mx, in.my, d.win)) |t| {
                        wm.merge(d.win, t);
                    } else {
                        w.zone = wm.zoneAt(in.mx, in.my);
                    }
                }
            },
            .tab => |d| {
                out.mouse = true;
                const w = &wm.wins[d.win];
                if (w.n == 1) {
                    w.x = in.mx - d.offx;
                    w.y = in.my - d.offy;
                }
                if (!in.down) {
                    wm.drag = .none;
                    if (wm.titleHit(in.mx, in.my, d.win)) |t| {
                        if (wm.wins[t].n < max_tabs) {
                            const panel = w.remove(d.tab);
                            wm.addTab(t, panel);
                            wm.wins[t].active = wm.wins[t].n - 1;
                            wm.focusOn(t);
                        }
                    } else if (wm.titleHit(in.mx, in.my, null) == d.win) {
                        // Dropped on its own title bar: no change.
                    } else if (w.n == 1) {
                        w.zone = wm.zoneAt(in.mx, in.my);
                    } else {
                        const panel = w.remove(d.tab);
                        _ = wm.open(panel, wm.zoneAt(in.mx, in.my), in.mx - d.offx, in.my - d.offy);
                    }
                }
            },
        }
        return out;
    }

    fn contentClick(w: *const Win, x: f32, y: f32) @FieldType(Update, "click") {
        const r = w.rect;
        const h = r.h - title_h;
        return .{
            .panel = w.activePanel(),
            .u = std.math.clamp((x - r.x) / r.w, 0, 1),
            .v = std.math.clamp((y - r.y - title_h) / h, 0, 1),
        };
    }

    /// Move each tab of window `from` into window `to`, while it has room.
    fn merge(wm: *Wm, from: u8, to: u8) void {
        const a = &wm.wins[from];
        const b = &wm.wins[to];
        while (a.used and b.n < max_tabs) {
            b.tabs[b.n] = a.remove(0);
            b.n += 1;
        }
        b.active = b.n - 1;
        wm.focusOn(to);
    }

    // ------------------------------------------------------------ drawing

    pub const bg = Color.rgb(12, 18, 23, 0.94);
    pub const bar_bg = Color.rgb(14, 22, 28, 1);
    pub const edge = Color.rgb(60, 92, 104, 1);
    const title_bg = Color.rgb(20, 31, 38, 1);
    const tab_on = Color.rgb(34, 52, 62, 1);

    /// Draw the windows (bottom to top), the drag feedback, the picker and
    /// the menu bar. `content.panel(p, panel, rect, alpha)` draws a panel.
    pub fn draw(wm: *Wm, p: anytype, content: anytype, st: State, status: []const u8) !void {
        wm.layout(p);
        // The drop target.
        const dragged: ?u8 = switch (wm.drag) {
            .window => |d| d.win,
            .tab => |d| d.win,
            else => null,
        };
        if (dragged) |dw| {
            if (wm.titleHit(wm.mx, wm.my, dw)) |t| {
                const r = wm.wins[t].rect;
                try p.fill(r.x, r.y, r.w, title_h, ui_types.blue.alpha(0.25));
            } else {
                const z = wm.zoneAt(wm.mx, wm.my);
                if (z != .free) {
                    const r = wm.zonePreview(z);
                    try p.fill(r.x, r.y, r.w, r.h, ui_types.blue.alpha(0.08));
                    try p.stroke(r.x, r.y, r.w, r.h, 1, ui_types.blue.alpha(0.6));
                }
            }
        }
        for (wm.order) |i| {
            const w = &wm.wins[i];
            if (!w.used) continue;
            try drawWin(p, content, w, if (wm.isDragged(i)) 0.55 else 1, wm.focus == i);
        }
        // A tab out of a window with more tabs: a translucent window.
        if (wm.drag == .tab) {
            const d = wm.drag.tab;
            const src = &wm.wins[d.win];
            if (src.n > 1) {
                var ghost: Win = .{ .used = true, .n = 1 };
                ghost.tabs[0] = src.tabs[d.tab];
                const sz = ghost.size(p);
                ghost.rect = .{ .x = wm.mx - d.offx, .y = wm.my - d.offy, .w = sz[0], .h = sz[1] };
                try drawWin(p, content, &ghost, 0.55, false);
            }
        }
        if (wm.picker) |pi| {
            const r = pickerRect(&wm.wins[pi]);
            try p.fill(r.x, r.y, r.w, r.h, bg);
            try p.stroke(r.x, r.y, r.w, r.h, 1, edge);
            for (picker_zones, 0..) |z, k| {
                const cx = r.x + 4 + @as(f32, @floatFromInt(k % 3)) * 22;
                const cy = r.y + 4 + @as(f32, @floatFromInt(k / 3)) * 22;
                const on = wm.wins[pi].zone == z;
                const hover = (Rect{ .x = cx, .y = cy, .w = 22, .h = 22 }).has(wm.mx, wm.my);
                try p.fill(cx + 2, cy + 2, 18, 18, if (on) ui_types.blue.alpha(0.6) else if (hover) ui_types.blue.alpha(0.3) else tab_on);
            }
        }
        try wm.drawBar(p, st, status);
    }

    fn drawWin(p: anytype, content: anytype, w: *const Win, a: f32, focused: bool) !void {
        const r = w.rect;
        try p.fill(r.x, r.y, r.w, r.h, bg.alpha(a));
        try p.fill(r.x, r.y, r.w, title_h, title_bg.alpha(a));
        for (0..w.n) |k| {
            const t = tabRect(w, p, @intCast(k));
            const on = k == w.active;
            if (on) {
                try p.fill(t.x, t.y + 3, t.w, t.h - 3, tab_on.alpha(a));
                try p.fill(t.x, t.y + 3, t.w, 2, ui_types.blue.alpha(a));
            }
            try p.text(panelTitle(w.tabs[k]), t.x + tab_pad, t.y + 6, tab_size, (if (on) ui_types.ink else ui_types.dim).alpha(a));
        }
        // The snap button: a box with its corner filled. The minimise
        // button: a line.
        const sb = snapButton(w);
        try p.stroke(sb.x + 6, sb.y + 5, 12, 12, 1, ui_types.ink.alpha(0.7 * a));
        try p.fill(sb.x + 12, sb.y + 5, 6, 6, ui_types.ink.alpha(0.7 * a));
        const mb = minButton(w);
        try p.fill(mb.x + 6, mb.y + 15, 12, 2, ui_types.ink.alpha(0.7 * a));
        try p.stroke(r.x, r.y, r.w, r.h, if (focused) 1.5 else 1, if (focused) ui_types.blue.alpha(a) else edge.alpha(a));
        if (!w.min) try content.panel(p, w.activePanel(), Rect{ .x = r.x, .y = r.y + title_h, .w = r.w, .h = r.h - title_h }, a);
    }

    /// A label with its hot letter underlined.
    fn hotText(p: anytype, label: []const u8, hot: u8, x: f32, y: f32, size: f32, c: Color) !void {
        try p.text(label, x, y, size, c);
        const ux = x + p.measure(label[0..hot], size);
        try p.fill(ux, y + size + 2, p.measure(label[hot .. hot + 1], size), 1, c.alpha(0.85));
    }

    fn drawBar(wm: *const Wm, p: anytype, st: State, status: []const u8) !void {
        const full = wm.area.x + wm.area.w;
        try p.fill(0, 0, full, wm.bar_h, bar_bg);
        try p.fill(0, wm.bar_h - 1, full, 1, edge);
        try p.text("ORDNANCE", 14, 9, 16, ui_types.amber);
        for (menu_titles, 0..) |t, k| {
            const r = wm.menuTitleRect(p, k);
            const open_now = wm.menu != null and @backingInt(wm.menu.?) == k;
            if (open_now) try p.fill(r.x, r.y, r.w, r.h, tab_on);
            if (wm.bar_focus) try p.stroke(r.x + 2, r.y + 4, r.w - 4, r.h - 8, 1, ui_types.blue.alpha(0.5));
            try hotText(p, t, 0, r.x + 12, 9, 15, ui_types.ink);
        }
        const sw = p.measure(status, 15);
        try p.text(status, full - sw - 12, 9, 15, ui_types.ink);

        const m = wm.menu orelse return;
        const items = menuItems(m);
        const top = wm.menuItemRect(p, m, 0);
        const mh = item_h * @as(f32, @floatFromInt(items.len)) + 4;
        try p.fill(top.x, top.y, menu_w, mh, bg);
        try p.stroke(top.x, top.y, menu_w, mh, 1, edge);
        for (items, 0..) |it, k| {
            const r = wm.menuItemRect(p, m, k);
            if (k == wm.menu_hl) try p.fill(r.x + 1, r.y + 1, r.w - 2, r.h, tab_on);
            const checked = switch (it.op) {
                .action => |a| switch (a) {
                    .pause => st.paused,
                    .speed => |s| s == st.speed,
                    .mode => |md| md == st.mode,
                    .toggle => |pn| wm.find(pn) != null,
                    .heightmap => st.heightmap,
                    .debug => st.debug,
                    .layout_per_mode => st.layout_per_mode,
                    .none => false,
                },
                else => false,
            };
            if (checked) try p.fill(r.x + 10, r.y + 11, 7, 7, ui_types.blue);
            try hotText(p, it.label, it.hot, r.x + 26, r.y + 6, 15, ui_types.ink);
            if (it.key.len > 0) try p.text(it.key, r.x + r.w - 12 - p.measure(it.key, 14), r.y + 7, 14, ui_types.dim);
        }
    }
};

// ------------------------------------------------------------ tests

const TestPainter = struct {
    pub fn measure(_: *TestPainter, s: []const u8, size: f32) f32 {
        return @as(f32, @floatFromInt(s.len)) * size * 0.5;
    }
};

fn testWm() Wm {
    var wm = Wm.init();
    wm.area = .{ .x = 0, .y = 34, .w = 1280, .h = 836 };
    return wm;
}

fn press(wm: *Wm, p: *TestPainter, x: f32, y: f32) void {
    _ = wm.update(p, .{ .mx = x, .my = y, .down = true, .pressed = true });
}
fn moveTo(wm: *Wm, p: *TestPainter, x: f32, y: f32) void {
    _ = wm.update(p, .{ .mx = x, .my = y, .down = true });
}
fn release(wm: *Wm, p: *TestPainter, x: f32, y: f32) void {
    _ = wm.update(p, .{ .mx = x, .my = y, .released = true });
}

test "the default windows tile in their corners" {
    var p: TestPainter = .{};
    var wm = testWm();
    wm.layout(&p);
    const f = wm.find(.forces).?;
    const r = wm.wins[f[0]].rect;
    try std.testing.expectEqual(@as(f32, margin), r.x);
    try std.testing.expectEqual(wm.area.y + wm.area.h - margin, r.y + r.h);
}

test "a window dropped in a corner snaps, and two windows tile there" {
    var p: TestPainter = .{};
    var wm = testWm();
    wm.layout(&p);
    const sq = wm.find(.square).?[0];
    const r = wm.wins[sq].rect;
    // Drag the empty part of the title bar to the bottom left corner.
    const gx = r.x + r.w - 2 * button_w - 10;
    press(&wm, &p, gx, r.y + 5);
    moveTo(&wm, &p, 600, 400);
    moveTo(&wm, &p, 20, 860);
    release(&wm, &p, 20, 860);
    try std.testing.expectEqual(Zone.bl, wm.wins[sq].zone);
    wm.layout(&p);
    const forces = wm.wins[wm.find(.forces).?[0]].rect;
    const square = wm.wins[sq].rect;
    try std.testing.expectEqual(forces.x, square.x);
    try std.testing.expect(square.y + square.h <= forces.y or forces.y + forces.h <= square.y);
}

test "a tab dragged out makes a new window, and dropped on a title bar joins it" {
    var p: TestPainter = .{};
    var wm = testWm();
    wm.layout(&p);
    const sup = wm.find(.supply).?[0];
    try std.testing.expectEqual(@as(u8, 2), wm.wins[sup].n);
    const kt = Wm.tabRect(&wm.wins[sup], &p, 1);
    press(&wm, &p, kt.x + 5, kt.y + 5);
    moveTo(&wm, &p, 640, 400);
    release(&wm, &p, 640, 400);
    const keys = wm.find(.keys).?;
    try std.testing.expect(keys[0] != sup);
    try std.testing.expectEqual(Zone.free, wm.wins[keys[0]].zone);
    try std.testing.expectEqual(@as(u8, 1), wm.wins[sup].n);
    wm.layout(&p);
    const kw = wm.wins[keys[0]].rect;
    const fw = wm.wins[wm.find(.forces).?[0]].rect;
    press(&wm, &p, kw.x + 10, kw.y + 5);
    moveTo(&wm, &p, 600, 600);
    moveTo(&wm, &p, fw.x + 30, fw.y + 10);
    release(&wm, &p, fw.x + 30, fw.y + 10);
    try std.testing.expectEqual(wm.find(.forces).?[0], wm.find(.keys).?[0]);
}

test "alt and a letter open a menu, and enter does the item" {
    var p: TestPainter = .{};
    var wm = testWm();
    var u = wm.update(&p, .{ .alt = true, .letter = 'M' });
    try std.testing.expect(u.keys);
    try std.testing.expectEqual(Menu.mode, wm.menu.?);
    _ = wm.update(&p, .{ .down_key = true });
    u = wm.update(&p, .{ .enter = true });
    try std.testing.expectEqual(Mode.logistics, u.action.mode);
    try std.testing.expect(wm.menu == null);
}

test "alt, v, k opens the keys window" {
    var p: TestPainter = .{};
    var wm = testWm();
    // Close the Keys tab first: it is in the default layout.
    const f = wm.find(.keys).?;
    _ = wm.wins[f[0]].remove(f[1]);
    try std.testing.expect(wm.find(.keys) == null);
    _ = wm.update(&p, .{ .alt_tap = true });
    try std.testing.expect(wm.bar_focus);
    _ = wm.update(&p, .{ .letter = 'V' });
    try std.testing.expectEqual(Menu.view, wm.menu.?);
    const u = wm.update(&p, .{ .letter = 'K' });
    try std.testing.expectEqual(Panel.keys, u.action.toggle);
}

test "tab moves the focus and opens a minimised window" {
    var p: TestPainter = .{};
    var wm = testWm();
    wm.layout(&p);
    const f = wm.find(.forces).?[0];
    wm.wins[f].min = true;
    var seen_forces = false;
    for (0..3) |_| {
        _ = wm.update(&p, .{ .tab = true });
        if (wm.focus == f) seen_forces = true;
    }
    try std.testing.expect(seen_forces);
    try std.testing.expect(!wm.wins[f].min);
}

test "the minimise button leaves only the title bar" {
    var p: TestPainter = .{};
    var wm = testWm();
    wm.layout(&p);
    const f = wm.find(.forces).?[0];
    const b = Wm.minButton(&wm.wins[f]);
    press(&wm, &p, b.x + 5, b.y + 5);
    wm.layout(&p);
    try std.testing.expectEqual(@as(f32, title_h), wm.wins[f].rect.h);
}

test "a press in the map panel reports where" {
    var p: TestPainter = .{};
    var wm = testWm();
    wm.layout(&p);
    const mw = wm.wins[wm.find(.minimap).?[0]].rect;
    const u = wm.update(&p, .{ .mx = mw.x + mw.w / 2, .my = mw.y + title_h + (mw.h - title_h) / 4, .down = true, .pressed = true });
    try std.testing.expectEqual(Panel.minimap, u.click.?.panel);
    try std.testing.expectApproxEqAbs(@as(f32, 0.5), u.click.?.u, 0.01);
    try std.testing.expectApproxEqAbs(@as(f32, 0.25), u.click.?.v, 0.01);
    try std.testing.expect(u.mouse);
}

test "a saved layout loads back" {
    var wm = testWm();
    const saved = wm.save();
    var kill = Wm.initFor(.kill);
    kill.area = wm.area;
    try std.testing.expect(kill.find(.supply) == null);
    kill.load(saved);
    try std.testing.expect(kill.find(.supply) != null);
}
