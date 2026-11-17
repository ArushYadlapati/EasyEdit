import { describe, expect, it } from "vitest";
import { thumbnailFrame } from "@/lib/render/thumbnail-frame";
import { DEFAULT_TRANSFORM, type TimelineDoc, type Track } from "@/lib/timeline";
import { sampleDoc, text, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";

// A 30 fps project whose tracks are, in order: v1 (video), t1 (text), cap, a1 (audio).
const empty = (): TimelineDoc => docWithCaptions("short_9x16");
const track = (id: string, kind: Track["kind"], clips: Track["clips"] = []): Track =>
  ({ id, kind, name: id, muted: false, hidden: false, locked: false, clips });

describe("thumbnailFrame", () => {
  it("nothing shows: frame 0", () => {
    expect(thumbnailFrame(empty())).toBe(0);
    const audioOnly = empty();
    audioOnly.tracks[3].clips = [video("m1", 0, 300, { type: "audio" })];
    expect(thumbnailFrame(audioOnly)).toBe(0);
  });

  it("one second into the first clip", () => {
    const d = empty();
    d.tracks[0].clips = [video("c1", 90, 300)];
    expect(thumbnailFrame(d)).toBe(120);
  });

  it("the middle of a clip shorter than two seconds", () => {
    const at = (start: number, duration: number) => {
      const d = empty();
      d.tracks[0].clips = [video("c1", start, duration)];
      return thumbnailFrame(d);
    };
    expect(at(10, 45)).toBe(32);
    expect(at(0, 59)).toBe(29);
    expect(at(7, 1)).toBe(7);
  });

  it("hidden tracks, audio, opacity 0 and blank text are passed over", () => {
    const d = empty();
    d.tracks[0].hidden = true;
    d.tracks[0].clips = [video("c1", 0, 300)];
    d.tracks[1].clips = [text("x1", 0, 300, { text: "   " }), text("x2", 10, 300, { transform: { ...DEFAULT_TRANSFORM, opacity: 0 } })];
    d.tracks[3].clips = [video("m1", 0, 300, { type: "audio" })];
    d.tracks.splice(1, 0, track("v2", "video", [video("c2", 200, 60)]));
    expect(thumbnailFrame(d)).toBe(230);
  });

  it("a clip that fades in from opacity 0 counts as one that shows", () => {
    const d = empty();
    d.tracks[0].clips = [video("c2", 200, 60)];
    d.tracks[1].clips = [text("x2", 10, 300, { transform: { ...DEFAULT_TRANSFORM, opacity: 0 }, keyframes: { opacity: [{ at: 0, value: 0 }, { at: 15, value: 1 }] } })];
    expect(thumbnailFrame(d)).toBe(40);
  });

  it("an earlier text clip wins over a later video", () => {
    const d = empty();
    d.tracks[0].clips = [video("c1", 60, 300)];
    d.tracks[1].clips = [text("x1", 30, 90)];
    expect(thumbnailFrame(d)).toBe(60);
  });

  it("an image counts as something that shows", () => {
    const d = empty();
    d.tracks[0].clips = [video("c1", 100, 300)];
    d.tracks.splice(1, 0, track("o1", "overlay", [video("i1", 40, 300, { type: "image", assetId: "i" })]));
    expect(thumbnailFrame(d)).toBe(70);
  });

  it("a tie goes to the first track", () => {
    expect(thumbnailFrame(sampleDoc())).toBe(15);
  });

  it("the frame always lies under the clip it picked", () => {
    for (let duration = 1; duration <= 200; duration++) {
      const d = empty();
      d.tracks[0].clips = [video("c1", 7, duration)];
      const f = thumbnailFrame(d);
      expect(7 <= f && f < 7 + duration, `duration ${duration} gave ${f}`).toBe(true);
    }
  });
});
