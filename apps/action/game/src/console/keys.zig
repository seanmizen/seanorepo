// The keys, mouse buttons and wheel directions that a bind can use, and
// their names. The names are lower case: "w", "1", "space", "mouse1",
// "grave", "mwheelup". A name match ignores case.
//
// Each punctuation name is the key at that position on a US keyboard.
// swindowzig finds these keys by position, so "grave" is the key left of 1
// on every layout.
//
// The wheel: "mwheelup" and "mwheeldown" are pressed and released in the
// same tick, so a bind to "+x" runs "+x" and then "-x".
//
// No function keys: the browser keeps F1 to F12. No Cmd key: the browser
// and the system keep Cmd shortcuts.
const std = @import("std");
const core = @import("sw_core");

// The key codes Grave to Insert and the wheel in lines came after the
// swindowzig release v0.2.0. Stop with a clear message on an older
// swindowzig.
comptime {
    if (!@hasField(core.KeyCode, "Grave")) @compileError(
        \\swindowzig has no KeyCode.Grave: it is v0.2.0 or older. The game needs v0.3.0 or newer.
        \\Build with SWINDOWZIG_FORK=<swindowzig checkout>, or change the pin (see "swindowzig" in apps/action/README.md).
    );
}

pub const Input = enum(u8) {
    a,
    b,
    c,
    d,
    e,
    f,
    g,
    h,
    i,
    j,
    k,
    l,
    m,
    n,
    o,
    p,
    q,
    r,
    s,
    t,
    u,
    v,
    w,
    x,
    y,
    z,
    @"0",
    @"1",
    @"2",
    @"3",
    @"4",
    @"5",
    @"6",
    @"7",
    @"8",
    @"9",
    left,
    right,
    up,
    down,
    space,
    enter,
    escape,
    tab,
    backspace,
    shift,
    ctrl,
    alt,
    mouse1,
    mouse2,
    mouse3,
    mouse4,
    mouse5,
    // The members below came after the saved binds of older versions. The
    // saved binds use the names, so the order does not matter to them.
    grave,
    minus,
    equal,
    leftbracket,
    rightbracket,
    backslash,
    semicolon,
    quote,
    comma,
    period,
    slash,
    delete,
    home,
    end,
    pageup,
    pagedown,
    insert,
    mwheelup,
    mwheeldown,
};

pub const all = std.enums.values(Input);
pub const count = all.len;

pub fn name(in: Input) []const u8 {
    return @tagName(in);
}

/// The input with this name. "esc" is also escape, and "leftarrow" and
/// the like are also the arrows.
pub fn fromName(text: []const u8) ?Input {
    for (all) |in| {
        if (std.ascii.eqlIgnoreCase(text, @tagName(in))) return in;
    }
    const aliases = [_]struct { []const u8, Input }{
        .{ "esc", .escape },
        .{ "leftarrow", .left },
        .{ "rightarrow", .right },
        .{ "uparrow", .up },
        .{ "downarrow", .down },
        .{ "return", .enter },
        .{ "control", .ctrl },
        .{ "backquote", .grave },
        .{ "equals", .equal },
        .{ "apostrophe", .quote },
        .{ "del", .delete },
        .{ "ins", .insert },
        .{ "pgup", .pageup },
        .{ "pgdn", .pagedown },
    };
    for (aliases) |a| {
        if (std.ascii.eqlIgnoreCase(text, a[0])) return a[1];
    }
    return null;
}

const Wheel = enum { up, down };
const Source = union(enum) { key: core.KeyCode, button: core.MouseButton, wheel: Wheel };

fn source(in: Input) Source {
    const i = @backingInt(in);
    if (i <= @backingInt(Input.z)) return .{ .key = @fromBackingInt(@backingInt(core.KeyCode.A) + i) };
    if (i <= @backingInt(Input.@"9")) return .{ .key = @fromBackingInt(@backingInt(core.KeyCode.Num0) + (i - @backingInt(Input.@"0"))) };
    return switch (in) {
        .left => .{ .key = .Left },
        .right => .{ .key = .Right },
        .up => .{ .key = .Up },
        .down => .{ .key = .Down },
        .space => .{ .key = .Space },
        .enter => .{ .key = .Enter },
        .escape => .{ .key = .Escape },
        .tab => .{ .key = .Tab },
        .backspace => .{ .key = .Backspace },
        .shift => .{ .key = .Shift },
        .ctrl => .{ .key = .Ctrl },
        .alt => .{ .key = .Alt },
        .mouse1 => .{ .button = .left },
        .mouse2 => .{ .button = .right },
        .mouse3 => .{ .button = .middle },
        .mouse4 => .{ .button = .x1 },
        .mouse5 => .{ .button = .x2 },
        .grave => .{ .key = .Grave },
        .minus => .{ .key = .Minus },
        .equal => .{ .key = .Equal },
        .leftbracket => .{ .key = .LeftBracket },
        .rightbracket => .{ .key = .RightBracket },
        .backslash => .{ .key = .Backslash },
        .semicolon => .{ .key = .Semicolon },
        .quote => .{ .key = .Quote },
        .comma => .{ .key = .Comma },
        .period => .{ .key = .Period },
        .slash => .{ .key = .Slash },
        .delete => .{ .key = .Delete },
        .home => .{ .key = .Home },
        .end => .{ .key = .End },
        .pageup => .{ .key = .PageUp },
        .pagedown => .{ .key = .PageDown },
        .insert => .{ .key = .Insert },
        .mwheelup => .{ .wheel = .up },
        .mwheeldown => .{ .wheel = .down },
        else => unreachable,
    };
}

/// True when the wheel turned in this direction in this tick. The snapshot
/// wheel is in lines on all backends. A positive delta_y scrolls up.
fn wheelTurned(w: Wheel, snap: *const core.InputSnapshot) bool {
    return switch (w) {
        .up => snap.wheel.delta_y > 0,
        .down => snap.wheel.delta_y < 0,
    };
}

pub fn pressed(in: Input, snap: *const core.InputSnapshot) bool {
    return switch (source(in)) {
        .key => |k| snap.keyPressed(k),
        .button => |b| snap.buttonPressed(b),
        .wheel => |w| wheelTurned(w, snap),
    };
}

/// A wheel direction is released in the tick of its press.
pub fn released(in: Input, snap: *const core.InputSnapshot) bool {
    return switch (source(in)) {
        .key => |k| snap.keyReleased(k),
        .button => |b| snap.buttonReleased(b),
        .wheel => |w| wheelTurned(w, snap),
    };
}

pub fn down(in: Input, snap: *const core.InputSnapshot) bool {
    return switch (source(in)) {
        .key => |k| snap.keyDown(k),
        .button => |b| snap.buttonDown(b),
        .wheel => |w| wheelTurned(w, snap),
    };
}

/// A list of the key names for a message: "a to z, 0 to 9, left, ...".
pub const help = "a to z, 0 to 9, left, right, up, down, space, enter, escape, tab, backspace, shift, ctrl, alt, grave, minus, equal, leftbracket, rightbracket, backslash, semicolon, quote, comma, period, slash, delete, home, end, pageup, pagedown, insert, mouse1 to mouse5, mwheelup, mwheeldown";
