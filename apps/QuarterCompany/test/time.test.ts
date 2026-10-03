import { describe, expect, test } from 'vitest';
import {
  DEFAULT_CALENDAR,
  describeTurn,
  GENESIS,
  labelOf,
  ordOf,
  turnsPerDay,
} from '../src/time.ts';

const cal = DEFAULT_CALENDAR;

describe('turn labels', () => {
  test('labels have no zero padding and round-trip through ord', () => {
    expect(labelOf(1, cal)).toBe('fy1-q1-d1-t1');
    for (const ord of [0, 1, 31, 32, 33, 2080, 2081, 9999, 123456]) {
      expect(ordOf(labelOf(ord, cal), cal)).toBe(ord);
    }
    expect(labelOf(0, cal)).toBe(GENESIS);
  });

  test('a day from 09:00 to 17:00 in 15-minute slots has 32 turns', () => {
    expect(turnsPerDay(cal)).toBe(32);
    expect(labelOf(33, cal)).toBe('fy1-q1-d2-t1');
  });

  test('day 1001 is valid, with no padding', () => {
    const ord = 1000 * turnsPerDay(cal) + 1; // day index 1000
    expect(labelOf(ord, cal)).toBe('fy4-q4-d26-t1');
  });

  test('quarters and years roll over', () => {
    const perQuarter = cal.daysPerQuarter * turnsPerDay(cal);
    expect(labelOf(perQuarter + 1, cal)).toBe('fy1-q2-d1-t1');
    expect(labelOf(4 * perQuarter + 1, cal)).toBe('fy2-q1-d1-t1');
  });

  test('labels outside the calendar are refused', () => {
    expect(() => ordOf('fy1-q1-d1-t33', cal)).toThrow();
    expect(() => ordOf('fy1-q5-d1-t1', cal)).toThrow();
    expect(() => ordOf('fy1-q1-d2-t0', cal)).toThrow();
    expect(() => ordOf('fy01-q1-d1-t1x', cal)).toThrow();
  });

  test('describe gives weekday and clock', () => {
    expect(describeTurn('fy1-q1-d1-t2', cal)).toBe('Mon FY1 Q1 day 1, 09:15');
    expect(describeTurn('fy1-q1-d6-t32', cal)).toBe('Mon FY1 Q1 day 6, 16:45');
  });
});
