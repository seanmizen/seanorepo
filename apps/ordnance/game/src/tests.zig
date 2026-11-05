//! The native tests: `zig build test`.
test {
    _ = @import("core/map.zig");
    _ = @import("core/route.zig");
    _ = @import("core/mapgen.zig");
    _ = @import("core/sim_test.zig");
    _ = @import("render/terrain.zig");
    _ = @import("ui/wm.zig");
}
