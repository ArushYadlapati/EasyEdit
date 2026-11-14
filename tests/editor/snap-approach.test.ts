import { describe, expect, it } from "vitest";
import { beginMove, beginTrim, resolveDrag, type DragInput } from "@/lib/editor/drag";
import { SNAP_PX, snap } from "@/lib/editor/snap";
import { sampleDoc, text } from "./fixtures";

// Zoom 2: the reach is 4 frames (SNAP_PX), and one second is 60 px wide.
const input = (over: Partial<DragInput>): DragInput => ({ frame: 0, rowTrackId: "t1", playhead: 500, zoom: 2, snapping: true, ...over });
const reach = SNAP_PX / 2;

// t1 holds x1 0-60 and x2 100-130, which starts and ends off whole seconds.
const docWithX2At = (start: number, duration = 30) => {
  const d = sampleDoc();
  d.tracks[1].clips = [text("x1", 0, 60), text("x2", start, duration)];
  return d;
};

describe("snapping only toward a target", () => {
  it("a clip whose start is on the playhead moves when dragged less than SNAP_PX either way", () => {
    const d = docWithX2At(100);
    const drag = beginMove(d, "x2", [], 110)!;
    const right = resolveDrag(d, drag, input({ frame: 110 + reach - 1, playhead: 100 }))!;
    expect(right).toMatchObject({ guide: null, ops: [{ op: "move_clip", clipId: "x2", start: 103 }] });
    const left = resolveDrag(d, drag, input({ frame: 110 - reach + 1, playhead: 100 }))!;
    expect(left).toMatchObject({ guide: null, ops: [{ op: "move_clip", clipId: "x2", start: 97 }] });
  });

  it("a clip whose start is a few frames from the playhead snaps onto it when dragged toward it", () => {
    const d = docWithX2At(100);
    const drag = beginMove(d, "x2", [], 110)!;
    expect(resolveDrag(d, drag, input({ frame: 113, playhead: 106 }))).toMatchObject({
      guide: 106,
      ops: [{ op: "move_clip", clipId: "x2", start: 106 }],
    });
    // With the playhead 2 frames ahead, a frame toward it snaps, a frame away from it does not.
    expect(resolveDrag(d, drag, input({ frame: 111, playhead: 102 }))).toMatchObject({ guide: 102, ops: [{ op: "move_clip", clipId: "x2", start: 102 }] });
    expect(resolveDrag(d, drag, input({ frame: 109, playhead: 102 }))).toMatchObject({ guide: null, ops: [{ op: "move_clip", clipId: "x2", start: 99 }] });
  });

  it("an edge on another clip's edge moves away freely", () => {
    // x2 starts on x1's end at 50; edges 60 and the whole seconds are out of reach.
    const d = docWithX2At(50);
    d.tracks[1].clips[0] = text("x1", 0, 50);
    const drag = beginMove(d, "x2", [], 60)!;
    expect(resolveDrag(d, drag, input({ frame: 62 }))).toMatchObject({ guide: null, ops: [{ op: "move_clip", clipId: "x2", start: 52 }] });
    expect(resolveDrag(d, drag, input({ frame: 58 }))).toMatchObject({ guide: null, ops: [{ op: "move_clip", clipId: "x2", start: 48 }] });
  });

  it("an edge snaps onto a target it approaches even when one it is leaving is nearer", () => {
    expect(snap([61], { edges: [60, 63], playhead: 500, fps: 30, zoom: 2 }, [60])).toEqual({ delta: 2, guide: 63 });
  });

  it("a trim of an end edge that starts on a whole second moves freely by a frame", () => {
    // x2 is 90-120 and ends on 4 s.
    const d = sampleDoc();
    const right = beginTrim(d, "x2", "end", 120)!;
    expect(resolveDrag(d, right, input({ frame: 121 }))).toMatchObject({ guide: null, ops: [{ op: "trim_clip", clipId: "x2", edge: "end", to: 121 }] });
    expect(resolveDrag(d, right, input({ frame: 119 }))).toMatchObject({ guide: null, ops: [{ op: "trim_clip", clipId: "x2", edge: "end", to: 119 }] });
    // Brought within reach of the next whole second, it still snaps there.
    expect(resolveDrag(d, right, input({ frame: 148 }))).toMatchObject({ guide: 150, ops: [{ op: "trim_clip", clipId: "x2", edge: "end", to: 150 }] });
  });

  it("a multi-clip move snaps by the grabbed clip only toward a target", () => {
    // x2's start is on the playhead at 100; c2, also moving, has no say.
    const d = docWithX2At(100);
    const drag = beginMove(d, "x2", ["c2", "x2"], 110)!;
    expect(resolveDrag(d, drag, input({ frame: 112, playhead: 100 }))).toMatchObject({
      guide: null,
      ops: [{ op: "move_clip", clipId: "x2", start: 102 }, { op: "move_clip", clipId: "c2", start: 32 }],
    });
  });

  it("a clip dragged to another track without moving sideways shows no guide", () => {
    const d = docWithX2At(100);
    d.tracks.push({ id: "t2", kind: "text", name: "Text 2", muted: false, hidden: false, locked: false, clips: [] });
    const drag = beginMove(d, "x2", [], 110)!;
    expect(resolveDrag(d, drag, input({ frame: 111, rowTrackId: "t2", playhead: 100 }))).toMatchObject({
      guide: null,
      ops: [{ op: "move_clip", clipId: "x2", start: 101, trackId: "t2" }],
    });
  });
});

describe("snapping without press positions, as a drop does", () => {
  const ctx = { edges: [0, 30, 60], playhead: 500, fps: 30, zoom: 2 };

  it("holds a candidate on a target it sits on and pulls one within reach", () => {
    expect(snap([60], ctx)).toEqual({ delta: 0, guide: 60 });
    expect(snap([62], ctx)).toEqual({ delta: -2, guide: 60 });
    expect(snap([500], ctx)).toEqual({ delta: 0, guide: 500 });
    expect(snap([75], ctx)).toBeNull();
  });

  it("with press positions, a candidate still where it was pressed does not snap", () => {
    expect(snap([60], ctx, [60])).toBeNull();
    expect(snap([62], ctx, [60])).toBeNull();
    expect(snap([62], ctx, [70])).toEqual({ delta: -2, guide: 60 });
  });
});
