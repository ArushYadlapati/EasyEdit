import { CUBE_BYTES_MAX, CUBE_MESSAGE, lutName, packBytes, parseCube, shrinkCube } from "@/lib/color/cube";
import { NO_WHEEL, RED_ANGLE, isCurveSet, isWheelSet, type CurvePoint, type Wheel } from "@/lib/color/grade";
import { LIMITS } from "@/lib/limits";
import { isStorableText } from "@/lib/text";
import type { Clip, Grade, Lut, MediaClip, OpInput, TimelineDoc } from "@/lib/timeline";

// The editing side of a picture's colour grade: what the wheels, the curve editor and the look-up table menu turn a
// drag, a click or a file into. Pure, so every rule is tested without a screen.

export type WheelKey = "lift" | "gamma" | "gain";
export const WHEELS: readonly { key: WheelKey; label: string }[] = [
  { key: "lift", label: "Shadows" },
  { key: "gamma", label: "Midtones" },
  { key: "gain", label: "Highlights" },
];

export type CurveKey = "curve" | "curveR" | "curveG" | "curveB";
export const CURVES: readonly { key: CurveKey; label: string; color: string }[] = [
  { key: "curve", label: "All", color: "#e6e6e6" },
  { key: "curveR", label: "Red", color: "#ff5c5c" },
  { key: "curveG", label: "Green", color: "#4cd964" },
  { key: "curveB", label: "Blue", color: "#5aa2ff" },
];

export function isPicture(clip: Clip | undefined): clip is MediaClip & { type: "video" | "image" } {
  return !!clip && (clip.type === "video" || clip.type === "image");
}

// Whether any part of a grade changes the picture. A table counts while the clip names one, whether or not the
// project still has it, so Reset can always take the name off.
export function isGraded(grade: Grade | undefined): boolean {
  if (!grade) return false;
  return [grade.lift, grade.gamma, grade.gain].some(isWheelSet) || [grade.curve, grade.curveR, grade.curveG, grade.curveB].some(isCurveSet) || grade.lut != null;
}

// The update_clip patch that takes a whole grade off.
export const NO_GRADE: Grade = { lift: { ...NO_WHEEL }, gamma: { ...NO_WHEEL }, gain: { ...NO_WHEEL }, curve: [], curveR: [], curveG: [], curveB: [], lut: null, lutAmount: 1 };

const places = (n: number) => Number(n.toFixed(3));
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// A puck dragged to x, y (in circle radii from the middle, y up): kept inside the circle, and pulled to the middle
// when it is all but there, so "no push" is easy to land on.
export function puckAt(x: number, y: number): { x: number; y: number } {
  const reach = Math.hypot(x, y);
  if (reach < 0.04) return { x: 0, y: 0 };
  const k = reach > 1 ? 1 / reach : 1;
  return { x: places(x * k), y: places(y * k) };
}

export function wheelOf(grade: Grade | undefined, key: WheelKey): Wheel {
  return grade?.[key] ?? NO_WHEEL;
}

// A wheel is one value: it is sent whole.
export function wheelOps(clip: Clip, key: WheelKey, change: Partial<Wheel>): OpInput[] | null {
  if (!isPicture(clip)) return null;
  const now = wheelOf(clip.grade, key);
  const next = { ...now, ...change };
  if (next.x === now.x && next.y === now.y && next.level === now.level) return [];
  return [{ op: "update_clip", clipId: clip.id, patch: { grade: { [key]: next } } }];
}

const HUE_NAMES = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "magenta"];
const HUE_AT = [0, 30, 60, 120, 180, 240, 280, 315];

// A puck's place in words, for a screen reader: how far it is pushed and towards which colour.
export function puckName(wheel: Wheel): string {
  const reach = Math.hypot(wheel.x, wheel.y);
  if (reach === 0) return "No push";
  const hue = (((Math.atan2(wheel.y, wheel.x) * 180) / Math.PI - RED_ANGLE) % 360 + 360) % 360;
  let best = 0;
  HUE_AT.forEach((at, i) => {
    const far = Math.min(Math.abs(hue - at), 360 - Math.abs(hue - at));
    const nearest = Math.min(Math.abs(hue - HUE_AT[best]), 360 - Math.abs(hue - HUE_AT[best]));
    if (far < nearest) best = i;
  });
  return `${Math.round(Math.min(1, reach) * 100)}% towards ${HUE_NAMES[best]}`;
}

// The CSS picture behind a wheel: every colour round the rim where its puck pushes towards it, fading to grey in the
// middle. A CSS angle runs clockwise from the top; a puck's runs counter-clockwise from the right.
export function wheelBackground(): string {
  const stops: string[] = [];
  for (let turn = 0; turn <= 360; turn += 30) stops.push(`hsl(${(((90 - turn - RED_ANGLE) % 360) + 360) % 360} 85% 55%) ${turn}deg`);
  return `radial-gradient(closest-side, rgb(128 128 128) 0%, rgb(128 128 128 / 0) 100%), conic-gradient(from 0deg, ${stops.join(", ")})`;
}

// A curve as it is drawn and dragged: the straight line's two ends when it has no points of its own.
export const STRAIGHT: readonly CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];

export function curveOf(grade: Grade | undefined, key: CurveKey): readonly CurvePoint[] {
  const points = grade?.[key];
  return points && points.length >= 2 ? points : STRAIGHT;
}

// The nearest two points may sit, side to side.
export const CURVE_GAP = 0.02;

// A curve as it is stored: nothing at all when it is the straight line.
function stored(points: readonly CurvePoint[]): CurvePoint[] {
  const tidy = points.map((p) => ({ x: places(p.x), y: places(p.y) }));
  return tidy.length === 2 && tidy[0].x === 0 && tidy[0].y === 0 && tidy[1].x === 1 && tidy[1].y === 1 ? [] : tidy;
}

// One of a curve's points moved, staying between its neighbours.
export function movePoint(points: readonly CurvePoint[], index: number, x: number, y: number): CurvePoint[] {
  const min = index === 0 ? 0 : points[index - 1].x + CURVE_GAP;
  const max = index === points.length - 1 ? 1 : points[index + 1].x - CURVE_GAP;
  return points.map((p, i) => (i === index ? { x: places(clamp(x, min, max)), y: places(clamp(y, 0, 1)) } : { ...p }));
}

// A point added at x, y. Null when there is no room: too near another point, or the curve is full.
export function addPoint(points: readonly CurvePoint[], x: number, y: number): { points: CurvePoint[]; index: number } | null {
  if (points.length >= LIMITS.curvePoints) return null;
  if (points.some((p) => Math.abs(p.x - x) < CURVE_GAP)) return null;
  const index = points.findIndex((p) => p.x > x);
  const at = index === -1 ? points.length : index;
  const point = { x: places(clamp(x, 0, 1)), y: places(clamp(y, 0, 1)) };
  return { points: [...points.slice(0, at).map((p) => ({ ...p })), point, ...points.slice(at).map((p) => ({ ...p }))], index: at };
}

// A point taken out. A curve keeps two, so the last two stay; null then.
export function removePoint(points: readonly CurvePoint[], index: number): CurvePoint[] | null {
  if (points.length <= 2) return null;
  return points.filter((_, i) => i !== index).map((p) => ({ ...p }));
}

export function curveOps(clip: Clip, key: CurveKey, points: readonly CurvePoint[]): OpInput[] | null {
  if (!isPicture(clip)) return null;
  const next = stored(points);
  const now = stored(clip.grade?.[key] ?? []);
  if (JSON.stringify(next) === JSON.stringify(now)) return [];
  return [{ op: "update_clip", clipId: clip.id, patch: { grade: { [key]: next } } }];
}

// The picture's table: the project's own entry, or null when the clip names none or the project no longer has it.
export function lutOfClip(doc: TimelineDoc, clip: Clip): Lut | null {
  const id = isPicture(clip) ? clip.grade?.lut : null;
  return (id && doc.luts?.find((l) => l.id === id)) || null;
}

export type LutImport = { ok: true; lut: Omit<Lut, "id"> } | { ok: false; message: string };

// A .cube file's text as a table ready to keep.
export function readCubeFile(fileName: string, text: string): LutImport {
  if (text.length > CUBE_BYTES_MAX) return { ok: false, message: "That file is too large to read as a look-up table." };
  const cube = parseCube(text);
  if ("error" in cube) return { ok: false, message: CUBE_MESSAGE[cube.error] };
  const lut = shrinkCube(cube);
  const name = lutName(fileName, cube.title);
  return { ok: true, lut: { name: isStorableText(name) ? name : "LUT", size: lut.size, data: packBytes(lut.data) } };
}

// A new table joins the project and the clip takes it, as one change. A table with the same colours is already
// there: the clip takes that one, and nothing is kept twice. Null when the project is full.
export function importLutOps(doc: TimelineDoc, clip: Clip, lut: Omit<Lut, "id">, newId: string): OpInput[] | null {
  if (!isPicture(clip)) return null;
  const same = doc.luts?.find((l) => l.size === lut.size && l.data === lut.data);
  if (same) return pickLutOps(clip, same.id) ?? [];
  if ((doc.luts?.length ?? 0) >= LIMITS.lutsPerProject) return null;
  return [
    { op: "add_lut", lut: { id: newId, ...lut } },
    { op: "update_clip", clipId: clip.id, patch: { grade: { lut: newId } } },
  ];
}

export function pickLutOps(clip: Clip, lutId: string | null): OpInput[] | null {
  if (!isPicture(clip)) return null;
  if ((clip.grade?.lut ?? null) === lutId) return [];
  return [{ op: "update_clip", clipId: clip.id, patch: { grade: { lut: lutId } } }];
}

// A table leaves the project: every clip that names it lets go of it first, so an undo brings back both.
export function removeLutOps(doc: TimelineDoc, lutId: string): OpInput[] {
  if (!doc.luts?.some((l) => l.id === lutId)) return [];
  const ops: OpInput[] = [];
  for (const track of doc.tracks) {
    if (track.locked) continue;
    for (const clip of track.clips) {
      if (isPicture(clip) && clip.grade?.lut === lutId) ops.push({ op: "update_clip", clipId: clip.id, patch: { grade: { lut: null } } });
    }
  }
  ops.push({ op: "remove_lut", lutId });
  return ops;
}
