// Made by scripts/make-worklet.mjs from src/lib/audio/clean-dsp.ts and scripts/clean-processor.js. Change those, not this.
const NO_FX = { lowCut: false, gate: 0, bass: 0, mid: 0, treble: 0, compress: 0, denoise: 0 };
function isPlainFx(fx) {
    return !fx.lowCut && fx.gate <= 0 && fx.bass === 0 && fx.mid === 0 && fx.treble === 0 && fx.compress <= 0 && !(fx.denoise > 0);
}
const LOW_CUT_HZ = 80;
const BASS_HZ = 200;
const MID_HZ = 2500;
const TREBLE_HZ = 5000;
const LIMIT_CEILING = 0.891;
const normal = (b0, b1, b2, a0, a1, a2) => [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
function highPass(hz, q, sampleRate) {
    const w = (2 * Math.PI * hz) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    return normal((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
}
function peak(hz, q, db, sampleRate) {
    const a = Math.pow(10, db / 40);
    const w = (2 * Math.PI * hz) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    return normal(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a);
}
function lowShelf(hz, db, sampleRate) {
    const a = Math.pow(10, db / 40);
    const w = (2 * Math.PI * hz) / sampleRate;
    const cos = Math.cos(w);
    const beta = 2 * Math.sqrt(a) * (Math.sin(w) / 2) * Math.SQRT2;
    return normal(a * (a + 1 - (a - 1) * cos + beta), 2 * a * (a - 1 - (a + 1) * cos), a * (a + 1 - (a - 1) * cos - beta), a + 1 + (a - 1) * cos + beta, -2 * (a - 1 + (a + 1) * cos), a + 1 + (a - 1) * cos - beta);
}
function highShelf(hz, db, sampleRate) {
    const a = Math.pow(10, db / 40);
    const w = (2 * Math.PI * hz) / sampleRate;
    const cos = Math.cos(w);
    const beta = 2 * Math.sqrt(a) * (Math.sin(w) / 2) * Math.SQRT2;
    return normal(a * (a + 1 + (a - 1) * cos + beta), -2 * a * (a - 1 + (a + 1) * cos), a * (a + 1 + (a - 1) * cos - beta), a + 1 - (a - 1) * cos + beta, 2 * (a - 1 - (a + 1) * cos), a + 1 - (a - 1) * cos - beta);
}
const settle = (seconds, sampleRate) => 1 - Math.exp(-1 / (seconds * sampleRate));
const memory = () => ({ l1: 0, l2: 0, r1: 0, r2: 0 });
function gateOf(amount) {
    const thresholdDb = -60 + 30 * amount;
    const open = Math.pow(10, thresholdDb / 20);
    return { open, close: open * 0.7, floor: Math.pow(10, -(12 + 24 * amount) / 20) };
}
function compressorOf(amount) {
    const threshold = -10 - 20 * amount;
    const ratio = 2 + 4 * amount;
    return { threshold, ratio, makeup: (-threshold * (1 - 1 / ratio)) / 2 };
}
const KNEE_DB = 6;
const DENOISE_FRAME = 512;
const DENOISE_HOP = DENOISE_FRAME / 4;
const DENOISE_BINS = DENOISE_FRAME / 2 + 1;
const NOISE_OVER_MINIMUM = 3.2;
const NOISE_MEMORY_SECONDS = 2;
const NOISE_PARTS = 4;
const DENOISE_WARM_SECONDS = 0.6;
function denoiseOf(amount) {
    return { over: 2 + 2 * amount, floor: Math.pow(10, -(6 + 24 * amount) / 20) };
}
function createFft(size) {
    const levels = Math.round(Math.log2(size));
    const swap = new Uint16Array(size);
    for (let i = 0; i < size; i++) {
        let r = 0;
        for (let b = 0; b < levels; b++)
            r |= ((i >> b) & 1) << (levels - 1 - b);
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
function createDenoiser(sampleRate) {
    const size = DENOISE_FRAME;
    const fft = createFft(size);
    const taper = new Float32Array(size);
    for (let i = 0; i < size; i++)
        taper[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
    const inL = new Float32Array(size);
    const inR = new Float32Array(size);
    const outL = new Float32Array(size);
    const outR = new Float32Array(size);
    const lRe = new Float32Array(size);
    const lIm = new Float32Array(size);
    const rRe = new Float32Array(size);
    const rIm = new Float32Array(size);
    const level = new Float32Array(DENOISE_BINS);
    const quick = new Float32Array(DENOISE_BINS);
    const lowest = new Float32Array(DENOISE_BINS).fill(Infinity);
    const spans = Array.from({ length: NOISE_PARTS - 1 }, () => new Float32Array(DENOISE_BINS).fill(Infinity));
    const earlier = new Float32Array(DENOISE_BINS).fill(Infinity);
    const gain = new Float32Array(DENOISE_BINS).fill(1);
    const wanted = new Float32Array(DENOISE_BINS);
    const spanFrames = Math.max(1, Math.round((NOISE_MEMORY_SECONDS * sampleRate) / DENOISE_HOP / NOISE_PARTS));
    const warmFrames = Math.max(1, Math.round((DENOISE_WARM_SECONDS * sampleRate) / DENOISE_HOP));
    let settings = denoiseOf(0);
    let at = 0;
    let sinceFrame = 0;
    let frames = 0;
    let inSpan = 0;
    let nextSpan = 0;
    function frame() {
        for (let i = 0; i < size; i++) {
            const from = (at + i) % size;
            lRe[i] = inL[from] * taper[i];
            rRe[i] = inR[from] * taper[i];
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
            if (level[k] < lowest[k])
                lowest[k] = level[k];
            const noise = NOISE_OVER_MINIMUM * Math.min(lowest[k], earlier[k]);
            const kept = quick[k] > 0 ? Math.sqrt(Math.max(0, 1 - (settings.over * noise) / quick[k])) : 0;
            wanted[k] = Math.max(settings.floor, kept);
        }
        for (let k = 0; k < DENOISE_BINS; k++) {
            const near = (wanted[Math.max(0, k - 1)] + 2 * wanted[k] + wanted[Math.min(DENOISE_BINS - 1, k + 1)]) / 4;
            const now = near > gain[k] ? 0.5 * gain[k] + 0.5 * near : 0.75 * gain[k] + 0.25 * near;
            gain[k] = now;
            const g = 1 - warm * (1 - now);
            lRe[k] *= g;
            lIm[k] *= g;
            rRe[k] *= g;
            rIm[k] *= g;
            if (k > 0 && k < DENOISE_BINS - 1) {
                lRe[size - k] *= g;
                lIm[size - k] *= g;
                rRe[size - k] *= g;
                rIm[size - k] *= g;
            }
        }
        fft(lRe, lIm, true);
        fft(rRe, rIm, true);
        for (let i = 0; i < size; i++) {
            const to = (at + i) % size;
            outL[to] += lRe[i] * taper[i] * 0.5;
            outR[to] += rRe[i] * taper[i] * 0.5;
        }
        frames++;
        if (++inSpan >= spanFrames) {
            inSpan = 0;
            spans[nextSpan].set(lowest);
            nextSpan = (nextSpan + 1) % spans.length;
            for (let k = 0; k < DENOISE_BINS; k++) {
                let least = Infinity;
                for (const span of spans)
                    if (span[k] < least)
                        least = span[k];
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
function createChain(sampleRate) {
    let fx = NO_FX;
    let plain = true;
    let cut = null;
    let bass = null;
    let mid = null;
    let treble = null;
    const cutM = memory();
    const bassM = memory();
    const midM = memory();
    const trebleM = memory();
    let gate = gateOf(0);
    let comp = compressorOf(0);
    let denoiser = null;
    let heard = 0;
    let isOpen = true;
    let gateGain = 1;
    const heardFall = Math.exp(-1 / (0.05 * sampleRate));
    const gateOpens = settle(0.003, sampleRate);
    const gateCloses = settle(0.12, sampleRate);
    let reduction = 0;
    const compGrabs = settle(0.005, sampleRate);
    const compLetsGo = settle(0.15, sampleRate);
    let age = 0;
    const warmUp = Math.round(0.01 * sampleRate);
    function set(next) {
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
    function process(left, right) {
        if (plain)
            return;
        if (denoiser && fx.denoise > 0)
            denoiser.process(left, right);
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
                const level = Math.max(Math.abs(l), Math.abs(r));
                heard = level > heard ? level : heard * heardFall;
                if (isOpen ? heard < gate.close : heard >= gate.open)
                    isOpen = !isOpen;
                const want = isOpen ? 1 : gate.floor;
                if (age < warmUp)
                    gateGain = want;
                else
                    gateGain += (want - gateGain) * (want > gateGain ? gateOpens : gateCloses);
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
                const level = Math.max(Math.abs(l), Math.abs(r), 1e-6);
                const over = 20 * Math.log10(level) - comp.threshold;
                let cutBy = 0;
                if (2 * over > KNEE_DB)
                    cutBy = over * (1 / comp.ratio - 1);
                else if (2 * over > -KNEE_DB)
                    cutBy = ((1 / comp.ratio - 1) * (over + KNEE_DB / 2) * (over + KNEE_DB / 2)) / (2 * KNEE_DB);
                if (age < warmUp)
                    reduction = Math.min(reduction, cutBy);
                else
                    reduction += (cutBy - reduction) * (cutBy < reduction ? compGrabs : compLetsGo);
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
function createLimiter(sampleRate, ceiling = LIMIT_CEILING) {
    let gain = 1;
    const rises = settle(0.08, sampleRate);
    function gainFor(level) {
        const most = level > ceiling ? ceiling / level : 1;
        if (most < gain)
            gain = most;
        else if (gain < 1) {
            gain += (1 - gain) * rises;
            if (gain > most)
                gain = most;
            if (1 - gain < 1e-5)
                gain = 1;
        }
        return gain;
    }
    return {
        gainFor,
        process(left, right) {
            for (let i = 0; i < left.length; i++) {
                const g = gainFor(Math.max(Math.abs(left[i]), Math.abs(right[i])));
                if (g === 1)
                    continue;
                left[i] *= g;
                right[i] *= g;
            }
        },
        processInterleaved(samples) {
            for (let i = 0; i + 1 < samples.length; i += 2) {
                const g = gainFor(Math.max(Math.abs(samples[i]), Math.abs(samples[i + 1])));
                if (g === 1)
                    continue;
                samples[i] *= g;
                samples[i + 1] *= g;
            }
        },
    };
}

// The preview's sound clean-up, run by the browser's audio engine beside the page. One processor, in one of two
// modes: "clip" cleans one clip's sound to the settings the page sends it; "limit" holds the whole mix under its
// ceiling. createChain and createLimiter are placed above this by scripts/make-worklet.mjs, from the same source the
// export runs.

class CleanProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const limit = options?.processorOptions?.mode === "limit";
    this.chain = limit ? null : createChain(sampleRate);
    this.limiter = limit ? createLimiter(sampleRate) : null;
    this.port.onmessage = (event) => this.chain?.set(event.data);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || output.length < 2) return true;
    // Always two sides out: a one-sided sound is heard on both.
    output[0].set(input[0]);
    output[1].set(input[1] ?? input[0]);
    (this.chain ?? this.limiter).process(output[0], output[1]);
    return true;
  }
}

registerProcessor("easyedit-clean", CleanProcessor);
