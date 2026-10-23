// The vault: Space while walking forward into a waist-high shape puts the
// feet on top of it (main.zig gameplayTick). A vault onto the ticket gates
// is a fare dodge (gates.onGates).
//
// - The top of the shape is 0.5 to 1.4 m over the feet, in reach, with room
//   for the body on it and over the start at the top height.
// - The feet go over the middle of a thin shape (a railing), or 0.35 m past
//   the edge of a wide one.
// - The feet go up first, then along onto the top, in `time` seconds.
//
// The module has no input and no sound, so vault_test.zig runs it natively.
const vec = @import("vec.zig");
const map = @import("map.zig");
const player = @import("player.zig");
const V3 = vec.V3;
const v3 = vec.v3;

/// The time of a vault in seconds.
pub const time: f32 = 0.45;

/// A vault in progress: the feet at the start and on top, and the progress
/// (0 to 1).
pub const Vault = struct {
    from: V3,
    to: V3,
    k: f32 = 0,

    /// One tick of the vault. Returns true at the end: the feet are on top
    /// and on the ground.
    pub fn step(self: *Vault, p: *player.Player, dt: f32) bool {
        self.k = @min(1, self.k + dt / time);
        const up = vec.smooth(self.k / 0.55);
        const along = vec.smooth((self.k - 0.3) / 0.7);
        const a = self.from;
        const b = self.to;
        p.pos = v3(a[0] + (b[0] - a[0]) * along, a[1] + (b[1] - a[1]) * up, a[2] + (b[2] - a[2]) * along);
        p.vel = v3(0, 0, 0);
        if (self.k < 1) return false;
        p.pos = b;
        p.grounded = true;
        return true;
    }
};

/// The feet on top of a shape in front of the player, for a vault. Null
/// when there is nothing to vault.
pub fn find(p: player.Player) ?V3 {
    const f = v3(-@sin(p.yaw), 0, -@cos(p.yaw));
    const r = player.radius;
    var top: ?f32 = null;
    var d0: f32 = 0;
    var d1: f32 = 0;
    var d: f32 = 0.1;
    while (d < r + 1.0) : (d += 0.04) {
        const q = p.pos + f * vec.s(d);
        const t = map.floorTop(v3(q[0] - 0.03, p.pos[1] + 0.5, q[2] - 0.03), v3(q[0] + 0.03, p.pos[1] + 1.4, q[2] + 0.03));
        if (top) |t0| {
            if (t == null or @abs(t.? - t0) > 0.05) break;
            d1 = d;
        } else if (t) |tt| {
            top = tt;
            d0 = d;
            d1 = d;
        } else if (d > r + 0.4) return null;
    }
    const y0 = top orelse return null;
    const at = p.pos + f * vec.s(@min((d0 + d1) / 2, d0 + 0.35));
    // The feet go on the highest top under the body, in the vault range:
    // the closed paddles and the screens of the gates are higher than the
    // cabinet tops.
    const y = map.floorTop(v3(at[0] - r, y0, at[2] - r), v3(at[0] + r, p.pos[1] + 1.4, at[2] + r)) orelse y0;
    const to = v3(at[0], y + 0.002, at[2]);
    // Room for the body on top, and over the start at the top height.
    if (map.overlaps(to + v3(-r, 0.01, -r), to + v3(r, player.height, r))) return null;
    const up = y - p.pos[1];
    if (map.overlaps(p.pos + v3(-r, up + 0.01, -r), p.pos + v3(r, up + player.height, r))) return null;
    return to;
}
