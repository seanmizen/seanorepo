//! A small PNG writer for XRGB8888 pixels: 8-bit RGB, no compression
//! (deflate "stored" blocks). Used for snapshots in tests and in the docs.

const std = @import("std");

pub fn write(w: *std.Io.Writer, pixels: []const u32, width: u32, height: u32, stride: u32) !void {
    try w.writeAll("\x89PNG\r\n\x1a\n");

    var ihdr: [13]u8 = undefined;
    std.mem.writeInt(u32, ihdr[0..4], width, .big);
    std.mem.writeInt(u32, ihdr[4..8], height, .big);
    ihdr[8..13].* = .{ 8, 2, 0, 0, 0 }; // 8 bit, RGB, deflate, filter 0, no interlace
    try chunk(w, "IHDR", &.{&ihdr});

    // The zlib stream, one row per stored block. A row of RGB pixels with
    // its filter byte must fit in 65535 bytes: width <= 21844.
    const row_len = 1 + width * 3;
    if (row_len > 0xffff) return error.ImageTooWide;
    const block_len = 5 + row_len;
    const idat_len = 2 + height * block_len + 4;

    var len_be: [4]u8 = undefined;
    std.mem.writeInt(u32, &len_be, idat_len, .big);
    try w.writeAll(&len_be);
    var crc = std.hash.Crc32.init();
    try both(w, &crc, "IDAT");
    try both(w, &crc, &.{ 0x78, 0x01 });

    var a: u32 = 1;
    var b: u32 = 0;
    var row: [1 + 3 * 4096]u8 = undefined;
    if (row_len > row.len) return error.ImageTooWide;
    var y: u32 = 0;
    while (y < height) : (y += 1) {
        const last: u8 = @intFromBool(y + 1 == height);
        var hdr: [5]u8 = .{ last, 0, 0, 0, 0 };
        std.mem.writeInt(u16, hdr[1..3], @intCast(row_len), .little);
        std.mem.writeInt(u16, hdr[3..5], @intCast(~@as(u16, @intCast(row_len))), .little);
        try both(w, &crc, &hdr);
        row[0] = 0;
        for (0..width) |x| {
            const p = pixels[y * stride + x];
            row[1 + x * 3 ..][0..3].* = .{ @truncate(p >> 16), @truncate(p >> 8), @truncate(p) };
        }
        for (row[0..row_len]) |byte| {
            a = (a + byte) % 65521;
            b = (b + a) % 65521;
        }
        try both(w, &crc, row[0..row_len]);
    }
    var adler: [4]u8 = undefined;
    std.mem.writeInt(u32, &adler, (b << 16) | a, .big);
    try both(w, &crc, &adler);
    var crc_be: [4]u8 = undefined;
    std.mem.writeInt(u32, &crc_be, crc.final(), .big);
    try w.writeAll(&crc_be);

    try chunk(w, "IEND", &.{});
}

fn both(w: *std.Io.Writer, crc: *std.hash.Crc32, bytes: []const u8) !void {
    crc.update(bytes);
    try w.writeAll(bytes);
}

fn chunk(w: *std.Io.Writer, kind: *const [4]u8, parts: []const []const u8) !void {
    var len: u32 = 0;
    for (parts) |p| len += @intCast(p.len);
    var len_be: [4]u8 = undefined;
    std.mem.writeInt(u32, &len_be, len, .big);
    try w.writeAll(&len_be);
    var crc = std.hash.Crc32.init();
    try both(w, &crc, kind);
    for (parts) |p| try both(w, &crc, p);
    var crc_be: [4]u8 = undefined;
    std.mem.writeInt(u32, &crc_be, crc.final(), .big);
    try w.writeAll(&crc_be);
}
