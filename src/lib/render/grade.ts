import { readLut } from "@/lib/color/cube";
import { curveTable, isBaked, isWheelSet, wheelNumbers, type Baked, type Lut } from "@/lib/color/grade";
import { STYLE_KEYS } from "@/lib/timeline/adjust";
import type { Grade, Lut as DocLut, TimelineDoc } from "@/lib/timeline/types";

// A clip's grade made ready to draw: the wheels as numbers, the curves as a table and its look-up table unpacked.
// Each is worked out once and kept for as long as the clip's grade and the project's tables are the same objects, so
// a frame of playback does none of it again.

// The project's tables, unpacked, by id, each with the text it was unpacked from: another project may use the same
// id for another table.
const unpacked = new Map<string, { data: string; lut: Lut | null }>();
const UNPACKED_KEPT = 32;

export function lutOf(luts: readonly DocLut[] | undefined, id: string | null | undefined): Lut | null {
  const stored = id ? luts?.find((l) => l.id === id) : undefined;
  if (!stored) return null;
  const kept = unpacked.get(stored.id);
  if (kept && kept.data === stored.data) return kept.lut;
  if (unpacked.size >= UNPACKED_KEPT) unpacked.delete(unpacked.keys().next().value!);
  const lut = readLut(stored.size, stored.data);
  unpacked.set(stored.id, { data: stored.data, lut });
  return lut;
}

const kept = new WeakMap<Grade, { luts: readonly DocLut[] | undefined; baked: Baked | null }>();

// Null when the grade changes nothing: no wheel moved, no curve bent, and no table (or none of it mixed in).
export function bakeGrade(grade: Grade | undefined, luts: readonly DocLut[] | undefined): Baked | null {
  if (!grade) return null;
  const before = kept.get(grade);
  if (before && before.luts === luts) return before.baked;
  const wheels = [grade.lift, grade.gamma, grade.gain].some(isWheelSet) ? wheelNumbers(grade.lift, grade.gamma, grade.gain) : null;
  const curves = curveTable({ all: grade.curve, r: grade.curveR, g: grade.curveG, b: grade.curveB });
  const lutAmount = grade.lutAmount ?? 1;
  const lut = lutAmount > 0 ? lutOf(luts, grade.lut) : null;
  const all: Baked = { wheels, curves, lut, lutAmount: lut ? lutAmount : 0 };
  const baked = isBaked(all) ? all : null;
  kept.set(grade, { luts, baked });
  return baked;
}

// Whether any picture in the project is graded or stylised, at any time: such a project cannot be drawn right
// without the graphics card.
export function needsFinisher(doc: TimelineDoc): boolean {
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== "video" && clip.type !== "image") continue;
      if (bakeGrade(clip.grade, doc.luts)) return true;
      if (STYLE_KEYS.some((key) => (clip.adjust?.[key] ?? 0) !== 0 || clip.keyframes?.[key]?.some((k) => k.value !== 0))) return true;
    }
  }
  return false;
}
