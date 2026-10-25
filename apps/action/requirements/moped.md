# REQ-MOPED — The moped that a player rides

The rideable moped of `action` (`apps/action/game/src/moped_ride.zig`,
`apps/action/server/bikes.ts`): the crash of a thief moped on Warwick Road
leaves a moped that a player rides into the station, over a ramp of junk
and the ticket gates.

---

## REQ-MOPED-001 — A player gets on a crashed moped and gets off it

- **Status:** active
- **Source:** agent:SEAN-931
- **Origin:** #931
- **Type:** functional
- **Priority:** P1
- **Statement:** When a player presses the use key on a crashed moped with
  no rider, the game shall put the player on the moped.
- **Rationale:** The jump key puts the rider beside the moped again. The
  crash of each thief moped leaves one moped to ride.
  It lies on its side where it stopped, to the end of the match.
- **Verification:** Test — `apps/action/game/src/moped_ride_test.zig` › "moped ride: a crash leaves one moped, F gets on, W rides, Space gets off (REQ-MOPED-001)"
- **Relations:** none

## REQ-MOPED-002 — The moped drives on the floors and stops at the walls

- **Status:** active
- **Source:** agent:SEAN-931
- **Origin:** #931
- **Type:** functional
- **Priority:** P1
- **Statement:** The moped shall drive on each floor that a player walks
  on, the ramps over the stairs and the escalators included, and stop at
  each wall and each lift cab.
- **Rationale:** The moped goes into the station, across the concourses
  and down the stairs to the platforms. The body of the moped and its
  rider is three boxes along the moped, and each end clears a slope of
  0.6 m. A wall at 8 m/s or more throws the rider.
- **Verification:** Test — `apps/action/game/src/moped_ride_test.zig` › "moped ride: into the station, the concourse, down the stairs onto a platform (REQ-MOPED-002)"
- **Verification:** Test — `apps/action/game/src/moped_ride_test.zig` › "moped ride: down an escalator to the deep level (REQ-MOPED-002)"
- **Verification:** Test — `apps/action/game/src/moped_ride_test.zig` › "moped ride: a wall at speed throws the rider, a bump does not, and a lift cab stops a moped (REQ-MOPED-002)"
- **Relations:** none

## REQ-MOPED-003 — The junk ramp jumps a moped over the Warwick Road gates

- **Status:** active
- **Source:** agent:SEAN-931
- **Origin:** #931
- **Type:** functional
- **Priority:** P1
- **Statement:** When a moped rides up the junk ramp at 11 m/s or more, the
  moped shall clear the Warwick Road gate line and land in the passage.
- **Rationale:** The ramp is site junk on the street side of the gate
  line: sheets of plywood and MDF on pallets. It is one map ramp, 1.1 m
  high at its lip, 1.4 m short of the gate cabinets.
- **Verification:** Test — `apps/action/game/src/moped_ride_test.zig` › "moped ride: the junk ramp jumps the gate line into the passage, with no fare dodge (REQ-MOPED-003, REQ-MOPED-004)"
- **Relations:** none

## REQ-MOPED-004 — A moped jump over the gates is no fare dodge

- **Status:** active
- **Source:** agent:SEAN-931
- **Origin:** #931
- **Type:** functional
- **Priority:** P1
- **Statement:** If a player on a moped crosses a gate line by any other
  way than an open lane, then the game shall not kill the player for fare
  dodging.
- **Rationale:** Sean asked that the gate jump on the moped does not
  trigger the fare-dodge death. The rule on foot stays the same, a jump
  from the junk ramp included: the tests check both.
- **Verification:** Test — `apps/action/game/src/moped_ride_test.zig` › "gates: on foot a jump from the junk ramp over the gate line is still a fare dodge (REQ-MOPED-004)"
- **Relations:** none

## REQ-MOPED-005 — The server checks each moped event

- **Status:** active
- **Source:** agent:SEAN-931
- **Origin:** #931
- **Type:** functional
- **Priority:** P1
- **Statement:** The server shall accept a mount, a dismount and a moped
  hit only from a live player that the checks of `bikes.ts` allow.
- **Rationale:** A death by a moped hit credits "moped" in the kill feed.
  The client of the rider drives the moped. The server
  checks the place, the rider, the speed and the distance, and it sends
  each event with its place, so each client sees the same moped.
- **Verification:** Test — `apps/action/server/bikes.test.ts` › "a mount near the moped goes to all, once"
- **Verification:** Test — `apps/action/server/lobby.test.ts` › "a crash leaves a moped, then a mount, the pose, the secondary only, a hit that kills and an off"
- **Relations:** none
