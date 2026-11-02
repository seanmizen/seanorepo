//! bootmap: the boot as a live treemap. The modules that every target shares.

pub const treemap = @import("layout/treemap.zig");
pub const trace = @import("model/trace.zig");
pub const plan = @import("model/plan.zig");
pub const canvas = @import("render/canvas.zig");
pub const palette = @import("render/palette.zig");
pub const style = @import("render/style.zig");
pub const png = @import("render/png.zig");
pub const text = @import("render/text.zig");

test {
    _ = treemap;
    _ = trace;
    _ = plan;
    _ = canvas;
    _ = palette;
    _ = style;
    _ = png;
    _ = text;
}
