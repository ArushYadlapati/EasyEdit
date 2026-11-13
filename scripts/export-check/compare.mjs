// Compares one frame of an exported video with the frame the editor saved as an
// image. Pure: it reads no file. verify.mjs hands it RGB bytes from ffmpeg.
//
// The thresholds are fixed before any real file is checked. When a real export
// fails one, the numbers go to the owner; a threshold is never tuned to make a
// file pass.

export const RULES = Object.freeze({
  maxDiff: 12,
  controlRatio: 3,
  maxColorShift: 12,
  inkLevel: 32,
  minInkPixels: 50,
  pad: 8,
  shift: 6,
  blankMaxDiff: 4,
});

const STILL_NAME = / frame (\d{6})(?: \(\d+\))?\.png$/i;

/**
 * The frame number in the name of an image the editor saved
 * ("Qual recap frame 000045.png", or "… frame 000045 (1).png" after a second download).
 * @param {string} path
 * @returns {number | null}
 */
export function parseStillName(path) {
  const match = STILL_NAME.exec(path);
  return match ? Number(match[1]) : null;
}

/**
 * @typedef {object} FrameComparison
 * @property {boolean} blank   the still had too little ink to find a box, so the whole frame was compared
 * @property {number} diff     mean absolute channel difference between the exported frame and the still
 * @property {number | null} black    control: the exported frame against a black frame, or null when skipped
 * @property {number | null} shifted  control: the exported frame against the still moved, or null when skipped
 * @property {number | null} color    largest mean color shift over solid ink, or null when too little is solid
 * @property {boolean} pass
 * @property {string[]} why    the rules that failed, from "diff", "black", "shifted", "color", in that order
 */

/**
 * @param {Uint8Array} exported  RGB bytes of the video's frame, width × height × 3
 * @param {Uint8Array} still     RGB bytes of the saved image, width × height × 3
 * @param {number} width
 * @param {number} height
 * @param {{ media?: boolean }} [options]  media: the still has footage in it
 * @returns {FrameComparison}
 */
export function compareFrames(exported, still, width, height, options = {}) {
  const media = options.media === true;
  const at = (x, y) => (y * width + x) * 3;
  const isInk = (x, y) => {
    const i = at(x, y);
    return Math.max(still[i], still[i + 1], still[i + 2]) >= RULES.inkLevel;
  };

  let inkCount = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isInk(x, y)) continue;
      inkCount++;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (!media && inkCount < RULES.minInkPixels) {
    const diff = meanDifference(exported, (i) => still[i], 0, 0, width, height, width);
    const pass = diff <= RULES.blankMaxDiff;
    return { blank: true, diff, black: null, shifted: null, color: null, pass, why: pass ? [] : ["diff"] };
  }

  const box = media
    ? { x0: 0, y0: 0, x1: width, y1: height }
    : {
        x0: Math.max(0, left - RULES.pad),
        y0: Math.max(0, top - RULES.pad),
        x1: Math.min(width, right + RULES.pad + 1),
        y1: Math.min(height, bottom + RULES.pad + 1),
      };
  const over = (a, b) => meanDifference(a, b, box.x0, box.y0, box.x1, box.y1, width);
  const stillAt = (i) => still[i];
  const blackAt = () => 0;
  // The still moved `shift` pixels right and down; black where it moved away from.
  const shiftedAt = (i) => {
    const pixel = Math.floor(i / 3);
    const x = (pixel % width) - RULES.shift;
    const y = Math.floor(pixel / width) - RULES.shift;
    return x < 0 || y < 0 ? 0 : still[at(x, y) + (i % 3)];
  };

  const diff = over(exported, stillAt);
  const control = (reference) =>
    media || meanDifference(still, reference, box.x0, box.y0, box.x1, box.y1, width) < 1 ? null : over(exported, reference);
  const black = control(blackAt);
  const shifted = control(shiftedAt);
  const color = colorShift(exported, still, box, width, height, isInk);

  const floor = RULES.controlRatio * Math.max(diff, 1);
  const why = [];
  if (diff > RULES.maxDiff) why.push("diff");
  if (black !== null && black < floor) why.push("black");
  if (shifted !== null && shifted < floor) why.push("shifted");
  if (color !== null && color > RULES.maxColorShift) why.push("color");
  return { blank: false, diff, black, shifted, color, pass: why.length === 0, why };
}

// Mean absolute channel difference between `pixels` and a reference read by
// byte index, over the box [x0, x1) × [y0, y1).
function meanDifference(pixels, reference, x0, y0, x1, y1, width) {
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    for (let i = (y * width + x0) * 3, end = (y * width + x1) * 3; i < end; i++) {
      sum += Math.abs(pixels[i] - reference(i));
    }
  }
  const count = (x1 - x0) * (y1 - y0) * 3;
  return count === 0 ? 0 : sum / count;
}

// Over the solid ink in the box (ink whose four neighbors two pixels away have
// exactly its color in the still), the largest difference, over the three
// channels, between the mean exported color and the mean still color.
function colorShift(exported, still, box, width, height, isInk) {
  const same = (i, x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const j = (y * width + x) * 3;
    return still[i] === still[j] && still[i + 1] === still[j + 1] && still[i + 2] === still[j + 2];
  };
  const exportedSum = [0, 0, 0];
  const stillSum = [0, 0, 0];
  let solid = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if (!isInk(x, y)) continue;
      const i = (y * width + x) * 3;
      if (!(same(i, x - 2, y) && same(i, x + 2, y) && same(i, x, y - 2) && same(i, x, y + 2))) continue;
      solid++;
      for (let c = 0; c < 3; c++) {
        exportedSum[c] += exported[i + c];
        stillSum[c] += still[i + c];
      }
    }
  }
  if (solid < RULES.minInkPixels) return null;
  return Math.max(...[0, 1, 2].map((c) => Math.abs(exportedSum[c] - stillSum[c]) / solid));
}
