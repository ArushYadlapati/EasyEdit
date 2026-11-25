import type { Lut } from "./grade";

// Reading a .cube file, the text format colour look-up tables (LUTs) are shared in, and packing a table small enough
// to keep in a project. It imports nothing a worker lacks.

// The most steps a kept table has along each colour. A file with more is sampled down to this: 17 is the size the
// format's makers ship for previews, and between its steps a colour is blended, so a smooth look loses nothing to see.
export const LUT_SIZE = 17;
// The most steps a file may have; the largest in common use is 65.
export const CUBE_SIZE_MAX = 129;
// The largest file read: a 65-step table is about 7 MB of text.
export const CUBE_BYTES_MAX = 40 * 1024 * 1024;

export type CubeError = "empty" | "one_d" | "size" | "count" | "number";

export const CUBE_MESSAGE: Record<CubeError, string> = {
  empty: "That file has no look-up table in it.",
  one_d: "That file holds a 1D table. EasyEdit reads 3D ones (LUT_3D_SIZE).",
  size: `A table can have 2 to ${CUBE_SIZE_MAX} steps a side.`,
  count: "That file's table is cut short or has extra rows.",
  number: "That file has a row that is not three numbers.",
};

export type ParsedCube = { title: string | null; size: number; values: Float32Array };

// A .cube file's table as numbers, 0 to 1 once its own range (DOMAIN_MIN and DOMAIN_MAX) is taken into account.
export function parseCube(text: string): ParsedCube | { error: CubeError } {
  let title: string | null = null;
  let size = 0;
  let oneD = false;
  const min = [0, 0, 0];
  const max = [1, 1, 1];
  let values: Float32Array | null = null;
  let count = 0;
  // Some programs save the file with a byte-order mark in front, which is not part of its first line.
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (line === "" || line[0] === "#") continue;
    const first = line.charCodeAt(0);
    // A row of numbers starts with a digit, a sign or a point; anything else is a keyword line.
    if (!((first >= 48 && first <= 57) || first === 45 || first === 43 || first === 46)) {
      const [word, ...rest] = line.split(/\s+/);
      const key = word.toUpperCase();
      if (key === "TITLE") title = line.slice(5).trim().replace(/^"(.*)"$/, "$1") || null;
      else if (key === "LUT_3D_SIZE") size = Number(rest[0]);
      else if (key === "LUT_1D_SIZE") oneD = true;
      else if (key === "DOMAIN_MIN" || key === "DOMAIN_MAX") {
        const into = key === "DOMAIN_MIN" ? min : max;
        for (let i = 0; i < 3; i++) if (Number.isFinite(Number(rest[i]))) into[i] = Number(rest[i]);
      }
      continue;
    }
    if (!values) {
      if (oneD && size === 0) return { error: "one_d" };
      if (!Number.isInteger(size) || size < 2 || size > CUBE_SIZE_MAX) return { error: size === 0 ? "empty" : "size" };
      values = new Float32Array(size * size * size * 3);
    }
    if (count >= values.length) return { error: "count" };
    const parts = line.split(/\s+/);
    if (parts.length < 3) return { error: "number" };
    for (let i = 0; i < 3; i++) {
      const n = Number(parts[i]);
      if (!Number.isFinite(n)) return { error: "number" };
      const span = max[i] - min[i];
      values[count++] = span > 0 ? (n - min[i]) / span : n;
    }
  }
  if (!values) return { error: oneD ? "one_d" : "empty" };
  if (count !== values.length) return { error: "count" };
  return { title, size, values };
}

// A parsed table as it is kept: at most LUT_SIZE steps a side, a byte a number. A larger table is read at the kept
// table's steps, blended between its own.
export function shrinkCube(cube: ParsedCube): Lut {
  const from = cube.size;
  const size = Math.min(from, LUT_SIZE);
  const data = new Uint8Array(size * size * size * 3);
  const byte = (n: number) => Math.max(0, Math.min(255, Math.round(n * 255)));
  const read = (r: number, g: number, b: number, c: number) => cube.values[((b * from + g) * from + r) * 3 + c];
  let o = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        if (size === from) {
          for (let c = 0; c < 3; c++) data[o++] = byte(read(r, g, b, c));
          continue;
        }
        // Where this step falls in the larger table, and the eight of its colours around that place.
        const at = [r, g, b].map((i) => (i / (size - 1)) * (from - 1));
        const lo = at.map((v) => Math.min(from - 2, Math.floor(v)));
        const t = at.map((v, i) => v - lo[i]);
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let corner = 0; corner < 8; corner++) {
            const dr = corner & 1;
            const dg = (corner >> 1) & 1;
            const db = (corner >> 2) & 1;
            const weight = (dr ? t[0] : 1 - t[0]) * (dg ? t[1] : 1 - t[1]) * (db ? t[2] : 1 - t[2]);
            if (weight > 0) sum += read(lo[0] + dr, lo[1] + dg, lo[2] + db, c) * weight;
          }
          data[o++] = byte(sum);
        }
      }
    }
  }
  return { size, data };
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// A table's bytes as text (base64), which is how a project keeps it.
export function packBytes(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[c & 63] : "=";
  }
  return out;
}

const B64_AT = new Int16Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_AT[B64.charCodeAt(i)] = i;

// The bytes back from that text; null when it is not base64.
export function unpackBytes(text: string): Uint8Array | null {
  if (text.length % 4 !== 0) return null;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - pad);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n: number[] = [];
    for (let j = 0; j < 4; j++) {
      const code = text.charCodeAt(i + j);
      const isPad = code === 61 && i + j >= text.length - pad;
      const v = isPad ? 0 : code < 128 ? B64_AT[code] : -1;
      if (v < 0) return null;
      n.push(v);
    }
    const word = (n[0] << 18) | (n[1] << 12) | (n[2] << 6) | n[3];
    if (o < bytes.length) bytes[o++] = word >> 16;
    if (o < bytes.length) bytes[o++] = (word >> 8) & 255;
    if (o < bytes.length) bytes[o++] = word & 255;
  }
  return bytes;
}

// How long the kept text of a table of this size is.
export function packedLength(size: number): number {
  return Math.ceil((size * size * size * 3) / 3) * 4;
}

// A kept table read back, or null when its text is not a table of that size.
export function readLut(size: number, packed: string): Lut | null {
  if (packed.length !== packedLength(size)) return null;
  const data = unpackBytes(packed);
  return data && data.length === size * size * size * 3 ? { size, data } : null;
}

// A name for a table read from a file: its title, else the file's name without its ending.
export function lutName(fileName: string, title: string | null): string {
  const base = fileName.replace(/\.[^.]+$/, "").trim();
  return (title?.trim() || base || "LUT").slice(0, 60);
}
