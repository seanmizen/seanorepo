# action.seanmizen.com

A first-person shooter in the browser, on swindowzig (Zig to wasm, WebGPU).

- **Deathmatch**: one lobby that is always on. A match is 5 minutes. Then the
  score board shows for 10 seconds, the scores reset, and the next match
  starts. The clock runs with or without players.
- **Target practice**: offline. The player starts on the firing line of the
  range: human dummies with health bars, and the damage of each hit near the
  crosshair (see The practice range). An NPC shooter fires at a board next
  to the player, from a control panel (see The NPC shooter). In the arena,
  a hit on a plate starts a round of 60 seconds. Some plates move. The red
  centre scores 150, the plate 100. The best score stays in local storage.

Controls:

| Key | Action |
|---|---|
| WASD | move |
| Space | jump. While you walk forward into a shape 0.5 to 1.4 m high (a wall, a railing): vault onto it. You end on top, not over it. |
| Mouse | look |
| Left click | fire |
| Right click | aim down the sights |
| R | reload |
| G | quick grenade throw, from any slot |
| 1, 2, 3, 4 | weapon slots: primary, secondary, knife, grenade |
| B | weapon menu (also on the pause screen) |
| F | use the item under the crosshair: a lift button, the NPC shooter panel, a dead pigeon (pick up, throw), a vape |
| F | on the back shelf of VAPES N MORE: open the secret room |
| Q, E (hold) | lean left, lean right |
| Tab | the score board: kills, deaths and the ping of each player |
| Y | chat to all players |
| T | chat to your team |
| / | the chat input with "/" typed: a console command |
| Esc | release the mouse (pause) |
| M (paused) | main menu |
| ` (backtick) | the console |

These keys are the default binds, except "/" and the backtick key. The
console changes them (`bind`, see [The console](#the-console)), and the
hints on the screen follow the binds. See [Chat](#chat).

On the main menu, 1, 2 and 3 pick deathmatch, practice and the settings.
These keys, the arrow keys of the menus, Enter and the clicks on buttons
do not go through the binds.

Debug: Cmd+D (Ctrl+D) shows the debug screen. While it shows, Shift+1 to 9
go to a spawn point, and in deathmatch a health bar shows over each other
player. It also shows the build and the protocol of the game, and in
deathmatch those of the server and its instance id (see
[The session](#the-session-versions-and-reconnect)).

The HUD has a minimap: north up, the walls at body height over the floors at
foot height. A player who fires shows on it for a moment.

## The floorplan tool

`zig build floorplan` (in `game/`) slices a map into images and audits it:

```bash
zig build floorplan -- earls_court plan 1 out.ppm         # top view at y = 1
zig build floorplan -- earls_court section-z -22.5 out.ppm # side view at z = -22.5
zig build floorplan -- earls_court audit                  # decoration a player can walk through, lights inside a solid shape, surface materials, lift shafts and landings
zig build floorplan -- earls_court escape                 # escape holes: exit code 1 if it finds one
sips -s format png out.ppm --out out.png                  # macOS, to view it
```

- The audit prints the boxes and the decoration of each surface material
  (see [Surface materials](#surface-materials)). Its exit code is 1 when a
  material does not fit the look of its surface.
- The audit checks each lift (see [Lifts](#lifts)). The shaft: no static
  solid box and no ramp may be in the space that the inside of the cab
  sweeps. In plan that space is the cab floor. In height it goes from the
  lowest cab floor to the highest, plus the cab height (or the player
  height, if more). Each landing: with the cab there and the doors open,
  lines across the doorway, from the middle of the cab to 1 m past the
  doors, must have a floor at the level and room for the body. The exit
  code is 1 when a shaft or a landing is not clear.
- Every command stops with exit code 1 when the map has more boxes than
  `map.max_boxes` (see [The box limit](#the-box-limit)).

### The escape audit

Run the escape audit on both maps before you merge a map change:

```bash
zig build floorplan -- arena escape
zig build floorplan -- earls_court escape
```

The audit (`game/src/escape.zig`) flood fills the space that a player can
get to from the spawn points. It includes walks, step ups, jumps onto a
ledge, running jumps over a gap, falls and the lifts. It reports each place
where that space touches the outside of the map, or has no floor below it.
The exit code is 1 when it finds an escape hole.

- Each hole shows the floor that the player leaves from, and the route from
  a spawn point. The route shows each change of floor height of more than
  0.5 m.
- "after hole N" means that the player can only get to this hole through
  hole N. Fix hole N first.
- The audit measures the jump and the run speed with `player.zig`, so it
  follows changes to the movement.
- The audit errs toward an escape. It tests a player 0.1 m thinner than the
  real one, so a gap 0.54 m to 0.64 m wide can show as a hole.
- The lift doors count as open. The deep train is not in the audit.
- It takes about 5 seconds on Earl's Court.

## Light

- **Local lights respect walls.** Each map light (`map.addLight`) has a
  cube shadow map: six 256 x 256 depth faces, drawn one time when the map
  loads (`drawLightShadows` in `game/src/render.zig`). A surface that a wall
  hides from a light gets no light, highlight or floor glint from it. The
  haze glow of a light also stops at a wall.
- The shadow maps hold the static mesh only. The lifts, the train and the
  other players cast no shadow from a local light. Lamps (emissive
  surfaces) cast none, because their light comes from inside them. Your
  own body casts a shadow from the nearest lights (see
  [Your body](#your-body)).
- Lights that move (the muzzle flash, the grenade flash, the train and the
  lift cab lights) have no shadow map. Walls do not stop them.
- Put a map light outside every solid shape and decoration. A light inside
  one is in its own shadow and lights nothing. The floorplan audit lists
  such lights.
- Underground, the floor has small damp patches: a little darker and a
  little glossy, with a narrow glint toward each light.

## The practice range

South of the arena, through a doorway in its south wall: a lane 24 m wide
and 80 m long. The sun is behind the firing line, so the dummies are lit.
`game/src/maps/arena.zig` has the layout and `game/src/range.zig` has the
dummies.

| Distance from the spawn | Dummy | Cover |
|---|---|---|
| 10 m | stands | a row of waist-high walls (1.05 m) |
| 15 m | leans out from behind a pillar and back, at random times | a pillar, 2.5 m high |
| 25 m | stands | a row of waist-high walls |
| 35 m | walks side to side, 2.75 m each way, at up to 3 m/s | a row of waist-high walls, with gaps |
| 50 m | stands | a row of waist-high walls |
| 75 m | stands | a row of waist-high walls |

- **A dummy is a player.** It has the player model, the player hit boxes and
  the player lean (`game/src/player.zig`). Thus a head, body or leg hit does
  the same damage as on a player in deathmatch. The damage comes from the
  stats of the held gun, with the fall-off at the distance of the hit
  (`pelletDamage` in `game/src/main.zig`). A grenade does the same damage
  as to a player, cover included.
- **Respawn**: a dead dummy falls over, and 1 s after the death it stands
  again at its place with full health.
- **Heal**: a dummy that gets no hit for 4 s heals to full. Thus each test
  starts from 100.
- **The leaner**: upright, the pillar hides all its hit boxes from the
  spawn. A full lean shows about 0.1 m of the head, as the lean of a player
  does. Step to the right of the firing line to see more of it.
- **Health bars**: a bar over each dummy, with its health and its distance
  in metres. The bar has a fixed size on the screen, so it reads at 75 m. A
  hit shows the lost health in white for a moment. When two bars cover each
  other, the far one moves up, with a thin line down to its dummy.
- **Damage numbers**: to the right of the crosshair, not in the world. Each
  shot shows its damage on each dummy that it hits: red for the body, gold,
  larger and with HEAD for the head. A shotgun shot with head and body
  pellets shows two numbers. The hit that kills says KILL. A new number goes
  at the bottom and pushes the older ones up. They fade in 1.3 s. Under the
  crosshair, TOTAL shows the sum of a series of hits less than 1 s apart.
- **Plates**: the plates are in the arena. A hit on a plate starts a round of
  60 seconds. The player is never frozen, so the range stays free during a
  round and after it.

### The NPC shooter

An NPC on the range fires at a target board next to the practice spawn, so
you can see and hear what it is to be shot at. `game/src/shooter.zig` has
the NPC and the panel, `game/src/shooter_hud.zig` the text of the panel,
and `game/src/maps/arena.zig` the station.

- **The NPC** is the player model, in blue, with the gun of the panel. It
  stands down the range, 10, 25, 50 or 75 m from the spawn, a little to
  the left of the line of the dummies. Seen from the spawn, it hides no
  dummy. A new distance makes it run to the new place at 8 m/s. Each round
  shows the muzzle flash on its gun.
- **The target board** hangs on the arena wall behind the spawn: 1 m
  behind your place, above it and to its left. The NPC aims at its
  centre, with a small group (the cone of the gun at the sights, at most
  15 cm). Each round passes 1.6 m from your head, then hits the board.
  Turn round to see it.
- **No surface** removes the board. The round passes your head on the same
  line. It flies through the doorway of the arena and hits the north wall
  of the arena 62 m away, or flies over it. That is past
  `snd_impact_distance` (60 m), so you hear the crack or the whiz and no
  impact.
- **What you hear** is the shot of another player (`sounds.zig`): the crack
  (supersonic) or the whiz (subsonic), the impact sound of the material of
  the board, and the muzzle report after the distance / 343 s. The panel
  shows the arrival times at your place. The impact effect of the material
  starts when the bullet arrives (see [Impact effects](#impact-effects)).
- **Safe**: a round of the NPC hits the map only. It never hurts you, a
  dummy or a plate. Your shots hit the NPC (a flesh impact), but it takes
  no damage.
- **Start and stop**: the NPC fires only after START. STOP stops it, and so
  does a step off the range into the arena. All of it is local to practice
  mode: the server gets no message.

The control panel stands in front of the spawn, to the left, and faces it.
Aim at a button and press F (the use key, as for the lifts). The button
under the crosshair is orange, and the line under the crosshair says what
it does.

| Row | Buttons | It shows |
|---|---|---|
| title | - | NPC SHOOTER, and the status: STOPPED, MOVING, FIRING (a red lamp) or RELOADING |
| GUN | < > | the gun (all 34), its calibre, the bullet speed, and SUPERSONIC or SUBSONIC |
| SURFACE | < > | the material of the board (each material, then NO SURFACE), and its sound |
| DISTANCE | < > (nearer, further) | 10, 25, 50 or 75 m, and the arrival times of the crack (or the whiz) and the muzzle report |
| FIRE MODE | < > | SINGLE, BURST or AUTO: the modes that the gun allows |
| - | START, STOP | - |

| Mode | The NPC fires | The guns |
|---|---|---|
| SINGLE | one round each second | each gun that fires one round for each pull (not the bullpups) |
| BURST | 3 rounds at the rate of the gun, then a pause of 1 s. A bullpup fires its own burst. | the automatic guns and the bullpups |
| AUTO | the full magazine at the rate of the gun | the automatic guns: the rifles, the carbines and the SMGs |

- The NPC reloads when its magazine is empty, in the reload time of the
  gun. START, a new gun and the arrival at a place wait 0.6 s before the
  first round. A new gun also waits its draw time.
- The text of the panel is on the HUD, at the place of the face in the
  view. It fades out between 30 and 45 degrees from the centre of the
  view, so it does not cover the HUD.
- The face and the buttons are backlit (emissive), so the sun does not
  wash out the text.
- FLESH is a block of ballistic gel: the impact sound and the effect of a
  body.

## Tests

`zig build test` (in `game/`) runs the native tests (`game/src/tests.zig`):

- `game/src/player_test.zig` walks a player down and up each staircase of
  Earl's Court, and walks and rides each escalator. Each walk must keep the
  feet on the ground and the eye height smooth (at most 5 cm in a tick). It
  must not stop at a wall or a ceiling edge, and the head bob must follow
  the walking speed. It also rides each lift up and down from six places
  in the cab: the centre, the four corners and the middle of the doors. It
  rides at the lift speed, at 60 m/s, and with server corrections of up to
  1 m. The feet must stay on the cab floor and the body out of all solid
  shapes. Then the player walks out onto the landing and back in.
- `game/src/vault_test.zig` tests the vault (`game/src/vault.zig`). The
  player vaults onto a waist-high wall of the range and onto the railing
  along the shed edge of the east concourse. The player must stand on the
  top, on the ground and out of all solid shapes, and must not fall onto
  the tracks. A pillar, an arena wall, a step and a wall with a low
  ceiling over it give no vault. A vault onto the ticket gates (a cabinet
  or the paddles of a lane) puts the feet on the gates: a fare dodge. A
  walk into the closed gates does not cross the gate line.
- `game/src/body_test.zig` tests your body in first person. No part that
  the camera shows comes nearer than 0.12 m to the eye, at each look up and
  down, each lean, each step of the walk and on stairs. The head, the arms
  and the weapon cast a shadow only. A planted foot does not slide. On the
  stairs and the escalators of Earl's Court each planted foot is on the
  tread under it, standing (to 3 cm) and walking (to 5 cm).
- `game/src/console/tests.zig` tests the console: the parser, the cvar
  limits, the commands, the binds and the buttons, the scripts, the saved
  config, the completion and the chat.
- `game/src/session/tests.zig` tests the session: the compare of a
  welcome with the last server and the game, the retry wait and its
  maximum, and the state machine through a lost connection, a restart, a
  new build, a new protocol, a bye and the timeouts. It also tests the
  `version` command.
- The server cvar file must be valid, with safe defaults. The protocol
  version file must hold one number.
- `game/src/guns_test.zig` tests the gun model: a longer barrel gives more
  bullet speed and less fall-off, a stock gives less recoil and a faster
  recovery, a heavy gun is slower, the recoil pattern climbs and recovers,
  no gun is the fastest to kill at both 10 m and 40 m, and
  `server/guns.json` has the numbers of the model.
- `game/src/surfaces_test.zig`: each map fits in `map.max_boxes`, a full
  map changes no box, every material fits the look of its surface, a hit
  takes the material of the decoration on the hit point (a sleeper on the
  ballast), and each supersonic gun gives a crack and each subsonic gun a
  whiz.
- `game/src/audio/tests.zig`: the Mach cone geometry, the order of the
  crack and the muzzle report, Whitham's laws for the N-wave, the head
  cues, the Doppler shift of the whiz, the distance law, the floor echo,
  and a bounded sound of its own for each material. The choir has a
  fixed peak and two different ears. It starts and ends quiet, and the
  same seed gives the same sound.
- `game/src/secret_room_test.zig`: the secret room of VAPES N MORE. Shut,
  the door is a wall, the GET MORE pack is in reach and the golden pigeon
  is not. GET MORE opens the door, the room lights come up, and a player
  walks from the shop to the dais. MORE gives a blessing of 45 s. A new
  match shuts the door, and a late join opens it at once.
- `game/src/shooter_test.zig`: the NPC shooter. At each distance and over
  the full group, a round hits the board and passes 1 to 2 m from the head
  of the player. With no board, a round hits nothing within 60 m of the
  player. The NPC hides no dummy. It fires only after START, at the rate of
  the gun, and stops off the range. The eye on the spawn presses each
  button. The crack comes before the muzzle report, and the gap grows with
  the distance. Each material has an impact effect, and a late effect
  waits.

`yarn workspace action test` (`bun test server`) runs the server tests
(`server/*.test.ts`):

- `server/ping.test.ts`: the ping calculation.
- `server/guns.test.ts`: the gun table of the server. Its fall-off must give
  the damage of the client model at each sample distance.
- `server/console.test.ts`: the same parser cases, the cvar limits, the
  config file and the environment variables.
- `server/chat.test.ts`: the chat checks. The control characters, the
  length cap in bytes, the rate limit, the team routing and the match end
  line.
- `server/session.test.ts`: the build file and its fallback, the protocol
  file, the instance id, the `/api/version` answer, the welcome and the
  bye.
- `server/pigeons.test.ts`: the flock of the server. One takeoff for each
  pigeon, a kill makes a body, the return after 1 to 3 minutes as a new
  generation, one holder for each body, and a drop when the holder leaves.
- `server/lobby.test.ts`: a real server on a free port. It checks the cvars
  on join, rcon, a client that tries to set a server cvar, the chat relay
  with the join and leave lines, the `lift` field of a player in a cab, the
  gate relay, the flock on join, a pigeon kill to the other players, and
  the session: `GET /api/version`, the build header, the welcome before the
  hello, the bye on SIGTERM, and a new start with a new build on the same
  port.

## The console

The backtick key (the key left of 1) opens the console. Esc or the
backtick key closes it. While it is open, the game gets no keys. In
deathmatch the game goes on.

- Type a command and press Enter. Up and Down go through the history.
  Shift+Up and Shift+Down scroll the text.
- While you type, a list shows the commands and the cvars that match, with
  the description and the current value. Tab completes. A second Tab goes
  to the next match.
- `help` shows how it works. `find <text>` searches the names and the
  descriptions. `cmdlist`, `cvarlist`, `bindlist` and `scriptlist` list
  them. `help <name>` shows one command or cvar, with the code that reads
  it.
- `<cvar>` shows a cvar. `<cvar> <value>` sets it.
- `;` separates two commands. `//` starts a comment. Double quotes keep
  spaces and `;` in one argument: `bind k "+jump; +attack"`.

The built-in commands: `help`, `find`, `cvarlist`, `cmdlist`, `set`,
`reset`, `toggle`, `bind`, `unbind`, `bindlist`, `resetbinds`, `exec`,
`edit`, `scriptlist`, `scriptdel`, `echo`, `clear` and `toggleconsole`.
The chat adds `messagemode`, `messagemode2`, `say` and `say_team` (see
[Chat](#chat)). The session adds `version` (see
[The session](#the-session-versions-and-reconnect)). The game adds `rcon`,
`reload` (reload the page), the actions, and `nearmiss` and `impact` (see
[Bullet sounds](#bullet-sounds)).

### Cvars

A cvar (config variable) has a name, a type (bool, int, float or string),
a default, a description, the code that reads it, flags, and a min and a
max for the numbers. A set clamps a number to the limits. An unset cvar
has its default.

| Flag | Meaning |
|---|---|
| saved | The game keeps it in local storage when it is not the default. |
| server | The server owns it. The client gets the value on join and on each change, and cannot change it. |
| cheat | It changes only while cheats are on: in a debug build (`OPTIMIZE=Debug ./build.sh`). |
| read only | Only the game code changes it. |
| protected | The value never shows in a list and never goes to a client (a password). |

The client cvars:

| Cvar | Range | Default | Flags | Read by |
|---|---|---|---|---|
| `head_bob` | 0 (off) to 2 | 1 | saved | `main.zig` playerView |
| `volume` | 0 to 1 | 1 | saved | `main.zig` tick |
| `sfx_volume` | 0 to 1 | 1 | saved | `main.zig` sound, `sounds.zig` |
| `fov` | 60 to 100 degrees | 74 | saved | `main.zig` gameRender |
| `sensitivity` | 0.2 to 3 | 1 | saved | `main.zig` gameplayTick |
| `chat_fade_seconds` | 1 to 120 seconds | 10 | saved | `console/chat.zig` Chat.alpha |
| `snd_nearmiss_distance` | 0 (off) to 200 m | 25 | saved | `sounds.zig` nearMiss: the largest miss distance of a crack or a whiz |
| `snd_impact_distance` | 0 (off) to 300 m | 60 | saved | `sounds.zig` impactSound: the largest distance of an impact sound |
| `own_body` | 0 or 1 | 1 | saved | `main.zig` ownPose. 0 hides your body in first person. Its shadow stays. |
| `rcon_password` | text | empty | protected, not saved | `game_console.zig` cmdRcon |

The settings panel shows the first five. The values of the old local
storage key `settings` carry over one time, then the game deletes the key.

### Binds and actions

A bind runs a command when its key goes down. A command that starts with
`+` is a button: the release of the key runs the `-` command. The game
reads the actions, not the keys (`game/src/game_console.zig`).

| Action | Default key | Does |
|---|---|---|
| `+forward`, `+back`, `+moveleft`, `+moveright` | W, S, A, D | move |
| `+jump` | Space | jump. While you walk forward into a shape 0.5 to 1.4 m high (a wall, a railing): vault onto it. You end on top, not over it. |
| `+attack` | mouse1 | fire, knife, throw the grenade in the hand |
| `+aim` | mouse2 | the sights |
| `+reload` | R | reload |
| `+grenade` | G | quick grenade throw |
| `+use` | F | use: a lift button, the NPC shooter panel, a pigeon, a vape, the secret room |
| `+leanleft`, `+leanright` | Q, E | lean |
| `+slot1` to `+slot4` | 1 to 4 | weapon slots |
| `+weaponmenu` | B | the weapon menu |
| `+scores` | Tab | the scores |
| `+pause` | Escape | free the mouse. On Esc the browser frees it in any case. |
| `+menu` | M | the main menu, from the pause screen |
| `messagemode` | Y | the chat input, to all players (not a button) |
| `messagemode2` | T | the chat input, to your team (not a button) |

The key names: a to z, 0 to 9, left, right, up, down, space, enter,
escape, tab, backspace, shift, ctrl, alt, mouse1 to mouse5. Examples:

```
bind c +jump
unbind e
bind e "+leanright; echo lean"
resetbinds
```

swindowzig has no key code for the backtick key or for "/". The web
backend sends each key that it does not know as Unknown, and `src/boot.ts`
stops every unknown key except the backtick key. It sends the "/" key to
the game as the typed text "/" (see [Chat](#chat)). So the backtick key
and "/" are not in the binds, and the punctuation keys cannot have a bind.

### Scripts and the saved config

- `edit <name>` opens a script in the editor of the console. A new name
  makes a new script. One command a line, `//` starts a comment. Esc saves
  the script and closes the editor. The editor deletes an empty script.
- `exec <name>` runs a script. The errors show the script and the line:
  `autoexec:3: ...`.
- The `autoexec` script runs at start, after the saved config.
- The game saves the cvars with the saved flag and the binds in local
  storage (the key `config`). It writes only the changes from the
  defaults, so a new default bind also reaches an old config. Put your own
  commands in `autoexec`, not in `config`.
- Scripts live in local storage (`script-<name>`, and the list in
  `scripts`), in this browser only.

## Chat

Y opens the chat input to all players, and T to your team. "/" opens it
with "/" typed. Enter sends the line, Esc closes it. The chat works in
every mode. A message needs the deathmatch server.

- **Keys**: Y and T are binds (`messagemode`, `messagemode2`), so `bind`
  changes them. "/" has no key code (see [Binds and actions](#binds-and-actions)),
  so no bind can change it. `messagemode /` does the same as "/".
- **While the input is open**, the binds do not run: no movement, no fire
  and no mouse look. The keys that a bind holds let go. In deathmatch the
  game goes on.
- **A line that starts with "/"** runs as a console command, for example
  `/fov 90` or `/say hi`. The label is CONSOLE. It has the suggestion list
  and the Tab completion of the console. The command and the first 8 lines
  of its output show in the chat. The console has all of them.
- **The input** has its own history: Up and Down. Shift+Up and Shift+Down
  scroll the chat. A chat line stops at `chat_max_length` bytes (a server
  cvar). A "/" line can be as long as a console line.
- **The fade**: a line shows for `chat_fade_seconds` (default 10, saved),
  and it fades out in its last second. While the input is open, the recent
  lines show, faded or not.
- **What shows**: a message to all is `Name: text`, with the name in the
  colour of the player. A team message is `(TEAM) Name: text` in blue. The
  server lines (a join, a leave, the start and the end of a match) are
  yellow. The chat shows a message only when the server sends it back, so
  the sender sees the same text as the other players.
- **Team chat with no teams**: each player is a team of one, so a team
  message goes to the sender only. Deathmatch has no teams. Each player on
  the server has a team number (`team` in `server/index.ts`). 0 is no team.
  A game mode with teams sets the numbers, and the relay
  (`chatRecipients` in `server/chat.ts`) stays the same.
- **The server checks** (`server/chat.ts`): it changes line breaks and tabs
  to spaces, and removes the other control characters (Unicode Cc), the
  format characters (Cf: the bidirectional overrides and the zero-width
  characters) and lone surrogates. It changes each run of spaces to one
  space, and trims the ends. It cuts the message to `chat_max_length` bytes
  of UTF-8, on a code point boundary. A player can send at most
  `chat_rate_messages` messages in `chat_rate_seconds`. The server drops
  the next ones, and tells the sender how long to wait. It writes each
  message to its log.

`game/src/console/chat.zig` has the chat and `chat_view.zig` draws it. They
import nothing from the game. `game_console.zig` has the action glue: the
binds, the send function and the place on the HUD.

## Server config

The server cvars have one definition, in `game/src/server_cvars.json`.
The client embeds the file, and the server reads it (`server/console.ts`).

| Cvar | Range | Default | Read by |
|---|---|---|---|
| `despawn_cadaver_timer` | seconds, at most 86400 | -1 | Nothing yet. The ragdoll bodies will read it. Unset or negative: bodies never despawn. |
| `match_seconds` | 10 to 7200 | 300 | `server/index.ts` step. A change applies from the next match. |
| `end_seconds` | 1 to 120 | 10 | `server/index.ts` step. A change applies from the next match end. |
| `chat_max_length` | 1 to 240 bytes | 160 | `server/index.ts` onChat, and the chat input of the client. |
| `chat_rate_messages` | 1 to 100 | 5 | `server/index.ts` onChat: at most this many messages in `chat_rate_seconds`. |
| `chat_rate_seconds` | 0.5 to 600 | 5 | `server/index.ts` onChat. |
| `admin_password` | text | empty | `server/index.ts` onRcon. Protected: it never goes to a client. |

The server sets the values in this order. The last one wins.

1. The defaults.
2. The config file: `server/server.cfg`, or the file that `SERVER_CONFIG`
   names. It is a script: `set`, `reset`, `echo` and `cvarlist`, one
   command a line.
3. The environment: `SV_<NAME>` sets `<name>`, for example
   `SV_MATCH_SECONDS=600`. An empty variable counts as unset.
4. Rcon, at run time. The server does not save rcon changes.

The server sends every server cvar (not the protected ones) to a player on
join, and each change to every player. A client message cannot change a
server cvar.

### Remote admin (rcon)

Rcon is off while `admin_password` is empty. To turn it on, set
`SV_ADMIN_PASSWORD` in the environment of the server. Do not put the
password in `server.cfg`: the file is in the repository. With docker
compose, set `SV_ADMIN_PASSWORD` in the shell that runs `yarn workspace
action prod:docker`: `docker-compose.yml` passes it to the container.

In the console of the game, in deathmatch:

```
rcon_password <the admin password>
rcon set match_seconds 600
rcon cvarlist
rcon status
```

The answer of the server shows in the console. After 5 bad passwords the
server closes the connection. After 20 bad passwords in a minute, rcon
stops for everyone until the minute ends.

## Weapons

Four slots. A change of slot takes the draw time of the new weapon, and
the weapon cannot fire until it is out. `game/src/weapon.zig` has the
classes, the items and the hands. `game/src/guns.zig` has the gun model:
the stats of each gun.

- **1 primary**: a rifle, a carbine, a bullpup, an SMG, a shotgun or the
  sawn-off.
- **2 secondary**: a pistol or a revolver.
- **3 knife**: melee, 1.6 m reach. Five short rays (the centre and four
  around it), so a near miss still cuts.
- **4 grenade**: the grenade comes up in 0.5 s. Then the aim view shows:
  the same dotted path, impact point and blast volume as the debug screen.
  A left click throws. The next grenade comes up, and after the last one the
  hand goes back to the weapon before it. G still throws at once from any
  slot.

**B** opens the weapon menu: a row for each class and a button for each
model. The panel shows the model under the mouse in 3D, its calibre, its
bullet speed (supersonic or subsonic), its build and its stats. A click
puts the model in its slot. The pick stays in local storage (`loadout`).
Practice applies it at once. In deathmatch the server applies it at once
while the player is within 4 m of the spawn point and has not fired or
thrown since the spawn. Else it applies on the next spawn, and the HUD
shows `NEXT SPAWN`. The default pick is RIFLE 2 (the AKM) and PISTOL 1.

**Compare bars**: the panel has a bar for each stat, with the value at the
right:

| Bar | Value | Better |
|---|---|---|
| DAMAGE | the body damage of a shot (all the pellets) | more |
| FIRE RATE | rounds a minute | more |
| RANGE | the distance at which a hit does 75% of its full damage | more |
| RECOIL | the up kick and half the side kick of a shot, in degrees | less |
| MOBILITY | the walk speed | more |
| RELOAD | the reload time | less |

When the gun under the mouse is not the gun in its slot, each bar compares
the two guns. Green shows the part where the gun under the mouse is better,
red the part where it is worse, and the value takes the same colour.
`game/src/gun_compare.zig` draws the bars. It keeps no state, so another
panel can draw them for any two guns of one slot.

The knife: 55 damage to the body and the head, a swing each 0.45 s, 1.6 m
reach, 110% speed, out in 0.2 s. The grenade: see Grenades.

### The gun model

No table has the stats of each gun by hand. `game/src/guns.zig` makes them
from three parts:

- **The calibre** sets the damage, the head multiple, the pellets, the
  fall-off with the distance, the bullet speed and the recoil impulse.
- **The class** sets the action: automatic, burst, pump or semi-automatic,
  the time between shots for the reference calibre of the class, the
  magazine, the hip cone, the reload, the draw and the shape of the recoil
  pattern (`table` in `game/src/weapon.zig`).
- **The build** of each gun changes them: the barrel length, a stock or no
  stock, the weight class, and the bullpup layout.

The formulas. `r` is the barrel length divided by the reference barrel of
the calibre (0.4 to 4):

| Stat | Formula |
|---|---|
| Damage | calibre damage x r^0.1 (0.9 to 1.1), rounded. The head damage is the calibre head multiple of it. |
| Bullet speed | calibre speed x r^0.2. Faster than 343 m/s is supersonic. |
| Fall-off | full damage to `near` m, then a straight line down to `min` at `far` m, then flat. `near` and `far` are the calibre values x r^0.35 (0.75 to 1.3). |
| Fire rate | the time between shots = the class interval x the calibre shot damage / the shot damage of the class reference calibre. Thus each class keeps its damage a second, a bigger round fires more slowly, and the barrel does not change the rate. |
| Kick | class kick x (impulse / reference impulse)^0.85 x weight (light 1.2, medium 1, heavy 0.82), x 1.4 with no stock |
| Side kick | kick x class sway, x 1.3 with no stock |
| Recovery | class rate x weight (light 1.1, medium 1, heavy 0.9), x 0.6 with no stock |
| Cone at full heat | class bloom, x 1.3 with no stock |
| Speed | class speed + weight (light +0.03, heavy -0.04), +0.02 with no stock |
| Draw and aim | class draw time x weight (light 0.85, heavy 1.2). Aim speed x weight (light 1.2, heavy 0.8). A bullpup or a gun with no stock is short: draw x 0.9, aim speed x 1.15. |
| Reload | class reload, x 1.14 for a bullpup (the magazine is behind the grip) |
| Magazine | the class magazine, or the magazine that the model shows. The reserve keeps the same number of magazines. |

A handgun has no stock. The kick of the pistol and the revolver class is
for a two-hand grip, so the stock rule does not apply to them. The sawn-off
class has no stock as its reference.

The barrel length class is a name only. The formulas use the length. The
usual barrel is 12 cm for a handgun, 20 cm for a long gun for pistol rounds,
40 cm for a rifle and 50 cm for a shotgun. Under 0.65 of it is snub, under
0.9 short, under 1.15 standard (1.25 for a pistol round in a long gun), and
longer is long.

The calibres. The damage, the bullet speed and the fall-off are for the
reference barrel. The bullet size (the diameter and the length of the
bullet, or of one pellet) sets the crack and the whiz (see
[Bullet sounds](#bullet-sounds)):

| Calibre | Body | Head | Pellets | Bullet | Bullet size | Reference barrel | Full damage to | Down to | Impulse |
|---|---|---|---|---|---|---|---|---|---|
| 4.6x30 mm | 17 | x2.3 | 1 | 720 m/s | 4.65 x 16 mm | 18 cm | 18 m | 65% at 55 m | 2.3 N s |
| 9x19 mm | 21 | x2.3 | 1 | 360 m/s | 9.02 x 15.5 mm | 11 cm | 12 m | 55% at 40 m | 3.4 N s |
| .40 S&W | 25 | x2.3 | 1 | 330 m/s | 10.17 x 14 mm | 11 cm | 12 m | 55% at 38 m | 4.3 N s |
| 10 mm Auto | 28 | x2.3 | 1 | 380 m/s | 10.17 x 15.5 mm | 12 cm | 15 m | 60% at 45 m | 5.3 N s |
| .45 ACP | 27 | x2.3 | 1 | 255 m/s | 11.48 x 17 mm | 13 cm | 10 m | 50% at 35 m | 4.2 N s |
| .50 AE | 45 | x2 | 1 | 450 m/s | 12.7 x 22 mm | 15 cm | 20 m | 70% at 55 m | 10.3 N s |
| .38 Special | 35 | x2.5 | 1 | 265 m/s | 9.07 x 18 mm | 10 cm | 10 m | 50% at 35 m | 3.1 N s |
| .357 Magnum | 53 | x2 | 1 | 425 m/s | 9.07 x 17 mm | 10 cm | 15 m | 60% at 45 m | 5.5 N s |
| .44 Magnum | 64 | x2 | 1 | 440 m/s | 10.9 x 19 mm | 15 cm | 22 m | 60% at 60 m | 8.2 N s |
| 5.45x39 mm | 23 | x2.5 | 1 | 880 m/s | 5.6 x 25.5 mm | 41 cm | 20 m | 65% at 60 m | 4.4 N s |
| 5.56x45 mm | 23 | x2.5 | 1 | 900 m/s | 5.7 x 23 mm | 37 cm | 18 m | 62% at 55 m | 5.9 N s |
| 7.62x39 mm | 30 | x2.5 | 1 | 715 m/s | 7.92 x 26.8 mm | 41 cm | 25 m | 72% at 70 m | 7.8 N s |
| .300 BLK subsonic | 32 | x2.5 | 1 | 305 m/s | 7.82 x 38 mm | 23 cm | 15 m | 60% at 45 m | 5.1 N s |
| 12 gauge | 13 | x1.25 | 9 | 400 m/s | 8.38 x 8.38 mm | 47 cm | 6 m | 20% at 30 m | 17 N s |
| 12 gauge magnum | 12 | x1.25 | 12 | 410 m/s | 8.38 x 8.38 mm | 47 cm | 7 m | 20% at 33 m | 23 N s |
| 20 gauge | 13 | x1.25 | 8 | 400 m/s | 6.1 x 6.1 mm | 47 cm | 5 m | 20% at 26 m | 12 N s |

### The recoil pattern

Each shot kicks the camera up and to the side (`Hands.kickShot` in
`game/src/weapon.zig`). Shot n of a string (from 0) kicks:

- up: kick x (1 + ramp x min(n, 8) / 8). The climb grows over the first 8
  shots.
- to the right: sway x (bias + wobble x sin(freq x n + phase)), and a
  random part of up to a quarter of the sway. The phase is 1.7 x the
  number of the model in its class, so each model starts its wave at
  another point.
- The sights halve the kick.

The class gives the shape of the pattern:

| Class | Shape | Ramp | Bias | Wobble | Freq | Recovery (1/s) |
|---|---|---|---|---|---|---|
| Rifle | climbs, and drifts to the right in a slow wave | 0.6 | +0.35 | 0.7 | 0.55 | 6 |
| Carbine | climbs straight, a small drift to the left | 0.4 | -0.15 | 0.6 | 0.8 | 7 |
| Bullpup | kicks straight back into the shoulder | 0.3 | +0.05 | 0.5 | 1.4 | 7 |
| SMG | a fast shake from side to side | 0.5 | +0.15 | 0.9 | 1.7 | 8 |
| Shotgun | one big kick a shot | 0 | +0.2 | 0.7 | 2.3 | 4.5 |
| Sawn-off | one big kick a shot | 0 | +0.3 | 0.8 | 2.9 | 4 |
| Pistol | a small kick, a random side | 0.25 | 0 | 0.8 | 2.2 | 9 |
| Revolver | a big kick, up and to the right | 0 | +0.3 | 0.6 | 1.2 | 5 |

**Recovery**: the camera goes back to the aim at the recovery rate of the
gun (`Hands.recover`). For an automatic gun the recovery starts when the
next shot does not come (the interval + 0.04 s). For other guns it starts
0.12 s after the shot. A pull down of the mouse during the recoil counts as
recovery, so the view does not go lower than the aim. A pause of 0.15 s
more ends the string, and the next shot starts the pattern again.

### The guns

Each of the 34 guns, with the reason for its calibre. The models are
low-poly, so a calibre is a guess from the look: the magazine, the barrel,
the stock and the size.

| Gun | Model | Calibre | Barrel | Stock | Weight | Why this calibre |
|---|---|---|---|---|---|---|
| RIFLE 1 | AssaultRifle_1 | 9x19 mm | 24 cm, standard | no | light | A straight, thin magazine on a short AK with no stock: an AK in 9 mm, as the Vityaz. |
| RIFLE 2 | AssaultRifle_2 | 7.62x39 mm | 41 cm, standard | yes | medium | A wood stock, a curved magazine and a full barrel: the AKM. |
| RIFLE 3 | AssaultRifle_3 | 7.62x39 mm | 31 cm, short | no | light | An AK with no stock and a short barrel: an AK pistol. |
| RIFLE 4 | AssaultRifle_4 | 7.62x39 mm | 41 cm, standard | yes | light | A steel folding stock and a full barrel: the AKMS. |
| RIFLE 5 | AssaultRifle_5 | 5.45x39 mm | 41 cm, standard | yes | medium | A black polymer stock and fore-end: the AK-74. |
| CARBINE 1 | AssaultRifle2_1 | 5.56x45 mm | 51 cm, long | yes | heavy | A fixed A2 stock and the longest barrel: an M16A4. |
| CARBINE 2 | AssaultRifle2_2 | 5.56x45 mm | 37 cm, standard | yes | medium | A fixed stock and a carbine barrel: an M4. |
| CARBINE 3 | AssaultRifle2_3 | 5.56x45 mm | 41 cm, standard | no | light | An AR-15 with no stock and a short, straight 20-round magazine. |
| CARBINE 4 | AssaultRifle2_4 | .300 BLK subsonic | 18 cm, snub | yes | light | A very short barrel and a short stock on an AR: a Honey Badger, made for subsonic .300 Blackout. |
| BULLPUP 1 | Bullpup_1 | 5.56x45 mm | 51 cm, long | yes | heavy, bullpup | A long body, a vertical front grip and a straight box magazine: a Steyr AUG. |
| BULLPUP 2 | Bullpup_2 | 5.56x45 mm | 41 cm, standard | yes | medium, bullpup | Bullpup 1 with a shorter body, so a shorter barrel. |
| BULLPUP 3 | Bullpup_3 | 7.62x39 mm | 41 cm, standard | yes | heavy, bullpup | A curved AK magazine behind the grip: an AK bullpup, as the Valmet M82. |
| SMG 1 | SubmachineGun_1 | .45 ACP | 14 cm, short | no | light | A straight magazine for a straight-walled case, and no stock. |
| SMG 2 | SubmachineGun_2 | 9x19 mm | 20 cm, standard | yes | medium | A skeleton side-folding stock, as the UMP 9. |
| SMG 3 | SubmachineGun_3 | 4.6x30 mm | 18 cm, standard | yes | light | A sliding rod stock and a vertical front grip: an MP7. |
| SMG 4 | SubmachineGun_4 | 9x19 mm | 11 cm, snub | no | light | A curved magazine for the tapered 9 mm case, and no stock: an MP5K. |
| SMG 5 | SubmachineGun_5 | 9x19 mm | 40 cm, long | yes | heavy | SMG 2 with a long barrel: a pistol-calibre carbine. |
| SHOTGUN 1 | Shotgun_1 | 12 gauge | 47 cm, standard | yes | medium | A grey synthetic stock and an 18.5-inch barrel: a police pump gun. |
| SHOTGUN 2 | Shotgun_2 | 12 gauge | 61 cm, long | yes | heavy | A long barrel, a full-length tube magazine and a wood stock: a field gun. |
| SHOTGUN 3 | Shotgun_3 | 12 gauge magnum | 61 cm, long | yes | heavy | The longest barrel and a short tube magazine: a waterfowl gun for 3-inch magnum shells. |
| SHOTGUN 4 | Shotgun_4 | 20 gauge | 56 cm, standard | yes | light | A thin single barrel, a short fore-end and a light frame. |
| SHOTGUN 5 | Shotgun_ShortStock | 12 gauge | 36 cm, short | no | light | A pump with a bird's-head grip and no stock, as the Shockwave. |
| SAWN-OFF 1 | Shotgun_SawedOff | 12 gauge | 30 cm, snub | no | light | A double-barrel 12 gauge with the barrels and the stock cut down. |
| PISTOL 1 | Pistol_1 | .45 ACP | 13 cm, standard | no | heavy | A black 1911 with wood grips. |
| PISTOL 2 | Pistol_2 | 9x19 mm | 13 cm, standard | no | heavy | A two-tone 1911 pattern: a steel 9 mm pistol. |
| PISTOL 3 | Pistol_3 | .40 S&W | 11 cm, standard | no | medium | A service pistol with a rail and a heavy slide. |
| PISTOL 4 | Pistol_4 | .50 AE | 15 cm, long | no | heavy | A tall slide and a long grip: a big-frame pistol, as the Desert Eagle. |
| PISTOL 5 | Pistol_5 | 9x19 mm | 10 cm, short | no | light | A compact polymer pistol, as the Glock 19. |
| PISTOL 6 | Pistol_6 | 10 mm Auto | 15 cm, long | no | medium | A long slide and a full rail: a long-slide hunting pistol. |
| REVOLVER 1 | Revolver_1 | .357 Magnum | 10 cm, short | no | medium | A medium frame and a 4-inch barrel: a service .357. |
| REVOLVER 2 | Revolver_2 | .44 Magnum | 15 cm, long | no | heavy | A large frame and a heavy barrel with a full under-lug. |
| REVOLVER 3 | Revolver_3 | .357 Magnum | 15 cm, long | no | heavy | A vent rib and a full under-lug, as the Colt Python. |
| REVOLVER 4 | Revolver_4 | .357 Magnum | 6 cm, snub | no | light | A snub barrel with a full under-lug: a .357 for carry. |
| REVOLVER 5 | Revolver_5 | .38 Special | 15 cm, long | no | light | A slim frame and a thin barrel: a .38 target revolver. |

### The stats and the time to kill

`zig build guns` (in `game/`) prints these tables and writes
`server/guns.json`. Kick is in mrad (1 mrad is 1 mm at 1 m). The time to
kill (TTK) is from the first shot to the shot that kills a player of 100
health when every bullet hits the body. For buckshot it uses the share of
the pellets that hit a player aimed at the chest, with the hip cone. A dash
means that one magazine cannot kill at that distance (buckshot does no
damage past its reach).

| Gun | Body | Head | Fire | Bullet | Range | Kick up, side | Recovery | Speed | Reload | TTK 5 m | TTK 10 m | TTK 40 m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RIFLE 1 | 23 | 53 | 801 rpm | 421 m/s | 36 m | 10.8, 6.3 | 4.0 | 98% | 2.3 s | 0.30 s | 0.30 s | 0.45 s |
| RIFLE 2 | 30 | 75 | 561 rpm | 715 m/s | 65 m | 13.0, 5.9 | 6.0 | 93% | 2.3 s | 0.32 s | 0.32 s | 0.32 s |
| RIFLE 3 | 29 | 73 | 561 rpm | 676 m/s | 59 m | 21.8, 12.8 | 4.0 | 98% | 2.3 s | 0.32 s | 0.32 s | 0.32 s |
| RIFLE 4 | 30 | 75 | 561 rpm | 715 m/s | 65 m | 15.6, 7.0 | 6.6 | 96% | 2.3 s | 0.32 s | 0.32 s | 0.32 s |
| RIFLE 5 | 23 | 58 | 731 rpm | 880 m/s | 49 m | 8.0, 3.6 | 6.0 | 93% | 2.3 s | 0.33 s | 0.33 s | 0.41 s |
| CARBINE 1 | 24 | 60 | 732 rpm | 960 m/s | 47 m | 7.4, 2.6 | 6.3 | 92% | 2.1 s | 0.33 s | 0.33 s | 0.33 s |
| CARBINE 2 | 23 | 58 | 732 rpm | 900 m/s | 42 m | 9.0, 3.1 | 7.0 | 96% | 2.1 s | 0.33 s | 0.33 s | 0.41 s |
| CARBINE 3 | 23 | 58 | 732 rpm | 919 m/s | 44 m | 15.1, 6.9 | 4.6 | 101% | 2.1 s | 0.33 s | 0.33 s | 0.41 s |
| CARBINE 4 | 31 | 78 | 526 rpm | 290 m/s, sub | 31 m | 9.5, 3.3 | 7.7 | 99% | 2.1 s | 0.34 s | 0.34 s | 0.57 s |
| BULLPUP 1 | 24 | 60 | 600 rpm | 960 m/s | 47 m | 6.6, 1.6 | 6.3 | 90% | 2.5 s | 0.35 s | 0.35 s | 0.35 s |
| BULLPUP 2 | 23 | 58 | 600 rpm | 919 m/s | 44 m | 8.0, 2.0 | 7.0 | 94% | 2.5 s | 0.35 s | 0.35 s | 0.40 s |
| BULLPUP 3 | 30 | 75 | 460 rpm | 715 m/s | 65 m | 8.3, 2.1 | 6.3 | 90% | 2.5 s | 0.39 s | 0.39 s | 0.39 s |
| SMG 1 | 27 | 62 | 622 rpm | 259 m/s, sub | 23 m | 12.1, 9.4 | 5.3 | 109% | 1.8 s | 0.29 s | 0.29 s | 0.68 s |
| SMG 2 | 22 | 51 | 800 rpm | 406 m/s | 34 m | 6.0, 3.6 | 8.0 | 104% | 1.8 s | 0.30 s | 0.30 s | 0.45 s |
| SMG 3 | 17 | 39 | 988 rpm | 720 m/s | 44 m | 5.2, 3.1 | 8.8 | 107% | 1.8 s | 0.30 s | 0.30 s | 0.43 s |
| SMG 4 | 21 | 48 | 800 rpm | 360 m/s | 28 m | 10.1, 7.9 | 5.3 | 109% | 1.8 s | 0.30 s | 0.30 s | 0.60 s |
| SMG 5 | 23 | 53 | 800 rpm | 466 m/s | 36 m | 4.9, 3.0 | 7.2 | 100% | 1.8 s | 0.30 s | 0.30 s | 0.45 s |
| SHOTGUN 1 | 13 x9 | 16 x9 | 71 rpm | 400 m/s | 14 m | 45.0, 18.0 | 4.5 | 95% | 2.6 s | one shot | 0.85 s | - |
| SHOTGUN 2 | 13 x9 | 16 x9 | 71 rpm | 421 m/s | 15 m | 36.9, 14.8 | 4.0 | 91% | 2.6 s | one shot | 0.85 s | - |
| SHOTGUN 3 | 12 x12 | 15 x12 | 57 rpm | 432 m/s | 17 m | 47.7, 19.1 | 4.0 | 91% | 2.6 s | one shot | 1.05 s | - |
| SHOTGUN 4 | 13 x8 | 16 x8 | 79 rpm | 414 m/s | 12 m | 40.2, 16.1 | 5.0 | 98% | 2.6 s | one shot | 1.51 s | - |
| SHOTGUN 5 | 13 x9 | 16 x9 | 71 rpm | 379 m/s | 12 m | 75.6, 39.3 | 3.0 | 100% | 2.6 s | one shot | 0.85 s | - |
| SAWN-OFF 1 | 12 x9 | 15 x9 | 240 rpm | 366 m/s | 12 m | 72.0, 43.2 | 4.4 | 103% | 2.0 s | 0.25 s | - | - |
| PISTOL 1 | 27 | 62 | 389 rpm | 255 m/s, sub | 23 m | 15.7, 5.5 | 8.1 | 102% | 1.4 s | 0.46 s | 0.46 s | 1.08 s |
| PISTOL 2 | 21 | 48 | 500 rpm | 372 m/s | 29 m | 13.1, 4.6 | 8.1 | 102% | 1.4 s | 0.48 s | 0.48 s | 0.96 s |
| PISTOL 3 | 25 | 58 | 420 rpm | 330 m/s, sub | 26 m | 19.5, 6.8 | 9.0 | 106% | 1.4 s | 0.43 s | 0.43 s | 1.00 s |
| PISTOL 4 | 45 | 90 | 233 rpm | 450 m/s | 49 m | 33.7, 11.8 | 8.1 | 102% | 1.4 s | 0.51 s | 0.51 s | 0.51 s |
| PISTOL 5 | 21 | 48 | 500 rpm | 353 m/s | 27 m | 19.2, 6.7 | 9.9 | 109% | 1.4 s | 0.48 s | 0.48 s | 0.96 s |
| PISTOL 6 | 29 | 67 | 375 rpm | 397 m/s | 36 m | 23.3, 8.2 | 9.0 | 106% | 1.4 s | 0.48 s | 0.48 s | 0.64 s |
| REVOLVER 1 | 53 | 106 | 130 rpm | 425 m/s | 34 m | 40.0, 12.0 | 5.0 | 104% | 2.4 s | 0.46 s | 0.46 s | 0.92 s |
| REVOLVER 2 | 64 | 128 | 108 rpm | 440 m/s | 46 m | 46.1, 13.8 | 4.5 | 100% | 2.4 s | 0.56 s | 0.56 s | 0.56 s |
| REVOLVER 3 | 55 | 110 | 130 rpm | 461 m/s | 39 m | 32.8, 9.8 | 4.5 | 100% | 2.4 s | 0.46 s | 0.46 s | 0.92 s |
| REVOLVER 4 | 50 | 100 | 130 rpm | 384 m/s | 28 m | 48.0, 14.4 | 5.5 | 107% | 2.4 s | 0.46 s | 0.46 s | 1.38 s |
| REVOLVER 5 | 36 | 90 | 198 rpm | 287 m/s, sub | 26 m | 29.5, 8.8 | 5.5 | 107% | 2.4 s | 0.61 s | 0.61 s | 1.52 s |

The time to kill of each class:

| Class | 10 m | 40 m |
|---|---|---|
| Rifle | 0.30 to 0.33 s | 0.32 to 0.45 s |
| Carbine | 0.33 to 0.34 s | 0.33 to 0.57 s |
| Bullpup | 0.35 to 0.39 s | 0.35 to 0.40 s |
| SMG | 0.29 to 0.30 s | 0.43 to 0.68 s |
| Shotgun | 0.85 to 1.51 s (one shot at 5 m) | - |
| Sawn-off | - (0.25 s at 5 m) | - |
| Pistol | 0.43 to 0.51 s | 0.51 to 1.08 s |
| Revolver | 0.46 to 0.61 s | 0.56 to 1.52 s |

The balance, for hipfire on a laptop (100 health):

- **No gun is the fastest at every range.** At 10 m the SMGs kill fastest.
  At 40 m the 7.62x39 mm AKs and the long-barrel 5.56 mm guns kill fastest.
  For the secondary, the .40 S&W pistol is the fastest at 10 m, and the
  .50 AE pistol at 40 m. `zig build test` checks that the fastest gun at
  10 m is not the fastest gun at 40 m, in each slot.
- **The price of each strong gun.** The 7.62x39 mm AKs kick hard. The long-barrel guns are heavy and slow. A gun with no
  stock is fast to carry and to aim, but kicks and sways much more. The
  pistol rounds in long guns (RIFLE 1, the SMGs) lose damage fast with the
  distance.
- **No gun loses to another gun in everything.** `zig build guns` lists
  each gun that another gun of its slot beats in every score: the time to
  kill at 5 m, 10 m and 40 m, the recoil, the speed, the reload, the cone,
  the range, and the head damage at 10 m and 40 m. The list is empty.
- **Head hits**: about 2.5 times a body hit for rifle rounds, and 2 to 2.5
  times for handgun rounds. Only the .357 Magnum and the .44 Magnum
  revolvers kill with one head hit. The .44 does it to about 45 m.
- **The cone**: the first shot goes almost where the crosshair is. The cone
  grows with the heat (the trigger held), with the run speed (+0.008 to
  +0.02) and in the air (+0.05). The sights make it 75% smaller (30% for
  the shotguns). The crosshair shows the cone.
- **Buckshot** kills in one shot up close (5 m). It does no damage past its
  reach (31 to 44 m, longer with a longer barrel).

The server has the same numbers: `server/guns.json`. `zig build guns`
writes it from the gun model, and `zig build test` fails when it is old.

### The models

The Quaternius "Ultimate Gun Pack" (CC0, no attribution necessary, see
`assets/guns/LICENSE.md`): every gun except the six sniper rifles (they have
scopes, and this is a hipfire game). No other gun has a scope. The knife is
the `Bayonet_2` accessory. The other accessories (silencers, scopes,
grips, stocks, bipod, tripod, flashlight) are not used.

`scripts/convert-gun.ts` converts the OBJ files of the pack into one file,
`game/src/assets/guns.bin` (364 KB): quantised positions, the faces as
polygons, and runs of materials. The game makes the triangles at start.
The converter finds the magazine of each rifle, carbine, bullpup and SMG
(a tall part below the receiver, near the grip) and splits it out, so the
reload animation can move it. The repository keeps only the output.

```bash
bun apps/action/scripts/convert-gun.ts "<pack>/OBJ"                   # write guns.bin
bun apps/action/scripts/convert-gun.ts "<pack>/OBJ" --list Bullpup_1  # the parts of one model
```

## Grenades

G throws an impact grenade. It goes off when it touches a wall, the floor or
a player. A thin smoke trail shows its path. The blast is a short flash,
yellow-white streaks that fly out to about the blast radius and cool to
orange, and a little smoke. `game/src/grenade.zig` has the model:

- The blast radius is 5 m. The damage is 100 to 1.5 m, then it falls to 0 at
  5 m. The thrower can also get hurt.
- Cover counts. The blast checks three points on each player: the legs, the
  chest and the head. Each point that the blast can see gives a third of the
  damage at its distance. The chest and the head move with the lean.
- Deathmatch: 3 grenades in each life. Practice: no limit. A grenade knocks
  down the plates that it can see in the radius.
- With the debug screen on, a dotted line shows the path of the aimed throw.
  Small translucent cubes show where a player would get hit, for the aimed
  throw and for each grenade in the air. Red is the centre, yellow the edge.

## Bullet sounds

`game/src/audio/` makes the sounds of the bullets sample by sample. It
imports nothing from the game, so another game can use it.
`game/src/sounds.zig` gives it the listener, the room from the map and the
bullet of each gun, and plays the samples (sw_audio `Audio.playBuffer`).
The effects volume (`sfx_volume`) and the master volume (`volume`) apply
to every bullet sound.

### The near miss

A bullet of another player that passes in `snd_nearmiss_distance` (25 m)
of you makes a sound. The bullet speed comes from the gun model (the
calibre and the barrel, see [The gun model](#the-gun-model)). A bullet
faster than 343 m/s is supersonic. CARBINE 4, SMG 1, PISTOL 1, PISTOL 3
and REVOLVER 5 are subsonic.

- **Supersonic: a crack.** The bullet pulls a shock wave in the shape of
  a cone (the Mach cone, with the half angle asin(1/M), M = speed / 343).
  You hear the shock as an N-wave: a sudden rise of pressure, a straight
  fall to the same depth below the air pressure, and a sudden return, in
  0.1 to 0.4 ms. The shock leaves the path where the angle between the
  path and the line to you is acos(1/M). That point is before the point
  of the path nearest to you. So the crack comes from a point of the path
  between the shooter and the point nearest to you.
- **Subsonic: a whiz.** There is no shock wave. You hear the noise of the
  turbulent wake: noise at the vortex shedding frequency, 0.2 x speed /
  diameter. It is high and loud while the bullet comes, and low after it
  goes (the Doppler shift). It moves across the head with the bullet.
- **The order.** The muzzle report arrives after distance / 343 s. A
  crack never comes after the muzzle report. The two come together at the
  edge of the cone, and downrange the crack comes first. The gap grows
  with the distance to the shooter. A whiz comes after the muzzle report.
- **Direction.** Each ear gets its own time and level (see
  [Where you hear a sound](#where-you-hear-a-sound)). The crack comes from
  its emission point, the whiz from the bullet as it moves.
- **Distance.** The N-wave peak falls as b^-3/4 and its length grows as
  b^1/4, so a far crack is quieter and less sharp. The whiz falls as 1/r
  and is loud only in a few metres.

The formulas. x is the distance along the path from the muzzle to the
point nearest you, b is the miss distance, and d and l are the bullet
diameter and length (the bullet size in the calibre table). p0 is the air
pressure, 101325 Pa:

| Value | Formula |
|---|---|
| Emission point | s = x - b / sqrt(M^2 - 1) along the path. When s is not on the path (you are behind the cone of the muzzle, or the bullet hit something first), there is no crack. |
| Crack arrival | t = (x + b sqrt(M^2 - 1)) / v |
| Muzzle report arrival | t = the distance to the muzzle / 343 |
| N-wave peak | 0.53 p0 (M^2 - 1)^(1/8) d / (b^(3/4) l^(1/4)) Pa. About 1 kPa at a 1 m miss for 5.56 mm. |
| N-wave length | 1.82 M b^(1/4) d / (343 (M^2 - 1)^(3/8) l^(1/4)) s. About 0.1 ms at a 1 m miss for 5.56 mm. |
| Whiz level | v^3 (a dipole source: the power goes as v^6), 1 / r, and D^2 with the Doppler factor D = 1 / (1 - M cos phi), at most 2.5 |

The sources:

- G. B. Whitham, "The flow pattern of a supersonic projectile",
  Communications on Pure and Applied Mathematics 5 (1952): the N-wave peak
  and length.
- R. Stoughton, "Measurements of small-caliber ballistic shock waves in
  air", J. Acoust. Soc. Am. 102 (1997): small-arms measurements that agree
  with Whitham.
- R. C. Maher, "Acoustical characterization of gunshots", IEEE Workshop on
  Signal Processing Applications for Public Security and Forensics (2007):
  the geometry of the muzzle blast and the shock wave.
- A. P. Dowling and J. E. Ffowcs Williams, "Sound and Sources of Sound"
  (1983): the Doppler factor and the convective gain of a moving source.

The limits of the model:

- The bullet keeps its speed over the path.
- Near M = 1 Whitham's far-field formulas do not hold. The model uses
  M^2 - 1 of at least 0.09.
- After the N-wave, 6 ms of bright noise stand for the scatter from near
  surfaces. This part is an estimate. It makes a wave of a few samples read
  as a crack on small speakers.
- The whiz is an aeroacoustic estimate (the shedding frequency, the v^3
  level). It is not a measurement of bullets.
- Buckshot: the model takes a ball as a bullet with l = d. A shot makes one
  crack, from its first pellet.

### Impacts

A bullet that hits a surface in `snd_impact_distance` (60 m) of you makes
the sound of the surface material. The sound starts at the hit when the
bullet arrives (the distance / the bullet speed). It reaches you after the
distance to you / 343 s more. Your own shots make impact sounds too, for
the first 3 pellets. A hit on a player or a dummy is `flesh`, and a hit on
a plate is `metal`.

Each material is modal synthesis with noise, the methods of
`utils/tube-sounds`. A strike is a short burst of filtered noise. The
modes are decaying sines, and the loss factor eta of the material sets
the decay of a mode at f: e^(-pi f eta t). Metal and glass have a small
loss and ring. Wood and stone have a large loss. The decay against the frequency
is the strongest cue to a material (R. L. Klatzky, D. K. Pai and E. P.
Krotkov, "Perception of material from contact sounds", Presence 9, 2000).
Grains are fragments that click and fall. The levels and the frequencies
are estimates from the character of each material. They are not
measurements of bullet hits. The energy of the bullet (its damage) sets
the level.

### Impact effects

A bullet that hits the map shows a small effect of the material at the hit
(`game/src/impact_fx.zig`): your shots, the shots of other players, and the
rounds of the NPC shooter. A hit on a player shows the flesh effect. The
effect of a round of the NPC starts when the bullet arrives. The effects
use the cheap method of the grenade blast: translucent billboards in the
translucent pass, with no new pipeline. A puff is a soft quad that faces
the camera. A bit is a thin quad along its velocity, under gravity and
drag. The pools are rings of 160 puffs and 480 bits, so automatic fire has
a fixed cost.

| Material | Effect |
|---|---|
| `concrete` | a grey dust cloud and grey chips |
| `brick` | red-brown dust and chips |
| `plaster` | a large white puff and a few flakes |
| `tile` | white shards that fly fast, and a little powder |
| `metal` | sparks (they glow) and a short hot flash |
| `sheet_metal` | fewer sparks and a little paint dust |
| `glass` | shards that glint and fall, and a faint powder |
| `wood` | long splinters and light brown dust |
| `ballast` | a low cloud of grey-brown dust, and stones |
| `earth` | a spray of dirt |
| `fabric` | a small puff of fibres |
| `flesh` | a red mist and drops |

### Where you hear a sound

- **The head.** The far ear hears a sound later, by up to 0.66 ms
  (Woodworth's spherical head), and quieter and duller. A sound from
  behind is a little duller in both ears.
- **The path.** 1 / r, and the air absorption: a low-pass at about 16 kHz
  at 10 m and 6.6 kHz at 50 m (from ISO 9613-1).
- **A wall between you and the sound.** The sound is about 10 dB quieter,
  with a low-pass at 1.2 to 1.5 kHz.
- **The room.** Rays from your head find up to 4 reflectors: the floor,
  the ceiling, and the nearest wall along X and along Z. Each one gives an
  echo: an image source, or for a crack an image listener with its own
  Mach cone. A diffuse tail follows: 1.5 s deep underground (below
  `map.underground_y`), 1 s under a ceiling with walls, else 0.25 to
  0.65 s.

### Surface materials

Each box and each decoration of a map has a surface material (`surface`
in `map.Box` and `map.Decor`). The field has no default, so the compiler
stops on a box or a decoration without a material. A shot hits boxes
only. A hit takes the material of the smallest decoration in 3 cm of the
hit point, else the material of the box (`map.surfaceAt`). Thus a sleeper
on the ballast is wood, a window of the District train is glass, and the
road over the floor of the ticket hall is concrete.

| Material | The sound | Earl's Court boxes, decoration | Arena boxes | For example |
|---|---|---|---|---|
| `concrete` | a sharp crack, a thud and grit | 171, 130 | 80 | platforms, stairs, decks, pavements, the road, painted lines |
| `brick` | a duller crack and more crumble | 67, 0 | 0 | the shed walls, the concourses, the terraces |
| `plaster` | a soft crack and a puff | 4, 3 | 0 | the ticket hall walls, the painted fronts on the roads |
| `tile` | a brittle tink and shards | 53, 13 | 1 | the tiled passages and platforms, the arena floor, the slate of the roof |
| `metal` | a click and a long high ring | 156, 372 | 13 | rails, railings, posts, frames, escalator steps, roof ribs |
| `sheet_metal` | a pank and a low bong | 38, 123 | 12 | the trains, the containers, the bus, lift doors, ticket gates, signs |
| `glass` | a bright crack and falling shards | 46, 158 | 6 | lamps, windows, the lift shafts, the Warwick Road front and rotunda |
| `wood` | a hollow knock and splinters | 34, 2528 | 14 | sleepers, benches, crates, the TARDIS, poster boards |
| `ballast` | a chuff and a clatter of stones | 13, 0 | 0 | the track beds |
| `earth` | a dull thup and a spray of dirt | 12, 0 | 0 | the ground under the buildings, the banks of the cuttings |
| `fabric` | a soft thup | 0, 6 | 0 | the gangways between the cars of the District train |
| `flesh` | a wet slap and a thud | 0, 0 | 0 | players and dummies (not a map surface) |

The floorplan audit prints these counts. Its exit code is 1 when a
material does not fit the look of its surface (`map.surfaceFits`): an
emissive surface must be glass, a brick surface brick, a wood surface
wood. `zig build test` checks the same.

### The box limit

`map.max_boxes` is 768. Earl's Court uses 644 boxes, the arena 126.

- A map with more boxes fails `zig build test` and every floorplan command
  (exit code 1).
- In the game, `map.add` does not add a box past the limit, and it changes
  no box. `map.dropped` counts the boxes, and `map.load` logs an error.
  A lift or a train whose boxes are not in the map is not made.
- The limit was 640. The secret room of VAPES N MORE needed more, so it
  is 768. The frame cost does not change. The scene shader loops over the boxes for the ambient
  occlusion within 45 m of the eye (`uploadBoxes` in
  `game/src/render.zig`), not over `max_boxes`: at most 124 boxes at a
  spawn point of Earl's Court (110 on average). A higher limit costs 32
  bytes of GPU buffer for each box, and frame time only for the boxes
  that a map adds.

### Listen to it

The console has two commands to listen to the sounds offline:

```
nearmiss rifle2 1 40     // a 7.62x39 mm crack: a miss 1 m to your right, the shooter 40 m in front
nearmiss pistol1 0.5 20  // a .45 ACP whiz, 0.5 m to your right
impact glass 3           // a rifle bullet on glass, 3 m in front of you
```

`nearmiss [gun] [miss] [range]` takes a class and a number (`rifle2`,
`carbine4`, `smg1`), the miss distance to your right in metres, and the
distance to the shooter in front of you. It prints the arrival times.
`impact <material> [distance]` plays a strike on any material.

## Stairs and escalators

- **Ramps**: an invisible ramp covers each staircase and each escalator
  (`map.Ramp` in `game/src/map.zig`). Its surface goes through the front
  edges of the steps. The player stands on the ramp. So the feet and the
  camera move up and down in a straight line, with no jump at each step.
  The steps under the ramp stay the targets for shots and grenades.
- **Step up and step down**: the player walks up a step of up to 0.45 m.
  A player on the ground also stays on it when the floor goes down by up to
  0.45 m. Without the step down, a player who walks down the stairs flies
  off each step. Then the head hits the edge of the stair well at the
  bottom. `game/src/player.zig` has the model.
- **Escalators**: a lane carries a player who stands on it at 0.65 m/s.
  The carry does not count as walking, so a rider has no head bob. The down
  lane carries a rider 0.4 m past its last step, onto the floor.
- `stairs()` in `game/src/maps/earls_court.zig` makes the ramp of a
  staircase. Give it the floor heights at the top and at the bottom.

## Your body

In first person you see your own body, as in Halo. Look down to see the
legs, the boots and the torso. `game/src/body.zig` has the model of each
body: yours, the other players and the dummies.

- **What shows**: the legs and the torso. The camera does not draw the
  head, the arms or the weapon in your hands, so nothing blocks the view
  and the view model has the weapon alone. These parts cast a shadow, so
  your shadow holds the weapon.
- **Where**: the body is 0.45 m behind the eye (`own_back`). The eye is in
  front of the chest, so a look down shows the legs and the feet. On a
  slope the body stands on the floor under it. No part that the camera
  shows comes nearer than 0.3 m to the eye.
- **The walk**: each leg has a thigh, a shin and a knee (two-bone IK). The
  steps follow the distance on the ground, with the phase of the head bob:
  a foot lands at the low point of the bob. A planted foot stays on the
  floor. A strafe moves the legs to the side, and in the air the feet come
  up. The other players and the dummies walk the same way.
- **The lean**: the upper body turns about the hips with the camera. There
  is no crouch.
- **Stairs**: the camera rides the ramp over the steps (see
  [Stairs and escalators](#stairs-and-escalators)). Your body steps on the
  treads. Each planted foot goes to the tread under it, the body goes down
  to the lower foot, and the knee of the higher foot bends. The model of
  another player stays on the ramp, so it matches the hit boxes. Its feet
  can be up to one rise over the treads. On an escalator the carry moves
  your planted feet over the steps.
- **Shadows**: the sun shadow pass draws your body. The sun shadow map is
  2048 texels over the map (about 8 cm a texel), so the sun shadow is
  soft. Each frame also draws your body into the shadow maps of the 4
  nearest map lights (`body_lights` in `game/src/render.zig`), so
  underground your shadow is sharp. The view model gets no shadow from your
  body.
- **The cvar `own_body`** (saved, default 1): 0 hides your body. Its shadow
  stays.

## Lifts

Earl's Court has three lifts. Press F on a call button or on a cab button.

| Lift | Levels | Doors | Speed |
|---|---|---|---|
| 0 and 1 (District) | the spur (4.8 m) and island A or B (0 m) | north | 1.6 m/s |
| 2 (deep) | the Earls Court Road concourse (4.8 m) and the Piccadilly corridor (-15 m) | west | 3.2 m/s |

- **The cab** is a floor and a lit ceiling, 2.45 m apart (dynamic boxes).
  The cab floor is 2 cm above the landing. `lift()` in
  `game/src/maps/earls_court.zig` makes a shaft, its cab, its doors and
  its buttons.
- **Moving platforms**: a player who stands on a dynamic solid box moves
  with it (`map.Platform` in `game/src/map.zig`). In each tick (`tick` in
  `game/src/main.zig`):
  1. Before anything moves, `map.platformUnder` finds the box under the
     centre of the feet, with its top within 0.12 m of the feet.
  2. The boxes move: the server corrections (`syncLift`), `stepLifts` and
     `stepTrain`.
  3. `Player.ride` (`game/src/player.zig`) moves the player by the move of
     that box. The feet keep their height above its top. A wall stops the
     move along X and Z. A player that something else moved in the tick
     (a spawn, the train push) does not ride.

  Thus a rider stays on the cab floor at any speed, and through a server
  correction. A new moving thing needs no new code: make it a dynamic
  solid box, and the same three calls carry its riders.
- **The shaft must be clear.** A slab across a shaft catches a rider on
  the way down: the step up (see [Stairs and escalators](#stairs-and-escalators))
  puts the feet on the slab, and the cab goes on without the player. On
  the way up the slab only lifts the feet for a moment. So no map shape may
  be in a shaft. Cut each shaft out of each floor and ceiling that it goes
  through (`map.carve`). The floorplan audit checks each shaft and each
  landing (see [The floorplan tool](#the-floorplan-tool)).
- **Deathmatch**: the server runs the lifts (`server/index.ts`, the same
  state machine as `map.zig`). A call goes to the server, and the server
  sends it to each client. Each snapshot corrects a cab that is more than
  0.3 m from the cab of the server. The `st` message names the cab that
  the player stands in (`lift`, -1 for none). The other clients draw that
  player on the floor of their own cab. So the cab and the player agree on
  each client.

## Lean, head bob and settings

- **Lean**: hold Q or E. The upper body turns about the hips. At full lean
  the eye moves 0.34 m to the side and the camera rolls 8 degrees. The hit
  boxes of the torso and the head move with it, and so do the grenade damage
  points. Other players see the lean (`lean` in the `st` and `snap`
  messages). A wall stops the lean before the head goes into it: a box of
  0.32 m around the eye must stay clear. `game/src/player.zig` has the model.
- **Head bob**: the amount follows the speed on the ground. There is no bob
  in the air or when the player stands still. Aiming down the sights makes
  it smaller.
- **Settings**: 3 on the main menu, or SETTINGS on the pause screen. Drag a
  slider, or use the arrow keys. Esc closes the panel. The values apply at
  once. They are cvars (see [Cvars](#cvars)), so the console changes the
  same values, and the game saves them in local storage.

| Setting | Cvar | Range | Default |
|---|---|---|---|
| Head bob | `head_bob` | 0 (off) to 200% | 100% |
| Master volume | `volume` | 0 to 100%. It scales every sound. | 100% |
| Effects volume | `sfx_volume` | 0 to 100%: the guns, the cracks and whizzes of near misses, the impacts, the hits, the grenades and the buttons. The trains follow the master volume only. | 100% |
| Field of view | `fov` | 60 to 100 degrees, vertical, at the hip. The sights make it narrower. | 74 |
| Mouse sensitivity | `sensitivity` | 0.2x to 3x | 1x |

## Maps

- **Earl's Court** (deathmatch, and the menu background): the station from
  its public layout, not from a survey. Earls Court Road with a bus and the
  TARDIS, the ticket hall, the footbridge, the District line train shed with
  its iron arch roof and a train, three lifts (see [Lifts](#lifts)),
  escalators that carry you, and the deep Piccadilly line platform. The
  server runs the lifts, so every player sees the same cab.
  In deathmatch, the live rail kills a player on the tracks more than
  66.7 m east or west of the shed centre, just past the ends of the
  concourses. On the District line tracks, yellow danger boards show where
  it starts.
- **Ticket gates** (Earl's Court, `game/src/gates.zig`): a gate line of 8
  lanes in the Earls Court Road ticket hall and 4 in the Warwick Road
  passage. Screens close the rest of each hall.
  - Seen from the street, the right half of a line is IN and the left half
    is OUT. A lane has a green light at the end where you go in and a red
    light at the other end.
  - The paddles are closed. Aim at the yellow reader from the entry side
    and press F (TAP OYSTER): the paddles open. From the wrong side the
    reader shows red.
  - A tap in shows "-£0.01 (amount pending)". 60 to 240 s later the fare
    shows: -£3.10, the Zone 1 pay-as-you-go peak single (from March 2026).
    If you tapped out before that, it shows a refund. A tap out with no tap
    in gives "-£9.90 MAXIMUM FARE (no tap in)" after the same delay (an
    estimate: TfL publishes no single 2026 figure).
  - A crossing of a gate line by any other way (a vault, a jump) is a fare
    dodge. 2 s later the server kills you: `{t:"die", by:"Guilt"}`. The
    kill feed shows Guilt, and the death screen says "Died of guilt. Fare
    dodging is a serious crime".
  - Deathmatch: the paddles are the same for each player. A tap goes to the
    server (`{t:"gate", k:"open", i}`), and the paddles of lane `i` open on
    each client. A walk through the lane (`k:"pass"`) closes them soon on
    each client. The paddles do not close on any player in the lane. The
    fares and the fare dodge stay on your client.
- **Pigeons** (Earl's Court, `game/src/pigeons.zig`): 12 pigeons sit on
  the tie rods of the train shed roof, at 11.5 m. They bob, look round,
  peck, coo, and now and then take a short flight and land again.
  - A shot near a pigeon, or near its rod, startles it, and the pigeons
    next to it follow. A startled pigeon flies off in a random direction
    on a path that weaves, jinks, climbs and sinks, and flaps and glides.
    Some flights are dumb: the pigeon flies into a wall or the roof. Then
    it leaves up through the roof.
  - A hit kills a pigeon. The body falls, bounces and comes to rest on its
    side. A shot, a grenade or a kick moves it. F picks it up and F throws
    it. In deathmatch your kill feed shows the kill.
  - A pigeon that left or died comes back 60 to 180 s later. It flies down
    through the roof near the crown and lands on a free place on a rod.
    The body of a dead pigeon stays.
  - Deathmatch: each player sees the same pigeons and bodies. See
    [The pigeons in deathmatch](#the-pigeons-in-deathmatch).
- **VAPES N MORE** (Earl's Court, `vapeShop` in
  `game/src/maps/earls_court.zig`, `game/src/vapes.zig`): a vape shop in
  the terrace opposite the station, at the north end of Earls Court Road.
  It has a black fascia with the name in neon pixel letters, a big window
  and a door at the south end of the front. Inside are very bright
  ceiling panels, neon strips, a cyan light and a magenta light, walls of
  colourful boxes on lit shelves, and a counter.
  - A row of disposable vapes stands on the counter. Aim at one and press
    F (USE VAPE). The field of view pulses and widens for 15 s. Then
    popcorn lung kills you. The kill feed shows "Popcorn lung" as the
    killer, and the death screen says DIED OF POPCORN LUNG. A respawn
    stops the effect.
  - The death goes through the server, as an environment death (see
    [The lobby protocol](#the-lobby-protocol)). Thus the vapes work in
    deathmatch only. The menu and practice do not use them.
  - The shop uses 17 boxes and two map lights.
- **The secret room** (behind VAPES N MORE, `secretRoom` in
  `game/src/maps/earls_court.zig`, `game/src/secret_room.zig`): one
  section of the back shelf of the shop is a door. Nothing shows it.
  - One pack on that section, a white pack with a gold top on the second
    shelf from the top, is GET MORE. Aim at it and press F. The section
    pushes back through the wall and slides aside. An angelic choir sings
    (`game/src/audio/choir.zig`: synthetic voices on the vowel "a", IV to
    I, in a hall reverb), and the room lights come up with the door.
  - The room is a dark chapel. A shaft of warm light comes down from a
    round light in the ceiling onto a golden pigeon. The pigeon floats and
    turns over a marble plinth, with a halo. Four marble columns stand
    round the dais. Lancet windows in the neon colours of the shop glow on
    the side walls, a gold sunburst fills the far wall, and small stars
    light the ceiling.
  - Aim at the golden pigeon and press F (MORE): a blessing for 45 s. A
    halo of white pigeons flies round your head, and you shine gold for
    the other players. You move 1.5 times faster. The aim locks on the
    head of the live enemy nearest the middle of the screen, in sight and
    within 0.6 rad. The guns have no spread, also on the move and in the
    air. The HUD shows the seconds left. A death or a new match ends the
    blessing.
  - The door stays open until the map loads again or a new match starts.
  - Deathmatch: the first player who opens the door tells the server
    (`{t:"more"}`), and the door opens for each player. A player who joins
    later finds it open. A blessing goes to the other players the same
    way.
  - The room uses 13 boxes (the door too) and 4 map lights: Earl's Court has 24 of
    `map.max_lights` (26). `map.sealed` keeps the sun out: the sun shadow
    map does not reach the room, and out of that map the sun goes through
    walls.
- **Arena** (target practice): an open square with cover, and the practice
  range to the south, with the NPC shooter station at its spawn.

## Layout

```
apps/action/
├── game/                 Zig client (its own package; swindowzig is a path dependency)
│   ├── build.zig         zig build -> zig-out/bin/action.wasm
│   └── src/
│       ├── main.zig      modes, input, shooting, deathmatch sync, HUD, wasm entry
│       ├── render.zig    light shadow maps (at map load), shadow pass, HDR scene pass (4x MSAA), bloom, tone map
│       ├── scene.wgsl    lighting: sun + PCF shadows, light shadow maps, SDF ambient occlusion, sky, fog
│       ├── post.wgsl     bloom and the final pass (ACES, vignette, damage tint)
│       ├── weapon.zig    the weapon models, classes, items, slots, the hands, the recoil and the view-model pose
│       ├── guns.zig      the gun model: calibres, builds, the stats of each gun, the time to kill
│       ├── guns_tool.zig zig build guns: writes server/guns.json, prints the gun tables
│       ├── guns_test.zig the tests of the gun model
│       ├── weapon_menu.zig  the weapon menu (B)
│       ├── gun_compare.zig  the compare bars of two guns
│       ├── map.zig       the current map: boxes, ramps, decoration, surface materials, lights, lifts, moving platforms, buttons, escalators
│       ├── maps/         arena.zig, earls_court.zig
│       ├── range.zig     the practice range: the dummies, the damage numbers, the health bars
│       ├── shooter.zig   the NPC shooter of the range: the NPC, its rounds, the control panel
│       ├── shooter_hud.zig  the text of the NPC shooter panel, on the HUD
│       ├── gates.zig     the ticket gates: the lanes, the paddles, the Oyster readers, the fares, the fare dodge
│       ├── pigeons.zig   the pigeons of the train shed: the perches, the flights, the bodies
│       ├── pigeons_test.zig  the pigeon simulation: the perches, a kill, a miss, the flights, the return, two clients in deathmatch
│       ├── vapes.zig     the vapes of VAPES N MORE: the pick, the field of view effect, popcorn lung
│       ├── secret_room.zig  the secret room of VAPES N MORE: the shelf door, GET MORE, the golden pigeon, the blessing, the shaft of light
│       ├── secret_room_test.zig  the shut door, GET MORE, the walk to the plinth, the room lights
│       ├── impact_fx.zig the impact effect of each material (translucent billboards)
│       ├── floorplan.zig the map tool: slices, the decoration, material and lift audit (zig build floorplan)
│       ├── escape.zig    the escape audit (zig build floorplan -- <map> escape)
│       ├── player.zig    movement, collision, the ride on a moving platform, the lean and the hit boxes
│       ├── body.zig      the player model: your body in first person, the other players, the dummies
│       ├── body_test.zig the tests of your body: the camera, the walk, the feet on the stairs
│       ├── tests.zig     zig build test: the walks, the lift rides, your body, the console, the server cvar file, the guns, the sounds, the NPC shooter
│       ├── player_test.zig  the walks over the stairs and escalators, the lift rides
│       ├── surfaces_test.zig  the box limit, the surface materials, a crack or a whiz for each gun
│       ├── shooter_test.zig  the line of fire of the NPC shooter, its panel, the impact effects
│       ├── sounds.zig    the gun sounds: the muzzle report, the near misses, the impacts (to sw_audio)
│       ├── audio/        the bullet sound models and the choir, with no action imports (root.zig): near_miss.zig, impact.zig, space.zig, dsp.zig, choir.zig
│       ├── settings.zig  the settings panel: a view over five saved cvars
│       ├── game_console.zig  the game side of the console: actions, binds, server cvars, rcon, chat
│       ├── server_cvars.json  the server cvars (the server reads the same file)
│       ├── console/      the console framework and the chat, with no action imports (root.zig)
│       ├── session/      the session: the server identity, the reconnect state machine (no action imports)
│       ├── protocol_version.txt  the protocol version (the server reads the same file)
│       ├── mesh.zig      vertex lists and shape builders
│       ├── net.zig       the WebSocket client (backends/wasm/net.ts)
│       └── assets/       guns.bin (generated), Lato font (OFL)
├── server/index.ts       Bun: static files + the lobby on /api/ws, port 4080
├── server/ping.ts        the ping of each player (ping.test.ts: bun test)
├── server/guns.ts        the gun table of the server and the fall-off (guns.test.ts)
├── server/guns.json      the stats of each gun (generated: zig build guns)
├── server/console.ts     the server cvars, the config file, the server commands
├── server/chat.ts        the chat checks: clean text, length cap, rate limit, teams
├── server/session.ts     the server identity, /api/version, the welcome, the bye on SIGTERM
├── server/pigeons.ts     the pigeons in deathmatch: the state of each pigeon and body, the joyrides, the returns
├── server/server.cfg     the server config (a script)
├── src/boot.ts           page entry; bundled to public/boot.js
├── public/index.html
├── assets/guns/          the licence of the gun models
├── scripts/build-version.sh  prints the build version (build.sh, prod:docker)
└── scripts/convert-gun.ts  the gun pack OBJ files -> game/src/assets/guns.bin
```

## Run it

Needs Zig (the version in `utils/swindowzig/build.zig.zon`) and Bun.

```bash
yarn workspace action start     # build.sh, then the server on http://localhost:4080
```

WebGPU only: a recent Chrome or Edge on a desktop.

## The lobby protocol

JSON text on `/api/ws`. The message list is at the top of `server/index.ts`.
The `cvars` message carries the server cvars. The `rcon` and `print`
messages carry remote admin. The `chat` message carries the chat:

| Message | From, to | Content |
|---|---|---|
| `{t:"chat", ch, text}` | the client, to the server | a message. `ch` is `"all"` or `"team"`. |
| `{t:"chat", ch, id, name, text}` | the server, to the players of the channel | the message of player `id`, cleaned. The sender gets it too. |
| `{t:"chat", ch:"server", text}` | the server, to all players, or to one | a server line: a join, a leave, a match start or end. To the sender only: "too many messages". |

An environment death is a death with no killer. The client finds it, and
the server makes it a death:

| Message | From, to | Content |
|---|---|---|
| `{t:"shock"}` | the client, to the server | the player touched the live rail. The kill feed shows LIVE RAIL. |
| `{t:"die", by}` | the client, to the server | the player dies of `by`. The server accepts only a cause in `ENV_DEATHS` (`server/index.ts`): `"Popcorn lung"` (a vape) and `"Guilt"` (fare dodging). It ignores any other cause, a dead player and the end of a match. |
| `{t:"kill", killer, victim, head:false, kname, vname, by}` | the server, to all players | the death. `killer` is the victim, and `kname` and `by` are the cause. Only a `die` gives `by`. With `by`, the death screen says DIED OF, not KILLED BY. |

The client sends its own position, its held weapon and its hits. The server
checks the match phase and that both players are alive. A pick must name a
gun of its class (`server/guns.json`). For each shot it checks the weapon:
the class must be in the shooter's loadout, the shot must keep to the fire
rate of the gun, the pellets must not be more than the gun has, and the
target must be in reach. The server takes the damage from its own table,
with the fall-off at its own distance between the two players
(`server/guns.ts`). It does not check line of sight. The other players see
the held weapon (`w` and `m` in the `st` and `snap` messages). For a grenade, the thrower's client calculates the damage, cover
included, and sends it in one `blast` message. The server checks the throws
left in the life, the damage range and the distance to each target.

### The pigeons in deathmatch

The server owns the state of each pigeon and of each body
(`server/pigeons.ts`). It does not fly the pigeons. Each pigeon has its own
random numbers (`Bird.rng` in `game/src/pigeons.zig`), and a flight uses no
other random numbers. So a flight is a function of its start and its seed,
and each client flies the same path (at the same tick rate, 120 Hz).

- **A pigeon** is here (on a perch, or on a joyride or a return to it),
  flown off or dead. A perch is `[rod, u]`: the tie rod (0 to 13) and the
  place along it (0 to 1).
- **The client that startles or kills a pigeon decides.** It acts at once
  and sends the event. The server checks the state and sends the event to
  the other players. A shot of another player does not startle your
  pigeons: its shooter decides. A grenade: its thrower decides.
- **The server decides** the joyrides and the returns, with the seed and
  the perch. A return comes 60 to 180 s after a death, and 20 s more after
  a flight off. Each return makes a new generation.
- **A body** is `[bird, gen]`. The client that moves a body (a shot, a
  blast, a kick, a throw) sends its place and its velocity. When the body
  comes to rest, the same client sends the place of rest once. F holds a
  body at once, but the server gives it to the first player only: a late
  player gets the holder and lets go. The other clients draw a held body in
  the hand of its holder, from the position and the aim in the snapshot. A
  holder who leaves drops the body.
- **Corrections**: each 10 s the server sends the state of the flock. A
  client puts a perched pigeon on the right perch, sends off a perched
  pigeon that is gone on the server, and sends back an away pigeon that is
  here. On join the same message has the seed (the tints) and the bodies.

| Message | From, to | Content |
|---|---|---|
| `{t:"gate", k, i}` | the client, to the server | `k:"open"`: a tap that opened lane `i`. `k:"pass"`: the player walked through lane `i`. |
| `{t:"gate", k, i, id}` | the server, to the other players | the same, of player `id`. |
| `{t:"more", k:"open"}` | the client, to the server | the player opened the door of the secret room (GET MORE). The server keeps only the first one of a match. |
| `{t:"more", k:"open", id}` | the server, to the other players | player `id` opened the secret room: the door opens, with the choir. |
| `{t:"more", k:"now"}` | the server, to a player who joins | the secret room is open: the door opens at once, with no choir. A new match shuts it. |
| `{t:"more", k:"bless"}` | the client, to the server | the player took MORE (the golden pigeon). Only while the door is open. |
| `{t:"more", k:"bless", id}` | the server, to the other players | player `id` took MORE: draw its halo and its shine for 45 s, or to its death. |
| `{t:"pg", k:"up", i, sd, o, v}` | the client, to the server, to the other players | pigeon `i` takes off from `o`, or a startle in flight at `o` with velocity `v`. `sd`: the seed of the flight. Only for a pigeon that is here. |
| `{t:"pg", k:"die", i, g, o, v}` | the client, to the server, to the other players | the kill of pigeon `i` of generation `g`: its body at `o` with velocity `v`. |
| `{t:"pg", k:"push", i, g, o, v}` | the client, to the server, to the other players | body `[i, g]` is at `o` with velocity `v` (a push, or `v` zero at rest). |
| `{t:"pg", k:"grab", i, g}` | the client, to the server | F on body `[i, g]`. |
| `{t:"pg", k:"grab", i, g, id}` | the server, to all players, or to a late player | player `id` holds body `[i, g]`. |
| `{t:"pg", k:"drop", i, g, o, v}` | the holder, to the server, to the other players | the holder threw or dropped the body. With no `o`: the holder left. |
| `{t:"pg", k:"joy", i, sd, pr}` | the server, to all players | pigeon `i` takes a joyride to perch `pr`. |
| `{t:"pg", k:"back", i, g, sd, pr}` | the server, to all players | pigeon `i` comes back as generation `g` to perch `pr`. |
| `{t:"flock", b, sd, c}` | the server, to all players each 10 s, and to a new player | `b`: `[state, gen, rod, u]` for each pigeon (0 here, 1 flown off, 2 dead). `sd` and `c` only on join: the seed, and the bodies `[i, g, x, y, z, holder]`. |

The events of the other players go to `pg` messages with all the digits of
each number, so each client starts a flight from the same place. These
messages are new, so the protocol version stays the same: an old client
ignores them.

### Ping

The server measures the round-trip time to each player with its own
messages (`server/ping.ts`). It does not use the game traffic.

| Message | From, to | Content |
|---|---|---|
| `{t:"ping", n}` | the server, to one player | ping number `n` |
| `{t:"pong", n}` | the client, to the server | the answer to ping `n`. `net.zig` sends it in `poll`, at once. |
| `{t:"pings", ms:[[id, ms, stale], ...]}` | the server, to all players | the ping of each player. `ms` is -1 before the first answer. `stale` is 1 after 10 s with no answer. |

- **The interval is 2 s** (`PING_INTERVAL_MS` in `server/ping.ts`, the
  only place to change it). Each round, the server sends a ping to each
  player and one `pings` list to all players. The list is about 10 bytes
  for each player. A ping field in the snapshot (20 times a second) costs
  about 30 times more traffic, for a number that changes slowly.
- **One ping at a time.** A WebSocket does not lose a message, so the
  server waits for the answer before it sends the next ping.
- **The sample** is the time from the ping to the pong. It includes the
  wait for the next frame of the client, up to about 17 ms at 60 frames a
  second.
- **The value** is the median of the last 5 samples (10 s). The median
  ignores one late answer, for example after a background tab, and it
  changes little from one round to the next.
- **The score board** (Tab) shows the value in whole milliseconds, right
  aligned, in a smaller font than the kills and the deaths. A player with
  no value yet shows `-`.
- **Stale:** the server does not remove a player that gives no answer for
  10 s (`PING_STALE_MS`). The score board shows its last value in red with
  a question mark, for example `312?`. The next answer removes the mark. A
  browser tab in the background does not run the game, so it gives no
  answer.

### The session: versions and reconnect

The server says who it is. The client compares that with itself and with
the last server, and it connects again after a lost connection.
`game/src/session/` (the client) and `server/session.ts` (the server)
have no action game code.

| Field | Value |
|---|---|
| `instance` | 16 hex characters, random at each start of the server process |
| `build` | the build version: the same for each start of one build. See [The build version](#the-build-version). |
| `protocol` | the protocol version: the number in `game/src/protocol_version.txt` |
| `started` | the start time of the server, ISO 8601 in UTC |

- `GET /api/version` gives the four fields as JSON, with
  `cache-control: no-store`.
- Each static file and each `/api` answer has the header
  `x-build-version`.
- The `welcome` message is the first message on each WebSocket. It has the
  same four fields and the `id` of the player.

| Message | From, to | Content |
|---|---|---|
| `{t:"welcome", id, instance, build, protocol, started}` | the server, to a new connection | who the server is. The client sends the hello only when the protocol is its own. |
| `{t:"bye", reason}` | the server, to each player | the server closes the connection next. On SIGTERM or SIGINT (a deploy, `docker stop`, Ctrl+C) the reason is "The server stops for a restart or an update." After 5 bad rcon passwords it is "Too many bad rcon passwords." |

What the client does:

| Case | The client |
|---|---|
| The connection closes | The HUD shows CONNECTION LOST, the reason of the bye, and the time to the next try. The waits are 1, 2, 4 and 8 s, then 10 s (the maximum) for each next try. Enter tries at once. M goes to the menu. The frame loop goes on: the chat, the console and the world. The player cannot move. |
| The socket does not open in 10 s, or no welcome comes in 5 s | The same as a closed connection. |
| The same instance | Join again. The chat says "Connected again." |
| A new instance, the same build | Join again. The chat says "The server restarted." |
| A new build, the same protocol | Join again. The chat says "A new version is live. Reload the page to update." A line at the bottom of the HUD, a RELOAD TO UPDATE button on the pause screen and a line on the menu stay until the page reloads. |
| A new protocol | No join, and no more tries. The screen says A NEW VERSION IS LIVE, with a RELOAD button. Enter reloads. M goes to the menu. |

- At each join the match state comes from the server: the clock, the
  scores, the other players and the spawn. A join is a new player on the
  server, so the kills and the deaths start from 0.
- The build compares with the build of the page, not with the last
  server. So a first join to a newer server also shows the reload notice.
- The `version` console command prints the build and the protocol of the
  game and of the server, the instance id, the start time and the state of
  the connection. The debug screen shows the same values. `reload` reloads
  the page.
- **The protocol version**: add 1 to `game/src/protocol_version.txt` for
  each change to a message that a client of the old version cannot read.
  For example, a field that the client must have, or a field with a new
  meaning. A new message or an optional field that an old client ignores
  needs no change. The client embeds the file at build time (`net.zig`),
  and the server reads it at start.

### The build version

`scripts/build-version.sh` prints it:

1. `BUILD_VERSION`, if the environment sets it.
2. Else the 12-character hash of the last commit that changed
   `apps/action` or `utils/swindowzig`. `-dirty` follows it when those
   directories have changes that are not committed. A release that changes
   only other apps does not change the version, so the game server does
   not restart.
3. Else `dev`: no git, or not a checkout.

- **Dev** (`yarn workspace action start`): `build.sh` gives the version to
  the game (`zig build -Dbuild_version=...`) and writes
  `public/build-version.txt`. The server reads that file at start. With
  no file, the server says `dev`. A plain `zig build` also gives `dev`.
- **Docker** (`yarn workspace action prod:docker`): the build context has
  no `.git`. So the script gives the version to `docker compose` as the
  build argument `BUILD_VERSION`. The `zig-build` stage writes it into the
  game and into `build-version.txt`. With no argument, the image says
  `dev`.

## Deploy

Port 4080 (cloudflared, `infra/edge`, `scripts/test-deployment.sh`). The DNS
record `action.seanmizen.com` is in `infra/cloudflare/seanmizen_com.tf`. Apply
it from `release`.
