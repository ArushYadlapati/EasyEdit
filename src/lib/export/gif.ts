// An animated GIF, written frame by frame. Each frame has its own 255 colours, picked from that frame's pixels, and a
// pixel that has not changed since it was last painted is left see-through, so a still part of the picture costs
// almost nothing. Nothing here touches a canvas or a file: frames come in as RGBA bytes and go out as the bytes to
// append. It imports nothing.

// Colours are compared and counted at five bits a channel: 32,768 bins.
const BINS = 1 << 15;
const binOf = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const COLORS = 255; // a frame's own colours; the last of the 256 is "unchanged"
const UNCHANGED = 255;

export type Palette = {
  colors: Uint8Array; // 256 × RGB; the entries past `count` are black
  count: number;
  indexOf: Uint8Array; // bin → the palette entry its colours are drawn with
};

type Box = { bins: number[]; pixels: number };

// Median cut: the bins that are in use start as one box, and the box holding the most pixels is cut in two across
// its longest side, at its median pixel, until there are `most` boxes or none can be cut. Each box becomes one
// colour: the mean of its pixels.
export function paletteOf(rgba: Uint8ClampedArray | Uint8Array, most = COLORS): Palette {
  const counts = new Uint32Array(BINS);
  const sums = new Float64Array(BINS * 3);
  for (let i = 0; i < rgba.length; i += 4) {
    const bin = binOf(rgba[i], rgba[i + 1], rgba[i + 2]);
    counts[bin]++;
    sums[bin * 3] += rgba[i];
    sums[bin * 3 + 1] += rgba[i + 1];
    sums[bin * 3 + 2] += rgba[i + 2];
  }
  const used: number[] = [];
  for (let bin = 0; bin < BINS; bin++) if (counts[bin] > 0) used.push(bin);
  const channel = (bin: number, c: number) => (bin >> (10 - c * 5)) & 31;
  const pixelsIn = (bins: number[]) => bins.reduce((sum, bin) => sum + counts[bin], 0);
  const boxes: Box[] = used.length > 0 ? [{ bins: used, pixels: pixelsIn(used) }] : [];

  while (boxes.length < most) {
    // The fullest box that still holds more than one bin.
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) if (boxes[i].bins.length > 1 && (pick < 0 || boxes[i].pixels > boxes[pick].pixels)) pick = i;
    if (pick < 0) break;
    const box = boxes[pick];
    let axis = 0;
    let widest = -1;
    for (let c = 0; c < 3; c++) {
      let low = 31;
      let high = 0;
      for (const bin of box.bins) {
        const v = channel(bin, c);
        if (v < low) low = v;
        if (v > high) high = v;
      }
      if (high - low > widest) {
        widest = high - low;
        axis = c;
      }
    }
    box.bins.sort((a, b) => channel(a, axis) - channel(b, axis));
    // Cut where half the box's pixels are on each side, leaving at least one bin either way.
    let seen = 0;
    let cut = 1;
    for (let i = 0; i < box.bins.length - 1; i++) {
      seen += counts[box.bins[i]];
      cut = i + 1;
      if (seen * 2 >= box.pixels) break;
    }
    const first = box.bins.slice(0, cut);
    const second = box.bins.slice(cut);
    boxes[pick] = { bins: first, pixels: pixelsIn(first) };
    boxes.push({ bins: second, pixels: box.pixels - pixelsIn(first) });
  }

  const colors = new Uint8Array(256 * 3);
  const indexOf = new Uint8Array(BINS);
  boxes.forEach((box, index) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const bin of box.bins) {
      r += sums[bin * 3];
      g += sums[bin * 3 + 1];
      b += sums[bin * 3 + 2];
      indexOf[bin] = index;
    }
    colors[index * 3] = Math.round(r / box.pixels);
    colors[index * 3 + 1] = Math.round(g / box.pixels);
    colors[index * 3 + 2] = Math.round(b / box.pixels);
  });
  return { colors, count: boxes.length, indexOf };
}

// GIF's LZW, eight bits a pixel: codes grow from nine bits to twelve, and the table starts over when it is full. The
// result is the code stream cut into the format's blocks of at most 255 bytes, ending with the empty block.
export function lzw(pixels: Uint8Array): Uint8Array {
  const CLEAR = 256;
  const END = 257;
  const TABLE = 5003; // a prime a little over the 4,096 codes there can be
  const keys = new Int32Array(TABLE);
  const codes = new Int32Array(TABLE);
  let out = new Uint8Array(Math.max(1024, pixels.length >> 1));
  let size = 0;
  let blockAt = 0; // where the block being filled keeps its length
  let held = 0; // bits not yet written
  let heldBits = 0;
  let width = 9;
  let next = END + 1;

  const byte = (value: number) => {
    if (size - blockAt === 256) {
      out[blockAt] = 255;
      blockAt = size;
      size++;
    }
    if (size + 2 > out.length) {
      const grown = new Uint8Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    out[size++] = value;
  };
  const emit = (code: number) => {
    held |= code << heldBits;
    heldBits += width;
    while (heldBits >= 8) {
      byte(held & 255);
      held >>>= 8;
      heldBits -= 8;
    }
  };
  const clear = () => {
    keys.fill(-1);
    width = 9;
    next = END + 1;
  };

  size = 1; // the first block's length goes at 0
  clear();
  emit(CLEAR);
  if (pixels.length > 0) {
    let prefix = pixels[0];
    for (let i = 1; i < pixels.length; i++) {
      const pixel = pixels[i];
      const key = (prefix << 8) | pixel;
      let slot = ((pixel << 4) ^ prefix) % TABLE;
      let found = false;
      while (keys[slot] !== -1) {
        if (keys[slot] === key) {
          found = true;
          break;
        }
        slot = slot === 0 ? TABLE - 1 : slot - 1;
      }
      if (found) {
        prefix = codes[slot];
        continue;
      }
      emit(prefix);
      if (next < 4096) {
        keys[slot] = key;
        codes[slot] = next;
        // The reader's table is one entry behind, so the width grows once the new code no longer fits.
        if (next === 1 << width) width++;
        next++;
      } else {
        emit(CLEAR);
        clear();
      }
      prefix = pixel;
    }
    emit(prefix);
  }
  emit(END);
  if (heldBits > 0) byte(held & 255);
  out[blockAt] = size - blockAt - 1; // never empty: a block is opened only for a byte that is then written
  if (size + 1 > out.length) {
    const grown = new Uint8Array(size + 1);
    grown.set(out);
    out = grown;
  }
  out[size++] = 0;
  return out.slice(0, size);
}

const word = (n: number) => [n & 255, (n >> 8) & 255];
const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

export type GifWriter = {
  header: Uint8Array; // the file's first bytes
  // One frame's bytes, to append. rgba: width × height × 4. delay: how long it shows, in hundredths of a second.
  frame(rgba: Uint8ClampedArray | Uint8Array, delay: number): Uint8Array;
  trailer: Uint8Array; // the file's last byte
};

// A GIF that plays over and over.
export function createGif(width: number, height: number): GifWriter {
  // What each pixel was last painted from, as a bin; −1 before the first frame.
  const shown = new Int32Array(width * height).fill(-1);
  const header = new Uint8Array([
    ...ascii("GIF89a"),
    ...word(width), ...word(height),
    0x70, 0, 0, // no colour table of the file's own: every frame brings one
    0x21, 0xff, 11, ...ascii("NETSCAPE2.0"), 3, 1, 0, 0, 0, // repeat forever
  ]);
  return {
    header,
    frame(rgba, delay) {
      if (rgba.length !== width * height * 4) throw new Error(`A GIF frame of ${width} × ${height} needs ${width * height * 4} bytes, not ${rgba.length}.`);
      // The pixels to paint, gathered first: the frame's colours are picked from them alone, so a small change on a
      // still picture gets all 255 colours to itself.
      const pixels = new Uint8Array(width * height).fill(UNCHANGED);
      const painted = new Uint8Array(rgba.length);
      let paintedBytes = 0;
      for (let p = 0, i = 0; p < pixels.length; p++, i += 4) {
        const bin = binOf(rgba[i], rgba[i + 1], rgba[i + 2]);
        if (shown[p] === bin) continue;
        shown[p] = bin;
        pixels[p] = 0;
        painted[paintedBytes++] = rgba[i];
        painted[paintedBytes++] = rgba[i + 1];
        painted[paintedBytes++] = rgba[i + 2];
        paintedBytes++;
      }
      const kept = pixels.length - paintedBytes / 4;
      const palette = paletteOf(painted.subarray(0, paintedBytes));
      for (let p = 0; p < pixels.length; p++) if (pixels[p] !== UNCHANGED) pixels[p] = palette.indexOf[shown[p]];
      const data = lzw(pixels);
      const out = new Uint8Array(8 + 10 + 768 + 1 + data.length);
      let at = 0;
      const put = (bytes: ArrayLike<number>) => {
        out.set(bytes, at);
        at += bytes.length;
      };
      // Left in place when the next frame comes, so its see-through pixels show this one. See-through only when a
      // pixel uses it: the first frame paints every pixel.
      put([0x21, 0xf9, 4, 0x04 | (kept > 0 ? 1 : 0), ...word(Math.max(2, Math.round(delay))), UNCHANGED, 0]);
      put([0x2c, 0, 0, 0, 0, ...word(width), ...word(height), 0x87]); // its own table of 256 colours
      put(palette.colors);
      put([8]);
      put(data);
      return out;
    },
    trailer: new Uint8Array([0x3b]),
  };
}

// A GIF is small and slow next to a video: it fits inside 480 pixels a side and shows at most about fifteen frames a
// second, by drawing every `step`-th frame of the project.
export const GIF_SIDE = 480;
export const GIF_FPS = 15;

export function gifSize(size: { width: number; height: number }): { width: number; height: number } {
  const k = Math.min(1, GIF_SIDE / Math.max(size.width, size.height));
  return { width: Math.max(2, Math.round(size.width * k)), height: Math.max(2, Math.round(size.height * k)) };
}

export function gifStep(fps: number): number {
  return Math.max(1, Math.round(fps / GIF_FPS));
}

// How long the frame drawn at project frame n shows, in hundredths of a second, when the next one drawn is `step`
// frames on. Counted from the start, so the rounding never adds up: 30 frames a second, every other frame, comes out
// as 7, 6, 7 hundredths, and a hundred of them last 6.67 seconds.
export function gifDelay(frame: number, step: number, fps: number): number {
  return Math.round(((frame + step) / fps) * 100) - Math.round((frame / fps) * 100);
}
