import { describe, expect, it, vi } from "vitest";
import { encodeWav } from "@/lib/audio/wav";
import type { TimelinePoint } from "@/lib/editor/geometry";
import { VOICEOVER_MESSAGE, createVoiceover, voiceoverName, type Take, type VoiceoverDeps } from "@/lib/editor/voiceover";
import { makeStore } from "./fixtures";

describe("a WAV file", () => {
  it("has the header a decoder expects and 16-bit samples, channels in turn", () => {
    const wav = new DataView(encodeWav([Float32Array.of(0, 1, -1), Float32Array.of(0.5, -0.5, 0)], 48_000));
    const text = (at: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(at + i)));
    expect([text(0), text(8), text(12), text(36)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(wav.byteLength).toBe(44 + 3 * 2 * 2);
    expect([wav.getUint32(4, true), wav.getUint32(40, true)]).toEqual([36 + 12, 12]);
    expect([wav.getUint16(20, true), wav.getUint16(22, true), wav.getUint32(24, true), wav.getUint32(28, true), wav.getUint16(32, true), wav.getUint16(34, true)]).toEqual([1, 2, 48_000, 192_000, 4, 16]);
    const samples = Array.from({ length: 6 }, (_, i) => wav.getInt16(44 + i * 2, true));
    expect(samples).toEqual([0, 16384, 32767, -16384, -32768, 0]);
  });

  it("clips what is past full scale, and writes a mono file from one side", () => {
    const wav = new DataView(encodeWav([Float32Array.of(2, -2)], 8000));
    expect([wav.getUint16(22, true), wav.getInt16(44, true), wav.getInt16(46, true)]).toEqual([1, 32767, -32768]);
    expect(encodeWav([], 8000).byteLength).toBe(44);
  });
});

// A recorder the test drives: record() resolves when told to, and a take gives back the blob it is handed.
function setup(over: Partial<VoiceoverDeps> = {}, canEdit = true) {
  const store = makeStore({ canEdit });
  const dropped: { file: File; at: TimelinePoint }[] = [];
  const take: Take & { stopped: number; cancelled: number } = {
    stopped: 0,
    cancelled: 0,
    stop: async () => {
      take.stopped += 1;
      return new Blob(["sound"]);
    },
    cancel: () => void (take.cancelled += 1),
  };
  let clock = 1000;
  const deps: VoiceoverDeps = {
    store,
    record: vi.fn(async () => take),
    decode: vi.fn(async () => ({ sides: [Float32Array.of(0.1, 0.2)], sampleRate: 48_000 })),
    drop: (file, at) => void dropped.push({ file, at }),
    now: () => clock,
    name: () => "Voiceover 14-05-09",
    ...over,
  };
  return { store, deps, voiceover: createVoiceover(deps), dropped, take, tick: (ms: number) => (clock += ms) };
}
const named = (name: string) => Object.assign(new Error(name), { name });

describe("recording a voiceover", () => {
  it("records from the playhead while the project plays, then lands the take there as a WAV file", async () => {
    const t = setup();
    t.store.getState().seek(45);
    await t.voiceover.start();
    expect(t.voiceover.state.getState()).toEqual({ stage: "recording", startedAt: 1000, frame: 45 });
    expect(t.store.getState().playing).toBe(true);
    await t.voiceover.stop();
    expect(t.store.getState().playing).toBe(false);
    expect(t.voiceover.state.getState()).toEqual({ stage: "idle" });
    expect(t.dropped).toHaveLength(1);
    expect(t.dropped[0].at).toEqual({ frame: 45, trackId: null });
    expect(t.dropped[0].file.name).toBe("Voiceover 14-05-09.wav");
    expect(t.dropped[0].file.type).toBe("audio/wav");
    expect(t.dropped[0].file.size).toBe(44 + 4);
  });

  it("says why when the microphone is refused, missing or cannot be recorded", async () => {
    for (const [error, why] of [[named("NotAllowedError"), "denied"], [named("NotFoundError"), "no-microphone"], [new Error("old browser"), "unsupported"]] as const) {
      const t = setup({ record: async () => Promise.reject(error) });
      await t.voiceover.start();
      expect(t.voiceover.state.getState()).toEqual({ stage: "failed", why });
      expect(t.store.getState().playing).toBe(false);
      expect(VOICEOVER_MESSAGE[why].length).toBeGreaterThan(0);
    }
  });

  it("a take with nothing in it, or one that cannot be read, lands nothing and says so", async () => {
    const empty = setup({ decode: async () => ({ sides: [new Float32Array(0)], sampleRate: 48_000 }) });
    await empty.voiceover.start();
    await empty.voiceover.stop();
    expect(empty.voiceover.state.getState()).toEqual({ stage: "failed", why: "empty" });
    const broken = setup({ decode: async () => Promise.reject(new Error("bad data")) });
    await broken.voiceover.start();
    await broken.voiceover.stop();
    expect(broken.voiceover.state.getState()).toEqual({ stage: "failed", why: "unreadable" });
    expect([...empty.dropped, ...broken.dropped]).toEqual([]);
  });

  it("cancel keeps nothing and lets the microphone go", async () => {
    const t = setup();
    await t.voiceover.start();
    t.voiceover.cancel();
    expect(t.take.cancelled).toBe(1);
    expect(t.voiceover.state.getState()).toEqual({ stage: "idle" });
    expect(t.store.getState().playing).toBe(false);
    await t.voiceover.stop(); // nothing left to stop
    expect(t.dropped).toEqual([]);
  });

  it("cancelled while the browser is still asking, the take is dropped as soon as it comes", async () => {
    let grant: (take: Take) => void = () => {};
    const t = setup({ record: () => new Promise<Take>((resolve) => (grant = resolve)) });
    const starting = t.voiceover.start();
    expect(t.voiceover.state.getState()).toEqual({ stage: "asking" });
    t.voiceover.cancel();
    grant(t.take);
    await starting;
    expect(t.take.cancelled).toBe(1);
    expect(t.voiceover.state.getState()).toEqual({ stage: "idle" });
  });

  it("one take at a time, a viewer records none, and a failed start can be tried again", async () => {
    const t = setup();
    await t.voiceover.start();
    await t.voiceover.start();
    expect(t.deps.record).toHaveBeenCalledTimes(1);
    const viewer = setup({}, false);
    await viewer.voiceover.start();
    expect(viewer.deps.record).not.toHaveBeenCalled();
    let fail = true;
    const retry = setup({ record: async () => (fail ? Promise.reject(named("NotAllowedError")) : retry.take) });
    await retry.voiceover.start();
    fail = false;
    await retry.voiceover.start();
    expect(retry.voiceover.state.getState().stage).toBe("recording");
  });

  it("names each take by the time it was made", () => {
    expect(voiceoverName(new Date(2026, 10, 22, 14, 5, 9))).toBe("Voiceover 14-05-09");
    expect(voiceoverName(new Date(2026, 10, 22, 14, 5, 9), "Screen")).toBe("Screen 14-05-09");
  });

  it("a screen or camera take is kept as the video file it is, and the project does not play while it is made", async () => {
    const webm = setup({ picture: true, record: async () => ({ stop: async () => new Blob(["video"], { type: "video/webm;codecs=vp9" }), cancel: () => {} }) });
    webm.store.getState().seek(30);
    await webm.voiceover.start();
    expect(webm.store.getState().playing).toBe(false);
    await webm.voiceover.stop();
    expect(webm.deps.decode).not.toHaveBeenCalled();
    expect(webm.dropped[0].file.name).toBe("Voiceover 14-05-09.webm");
    expect(webm.dropped[0].at).toEqual({ frame: 30, trackId: null });
    const mp4 = setup({ picture: true, record: async () => ({ stop: async () => new Blob(["video"], { type: "video/mp4" }), cancel: () => {} }) });
    await mp4.voiceover.start();
    await mp4.voiceover.stop();
    expect(mp4.dropped[0].file.name).toBe("Voiceover 14-05-09.mp4");
  });
});
