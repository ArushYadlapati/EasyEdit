import { describe, expect, it } from "vitest";
import { writeFcp7 } from "@/lib/interchange/fcp7";
import type { SeqClip, Sequence } from "@/lib/interchange/model";
import { exportTimeline, foldSound, importPlan, matchFile, readTimeline, type LibraryFile } from "@/lib/interchange/plan";
import { LIMITS } from "@/lib/limits";
import { DEFAULT_TRANSFORM, applyOps, createEmptyDoc, prepareOps, type Clip, type TimelineDoc } from "@/lib/timeline";
import { text, video } from "../editor/fixtures";

const file = (id: string, fileName: string, over: Partial<LibraryFile> = {}): LibraryFile => ({ id, kind: "video", name: fileName.replace(/\.\w+$/, ""), fileName, durationMs: 20_000, hasAudio: true, ...over });
const LIBRARY = [file("fa", "A001.mov"), file("fb", "B roll.mp4"), file("fl", "logo.png", { kind: "image", durationMs: null, hasAudio: false }), file("fs", "song.wav", { kind: "audio" })];
const clip = (over: Partial<SeqClip>): SeqClip => ({ name: "x", fileName: "A001.mov", kind: "video", track: 0, start: 0, duration: 2, in: 0, speed: 1, ...over });
const seq = (clips: SeqClip[], over: Partial<Sequence> = {}): Sequence => ({ name: "Cut", fps: 30, width: 1920, height: 1080, clips, markers: [], notes: [], ...over });
let n = 0;
const ids = () => `new${++n}`;
const plan = (doc: TimelineDoc, s: Sequence, files = LIBRARY) => {
  n = 0;
  const made = importPlan(doc, s, files, ids);
  if (!made.ok) throw new Error(made.message);
  return { ...made, doc: applyOps(doc, prepareOps(made.ops)).doc };
};
const clipsOf = (doc: TimelineDoc, trackId: string) => doc.tracks.find((t) => t.id === trackId)!.clips as (Clip & Record<string, unknown>)[];

describe("finding a timeline's files in the library", () => {
  it("matches by file name, whatever its case, then by the name without its ending", () => {
    expect(matchFile("a001.MOV", LIBRARY)?.id).toBe("fa");
    expect(matchFile("B roll.mov", LIBRARY)?.id).toBe("fb"); // a re-encoded copy: same name, other ending
    expect(matchFile("logo", LIBRARY)?.id).toBe("fl");
    expect(matchFile("nope.mp4", LIBRARY)).toBeNull();
    expect(matchFile(null, LIBRARY)).toBeNull();
  });
  it("does not guess between two files with the same name and different endings", () => {
    const two = [file("f1", "take.mp4"), file("f2", "take.mov")];
    expect(matchFile("take.mxf", two)).toBeNull();
    expect(matchFile("take.mov", two)?.id).toBe("f2");
  });
});

describe("a video clip's sound, listed apart from its picture", () => {
  it("is folded back into the clip, at the sound's level, and a stereo pair is one clip", () => {
    const folded = foldSound(
      seq([
        clip({ start: 0, duration: 3, in: 1 }),
        clip({ kind: "audio", track: 0, start: 0, duration: 3, in: 1, volume: 0.5 }),
        clip({ kind: "audio", track: 1, start: 0, duration: 3, in: 1, volume: 0.5 }),
        clip({ fileName: "song.wav", kind: "audio", track: 2, start: 0, duration: 6 }),
        clip({ fileName: "song.wav", kind: "audio", track: 3, start: 0, duration: 6 }),
        clip({ fileName: "B roll.mp4", start: 3, duration: 2 }),
      ]),
      30,
    );
    expect(folded.map((c) => [c.kind, c.track, c.fileName, c.sound, c.volume])).toEqual([
      ["video", 0, "A001.mov", true, 0.5],
      ["video", 0, "B roll.mp4", false, undefined], // its sound was cut away in the other program
      ["audio", 0, "song.wav", undefined, undefined],
    ]);
  });
  it("plays as recorded when the file lists no sound at all, and as the file says when it says", () => {
    expect(foldSound(seq([clip({})]), 30)[0].sound).toBe(true);
    expect(foldSound(seq([clip({ sound: false }), clip({ start: 2, sound: true })]), 30).map((c) => c.sound)).toEqual([false, true]);
  });
});

describe("bringing a timeline into a project", () => {
  it("uses the project's empty tracks first and keeps every cut where it was", () => {
    const { ops, summary, doc } = plan(
      createEmptyDoc("long_16x9"),
      seq(
        [
          clip({ start: 0, duration: 3, in: 1, sound: true, volume: 0.5 }),
          clip({ fileName: "B roll.mp4", start: 3, duration: 2, in: 4, speed: 2, dissolveIn: 0.5 }),
          clip({ fileName: "song.wav", kind: "audio", start: 0, duration: 6, in: 0.5, volume: 1.5 }),
        ],
        { markers: [{ at: 1.5, name: "Hook" }] },
      ),
    );
    expect(ops.filter((o) => o.op === "add_track")).toEqual([]);
    expect(clipsOf(doc, "v1").map((c) => ({ type: c.type, assetId: c.assetId, start: c.start, duration: c.duration, in: c.in, speed: c.speed, volume: c.volume }))).toEqual([
      { type: "video", assetId: "fa", start: 0, duration: 90, in: 30, speed: 1, volume: 0.5 },
      { type: "video", assetId: "fb", start: 90, duration: 60, in: 120, speed: 2, volume: 0 },
    ]);
    expect(clipsOf(doc, "v1")[1].transitionIn).toEqual({ kind: "crossfade", frames: 15 });
    expect(clipsOf(doc, "a1")[0]).toMatchObject({ type: "audio", assetId: "fs", start: 0, duration: 180, in: 15, volume: 1.5 });
    expect(doc.markers).toMatchObject([{ at: 45, name: "Hook" }]);
    expect(summary).toEqual({ clips: 3, matched: 3, missing: [], videoTracks: 1, audioTracks: 1, markers: 1, notes: [] });
  });
  it("adds tracks for the rest: pictures in front of the project's own and behind its text, sound at the end", () => {
    const doc = createEmptyDoc("long_16x9");
    doc.tracks[0].clips = [video("mine", 0, 30)];
    doc.tracks[2].clips = [video("song", 0, 30, { type: "audio" })];
    const made = plan(doc, seq([clip({}), clip({ fileName: "logo.png", track: 1, start: 1 }), clip({ fileName: "song.wav", kind: "audio" })]));
    expect(made.doc.tracks.map((t) => `${t.kind}:${t.name}`)).toEqual(["video:Video 1", "overlay:Overlay 1", "overlay:Overlay 2", "text:Text 1", "audio:Audio 1", "audio:Audio 2"]);
    expect(made.doc.tracks[1].clips[0]).toMatchObject({ type: "video", assetId: "fa" });
    expect(made.doc.tracks[2].clips[0]).toMatchObject({ type: "image", assetId: "fl", in: 0, speed: 1, volume: 0, start: 30 });
    expect(made.doc.tracks[5].clips[0]).toMatchObject({ type: "audio", assetId: "fs" });
    expect(made.doc.tracks[0].clips.map((c) => c.id)).toEqual(["mine"]);
  });
  it("puts an empty slot where a file is not in the library, named for the file it wants", () => {
    const { summary, doc } = plan(
      createEmptyDoc("long_16x9"),
      seq([clip({ fileName: "C0012 (final).MXF", start: 0, duration: 2 }), clip({ fileName: "C0012 (final).MXF", start: 2, duration: 1 }), clip({ fileName: "9 lives.wav", kind: "audio", duration: 3 }), clip({ fileName: "song.wav", start: 3, duration: 1 })]),
    );
    expect(clipsOf(doc, "v1").map((c) => [c.type, c.accepts, (c.slot as { name: string; hint: string }).name, (c.slot as { hint: string }).hint, c.duration])).toEqual([
      ["placeholder", "visual", "c0012_final", "Wants the file C0012 (final).MXF", 60],
      ["placeholder", "visual", "c0012_final_2", "Wants the file C0012 (final).MXF", 30],
      ["placeholder", "visual", "song", "Wants the file song.wav", 30], // a sound file cannot go on a video track
    ]);
    expect(clipsOf(doc, "a1")[0]).toMatchObject({ type: "placeholder", accepts: "audio", slot: { name: "clip_9_lives" } });
    expect(summary).toMatchObject({ clips: 4, matched: 0, missing: ["C0012 (final).MXF", "song.wav", "9 lives.wav"] });
  });
  it("moves cuts to this project's frames, shortens a clip to its file, and keeps clips from overlapping", () => {
    const short = [file("fa", "A001.mov", { durationMs: 2_000 })];
    const { summary, doc } = plan(
      createEmptyDoc("long_16x9"),
      seq([clip({ start: 0, duration: 1.01, in: 0 }), clip({ start: 1.0, duration: 4, in: 1 }), clip({ start: 6, duration: 1, in: 1.5, speed: -1 })], { fps: 24 }),
      short,
    );
    // 2 s of file at 30 fps is 60 frames: the second clip, from frame 31 after giving way a frame, ends with the file.
    expect(clipsOf(doc, "v1").map((c) => [c.start, c.duration, c.in, c.speed])).toEqual([[0, 30, 0, 1], [30, 30, 30, 1], [180, 30, 59, -1]]);
    expect(summary.notes).toEqual([
      "The timeline was made at 24 frames a second and this project runs at 30: every cut was moved to the nearest frame here.",
      "1 clip was shortened to fit the file in the library, which is shorter than the timeline expected.",
    ]);
  });
  it("drops a cross dissolve that has no clip to blend from, and one for an audio clip", () => {
    const { doc } = plan(createEmptyDoc("long_16x9"), seq([clip({ start: 1, duration: 2, dissolveIn: 0.5 }), clip({ fileName: "B roll.mp4", start: 4, duration: 2, dissolveIn: 0.5 }), clip({ fileName: "song.wav", kind: "audio", dissolveIn: 0.5 })]));
    expect(clipsOf(doc, "v1").map((c) => c.transitionIn)).toEqual([undefined, undefined]);
    expect(clipsOf(doc, "a1")[0].transitionIn).toBeUndefined();
  });
  it("is one change that undoes whole", () => {
    const before = createEmptyDoc("long_16x9");
    n = 0;
    const made = importPlan(before, seq([clip({}), clip({ fileName: "logo.png", track: 1 })], { markers: [{ at: 1, name: "m" }] }), LIBRARY, ids);
    if (!made.ok) throw new Error("no plan");
    const done = applyOps(before, prepareOps(made.ops));
    const undone = applyOps(done.doc, done.inverse).doc;
    expect(undone.tracks.map((t) => [t.id, t.clips.length])).toEqual(before.tracks.map((t) => [t.id, 0]));
    expect(undone.markers).toBeUndefined();
  });
  it("refuses a timeline with too many tracks or changes, and one with nothing in it", () => {
    const tall = seq(Array.from({ length: LIMITS.tracksPerProject }, (_, track) => clip({ track })));
    expect(importPlan(createEmptyDoc("long_16x9"), tall, LIBRARY, ids)).toMatchObject({ ok: false, message: expect.stringContaining("more tracks than this project has room for") });
    const long = seq(Array.from({ length: LIMITS.opsPerRequest + 1 }, (_, i) => clip({ start: i, duration: 0.5 })));
    expect(importPlan(createEmptyDoc("long_16x9"), long, LIBRARY, ids)).toMatchObject({ ok: false, message: expect.stringContaining("more than can be saved in one go") });
    expect(importPlan(createEmptyDoc("long_16x9"), seq([]), LIBRARY, ids)).toEqual({ ok: false, message: "That timeline has no clips this project can take." });
  });
});

describe("reading a file of any of the three kinds", () => {
  it("picks the reader by what the file is", () => {
    const xml = writeFcp7(seq([clip({})]), 30, { width: 1920, height: 1080 });
    expect(readTimeline("cut.xml", xml, 30)).toMatchObject({ ok: true, format: "fcp7" });
    expect(readTimeline("cut.edl", "TITLE: t\n001  AX V C 00:00:00:00 00:00:01:00 01:00:00:00 01:00:01:00\n", 30)).toMatchObject({ ok: true, format: "edl", sequence: { clips: [{ duration: 1 }] } });
    expect(readTimeline("holiday.mp4", "\u0000\u0000", 30)).toMatchObject({ ok: false, message: expect.stringContaining("not a timeline this can read") });
    expect(readTimeline("cut.xml", "<xmeml><oops></xmeml>", 30)).toMatchObject({ ok: false });
  });
});

describe("writing the project out", () => {
  function project(): TimelineDoc {
    const d = createEmptyDoc("long_16x9");
    d.tracks[0].clips = [
      video("c1", 0, 90, { assetId: "fa", in: 30, volume: 0.5 }),
      video("c2", 90, 60, { assetId: "fb", in: 120, speed: 2, transitionIn: { kind: "crossfade", frames: 15 }, transform: { ...DEFAULT_TRANSFORM, opacity: 0.8 } }),
      video("c3", 150, 30, { assetId: "fa", in: 59, speed: -1 }),
      video("c4", 180, 30, { assetId: "fa", in: 10, speed: 0 }),
    ];
    d.tracks[1].clips = [text("t1", 0, 60)];
    d.tracks[2].clips = [video("m1", 0, 180, { type: "audio", assetId: "fs", in: 15, volume: 1.5 })];
    d.markers = [{ id: "k", at: 45, name: "Hook" }];
    return d;
  }
  it("as each format, with its notes on what stays behind", () => {
    const xml = exportTimeline(project(), "My cut", LIBRARY, "fcp7");
    expect(xml.clips).toBe(5);
    expect(xml.text).toContain("<name>My cut</name>");
    expect(xml.notes).toEqual([
      "1 clip that is text, a shape, an adjustment layer or an empty slot stayed behind: these files carry video, images and sound only.",
      "1 freeze frame is written as plain clips.",
      "Colors, effects, crops, positions and keyframes are not part of these files. Relink the media by file name in the other program.",
    ]);
    expect(JSON.parse(exportTimeline(project(), "My cut", LIBRARY, "otio").text).name).toBe("My cut");
    const edl = exportTimeline(project(), "My cut", LIBRARY, "edl");
    expect(edl.text).toContain("TITLE: My cut");
    expect(edl.notes[0]).toBe("Clips that play faster, slower or backward are listed at normal speed.");
  });
  it("and what was written comes back into an empty project as the same cut", () => {
    const original = project();
    for (const format of ["fcp7", "otio"] as const) {
      const written = exportTimeline(original, "My cut", LIBRARY, format);
      const read = readTimeline(`cut.${format === "fcp7" ? "xml" : "otio"}`, written.text, 30);
      if (!read.ok) throw new Error(read.message);
      const back = plan(createEmptyDoc("long_16x9"), read.sequence).doc;
      const shape = (c: Clip & Record<string, unknown>) => ({ type: c.type, assetId: c.assetId, start: c.start, duration: c.duration, in: c.in, speed: c.speed, volume: c.volume });
      // The freeze frame goes out as a plain clip and comes back as one, and the backward clip, which has no sound
      // here, comes back with its volume at 0; the rest are the same.
      expect(clipsOf(back, "v1").map(shape), format).toEqual(clipsOf(original, "v1").map((c) => ({ ...shape(c), ...(c.speed === 0 && { speed: 1 }), ...((c.speed as number) < 0 && { volume: 0 }) })));
      expect(clipsOf(back, "v1")[1].transitionIn, format).toEqual({ kind: "crossfade", frames: 15 });
      expect(clipsOf(back, "a1").map(shape), format).toEqual(clipsOf(original, "a1").map(shape));
      expect(back.markers?.map((m) => [m.at, m.name]), format).toEqual([[45, "Hook"]]);
    }
    expect(clipsOf(plan(createEmptyDoc("long_16x9"), (readTimeline("c.xml", exportTimeline(original, "x", LIBRARY, "fcp7").text, 30) as { sequence: Sequence }).sequence).doc, "v1")[1].transform.opacity).toBe(0.8);
  });
});
