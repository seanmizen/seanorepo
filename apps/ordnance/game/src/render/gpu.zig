//! The GPU painter: the painter interface of view.zig on the swindowzig 2D
//! renderer. A line is a quad along the segment with a soft-edge texture
//! across it (anti-aliased). A triangle is a quad with two corners at the
//! same point. Both go straight into the batch of the renderer.
const std = @import("std");
const gfx = @import("sw_gfx2d");
const sw_text = @import("sw_text");
const style = @import("../style.zig");

pub const Textures = struct {
    hatch: gfx.Texture,
    line: gfx.Texture,
    minimap: gfx.Texture,
};

const hatch_size = 24;
const profile_w = 64;

/// Make the textures that the painter needs. The minimap texture gets its
/// pixels later (`updateTexture`).
pub fn makeTextures(r: *gfx.Renderer, minimap_side: u32, minimap_rgba: []const u8) !Textures {
    var hatch: [hatch_size * hatch_size * 4]u8 = undefined;
    for (0..hatch_size) |y| for (0..hatch_size) |x| {
        const i = (y * hatch_size + x) * 4;
        @memset(hatch[i .. i + 3], 255);
        hatch[i + 3] = if ((x + y) % 6 == 0) 255 else 0;
    };
    // A line with soft edges: full in the middle, fading in the outer part.
    var prof: [profile_w * 4]u8 = undefined;
    for (0..profile_w) |x| {
        const d = @abs((@as(f32, @floatFromInt(x)) + 0.5) / profile_w - 0.5) * 2;
        @memset(prof[x * 4 .. x * 4 + 3], 255);
        prof[x * 4 + 3] = @intFromFloat(std.math.clamp((1 - d) / 0.35, 0, 1) * 255);
    }
    return .{
        .hatch = try r.createTexture(hatch_size, hatch_size, &hatch, .linear),
        .line = try r.createTexture(profile_w, 1, &prof, .linear),
        .minimap = try r.createTexture(minimap_side, minimap_side, minimap_rgba, .nearest),
    };
}

pub const Painter = struct {
    r: *gfx.Renderer,
    tr: *sw_text.TextRenderer,
    tex: Textures,

    fn col(c: style.Color) gfx.Color {
        return .{ .r = c.r, .g = c.g, .b = c.b, .a = c.a };
    }
    pub fn fill(p: *Painter, x: f32, y: f32, w: f32, h: f32, c: style.Color) !void {
        try p.r.fillRect(.{ .x = x, .y = y, .w = w, .h = h }, col(c));
    }
    pub fn stroke(p: *Painter, x: f32, y: f32, w: f32, h: f32, lw: f32, c: style.Color) !void {
        try p.r.strokeRect(.{ .x = x, .y = y, .w = w, .h = h }, lw, col(c));
    }
    pub fn hatch(p: *Painter, x: f32, y: f32, w: f32, h: f32, c: style.Color) !void {
        try p.r.drawTexture(p.tex.hatch, .{ .x = x, .y = y, .w = w, .h = h }, null, col(c));
    }
    pub fn image(p: *Painter, x: f32, y: f32, w: f32, h: f32) !void {
        try p.r.drawTexture(p.tex.minimap, .{ .x = x, .y = y, .w = w, .h = h }, null, gfx.Color.white);
    }
    pub fn text(p: *Painter, s: []const u8, x: f32, y: f32, size: f32, c: style.Color) !void {
        _ = try p.tr.draw(p.r, s, x, y, .{ .size = size, .color = col(c) });
    }
    pub fn measure(p: *Painter, s: []const u8, size: f32) f32 {
        return p.tr.measure(s, size).w;
    }
    pub fn line(p: *Painter, ax: f32, ay: f32, bx: f32, by: f32, w: f32, c: style.Color) !void {
        const dx = bx - ax;
        const dy = by - ay;
        const len = @sqrt(dx * dx + dy * dy);
        if (len < 0.01) return;
        const ux = dx / len;
        const uy = dy / len;
        // One pixel more on each side for the soft edge, and half a pixel
        // past each end so the joins close.
        const half = w / 2 + 1;
        const nx = -uy * half;
        const ny = ux * half;
        const x0 = ax - ux * 0.5;
        const y0 = ay - uy * 0.5;
        const x1 = bx + ux * 0.5;
        const y1 = by + uy * 0.5;
        try p.quad(p.tex.line.id, .{
            .{ x0 + nx, y0 + ny, 0 },
            .{ x1 + nx, y1 + ny, 0 },
            .{ x1 - nx, y1 - ny, 1 },
            .{ x0 - nx, y0 - ny, 1 },
        }, c);
    }
    pub fn tri(p: *Painter, ax: f32, ay: f32, bx: f32, by: f32, cx: f32, cy: f32, c: style.Color) !void {
        // The white texture: id 0, any uv.
        try p.quad(0, .{ .{ ax, ay, 0 }, .{ bx, by, 0 }, .{ cx, cy, 0 }, .{ cx, cy, 0 } }, c);
    }

    /// Four corners (x, y, u) into the batch. One draw call for a run of
    /// quads with the same texture.
    fn quad(p: *Painter, tex: u32, v: [4][3]f32, c: style.Color) !void {
        const b = &p.r.batch;
        const alloc = p.r.alloc;
        const color = [4]f32{ c.r, c.g, c.b, c.a };
        const base: u32 = @intCast(b.vertices.items.len);
        const first: u32 = @intCast(b.indices.items.len);
        try b.vertices.appendSlice(alloc, &[4]gfx.Vertex{
            .{ .pos = .{ v[0][0], v[0][1] }, .uv = .{ v[0][2], 0.5 }, .color = color },
            .{ .pos = .{ v[1][0], v[1][1] }, .uv = .{ v[1][2], 0.5 }, .color = color },
            .{ .pos = .{ v[2][0], v[2][1] }, .uv = .{ v[2][2], 0.5 }, .color = color },
            .{ .pos = .{ v[3][0], v[3][1] }, .uv = .{ v[3][2], 0.5 }, .color = color },
        });
        try b.indices.appendSlice(alloc, &[6]u32{ base, base + 1, base + 2, base, base + 2, base + 3 });
        if (b.calls.items.len > 0) {
            const last = &b.calls.items[b.calls.items.len - 1];
            if (last.texture == tex) {
                last.index_count += 6;
                return;
            }
        }
        try b.calls.append(alloc, .{ .texture = tex, .first_index = first, .index_count = 6 });
    }
};
