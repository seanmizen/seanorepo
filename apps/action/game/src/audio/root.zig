// Procedural bullet sounds: the near miss (a crack or a whiz) and the
// impact on a surface material, placed in the space around the listener.
// Each function writes stereo samples into a caller buffer. The caller
// plays them (sw_audio Audio.playBuffer).
//
// Nothing here imports the action game: it needs std only, so another game
// can use it.
//   dsp.zig        noise, filters, modes, grains
//   space.zig      the listener, the head, the path, the room
//   near_miss.zig  the Mach cone and the N-wave (supersonic), the whiz
//                  with its Doppler shift (subsonic)
//   impact.zig     the surface materials and their impact sounds
pub const dsp = @import("dsp.zig");
pub const space = @import("space.zig");
pub const near_miss = @import("near_miss.zig");
pub const impact = @import("impact.zig");

pub const Rng = dsp.Rng;
pub const rate = dsp.rate;
pub const V3 = space.V3;
pub const Listener = space.Listener;
pub const Plane = space.Plane;
pub const Room = space.Room;
pub const Out = space.Out;
pub const Material = impact.Material;
pub const Bullet = near_miss.Bullet;
