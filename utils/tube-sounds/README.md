# tube-sounds

Procedural London Underground train sounds for the Web Audio API. The library
uses no samples and no recordings. Every sound comes from a model of the part
that makes it: the gears, the motors, the camshaft, the wheels on the rail
joints, the brake air, the doors and the tunnel.

TypeScript, ESM, no runtime dependencies. The package exports its source
(`src/index.ts`), so a bundler in the consuming app compiles it.

## Demo

```bash
yarn workspace tube-sounds demo
```

Open <http://127.0.0.1:4790/> and press **Start audio**. The page has sliders
for speed, throttle, brake, distance and curve, buttons for arrival,
departure, a full service and the doors, a stock and motor selector, and a
live spectrum. Press **Full service** and stand still for 50 seconds.

## Quick start

```ts
import { TubeStation, TubeTrain } from 'tube-sounds';

const ctx = new AudioContext();
const station = new TubeStation(ctx); // reverbs, ambience, limiter, clock
station.output.connect(ctx.destination);
station.start(); // or call station.tick() from your game loop

const train = new TubeTrain(station, { stock: '1973' });
train.playService(); // arrival, doors, departure
```

### Drive it from a game timeline

The `apps/action` platform timeline has a train every 70 s. The brakes go on
at t = 0, 100 m out at 20 m/s. The train stops at 9 s, the doors are open
from 10 s to 24 s, and the train departs at 27 s. `serviceScript` uses these
values as its defaults:

```ts
// tBrake is the audio-context time of t = 0 on the game timeline.
train.playService({ at: tBrake }); // the approach starts 12 s before tBrake
```

Or set the controls directly, every frame:

```ts
train.setSpeed(mps);
train.setThrottle(0.8); // 0..1, master controller
train.setBrake(0); // 0..1, brake demand
train.setDistance(m); // train front, metres before the listener
train.doorsOpen();
train.doorsClose({ warning: 2 }); // 12 beeps, then the doors move
```

A script overrides the direct controls while it runs. `train.stopScript()`
ends it. `train.state` returns speed, position, camshaft notch, inverter
frequencies, brake and reservoir pressure, for a HUD or for debugging.

### Main options

| Option | Where | Effect |
|---|---|---|
| `stock: '1973' \| 'S7'` | `TubeTrain` | Car lengths, wheels, gears, motor, doors. |
| `motor: 'dc-camshaft' \| 'vvvf-igbt' \| 'vvvf-gto'` | `TubeTrain` | Replaces the stock's motor. `setMotorType()` changes it live. |
| `physics: true` | `TubeTrain` | Throttle and brake drive the speed. `setSpeed` is then ignored. |
| `mix: { joints: 0.5, ... }` | `TubeTrain` | Level per component: `rolling joints motor control brakes squeal compressor doors tunnel`. |
| `track` | `TubeTrain` | Rail length (0 = welded rail), curves, corrugation. |
| `geometry` | `TubeStation` | Platform start and length, listener position. |
| `ambient`, `distantTrainEvery` | `TubeStation` | Ambience level and the mean gap between distant trains. |

### Offline rendering

`renderOffline(seconds, setup)` renders into an `OfflineAudioContext`. It
stops the render at every control step and runs the station clock by hand.
The result is the same as a live run, with the same seed.

```ts
const buffer = await renderOffline(50, (station) => {
  new TubeTrain(station, { stock: 'S7' }).playService({ at: 12 });
});
```

## The reference: "Simulating an Entire Car Engine"

Sean pointed at [AngeTheGreat, "Simulating an Entire Car Engine (yes, it makes
noise)"](https://youtu.be/RKT-sKtR970). The video presents
[engine-sim](https://github.com/ange-yaghi/engine-sim). What it teaches:

1. **Bad game engine sounds ignore the operating state.** An engine sounds
   different at idle, under heavy load and on the overrun. Most games play
   one loop and change its pitch.
2. **The input sets force, not speed.** The throttle opens a plate, and the
   engine finds its own speed. The response has lag. A sound that follows
   the pedal directly sounds wrong.
3. **Simulate the machine, and take the sound from the simulation.**
   engine-sim runs a rigid-body model of the crank, rods and pistons, and a
   gas-dynamics model of the intake and exhaust, at about 80 000 steps per
   second. The audio is the exhaust pressure wave.
4. **Then shape it as the real path shapes it.** The final signal is the
   pressure wave, some white noise, a little equalisation, and a filter that
   approximates sound propagation in the exhaust system.
5. **Change the parts and the sound follows.** A different camshaft lobe
   gives a different sound with no change to the audio settings. The same
   code makes a V8, an inline four or a Kohler V-twin.
6. **Engine braking needs its own character.** On the overrun the engine
   absorbs power, and the tone changes. The video names this as the biggest
   improvement over other models.

### How this library applies it

| Lesson | In tube-sounds |
|---|---|
| Operating state | Every voice reads motor load, current, brake cylinder pressure and air flow every 40 ms. Coasting, power and braking sound different. |
| Force, not speed | `physics: true` uses tractive effort, constant power above base speed and Davis resistance. The camshaft notches on motor current, not on time. |
| Sound from the simulation | The camshaft is a per-unit DC circuit (`core/camshaft.ts`). The inverter tones come from PWM theory (`core/vvvf.ts`). Brake hiss is the air flow in a cylinder model (`core/air.ts`). |
| Shape by the path | Each car has a delay line (Doppler), 1/r gain, and air and tunnel absorption. In a tunnel, the sound travels as in a waveguide and leaves the mouth. Generated impulse responses add the platform and tunnel reverb, with the real tunnel cross modes. |
| Change the parts | Gear teeth, wheel diameter, car lengths and axle spacing come from the stock data (`core/stock.ts`). Change them and the whine and the joint rhythm change. |
| Braking character | Rheostatic and regenerative braking load the gears on the other tooth flank. The second harmonic rises, and the inverter runs its schedule backwards. |
| Per-cylinder variation | Each car has its own wheel wear, so its own whine pitch. It also has its own camshaft timing, noise and position on the track. The cars beat against each other as a real train does. |

## The sound model

The numbers come from TfL rolling stock sheets and the Wikipedia stock pages.
The code marks estimates with `approx`.

### 1. Traction motors (`audio/motor-dc.ts`, `audio/motor-vvvf.ts`)

- **Gear whine.** The 1973 Stock has 17/75 gears. The mesh frequency is
  75 x wheel rev/s, about 640 Hz at 20 m/s on a 750 mm wheel. The level
  follows torque. The whine is quiet when the train coasts and loud under
  power or in electric braking. A once-per-revolution modulation adds the
  slow warble of gear eccentricity.
- **1973 Stock: DC camshaft.** A per-unit model of the motor circuit has
  10 series notches, transition, 8 parallel notches and 4 weak-field steps.
  The current-limit relay turns the camshaft one notch when the current
  falls below its setting. Each notch is a click, and the current jumps.
  Power off runs the cam back with a ratchet of clicks. In rheostatic
  braking the camshaft cuts out resistance as the speed falls, until the
  brake fades at about 3.5 m/s. Under power the motors hum at the 600 Hz
  substation rectifier ripple, and the magnetic growl surges with current.
- **S7 Stock: IGBT VVVF.** f1 = pole pairs x motor rev/s + slip. The pulse
  mode comes from a carrier schedule: asynchronous at a fixed carrier, then
  synchronous 15, 9, 5 and 3 pulse, then one pulse. Four oscillators play
  the four strongest current harmonics. Their amplitudes come from the
  Bessel series of sine-triangle PWM, and the motor inductance filters them
  as 1/f. The model drops synchronous lines on triplen harmonics, because a
  balanced 3-phase motor does not carry them. A mode change jumps the
  pitch. When the train coasts the inverter gates off and its tones stop.
- **GTO VVVF.** The same model with the low carrier of the GEC Alsthom
  GTO inverter on the 1996 Stock (Jubilee line). At the start the carrier
  is asynchronous at 300 Hz: a deep, steady tone at 300 and 600 Hz. At
  f1 = 300 / 21 = 14.3 Hz, 21 pulse takes over with no jump. At 20 Hz,
  15 pulse drops the carrier from 420 to 300 Hz. That is the only step
  below 40 Hz. Above 40 Hz the schedule continues with 15, 9, 5 and 3
  pulse, then one pulse. A real 1996 Stock departure (Wikimedia Commons,
  CC BY 4.0) shows the 300 Hz carrier and the steps at 14.3 and 20 Hz.

### 2. Rolling noise and rail joints (`audio/rolling.ts`, `core/joints.ts`)

- Roughness noise centred at v / 4 cm, with amplitude in proportion to
  v^1.5 (30 log10 v). Also a low structure-borne rumble, a narrow
  corrugation "roar" at v / 5.5 cm, and high rail sizzle.
- Rail joints every 18.288 m (60 ft bullhead rail). Each of the 24 axles
  (two per bogie, two bogies per car) strikes each joint at an exact
  scheduled time, so the "di-dum ... di-dum" rhythm follows speed and bogie
  spacing. The leading axle of each bogie strikes harder. An axle beside
  the listener sounds louder than the rest of its car.
- Each impact is modal synthesis: a contact crack, rail and wheel modes
  near 0.6-3.5 kHz, a wheelset bounce near 90 Hz, and a body thump near
  40 Hz. Eight variants play at random pitch and level.
- One axle has a small wheel flat, which thumps once per wheel revolution.

### 3. Flange squeal (`audio/squeal.ts`)

On curves, two oscillators lock onto wheel web modes (1.2-4.4 kHz). A random
walk moves the pitch, the tone hops between modes, a random on/off process
makes the bursts, and a fast vibrato adds the stick-slip rasp. The level
follows curve amount and speed. The default track has a tight curve in the
tunnel before the platform.

### 4. Brakes and air (`audio/brakes.ts`, `core/air.ts`, `audio/compressor.ts`)

- Each car has a brake cylinder model. The hiss reads the air flow:
  exhaust is the loud release "pssh", and supply is a soft hiss. The
  electric brake fades at low speed, so the friction brake fills in. That
  gives the hiss just before a stop.
- Block friction: a broad scrape that follows cylinder pressure and speed.
- The groan: stick-slip below about 2 m/s, a rough sawtooth that falls with
  speed, shaken by a 6-12 Hz judder. A body lurch plays at the stop.
- The main reservoir loses air to brakes and doors. At the cut-in pressure
  the compressors start: piston thumps at about 12 per second after a
  run-up, and a motor hum. At cut-out the unloader valve blows off.

### 5. Doors (`core/synth.ts`, `train.ts`)

- 1973 Stock: pneumatic door engines. A valve hiss, the roller slide, the
  leaves hitting the stops, and an exhaust after closing.
- S7 Stock: electric doors with a motor whir, and an open chime.
- The leaves take 1.26 s to open and 1.5 s to close (pneumatic), or
  1.92 s and 2.28 s (electric). The hiss, the thuds and the exhaust keep
  their lengths and follow the leaves.
- Both: the door-closing warning. Beeps of 0.11 s at 2.29 kHz, 6 per
  second, 12 beeps in the default 2 s, then the doors move. Two
  recordings on Wikimedia Commons (1995 and 1996 Stock, CC BY 4.0) give
  the cadence and the pitch. LU specifies 1.75 +/- 0.25 s from the first
  beep to door movement (TfL, "Increased Warning Tone Duration on
  Victoria Line 09TS, Trial Final Report"). Every door of every car
  plays, staggered by a few tens of milliseconds, from its own position.

### 6. Tunnel acoustics (`core/geometry.ts`, `core/impulse.ts`, `audio/wind.ts`)

- Each car is a separate source with a delay line set to path length / c.
  The delay change is the Doppler shift. The gain and filter changes arrive
  at the listener with the sound.
- In the tunnel, the spreading loss is weak, the walls absorb high
  frequencies, and the sound comes from the mouth. This gives the distant
  rumble before arrival.
- Two generated impulse responses feed two convolvers. The platform has
  early reflections, a flutter echo between the curved tiled walls, and a
  2.6 s low-frequency decay. The running tunnel has a dark, long tail and
  its cross modes: 1.841, 3.054 and 3.832 x c / (pi D). For D = 3.56 m these
  are 56, 94 and 117 Hz.
- Piston wind: the train pushes an air column ahead of it. The rush grows
  from the tunnel mouth before the train arrives, and continues after it.
- Rail singing: a faint high hiss along the rail before the train is near.

### 7. Ambience (`audio/ambient.ts`)

A 100 Hz mains hum with harmonics, ventilation noise with a fan blade tone,
and now and then a distant train rumbling through the rock.

## How we checked the sound

The checks used offline renders in headless Chrome, with spectrograms and
peak lists:

- The whine lines fall during rheostatic braking and rise on departure,
  one line per motor car (604-686 Hz at 20 m/s from wheel wear).
- The commutator whistle falls from about 4 kHz.
- The GTO departure starts with a steady 600 Hz line and a weak line near
  300 Hz, as in the 1996 Stock recording. The first step comes at
  f1 = 20 Hz.
- The approach builds by about 12 dB over 12 s.
- The door warning is a 2.29 kHz line that pulses at 6 Hz, as in the
  1995 and 1996 Stock recordings.
- The release hiss shows as a bright column.

These checks found and fixed real faults: too-loud tunnel modes, a reverb
send that ignored distance, the inverter fundamental sounding as ripple,
and too much current on weak-field steps.

## Limitations

- The S7 carrier schedule and gear teeth are plausible values, not
  measurements. We found no published data.
- The GTO schedule follows the 1996 Stock only below 20 Hz. The real
  inverter then uses selective harmonic elimination modes. The model
  keeps plain synchronous modes, which have a different spectrum.
- We tuned the levels by spectrum and judgement, not by calibrated SPL.
  Real platform noise is 85-95 dBA during an arrival.
- No fourth-rail shoe gap arcs, no announcements, no "mind the gap".
- The voices use about 50 nodes per car, so a 7-car train has about 350
  nodes. Two trains at once are fine on a desktop. On a phone, keep it to
  one.
- The squeal and the flat are random. A seed (`seed` option) makes them
  repeatable.

## Layout

| Path | Contents |
|---|---|
| `src/core/` | Pure models and DSP: stock data, kinematics, joints, camshaft, inverter, air, geometry, track, scripts, filters, buffer synthesis, impulse responses. No Web Audio. |
| `src/audio/` | Web Audio voices, one per component, and the shared sound bank. |
| `src/station.ts`, `src/train.ts` | The public classes. |
| `src/offline.ts` | `renderOffline`. |
| `demo/` | The demo page. |
| `test/` | `bun test` for everything in `src/core/`. |

```bash
yarn workspace tube-sounds test
yarn workspace tube-sounds typecheck
```
