// The sound clean-up itself: a rumble filter, a noise gate, three tone bands and a compressor for one clip, and a
// limiter for the whole mix. The export runs it sample by sample in its worker, and the preview runs the very same
// code in an audio worklet (public/audio/clean-dsp.js is this file turned into plain JavaScript by
// scripts/make-worklet.mjs), so what is heard while editing is what is exported.
//
// It imports nothing and uses nothing of the page or of Node, so it can run in both places.

// lowCut: the rumble filter is on. gate, compress: how much, 0 (off) to 1. bass, mid, treble: decibels, −12 to 12.
export type FxSettings = { lowCut: boolean; gate: number; bass: number; mid: number; treble: number; compress: number };

export const NO_FX: FxSettings = { lowCut: false, gate: 0, bass: 0, mid: 0, treble: 0, compress: 0 };

// Whether the settings change nothing: such a clip is not processed at all, so it stays bit for bit as it was.
export function isPlainFx(fx: FxSettings): boolean {
  return !fx.lowCut && fx.gate <= 0 && fx.bass === 0 && fx.mid === 0 && fx.treble === 0 && fx.compress <= 0;
}

export const LOW_CUT_HZ = 80; // below a voice: rumble, handling noise, wind
export const BASS_HZ = 200;
export const MID_HZ = 2500; // where speech is understood
export const TREBLE_HZ = 5000;
export const LIMIT_CEILING = 0.891; // −1 dB: the loudest the mix is let through

// One second-order filter as five numbers: b0, b1, b2, a1, a2, already divided by a0.
type Coeffs = [number, number, number, number, number];

const normal = (b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Coeffs => [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];

// The standard filter formulas (Bristow-Johnson's "Audio EQ Cookbook"), which browsers' own filters follow too.
export function highPass(hz: number, q: number, sampleRate: number): Coeffs {
  const w = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return normal((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}

export function peak(hz: number, q: number, db: number, sampleRate: number): Coeffs {
  const a = Math.pow(10, db / 40);
  const w = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  return normal(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a);
}

export function lowShelf(hz: number, db: number, sampleRate: number): Coeffs {
  const a = Math.pow(10, db / 40);
  const w = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w);
  const beta = 2 * Math.sqrt(a) * (Math.sin(w) / 2) * Math.SQRT2;
  return normal(
    a * (a + 1 - (a - 1) * cos + beta),
    2 * a * (a - 1 - (a + 1) * cos),
    a * (a + 1 - (a - 1) * cos - beta),
    a + 1 + (a - 1) * cos + beta,
    -2 * (a - 1 + (a + 1) * cos),
    a + 1 + (a - 1) * cos - beta,
  );
}

export function highShelf(hz: number, db: number, sampleRate: number): Coeffs {
  const a = Math.pow(10, db / 40);
  const w = (2 * Math.PI * hz) / sampleRate;
  const cos = Math.cos(w);
  const beta = 2 * Math.sqrt(a) * (Math.sin(w) / 2) * Math.SQRT2;
  return normal(
    a * (a + 1 + (a - 1) * cos + beta),
    -2 * a * (a - 1 + (a + 1) * cos),
    a * (a + 1 + (a - 1) * cos - beta),
    a + 1 - (a - 1) * cos + beta,
    2 * (a - 1 - (a + 1) * cos),
    a + 1 - (a - 1) * cos - beta,
  );
}

// How a level that falls or rises settles over `seconds`: the share of the way it goes each sample.
const settle = (seconds: number, sampleRate: number) => 1 - Math.exp(-1 / (seconds * sampleRate));

// A filter's memory for the two sides: two numbers each, kept from one block to the next.
type Memory = { l1: number; l2: number; r1: number; r2: number };
const memory = (): Memory => ({ l1: 0, l2: 0, r1: 0, r2: 0 });

// What the gate and the compressor are set to, worked out once from their amounts.
function gateOf(amount: number) {
  const thresholdDb = -60 + 30 * amount; // −60 dB at the lightest, −30 dB at the strongest
  const open = Math.pow(10, thresholdDb / 20);
  return { open, close: open * 0.7, floor: Math.pow(10, -(12 + 24 * amount) / 20) };
}

function compressorOf(amount: number) {
  const threshold = -10 - 20 * amount; // dB
  const ratio = 2 + 4 * amount;
  // Half of what a full-scale sound loses is given back, so a compressed voice is louder, not quieter.
  return { threshold, ratio, makeup: (-threshold * (1 - 1 / ratio)) / 2 };
}

const KNEE_DB = 6;

// One clip's clean-up. set() changes its settings without forgetting where the sound was, so a change made while it
// plays does not click. process() changes the two sides in place; they must be as long as each other.
export function createChain(sampleRate: number): { set(fx: FxSettings): void; process(left: Float32Array, right: Float32Array): void } {
  let fx: FxSettings = NO_FX;
  let plain = true;
  let cut: Coeffs | null = null;
  let bass: Coeffs | null = null;
  let mid: Coeffs | null = null;
  let treble: Coeffs | null = null;
  const cutM = memory();
  const bassM = memory();
  const midM = memory();
  const trebleM = memory();
  let gate = gateOf(0);
  let comp = compressorOf(0);
  // The gate: how loud the sound has lately been, whether it is open, and the gain it is at.
  let heard = 0;
  let isOpen = true;
  let gateGain = 1;
  const heardFall = Math.exp(-1 / (0.05 * sampleRate));
  const gateOpens = settle(0.003, sampleRate);
  const gateCloses = settle(0.12, sampleRate);
  // The compressor: the reduction it is at, in dB (0 or below).
  let reduction = 0;
  const compGrabs = settle(0.005, sampleRate);
  const compLetsGo = settle(0.15, sampleRate);
  // A clip often starts in the middle of a sound (after a cut). For its first hundredth of a second the gate and the
  // compressor go straight to where the sound puts them, so the start is not let through loud and then pulled down.
  let age = 0;
  const warmUp = Math.round(0.01 * sampleRate);

  function set(next: FxSettings): void {
    fx = next;
    plain = isPlainFx(next);
    cut = next.lowCut ? highPass(LOW_CUT_HZ, Math.SQRT1_2, sampleRate) : null;
    bass = next.bass !== 0 ? lowShelf(BASS_HZ, next.bass, sampleRate) : null;
    mid = next.mid !== 0 ? peak(MID_HZ, 0.9, next.mid, sampleRate) : null;
    treble = next.treble !== 0 ? highShelf(TREBLE_HZ, next.treble, sampleRate) : null;
    gate = gateOf(next.gate);
    comp = compressorOf(next.compress);
  }

  function process(left: Float32Array, right: Float32Array): void {
    if (plain) return;
    const gating = fx.gate > 0;
    const compressing = fx.compress > 0;
    for (let i = 0; i < left.length; i++) {
      let l = left[i];
      let r = right[i];
      if (cut) {
        const yl = cut[0] * l + cutM.l1;
        cutM.l1 = cut[1] * l - cut[3] * yl + cutM.l2;
        cutM.l2 = cut[2] * l - cut[4] * yl;
        const yr = cut[0] * r + cutM.r1;
        cutM.r1 = cut[1] * r - cut[3] * yr + cutM.r2;
        cutM.r2 = cut[2] * r - cut[4] * yr;
        l = yl;
        r = yr;
      }
      if (gating) {
        // Quiet stretches between words are turned down; a word opens the gate at once and it closes slowly after.
        const level = Math.max(Math.abs(l), Math.abs(r));
        heard = level > heard ? level : heard * heardFall;
        if (isOpen ? heard < gate.close : heard >= gate.open) isOpen = !isOpen;
        const want = isOpen ? 1 : gate.floor;
        if (age < warmUp) gateGain = want;
        else gateGain += (want - gateGain) * (want > gateGain ? gateOpens : gateCloses);
        l *= gateGain;
        r *= gateGain;
      }
      if (bass) {
        const yl = bass[0] * l + bassM.l1;
        bassM.l1 = bass[1] * l - bass[3] * yl + bassM.l2;
        bassM.l2 = bass[2] * l - bass[4] * yl;
        const yr = bass[0] * r + bassM.r1;
        bassM.r1 = bass[1] * r - bass[3] * yr + bassM.r2;
        bassM.r2 = bass[2] * r - bass[4] * yr;
        l = yl;
        r = yr;
      }
      if (mid) {
        const yl = mid[0] * l + midM.l1;
        midM.l1 = mid[1] * l - mid[3] * yl + midM.l2;
        midM.l2 = mid[2] * l - mid[4] * yl;
        const yr = mid[0] * r + midM.r1;
        midM.r1 = mid[1] * r - mid[3] * yr + midM.r2;
        midM.r2 = mid[2] * r - mid[4] * yr;
        l = yl;
        r = yr;
      }
      if (treble) {
        const yl = treble[0] * l + trebleM.l1;
        trebleM.l1 = treble[1] * l - treble[3] * yl + trebleM.l2;
        trebleM.l2 = treble[2] * l - treble[4] * yl;
        const yr = treble[0] * r + trebleM.r1;
        trebleM.r1 = treble[1] * r - treble[3] * yr + trebleM.r2;
        trebleM.r2 = treble[2] * r - treble[4] * yr;
        l = yl;
        r = yr;
      }
      if (compressing) {
        // Loud moments are turned down by a ratio, softly around the threshold, and the whole is then turned up:
        // both sides by the same amount, so the sound does not wander between them.
        const level = Math.max(Math.abs(l), Math.abs(r), 1e-6);
        const over = 20 * Math.log10(level) - comp.threshold;
        let cutBy = 0;
        if (2 * over > KNEE_DB) cutBy = over * (1 / comp.ratio - 1);
        else if (2 * over > -KNEE_DB) cutBy = ((1 / comp.ratio - 1) * (over + KNEE_DB / 2) * (over + KNEE_DB / 2)) / (2 * KNEE_DB);
        if (age < warmUp) reduction = Math.min(reduction, cutBy);
        else reduction += (cutBy - reduction) * (cutBy < reduction ? compGrabs : compLetsGo);
        const gain = Math.pow(10, (reduction + comp.makeup) / 20);
        l *= gain;
        r *= gain;
      }
      left[i] = l;
      right[i] = r;
      age++;
    }
  }

  return { set, process };
}

// The limiter on the whole mix: the moment a sample would pass the ceiling the mix is turned down just enough, at
// once, and it comes back up slowly after, so loud passages are held and not chopped off flat. A mix that never
// reaches the ceiling is not touched at all. gainFor takes the louder side of one sample and gives the gain for both.
export function createLimiter(sampleRate: number, ceiling: number = LIMIT_CEILING): {
  gainFor(level: number): number;
  process(left: Float32Array, right: Float32Array): void;
  processInterleaved(samples: Float32Array): void;
} {
  let gain = 1;
  const rises = settle(0.08, sampleRate);

  function gainFor(level: number): number {
    const most = level > ceiling ? ceiling / level : 1;
    if (most < gain) gain = most;
    else if (gain < 1) {
      gain += (1 - gain) * rises;
      if (gain > most) gain = most;
      if (1 - gain < 1e-5) gain = 1;
    }
    return gain;
  }

  return {
    gainFor,
    process(left, right) {
      for (let i = 0; i < left.length; i++) {
        const g = gainFor(Math.max(Math.abs(left[i]), Math.abs(right[i])));
        if (g === 1) continue;
        left[i] *= g;
        right[i] *= g;
      }
    },
    // L R L R …, as the export's mix is laid out.
    processInterleaved(samples) {
      for (let i = 0; i + 1 < samples.length; i += 2) {
        const g = gainFor(Math.max(Math.abs(samples[i]), Math.abs(samples[i + 1])));
        if (g === 1) continue;
        samples[i] *= g;
        samples[i + 1] *= g;
      }
    },
  };
}
