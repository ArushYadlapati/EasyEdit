import { describe, expect, it } from "vitest";
import { CURVE_STEPS, NO_WHEEL, curveFn, curveTable, gradeColor, isBaked, isCurveSet, isWheelSet, lutValue, tableValue, wheelNumbers, wheelTint, wheelValue, RED_ANGLE, type Baked, type Lut, type Rgb } from "@/lib/color/grade";

const near = (a: number, b: number, by = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(by);
const at = (deg: number, reach = 1) => ({ x: reach * Math.cos((deg * Math.PI) / 180), y: reach * Math.sin((deg * Math.PI) / 180), level: 0 });

// A table that hands every colour back, and one that swaps red and blue.
function table(size: number, make: (r: number, g: number, b: number) => Rgb): Lut {
  const data = new Uint8Array(size ** 3 * 3);
  let o = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) for (const v of make(r / (size - 1), g / (size - 1), b / (size - 1))) data[o++] = Math.round(v * 255);
  return { size, data };
}

describe("a colour wheel's puck", () => {
  it("in the middle pushes nothing", () => {
    expect(wheelTint(NO_WHEEL)).toEqual([0, 0, 0]);
    expect(isWheelSet(NO_WHEEL)).toBe(false);
    expect(isWheelSet(undefined)).toBe(false);
    expect(isWheelSet({ x: 0, y: 0, level: 0.1 })).toBe(true);
  });
  it("pushes towards the colour it is dragged to, and never changes the brightness", () => {
    const red = wheelTint(at(RED_ANGLE));
    near(red[0], 1);
    near(red[1], -0.5);
    near(red[2], -0.5);
    const green = wheelTint(at(RED_ANGLE + 120));
    near(green[1], 1);
    const blue = wheelTint(at(RED_ANGLE + 240));
    near(blue[2], 1);
    for (const deg of [0, 37, 90, 200, 311]) near(wheelTint(at(deg, 0.6)).reduce((a, b) => a + b, 0), 0);
  });
  it("pushes by how far it is from the middle, and no further than the rim", () => {
    near(wheelTint(at(RED_ANGLE, 0.5))[0], 0.5);
    near(wheelTint({ x: 3 * Math.cos((RED_ANGLE * Math.PI) / 180), y: 3 * Math.sin((RED_ANGLE * Math.PI) / 180), level: 0 })[0], 1);
  });
});

describe("the three wheels", () => {
  it("at rest change no colour", () => {
    const n = wheelNumbers(undefined, undefined, undefined);
    expect(n).toEqual({ lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] });
    for (const v of [0, 0.2, 0.5, 1]) near(wheelValue(v, 0, 1, 1), v);
  });
  it("lift moves the dark end and leaves white, gain moves the bright end and leaves black, gamma moves only the middle", () => {
    const lift = wheelNumbers({ x: 0, y: 0, level: 1 }, undefined, undefined).lift[0];
    expect(wheelValue(0, lift, 1, 1)).toBeGreaterThan(0.2);
    near(wheelValue(1, lift, 1, 1), 1);
    const gain = wheelNumbers(undefined, undefined, { x: 0, y: 0, level: -1 }).gain[0];
    near(wheelValue(0, 0, 1, gain), 0);
    near(wheelValue(1, 0, 1, gain), 0.5);
    const gamma = wheelNumbers(undefined, { x: 0, y: 0, level: 1 }, undefined).gamma[0];
    near(wheelValue(0, 0, gamma, 1), 0);
    near(wheelValue(1, 0, gamma, 1), 1);
    expect(wheelValue(0.5, 0, gamma, 1)).toBeGreaterThan(0.6);
  });
  it("stay in range however hard they are pushed", () => {
    const n = wheelNumbers({ x: 1, y: 0, level: 1 }, { x: 0, y: 1, level: -1 }, { x: -1, y: 0, level: 1 });
    for (const v of [0, 0.3, 1]) for (let c = 0; c < 3; c++) {
      const out = wheelValue(v, n.lift[c], n.gamma[c], n.gain[c]);
      expect(out).toBeGreaterThanOrEqual(0);
      expect(out).toBeLessThanOrEqual(1);
    }
    expect(Math.min(...n.gamma)).toBeGreaterThanOrEqual(0.1);
  });
});

describe("a curve", () => {
  it("with no points, or the straight line's two, changes nothing", () => {
    for (const x of [0, 0.25, 0.9, 1]) {
      near(curveFn(undefined)(x), x);
      near(curveFn([])(x), x);
      near(curveFn([{ x: 0, y: 0 }, { x: 1, y: 1 }])(x), x);
    }
    expect(isCurveSet([])).toBe(false);
    expect(isCurveSet([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(isCurveSet([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }])).toBe(false);
    expect(isCurveSet([{ x: 0, y: 0.1 }, { x: 1, y: 1 }])).toBe(true);
    expect(curveTable({})).toBeNull();
    expect(curveTable({ all: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBeNull();
  });
  it("passes through every point, and is flat outside the first and last", () => {
    const points = [{ x: 0.1, y: 0.3 }, { x: 0.4, y: 0.2 }, { x: 0.7, y: 0.9 }, { x: 0.9, y: 0.8 }];
    const f = curveFn(points);
    for (const p of points) near(f(p.x), p.y, 1e-9);
    near(f(0), 0.3);
    near(f(1), 0.8);
  });
  it("never overshoots between two points", () => {
    const f = curveFn([{ x: 0, y: 0 }, { x: 0.45, y: 0.02 }, { x: 0.5, y: 0.98 }, { x: 1, y: 1 }]);
    let last = -1;
    for (let i = 0; i <= 400; i++) {
      const y = f(i / 400);
      expect(y).toBeGreaterThanOrEqual(last - 1e-12);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      last = y;
    }
  });
  it("is baked into a table: each colour through the curve for all, then its own", () => {
    const all = [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }];
    const r = [{ x: 0, y: 1 }, { x: 1, y: 0 }];
    const baked = curveTable({ all, r })!;
    expect(baked.length).toBe(CURVE_STEPS * 4);
    const mid = Math.round(0.5 * (CURVE_STEPS - 1));
    near(baked[mid * 4 + 1] / 255, curveFn(all)(mid / 255), 1 / 255);
    near(baked[mid * 4] / 255, 1 - curveFn(all)(mid / 255), 1 / 255);
    expect(baked[3]).toBe(255);
    near(tableValue(baked, 1, 0.5), curveFn(all)(0.5), 2 / 255);
    near(tableValue(baked, 1, 2), 1, 1e-9); // out of range is the end
  });
});

describe("a look-up table", () => {
  it("that hands colours back changes nothing, at its steps and between them", () => {
    const same = table(5, (r, g, b) => [r, g, b]);
    for (const c of [[0, 0, 0], [1, 1, 1], [0.25, 0.5, 0.75], [0.13, 0.77, 0.41]] as Rgb[]) {
      const out = lutValue(same, c);
      for (let i = 0; i < 3; i++) near(out[i], c[i], 1 / 255);
    }
  });
  it("reads red fastest and blue slowest", () => {
    const swap = table(3, (r, g, b) => [b, g, r]);
    const out = lutValue(swap, [1, 0.5, 0]);
    near(out[0], 0, 1e-9);
    near(out[1], 0.5, 1 / 255);
    near(out[2], 1, 1e-9);
  });
});

describe("a whole grade", () => {
  const none: Baked = { wheels: null, curves: null, lut: null, lutAmount: 0 };
  it("with no part changes nothing", () => {
    expect(isBaked(none)).toBe(false);
    expect(gradeColor(none, [0.2, 0.4, 0.6])).toEqual([0.2, 0.4, 0.6]);
    expect(isBaked({ ...none, lut: table(2, (r, g, b) => [r, g, b]), lutAmount: 0 })).toBe(false);
  });
  it("works the wheels, then the curves, then the table by its amount", () => {
    const wheels = wheelNumbers(undefined, undefined, { x: 0, y: 0, level: -1 }); // halves
    const curves = curveTable({ all: [{ x: 0, y: 1 }, { x: 1, y: 0 }] })!; // turns over
    const lut = table(2, (r, g, b) => [b, g, r]); // swaps red and blue
    const out = gradeColor({ wheels, curves, lut, lutAmount: 1 }, [1, 1, 0]);
    // Halved: .5 .5 0. Turned over: .5 .5 1. Swapped: 1 .5 .5.
    near(out[0], 1, 2 / 255);
    near(out[1], 0.5, 2 / 255);
    near(out[2], 0.5, 2 / 255);
    const half = gradeColor({ wheels: null, curves: null, lut, lutAmount: 0.5 }, [1, 0, 0]);
    near(half[0], 0.5, 1e-9);
    near(half[2], 0.5, 1e-9);
  });
});
