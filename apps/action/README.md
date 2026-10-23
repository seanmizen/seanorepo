# action.seanmizen.com

A first-person shooter in the browser, on swindowzig (Zig to wasm, WebGPU).

- **Deathmatch**: one lobby that is always on. A match is 5 minutes. Then the
  score board shows for 10 seconds, the scores reset, and the next match
  starts. The clock runs with or without players.
- **Target practice**: offline. The player starts on the firing line of the
  range: human dummies with health bars, and the damage of each hit near the
  crosshair (see The practice range). In the arena, a hit on a plate starts a
  round of 60 seconds. Some plates move. The red centre scores 150, the plate
  100. The best score stays in local storage.

Controls:

| Key | Action |
|---|---|
| WASD | move |
| Space | jump |
| Mouse | look |
| Left click | fire |
| Right click | aim down the sights |
| R | reload |
| G | quick grenade throw, from any slot |
| 1, 2, 3, 4 | weapon slots: primary, secondary, knife, grenade |
| B | weapon menu (also on the pause screen) |
| F | use: press the button under the crosshair (lifts) |
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
player.

The HUD has a minimap: north up, the walls at body height over the floors at
foot height. A player who fires shows on it for a moment.

## The floorplan tool

`zig build floorplan` (in `game/`) slices a map into images and audits it:

```bash
zig build floorplan -- earls_court plan 1 out.ppm         # top view at y = 1
zig build floorplan -- earls_court section-z -22.5 out.ppm # side view at z = -22.5
zig build floorplan -- earls_court audit                  # decoration a player can walk through, lights inside a solid shape
zig build floorplan -- earls_court escape                 # escape holes: exit code 1 if it finds one
sips -s format png out.ppm --out out.png                  # macOS, to view it
```

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
  players cast no shadow from a local light. Lamps (emissive surfaces) cast
  none, because their light comes from inside them.
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
  stats of the held weapon (`pelletDamage` in `game/src/main.zig`). A
  grenade does the same damage as to a player, cover included.
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

## Tests

`zig build test` (in `game/`) runs the native tests (`game/src/tests.zig`):

- `game/src/player_test.zig` walks a player down and up each staircase of
  Earl's Court, and walks and rides each escalator. Each walk must keep the
  feet on the ground and the eye height smooth (at most 5 cm in a tick). It
  must not stop at a wall or a ceiling edge, and the head bob must follow
  the walking speed.
- `game/src/console/tests.zig` tests the console: the parser, the cvar
  limits, the commands, the binds and the buttons, the scripts, the saved
  config, the completion and the chat.
- The server cvar file must be valid, with safe defaults.

`yarn workspace action test` (`bun test server`) runs the server tests
(`server/*.test.ts`):

- `server/ping.test.ts`: the ping calculation.
- `server/console.test.ts`: the same parser cases, the cvar limits, the
  config file and the environment variables.
- `server/chat.test.ts`: the chat checks. The control characters, the
  length cap in bytes, the rate limit, the team routing and the match end
  line.
- `server/lobby.test.ts`: a real server on a free port. It checks the cvars
  on join, rcon, a client that tries to set a server cvar, and the chat
  relay with the join and leave lines.

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
[Chat](#chat)). The game adds `rcon` and the actions.

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
| `sfx_volume` | 0 to 1 | 1 | saved | `main.zig` sound |
| `fov` | 60 to 100 degrees | 74 | saved | `main.zig` gameRender |
| `sensitivity` | 0.2 to 3 | 1 | saved | `main.zig` gameplayTick |
| `chat_fade_seconds` | 1 to 120 seconds | 10 | saved | `console/chat.zig` Chat.alpha |
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
| `+jump` | Space | jump |
| `+attack` | mouse1 | fire, knife, throw the grenade in the hand |
| `+aim` | mouse2 | the sights |
| `+reload` | R | reload |
| `+grenade` | G | quick grenade throw |
| `+use` | F | press a lift button |
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
classes, the stats, the items and the hands.

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
model. The panel shows the model under the mouse in 3D, with the stats of
its class. A click puts the model in its slot. The pick stays in local
storage (`loadout`). Practice applies it at once. In deathmatch the server
applies it at once while the player is within 4 m of the spawn point and
has not fired or thrown since the spawn. Else it applies on the next
spawn, and the HUD shows `NEXT SPAWN`.

The models of one class differ only in their look. Each class has these
stats. The damage is for one pellet:

| Class | Models | Body | Head | Pellets | Fire | Magazine | Reload | Hip cone (rad) | Speed | Draw |
|---|---|---|---|---|---|---|---|---|---|---|
| Rifle | 5 | 30 | 75 | 1 | auto, 522 rpm | 30 + 90 | 2.3 s | 0.006, +0.032 heat | 93% | 0.45 s |
| Carbine | 4 | 24 | 60 | 1 | auto, 706 rpm | 30 + 120 | 2.1 s | 0.005, +0.024 heat | 96% | 0.4 s |
| Bullpup | 3 | 28 | 72 | 1 | 3-round burst, 0.06 s apart, a burst each 0.36 s | 30 + 90 | 2.5 s | 0.003, +0.012 heat | 94% | 0.45 s |
| SMG | 5 | 18 | 40 | 1 | auto, 923 rpm | 35 + 140 | 1.8 s | 0.012, +0.04 heat | 104% | 0.3 s |
| Shotgun | 5 | 13 | 16 | 9 | pump, 0.85 s | 6 + 24 | 2.6 s | 0.06, 35 m reach | 95% | 0.45 s |
| Sawn-off | 1 | 11 | 13 | 10 | 0.25 s | 2 + 20 | 2.0 s | 0.095, 22 m reach | 100% | 0.35 s |
| Pistol | 6 | 26 | 65 | 1 | semi, 0.14 s | 12 + 48 | 1.4 s | 0.005, +0.02 heat | 106% | 0.25 s |
| Revolver | 5 | 52 | 104 | 1 | semi, 0.48 s | 6 + 30 | 2.4 s | 0.003, +0.03 heat | 104% | 0.35 s |
| Knife | 1 | 55 | 55 | - | 0.45 s a swing | - | - | 1.6 m reach | 110% | 0.2 s |
| Grenade | - | see Grenades | | | | 3 a life | | | 100% | 0.5 s |

The balance, for hipfire on a laptop (100 health):

- Each primary kills in about 0.33 s when every hit lands (rifle 4 hits,
  carbine 5, SMG 6, bullpup 2 bursts). The differences are in the cone,
  the kick and the range. A head hit is about 2.5 times a body hit, so only
  the revolver kills with one head hit.
- The first shot goes almost where the crosshair is. The cone grows with
  the heat (the trigger held), with the run speed (+0.008 to +0.02) and in
  the air (+0.05). The sights make it 75% smaller (30% for the shotguns).
  The crosshair shows the cone.
- The shotguns kill in one shot only up close (8 of 9 pellets), and do no
  damage past their reach.
- The knife and the pistols are the fastest to carry and to take out.

The server has the same numbers (`WEAPONS` in `server/index.ts`).

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
| Effects volume | `sfx_volume` | 0 to 100%: the guns, the hits, the grenades and the buttons. The trains follow the master volume only. | 100% |
| Field of view | `fov` | 60 to 100 degrees, vertical, at the hip. The sights make it narrower. | 74 |
| Mouse sensitivity | `sensitivity` | 0.2x to 3x | 1x |

## Maps

- **Earl's Court** (deathmatch, and the menu background): the station from
  its public layout, not from a survey. Earls Court Road with a bus and the
  TARDIS, the ticket hall, the footbridge, the District line train shed with
  its iron arch roof and a train, two lifts (F on the call buttons and the
  cab buttons), escalators that carry you, and the deep Piccadilly line
  platform. The server runs the lifts, so every player sees the same cab.
  In deathmatch, the live rail kills a player on the tracks more than
  66.7 m east or west of the shed centre, just past the ends of the
  concourses. On the District line tracks, yellow danger boards show where
  it starts.
- **Arena** (target practice): an open square with cover, and the practice
  range to the south.

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
│       ├── weapon.zig    the weapon models, classes and stats, items, slots, the hands and the view-model pose
│       ├── weapon_menu.zig  the weapon menu (B)
│       ├── map.zig       the current map: boxes, ramps, decoration, lights, lifts, buttons, escalators
│       ├── maps/         arena.zig, earls_court.zig
│       ├── range.zig     the practice range: the dummies, the damage numbers, the health bars
│       ├── floorplan.zig the map tool: slices, the decoration audit (zig build floorplan)
│       ├── escape.zig    the escape audit (zig build floorplan -- <map> escape)
│       ├── player.zig    movement, collision, the lean and the hit boxes
│       ├── tests.zig     zig build test: the walks, the console, the server cvar file
│       ├── player_test.zig  the walks over the stairs and escalators
│       ├── settings.zig  the settings panel: a view over five saved cvars
│       ├── game_console.zig  the game side of the console: actions, binds, server cvars, rcon, chat
│       ├── server_cvars.json  the server cvars (the server reads the same file)
│       ├── console/      the console framework and the chat, with no action imports (root.zig)
│       ├── mesh.zig      vertex lists and shape builders
│       ├── net.zig       the WebSocket client (backends/wasm/net.ts)
│       └── assets/       guns.bin (generated), Lato font (OFL)
├── server/index.ts       Bun: static files + the lobby on /api/ws, port 4080
├── server/ping.ts        the ping of each player (ping.test.ts: bun test)
├── server/console.ts     the server cvars, the config file, the server commands
├── server/chat.ts        the chat checks: clean text, length cap, rate limit, teams
├── server/server.cfg     the server config (a script)
├── src/boot.ts           page entry; bundled to public/boot.js
├── public/index.html
├── assets/guns/          the licence of the gun models
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

The client sends its own position, its held weapon and its hits. The server
checks the match phase and that both players are alive. For each shot it
checks the weapon: the class must be in the shooter's loadout, the shot must
keep to the fire rate of the class, the pellets must not be more than the
class has, and the target must be in reach. The server takes the damage
from its own table. It does not check line of sight. The other players see
the held weapon (`w` and `m` in the `st` and `snap` messages). For a grenade, the thrower's client calculates the damage, cover
included, and sends it in one `blast` message. The server checks the throws
left in the life, the damage range and the distance to each target.

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

## Deploy

Port 4080 (cloudflared, `infra/edge`, `scripts/test-deployment.sh`). The DNS
record `action.seanmizen.com` is in `infra/cloudflare/seanmizen_com.tf`. Apply
it from `release`.
