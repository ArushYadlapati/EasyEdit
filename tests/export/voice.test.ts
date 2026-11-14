import { AudioSample } from "mediabunny";
import { describe, expect, it, vi } from "vitest";
import { applyGain, mixParts, type VoicePart } from "@/lib/export/mix";
import { resampleInto, sincKernel } from "@/lib/export/resample";
import { audioBlocks } from "@/lib/export/schedule";
import { soundSchedule, type SoundSchedule } from "@/lib/export/sound-schedule";
import { createSourceRing, type SoundPacket } from "@/lib/export/source-ring";
import { createVoicePlayer } from "@/lib/export/voice";
import { createEmptyDoc, type Clip } from "@/lib/timeline";
import { video } from "../editor/fixtures";
import { fitTone, impulses, peakIndex, peaks, planar, tone } from "./audio-helpers";

const K = sincKernel();
// The file as decoded: planes at `rate`, cut into packets of 1,024 frames, the first at `first` seconds.
function decoded(planes: Float32Array[], rate: number, first = 0): AudioSample[] {
  const list: AudioSample[] = [];
  for (let at = 0; at < planes[0].length; at += 1_024) {
    const n = Math.min(1_024, planes[0].length - at);
    list.push(new AudioSample({ data: planar(planes.map((p) => p.slice(at, at + n))), format: "f32-planar", numberOfChannels: planes.length, sampleRate: rate, timestamp: first + at / rate }));
  }
  return list;
}
// An iterator that counts what was taken from it and whether it was let go.
function reader(list: SoundPacket[]) {
  const seen = { taken: 0, returned: 0 };
  const it: AsyncIterator<SoundPacket> = {
    async next() { return seen.taken < list.length ? { done: false, value: list[seen.taken++] } : { done: true, value: undefined }; },
    async return() { seen.returned += 1; return { done: true, value: undefined }; },
  };
  return { it, seen };
}
const song = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
  video(id, start, duration, { type: "audio", assetId: "song", ...extra }) as Clip;
function onAudio(...clips: Clip[]) {
  const d = createEmptyDoc("short_9x16");
  d.tracks[3].clips = clips;
  return d;
}
const schedule = (d: ReturnType<typeof onAudio>, sounds: Record<string, string>) => soundSchedule(d, sounds, 30, 48_000);
// Every block mixed as the export mixes it, then split into left and right.
async function play(s: SoundSchedule, files: Record<string, () => SoundPacket[]>, totalFrames: number) {
  const players = s.voices.map((voice) => createVoicePlayer(s, voice, reader(files[voice.fileId]()).it, K));
  const blocks = audioBlocks(totalFrames, s.fps, s.sampleRate);
  const total = blocks.reduce((n, b) => n + b.sampleCount, 0);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  for (const block of blocks) {
    const parts = (await Promise.all(players.map((p) => p.render(block)))).filter((p): p is VoicePart => p !== null);
    const mixed = mixParts(block.sampleCount, parts);
    for (let i = 0; i < block.sampleCount; i++) {
      left[block.startSample + i] = mixed[2 * i];
      right[block.startSample + i] = mixed[2 * i + 1];
    }
  }
  players.forEach((p) => p.stop());
  return { left, right };
}

describe("a voice from decoded packets", () => {
  it("copies a 48 kHz file bit for bit at speed 1, at the clip's gain", async () => {
    const left = Float32Array.from({ length: 480_000 }, (_, i) => (i % 1_000) / 1_024);
    const right = left.map((v) => -v);
    const s = schedule(onAudio(song("m1", 1, 60, { in: 2, volume: 0.5 })), { m1: "song" });
    const out = await play(s, { song: () => decoded([left, right], 48_000) }, 61);
    for (const k of [1_600 + 192, 50_000, 97_600 - 193]) {
      expect(out.left[k]).toBe(left[k - 1_600 + 3_200] * 0.5);
      expect(out.right[k]).toBe(right[k - 1_600 + 3_200] * 0.5);
    }
    expect(out.left.slice(0, 1_600).every((v) => v === 0)).toBe(true);
  });

  it("drops the priming before 0, a whole packet of it or part of one, places each packet at its own time, and plays mono on both sides", async () => {
    // lead 1,024: the first packet is all priming (AAC); lead 600: it straddles 0, as LAME's 1,105 frames do in an mp3
    for (const lead of [1_024, 600]) {
      const plane = Float32Array.from({ length: 3_072 }, (_, n) => (n - lead + 2_048) / 8_192); // file index j holds (j + 2,048) / 8,192
      const s = schedule(onAudio(song("m1", 0, 1)), { m1: "song" });
      const out = await play(s, { song: () => decoded([plane], 48_000, -lead / 48_000) }, 1);
      for (const k of [400, 1_000]) expect(out.left[k], `${lead} ${k}`).toBe((k + 2_048) / 8_192);
      expect(out.right[400]).toBe(out.left[400]);
    }
  });

  it("lets a later packet overwrite an earlier one where they meet, and reads 0 in a gap", () => {
    const ring = createSourceRing();
    const mono = (value: number, at: number, frames: number) =>
      new AudioSample({ data: new Float32Array(frames).fill(value), format: "f32-planar", numberOfChannels: 1, sampleRate: 48_000, timestamp: at / 48_000 });
    ring.place(mono(0.25, 0, 100));
    ring.place(mono(0.5, 99, 100)); // one frame early: overwrites, never sums to 0.75
    ring.place(mono(0.75, 300, 10));
    expect([98, 99, 198, 199, 250, 300].map((j) => ring.read(0, j))).toEqual([0.25, 0.5, 0.5, 0, 0, 0.75]);
  });

  it("is silent before a file's first sound and after its last, without an error", async () => {
    const s = schedule(onAudio(song("m1", 0, 60)), { m1: "song" });
    const out = await play(s, { song: () => decoded([new Float32Array(24_000).fill(0.25)], 48_000, 0.5) }, 60);
    expect([10_000, 23_999, 24_000, 47_999, 48_000, 90_000].map((k) => out.left[k])).toEqual([0, 0, 0.25, 0.25, 0, 0]);
  });

  it("puts a 44.1 kHz file on the timeline: file index j sounds at round(j × 48,000 / 44,100) after the in point, in every block", async () => {
    const plane = new Float32Array(132_300);
    plane[44_100 + 4_410] = 1;
    plane[44_100 + 66_150] = 1; // sounds at 76,800: in block 1
    const s = schedule(onAudio(song("m1", 3, 90, { in: 30 })), { m1: "song" });
    const out = await play(s, { song: () => decoded([plane], 44_100) }, 93);
    expect(peakIndex(out.left)).toBe(4_800 + 4_800);
    expect(peaks(out.left, 0.5)).toEqual([9_600, 76_800]);
  });

  it("carries the resampler across block edges: a 44.1 kHz tone stays clean over each second's edge", async () => {
    const s = schedule(onAudio(song("m1", 0, 90)), { m1: "song" });
    const out = await play(s, { song: () => decoded([tone(1_000, 44_100, 140_000)], 44_100) }, 90);
    for (const edge of [48_000, 96_000]) {
      expect(fitTone(out.left.slice(edge - 4_000, edge + 4_000), 1_000, 48_000, 0.5).residualDb, `${edge}`).toBeLessThan(-80);
    }
  });

  it("reads the file only as far as each block needs", async () => {
    const { it: packets, seen } = reader(decoded([new Float32Array(144_000).fill(0.5)], 48_000));
    const s = schedule(onAudio(song("m1", 0, 90)), { m1: "song" });
    await createVoicePlayer(s, s.voices[0], packets, K).render(audioBlocks(90, 30, 48_000)[0]);
    expect(seen.taken).toBeGreaterThanOrEqual(47);
    expect(seen.taken).toBeLessThanOrEqual(48); // 48 × 1,024 covers one second and the filter's reach
  });

  it.each([[1, 300, 10_000], [16, 30, 200_000]] as const)("holds a fraction of a second of the file at speed %s, however long the clip", async (speed, frames, most) => {
    // held() is sampled at every packet taken, so the peak inside a render counts, not only what is left after it
    let peak = 0;
    const s = schedule(onAudio(song("m1", 0, frames, { speed })), { m1: "song" });
    const source = reader(decoded([tone(1_000, 44_100, 44_100 * 17)], 44_100)).it;
    const watched: AsyncIterator<SoundPacket> = {
      next: () => { peak = Math.max(peak, player.held()); return source.next(); },
      return: () => source.return!(),
    };
    const player = createVoicePlayer(s, s.voices[0], watched, K);
    for (const block of audioBlocks(frames, 30, 48_000)) await player.render(block);
    expect(peak).toBeLessThan(most); // a whole block at once would be about 44,000 at speed 1 and 705,600 at 16
    player.stop();
  });

  it("lets go of an iterator whose return throws or rejects, without an error escaping", async () => {
    const s = schedule(onAudio(song("m1", 0, 30)), { m1: "song" });
    for (const fail of [() => { throw new Error("sync"); }, () => Promise.reject(new Error("async"))]) {
      const packets = { next: async () => ({ done: true, value: undefined }), return: fail } as unknown as AsyncIterator<SoundPacket>;
      const player = createVoicePlayer(s, s.voices[0], packets, K);
      await player.render(audioBlocks(30, 30, 48_000)[0]);
      expect(() => player.stop()).not.toThrow();
    }
    await new Promise((resolve) => setTimeout(resolve, 0)); // an escaped rejection fails the run
  });

  it("stops at a change of format partway through a file, closes every packet it took, and lets go once", async () => {
    const close = vi.spyOn(AudioSample.prototype, "close");
    const list = [...decoded([new Float32Array(2_048)], 48_000), ...decoded([new Float32Array(2_048)], 44_100, 2_048 / 48_000)];
    const { it: packets, seen } = reader(list);
    const s = schedule(onAudio(song("m1", 0, 30)), { m1: "song" });
    const player = createVoicePlayer(s, s.voices[0], packets, K);
    await expect(player.render(audioBlocks(30, 30, 48_000)[0])).rejects.toThrow("The sound changed format partway through the file.");
    expect(close).toHaveBeenCalledTimes(seen.taken);
    player.stop();
    player.stop();
    expect(seen.returned).toBe(1);
    close.mockRestore();
  });

  it("reads a clip at speed 2 twice as fast", async () => {
    const s = schedule(onAudio(song("m1", 0, 30, { speed: 2 })), { m1: "song" });
    const out = await play(s, { song: () => decoded([impulses(144_000, 3_200, 1_600)], 48_000) }, 30);
    expect(peaks(out.left, 0.3)).toEqual(Array.from({ length: 30 }, (_, m) => 800 + m * 1_600));
  });
});

describe("end to end, without a browser", () => {
  it("sounds an impulse every 1,600 file samples on whole frames of the timeline", async () => {
    const s = schedule(onAudio(song("m1", 2, 90, { in: 3 })), { m1: "song" });
    const out = await play(s, { song: () => decoded([impulses(240_000, 1_600)], 48_000) }, 92);
    const heard = [...out.left.keys()].filter((k) => Math.abs(out.left[k]) > 1e-9);
    // file 4,800 falls on the voice's first sample (3,200), where the ramp is 0; file 6,400 + 1,600m on 4,800 + 1,600m
    expect(heard).toEqual(Array.from({ length: 89 }, (_, m) => 4_800 + m * 1_600));
  });

  it("sounds a split clip exactly as the clip it was split from, and ramps each half where they do not continue", async () => {
    const whole = onAudio(song("m1", 0, 60));
    const split = onAudio(song("m1", 0, 30), song("m2", 30, 30, { in: 30 }));
    for (const [rate, file] of [[48_000, tone(997, 48_000, 144_000)], [44_100, tone(997, 44_100, 132_300)]] as const) {
      const files = { song: () => decoded([file], rate) };
      const a = await play(schedule(whole, { m1: "song" }), files, 60);
      const b = await play(schedule(split, { m1: "song", m2: "song" }), files, 60);
      expect(b.left).toEqual(a.left);
    }
    const apart = onAudio(song("m1", 0, 30), song("m2", 30, 30, { in: 30, volume: 0.99 }));
    const c = await play(schedule(apart, { m1: "song", m2: "song" }), { song: () => decoded([tone(997, 48_000, 144_000)], 48_000) }, 60);
    expect([c.left[47_999], c.left[48_000]].map(Math.abs)).toEqual([0, 0]); // abs: a ramp's zero can carry the sample's sign
  });
});

describe("the source ring and the voice, rule by rule", () => {
  const packet = (planes: Float32Array[], at: number) =>
    new AudioSample({ data: planar(planes), format: "f32-planar", numberOfChannels: planes.length, sampleRate: 48_000, timestamp: at / 48_000 });
  const filled = (frames: number, value: number) => new Float32Array(frames).fill(value);

  it("keeps nothing below index 0, refuses a read behind what it let go, and says when the file has ended", () => {
    const ring = createSourceRing();
    ring.place(packet([filled(100, 0.5)], -100)); // wholly priming
    expect([ring.held(), ring.top, ring.rate]).toEqual([0, 0, 48_000]);
    ring.place(packet([filled(100, 0.25)], -40));
    expect([ring.read(0, -1), ring.read(0, 0), ring.read(1, 59), ring.read(0, 60), ring.held()]).toEqual([0, 0.25, 0.25, 0, 60]);
    ring.dropBefore(30);
    expect(() => ring.read(0, 29)).toThrow(RangeError);
    expect([ring.read(0, 30), ring.held()]).toEqual([0.25, 30]);
    expect(ring.ended).toBe(false);
    ring.end();
    expect([ring.ended, ring.read(0, 60)]).toEqual([true, 0]);
  });

  it("reads 0 in a gap after letting go, where it once held sound", () => {
    const ring = createSourceRing();
    ring.place(packet([filled(200, 0.25)], 0));
    ring.dropBefore(150);
    ring.place(packet([filled(10, 0.5)], 210));
    expect([149, 150, 199, 200, 209, 210].map((j) => (j < 150 ? "let go" : ring.read(0, j)))).toEqual(["let go", 0.25, 0.25, 0, 0, 0.5]);
  });

  it("folds 5.1 to stereo by the speaker rules", () => {
    const ring = createSourceRing();
    ring.place(packet([0.1, 0.2, 0.3, 0.9, 0.05, 0.07].map((v) => filled(4, v)), 0)); // L R C LFE SL SR
    expect(ring.read(0, 2)).toBeCloseTo(0.1 + Math.SQRT1_2 * (0.3 + 0.05), 6);
    expect(ring.read(1, 2)).toBeCloseTo(0.2 + Math.SQRT1_2 * (0.3 + 0.07), 6);
  });

  it("renders zeros for a file that gives no packet at all", async () => {
    const s = schedule(onAudio(song("m1", 0, 30)), { m1: "song" });
    const player = createVoicePlayer(s, s.voices[0], reader([]).it, K);
    const part = await player.render(audioBlocks(30, 30, 48_000)[0]);
    expect(part && [part.at, part.left.length, part.left.every((v) => v === 0), part.right.every((v) => v === 0)]).toEqual([0, 48_000, true, true]);
    player.stop();
  });

  it("reads in spans exactly as one pass over the whole file would, from packets of any size", async () => {
    // 16-frame packets: the ring must reach the filter's whole reach past each span before it resamples
    const file = tone(1_000, 44_100, 50_000);
    const packets: SoundPacket[] = [];
    for (let at = 0; at < file.length; at += 16) packets.push(new AudioSample({ data: file.slice(at, at + 16), format: "f32-planar", numberOfChannels: 1, sampleRate: 44_100, timestamp: at / 44_100 }));
    const s = schedule(onAudio(song("m1", 0, 30, { in: 3 })), { m1: "song" });
    const part = await createVoicePlayer(s, s.voices[0], reader(packets).it, K).render(audioBlocks(30, 30, 48_000)[0]);
    const whole = new Float32Array(48_000);
    resampleInto(whole, 48_000, (j) => (j >= 0 && j < file.length ? file[j] : 0), 4_410, 44_100 / 48_000, K);
    applyGain({ at: 0, left: whole, right: whole.slice() }, 1, 0, 48_000);
    let worst = 0;
    for (let i = 0; i < 48_000; i++) worst = Math.max(worst, Math.abs(part!.left[i] - whole[i]));
    expect(worst).toBeLessThan(1e-6);
  });
});
