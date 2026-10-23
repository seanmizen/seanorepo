// The frame: shadow pass, HDR scene pass (4x MSAA), bloom, final pass with
// the tone map and the HUD.
//
// Local light shadows: each map light has six depth maps, one for each axis
// direction (a cube map in six layers of a 2D array texture). They are drawn
// one time when a map loads (loadMap), from the static mesh. The map lights
// and the walls do not move, so the maps stay correct. The lifts, the train
// and the other players cast no shadow from a local light. Lights that move
// (the muzzle flash, a grenade, the train and lift lights) have no shadow
// map.
//
// Your own body casts a shadow from the `body_lights` nearest map lights.
// Each frame draws your body into six more layers for each of these
// lights (drawBodyShadows). The shader multiplies the two shadows.
const std = @import("std");
const sw = @import("sw_app");
const gpu_mod = @import("sw_gpu");
const gfx = @import("sw_gfx2d");
const vec = @import("vec.zig");
const mesh = @import("mesh.zig");
const map = @import("map.zig");
const V3 = vec.V3;
const v3 = vec.v3;
const Mat4 = vec.Mat4;
const T = gpu_mod;

const scene_src = @embedFile("scene.wgsl");
const post_src = @embedFile("post.wgsl");

const msaa = 4;
const shadow_size = 2048;
const hdr_format: T.TextureFormat = .rgba16float;
const depth_format: T.TextureFormat = .depth32float;
const swap_format: T.TextureFormat = .bgra8unorm;
const max_dynamic = 120_000;
/// The translucent vertices (smoke, the debug blast volume) per frame.
const max_translucent = 150_000;
/// Your body casts a shadow from this many map lights: the nearest ones.
/// scene.wgsl has the same count (the four values of `body_l`).
pub const body_lights = 4;
/// The size of one face of a light shadow map, and the layer count: six
/// faces for each map light, then six for each light of your body. The
/// layers of your body start at slot map.max_lights (scene.wgsl
/// BODY_SLOT).
const light_shadow_size = 256;
const light_layers = (map.max_lights + body_lights) * 6;
/// tan of the half angle of a face. It is a little more than 45 degrees, so
/// the filter taps at the edge of a face stay in that face (3 texels each
/// side). scene.wgsl has the same two values (LIGHT_FACE_TAN, LIGHT_NEAR).
const light_face_tan: f32 = @as(f32, light_shadow_size) / (light_shadow_size - 6.0);
const light_near: f32 = 0.05;

pub const SceneUniforms = extern struct {
    view_proj: [16]f32,
    light_vp: [16]f32,
    inv_vp: [16]f32,
    cam: [4]f32,
    sun_dir: [4]f32,
    sun_col: [4]f32,
    info: [4]f32,
    /// x: the underground height, y: the in-scatter strength.
    info2: [4]f32,
    /// The lights of your body: for slot d, the index of the light (from
    /// 1) in lp and lc, or 0.
    body_l: [4]f32,
    /// map.sealed: the room with no sun, min and max.
    sealed_lo: [4]f32,
    sealed_hi: [4]f32,
    lp: [max_lights][4]f32,
    /// rgb colour, w the shadow map of the light (map.Light.shadow).
    lc: [max_lights][4]f32,
};

/// The map lights (map.max_lights) and the lights that move: the train,
/// the lift cabs, the muzzle flashes, the grenades, a blessing of MORE.
/// scene.wgsl has the same size.
pub const max_lights = 44;

const PostUniforms = extern struct {
    texel: [2]f32,
    dir: [2]f32,
    exposure: f32,
    damage: f32,
    time: f32,
    bloom: f32,
};

/// Your body: a range of the dynamic vertices, and its centre. count 0:
/// no body.
pub const Body = struct {
    first: u32 = 0,
    count: u32 = 0,
    centre: V3 = .{ 0, 0, 0 },
};

pub const FrameParams = struct {
    eye: V3,
    yaw: f32,
    pitch: f32,
    /// The camera roll (the lean and the head bob). Positive tilts the
    /// right side of the camera up.
    roll: f32 = 0,
    fov: f32,
    time: f32,
    damage: f32,
    /// The exposure of the tone map (eye adaptation in main.zig).
    exposure: f32 = 0.68,
    lights: []const map.Light,
    /// Alpha-blended triangles, drawn after the opaque scene with no depth
    /// write (scene.wgsl fs_trans has the vertex encoding).
    translucent: []const mesh.Vertex = &.{},
    /// Your body casts a shadow from the nearest map lights.
    body: Body = .{},
};

pub const sun_dir = blk: {
    const d = V3{ -0.55, 0.36, -0.62 };
    break :blk d / @as(V3, @splat(@sqrt(@reduce(.Add, d * d))));
};
const sun_col = V3{ 3.2, 2.05, 1.25 };

var scene_pipe: T.RenderPipeline = undefined;
var sky_pipe: T.RenderPipeline = undefined;
var shadow_pipe: T.RenderPipeline = undefined;
var bright_pipe: T.RenderPipeline = undefined;
var blur_pipe: T.RenderPipeline = undefined;
var final_pipe: T.RenderPipeline = undefined;
var trans_pipe: T.RenderPipeline = undefined;
var light_shadow_pipe: T.RenderPipeline = undefined;

var scene_ubo: gpu_mod.Buffer = undefined;
var box_buf: gpu_mod.Buffer = undefined;
var static_vb: gpu_mod.Buffer = undefined;
var static_count: u32 = 0;
var has_static = false;
var dyn_vb: gpu_mod.Buffer = undefined;
var trans_vb: gpu_mod.Buffer = undefined;
var post_ubo: [4]gpu_mod.Buffer = undefined;

var scene_bgl: gpu_mod.BindGroupLayout = undefined;
var shadow_bgl: gpu_mod.BindGroupLayout = undefined;
var post_bgl: gpu_mod.BindGroupLayout = undefined;
var scene_bg: gpu_mod.BindGroup = undefined;
var shadow_bg: gpu_mod.BindGroup = undefined;
var post_bg: [4]?gpu_mod.BindGroup = .{ null, null, null, null };

var shadow_view: gpu_mod.TextureView = undefined;
/// All the light shadow layers (2D array), and one view for each layer to
/// draw into.
var light_shadow_view: gpu_mod.TextureView = undefined;
var light_layer_views: [light_layers]gpu_mod.TextureView = undefined;
/// The view-projection matrix of each light shadow layer.
var light_face_buf: gpu_mod.Buffer = undefined;
var light_shadow_bgl: gpu_mod.BindGroupLayout = undefined;
var light_shadow_bg: gpu_mod.BindGroup = undefined;
var linear_smp: gpu_mod.Sampler = undefined;
var shadow_smp: gpu_mod.Sampler = undefined;

const Targets = struct {
    w: u32 = 0,
    h: u32 = 0,
    hdr_msaa: ?gpu_mod.Texture = null,
    hdr: ?gpu_mod.Texture = null,
    depth: ?gpu_mod.Texture = null,
    bloom_a: ?gpu_mod.Texture = null,
    bloom_b: ?gpu_mod.Texture = null,
    hdr_msaa_v: gpu_mod.TextureView = undefined,
    hdr_v: gpu_mod.TextureView = undefined,
    depth_v: gpu_mod.TextureView = undefined,
    bloom_a_v: gpu_mod.TextureView = undefined,
    bloom_b_v: gpu_mod.TextureView = undefined,
};
var targets: Targets = .{};
/// The size of the 3D passes, for the debug screen.
pub var scene_w: u32 = 0;
pub var scene_h: u32 = 0;
var ready = false;

const vertex_layout = [_]T.VertexBufferLayout{.{
    .array_stride = @sizeOf(mesh.Vertex),
    .attributes = &[_]T.VertexAttribute{
        .{ .format = .float32x3, .offset = 0, .shader_location = 0 },
        .{ .format = .float32x3, .offset = 12, .shader_location = 1 },
        .{ .format = .float32x3, .offset = 24, .shader_location = 2 },
        .{ .format = .float32, .offset = 36, .shader_location = 3 },
    },
}};

/// Upload the static mesh of a new map, and draw the shadow maps of its
/// lights.
pub fn loadMap(gpu: *gpu_mod.GPU, static_mesh: []const mesh.Vertex, lights: []const map.Light) !void {
    if (has_static) static_vb.destroy();
    has_static = true;
    static_count = @intCast(static_mesh.len);
    static_vb = try gpu.createBuffer(.{ .size = @max(64, static_mesh.len * @sizeOf(mesh.Vertex)), .usage = .{ .vertex = true, .copy_dst = true } });
    gpu.writeBuffer(static_vb, 0, std.mem.sliceAsBytes(static_mesh));
    try drawLightShadows(gpu, lights);
}

/// The view-projection matrix of one face of a light shadow map. Face 0 to
/// 5 looks along +X, -X, +Y, -Y, +Z, -Z (scene.wgsl lightShadow picks the
/// face the same way). The far plane is the light radius.
fn lightFace(l: map.Light, face: usize) Mat4 {
    const sm = @import("sw_math");
    const dirs = [6]V3{ v3(1, 0, 0), v3(-1, 0, 0), v3(0, 1, 0), v3(0, -1, 0), v3(0, 0, 1), v3(0, 0, -1) };
    const up: V3 = if (face == 2 or face == 3) v3(0, 0, 1) else v3(0, 1, 0);
    const t = l.pos + dirs[face];
    const view = sm.lookAt(
        .{ .x = l.pos[0], .y = l.pos[1], .z = l.pos[2] },
        .{ .x = t[0], .y = t[1], .z = t[2] },
        .{ .x = up[0], .y = up[1], .z = up[2] },
    );
    const proj = sm.perspective(2 * std.math.atan(light_face_tan), 1, light_near, l.radius);
    return proj.mul(view);
}

/// Draw the six shadow faces of each map light: the static mesh, from the
/// light. Emissive surfaces (the lamps) cast no shadow (scene.wgsl
/// vs_light_shadow).
fn drawLightShadows(gpu: *gpu_mod.GPU, lights: []const map.Light) !void {
    var faces: [light_layers][16]f32 = std.mem.zeroes([light_layers][16]f32);
    var layers: usize = 0;
    for (lights) |l| {
        if (l.shadow == 0 or l.shadow > map.max_lights) continue;
        const slot: usize = l.shadow - 1;
        for (0..6) |f| faces[slot * 6 + f] = lightFace(l, f).data;
        layers = @max(layers, slot * 6 + 6);
    }
    if (layers == 0) return;
    gpu.writeBuffer(light_face_buf, 0, std.mem.sliceAsBytes(faces[0..layers]));
    const encoder = try gpu.createCommandEncoder();
    for (0..layers) |i| {
        const pass = try encoder.beginRenderPass(.{
            .color_attachments = &.{},
            .depth_stencil_attachment = .{ .view = &light_layer_views[i], .depth_load_op = .clear, .depth_store_op = .store, .depth_clear_value = 1.0, .stencil_read_only = true },
        });
        pass.setPipeline(light_shadow_pipe);
        pass.setBindGroup(0, light_shadow_bg);
        pass.setVertexBuffer(0, static_vb, 0, static_count * @sizeOf(mesh.Vertex));
        // The instance index selects the face matrix in the shader.
        pass.draw(static_count, 1, 0, @intCast(i));
        pass.end();
    }
    const cmd = try encoder.finish();
    gpu.submit(&[_]T.CommandBuffer{cmd});
}

/// Draw your body into the six light shadow layers of each of its `n`
/// lights. The face matrices are in light_face_buf already.
fn drawBodyShadows(encoder: anytype, body: Body, n: usize, dyn_count: u32) !void {
    for (0..n * 6) |i| {
        const layer = map.max_lights * 6 + i;
        const pass = try encoder.beginRenderPass(.{
            .color_attachments = &.{},
            .depth_stencil_attachment = .{ .view = &light_layer_views[layer], .depth_load_op = .clear, .depth_store_op = .store, .depth_clear_value = 1.0, .stencil_read_only = true },
        });
        pass.setPipeline(light_shadow_pipe);
        pass.setBindGroup(0, light_shadow_bg);
        pass.setVertexBuffer(0, dyn_vb, 0, dyn_count * @sizeOf(mesh.Vertex));
        // The instance index selects the face matrix in the shader.
        pass.draw(body.count, 1, body.first, @intCast(layer));
        pass.end();
    }
}

/// The map lights (with a shadow map) that light your body, nearest first:
/// at most body_lights of them. Returns the count.
fn pickBodyLights(lights: []const map.Light, centre: V3, out: *[body_lights]usize) usize {
    var dist: [body_lights]f32 = undefined;
    var n: usize = 0;
    for (lights, 0..) |l, i| {
        if (l.shadow == 0) continue;
        const d = vec.len(l.pos - centre);
        // The body is about 1 m from its centre to its feet and head.
        if (d > l.radius + 1) continue;
        // Insert in order of distance. The farthest falls off the end.
        var at = n;
        while (at > 0 and dist[at - 1] > d) : (at -= 1) {
            if (at < body_lights) {
                dist[at] = dist[at - 1];
                out[at] = out[at - 1];
            }
        }
        if (at < body_lights) {
            dist[at] = d;
            out[at] = i;
        }
        n = @min(n + 1, body_lights);
    }
    return n;
}

/// Upload the ambient-occlusion boxes near the eye. The lifts move, so
/// each frame does. Only boxes within 45 m count: the shader loops over
/// all of them for each pixel.
fn uploadBoxes(gpu: *gpu_mod.GPU, eye: V3) u32 {
    var data: [map.max_boxes][8]f32 = undefined;
    var n: usize = 0;
    for (map.boxes[0..map.box_count]) |b| {
        if (!b.ao) continue;
        const q = @max(b.min - eye, eye - b.max);
        const out = @max(q, vec.s(0));
        if (vec.dot(out, out) > 45 * 45) continue;
        data[n] = .{ b.min[0], b.min[1], b.min[2], 0, b.max[0], b.max[1], b.max[2], 0 };
        n += 1;
    }
    if (n > 0) gpu.writeBuffer(box_buf, 0, std.mem.sliceAsBytes(data[0..n]));
    return @intCast(n);
}

pub fn init(gpu: *gpu_mod.GPU) !void {
    scene_ubo = try gpu.createBuffer(.{ .size = @sizeOf(SceneUniforms), .usage = .{ .uniform = true, .copy_dst = true } });
    box_buf = try gpu.createBuffer(.{ .size = map.max_boxes * 32, .usage = .{ .storage = true, .copy_dst = true } });
    for (&post_ubo) |*b| b.* = try gpu.createBuffer(.{ .size = 256, .usage = .{ .uniform = true, .copy_dst = true } });
    dyn_vb = try gpu.createBuffer(.{ .size = max_dynamic * @sizeOf(mesh.Vertex), .usage = .{ .vertex = true, .copy_dst = true } });
    trans_vb = try gpu.createBuffer(.{ .size = max_translucent * @sizeOf(mesh.Vertex), .usage = .{ .vertex = true, .copy_dst = true } });

    const shadow_tex = try gpu.createTexture(.{
        .size = .{ .width = shadow_size, .height = shadow_size, .depth_or_array_layers = 1 },
        .format = depth_format,
        .usage = .{ .render_attachment = true, .texture_binding = true },
    });
    shadow_view = try shadow_tex.createView(.{});
    const light_tex = try gpu.createTexture(.{
        .size = .{ .width = light_shadow_size, .height = light_shadow_size, .depth_or_array_layers = light_layers },
        .format = depth_format,
        .usage = .{ .render_attachment = true, .texture_binding = true },
    });
    // No dimension given: a texture with more than one layer gives a 2D
    // array view, also for the one-layer views.
    light_shadow_view = try light_tex.createView(.{});
    for (&light_layer_views, 0..) |*v, i| v.* = try light_tex.createView(.{ .base_array_layer = @intCast(i), .array_layer_count = 1 });
    light_face_buf = try gpu.createBuffer(.{ .size = light_layers * 64, .usage = .{ .storage = true, .copy_dst = true } });
    linear_smp = try gpu.createSampler(.{ .mag_filter = .linear, .min_filter = .linear });
    shadow_smp = try gpu.createSampler(.{ .mag_filter = .linear, .min_filter = .linear, .compare = .less_equal });

    // Bind group layouts.
    scene_bgl = try gpu.createBindGroupLayout(.{ .entries = &[_]T.BindGroupLayoutEntry{
        .{ .binding = 0, .visibility = .{ .vertex = true, .fragment = true }, .buffer = .{ .type = .uniform } },
        .{ .binding = 1, .visibility = .{ .fragment = true }, .buffer = .{ .type = .read_only_storage } },
        .{ .binding = 2, .visibility = .{ .fragment = true }, .texture = .{ .sample_type = .depth } },
        .{ .binding = 3, .visibility = .{ .fragment = true }, .sampler = .{ .type = .comparison } },
        .{ .binding = 4, .visibility = .{ .fragment = true }, .texture = .{ .sample_type = .depth, .view_dimension = .@"2d-array" } },
    } });
    shadow_bgl = try gpu.createBindGroupLayout(.{ .entries = &[_]T.BindGroupLayoutEntry{
        .{ .binding = 0, .visibility = .{ .vertex = true, .fragment = true }, .buffer = .{ .type = .uniform } },
    } });
    // The light shadow pass reads only the face matrices (binding 5). The
    // scene pass calculates the same projection in the shader.
    light_shadow_bgl = try gpu.createBindGroupLayout(.{ .entries = &[_]T.BindGroupLayoutEntry{
        .{ .binding = 5, .visibility = .{ .vertex = true }, .buffer = .{ .type = .read_only_storage } },
    } });
    post_bgl = try gpu.createBindGroupLayout(.{ .entries = &[_]T.BindGroupLayoutEntry{
        .{ .binding = 0, .visibility = .{ .fragment = true }, .buffer = .{ .type = .uniform } },
        .{ .binding = 1, .visibility = .{ .fragment = true }, .texture = .{} },
        .{ .binding = 2, .visibility = .{ .fragment = true }, .sampler = .{} },
        .{ .binding = 3, .visibility = .{ .fragment = true }, .texture = .{} },
    } });

    scene_bg = try gpu.createBindGroup(.{ .layout = &scene_bgl, .entries = &[_]gpu_mod.BindGroupEntry{
        .{ .binding = 0, .buffer = &scene_ubo, .size = @sizeOf(SceneUniforms) },
        .{ .binding = 1, .buffer = &box_buf, .size = map.max_boxes * 32 },
        .{ .binding = 2, .texture_view = &shadow_view },
        .{ .binding = 3, .sampler = &shadow_smp },
        .{ .binding = 4, .texture_view = &light_shadow_view },
    } });
    shadow_bg = try gpu.createBindGroup(.{ .layout = &shadow_bgl, .entries = &[_]gpu_mod.BindGroupEntry{
        .{ .binding = 0, .buffer = &scene_ubo, .size = @sizeOf(SceneUniforms) },
    } });
    light_shadow_bg = try gpu.createBindGroup(.{ .layout = &light_shadow_bgl, .entries = &[_]gpu_mod.BindGroupEntry{
        .{ .binding = 5, .buffer = &light_face_buf, .size = light_layers * 64 },
    } });

    var scene_layout = try gpu.createPipelineLayout(.{ .bind_group_layouts = &[_]*gpu_mod.BindGroupLayout{&scene_bgl} });
    var shadow_layout = try gpu.createPipelineLayout(.{ .bind_group_layouts = &[_]*gpu_mod.BindGroupLayout{&shadow_bgl} });
    var light_shadow_layout = try gpu.createPipelineLayout(.{ .bind_group_layouts = &[_]*gpu_mod.BindGroupLayout{&light_shadow_bgl} });
    var post_layout = try gpu.createPipelineLayout(.{ .bind_group_layouts = &[_]*gpu_mod.BindGroupLayout{&post_bgl} });

    var scene_mod = try gpu.createShaderModule(.{ .code = scene_src });
    var post_mod = try gpu.createShaderModule(.{ .code = post_src });

    const no_cull: T.PrimitiveState = .{ .topology = .triangle_list, .front_face = .ccw, .cull_mode = .none };
    const ms: T.MultisampleState = .{ .count = msaa, .mask = 0xFFFFFFFF, .alpha_to_coverage_enabled = false };
    const single: T.MultisampleState = .{ .count = 1, .mask = 0xFFFFFFFF, .alpha_to_coverage_enabled = false };

    scene_pipe = try gpu.createRenderPipeline(.{
        .layout = &scene_layout,
        .vertex = .{ .module = &scene_mod, .entry_point = "vs_main", .buffers = &vertex_layout },
        .fragment = .{ .module = &scene_mod, .entry_point = "fs_main", .targets = &[_]T.ColorTargetState{.{ .format = hdr_format }} },
        .primitive = no_cull,
        .depth_stencil = .{ .format = depth_format, .depth_write_enabled = true, .depth_compare = .less },
        .multisample = ms,
    });
    sky_pipe = try gpu.createRenderPipeline(.{
        .layout = &scene_layout,
        .vertex = .{ .module = &scene_mod, .entry_point = "vs_sky" },
        .fragment = .{ .module = &scene_mod, .entry_point = "fs_sky", .targets = &[_]T.ColorTargetState{.{ .format = hdr_format }} },
        .primitive = no_cull,
        .depth_stencil = .{ .format = depth_format, .depth_write_enabled = false, .depth_compare = .less_equal },
        .multisample = ms,
    });
    // Straight alpha blending: out = src * src.a + dst * (1 - src.a).
    const alpha_blend: T.BlendState = .{
        .color = .{ .operation = .add, .src_factor = .src_alpha, .dst_factor = .one_minus_src_alpha },
        .alpha = .{ .operation = .add, .src_factor = .one, .dst_factor = .one_minus_src_alpha },
    };
    trans_pipe = try gpu.createRenderPipeline(.{
        .layout = &scene_layout,
        .vertex = .{ .module = &scene_mod, .entry_point = "vs_trans", .buffers = &vertex_layout },
        .fragment = .{ .module = &scene_mod, .entry_point = "fs_trans", .targets = &[_]T.ColorTargetState{.{ .format = hdr_format, .blend = alpha_blend }} },
        .primitive = no_cull,
        .depth_stencil = .{ .format = depth_format, .depth_write_enabled = false, .depth_compare = .less },
        .multisample = ms,
    });
    shadow_pipe = try gpu.createRenderPipeline(.{
        .layout = &shadow_layout,
        .vertex = .{ .module = &scene_mod, .entry_point = "vs_shadow", .buffers = &vertex_layout },
        .primitive = no_cull,
        .depth_stencil = .{ .format = depth_format, .depth_write_enabled = true, .depth_compare = .less },
        .multisample = single,
    });
    light_shadow_pipe = try gpu.createRenderPipeline(.{
        .layout = &light_shadow_layout,
        .vertex = .{ .module = &scene_mod, .entry_point = "vs_light_shadow", .buffers = &vertex_layout },
        .primitive = no_cull,
        .depth_stencil = .{ .format = depth_format, .depth_write_enabled = true, .depth_compare = .less },
        .multisample = single,
    });
    bright_pipe = try postPipeline(gpu, &post_layout, &post_mod, "fs_bright", hdr_format);
    blur_pipe = try postPipeline(gpu, &post_layout, &post_mod, "fs_blur", hdr_format);
    final_pipe = try postPipeline(gpu, &post_layout, &post_mod, "fs_final", swap_format);
    ready = true;
}

fn postPipeline(gpu: *gpu_mod.GPU, layout: *sw.gpu_types.PipelineLayout, module: *gpu_mod.ShaderModule, entry: []const u8, format: T.TextureFormat) !T.RenderPipeline {
    return gpu.createRenderPipeline(.{
        .layout = layout,
        .vertex = .{ .module = module, .entry_point = "vs_full" },
        .fragment = .{ .module = module, .entry_point = entry, .targets = &[_]T.ColorTargetState{.{ .format = format }} },
        .primitive = .{ .topology = .triangle_list, .front_face = .ccw, .cull_mode = .none },
        .multisample = .{ .count = 1, .mask = 0xFFFFFFFF, .alpha_to_coverage_enabled = false },
    });
}

fn makeTarget(gpu: *gpu_mod.GPU, w: u32, h: u32, format: T.TextureFormat, samples: u32, sampled: bool) !gpu_mod.Texture {
    return gpu.createTexture(.{
        .size = .{ .width = w, .height = h, .depth_or_array_layers = 1 },
        .format = format,
        .sample_count = samples,
        .usage = .{ .render_attachment = true, .texture_binding = sampled },
    });
}

fn resize(gpu: *gpu_mod.GPU, w: u32, h: u32) !void {
    if (targets.w == w and targets.h == h) return;
    inline for (.{ "hdr_msaa", "hdr", "depth", "bloom_a", "bloom_b" }) |name| {
        if (@field(targets, name)) |t| t.destroy();
    }
    for (&post_bg) |*bg| {
        if (bg.*) |g| g.release();
        bg.* = null;
    }
    const bw = @max(1, w / 4);
    const bh = @max(1, h / 4);
    targets.w = w;
    targets.h = h;
    targets.hdr_msaa = try makeTarget(gpu, w, h, hdr_format, msaa, false);
    targets.hdr = try makeTarget(gpu, w, h, hdr_format, 1, true);
    targets.depth = try makeTarget(gpu, w, h, depth_format, msaa, false);
    targets.bloom_a = try makeTarget(gpu, bw, bh, hdr_format, 1, true);
    targets.bloom_b = try makeTarget(gpu, bw, bh, hdr_format, 1, true);
    targets.hdr_msaa_v = try targets.hdr_msaa.?.createView(.{});
    targets.hdr_v = try targets.hdr.?.createView(.{});
    targets.depth_v = try targets.depth.?.createView(.{});
    targets.bloom_a_v = try targets.bloom_a.?.createView(.{});
    targets.bloom_b_v = try targets.bloom_b.?.createView(.{});

    // 0 bright (hdr -> a), 1 blur x (a -> b), 2 blur y (b -> a), 3 final.
    const srcs = [4]*gpu_mod.TextureView{ &targets.hdr_v, &targets.bloom_a_v, &targets.bloom_b_v, &targets.hdr_v };
    const extra = [4]*gpu_mod.TextureView{ &targets.hdr_v, &targets.bloom_a_v, &targets.bloom_b_v, &targets.bloom_a_v };
    for (0..4) |i| {
        post_bg[i] = try gpu.createBindGroup(.{ .layout = &post_bgl, .entries = &[_]gpu_mod.BindGroupEntry{
            .{ .binding = 0, .buffer = &post_ubo[i], .size = @sizeOf(PostUniforms) },
            .{ .binding = 1, .texture_view = srcs[i] },
            .{ .binding = 2, .sampler = &linear_smp },
            .{ .binding = 3, .texture_view = extra[i] },
        } });
    }
}

fn ortho(l: f32, r: f32, b: f32, t: f32, n: f32, f: f32) Mat4 {
    return .{ .data = .{
        2 / (r - l),        0,                  0,            0,
        0,                  2 / (t - b),        0,            0,
        0,                  0,                  -1 / (f - n), 0,
        -(r + l) / (r - l), -(t + b) / (t - b), -n / (f - n), 1,
    } };
}

pub fn invert(m: Mat4) Mat4 {
    const a = m.data;
    var inv: [16]f32 = undefined;
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    const k = if (@abs(det) > 1e-12) 1.0 / det else 0;
    for (&inv) |*x| x.* *= k;
    return .{ .data = inv };
}

/// The camera view matrix for a yaw, pitch and roll.
pub fn viewMatrix(eye: V3, yaw: f32, pitch: f32, roll: f32) Mat4 {
    // The inverse of translate(eye) * rotY(yaw) * rotX(pitch) * rotZ(roll).
    return Mat4.rotationZ(-roll).mul(Mat4.rotationX(-pitch).mul(Mat4.rotationY(-yaw).mul(vec.translate(-eye))));
}

pub fn draw(ctx: *sw.Context, p: FrameParams, dynamic: []const mesh.Vertex, hud: ?*gfx.Renderer) !void {
    const gpu = ctx.gpu();
    if (!ready) return;
    const win = ctx.window();
    // The 3D passes run at most 1.35 times the CSS pixel size. The final
    // pass scales the result up to the full canvas.
    const scale = @min(1.0, 1.35 / @max(win.dpi_scale, 0.5));
    const w: u32 = @max(1, @as(u32, @intFromFloat(@as(f32, @floatFromInt(win.width)) * scale)));
    const h: u32 = @max(1, @as(u32, @intFromFloat(@as(f32, @floatFromInt(win.height)) * scale)));
    try resize(gpu, w, h);
    scene_w = w;
    scene_h = h;

    const aspect = @as(f32, @floatFromInt(w)) / @as(f32, @floatFromInt(h));
    const proj = @import("sw_math").perspective(p.fov, aspect, 0.04, 260);
    const view_proj = proj.mul(viewMatrix(p.eye, p.yaw, p.pitch, p.roll));
    const c = map.shadow_centre;
    const light_view = @import("sw_math").lookAt(
        .{ .x = c[0] + sun_dir[0] * 110, .y = c[1] + sun_dir[1] * 110, .z = c[2] + sun_dir[2] * 110 },
        .{ .x = c[0], .y = c[1], .z = c[2] },
        .{ .x = 0, .y = 1, .z = 0 },
    );
    const sh = map.shadow_half;
    const light_vp = ortho(-sh, sh, -sh, sh, 10, 240).mul(light_view);

    var su = std.mem.zeroes(SceneUniforms);
    su.view_proj = view_proj.data;
    su.light_vp = light_vp.data;
    su.inv_vp = invert(view_proj).data;
    su.cam = .{ p.eye[0], p.eye[1], p.eye[2], p.time };
    su.sun_dir = .{ sun_dir[0], sun_dir[1], sun_dir[2], 0 };
    su.sun_col = .{ sun_col[0], sun_col[1], sun_col[2], 0 };
    const nl = @min(p.lights.len, max_lights);
    su.info = .{ @floatFromInt(uploadBoxes(gpu, p.eye)), @floatFromInt(nl), 0.0045, 1 };
    su.info2 = .{ map.underground_y, 1, 0, 0 };
    su.sealed_lo = .{ map.sealed[0][0], map.sealed[0][1], map.sealed[0][2], 0 };
    su.sealed_hi = .{ map.sealed[1][0], map.sealed[1][1], map.sealed[1][2], 0 };
    for (p.lights[0..nl], 0..) |l, i| {
        su.lp[i] = .{ l.pos[0], l.pos[1], l.pos[2], l.radius };
        su.lc[i] = .{ l.color[0], l.color[1], l.color[2], @floatFromInt(l.shadow) };
    }
    const dyn_count: u32 = @intCast(@min(dynamic.len, max_dynamic));
    var body = p.body;
    body.count = @min(body.count, dyn_count -| body.first);
    var body_l: [body_lights]usize = undefined;
    const body_n = if (body.count > 0) pickBodyLights(p.lights[0..nl], body.centre, &body_l) else 0;
    if (body_n > 0) {
        var faces: [body_lights * 6][16]f32 = undefined;
        for (body_l[0..body_n], 0..) |li, d| {
            su.body_l[d] = @floatFromInt(li + 1);
            for (0..6) |f| faces[d * 6 + f] = lightFace(p.lights[li], f).data;
        }
        gpu.writeBuffer(light_face_buf, map.max_lights * 6 * 64, std.mem.sliceAsBytes(faces[0 .. body_n * 6]));
    }
    gpu.writeBuffer(scene_ubo, 0, std.mem.asBytes(&su));

    if (dyn_count > 0) gpu.writeBuffer(dyn_vb, 0, std.mem.sliceAsBytes(dynamic[0..dyn_count]));
    const trans_count: u32 = @intCast(@min(p.translucent.len, max_translucent));
    if (trans_count > 0) gpu.writeBuffer(trans_vb, 0, std.mem.sliceAsBytes(p.translucent[0..trans_count]));

    const bw: f32 = @floatFromInt(@max(1, w / 4));
    const bh: f32 = @floatFromInt(@max(1, h / 4));
    const fw: f32 = @floatFromInt(w);
    const fh: f32 = @floatFromInt(h);
    const posts = [4]PostUniforms{
        .{ .texel = .{ 1 / fw, 1 / fh }, .dir = .{ 0, 0 }, .exposure = 1, .damage = 0, .time = 0, .bloom = 0 },
        .{ .texel = .{ 1 / bw, 1 / bh }, .dir = .{ 1, 0 }, .exposure = 1, .damage = 0, .time = 0, .bloom = 0 },
        .{ .texel = .{ 1 / bw, 1 / bh }, .dir = .{ 0, 1 }, .exposure = 1, .damage = 0, .time = 0, .bloom = 0 },
        .{ .texel = .{ 1 / fw, 1 / fh }, .dir = .{ 0, 0 }, .exposure = p.exposure, .damage = p.damage, .time = @mod(p.time, 100), .bloom = 0.55 },
    };
    for (posts, 0..) |pu, i| gpu.writeBuffer(post_ubo[i], 0, std.mem.asBytes(&pu));

    const encoder = try gpu.createCommandEncoder();

    try drawBodyShadows(encoder, body, body_n, dyn_count);
    // Shadow pass.
    {
        const pass = try encoder.beginRenderPass(.{
            .color_attachments = &.{},
            .depth_stencil_attachment = .{ .view = &shadow_view, .depth_load_op = .clear, .depth_store_op = .store, .depth_clear_value = 1.0, .stencil_read_only = true },
        });
        pass.setPipeline(shadow_pipe);
        pass.setBindGroup(0, shadow_bg);
        pass.setVertexBuffer(0, static_vb, 0, static_count * @sizeOf(mesh.Vertex));
        pass.draw(static_count, 1, 0, 0);
        if (dyn_count > 0) {
            pass.setVertexBuffer(0, dyn_vb, 0, dyn_count * @sizeOf(mesh.Vertex));
            pass.draw(dyn_count, 1, 0, 0);
        }
        pass.end();
    }
    // Scene pass.
    {
        const pass = try encoder.beginRenderPass(.{
            .color_attachments = &[_]gpu_mod.RenderPassColorAttachment{.{
                .view = &targets.hdr_msaa_v,
                .resolve_target = &targets.hdr_v,
                .load_op = .clear,
                .store_op = .discard,
                .clear_value = .{ .r = 0, .g = 0, .b = 0, .a = 1 },
            }},
            .depth_stencil_attachment = .{ .view = &targets.depth_v, .depth_load_op = .clear, .depth_store_op = .discard, .depth_clear_value = 1.0, .stencil_read_only = true },
        });
        pass.setPipeline(scene_pipe);
        pass.setBindGroup(0, scene_bg);
        pass.setVertexBuffer(0, static_vb, 0, static_count * @sizeOf(mesh.Vertex));
        pass.draw(static_count, 1, 0, 0);
        if (dyn_count > 0) {
            pass.setVertexBuffer(0, dyn_vb, 0, dyn_count * @sizeOf(mesh.Vertex));
            pass.draw(dyn_count, 1, 0, 0);
        }
        pass.setPipeline(sky_pipe);
        pass.draw(3, 1, 0, 0);
        if (trans_count > 0) {
            pass.setPipeline(trans_pipe);
            pass.setVertexBuffer(0, trans_vb, 0, trans_count * @sizeOf(mesh.Vertex));
            pass.draw(trans_count, 1, 0, 0);
        }
        pass.end();
    }
    // Bloom.
    const bloom_targets = [3]*gpu_mod.TextureView{ &targets.bloom_a_v, &targets.bloom_b_v, &targets.bloom_a_v };
    const bloom_pipes = [3]T.RenderPipeline{ bright_pipe, blur_pipe, blur_pipe };
    for (0..3) |i| {
        const pass = try encoder.beginRenderPass(.{ .color_attachments = &[_]gpu_mod.RenderPassColorAttachment{.{
            .view = bloom_targets[i],
            .load_op = .clear,
            .store_op = .store,
        }} });
        pass.setPipeline(bloom_pipes[i]);
        pass.setBindGroup(0, post_bg[i].?);
        pass.draw(3, 1, 0, 0);
        pass.end();
    }
    // Final pass and HUD.
    var swap = try gpu.getCurrentTextureView();
    {
        const pass = try encoder.beginRenderPass(.{ .color_attachments = &[_]gpu_mod.RenderPassColorAttachment{.{
            .view = &swap,
            .load_op = .clear,
            .store_op = .store,
        }} });
        pass.setPipeline(final_pipe);
        pass.setBindGroup(0, post_bg[3].?);
        pass.draw(3, 1, 0, 0);
        if (hud) |r| try r.flush(pass);
        pass.end();
    }
    const cmd = try encoder.finish();
    gpu.submit(&[_]T.CommandBuffer{cmd});
    swap.release();
    gpu.present();
}
