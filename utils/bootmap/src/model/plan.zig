//! The plan: the tree of boxes and the state of each box.
//!
//! Depth 0 is the root (the screen). Depth 1 is a stage (firmware, loader,
//! kernel, initrd, systemd). Depth 2 is a group (an initcall level, or a
//! systemd target). Depth 3 is a leaf: one initcall or one unit.
//!
//! `nodes` is in pre-order. The children of a node are in boot order: the
//! first start time, then the name. Stages use a fixed order (stage_order).

const std = @import("std");
const treemap = @import("../layout/treemap.zig");
const trace_mod = @import("trace.zig");

pub const Rect = treemap.Rect;

pub const stage_order = [_][]const u8{ "firmware", "loader", "kernel", "initrd", "systemd" };

pub const State = enum(u8) { pending, active, done, failed };

pub const Node = struct {
    name: []const u8,
    depth: u8,
    parent: u32,
    children: []u32 = &.{},
    /// Leaves: leafWeight(duration). Other nodes: the sum of the children.
    weight: u64 = 0,
    rect: Rect = .{},
    /// The index of the stage in stage_order (for the colour).
    stage: u8 = 0,
    /// Leaves only.
    start_us: u64 = 0,
    end_us: u64 = 0,
    failed: bool = false,
    /// The earliest start of this node or of a node under it.
    first_us: u64 = std.math.maxInt(u64),
};

/// The inset of the children area inside a node, by the depth of the node.
pub const pads = [_]i32{ 6, 3, 2 };
/// Sort the children by weight (true) or keep boot order (false), by the
/// depth of the parent. Stages and groups keep boot order, so the picture
/// reads in boot order. Leaves are sorted, for squarer boxes.
pub const sort_children = [_]bool{ false, false, true };

pub const Plan = struct {
    arena: std.heap.ArenaAllocator,
    nodes: []Node,
    end_us: u64,

    pub fn deinit(self: *Plan) void {
        self.arena.deinit();
    }

    pub fn leafCount(self: *const Plan) usize {
        var n: usize = 0;
        for (self.nodes) |nd| n += @intFromBool(nd.children.len == 0 and nd.depth == 3);
        return n;
    }

    /// The state of a leaf at time `t_us`.
    pub fn state(self: *const Plan, i: usize, t_us: u64) State {
        const nd = self.nodes[i];
        if (t_us < nd.start_us) return .pending;
        if (t_us < nd.end_us) return .active;
        return if (nd.failed) .failed else .done;
    }

    /// Lay out the whole tree in `area`.
    pub fn layout(self: *Plan, area: Rect) !void {
        const alloc = self.arena.allocator();
        self.nodes[0].rect = area;
        for (self.nodes) |*nd| {
            if (nd.children.len == 0) continue;
            const inner = nd.rect.inset(pads[@min(nd.depth, pads.len - 1)]);
            const raw = try alloc.alloc(u64, nd.children.len);
            const w = try alloc.alloc(u32, nd.children.len);
            const order = try alloc.alloc(u32, nd.children.len);
            const out = try alloc.alloc(Rect, nd.children.len);
            for (nd.children, raw) |c, *r| r.* = self.nodes[c].weight;
            treemap.normalize(raw, w);
            treemap.makeOrder(w, order, sort_children[@min(nd.depth, sort_children.len - 1)]);
            treemap.squarify(inner, w, order, out);
            for (nd.children, out) |c, r| self.nodes[c].rect = r;
        }
    }

    /// Write the plan in the text form that kernel/layout.c reads
    /// (test/layout-parity.sh): a header, then one line per node in
    /// pre-order: "<depth> <weight> <name>".
    pub fn writeText(self: *const Plan, w: *std.Io.Writer, width: i32, height: i32) !void {
        try w.print("bootmap-plan 1\n{d} {d}\n{d}\n", .{ width, height, self.nodes.len });
        for (self.nodes) |nd| try w.print("{d} {d} {s}\n", .{ nd.depth, nd.weight, nd.name });
    }

    pub fn writeRects(self: *const Plan, w: *std.Io.Writer) !void {
        for (self.nodes) |nd| try w.print("{d} {d} {d} {d}\n", .{ nd.rect.x, nd.rect.y, nd.rect.w, nd.rect.h });
    }
};

/// A temporary tree node, before the flat pre-order array.
const Tmp = struct {
    name: []const u8,
    stage: u8,
    first_us: u64 = std.math.maxInt(u64),
    weight: u64 = 0,
    box: ?trace_mod.Box = null,
    kids: std.ArrayList(*Tmp) = .empty,

    fn child(self: *Tmp, alloc: std.mem.Allocator, name: []const u8, stage: u8) !*Tmp {
        for (self.kids.items) |k| if (std.mem.eql(u8, k.name, name)) return k;
        const k = try alloc.create(Tmp);
        k.* = .{ .name = name, .stage = stage };
        try self.kids.append(alloc, k);
        return k;
    }
};

fn stageIndex(name: []const u8) ?u8 {
    for (stage_order, 0..) |s, i| if (std.mem.eql(u8, s, name)) return @intCast(i);
    return null;
}

fn bootOrder(_: void, a: *Tmp, b: *Tmp) bool {
    if (a.first_us != b.first_us) return a.first_us < b.first_us;
    return std.mem.order(u8, a.name, b.name) == .lt;
}

fn stageOrder(_: void, a: *Tmp, b: *Tmp) bool {
    return a.stage < b.stage;
}

/// Build the plan from a trace. Boxes with a stage that is not in
/// stage_order are an error.
pub fn fromTrace(gpa: std.mem.Allocator, trace: trace_mod.Trace) !Plan {
    var arena = std.heap.ArenaAllocator.init(gpa);
    errdefer arena.deinit();
    const alloc = arena.allocator();

    const root = try alloc.create(Tmp);
    root.* = .{ .name = "boot", .stage = 0 };
    for (trace.boxes) |b| {
        if (b.path.len != 3) return error.BadPath;
        const si = stageIndex(b.path[0]) orelse return error.UnknownStage;
        const stage = try root.child(alloc, try alloc.dupe(u8, b.path[0]), si);
        const group = try stage.child(alloc, try alloc.dupe(u8, b.path[1]), si);
        const leaf = try group.child(alloc, try alloc.dupe(u8, b.path[2]), si);
        // A name can start more than one time (an initcall name in two
        // levels is in two groups). In one group, the first one wins.
        if (leaf.box != null) continue;
        leaf.box = b;
        leaf.weight = treemap.leafWeight(b.end_us -| b.start_us);
        leaf.first_us = b.start_us;
    }

    // Weights and first starts, from the leaves up. Then sort.
    for (root.kids.items) |stage| {
        for (stage.kids.items) |group| {
            for (group.kids.items) |leaf| {
                group.weight += leaf.weight;
                group.first_us = @min(group.first_us, leaf.first_us);
            }
            std.mem.sort(*Tmp, group.kids.items, {}, bootOrder);
            stage.weight += group.weight;
            stage.first_us = @min(stage.first_us, group.first_us);
        }
        std.mem.sort(*Tmp, stage.kids.items, {}, bootOrder);
        root.weight += stage.weight;
    }
    std.mem.sort(*Tmp, root.kids.items, {}, stageOrder);

    var nodes: std.ArrayList(Node) = .empty;
    try flatten(alloc, &nodes, root, 0, 0);
    return .{ .arena = arena, .nodes = nodes.items, .end_us = trace.end_us };
}

fn flatten(alloc: std.mem.Allocator, nodes: *std.ArrayList(Node), t: *Tmp, depth: u8, parent: u32) !void {
    const idx: u32 = @intCast(nodes.items.len);
    try nodes.append(alloc, .{
        .name = t.name,
        .depth = depth,
        .parent = parent,
        .weight = t.weight,
        .stage = t.stage,
        .first_us = t.first_us,
        .start_us = if (t.box) |b| b.start_us else 0,
        .end_us = if (t.box) |b| b.end_us else 0,
        .failed = if (t.box) |b| b.failed else false,
    });
    const kids = try alloc.alloc(u32, t.kids.items.len);
    for (t.kids.items, kids) |k, *slot| {
        slot.* = @intCast(nodes.items.len);
        try flatten(alloc, nodes, k, depth + 1, idx);
    }
    nodes.items[idx].children = kids;
}

test "states only move forward" {
    // REQ-BOOTMAP-003: for each leaf, the state at a later time is never
    // an earlier state.
    const boxes = [_]trace_mod.Box{
        .{ .path = &.{ "kernel", "core", "a" }, .start_us = 0, .end_us = 0 },
        .{ .path = &.{ "kernel", "core", "b" }, .start_us = 5, .end_us = 50 },
        .{ .path = &.{ "systemd", "sysinit.target", "c" }, .start_us = 40, .end_us = 90, .failed = true },
    };
    var plan = try fromTrace(std.testing.allocator, .{ .version = 1, .end_us = 100, .boxes = &boxes });
    defer plan.deinit();
    for (plan.nodes, 0..) |nd, i| {
        if (nd.depth != 3) continue;
        var last: u8 = 0;
        var t: u64 = 0;
        while (t <= 100) : (t += 1) {
            const s = @intFromEnum(plan.state(i, t));
            const rank: u8 = if (s >= @intFromEnum(State.done)) 2 else s;
            try std.testing.expect(rank >= last);
            last = rank;
        }
    }
}

test "a small trace gives a laid-out tree" {
    const boxes = [_]trace_mod.Box{
        .{ .path = &.{ "kernel", "core", "a" }, .start_us = 0, .end_us = 100 },
        .{ .path = &.{ "kernel", "core", "b" }, .start_us = 100, .end_us = 400 },
        .{ .path = &.{ "systemd", "sysinit.target", "x.service" }, .start_us = 500, .end_us = 9000, .failed = true },
    };
    var plan = try fromTrace(std.testing.allocator, .{ .version = 1, .source = "test", .end_us = 9000, .boxes = &boxes });
    defer plan.deinit();
    try plan.layout(.{ .w = 640, .h = 480 });
    try std.testing.expectEqual(@as(usize, 3), plan.leafCount());
    try std.testing.expectEqualStrings("kernel", plan.nodes[1].name);
    for (plan.nodes) |nd| try std.testing.expect(nd.rect.w > 0 and nd.rect.h > 0);
    const x = plan.nodes.len - 1;
    try std.testing.expectEqual(State.pending, plan.state(x, 0));
    try std.testing.expectEqual(State.active, plan.state(x, 600));
    try std.testing.expectEqual(State.failed, plan.state(x, 9000));
}
