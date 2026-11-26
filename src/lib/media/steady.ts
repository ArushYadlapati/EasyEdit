import { packBytes, unpackBytes } from "@/lib/color/cube";

// Steadying a shaky video. From how the whole picture shifts between each frame and the next (motion.ts) comes the
// path the camera took; a smoothed path is what it would have taken held steady; and the difference, frame by
// frame, is how far the picture has to be moved back. Those moves are kept on the clip, packed small, and the
// picture is drawn a little larger so the moves never show its edges. Pure.

// A shift is kept in this many parts of the picture's width or height: fine enough for a twentieth of a pixel of 4K.
export const STEADY_UNITS = 20_000;
export const STEADY_ZOOM_MAX = 1.25; // the most the picture is enlarged to hide its edges
export const STEADY_STRENGTHS = { light: 0.3, normal: 0.7, strong: 1.5 } as const; // seconds the path is evened out over, each way
export type SteadyStrength = keyof typeof STEADY_STRENGTHS;

export type Shift = { dx: number; dy: number }; // shares of the picture's width and height

// The camera's path: where the picture is at each frame, from the shifts between frames (the first frame at 0, 0).
// A shift that is not known counts as none.
export function cameraPath(shifts: readonly (Shift | null)[]): Shift[] {
  const path: Shift[] = [{ dx: 0, dy: 0 }];
  for (const shift of shifts) {
    const last = path[path.length - 1];
    path.push({ dx: last.dx + (shift?.dx ?? 0), dy: last.dy + (shift?.dy ?? 0) });
  }
  return path;
}

// A path evened out: each point the average of those up to `reach` frames either side of it, done twice, so that a
// jolt is spread smoothly. A steady pan stays a pan; the shake on it goes.
export function evenPath(path: readonly Shift[], reach: number): Shift[] {
  const once = (points: readonly Shift[]) => {
    // Running sums, so each average is two look-ups.
    const sumX = [0];
    const sumY = [0];
    for (const p of points) {
      sumX.push(sumX[sumX.length - 1] + p.dx);
      sumY.push(sumY[sumY.length - 1] + p.dy);
    }
    return points.map((_, i) => {
      // As far each way as there are frames on both sides, so the ends are not pulled towards the middle.
      const r = Math.min(reach, i, points.length - 1 - i);
      const n = 2 * r + 1;
      return { dx: (sumX[i + r + 1] - sumX[i - r]) / n, dy: (sumY[i + r + 1] - sumY[i - r]) / n };
    });
  };
  return reach <= 0 ? [...path] : once(once(path));
}

// How far each frame's picture is moved to sit on the even path, and how much larger it is drawn so that the move
// never shows an edge. A move that would need more than the largest enlargement is held to what that allows.
export function steadyMoves(path: readonly Shift[], reach: number): { moves: Shift[]; zoom: number } {
  const even = evenPath(path, reach);
  const most = (STEADY_ZOOM_MAX - 1) / 2;
  const hold = (v: number) => Math.max(-most, Math.min(most, v));
  const moves = path.map((p, i) => ({ dx: hold(even[i].dx - p.dx), dy: hold(even[i].dy - p.dy) }));
  const far = Math.max(0, ...moves.map((m) => Math.max(Math.abs(m.dx), Math.abs(m.dy))));
  return { moves, zoom: Math.round((1 + 2 * far) * 1000) / 1000 };
}

// The moves as text: two signed 16-bit numbers a frame, low byte first, in base64.
export function packMoves(moves: readonly Shift[]): string {
  const bytes = new Uint8Array(moves.length * 4);
  const view = new DataView(bytes.buffer);
  moves.forEach((move, i) => {
    view.setInt16(i * 4, Math.max(-32768, Math.min(32767, Math.round(move.dx * STEADY_UNITS))), true);
    view.setInt16(i * 4 + 2, Math.max(-32768, Math.min(32767, Math.round(move.dy * STEADY_UNITS))), true);
  });
  return packBytes(bytes);
}

// And back: one move a frame, as numbers to read by index. Null for text that is no such list. The same list each
// time for the same text, since a clip's moves are read at every frame drawn.
const UNPACKED = new Map<string, Int16Array | null>();
export function unpackMoves(data: string): Int16Array | null {
  const kept = UNPACKED.get(data);
  if (kept !== undefined) return kept;
  const bytes = unpackBytes(data);
  const moves = bytes && bytes.length % 4 === 0 ? new Int16Array(bytes.length / 2) : null;
  if (bytes && moves) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < moves.length; i++) moves[i] = view.getInt16(i * 2, true);
  }
  if (UNPACKED.size >= 16) UNPACKED.delete(UNPACKED.keys().next().value as string);
  UNPACKED.set(data, moves);
  return moves;
}

// How many frames a packed list holds, without unpacking it; null when its length is not a whole number of frames.
export function packedFrames(data: string): number | null {
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return null;
  const pad = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  const bytes = (data.length / 4) * 3 - pad;
  return bytes % 4 === 0 ? bytes / 4 : null;
}

// A clip's steadying: its moves from the file's frame `from` on (counted at the project's frame rate), and its zoom.
export type Steadying = { from: number; zoom: number; data: string };

// The move for one frame of the file, in shares of the picture. A frame the list does not reach is not moved.
export function moveAt(steady: Steadying, fileFrame: number): Shift {
  const moves = unpackMoves(steady.data);
  const i = Math.round(fileFrame) - steady.from;
  if (!moves || i < 0 || i * 2 + 1 >= moves.length) return { dx: 0, dy: 0 };
  return { dx: moves[i * 2] / STEADY_UNITS, dy: moves[i * 2 + 1] / STEADY_UNITS };
}
