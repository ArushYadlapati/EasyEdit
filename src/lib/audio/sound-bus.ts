import { peakOf } from "./meter";

// The preview's sound, mixed in one place: every playing element's sound runs through a gain of its own into one
// output, which is also what the audio meter reads. A gain can go past 1, which an element's own volume cannot, so a
// clip turned up is heard turned up.
//
// A browser lets a page make sound only once the person has done something on it, so nothing is set up until the
// first press or key (unlock). Until then, and wherever the browser has no Web Audio, each element keeps to its own
// volume, which stops at 1.

// The part of an audio or video element a line needs.
type Sounding = { volume: number };

export type SoundLine = {
  setGain(gain: number): void; // 1 is as recorded
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

type Mix = { ctx: AudioContext; master: GainNode; sides: [AnalyserNode, AnalyserNode]; scratch: Float32Array<ArrayBuffer> };
// gain: what was last asked for. aimed: what the node was last told to reach, which its own value lags behind.
type Line = { el: Sounding; gain: number; aimed: number; node: GainNode | null; source: AudioNode | null };

export function createSoundBus(makeContext: () => AudioContext | null = browserContext): SoundBus {
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
      line.el.volume = 1; // the gain does the work from here on
    } catch {
      // This element stays on its own volume.
    }
  }

  function detach(line: Line): void {
    try {
      line.source?.disconnect();
      line.node?.disconnect();
    } catch {
      // already apart
    }
    line.node = null;
    line.source = null;
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
    return { ctx, master, sides: [side(0), side(1)], scratch: new Float32Array(WINDOW_SAMPLES) };
  }

  return {
    line(el) {
      const line: Line = { el, gain: 1, aimed: 1, node: null, source: null };
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
