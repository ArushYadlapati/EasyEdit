// A picture's colour grade as plain numbers: three wheels (shadows, midtones, highlights), curves, and a look-up table
// (LUT). It imports nothing, so the shader that grades on the graphics card and the tests that check it share one
// definition of every step. Colours are 0 to 1, as stored (sRGB), which is what a LUT made for video expects.

export type CurvePoint = { x: number; y: number };
// Where a wheel's puck sits (x right, y up, inside the unit circle) and its brightness slider, −1 to 1.
export type Wheel = { x: number; y: number; level: number };
export type Rgb = [number, number, number];

export const NO_WHEEL: Readonly<Wheel> = Object.freeze({ x: 0, y: 0, level: 0 });

export function isWheelSet(wheel: Wheel | undefined): wheel is Wheel {
  return !!wheel && (wheel.x !== 0 || wheel.y !== 0 || wheel.level !== 0);
}

export function isCurveSet(points: readonly CurvePoint[] | undefined): points is readonly CurvePoint[] {
  return !!points && points.length >= 2 && points.some((p) => p.x !== p.y);
}

// The angle red sits at on a wheel, in degrees counter-clockwise from the right. Yellow, green, cyan, blue and magenta
// follow counter-clockwise, sixty degrees apart, which puts them where a vectorscope and other editors' wheels do.
export const RED_ANGLE = 105;

const RAD = Math.PI / 180;

// The colour a puck pushes towards: how much each of red, green and blue moves, −1 to 1. The three always add up to
// 0, so a push changes the colour and not the brightness.
export function wheelTint(wheel: Wheel): Rgb {
  const reach = Math.min(1, Math.hypot(wheel.x, wheel.y));
  if (reach === 0) return [0, 0, 0];
  const hue = Math.atan2(wheel.y, wheel.x) - RED_ANGLE * RAD;
  return [reach * Math.cos(hue), reach * Math.cos(hue - 120 * RAD), reach * Math.cos(hue - 240 * RAD)];
}

// How far a full push moves each kind of wheel.
const LIFT_TINT = 0.2;
const LIFT_LEVEL = 0.25;
const GAIN_TINT = 0.4;
const GAIN_LEVEL = 0.5;
const GAMMA_TINT = 0.4;
const GAMMA_LEVEL = 0.5;

// The three wheels as the numbers each channel is worked with: lift is added to the dark end, gain multiplies, and
// gamma bends the middle (the channel is raised to its inverse).
export type WheelNumbers = { lift: Rgb; gamma: Rgb; gain: Rgb };

export const NO_WHEELS: WheelNumbers = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] };

export function wheelNumbers(lift: Wheel | undefined, gamma: Wheel | undefined, gain: Wheel | undefined): WheelNumbers {
  const l = lift ?? NO_WHEEL;
  const m = gamma ?? NO_WHEEL;
  const g = gain ?? NO_WHEEL;
  const lt = wheelTint(l);
  const mt = wheelTint(m);
  const gt = wheelTint(g);
  const each = (f: (i: number) => number): Rgb => [f(0), f(1), f(2)];
  return {
    lift: each((i) => LIFT_TINT * lt[i] + LIFT_LEVEL * l.level),
    gamma: each((i) => Math.max(0.1, 1 + GAMMA_TINT * mt[i] + GAMMA_LEVEL * m.level)),
    gain: each((i) => Math.max(0, 1 + GAIN_TINT * gt[i] + GAIN_LEVEL * g.level)),
  };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

// One channel through the wheels: lifted from the dark end, multiplied, then its middle bent.
export function wheelValue(value: number, lift: number, gamma: number, gain: number): number {
  const lifted = clamp01((value + lift * (1 - value)) * gain);
  return Math.pow(lifted, 1 / gamma);
}

// A curve through its points, as a function from 0–1 to 0–1. It never overshoots between two points (a monotone
// cubic), so pulling one point never makes a bump somewhere else. Before the first point and after the last it is
// flat. Fewer than two points is the straight line.
export function curveFn(points: readonly CurvePoint[] | undefined): (x: number) => number {
  if (!points || points.length < 2) return clamp01;
  const n = points.length;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) slope.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  // Each point's tangent: the mean of the slopes either side, flattened where the curve turns and held back where it
  // would overshoot (Fritsch and Carlson).
  const tangent: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) tangent.push(slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2);
  tangent.push(slope[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const far = a * a + b * b;
    if (far > 9) {
      const pull = 3 / Math.sqrt(far);
      tangent[i] = pull * a * slope[i];
      tangent[i + 1] = pull * b * slope[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return clamp01(ys[0]);
    if (x >= xs[n - 1]) return clamp01(ys[n - 1]);
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return clamp01((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * tangent[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * tangent[i + 1]);
  };
}

export type Curves = { all?: readonly CurvePoint[]; r?: readonly CurvePoint[]; g?: readonly CurvePoint[]; b?: readonly CurvePoint[] };

export const CURVE_STEPS = 256;

// The curves as one table of 256 steps, four bytes a step (red, green, blue, and a spare that is always 255), which
// is the picture a shader reads them from. Each channel goes through the curve for all three first, then its own.
// Null when no curve bends anything.
export function curveTable(curves: Curves): Uint8Array | null {
  if (![curves.all, curves.r, curves.g, curves.b].some(isCurveSet)) return null;
  const all = curveFn(curves.all);
  const each = [curveFn(curves.r), curveFn(curves.g), curveFn(curves.b)];
  const table = new Uint8Array(CURVE_STEPS * 4);
  for (let i = 0; i < CURVE_STEPS; i++) {
    const through = all(i / (CURVE_STEPS - 1));
    for (let c = 0; c < 3; c++) table[i * 4 + c] = Math.round(each[c](through) * 255);
    table[i * 4 + 3] = 255;
  }
  return table;
}

// One channel through the table, between its two nearest steps, as a shader's sampler reads it.
export function tableValue(table: Uint8Array, channel: number, value: number): number {
  const at = clamp01(value) * (CURVE_STEPS - 1);
  const i = Math.min(CURVE_STEPS - 2, Math.floor(at));
  const t = at - i;
  return (table[i * 4 + channel] * (1 - t) + table[(i + 1) * 4 + channel] * t) / 255;
}

// A look-up table: `size` steps along each of red, green and blue, three bytes a colour, red changing fastest and blue
// slowest (the order a .cube file lists them in).
export type Lut = { size: number; data: Uint8Array };

// A colour through a table, blended between the eight table colours around it.
export function lutValue(lut: Lut, rgb: Rgb): Rgb {
  const { size, data } = lut;
  const last = size - 1;
  const at = rgb.map((v) => clamp01(v) * last);
  const lo = at.map((v) => Math.min(last - 1, Math.floor(v)));
  const t = at.map((v, i) => v - lo[i]);
  const out: Rgb = [0, 0, 0];
  for (let corner = 0; corner < 8; corner++) {
    const dr = corner & 1;
    const dg = (corner >> 1) & 1;
    const db = (corner >> 2) & 1;
    const weight = (dr ? t[0] : 1 - t[0]) * (dg ? t[1] : 1 - t[1]) * (db ? t[2] : 1 - t[2]);
    if (weight === 0) continue;
    const i = ((lo[2] + db) * size * size + (lo[1] + dg) * size + (lo[0] + dr)) * 3;
    out[0] += (data[i] / 255) * weight;
    out[1] += (data[i + 1] / 255) * weight;
    out[2] += (data[i + 2] / 255) * weight;
  }
  return out;
}

// Everything a grade does to one colour, ready to run: the wheels' numbers, the curves' table and the look-up table
// with how much of it is mixed in. A part that changes nothing is null.
export type Baked = { wheels: WheelNumbers | null; curves: Uint8Array | null; lut: Lut | null; lutAmount: number };

export function isBaked(baked: Baked): boolean {
  return baked.wheels !== null || baked.curves !== null || (baked.lut !== null && baked.lutAmount > 0);
}

// One colour through a grade: wheels, then curves, then the look-up table. The shader does the same three steps in
// the same order.
export function gradeColor(baked: Baked, rgb: Rgb): Rgb {
  let out: Rgb = [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
  const { wheels, curves, lut } = baked;
  if (wheels) out = [0, 1, 2].map((i) => wheelValue(out[i], wheels.lift[i], wheels.gamma[i], wheels.gain[i])) as Rgb;
  if (curves) out = [0, 1, 2].map((i) => tableValue(curves, i, out[i])) as Rgb;
  if (lut && baked.lutAmount > 0) {
    const through = lutValue(lut, out);
    out = [0, 1, 2].map((i) => out[i] + (through[i] - out[i]) * baked.lutAmount) as Rgb;
  }
  return out;
}
