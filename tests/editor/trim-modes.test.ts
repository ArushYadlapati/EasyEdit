import { describe, expect, it } from "vitest";
import { createClipboard } from "@/lib/editor/clipboard";
import { TRIM_MODES, TRIM_MODE_LABEL, beginTrim, resolveDrag, type DragInput, type TrimMode } from "@/lib/editor/drag";
import { clipFieldOps, clipFieldValue, fieldContext, slipRange } from "@/lib/editor/inspector-fields";
import { runCommand } from "@/lib/editor/run-command";
import { findClip } from "@/lib/editor/store";
import { applyOps, prepareOps, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, video } from "./fixtures";

// v1 holds three clips of one file, end to end: c1 0–30 (file 30–60), c2 30–60 (file 100–130) and c3 60–90, then a
// gap, then c4 at 120–150.
function row(): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("c1", 0, 30, { in: 30 }), video("c2", 30, 30, { in: 100 }), video("c3", 60, 30), video("c4", 120, 30)];
  return d;
}
const L = 300; // the file's length in frames
const at = (mode: TrimMode, frame: number): DragInput => ({ frame, rowTrackId: "v1", playhead: 999, zoom: 2, snapping: false, trimMode: mode });
const drag = (d: TimelineDoc, clipId: string, edge: "start" | "end") => {
  const clip = findClip(d, clipId)!.clip;
  return beginTrim(d, clipId, edge, edge === "start" ? clip.start : clip.start + clip.duration, () => L)!;
};
const after = (d: TimelineDoc, clipId: string, edge: "start" | "end", mode: TrimMode, frame: number) => {
  const result = resolveDrag(d, drag(d, clipId, edge), at(mode, frame))!;
  const applied = applyOps(d, prepareOps(result.ops));
  return { result, doc: applied.doc, inverse: applied.inverse };
};
const places = (d: TimelineDoc) => d.tracks[0].clips.map((c) => [c.id, c.start, c.duration, (c as MediaClip).in]);

describe("a plain trim", () => {
  it("is what a drag does unless told otherwise, and leaves the neighbours alone", () => {
    const { result, doc } = after(row(), "c2", "end", "trim", 50);
    expect(result.label).toBe("trim");
    expect(places(doc)).toEqual([["c1", 0, 30, 30], ["c2", 30, 20, 100], ["c3", 60, 30, 0], ["c4", 120, 30, 0]]);
    expect(resolveDrag(row(), drag(row(), "c2", "end"), { ...at("trim", 50), trimMode: undefined })!.ops).toEqual(result.ops);
  });
});

describe("a ripple trim", () => {
  it("at a clip's end takes every later clip with it, the gap after them too", () => {
    const shorter = after(row(), "c2", "end", "ripple", 50);
    expect(shorter.result.label).toBe("ripple trim");
    expect(places(shorter.doc)).toEqual([["c1", 0, 30, 30], ["c2", 30, 20, 100], ["c3", 50, 30, 0], ["c4", 110, 30, 0]]);
    expect(applyOps(shorter.doc, shorter.inverse).doc).toEqual(row());
    const longer = after(row(), "c2", "end", "ripple", 75);
    expect(places(longer.doc)).toEqual([["c1", 0, 30, 30], ["c2", 30, 45, 100], ["c3", 75, 30, 0], ["c4", 135, 30, 0]]);
    expect(applyOps(longer.doc, longer.inverse).doc).toEqual(row());
  });

  it("at a clip's start keeps the clip where it is and closes up, or makes room, after it", () => {
    // Ten frames off c2's head: it now starts on frame 110 of its file, and everything after moves ten frames earlier.
    const shorter = after(row(), "c2", "start", "ripple", 40);
    expect(places(shorter.doc)).toEqual([["c1", 0, 30, 30], ["c2", 30, 20, 110], ["c3", 50, 30, 0], ["c4", 110, 30, 0]]);
    expect(shorter.result.ghost).toEqual([{ clipId: "c2", trackId: "v1", start: 30, duration: 20 }]);
    expect(applyOps(shorter.doc, shorter.inverse).doc).toEqual(row());
    // Ten frames back onto its head, though c1 sits right before it: c2 stays put and grows.
    const longer = after(row(), "c2", "start", "ripple", 20);
    expect(places(longer.doc)).toEqual([["c1", 0, 30, 30], ["c2", 30, 40, 90], ["c3", 70, 30, 0], ["c4", 130, 30, 0]]);
    expect(applyOps(longer.doc, longer.inverse).doc).toEqual(row());
  });

  it("stops where the clip's footage does", () => {
    // c1 starts 30 frames into its file: its head can take 30 frames back, no more.
    const { doc } = after(row(), "c1", "start", "ripple", -500);
    expect(places(doc)[0]).toEqual(["c1", 0, 60, 0]);
  });

  it("with nothing dragged changes nothing", () => {
    expect(resolveDrag(row(), drag(row(), "c2", "end"), at("ripple", 60))!.ops).toEqual([]);
  });
});

describe("a roll", () => {
  it("moves the cut between two clips that touch, and nothing else", () => {
    const later = after(row(), "c1", "end", "roll", 40);
    expect(later.result.label).toBe("roll");
    // c1 plays ten frames more; c2 starts ten frames later, on the frame of its file it showed there before.
    expect(places(later.doc)).toEqual([["c1", 0, 40, 30], ["c2", 40, 20, 110], ["c3", 60, 30, 0], ["c4", 120, 30, 0]]);
    expect(applyOps(later.doc, later.inverse).doc).toEqual(row());
    const earlier = after(row(), "c2", "start", "roll", 20);
    expect(places(earlier.doc)).toEqual([["c1", 0, 20, 30], ["c2", 20, 40, 90], ["c3", 60, 30, 0], ["c4", 120, 30, 0]]);
    expect(applyOps(earlier.doc, earlier.inverse).doc).toEqual(row());
  });

  it("leaves the clip that gives way a frame", () => {
    expect(places(after(row(), "c1", "end", "roll", 500).doc).slice(0, 2)).toEqual([["c1", 0, 59, 30], ["c2", 59, 1, 129]]);
    expect(places(after(row(), "c2", "start", "roll", -500).doc).slice(0, 2)).toEqual([["c1", 0, 1, 30], ["c2", 1, 59, 71]]);
  });

  it("is a plain trim where no clip touches the edge", () => {
    const { result, doc } = after(row(), "c3", "end", "roll", 100);
    expect(result.label).toBe("trim");
    expect(places(doc)[2]).toEqual(["c3", 60, 40, 0]);
  });
});

describe("the trim mode", () => {
  it("is Trim when the editor opens, and one key steps through the three", () => {
    const store = makeStore();
    const ctx = { store, clipboard: createClipboard(), openShortcuts: () => {} };
    expect(TRIM_MODES).toEqual(["trim", "ripple", "roll"]);
    expect(TRIM_MODES.map((mode) => TRIM_MODE_LABEL[mode])).toEqual(["Trim", "Ripple trim", "Roll"]);
    const seen = [store.getState().trimMode];
    for (let i = 0; i < 3; i++) {
      runCommand("next-trim-mode", ctx);
      seen.push(store.getState().trimMode);
    }
    expect(seen).toEqual(["trim", "ripple", "roll", "trim"]);
  });

  it("is an editor's: a viewer's key does nothing", () => {
    const store = makeStore({ canEdit: false });
    runCommand("next-trim-mode", { store, clipboard: createClipboard(), openShortcuts: () => {} });
    expect(store.getState().trimMode).toBe("trim");
  });
});

describe("slipping a clip", () => {
  const c2 = (d: TimelineDoc) => findClip(d, "c2")!.clip as MediaClip;
  it("shows where in its file the clip starts, in seconds", () => {
    const d = row();
    expect(clipFieldValue(c2(d), "sourceIn", fieldContext(d, c2(d)))).toBe("3.33");
    expect(clipFieldValue(d.tracks[1].clips[0], "sourceIn", fieldContext(d, d.tracks[1].clips[0]))).toBe("");
  });

  it("starts it from another moment, keeping its place and length", () => {
    const d = row();
    const ops = clipFieldOps(c2(d), "sourceIn", "5", fieldContext(d, c2(d)), L)!;
    expect(ops).toEqual([{ op: "update_clip", clipId: "c2", patch: { in: 150 } }]);
    expect(places(applyOps(d, prepareOps(ops)).doc)[1]).toEqual(["c2", 30, 30, 150]);
    expect(clipFieldOps(c2(d), "sourceIn", "3.33", fieldContext(d, c2(d)), L)).toEqual([]);
    expect(clipFieldOps(c2(d), "sourceIn", "-1", fieldContext(d, c2(d)), L)).toBeNull();
    expect(clipFieldOps(c2(d), "sourceIn", "soon", fieldContext(d, c2(d)), L)).toBeNull();
  });

  it("never past where the clip would run out of footage", () => {
    const d = row();
    expect(clipFieldOps(c2(d), "sourceIn", "60", fieldContext(d, c2(d)), L)).toEqual([{ op: "update_clip", clipId: "c2", patch: { in: 270 } }]);
    expect(slipRange(c2(d), L)).toEqual({ min: 0, max: 270 });
    expect(slipRange({ ...c2(d), speed: 2 }, L)).toEqual({ min: 0, max: 240 });
    expect(slipRange({ ...c2(d), speed: -1 }, L)).toEqual({ min: 29, max: 299 });
    expect(slipRange({ ...c2(d), speed: 0 }, L)).toEqual({ min: 0, max: 299 });
    expect(slipRange(c2(d))).toEqual({ min: 0, max: Infinity });
  });
});
