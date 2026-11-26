import { describe, expect, it } from "vitest";
import { findClip } from "@/lib/editor/store";
import { packMoves } from "@/lib/media/steady";
import { drawFrame, type ResolvedSource } from "@/lib/render/compositor";
import { applyOps, describe as describeDoc, prepareOps, DEFAULT_TRANSFORM, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx } from "../render/fake-ctx";

const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const c1 = (d: TimelineDoc) => findClip(d, "c1")!.clip as MediaClip;
// Three frames of moves, from the file's frame 10 on.
const STEADY = { from: 10, zoom: 1.1, data: packMoves([{ dx: 0.01, dy: 0 }, { dx: -0.02, dy: 0.005 }, { dx: 0, dy: 0 }]) };
const patch = (clipId: string, steady: unknown): OpInput[] => [{ op: "update_clip", clipId, patch: { steady } as never }];

describe("a clip's steadying in the ops", () => {
  it("is one value on a video: set whole, undone to none, and listed in a word", () => {
    const set = run(sampleDoc(), patch("c1", STEADY));
    expect(c1(set.doc).steady).toEqual(STEADY);
    expect(c1(applyOps(set.doc, JSON.parse(JSON.stringify(set.inverse))).doc).steady).toBeNull();
    expect(describeDoc(set.doc, { detail: true })).toContain("steady(zoom 1.1)");
    expect(describeDoc(sampleDoc(), { detail: true })).not.toContain("steady(");
  });
  it("holds whole frames of moves, no more than a clip may, and only a video takes it", () => {
    expect(() => run(sampleDoc(), patch("c1", { ...STEADY, data: "AAAA" }))).toThrow(/steady is invalid/);
    expect(() => run(sampleDoc(), patch("c1", { ...STEADY, data: "not base64!!" }))).toThrow(/steady is invalid/);
    expect(() => run(sampleDoc(), patch("c1", { ...STEADY, zoom: 2 }))).toThrow();
    expect(() => run(sampleDoc(), patch("c1", { ...STEADY, extra: 1 }))).toThrow();
    expect(() => run(sampleDoc(), patch("x1", STEADY))).toThrow(/"steady" is not allowed on a text clip/);
    const d = sampleDoc();
    d.tracks[3].clips = [video("m1", 0, 30, { type: "audio" })];
    expect(() => run(d, patch("m1", STEADY))).toThrow(/"steady" is not allowed on an audio clip/);
    const still = sampleDoc();
    (still.tracks[0].clips[0] as MediaClip).type = "image";
    expect(() => run(still, patch("c1", STEADY))).toThrow(/"steady" is not allowed on an image clip/);
  });
  it("goes with both halves of a split clip, which read it by the file's frame", () => {
    const set = run(sampleDoc(), patch("c1", STEADY)).doc;
    const cut = run(set, [{ op: "split_clip", clipId: "c1", at: 12, newClipId: "c9" }]).doc;
    expect((findClip(cut, "c9")!.clip as MediaClip).steady).toEqual(STEADY);
  });
});

describe("drawing a steadied video", () => {
  const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 1920, height: 1080 };
  function draw(frame: number, extra: Record<string, unknown> = {}) {
    const d = docWithCaptions("long_16x9");
    d.tracks[0].clips = [video("c", 0, 60, { in: 10, steady: STEADY, ...extra })];
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, d, frame, { resolveSource: () => PICTURE, finish: null });
    // What is done between the clip being placed and its picture being drawn.
    const from = calls.findIndex(([name]) => name === "scale");
    const to = calls.findIndex(([name]) => name === "drawImage");
    return calls.slice(from + 1, to + 1);
  }
  it("keeps to the picture's own box, moves the picture by that frame's share of the shake, and draws it larger", () => {
    // The clip's first frame shows the file's frame 10: the first move, a hundredth of the width to the right.
    expect(draw(0)).toEqual([
      ["beginPath"], ["rect", -960, -540, 1920, 1080], ["clip"],
      ["translate", 0.01 * 1920, 0],
      ["scale", 1.1, 1.1],
      ["drawImage", PICTURE.image, -960, -540, 1920, 1080],
    ]);
    const second = draw(1);
    expect(second[3][1]).toBeCloseTo(-0.02 * 1920, 6);
    expect(second[3][2]).toBeCloseTo(0.005 * 1080, 6);
  });
  it("past its last move, only draws it larger; and reads by the file's frame at any speed", () => {
    expect(draw(5).slice(3, 5)).toEqual([["translate", 0, 0], ["scale", 1.1, 1.1]]);
    // At twice the speed the clip's second frame shows the file's frame 12: the third move.
    expect(draw(1, { speed: 2 })[3]).toEqual(["translate", 0, 0]);
    expect(draw(1, { speed: 1, in: 9 })[3]).toEqual(["translate", 0.01 * 1920, 0]);
  });
  it("leaves a video with none as it was", () => {
    expect(draw(0, { steady: null })).toEqual([["drawImage", PICTURE.image, -960, -540, 1920, 1080]]);
    expect(draw(0, { steady: undefined, transform: { ...DEFAULT_TRANSFORM } })).toHaveLength(1);
  });
});
