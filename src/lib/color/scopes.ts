// Scopes: what a frame's colours are, counted, as an editor reads them while grading. Each takes the frame's pixels
// (RGBA bytes, as a canvas gives them) and hands back counts; drawing them is the panel's job. It imports nothing.

export const LEVELS = 256;

// Rec. 709 luma, 0 to 255.
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export type Histogram = { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array; most: number };

// How many pixels sit at each level of red, green, blue and brightness. most: the tallest bar, leaving out pure black
// and pure white, which a letterboxed or clipped frame would otherwise flatten everything else under.
export function histogram(data: Uint8ClampedArray): Histogram {
  const r = new Uint32Array(LEVELS);
  const g = new Uint32Array(LEVELS);
  const b = new Uint32Array(LEVELS);
  const l = new Uint32Array(LEVELS);
  for (let i = 0; i < data.length; i += 4) {
    r[data[i]]++;
    g[data[i + 1]]++;
    b[data[i + 2]]++;
    l[Math.round(luma(data[i], data[i + 1], data[i + 2]))]++;
  }
  let most = 1;
  for (let v = 1; v < LEVELS - 1; v++) most = Math.max(most, r[v], g[v], b[v], l[v]);
  return { r, g, b, luma: l, most };
}

export type Waveform = { columns: number; counts: Uint32Array; most: number };

// Brightness by place across the frame: for each of `columns` strips from left to right, how many pixels sit at
// each brightness. counts[column * 256 + level]. Read like the frame itself: left is left, up is brighter.
export function waveform(data: Uint8ClampedArray, width: number, height: number, columns: number): Waveform {
  const counts = new Uint32Array(columns * LEVELS);
  let most = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const at = Math.min(columns - 1, Math.floor((x / width) * columns)) * LEVELS + Math.round(luma(data[i], data[i + 1], data[i + 2]));
      if (++counts[at] > most) most = counts[at];
    }
  }
  return { columns, counts, most };
}

export type Vectorscope = { size: number; counts: Uint32Array; most: number };

// Colour without brightness: each pixel lands by its two colour-difference numbers (Cb across, Cr up), so grey is
// the middle, a stronger colour is further out, and its hue is the direction. counts[row * size + column], the top
// row first.
export function vectorscope(data: Uint8ClampedArray, size: number): Vectorscope {
  const counts = new Uint32Array(size * size);
  let most = 1;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = luma(r, g, b);
    // Rec. 709 colour differences, each −0.5 to 0.5.
    const cb = (b - y) / 1.8556 / 255;
    const cr = (r - y) / 1.5748 / 255;
    const column = Math.min(size - 1, Math.max(0, Math.round((cb + 0.5) * (size - 1))));
    const row = Math.min(size - 1, Math.max(0, Math.round((0.5 - cr) * (size - 1))));
    if (++counts[row * size + column] > most) most = counts[row * size + column];
  }
  return { size, counts, most };
}

// Where a pure colour sits on the vectorscope, as shares of its width and height (0.5, 0.5 is grey): the targets
// drawn on it. skin: the line skin tones of every shade fall along.
export function vectorPlace(r: number, g: number, b: number): { x: number; y: number } {
  const y = luma(r, g, b);
  return { x: (b - y) / 1.8556 / 255 + 0.5, y: 0.5 - (r - y) / 1.5748 / 255 };
}

// How bright a count is drawn, 0 to 1: a few pixels still show and many do not blow out.
export function glow(count: number, most: number): number {
  return count === 0 ? 0 : Math.min(1, Math.log1p(count) / Math.log1p(most));
}
