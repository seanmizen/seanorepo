// Scripted train movements. A script is a pure function of time: it gives
// the speed, position, throttle and brake at any instant, plus a list of
// timed events (doors). The train evaluates it on each control tick, so
// the same script plays the same way live and in an offline render.

import { brakingProfile, departureProfile } from './kinematics';
import { clamp, smoothstep } from './math';
import { DOOR_WARNING, doorCloseTime } from './synth';

export interface ControlFrame {
  speed: number;
  accel: number;
  /** Track position of the train front, metres. */
  frontX: number;
  throttle: number;
  brake: number;
}

export type ScriptEventKind = 'doors-open' | 'doors-close';

export interface ScriptEvent {
  /** Absolute audio-context time, s. */
  time: number;
  kind: ScriptEventKind;
  /** For 'doors-close': seconds of warning before the doors move. */
  warning?: number;
}

export interface Script {
  /** Absolute time of the first frame, s. */
  start: number;
  /** Absolute time after which the script has nothing more to say, s. */
  end: number;
  frameAt(time: number): ControlFrame;
  events: ScriptEvent[];
}

export interface ArrivalOptions {
  /** Absolute time at which the brakes go on, s. */
  brakeAt: number;
  /** Track position where the train front stops, metres. */
  stopX: number;
  /** Speed when the brakes go on, m/s. */
  speed?: number;
  /** Braking distance, metres. */
  brakeDistance?: number;
  /** Braking time, s. */
  brakeTime?: number;
  /** Seconds of approach at line speed before the brakes go on. */
  approach?: number;
  /** The driver shuts off power this many seconds before braking. */
  coast?: number;
  /** Brake demand held at a stand, 0..1. */
  holdBrake?: number;
  /** Deceleration that equals full brake demand, m/s^2. */
  fullBrakeDecel?: number;
}

/**
 * Arrival: the train runs at line speed through the tunnel, coasts, then
 * brakes to a stop in `brakeDistance` metres and `brakeTime` seconds.
 */
export const arrivalScript = (o: ArrivalOptions): Script => {
  const v0 = o.speed ?? 20;
  const dist = o.brakeDistance ?? 100;
  const T = o.brakeTime ?? 9;
  const approach = o.approach ?? 12;
  const coast = o.coast ?? 3;
  const hold = o.holdBrake ?? 0.55;
  const full = o.fullBrakeDecel ?? 2.6;
  const profile = brakingProfile(v0, dist, T);
  const brakeX = o.stopX - dist;
  return {
    start: o.brakeAt - approach,
    end: o.brakeAt + T + 1,
    events: [],
    frameAt(time) {
      const t = time - o.brakeAt;
      if (t < 0) {
        return {
          speed: v0,
          accel: 0,
          frontX: brakeX + v0 * t,
          throttle: t < -coast ? 1 : 0,
          brake: 0,
        };
      }
      if (t >= T) {
        return {
          speed: 0,
          accel: 0,
          frontX: o.stopX,
          throttle: 0,
          brake: hold,
        };
      }
      const a = profile.accelAt(t);
      // Brake demand follows deceleration. It never drops below the hold
      // level near the stop, so the train is held when it stops.
      const demand = clamp(-a / full, 0, 1);
      const nearStop = smoothstep(T - 1.2, T, t);
      return {
        speed: Math.max(0, profile.speedAt(t)),
        accel: a,
        frontX: brakeX + profile.distanceAt(t),
        throttle: 0,
        brake: Math.max(demand, hold * nearStop, 0.12),
      };
    },
  };
};

export interface DepartureOptions {
  /** Absolute time at which the train starts to move, s. */
  at: number;
  /** Track position of the train front at a stand, metres. */
  startX: number;
  /** Seconds to accelerate. */
  duration?: number;
  /** Distance covered in `duration`, metres. */
  distance?: number;
  /** Seconds of running after the acceleration ends. */
  tail?: number;
  /** The brake releases this many seconds before the train moves. */
  releaseLead?: number;
  holdBrake?: number;
}

/**
 * Departure: brake release, then full power to clear the platform, then
 * notching back to half power as the train enters the tunnel.
 */
export const departureScript = (o: DepartureOptions): Script => {
  const T = o.duration ?? 9;
  const dist = o.distance ?? 90;
  const tail = o.tail ?? 14;
  const lead = o.releaseLead ?? 0.7;
  const hold = o.holdBrake ?? 0.55;
  const profile = departureProfile(dist, T);
  return {
    start: o.at - lead - 0.5,
    end: o.at + T + tail,
    events: [],
    frameAt(time) {
      const t = time - o.at;
      if (t < 0) {
        const brake = t < -lead ? hold : hold * smoothstep(0, -lead, t);
        // Power comes on as the brake releases.
        return {
          speed: 0,
          accel: 0,
          frontX: o.startX,
          throttle: t > -lead * 0.5 ? 1 : 0,
          brake,
        };
      }
      const speed = profile.speedAt(t);
      return {
        speed,
        accel: profile.accelAt(t),
        frontX: o.startX + profile.distanceAt(t),
        throttle: t < T ? 1 : 0.55,
        brake: 0,
      };
    },
  };
};

export interface ServiceOptions {
  /** Absolute time of t = 0 in the service timeline (the brakes go on), s. */
  at: number;
  stopX: number;
  speed?: number;
  brakeDistance?: number;
  brakeTime?: number;
  /** Doors open at this timeline time, s. */
  doorsOpen?: number;
  /** Doors are shut at this timeline time, s. The warning sounds before it. */
  doorsClosed?: number;
  /** Train starts to move at this timeline time, s. */
  depart?: number;
  departTime?: number;
  departDistance?: number;
  approach?: number;
  /** Length of the door warning before the doors move, s. */
  warning?: number;
}

/**
 * One full service at a platform, on the timeline of the `apps/action` map:
 * t = 0 brakes on at 100 m and 20 m/s, t = 9 stop, t = 10 doors open,
 * t = 24 doors shut, t = 27 depart, t = 36 at line speed.
 */
export const serviceScript = (o: ServiceOptions): Script => {
  const brakeTime = o.brakeTime ?? 9;
  const open = o.doorsOpen ?? 10;
  const closed = o.doorsClosed ?? 24;
  const depart = o.depart ?? 27;
  const warning = o.warning ?? DOOR_WARNING.seconds;
  const arrival = arrivalScript({
    brakeAt: o.at,
    stopX: o.stopX,
    speed: o.speed,
    brakeDistance: o.brakeDistance,
    brakeTime,
    approach: o.approach,
  });
  const departure = departureScript({
    at: o.at + depart,
    startX: o.stopX,
    duration: o.departTime,
    distance: o.departDistance,
  });
  // The door close movement takes about 1.6 s, so start it before `closed`.
  const closeStart = closed - doorCloseTime('pneumatic');
  return {
    start: arrival.start,
    end: departure.end,
    events: [
      { time: o.at + open, kind: 'doors-open' },
      { time: o.at + closeStart - warning, kind: 'doors-close', warning },
    ],
    frameAt(time) {
      return time < departure.start
        ? arrival.frameAt(time)
        : departure.frameAt(time);
    },
  };
};
