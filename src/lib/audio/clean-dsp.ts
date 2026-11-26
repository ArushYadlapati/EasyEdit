// The sound clean-up itself: noise reduction, a rumble filter, a noise gate, three tone bands and a compressor for one
// clip, and a limiter for the whole mix. The export runs it sample by sample in its worker, and the preview runs the very same
// code in an audio worklet (public/audio/clean-dsp.js is this file turned into plain JavaScript by
// scripts/make-worklet.mjs), so what is heard while editing is what is exported.
//
// It imports nothing and uses nothing of the page or of Node, so it can run in both places.

// lowCut: the rumble filter is on. gate, compress, denoise: how much, 0 (off) to 1. bass, mid, treble: decibels, −12 to 12.
export type FxSettings = { lowCut: boolean; gate: number; bass: number; mid: number; treble: number; compress: number; denoise: number };

export const NO_FX: FxSettings = { lowCut: false, gate: 0, bass: 0, mid: 0, treble: 0, compress: 0, denoise: 0 };

// Whether the settings change nothing: such a clip is not processed at all, so it stays bit for bit as it was.
export function isPlainFx(fx: FxSettings): boolean {
  return !fx.lowCut && fx.gate <= 0 && fx.bass === 0 && fx.mid === 0 && fx.treble === 0 && fx.compress <= 0 && !(fx.denoise > 0);
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

// Noise reduction: the steady noise under a recording (hiss, a fan, a hum, a room's air) turned down, and what
// stands above it left alone. The sound is taken in short overlapping pieces, each split into 257 pitches; at every
// pitch the quietest the sound has lately been is taken for the noise there, and a pitch that is no louder than its
// noise is turned down. A voice comes and goes at every pitch, noise stays, which is how the two are told apart with
// nobody saying which is which.
export const DENOISE_FRAME = 512; // samples in a piece: about a hundredth of a second, which is also how late the sound comes out
const DENOISE_HOP = DENOISE_FRAME / 4;
const DENOISE_BINS = DENOISE_FRAME / 2 + 1;
// The quietest a smoothed level has been sits well under its average, so it is raised by this to stand for the noise.
// Measured on steady noise with a made-up voice over it: at this value half strength takes about 15 dB off the noise
// and full strength about 24 dB, while a voice 14 dB above the noise loses under 1 dB. Lower leaves more noise;
// higher starts to take the quiet ends of words.
const NOISE_OVER_MINIMUM = 3.2;
const NOISE_MEMORY_SECONDS = 2; // how far back "lately" goes: longer than a word or a held note, so a pause is always in it
const NOISE_PARTS = 4; // the memory is kept as this many shorter spans, the oldest dropped as a new one starts
// A clip's start is let through while its noise is learned, so a clip cut to start on a word does not have that word
// taken for noise: the reduction comes in over this long, slowly at first.
const DENOISE_WARM_SECONDS = 0.6;

// What an amount of noise reduction comes to: how much more than its noise a pitch must be to pass whole, and the
// least any pitch is turned down to (−6 dB at the lightest, −30 dB at the strongest), so what is left of the noise
// stays even and does not chirp.
function denoiseOf(amount: number) {
  return { over: 2 + 2 * amount, floor: Math.pow(10, -(6 + 24 * amount) / 20) };
}

// A Fourier transform of `size` values (a power of two), in place, either way.
function createFft(size: number): (re: Float32Array, im: Float32Array, inverse: boolean) => void {
  const levels = Math.round(Math.log2(size));
  const swap = new Uint16Array(size);
  for (let i = 0; i < size; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    swap[i] = r;
  }
  const cos = new Float32Array(size / 2);
  const sin = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = Math.sin((2 * Math.PI * i) / size);
  }
  return (re, im, inverse) => {
    for (let i = 0; i < size; i++) {
      const j = swap[i];
      if (j > i) {
        const r = re[i];
        re[i] = re[j];
        re[j] = r;
        const m = im[i];
        im[i] = im[j];
        im[j] = m;
      }
    }
    for (let length = 2; length <= size; length <<= 1) {
      const half = length >> 1;
      const step = size / length;
      for (let start = 0; start < size; start += length) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step];
          const sn = inverse ? sin[k * step] : -sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * c - im[b] * sn;
          const ti = re[b] * sn + im[b] * c;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < size; i++) {
        re[i] /= size;
        im[i] /= size;
      }
    }
  };
}

// One clip's noise reduction. process() changes the two sides in place and gives the sound back DENOISE_FRAME samples
// late; both sides are turned down by the same amount at each pitch, so the sound does not wander between them. It
// may be given blocks of any length, and gives the same sound whatever their lengths.
export function createDenoiser(sampleRate: number): { set(amount: number): void; process(left: Float32Array, right: Float32Array): void } {
  const size = DENOISE_FRAME;
  const fft = createFft(size);
  // Each piece is faded in and out before and after, so the overlapping pieces add up to the sound again.
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) window[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  const inL = new Float32Array(size);
  const inR = new Float32Array(size);
  const outL = new Float32Array(size);
  const outR = new Float32Array(size);
  const lRe = new Float32Array(size);
  const lIm = new Float32Array(size);
  const rRe = new Float32Array(size);
  const rIm = new Float32Array(size);
  const level = new Float32Array(DENOISE_BINS); // each pitch's loudness, smoothed for finding the noise
  const quick = new Float32Array(DENOISE_BINS); // and smoothed less, for deciding how much passes now
  const lowest = new Float32Array(DENOISE_BINS).fill(Infinity); // the quietest in the span being filled
  const spans = Array.from({ length: NOISE_PARTS - 1 }, () => new Float32Array(DENOISE_BINS).fill(Infinity)); // and in the ones before
  const earlier = new Float32Array(DENOISE_BINS).fill(Infinity); // the quietest of those
  const gain = new Float32Array(DENOISE_BINS).fill(1);
  const wanted = new Float32Array(DENOISE_BINS);
  const spanFrames = Math.max(1, Math.round((NOISE_MEMORY_SECONDS * sampleRate) / DENOISE_HOP / NOISE_PARTS));
  const warmFrames = Math.max(1, Math.round((DENOISE_WARM_SECONDS * sampleRate) / DENOISE_HOP));
  let settings = denoiseOf(0);
  let at = 0; // where the next sample goes
  let sinceFrame = 0;
  let frames = 0;
  let inSpan = 0;
  let nextSpan = 0;

  function frame(): void {
    for (let i = 0; i < size; i++) {
      const from = (at + i) % size; // oldest first
      lRe[i] = inL[from] * window[i];
      rRe[i] = inR[from] * window[i];
      lIm[i] = 0;
      rIm[i] = 0;
    }
    fft(lRe, lIm, false);
    fft(rRe, rIm, false);
    const warmth = Math.min(1, frames / warmFrames);
    const warm = warmth * warmth;
    for (let k = 0; k < DENOISE_BINS; k++) {
      const power = lRe[k] * lRe[k] + lIm[k] * lIm[k] + rRe[k] * rRe[k] + rIm[k] * rIm[k];
      level[k] = frames === 0 ? power : 0.8 * level[k] + 0.2 * power;
      quick[k] = frames === 0 ? power : 0.7 * quick[k] + 0.3 * power;
      if (level[k] < lowest[k]) lowest[k] = level[k];
      const noise = NOISE_OVER_MINIMUM * Math.min(lowest[k], earlier[k]);
      // What is left of the pitch once its noise, and a margin, is taken off.
      const kept = quick[k] > 0 ? Math.sqrt(Math.max(0, 1 - (settings.over * noise) / quick[k])) : 0;
      wanted[k] = Math.max(settings.floor, kept);
    }
    for (let k = 0; k < DENOISE_BINS; k++) {
      // Evened out with the pitches beside it, let up quickly and brought down gently, so no lone pitch chirps.
      const near = (wanted[Math.max(0, k - 1)] + 2 * wanted[k] + wanted[Math.min(DENOISE_BINS - 1, k + 1)]) / 4;
      const now = near > gain[k] ? 0.5 * gain[k] + 0.5 * near : 0.75 * gain[k] + 0.25 * near;
      gain[k] = now;
      const g = 1 - warm * (1 - now);
      lRe[k] *= g;
      lIm[k] *= g;
      rRe[k] *= g;
      rIm[k] *= g;
      if (k > 0 && k < DENOISE_BINS - 1) {
        // The upper half of a transform mirrors the lower.
        lRe[size - k] *= g;
        lIm[size - k] *= g;
        rRe[size - k] *= g;
        rIm[size - k] *= g;
      }
    }
    fft(lRe, lIm, true);
    fft(rRe, rIm, true);
    // Four pieces overlap at every sample, and their fades add up to two.
    for (let i = 0; i < size; i++) {
      const to = (at + i) % size;
      outL[to] += lRe[i] * window[i] * 0.5;
      outR[to] += rRe[i] * window[i] * 0.5;
    }
    frames++;
    if (++inSpan >= spanFrames) {
      inSpan = 0;
      spans[nextSpan].set(lowest);
      nextSpan = (nextSpan + 1) % spans.length;
      for (let k = 0; k < DENOISE_BINS; k++) {
        let least = Infinity;
        for (const span of spans) if (span[k] < least) least = span[k];
        earlier[k] = least;
        lowest[k] = level[k];
      }
    }
  }

  return {
    set(amount) {
      settings = denoiseOf(Math.min(1, Math.max(0, amount)));
    },
    process(left, right) {
      for (let i = 0; i < left.length; i++) {
        inL[at] = left[i];
        inR[at] = right[i];
        left[i] = outL[at];
        right[i] = outR[at];
        outL[at] = 0;
        outR[at] = 0;
        at = (at + 1) % size;
        if (++sinceFrame === DENOISE_HOP) {
          sinceFrame = 0;
          frame();
        }
      }
    },
  };
}

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
  // Made when first asked for: most clips never have noise reduction on.
  let denoiser: ReturnType<typeof createDenoiser> | null = null;
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
    if (next.denoise > 0) {
      denoiser ??= createDenoiser(sampleRate);
      denoiser.set(next.denoise);
    }
  }

  function process(left: Float32Array, right: Float32Array): void {
    if (plain) return;
    // First, so the gate, the tone bands and the compressor work on the cleaned sound and do not lift the noise.
    if (denoiser && fx.denoise > 0) denoiser.process(left, right);
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
