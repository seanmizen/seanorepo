//! The playstyles. Each style is one set of rule switches and numbers. The
//! simulation reads `Sim.rules`. A style changes no code path by itself:
//! each rule file checks the switch that it owns.
//!
//!   1 Supply Line  the base game: take the objective; artillery on the
//!                  roads that red sees
//!   2 Drone War    no artillery: red drones hunt moving vehicles; drone
//!                  nets on the ways stop them
//!   3 Blitz        red attacks in waves with new squads; hold the line
//!                  for 12 minutes
//!   4 Fog          the player sees red squads only where blue units see
//!   5 Manoeuvre    each sector has an objective square; the squads route
//!                  to it through dead ground, in bounds
//!   6 Frontier     the towns make the supply; take towns to grow it

pub const Style = enum(u8) { supply_line, drone_war, blitz, fog, manoeuvre, frontier };
pub const style_count = 6;

pub const Rules = struct {
    style: Style,
    name: []const u8,
    blurb: []const u8,
    win_text: []const u8 = "OBJECTIVE HELD. YOU WIN.",
    lose_text: []const u8 = "THE LINE BROKE. YOU LOSE.",
    /// Red guns shell what red sees.
    artillery: bool = true,
    /// Blue mortars fire at red squads that blue sees near blue squads.
    mortars: bool = true,
    /// Red drones hunt blue vehicles. Nets on the ways stop them.
    drones: bool = false,
    /// The player sees red squads only where blue sees.
    fog: bool = false,
    /// Red attacks in waves, with new squads from the north.
    waves: bool = false,
    /// Win by holding the line for this many seconds (0: take the
    /// objective).
    survive_s: u32 = 0,
    /// The squads route to the objective of their sector, through dead
    /// ground, in bounds (half move, half cover).
    manoeuvre: bool = false,
    /// The supply comes from the towns that each side holds.
    town_supply: bool = false,
    /// The range of rifle fire, in squares.
    fire_range: f32 = 2.5,
    /// The sectors where red pushes at the start.
    red_push_at_start: u8 = 2,
    supply_rate: f32 = 3,
    materials_rate: f32 = 0.8,
};

pub fn get(style: Style) Rules {
    return switch (style) {
        .supply_line => .{
            .style = style,
            .name = "SUPPLY LINE",
            .blurb = "Take the objective. Keep the trucks out of sight of the guns.",
        },
        .drone_war => .{
            .style = style,
            .name = "DRONE WAR",
            .blurb = "No guns. Red drones hunt your trucks. Net the roads (L, 3).",
            .artillery = false,
            .drones = true,
        },
        .blitz => .{
            .style = style,
            .name = "BLITZ",
            .blurb = "Red attacks in waves. Hold the line for 12 minutes.",
            .win_text = "THE LINE HELD. YOU WIN.",
            .waves = true,
            .survive_s = 12 * 60,
            .red_push_at_start = 4,
            .materials_rate = 1.2,
        },
        .fog => .{
            .style = style,
            .name = "FOG",
            .blurb = "You see red only where your units see. Ghosts are old reports.",
            .fog = true,
        },
        .manoeuvre => .{
            .style = style,
            .name = "MANOEUVRE",
            .blurb = "Give each sector an objective (K, 4). Squads move through dead ground.",
            .manoeuvre = true,
            .red_push_at_start = 1,
        },
        .frontier => .{
            .style = style,
            .name = "FRONTIER",
            .blurb = "Towns make supply. Take towns, starve red.",
            .town_supply = true,
            .supply_rate = 0.5,
        },
    };
}
