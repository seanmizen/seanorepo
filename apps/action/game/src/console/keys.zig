// The keys and mouse buttons that a bind can use, and their names. The
// names are lower case: "w", "1", "space", "mouse1". A name match ignores
// case.
//
// No function keys: the browser keeps F1 to F12. No Cmd key: the browser
// and the system keep Cmd shortcuts.
const std = @import("std");
const core = @import("sw_core");

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
    };
    for (aliases) |a| {
        if (std.ascii.eqlIgnoreCase(text, a[0])) return a[1];
    }
    return null;
}

const Source = union(enum) { key: core.KeyCode, button: core.MouseButton };

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
        else => unreachable,
    };
}

pub fn pressed(in: Input, snap: *const core.InputSnapshot) bool {
    return switch (source(in)) {
        .key => |k| snap.keyPressed(k),
        .button => |b| snap.buttonPressed(b),
    };
}

pub fn released(in: Input, snap: *const core.InputSnapshot) bool {
    return switch (source(in)) {
        .key => |k| snap.keyReleased(k),
        .button => |b| snap.buttonReleased(b),
    };
}

pub fn down(in: Input, snap: *const core.InputSnapshot) bool {
    return switch (source(in)) {
        .key => |k| snap.keyDown(k),
        .button => |b| snap.buttonDown(b),
    };
}

/// A list of the key names for a message: "a to z, 0 to 9, left, ...".
pub const help = "a to z, 0 to 9, left, right, up, down, space, enter, escape, tab, backspace, shift, ctrl, alt, mouse1 to mouse5";
