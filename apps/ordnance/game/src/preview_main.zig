//! The root of the native preview tool (tools/preview.zig). It sits in src/
//! so the tool can import each part of the game.
pub const main = @import("tools/preview.zig").main;
