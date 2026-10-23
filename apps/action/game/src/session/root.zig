// The session layer of an online game: who the server is (ident.zig), and
// the connection as a state machine with a capped retry wait
// (session.zig). The server half is apps/action/server/session.ts.
//
// Nothing here imports the action game. ident.zig needs std. session.zig
// also needs the console framework (../console/) for the command
// "version". The game imports this file only.
pub const ident = @import("ident.zig");
pub const session = @import("session.zig");

pub const Ident = ident.Ident;
pub const Local = ident.Local;
pub const Verdict = ident.Verdict;
pub const compare = ident.compare;
pub const Session = session.Session;
pub const State = session.State;
pub const Socket = session.Socket;
pub const Step = session.Step;
pub const retryDelay = session.retryDelay;
pub const verdictText = session.verdictText;
