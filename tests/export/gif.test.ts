import { describe, expect, it } from "vitest";
import { createGif, gifDelay, gifSize, gifStep, lzw, paletteOf } from "@/lib/export/gif";

// A reader for the files the writer makes, written apart from it: the format's own rules, not the writer's.
function unLzw(blocks: Uint8Array, pixelCount: number): Uint8Array {
  const bytes: number[] = [];
  let at = 0;
  while (blocks[at] !== 0) {
    for (let i = 1; i <= blocks[at]; i++) bytes.push(blocks[at + i]);
    at += blocks[at] + 1;
  }
  const out = new Uint8Array(pixelCount);
  let size = 0;
  let table: number[][] = [];
  const reset = () => {
    table = Array.from({ length: 258 }, (_, i) => (i < 256 ? [i] : []));
  };
  reset();
  let width = 9;
  let bit = 0;
  let before: number[] | null = null;
  for (;;) {
    let code = 0;
    for (let i = 0; i < width; i++, bit++) code |= ((bytes[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === 256) {
      reset();
      width = 9;
      before = null;
      continue;
    }
    if (code === 257) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (code === table.length && before) entry = [...before, before[0]];
    else throw new Error(`code ${code} is not in a table of ${table.length}`);
    for (const pixel of entry) out[size++] = pixel;
    if (before && table.length < 4096) table.push([...before, entry[0]]);
    if (table.length === 1 << width && width < 12) width++;
    before = entry;
  }
  if (size !== pixelCount) throw new Error(`${size} pixels, not ${pixelCount}`);
  return out;
}

type Read = { width: number; height: number; loops: boolean; frames: { delay: number; seeThrough: boolean; picture: Uint8Array }[] };

// Plays the file: each frame's picture is what is on screen after it, RGB.
function readGif(file: Uint8Array): Read {
  const text = (from: number, length: number) => String.fromCharCode(...file.slice(from, from + length));
  expect(text(0, 6)).toBe("GIF89a");
  const width = file[6] | (file[7] << 8);
  const height = file[8] | (file[9] << 8);
  expect(file[10] & 0x80).toBe(0); // no table of the file's own
  let at = 13;
  let loops = false;
  const screen = new Uint8Array(width * height * 3);
  const frames: Read["frames"] = [];
  let delay = 0;
  let seeThrough: number | null = null;
  while (file[at] !== 0x3b) {
    if (file[at] === 0x21 && file[at + 1] === 0xff) {
      loops = text(at + 3, 11) === "NETSCAPE2.0" && file[at + 16] === 0 && file[at + 17] === 0;
      at += 19;
    } else if (file[at] === 0x21 && file[at + 1] === 0xf9) {
      expect((file[at + 3] >> 2) & 7).toBe(1); // left in place
      delay = file[at + 4] | (file[at + 5] << 8);
      seeThrough = file[at + 3] & 1 ? file[at + 6] : null;
      at += 8;
    } else if (file[at] === 0x2c) {
      expect([file[at + 5] | (file[at + 6] << 8), file[at + 7] | (file[at + 8] << 8), file[at + 9]]).toEqual([width, height, 0x87]);
      const colors = file.slice(at + 10, at + 10 + 768);
      expect(file[at + 778]).toBe(8);
      let end = at + 779;
      while (file[end] !== 0) end += file[end] + 1;
      const pixels = unLzw(file.slice(at + 779, end + 1), width * height);
      pixels.forEach((index, p) => {
        if (index !== seeThrough) screen.set(colors.slice(index * 3, index * 3 + 3), p * 3);
      });
      frames.push({ delay, seeThrough: seeThrough !== null, picture: screen.slice() });
      at = end + 1;
    } else throw new Error(`unknown block 0x${file[at].toString(16)} at ${at}`);
  }
  expect(at).toBe(file.length - 1);
  return { width, height, loops, frames };
}

const join = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
function picture(width: number, height: number, color: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out.set([...color(x, y), 255], (y * width + x) * 4);
  return out;
}
// The furthest any channel of any pixel is from the picture that went in.
function furthest(shown: Uint8Array, rgba: Uint8ClampedArray): number {
  let most = 0;
  for (let p = 0; p < shown.length / 3; p++) for (let c = 0; c < 3; c++) most = Math.max(most, Math.abs(shown[p * 3 + c] - rgba[p * 4 + c]));
  return most;
}

describe("the compression", () => {
  const roundTrip = (pixels: Uint8Array) => expect([...unLzw(lzw(pixels), pixels.length)]).toEqual([...pixels]);
  it("reads back as the pixels that went in: runs, noise, one pixel, none", () => {
    roundTrip(new Uint8Array(5000).fill(7));
    roundTrip(Uint8Array.from({ length: 5000 }, (_, i) => (i * 37 + (i >> 3)) % 256));
    roundTrip(new Uint8Array([200]));
    roundTrip(new Uint8Array(0));
  });
  it("starts its table over when it is full, and keeps to blocks of at most 255 bytes", () => {
    // Enough noise to fill the 4,096 codes several times over.
    let seed = 1;
    const noise = Uint8Array.from({ length: 60_000 }, () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >> 16) & 255);
    roundTrip(noise);
    const packed = lzw(noise);
    let at = 0;
    let blocks = 0;
    while (packed[at] !== 0) {
      at += packed[at] + 1;
      blocks++;
    }
    expect(at).toBe(packed.length - 1);
    expect(blocks).toBeGreaterThan(200);
    // A flat picture packs to almost nothing.
    expect(lzw(new Uint8Array(100_000)).length).toBeLessThan(700);
  });
});

describe("a frame's colours", () => {
  it("are the picture's own when it has few", () => {
    const palette = paletteOf(picture(4, 1, (x) => [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 0, 0]][x] as [number, number, number]));
    expect(palette.count).toBe(3);
    const colors = [0, 1, 2].map((i) => [...palette.colors.slice(i * 3, i * 3 + 3)].join(","));
    expect(colors.sort()).toEqual(["0,0,255", "0,255,0", "255,0,0"]);
  });
  it("are at most 255, each the mean of the pixels it stands for, with more of them where the picture has more pixels", () => {
    // Mostly a red ramp, with a thin strip of blue.
    const rgba = picture(256, 64, (x, y) => (y < 60 ? [x, 0, 0] : [0, 0, x]));
    const palette = paletteOf(rgba);
    expect(palette.count).toBeLessThanOrEqual(255);
    let reds = 0;
    let blues = 0;
    for (let i = 0; i < palette.count; i++) {
      if (palette.colors[i * 3] > palette.colors[i * 3 + 2]) reds++;
      else blues++;
    }
    expect(reds).toBeGreaterThan(blues);
    expect(paletteOf(new Uint8ClampedArray(0)).count).toBe(0);
    // Two near shades in one bin become one colour, between them.
    const pair = paletteOf(picture(2, 1, (x) => [100 + x * 2, 50, 50]));
    expect([pair.count, pair.colors[0]]).toEqual([1, 101]);
  });
});

describe("an animated GIF", () => {
  it("plays back as the pictures that went in, to within the colours a GIF has", () => {
    const [w, h] = [48, 32];
    const gif = createGif(w, h);
    const frames = [0, 1, 2].map((n) => picture(w, h, (x, y) => [(x * 5 + n * 40) % 256, (y * 8) % 256, (x + y + n * 30) % 256]));
    const read = readGif(join(gif.header, ...frames.map((f) => gif.frame(f, 7)), gif.trailer));
    expect([read.width, read.height, read.loops, read.frames.length]).toEqual([w, h, true, 3]);
    expect(read.frames.map((f) => f.delay)).toEqual([7, 7, 7]);
    // 1,536 pixels of nearly as many colours, drawn with 255: no pixel is far off, and most are close.
    read.frames.forEach((frame, n) => {
      expect(furthest(frame.picture, frames[n])).toBeLessThan(40);
      let off = 0;
      for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) off += Math.abs(frame.picture[p * 3 + c] - frames[n][p * 4 + c]);
      expect(off / (w * h * 3)).toBeLessThan(8);
    });
    // A picture of few colours comes back exactly.
    const flat = createGif(4, 4);
    const four = picture(4, 4, (x) => [x * 80, 255 - x * 80, 10]);
    expect(furthest(readGif(join(flat.header, flat.frame(four, 5), flat.trailer)).frames[0].picture, four)).toBe(0);
  });
  it("paints only what changed: a still picture's later frames are almost nothing, and still show it", () => {
    const [w, h] = [64, 64];
    const still = picture(w, h, (x, y) => [x * 4, y * 4, 128]);
    const moved = still.slice();
    moved.set([255, 255, 255, 255], (10 * w + 10) * 4); // one pixel turns white
    const gif = createGif(w, h);
    const first = gif.frame(still, 5);
    const second = gif.frame(still, 5);
    const third = gif.frame(moved, 5);
    const fourth = gif.frame(still, 5);
    expect(second.length).toBeLessThan(first.length / 2);
    const read = readGif(join(gif.header, first, second, third, fourth, gif.trailer));
    expect(read.frames.map((f) => f.seeThrough)).toEqual([false, true, true, true]);
    expect([...read.frames[1].picture]).toEqual([...read.frames[0].picture]);
    const at = (10 * w + 10) * 3;
    expect([...read.frames[2].picture.slice(at, at + 3)]).toEqual([255, 255, 255]);
    // The pixel goes back, now painted on its own and so exactly; nothing else moved in between.
    expect([...read.frames[3].picture.slice(at, at + 3)]).toEqual([40, 40, 128]);
    const rest = (frame: Uint8Array) => [...frame.slice(0, at), ...frame.slice(at + 3)];
    expect(rest(read.frames[3].picture)).toEqual(rest(read.frames[0].picture));
    expect(rest(read.frames[2].picture)).toEqual(rest(read.frames[0].picture));
  });
  it("never drifts: a pixel that creeps a shade a frame is repainted once it leaves the colour it was painted from", () => {
    const gif = createGif(2, 2);
    const parts = [gif.header];
    const pictures = Array.from({ length: 40 }, (_, n) => picture(2, 2, () => [n * 3, 0, 0]));
    for (const p of pictures) parts.push(gif.frame(p, 5));
    const read = readGif(join(...parts, gif.trailer));
    read.frames.forEach((frame, n) => expect(Math.abs(frame.picture[0] - n * 3)).toBeLessThan(8));
  });
  it("refuses a frame of the wrong size, and shows no frame for less than two hundredths", () => {
    const gif = createGif(4, 4);
    expect(() => gif.frame(new Uint8ClampedArray(12), 5)).toThrow(/4 × 4 needs 64 bytes/);
    const read = readGif(join(gif.header, gif.frame(picture(4, 4, () => [1, 2, 3]), 0), gif.trailer));
    expect(read.frames[0].delay).toBe(2);
  });
});

describe("a GIF's size and pace", () => {
  it("fits inside 480 pixels a side, keeping its shape, and is never made larger", () => {
    expect(gifSize({ width: 1920, height: 1080 })).toEqual({ width: 480, height: 270 });
    expect(gifSize({ width: 1080, height: 1920 })).toEqual({ width: 270, height: 480 });
    expect(gifSize({ width: 320, height: 240 })).toEqual({ width: 320, height: 240 });
  });
  it("draws every second frame at 24, 25 and 30 a second, every fourth at 60, and every frame at 15 or under", () => {
    expect([24, 25, 30, 50, 60, 15, 12].map(gifStep)).toEqual([2, 2, 2, 3, 4, 1, 1]);
  });
  it("keeps time: the delays add up to the length, however they round", () => {
    const delays = Array.from({ length: 100 }, (_, i) => gifDelay(i * 2, 2, 30));
    expect(new Set(delays)).toEqual(new Set([6, 7]));
    expect(delays.reduce((a, b) => a + b, 0)).toBe(667); // 200 frames at 30 a second: 6.67 s
    expect(gifDelay(0, 2, 25)).toBe(8);
  });
});
