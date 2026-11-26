import { describe, expect, it } from "vitest";
import { FOLLOW_MAX_SECONDS, followOps, followPlan, frameToPicture, pictureToFrame } from "@/lib/editor/follow";
import { applyOps, prepareOps, DEFAULT_TRANSFORM, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { text, video } from "./fixtures";
import { docWithCaptions } from "../helpers/docs";

type Video = MediaClip & { type: "video" };
const HD = { width: 1920, height: 1080 };
const sizeOf = () => HD;
// A 16:9 project: v1 [c1 0–300], and on the text track x1 60–180 a third of the way across and down.
function doc(change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = docWithCaptions("long_16x9");
  d.tracks[0].clips = [video("c1", 0, 300)];
  d.tracks[1].clips = [text("x1", 60, 120, { transform: { ...DEFAULT_TRANSFORM, x: 0.3, y: 0.4 } })];
  change(d);
  return d;
}
const c1 = (d: TimelineDoc) => d.tracks[0].clips[0] as Video;

describe("a place in a video's picture and on the frame", () => {
  it("are the same shares when the picture fills the frame", () => {
    expect(frameToPicture(doc(), c1(doc()), HD, 0.3, 0.4)).toEqual({ u: 0.3, v: 0.4 });
    expect(pictureToFrame(doc(), c1(doc()), HD, 0.3, 0.4)).toEqual({ x: 0.3, y: 0.4 });
  });
  it("follow the picture when it is moved and made smaller, and come back the way they went", () => {
    const small = doc((d) => void (d.tracks[0].clips[0].transform = { ...DEFAULT_TRANSFORM, x: 0.75, y: 0.25, scale: 0.5 }));
    // Half size, centred three quarters across: its left edge is half way across the frame.
    expect(pictureToFrame(small, c1(small), HD, 0, 0.5)).toEqual({ x: 0.5, y: 0.25 });
    expect(pictureToFrame(small, c1(small), HD, 1, 1)).toEqual({ x: 1, y: 0.5 });
    const there = pictureToFrame(small, c1(small), HD, 0.2, 0.9);
    const back = frameToPicture(small, c1(small), HD, there.x, there.y);
    expect([back.u, back.v].map((n) => Number(n.toFixed(6)))).toEqual([0.2, 0.9]);
  });
  it("count a taller picture's whole height, where it covers a wide frame", () => {
    // A square picture covering a 16:9 frame is as wide as the frame and taller: its top is above the frame's.
    const square = { width: 1000, height: 1000 };
    expect(pictureToFrame(doc(), c1(doc()), square, 0.5, 0)).toMatchObject({ x: 0.5 });
    expect(pictureToFrame(doc(), c1(doc()), square, 0.5, 0).y).toBeLessThan(0);
  });
});

describe("what following comes to", () => {
  it("is the video under the clip at the playhead, where the clip's middle is in its picture, for as long as both last", () => {
    const plan = followPlan(doc(), "x1", 90, sizeOf);
    expect(plan).toMatchObject({ ok: true, from: 60, to: 180, at: 90, u: 0.3, v: 0.4 });
    expect(plan.ok && [plan.video.id, plan.follower.id]).toEqual(["c1", "x1"]);
    // A video that ends sooner ends the stretch.
    const short = followPlan(doc((d) => void (d.tracks[0].clips[0].duration = 120)), "x1", 90, sizeOf);
    expect(short).toMatchObject({ from: 60, to: 120 });
  });
  it("takes the nearest video under it, and one over it only when there is none under", () => {
    const two = doc((d) => {
      d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [video("c2", 0, 300)] });
    });
    expect(followPlan(two, "x1", 90, sizeOf)).toMatchObject({ video: { id: "c2" } });
    // The overlay's picture is small and elsewhere: the clip's middle is not in it, so the video under that is taken.
    two.tracks[1].clips[0].transform = { ...DEFAULT_TRANSFORM, x: 0.85, y: 0.85, scale: 0.2 };
    expect(followPlan(two, "x1", 90, sizeOf)).toMatchObject({ video: { id: "c1" } });
    two.tracks[1].hidden = true;
    two.tracks[1].clips[0].transform = { ...DEFAULT_TRANSFORM };
    expect(followPlan(two, "x1", 90, sizeOf)).toMatchObject({ video: { id: "c1" } });
  });
  it("uses the clip's place at the playhead when it already moves", () => {
    const moving = doc((d) => void ((d.tracks[1].clips[0] as { keyframes?: unknown }).keyframes = { x: [{ at: 0, value: 0.2 }, { at: 100, value: 0.7 }] }));
    const plan = followPlan(moving, "x1", 110, sizeOf);
    expect(plan.ok && plan.u).toBeCloseTo(0.45, 6); // half way along
  });
  it("is refused for a clip that cannot follow, with nothing to follow, or over a video that turns or moves", () => {
    expect(followPlan(doc(), "c1", 90, sizeOf)).toEqual({ ok: false, why: "not-a-follower" });
    expect(followPlan(doc(), "gone", 90, sizeOf)).toEqual({ ok: false, why: "not-a-follower" });
    expect(followPlan(doc(), "x1", 10, sizeOf)).toEqual({ ok: false, why: "not-a-follower" }); // the playhead is not on it
    expect(followPlan(doc((d) => void (d.tracks[1].locked = true)), "x1", 90, sizeOf)).toEqual({ ok: false, why: "locked" });
    expect(followPlan(doc((d) => void (d.tracks[0].clips = [])), "x1", 90, sizeOf)).toEqual({ ok: false, why: "no-video" });
    expect(followPlan(doc((d) => void ((d.tracks[0].clips[0] as MediaClip).speed = -1)), "x1", 90, sizeOf)).toEqual({ ok: false, why: "no-video" });
    expect(followPlan(doc((d) => void (d.tracks[0].clips[0].transform.rotation = 10)), "x1", 90, sizeOf)).toEqual({ ok: false, why: "turned" });
    expect(followPlan(doc((d) => void ((d.tracks[0].clips[0] as { keyframes?: unknown }).keyframes = { scale: [{ at: 0, value: 1 }, { at: 30, value: 2 }] })), "x1", 90, sizeOf)).toEqual({ ok: false, why: "turned" });
    const long = doc((d) => {
      d.tracks[0].clips[0].duration = 2000;
      d.tracks[1].clips[0].duration = FOLLOW_MAX_SECONDS * 30 + 1;
    });
    expect(followPlan(long, "x1", 90, sizeOf)).toEqual({ ok: false, why: "too-long" });
  });
});

describe("the edit that makes a clip follow", () => {
  const x1 = { id: "x1", start: 60, duration: 120 };
  it("gives it x and y keyframes counted from its own start, only where the path turns", () => {
    // Straight across for 60 frames, then straight down for 59.
    const found = Array.from({ length: 120 }, (_, i) => ({ frame: 60 + i, x: i <= 60 ? 0.2 + i * 0.005 : 0.5, y: i <= 60 ? 0.4 : 0.4 + (i - 60) * 0.005 }));
    const [op] = followOps(x1, found);
    const keys = (op as unknown as { patch: { keyframes: { x: { at: number; value: number }[]; y: { at: number; value: number }[] } } }).patch.keyframes;
    // Its ends as found, and the corner at frame 60, rounded a little by the evening-out: a keyframe just each side of it.
    expect([keys.x[0], keys.x.at(-1), keys.y[0], keys.y.at(-1)]).toEqual([{ at: 0, value: 0.2 }, { at: 119, value: 0.5 }, { at: 0, value: 0.4 }, { at: 119, value: 0.695 }]);
    expect(keys.x.length).toBeLessThanOrEqual(5);
    expect(keys.x.slice(1, -1).every((k) => Math.abs(k.at - 60) <= 3)).toBe(true);
    expect(keys.x.map((k) => k.at)).toEqual(keys.y.map((k) => k.at));
    const d = doc();
    const after = applyOps(d, prepareOps([op])).doc;
    expect((after.tracks[1].clips[0] as { keyframes: { x: unknown[] } }).keyframes.x).toHaveLength(keys.x.length);
  });
  it("counts a frame once, leaves out frames the clip is not on, and never gives more keyframes than a clip may hold", () => {
    const twice = followOps(x1, [{ frame: 60, x: 0.1, y: 0.1 }, { frame: 60.2, x: 0.9, y: 0.9 }, { frame: 100, x: 0.3, y: 0.2 }, { frame: 20, x: 0, y: 0 }, { frame: 180, x: 1, y: 1 }]);
    expect((twice[0] as unknown as { patch: { keyframes: { x: unknown[] } } }).patch.keyframes.x).toEqual([{ at: 0, value: 0.1 }, { at: 40, value: 0.3 }]);
    const wild = Array.from({ length: 900 }, (_, i) => ({ frame: i, x: 0.5 + 0.4 * Math.sin(i * 1.3), y: 0.5 + 0.4 * Math.cos(i * 2.1) }));
    const many = followOps({ id: "x1", start: 0, duration: 900 }, wild);
    expect((many[0] as unknown as { patch: { keyframes: { x: unknown[] } } }).patch.keyframes.x.length).toBeLessThanOrEqual(100);
  });
  it("is nothing with fewer than two frames to go by", () => {
    expect(followOps(x1, [])).toEqual([]);
    expect(followOps(x1, [{ frame: 70, x: 0.5, y: 0.5 }])).toEqual([]);
  });
});
