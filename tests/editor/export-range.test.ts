import { describe, expect, it } from "vitest";
import { RANGE_LABEL, rangeDoc, spanOf } from "@/lib/editor/export-range";
import { frameCount } from "@/lib/export/schedule";
import { sourceSeconds } from "@/lib/render/source-time";
import { docDuration, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// The sample project: v1 holds c1 (0–30) and c2 (30–60); t1 holds x1 (0–60) and x2 (90–120). It is 120 frames long.
const places = (d: TimelineDoc, track: number) => d.tracks[track].clips.map((c) => [c.id, c.start, c.duration]);
const clipOf = (d: TimelineDoc, id: string) => d.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as MediaClip;

describe("which part a choice means", () => {
  const d = sampleDoc();
  it("the whole project, the span of the selected clips, or from the playhead to the end", () => {
    expect(spanOf("all", d, [], 0)).toEqual({ from: 0, to: 120 });
    expect(spanOf("selection", d, ["c2"], 0)).toEqual({ from: 30, to: 60 });
    expect(spanOf("selection", d, ["c2", "x2"], 0)).toEqual({ from: 30, to: 120 });
    expect(spanOf("playhead", d, [], 45)).toEqual({ from: 45, to: 120 });
    expect(Object.values(RANGE_LABEL)).toEqual(["Whole project", "Selected clips", "From the playhead"]);
  });
  it("has nothing to offer with no clip selected, or the playhead at the end", () => {
    expect(spanOf("selection", d, [], 0)).toBeNull();
    expect(spanOf("selection", d, ["gone"], 0)).toBeNull();
    expect(spanOf("playhead", d, [], 120)).toBeNull();
    expect(spanOf("playhead", d, [], 500)).toBeNull();
  });
});

describe("a project cut down to a part of itself", () => {
  it("is the project itself when the part is all of it", () => {
    const d = sampleDoc();
    expect(rangeDoc(d, { from: 0, to: 120 })).toBe(d);
    expect(rangeDoc(d, { from: 0, to: 999 })).toBe(d);
  });

  it("keeps what plays in the part, starting at frame 0, and drops the rest", () => {
    const part = rangeDoc(sampleDoc(), { from: 30, to: 60 });
    expect(places(part, 0)).toEqual([["c2", 0, 30]]);
    expect(places(part, 1)).toEqual([["x1", 0, 30]]); // x1's second half
    expect(docDuration(part)).toBe(30);
    expect(frameCount(part)).toBe(30);
  });

  it("a clip the part cuts shows the same picture on every frame it still has", () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("c1", 0, 60, { in: 100, speed: 2 })];
    const part = rangeDoc(d, { from: 20, to: 50 });
    const before = clipOf(d, "c1");
    const after = clipOf(part, "c1");
    expect([after.start, after.duration]).toEqual([0, 30]);
    for (const frame of [20, 35, 49]) expect(sourceSeconds(after, frame - 20, 30)).toBeCloseTo(sourceSeconds(before, frame, 30), 6);
  });

  it("a clip cut at the part's edge does not fade or slide in there, but keeps its other end's way out", () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("c1", 0, 60, { fadeIn: 10, fadeOut: 10, transitionIn: { kind: "fade", frames: 10 }, transitionOut: { kind: "fade", frames: 10 } })];
    const tail = clipOf(rangeDoc(d, { from: 20, to: 60 }), "c1");
    expect(tail).toMatchObject({ fadeIn: 0, transitionIn: null, fadeOut: 10, transitionOut: { kind: "fade", frames: 10 } });
    const head = clipOf(rangeDoc(d, { from: 0, to: 40 }), "c1");
    expect(head).toMatchObject({ fadeIn: 10, transitionIn: { kind: "fade", frames: 10 }, fadeOut: 0, transitionOut: null });
  });

  it("keyframes stay on the pictures they were set on", () => {
    const d = sampleDoc();
    d.tracks[0].clips = [video("c1", 0, 60, { keyframes: { opacity: [{ at: 0, value: 0 }, { at: 40, value: 1 }] } })];
    const part = rangeDoc(d, { from: 20, to: 60 });
    expect(clipOf(part, "c1").keyframes!.opacity).toEqual([{ at: -20, value: 0 }, { at: 20, value: 1 }]);
  });

  it("works on locked tracks and never changes the project it was given", () => {
    const d = sampleDoc();
    d.tracks[0].locked = true;
    const frozen = structuredClone(d);
    const part = rangeDoc(d, { from: 30, to: 90 });
    expect(places(part, 0)).toEqual([["c2", 0, 30]]);
    expect(d).toEqual(frozen);
    expect(part.tracks[0].locked).toBe(false); // a copy to export, not the project
  });

  it("keeps a gap inside the part as a gap", () => {
    const part = rangeDoc(sampleDoc(), { from: 45, to: 120 });
    expect(places(part, 0)).toEqual([["c2", 0, 15]]);
    expect(places(part, 1)).toEqual([["x1", 0, 15], ["x2", 45, 30]]);
    expect(docDuration(part)).toBe(75);
  });
});
