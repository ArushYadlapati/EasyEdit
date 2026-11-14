import { describe, expect, it } from "vitest";
import { audioBlocks } from "@/lib/export/schedule";
import { createSoundPool } from "@/lib/export/sound-pool";
import { soundSchedule } from "@/lib/export/sound-schedule";
import { createEmptyDoc, type Clip } from "@/lib/timeline";
import { video } from "../editor/fixtures";
import { fakeSoundIO, file, tick, type FakeSoundOptions } from "./fakes";

const song = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
  video(id, start, duration, { type: "audio", assetId: "song", ...extra }) as Clip;
function schedule(v1: Clip[], a1: Clip[], sounds: Record<string, string>) {
  const d = createEmptyDoc("short_9x16");
  d.tracks[0].clips = v1;
  d.tracks[3].clips = a1;
  return soundSchedule(d, sounds, 30, 48_000);
}
const FILES = { song: file("song.mp3"), "prev-a": file("a.mp4") };
const blocks = (frames: number) => audioBlocks(frames, 30, 48_000);
const named = (name: string, message: string) => Object.assign(new Error(message), { name });
const oneSong = (options: FakeSoundOptions = {}) => {
  const io = fakeSoundIO(options);
  return { io, pool: createSoundPool(schedule([], [song("m1", 0, 30)], { m1: "song" }), FILES, io) };
};

describe("the worker's sound", () => {
  it("checks each sounding file once, in voice order, and opens none", async () => {
    const io = fakeSoundIO();
    const s = schedule([video("c1", 0, 90)], [song("m1", 0, 30), song("m2", 60, 30, { in: 60 })], { c1: "prev-a", m1: "song", m2: "song" });
    await createSoundPool(s, FILES, io).open();
    expect(io.log).toEqual(["probe a.mp4", "probe song.mp3"]);
  });

  it("mixes each block from the voices under it, at their gain and with their ramps", async () => {
    const io = fakeSoundIO(); // 0.5 everywhere
    const pool = createSoundPool(schedule([], [song("m1", 0, 45, { volume: 0.5 })], { m1: "song" }), FILES, io);
    await pool.open();
    const [first, second] = blocks(45);
    const a = await pool.block(first);
    const b = await pool.block(second);
    expect([a.length, b.length]).toEqual([96_000, 48_000]);
    expect([a[0], a[20_000], a[20_001]]).toEqual([0, 0.25, 0.25]);
    expect(b[2 * 23_999]).toBe(0); // the voice's last sample
  });

  it("opens a file as its first voice starts, and lets go of each voice and file after its last block", async () => {
    const io = fakeSoundIO();
    const pool = createSoundPool(schedule([], [song("m1", 30, 30, { in: 30 }), song("m2", 75, 15, { in: 90 })], { m1: "song", m2: "song" }), FILES, io);
    await pool.open();
    const [b0, b1, b2] = blocks(90);
    await pool.block(b0);
    expect(io.log).toEqual(["probe song.mp3"]);
    await pool.block(b1);
    expect(io.log.slice(1)).toEqual(["open song.mp3", "packets song.mp3 0.950-2.050", "stop song.mp3"]);
    await pool.block(b2);
    expect(io.log.slice(4)).toEqual(["packets song.mp3 2.950-3.550", "stop song.mp3", "dispose song.mp3"]);
  });

  it("opens a file once when two of its voices start in one block, and lets it go once", async () => {
    // a video on v1 with its sound continued on a1 from the same file, both from frame 0
    const io = fakeSoundIO();
    const pool = createSoundPool(schedule([video("c1", 0, 30)], [song("m1", 0, 30)], { c1: "prev-a", m1: "prev-a" }), FILES, io);
    await pool.open();
    await pool.block(blocks(30)[0]);
    expect(io.log).toEqual([
      "probe a.mp4", "open a.mp4", "packets a.mp4 0.000-1.050", "packets a.mp4 0.000-1.050", "stop a.mp4", "stop a.mp4", "dispose a.mp4",
    ]);
    await pool.close();
    expect(io.log.filter((l) => l === "dispose a.mp4")).toHaveLength(1);
  });

  it("reads each voice with one reader across all its blocks", async () => {
    const io = fakeSoundIO();
    const pool = createSoundPool(schedule([], [song("m1", 0, 45)], { m1: "song" }), FILES, io);
    await pool.open();
    for (const block of blocks(45)) await pool.block(block);
    expect(io.log).toEqual(["probe song.mp3", "open song.mp3", "packets song.mp3 0.000-1.550", "stop song.mp3", "dispose song.mp3"]);
  });

  it("sums every voice under the block in voice order, so the same project makes the same file every time", async () => {
    const s = schedule([video("c1", 0, 30)], [song("m1", 0, 30), song("m2", 0, 30, { in: 30 })], { c1: "prev-a", m1: "song", m2: "song" });
    expect(s.voices.map((v) => v.clipIds[0])).toEqual(["c1", "m1", "m2"]);
    const mixOf = async (a: number, b: number) => {
      const pool = createSoundPool(s, FILES, fakeSoundIO({ value: (name) => (name === "a.mp4" ? a : b) }));
      await pool.open();
      const mix = await pool.block(blocks(30)[0]);
      return [mix[20_000], mix[20_001]];
    };
    expect(await mixOf(0.25, 0.125)).toEqual([0.5, 0.5]);
    // 0.5 + 2^-25 rounds back to 0.5 in float32, twice; summed the other way, 2^-25 + 2^-25 + 0.5 is 0.5 + 2^-24
    expect(await mixOf(0.5, 2 ** -25)).toEqual([0.5, 0.5]);
  });

  it("is silent for a file without a sound track, and never opens it", async () => {
    const { io, pool } = oneSong({ probe: () => "none" });
    await pool.open();
    expect((await pool.block(blocks(30)[0])).every((v) => v === 0)).toBe(true);
    expect(io.log).toEqual(["probe song.mp3"]);
  });

  it("names its failures", async () => {
    const cases: [string, FakeSoundOptions, "open" | "block", { code: string; detail: string }][] = [
      ["a sound this browser cannot decode", { probe: () => "undecodable" }, "open", { code: "sound", detail: "song" }],
      ["a file gone before the check", { probe: () => { throw named("NotReadableError", "gone"); } }, "open", { code: "media", detail: "gone" }],
      ["a file this browser cannot read as sound", { probe: () => { throw new Error("unsupported format"); } }, "open", { code: "sound", detail: "unsupported format" }],
      ["a file that cannot be opened", { unreadable: () => true }, "block", { code: "media", detail: "unreadable" }],
      ["a decoder error", { rejectsWith: () => new Error("decoder error") }, "block", { code: "sound", detail: "decoder error" }],
      ["a decoder taken back", { rejectsWith: () => named("QuotaExceededError", "reclaimed") }, "block", { code: "encoder", detail: "reclaimed" }],
      ["a file disposed under it", { rejectsWith: () => named("InputDisposedError", "disposed") }, "block", { code: "media", detail: "disposed" }],
    ];
    for (const [why, options, at, failure] of cases) {
      const { pool } = oneSong(options);
      const step = at === "open" ? pool.open() : pool.open().then(() => pool.block(blocks(30)[0]));
      await expect(step, why).rejects.toMatchObject(failure);
    }
    const missing = createSoundPool(schedule([], [song("m1", 0, 30)], { m1: "song" }), {}, fakeSoundIO());
    await expect(missing.open()).rejects.toMatchObject({ code: "media", detail: "song" });
  });

  it("ends a block when one voice breaks while another never answers", async () => {
    const io = fakeSoundIO({ hangs: (name) => name === "a.mp4", rejectsWith: (name) => (name === "song.mp3" ? new Error("decoder error") : null) });
    const pool = createSoundPool(schedule([video("c1", 0, 30)], [song("m1", 0, 30)], { c1: "prev-a", m1: "song" }), FILES, io);
    await pool.open();
    await expect(pool.block(blocks(30)[0])).rejects.toMatchObject({ code: "sound", detail: "decoder error" });
    await pool.close();
    expect(io.log.slice(-4)).toEqual(["dispose a.mp4", "dispose song.mp3", "stop a.mp4", "stop song.mp3"]);
  });

  it("close lets go of everything still open without waiting, once", async () => {
    const { io, pool } = oneSong({ hangs: () => true });
    await pool.open();
    void pool.block(blocks(30)[0]).catch(() => {});
    await tick();
    await pool.close();
    expect(io.log.slice(-2)).toEqual(["dispose song.mp3", "stop song.mp3"]);
    await pool.close();
    expect(io.log.slice(-2)).toEqual(["dispose song.mp3", "stop song.mp3"]);
  });
});
