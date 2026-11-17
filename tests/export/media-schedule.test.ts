import { describe, expect, it } from "vitest";
import { exportPlaceholderLabel, mediaSchedule } from "@/lib/export/media-schedule";
import { createEmptyDoc, type MediaClip } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";

const SAMPLE = { c1: { fileId: "prev-a" }, c2: { fileId: "prev-a" } };

describe("the media schedule", () => {
  it("gives each drawn clip its frames and the moment of its file for each", () => {
    const { clips, lastUse } = mediaSchedule(sampleDoc(), SAMPLE);
    expect(clips.map((c) => ({ clipId: c.clipId, kind: c.kind, fileId: c.fileId, start: c.start, end: c.end }))).toEqual([
      { clipId: "c1", kind: "video", fileId: "prev-a", start: 0, end: 30 },
      { clipId: "c2", kind: "video", fileId: "prev-a", start: 30, end: 60 },
    ]);
    expect(clips[0].seconds).toHaveLength(30);
    expect([clips[0].seconds[0], clips[0].seconds[29]]).toEqual([0, 29 / 30]);
    expect(clips[1].seconds[0]).toBe(0); // the fixture's c2 starts at in 0 too
    expect(lastUse).toEqual({ "prev-a": 59 });
  });

  it("follows speed and in point, and two halves of a split clip continue one another", () => {
    const d = createEmptyDoc("short_9x16");
    // a clip at in 60, speed 2, split at frame 30: the second half starts at in 60 + 30 × 2 = 120
    d.tracks[0].clips = [video("s1", 0, 30, { in: 60, speed: 2 }), video("s2", 30, 15, { in: 120, speed: 2 })];
    const { clips } = mediaSchedule(d, { s1: { fileId: "f" }, s2: { fileId: "f" } });
    expect([clips[0].seconds[0], clips[0].seconds[15], clips[0].seconds[29]]).toEqual([2, 3, 118 / 30]);
    expect(clips[1].seconds[0]).toBe(4); // one step after s1's last moment, (60 + 30 × 2) / 30
  });

  it("schedules overlapping layers in drawing order, and an image without times", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [] });
    d.tracks[0].clips = [video("v", 0, 60)];
    d.tracks[1].clips = [video("i", 10, 20, { type: "image", assetId: "b" })];
    const { clips, lastUse } = mediaSchedule(d, { v: { fileId: "f" }, i: { fileId: "logo" } });
    expect(clips.map((c) => [c.clipId, c.kind, c.start, c.end, c.seconds.length])).toEqual([["v", "video", 0, 60, 60], ["i", "image", 10, 30, 0]]);
    expect(lastUse).toEqual({ f: 59, logo: 29 });
  });

  it("keeps a file's latest frame as its last use, whichever of its clips is scheduled last", () => {
    const d = createEmptyDoc("short_9x16");
    d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [] });
    d.tracks[0].clips = [video("long", 0, 90)];
    d.tracks[1].clips = [video("short", 10, 20)]; // drawn after "long", ends before it
    expect(mediaSchedule(d, { long: { fileId: "f" }, short: { fileId: "f" } }).lastUse).toEqual({ f: 89 });
  });

  it("leaves out what draws no picture from a file: placeholders, audio, hidden tracks, invisible clips", () => {
    const d = sampleDoc();
    d.tracks[3].clips = [video("m", 0, 30, { type: "audio" })];
    const placeholders = mediaSchedule(d, { c1: { label: "Media removed" }, c2: { fileId: "prev-a" }, m: { fileId: "song" } });
    expect(placeholders.clips.map((c) => c.clipId)).toEqual(["c2"]);
    expect(placeholders.lastUse).toEqual({ "prev-a": 59 });
    expect(mediaSchedule(sampleDoc(), { c2: { fileId: "prev-a" } }).clips.map((c) => c.clipId)).toEqual(["c2"]); // c1 has no entry
    const hidden = sampleDoc();
    hidden.tracks[0].hidden = true;
    expect(mediaSchedule(hidden, SAMPLE)).toEqual({ clips: [], lastUse: {} });
    const faded = sampleDoc();
    (faded.tracks[0].clips[0] as MediaClip).transform.opacity = 0;
    expect(mediaSchedule(faded, SAMPLE).clips.map((c) => c.clipId)).toEqual(["c2"]);
  });

  it("keeps a crossfade's outgoing clip drawing past its out point for the crossfade's length", () => {
    const crossfade = { transitionIn: { kind: "crossfade", frames: 10 } };
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [video("A", 0, 30, { in: 15 }), video("B", 30, 30, { assetId: "b", ...crossfade })];
    const { clips, lastUse } = mediaSchedule(d, { A: { fileId: "f" }, B: { fileId: "g" } });
    expect(clips.map((c) => [c.clipId, c.start, c.end, c.seconds.length])).toEqual([["A", 0, 40, 40], ["B", 30, 60, 30]]);
    expect(clips[0].seconds[39]).toBe((15 + 39) / 30); // the moments run on past the out point
    expect(lastUse).toEqual({ f: 39, g: 59 });

    const plain = createEmptyDoc("short_9x16");
    plain.tracks[0].clips = [video("A", 0, 30, { in: 15 }), video("B", 30, 30, { assetId: "b" })];
    expect(mediaSchedule(plain, { A: { fileId: "f" }, B: { fileId: "g" } }).clips.map((c) => [c.clipId, c.end, c.seconds.length])).toEqual([["A", 30, 30], ["B", 60, 30]]);

    // A crossfade longer than half a clip that also fades out is cut to half of it, and the outgoing clip with it.
    const cut = createEmptyDoc("short_9x16");
    cut.tracks[0].clips = [video("A", 0, 30), video("B", 30, 12, { transitionIn: { kind: "crossfade", frames: 10 }, transitionOut: { kind: "fade", frames: 10 } })];
    expect(mediaSchedule(cut, { A: { fileId: "f" } }).clips[0].end).toBe(36);
  });

  it("times the tail by the incoming clip's crossfade as it draws, whole when that clip is itself crossfaded out of", () => {
    const crossfade = { transitionIn: { kind: "crossfade", frames: 10 } };
    const d = createEmptyDoc("short_9x16");
    d.tracks[0].clips = [
      video("A", 0, 30),
      video("B", 30, 12, { ...crossfade, transitionOut: { kind: "fade", frames: 10 } }),
      video("C", 42, 30, crossfade),
    ];
    const { clips } = mediaSchedule(d, { A: { fileId: "f" }, B: { fileId: "f" }, C: { fileId: "f" } });
    expect(clips.map((c) => [c.clipId, c.end, c.seconds.length])).toEqual([["A", 40, 40], ["B", 52, 22], ["C", 72, 30]]);
    const short = createEmptyDoc("short_9x16");
    // A one-frame clip with an effect at each end has room for neither: the crossfade is cut to 0 frames, so no tail.
    short.tracks[0].clips = [video("A", 0, 30), video("B", 30, 1, { ...crossfade, transitionOut: { kind: "fade", frames: 10 } })];
    expect(mediaSchedule(short, { A: { fileId: "f" } }).clips[0].end).toBe(30);
  });

  it("schedules a clip that fades in from opacity 0 with its opacity keyframes", () => {
    const d = sampleDoc();
    const c1 = d.tracks[0].clips[0] as MediaClip;
    c1.transform.opacity = 0;
    c1.keyframes = { opacity: [{ at: 0, value: 0 }, { at: 10, value: 1 }] };
    expect(mediaSchedule(d, SAMPLE).clips.map((c) => c.clipId)).toEqual(["c1", "c2"]);
  });

  it("names a clip's placeholder by its label, or by its kind", () => {
    const label = exportPlaceholderLabel({ c1: { label: "Media removed" }, c2: { fileId: "prev-a" } });
    expect(label(video("c1", 0, 30) as MediaClip)).toBe("Media removed");
    expect(label(video("c2", 0, 30) as MediaClip)).toBe("Video");
    expect(label(video("i", 0, 30, { type: "image" }) as MediaClip)).toBe("Image");
  });
});
