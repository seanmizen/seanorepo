//! A DRM dumb buffer on the first connected output (simpledrm: the firmware
//! framebuffer). The structs are the kernel's uapi (include/uapi/drm/).
//!
//! The daemon draws the whole picture into the buffer first, and only then
//! sets the mode. So the screen goes from the kernel's picture to the
//! daemon's picture with no black frame between them.

const std = @import("std");
const linux = std.os.linux;

fn iowr(nr: u8, size: usize) u32 {
    return (3 << 30) | (@as(u32, @intCast(size)) << 16) | ('d' << 8) | nr;
}

const CardRes = extern struct {
    fb_id_ptr: u64 = 0,
    crtc_id_ptr: u64 = 0,
    connector_id_ptr: u64 = 0,
    encoder_id_ptr: u64 = 0,
    count_fbs: u32 = 0,
    count_crtcs: u32 = 0,
    count_connectors: u32 = 0,
    count_encoders: u32 = 0,
    min_width: u32 = 0,
    max_width: u32 = 0,
    min_height: u32 = 0,
    max_height: u32 = 0,
};

pub const ModeInfo = extern struct {
    clock: u32 = 0,
    hdisplay: u16 = 0,
    hsync_start: u16 = 0,
    hsync_end: u16 = 0,
    htotal: u16 = 0,
    hskew: u16 = 0,
    vdisplay: u16 = 0,
    vsync_start: u16 = 0,
    vsync_end: u16 = 0,
    vtotal: u16 = 0,
    vscan: u16 = 0,
    vrefresh: u32 = 0,
    flags: u32 = 0,
    type: u32 = 0,
    name: [32]u8 = @splat(0),
};

const GetConnector = extern struct {
    encoders_ptr: u64 = 0,
    modes_ptr: u64 = 0,
    props_ptr: u64 = 0,
    prop_values_ptr: u64 = 0,
    count_modes: u32 = 0,
    count_props: u32 = 0,
    count_encoders: u32 = 0,
    encoder_id: u32 = 0,
    connector_id: u32 = 0,
    connector_type: u32 = 0,
    connector_type_id: u32 = 0,
    connection: u32 = 0,
    mm_width: u32 = 0,
    mm_height: u32 = 0,
    subpixel: u32 = 0,
    pad: u32 = 0,
};

const GetEncoder = extern struct {
    encoder_id: u32 = 0,
    encoder_type: u32 = 0,
    crtc_id: u32 = 0,
    possible_crtcs: u32 = 0,
    possible_clones: u32 = 0,
};

const CreateDumb = extern struct {
    height: u32 = 0,
    width: u32 = 0,
    bpp: u32 = 0,
    flags: u32 = 0,
    handle: u32 = 0,
    pitch: u32 = 0,
    size: u64 = 0,
};

const FbCmd = extern struct {
    fb_id: u32 = 0,
    width: u32 = 0,
    height: u32 = 0,
    pitch: u32 = 0,
    bpp: u32 = 0,
    depth: u32 = 0,
    handle: u32 = 0,
};

const MapDumb = extern struct {
    handle: u32 = 0,
    pad: u32 = 0,
    offset: u64 = 0,
};

const Crtc = extern struct {
    set_connectors_ptr: u64 = 0,
    count_connectors: u32 = 0,
    crtc_id: u32 = 0,
    fb_id: u32 = 0,
    x: u32 = 0,
    y: u32 = 0,
    gamma_size: u32 = 0,
    mode_valid: u32 = 0,
    mode: ModeInfo = .{},
};

const DirtyCmd = extern struct {
    fb_id: u32 = 0,
    flags: u32 = 0,
    color: u32 = 0,
    num_clips: u32 = 0,
    clips_ptr: u64 = 0,
};

const ClipRect = extern struct { x1: u16, y1: u16, x2: u16, y2: u16 };

comptime {
    // The sizes of the uapi structs on x86_64.
    std.debug.assert(@sizeOf(CardRes) == 64);
    std.debug.assert(@sizeOf(ModeInfo) == 68);
    std.debug.assert(@sizeOf(GetConnector) == 80);
    std.debug.assert(@sizeOf(CreateDumb) == 32);
    std.debug.assert(@sizeOf(FbCmd) == 28);
    std.debug.assert(@sizeOf(Crtc) == 104);
    std.debug.assert(@sizeOf(DirtyCmd) == 24);
}

pub const Error = error{ NoDevice, Ioctl, NoOutput, Map };

fn ioctl(fd: i32, req: u32, arg: anytype) Error!void {
    while (true) {
        const rc = linux.ioctl(fd, req, @intFromPtr(arg));
        switch (linux.errno(rc)) {
            .SUCCESS => return,
            .INTR, .AGAIN => continue,
            else => return error.Ioctl,
        }
    }
}

pub const Output = struct {
    fd: i32,
    width: u32,
    height: u32,
    /// In pixels.
    stride: u32,
    pixels: []u32,
    fb_id: u32,
    crtc_id: u32,
    connector_id: u32,
    mode: ModeInfo,
    shown: bool = false,

    /// Open the card, find a connected output, and make a buffer. Nothing
    /// shows until show().
    pub fn open(path: [*:0]const u8) Error!Output {
        const rc = linux.open(path, .{ .ACCMODE = .RDWR, .CLOEXEC = true }, 0);
        if (linux.errno(rc) != .SUCCESS) return error.NoDevice;
        const fd: i32 = @intCast(rc);

        var res: CardRes = .{};
        try ioctl(fd, iowr(0xA0, @sizeOf(CardRes)), &res);
        var crtcs: [8]u32 = undefined;
        var conns: [8]u32 = undefined;
        var encs: [8]u32 = undefined;
        var fbs: [8]u32 = undefined;
        if (res.count_crtcs > 8 or res.count_connectors > 8 or res.count_encoders > 8 or res.count_fbs > 8) return error.NoOutput;
        res.crtc_id_ptr = @intFromPtr(&crtcs);
        res.connector_id_ptr = @intFromPtr(&conns);
        res.encoder_id_ptr = @intFromPtr(&encs);
        res.fb_id_ptr = @intFromPtr(&fbs);
        try ioctl(fd, iowr(0xA0, @sizeOf(CardRes)), &res);

        for (conns[0..res.count_connectors]) |cid| {
            var gc: GetConnector = .{ .connector_id = cid };
            try ioctl(fd, iowr(0xA7, @sizeOf(GetConnector)), &gc);
            if (gc.connection != 1 or gc.count_modes == 0) continue; // 1 = connected
            var modes: [16]ModeInfo = undefined;
            var props: [32]u32 = undefined;
            var values: [32]u64 = undefined;
            var cencs: [8]u32 = undefined;
            gc.count_modes = @min(gc.count_modes, 16);
            gc.count_props = @min(gc.count_props, 32);
            gc.count_encoders = @min(gc.count_encoders, 8);
            gc.modes_ptr = @intFromPtr(&modes);
            gc.props_ptr = @intFromPtr(&props);
            gc.prop_values_ptr = @intFromPtr(&values);
            gc.encoders_ptr = @intFromPtr(&cencs);
            try ioctl(fd, iowr(0xA7, @sizeOf(GetConnector)), &gc);

            var crtc_id: u32 = 0;
            if (gc.encoder_id != 0) {
                var ge: GetEncoder = .{ .encoder_id = gc.encoder_id };
                try ioctl(fd, iowr(0xA6, @sizeOf(GetEncoder)), &ge);
                crtc_id = ge.crtc_id;
            }
            if (crtc_id == 0 and res.count_crtcs > 0) crtc_id = crtcs[0];
            if (crtc_id == 0) continue;

            const mode = modes[0];
            var cd: CreateDumb = .{ .width = mode.hdisplay, .height = mode.vdisplay, .bpp = 32 };
            try ioctl(fd, iowr(0xB2, @sizeOf(CreateDumb)), &cd);
            var fb: FbCmd = .{ .width = cd.width, .height = cd.height, .pitch = cd.pitch, .bpp = 32, .depth = 24, .handle = cd.handle };
            try ioctl(fd, iowr(0xAE, @sizeOf(FbCmd)), &fb);
            var md: MapDumb = .{ .handle = cd.handle };
            try ioctl(fd, iowr(0xB3, @sizeOf(MapDumb)), &md);
            const addr = linux.mmap(null, cd.size, .{ .READ = true, .WRITE = true }, .{ .TYPE = .SHARED }, fd, @intCast(md.offset));
            if (linux.errno(addr) != .SUCCESS) return error.Map;
            const ptr: [*]u32 = @ptrFromInt(addr);
            return .{
                .fd = fd,
                .width = cd.width,
                .height = cd.height,
                .stride = cd.pitch / 4,
                .pixels = ptr[0 .. cd.size / 4],
                .fb_id = fb.fb_id,
                .crtc_id = crtc_id,
                .connector_id = cid,
                .mode = mode,
            };
        }
        return error.NoOutput;
    }

    /// Put the buffer on the screen (one time), then mark it dirty, so a
    /// shadow-buffer driver (simpledrm) copies it.
    pub fn present(o: *Output) Error!void {
        if (!o.shown) {
            var conn = o.connector_id;
            var c: Crtc = .{
                .set_connectors_ptr = @intFromPtr(&conn),
                .count_connectors = 1,
                .crtc_id = o.crtc_id,
                .fb_id = o.fb_id,
                .mode_valid = 1,
                .mode = o.mode,
            };
            try ioctl(o.fd, iowr(0xA2, @sizeOf(Crtc)), &c);
            o.shown = true;
        }
        var clip: ClipRect = .{ .x1 = 0, .y1 = 0, .x2 = @intCast(o.width), .y2 = @intCast(o.height) };
        var d: DirtyCmd = .{ .fb_id = o.fb_id, .num_clips = 1, .clips_ptr = @intFromPtr(&clip) };
        // A driver with no dirty hook returns an error: it shows the
        // buffer directly, so that is not a failure.
        ioctl(o.fd, iowr(0xB1, @sizeOf(DirtyCmd)), &d) catch {};
    }
};
