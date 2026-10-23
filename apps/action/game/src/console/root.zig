// The console framework: cvars, commands, binds, buttons, scripts, the
// saved config, the completion and the console panel. console.zig has the
// start order. The game imports this file only.
//
// Nothing here imports the action game. The core (all files but view.zig)
// needs std and sw_core. view.zig also needs sw_gfx2d and sw_text.
pub const parse = @import("parse.zig");
pub const cvar = @import("cvar.zig");
pub const keys = @import("keys.zig");
pub const line = @import("line.zig");
pub const editor = @import("editor.zig");
pub const complete = @import("complete.zig");
pub const prompt = @import("prompt.zig");
pub const schema = @import("schema.zig");
pub const view = @import("view.zig");
const console = @import("console.zig");
const buttons = @import("buttons.zig");

pub const Console = console.Console;
pub const Command = console.Command;
pub const Source = console.Source;
pub const Store = console.Store;
pub const DefaultBind = console.DefaultBind;
pub const LineKind = console.LineKind;
pub const Cvar = cvar.Cvar;
pub const Def = cvar.Def;
pub const Value = cvar.Value;
pub const Flags = cvar.Flags;
pub const Args = parse.Args;
pub const Buttons = buttons.Buttons;
pub const View = view.View;
