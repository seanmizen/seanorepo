// VVVF inverter tones. An AC traction inverter makes a sine wave of
// fundamental f1 from pulses at carrier frequency fc. The motor windings
// and core vibrate at the current harmonics of the pulse pattern, and that
// is the "singing" of an inverter train.
//
// - Asynchronous PWM: fc does not change. The strongest lines are at fc +/- 2 f1 and
//   2 fc +/- f1. As the train speeds up, one tone rises and one falls away
//   from the carrier.
// - Synchronous PWM: fc = N * f1, so all lines rise with speed. At each
//   change of N the pitch jumps. This makes the stepped "scale".
// - One pulse (square wave): only harmonics 6k +/- 1 of f1 are left.
//
// Line amplitudes come from the Bessel series of sine-triangle PWM (Holmes &
// Lipo, "Pulse Width Modulation for Power Converters", ch. 3). They are
// scaled by 1/frequency, because the motor inductance filters the current.

import { besselJ, clamp } from './math';

export type PulseMode =
  | { kind: 'async'; carrierHz: number }
  | { kind: 'sync'; pulses: number }
  | { kind: 'one-pulse' };

/** One step of a carrier schedule: this mode applies while f1 < untilHz. */
export interface CarrierStep {
  untilHz: number;
  mode: PulseMode;
}

/**
 * Plausible IGBT schedule for the S7 Stock (Bombardier MITRAC). No published
 * data exists for the real one. A high fixed carrier at low speed gives the
 * smooth rising and falling whine, then a short run of synchronous modes,
 * then one pulse at speed.
 */
export const IGBT_SCHEDULE: CarrierStep[] = [
  { untilHz: 52, mode: { kind: 'async', carrierHz: 1150 } },
  { untilHz: 72, mode: { kind: 'sync', pulses: 15 } },
  { untilHz: 98, mode: { kind: 'sync', pulses: 9 } },
  { untilHz: 122, mode: { kind: 'sync', pulses: 5 } },
  { untilHz: 140, mode: { kind: 'sync', pulses: 3 } },
  { untilHz: Number.POSITIVE_INFINITY, mode: { kind: 'one-pulse' } },
];

/**
 * GTO schedule with a stepped asynchronous carrier. GTO thyristors switch
 * slowly, so the carrier is low and changes in steps. These steps are tuned
 * to a major scale, in the style of the famous "singing" 1990s inverters.
 */
export const GTO_SCHEDULE: CarrierStep[] = [
  { untilHz: 4, mode: { kind: 'async', carrierHz: 349.2 } }, // F4
  { untilHz: 7, mode: { kind: 'async', carrierHz: 392 } }, // G4
  { untilHz: 10, mode: { kind: 'async', carrierHz: 440 } }, // A4
  { untilHz: 13, mode: { kind: 'async', carrierHz: 466.2 } }, // B flat 4
  { untilHz: 16, mode: { kind: 'async', carrierHz: 523.3 } }, // C5
  { untilHz: 19, mode: { kind: 'async', carrierHz: 587.3 } }, // D5
  { untilHz: 22, mode: { kind: 'async', carrierHz: 659.3 } }, // E5
  { untilHz: 26, mode: { kind: 'async', carrierHz: 698.5 } }, // F5
  { untilHz: 40, mode: { kind: 'sync', pulses: 27 } },
  { untilHz: 55, mode: { kind: 'sync', pulses: 15 } },
  { untilHz: 75, mode: { kind: 'sync', pulses: 9 } },
  { untilHz: 95, mode: { kind: 'sync', pulses: 5 } },
  { untilHz: 110, mode: { kind: 'sync', pulses: 3 } },
  { untilHz: Number.POSITIVE_INFINITY, mode: { kind: 'one-pulse' } },
];

/** The pulse mode at fundamental f1. The last step is the fallback. */
export const pulseModeAt = (schedule: CarrierStep[], f1: number): PulseMode => {
  for (const step of schedule) if (f1 < step.untilHz) return step.mode;
  const last = schedule[schedule.length - 1];
  return last ? last.mode : { kind: 'one-pulse' };
};

/** Index of the active schedule step, to detect a mode change. */
export const pulseModeIndex = (schedule: CarrierStep[], f1: number): number => {
  const i = schedule.findIndex((s) => f1 < s.untilHz);
  return i < 0 ? schedule.length - 1 : i;
};

export const carrierHz = (mode: PulseMode, f1: number): number =>
  mode.kind === 'async'
    ? mode.carrierHz
    : mode.kind === 'sync'
      ? mode.pulses * f1
      : f1;

export interface Tone {
  freq: number;
  amp: number;
}

/** Number of tones `inverterTones` returns. It is fixed, so voices map 1:1. */
export const INVERTER_TONES = 4;

/**
 * The four strongest current harmonics for a mode. `m` is the modulation
 * index (0..~1.27). Amplitudes are relative: 1 = a strong carrier band.
 */
export const inverterTones = (
  mode: PulseMode,
  f1: number,
  m: number,
): Tone[] => {
  const mi = clamp(m, 0, 1.27);
  if (mode.kind === 'one-pulse' || f1 <= 0) {
    // Square wave: harmonic h has amplitude 1/h, current 1/h^2.
    return [5, 7, 11, 13].map((h) => ({
      freq: h * f1,
      amp: (4 / Math.PI / h / h) * 6,
    }));
  }
  const fc = carrierHz(mode, f1);
  const x = (mi * Math.PI) / 2;
  const sb2 = Math.abs(besselJ(2, x)); // fc +/- 2 f1
  const sb1 = Math.abs(besselJ(1, 2 * x)) * 0.5; // 2 fc +/- f1
  const tone = (freq: number, a: number): Tone => {
    if (freq <= 0) return { freq: 0, amp: 0 };
    // In synchronous PWM every line is a harmonic h of f1. In a balanced
    // 3-phase motor, triplen harmonics (h = 3, 9, ...) cancel, and h = 1 is
    // the fundamental itself, not ripple. Only h = 6k +/- 1 is heard.
    if (mode.kind === 'sync') {
      const h = Math.round(freq / f1);
      if (h <= 1 || h % 3 === 0) return { freq, amp: 0 };
    }
    return { freq, amp: (a * 1000) / Math.max(freq, 200) };
  };
  return [
    tone(fc - 2 * f1, sb2),
    tone(fc + 2 * f1, sb2),
    tone(2 * fc - f1, sb1),
    tone(2 * fc + f1, sb1),
  ];
};

/** Modulation index: V/f control up to base frequency, then full voltage. */
export const modulationIndex = (f1: number, baseHz: number): number =>
  clamp(f1 / baseHz, 0.04, 1) * 1.05;
