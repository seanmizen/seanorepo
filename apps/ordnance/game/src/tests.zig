//! The native tests: `zig build test`.
test {
    _ = @import("sim_test.zig");
    _ = @import("terrain.zig");
    _ = @import("wm.zig");
}
