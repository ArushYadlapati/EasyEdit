import { NO_FX, type FxSettings } from "./clean-dsp";
import { peakOf } from "./meter";

// The preview's sound, mixed in one place: every playing element's sound runs through a gain of its own into one
// output, which is also what the audio meter reads. A gain can go past 1, which an element's own volume cannot, so a
// clip turned up is heard turned up.
//
// A clip's sound clean-up, and the limiter on the whole mix, run in an audio worklet (public/audio/clean-worklet.js)
// that does exactly what the export does. It is fetched when the mix is set up; until it has arrived, and in a
// browser without worklets, clips sound as recorded and the mix is not limited. The export is cleaned either way.
//
// A browser lets a page make sound only once the person has done something on it, so nothing is set up until the
// first press or key (unlock). Until then, and wherever the browser has no Web Audio, each element keeps to its own
// volume, which stops at 1.

// The part of an audio or video element a line needs.
type Sounding = { volume: number };

export type SoundLine = {
  setGain(gain: number): void; // 1 is as recorded
  setPan(pan: number): void; // −1 left, 0 as recorded, 1 right; without a mix the sound stays where it was recorded
  setFx(fx: FxSettings | null): void; // the clip's sound clean-up, or null for none; needs the mix and its worklet
  close(): void; // the element is done with: its sound leaves the mix
};

export type Levels = { left: number; right: number }; // the loudest sample of each side lately, 1 being full scale

export type SoundBus = {
  line(el: Sounding): SoundLine;
  unlock(): void; // call from a press or a key: sets the mix up, or wakes it
  levels(): Levels | null; // null while there is no mix to read
  close(): void; // lets go of the mix; unlock sets up a new one
};

const SMOOTH_SECONDS = 0.015; // a gain change is eased over about this long, so a step is not heard as a click
const WINDOW_SAMPLES = 2048; // what one meter reading looks back over: 43 ms at 48 kHz, more than a screen frame

function browserContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Make = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Make) return null;
  try {
    return new Make();
  } catch {
    return null;
  }
}

export const WORKLET_URL = "/audio/clean-worklet.js";
const WORKLET_NAME = "easyedit-clean";

// A node of the worklet: a clip's cleaner takes its settings through the port.
type Cleaner = AudioNode & { port: { postMessage(message: unknown): void } };
type MakeCleaner = (ctx: AudioContext, mode: "clip" | "limit") => Cleaner;

const browserCleaner: MakeCleaner = (ctx, mode) =>
  new AudioWorkletNode(ctx, WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { mode } });

// worklet: whether the clean-up worklet has arrived. splitter: what the meter reads from.
type Mix = { ctx: AudioContext; master: GainNode; splitter: AudioNode; sides: [AnalyserNode, AnalyserNode]; scratch: Float32Array<ArrayBuffer>; worklet: boolean };
// gain: what was last asked for. aimed: what the node was last told to reach, which its own value lags behind.
// pan: what was last asked for; panner: the node that does it, made the first time a line is moved off centre.
// fx: the clean-up last asked for; cleaner: the node that does it, placed before the gain the first time it is needed,
// so the clean-up works on the sound as recorded, as in the export. sent: the settings the cleaner was last given.
type Line = {
  el: Sounding;
  gain: number;
  aimed: number;
  node: GainNode | null;
  source: AudioNode | null;
  pan: number;
  panner: StereoPannerNode | null;
  fx: FxSettings | null;
  cleaner: Cleaner | null;
  sent: string;
};

export function createSoundBus(makeContext: () => AudioContext | null = browserContext, makeCleaner: MakeCleaner = browserCleaner): SoundBus {
  let mix: Mix | null = null;
  let refused = false; // the browser has no Web Audio: not asked again
  const lines = new Set<Line>();
  // An element can be given to Web Audio once in its life, so its source is kept for as long as the element is.
  let sources = new WeakMap<object, AudioNode>();

  function attach(line: Line): void {
    if (!mix || line.node) return;
    try {
      let source = sources.get(line.el);
      if (!source) {
        source = mix.ctx.createMediaElementSource(line.el as unknown as HTMLMediaElement);
        sources.set(line.el, source);
      }
      const node = mix.ctx.createGain();
      node.gain.value = line.gain;
      line.aimed = line.gain;
      source.connect(node);
      node.connect(mix.master);
      line.node = node;
      line.source = source;
      if (line.pan !== 0) placePan(line);
      if (line.fx) placeFx(line);
      line.el.volume = 1; // the gain does the work from here on
    } catch {
      // This element stays on its own volume.
    }
  }

  // Puts a panner between the line's gain and the mix the first time it is needed, then moves it.
  function placePan(line: Line): void {
    if (!mix || !line.node) return;
    try {
      if (!line.panner) {
        const panner = mix.ctx.createStereoPanner();
        line.node.disconnect();
        line.node.connect(panner);
        panner.connect(mix.master);
        line.panner = panner;
      }
      line.panner.pan.setTargetAtTime(line.pan, mix.ctx.currentTime, SMOOTH_SECONDS);
    } catch {
      // No panner here: the sound stays where it was recorded.
    }
  }

  // Puts a cleaner between the line's sound and its gain the first time it is needed, then gives it its settings.
  // A cleaner told to do nothing passes the sound through untouched, so it stays in place once made.
  function placeFx(line: Line): void {
    if (!mix || !mix.worklet || !line.node || !line.source) return;
    try {
      if (!line.cleaner) {
        if (!line.fx) return;
        const cleaner = makeCleaner(mix.ctx, "clip");
        line.source.disconnect();
        line.source.connect(cleaner);
        cleaner.connect(line.node);
        line.cleaner = cleaner;
        line.sent = "";
      }
      const next = JSON.stringify(line.fx ?? NO_FX);
      if (next === line.sent) return;
      line.cleaner.port.postMessage(line.fx ?? NO_FX);
      line.sent = next;
    } catch {
      // No cleaner here: the clip sounds as recorded.
    }
  }

  function detach(line: Line): void {
    try {
      line.source?.disconnect();
      line.cleaner?.disconnect();
      line.node?.disconnect();
      line.panner?.disconnect();
    } catch {
      // already apart
    }
    line.node = null;
    line.source = null;
    line.panner = null;
    line.cleaner = null;
  }

  // Fetches the worklet, then puts the limiter between the mix and the output, where the meter reads too, and gives
  // each line that asked for a clean-up its cleaner. A browser that cannot is left as it was.
  function loadWorklet(made: Mix): void {
    const worklet = (made.ctx as { audioWorklet?: { addModule(url: string): Promise<void> } }).audioWorklet;
    if (!worklet) return;
    void worklet
      .addModule(WORKLET_URL)
      .then(() => {
        if (mix !== made) return; // closed, or set up again, while it was on its way
        const limiter = makeCleaner(made.ctx, "limit");
        made.master.disconnect();
        made.master.connect(limiter);
        limiter.connect(made.ctx.destination);
        limiter.connect(made.splitter);
        made.worklet = true;
        for (const line of lines) if (line.fx) placeFx(line);
      })
      .catch(() => {});
  }

  function setUp(ctx: AudioContext): Mix {
    const master = ctx.createGain();
    // Always two sides, so a one-sided file is heard, and metered, on both.
    master.channelCount = 2;
    master.channelCountMode = "explicit";
    const splitter = ctx.createChannelSplitter(2);
    const side = (index: number) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = WINDOW_SAMPLES;
      splitter.connect(analyser, index);
      return analyser;
    };
    master.connect(ctx.destination);
    master.connect(splitter);
    return { ctx, master, splitter, sides: [side(0), side(1)], scratch: new Float32Array(WINDOW_SAMPLES), worklet: false };
  }

  return {
    line(el) {
      const line: Line = { el, gain: 1, aimed: 1, node: null, source: null, pan: 0, panner: null, fx: null, cleaner: null, sent: "" };
      lines.add(line);
      attach(line);
      return {
        setGain(gain) {
          line.gain = gain;
          if (line.node && mix) {
            if (line.aimed === gain) return;
            line.aimed = gain;
            // Eased in from wherever the gain has got to.
            line.node.gain.setTargetAtTime(gain, mix.ctx.currentTime, SMOOTH_SECONDS);
          } else {
            el.volume = Math.min(1, Math.max(0, gain));
          }
        },
        setPan(pan) {
          if (line.pan === pan) return;
          line.pan = pan;
          // A line never moved off centre needs no panner at all.
          if (pan !== 0 || line.panner) placePan(line);
        },
        setFx(fx) {
          line.fx = fx;
          // A line never cleaned needs no cleaner at all.
          if (fx || line.cleaner) placeFx(line);
        },
        close() {
          detach(line);
          lines.delete(line);
        },
      };
    },

    unlock() {
      if (refused) return;
      if (!mix) {
        const ctx = makeContext();
        if (!ctx) {
          refused = true;
          return;
        }
        try {
          mix = setUp(ctx);
        } catch {
          refused = true;
          void ctx.close().catch(() => {});
          return;
        }
        for (const line of lines) attach(line);
        loadWorklet(mix);
      }
      if (mix.ctx.state !== "running") void mix.ctx.resume().catch(() => {});
    },

    levels() {
      if (!mix) return null;
      if (mix.ctx.state !== "running") return { left: 0, right: 0 };
      const read = (analyser: AnalyserNode) => {
        analyser.getFloatTimeDomainData(mix!.scratch);
        return peakOf(mix!.scratch);
      };
      return { left: read(mix.sides[0]), right: read(mix.sides[1]) };
    },

    close() {
      for (const line of lines) detach(line);
      if (mix) void mix.ctx.close().catch(() => {});
      mix = null;
      sources = new WeakMap();
    },
  };
}
