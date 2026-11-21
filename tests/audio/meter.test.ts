import { describe, expect, it } from "vitest";
import {
  FALL_DB_PER_SECOND, HOLD_SECONDS, HOT_DB, METER_FLOOR_DB, METER_TICKS, METER_WIDTH, RESTING_BAR, WARN_DB,
  advanceBar, barAtRest, clampMeterWidth, dbLabel, fromDb, meterFill, peakOf, toDb,
} from "@/lib/audio/meter";

describe("levels and the scale", () => {
  it("keeps its scale", () => {
    expect([METER_FLOOR_DB, FALL_DB_PER_SECOND, HOLD_SECONDS, WARN_DB, HOT_DB]).toEqual([-60, 30, 1.2, -12, -3]);
    expect(METER_TICKS).toEqual([0, -6, -12, -18, -24, -36, -48]);
  });

  it("can be as narrow as 48 px and as wide as 200, in whole px", () => {
    expect(METER_WIDTH).toEqual({ initial: 56, min: 48, max: 200 });
    expect([clampMeterWidth(10), clampMeterWidth(56), clampMeterWidth(120.6), clampMeterWidth(900)]).toEqual([48, 56, 121, 200]);
  });

  it("finds the loudest sample of either sign, and skips what is not a number", () => {
    expect(peakOf(Float32Array.from([0.1, -0.7, 0.3]))).toBeCloseTo(0.7, 6);
    expect(peakOf(Float32Array.from([0.2, NaN, -0.1]))).toBeCloseTo(0.2, 6);
    expect(peakOf(new Float32Array(8))).toBe(0);
    expect(peakOf([])).toBe(0);
  });

  it("reads an amplitude in decibels and back", () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 4);
    expect(toDb(2)).toBeCloseTo(6.0206, 4);
    expect([toDb(0), toDb(-1)]).toEqual([-Infinity, -Infinity]);
    expect(fromDb(-20)).toBeCloseTo(0.1, 12);
    expect(fromDb(toDb(0.37))).toBeCloseTo(0.37, 12);
  });

  it("fills the bar evenly per decibel, from the floor to full scale", () => {
    expect([meterFill(-60), meterFill(-90), meterFill(-Infinity), meterFill(NaN)]).toEqual([0, 0, 0, 0]);
    expect([meterFill(0), meterFill(6)]).toEqual([1, 1]);
    expect(meterFill(-30)).toBeCloseTo(0.5, 12);
    expect(meterFill(-12)).toBeCloseTo(0.8, 12);
  });

  it("writes a level the way people read one", () => {
    expect([dbLabel(-12.34), dbLabel(0), dbLabel(1.46), dbLabel(-60), dbLabel(-Infinity)]).toEqual(["-12.3", "0.0", "+1.5", "-∞", "-∞"]);
  });
});

describe("a bar between readings", () => {
  it("jumps up to a louder reading at once", () => {
    const bar = advanceBar(RESTING_BAR, 0.5, 0.016);
    expect(bar.db).toBeCloseTo(-6.02, 2);
    expect(bar.holdDb).toBeCloseTo(-6.02, 2);
    expect(bar).toMatchObject({ holdLeft: HOLD_SECONDS, over: false });
  });

  it("falls at a steady rate once the sound has gone, down to nothing", () => {
    let bar = advanceBar(RESTING_BAR, 1, 0);
    bar = advanceBar(bar, 0, 0.5);
    expect(bar.db).toBeCloseTo(-15, 9);
    bar = advanceBar(bar, 0, 1);
    expect(bar.db).toBeCloseTo(-45, 9);
    bar = advanceBar(bar, 0, 1);
    expect(bar.db).toBe(-Infinity); // through the floor
  });

  it("stays up while a quieter sound is still louder than where it has fallen to", () => {
    let bar = advanceBar(RESTING_BAR, 1, 0);
    bar = advanceBar(bar, 0.5, 1); // fell to -30, but -6 is being read
    expect(bar.db).toBeCloseTo(-6.02, 2);
  });

  it("holds the peak line, then lets it fall too", () => {
    let bar = advanceBar(RESTING_BAR, 1, 0);
    bar = advanceBar(bar, 0, 1);
    expect([bar.holdDb, +bar.holdLeft.toFixed(3)]).toEqual([0, 0.2]);
    bar = advanceBar(bar, 0, 0.5); // the wait runs out in this step
    expect([bar.holdDb, bar.holdLeft]).toEqual([0, 0]);
    bar = advanceBar(bar, 0, 0.5);
    expect(bar.holdDb).toBeCloseTo(-15, 9);
    // A new peak at or above the line takes it over and starts the wait again.
    bar = advanceBar(bar, 0.5, 0.016);
    expect(bar.holdDb).toBeCloseTo(-6.02, 2);
    expect(bar.holdLeft).toBe(HOLD_SECONDS);
  });

  it("lights the overload once a reading passes full scale, and keeps it lit", () => {
    let bar = advanceBar(RESTING_BAR, 1, 0.016);
    expect(bar.over).toBe(false); // exactly full scale is not over
    bar = advanceBar(bar, 1.01, 0.016);
    expect(bar.over).toBe(true);
    expect(bar.db).toBeGreaterThan(0);
    bar = advanceBar(bar, 0, 5);
    expect(bar.over).toBe(true);
  });

  it("is at rest only when the bar and its peak line are both gone", () => {
    expect(barAtRest(RESTING_BAR)).toBe(true);
    let bar = advanceBar(RESTING_BAR, 0.5, 0);
    expect(barAtRest(bar)).toBe(false);
    bar = advanceBar(bar, 0, 3); // the bar is gone, the line is still held or falling
    expect(bar.db).toBe(-Infinity);
    expect(barAtRest(bar)).toBe(false);
    for (let i = 0; i < 10; i++) bar = advanceBar(bar, 0, 1);
    expect(barAtRest(bar)).toBe(true);
    // The overload light alone does not keep the meter repainting.
    expect(barAtRest({ ...RESTING_BAR, over: true })).toBe(true);
  });

  it("never goes backwards on a negative step", () => {
    const bar = advanceBar(advanceBar(RESTING_BAR, 0.5, 0), 0, -1);
    expect(bar.db).toBeCloseTo(-6.02, 2);
  });
});
