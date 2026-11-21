// The audio meter's arithmetic: a level as decibels, where it sits on the scale, and how a bar falls and holds its
// peak between readings. Pure, so the meter only has to paint what these say.

export const METER_FLOOR_DB = -60; // the bottom of the scale; anything quieter shows as nothing
export const METER_TICKS: readonly number[] = [0, -6, -12, -18, -24, -36, -48]; // the lines the scale is marked at
export const FALL_DB_PER_SECOND = 30; // how fast a bar drops once the sound under it has gone
export const HOLD_SECONDS = 1.2; // how long the peak line stays where the loudest moment put it
export const WARN_DB = -12; // above this the bar is yellow, and from HOT_DB it is red
export const HOT_DB = -3;

// The loudest sample, as an amplitude: 1 is full scale.
export function peakOf(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = Math.abs(samples[i]);
    if (x > peak) peak = x; // a NaN never compares greater, so it is skipped
  }
  return peak;
}

// An amplitude in decibels below full scale: 0 at 1, about -6 at a half, -Infinity at silence.
export function toDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

export function fromDb(db: number): number {
  return 10 ** (db / 20);
}

// How far up the scale a level reaches, 0 at the floor and 1 at full scale, evenly per decibel.
export function meterFill(db: number): number {
  if (!(db > METER_FLOOR_DB)) return 0;
  return Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB);
}

// One channel's bar. db: where the bar is drawn. holdDb: the peak line. holdLeft: seconds the line still stays put.
// over: a reading went past full scale, where the exported file is cut flat; it stays lit until it is cleared.
export type Bar = { db: number; holdDb: number; holdLeft: number; over: boolean };

export const RESTING_BAR: Bar = Object.freeze({ db: -Infinity, holdDb: -Infinity, holdLeft: 0, over: false });

const settle = (db: number) => (db > METER_FLOOR_DB ? db : -Infinity);

// The bar after `seconds` more, with `amplitude` the loudest sample read since: it jumps up to a louder reading at
// once and falls at a steady rate otherwise; the peak line waits HOLD_SECONDS, then falls the same way.
export function advanceBar(bar: Bar, amplitude: number, seconds: number): Bar {
  const read = toDb(amplitude);
  const fall = FALL_DB_PER_SECOND * Math.max(0, seconds);
  const db = settle(Math.max(read, bar.db - fall));
  let { holdDb, holdLeft } = bar;
  if (read >= holdDb && read > METER_FLOOR_DB) {
    holdDb = read;
    holdLeft = HOLD_SECONDS;
  } else if (holdLeft > 0) {
    holdLeft = Math.max(0, holdLeft - seconds);
  } else {
    holdDb = settle(holdDb - fall);
  }
  return { db, holdDb, holdLeft, over: bar.over || amplitude > 1 };
}

// Nothing left to draw or to let fall: the meter can stop repainting.
export function barAtRest(bar: Bar): boolean {
  return bar.db === -Infinity && bar.holdDb === -Infinity;
}

// The peak as people read it: "-12.3", "0.0", "+1.5", or "-∞" below the scale.
export function dbLabel(db: number): string {
  if (!(db > METER_FLOOR_DB)) return "-∞";
  const rounded = Math.round(db * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}`;
}
