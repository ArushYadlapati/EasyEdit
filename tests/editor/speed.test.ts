import { describe, expect, it } from "vitest";
import { createClipboard } from "@/lib/editor/clipboard";
import { clipMarks } from "@/lib/editor/clip-marks";
import { clipFieldOps, clipFieldValue, fieldContext } from "@/lib/editor/inspector-fields";
import { mediaWants } from "@/lib/editor/media-plan";
import { clipMenu } from "@/lib/editor/menus";
import { MESSAGES } from "@/lib/editor/messages";
import { runCommand } from "@/lib/editor/run-command";
import { separateAudioOps } from "@/lib/editor/sound";
import { FREEZE_SECONDS, freezeFrameOps, rateLabel, reverseOps, roomAfter, speedBadge, speedOps } from "@/lib/editor/speed";
import { findClip } from "@/lib/editor/store";
import { clipSound } from "@/lib/render/clip-sound";
import { applyOps, fitsMedia, prepareOps, sourceRange, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "./fixtures";

// The sample project: v1 holds c1 (frames 0 to 30) and c2 (30 to 60), both from frame 0 of a 300-frame file.
const L = 300;
const clipOf = (d: TimelineDoc, id: string) => findClip(d, id)!.clip as MediaClip;
const apply = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const ids = () => {
  let n = 0;
  return () => `n${++n}`;
};
// v1 holds one clip c1, from `in` of the file, with nothing after it.
function alone(extra: Record<string, unknown> = {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("c1", 0, 60, extra)];
  return d;
}
const ctx = (store: ReturnType<typeof makeStore>) => ({ store, clipboard: createClipboard(), openShortcuts: () => {} });

describe("setting a clip's speed", () => {
  it("keeps its footage, so twice as fast is half as long", () => {
    const d = alone({ in: 30 });
    const ops = speedOps(clipOf(d, "c1"), 2, Infinity, L)!;
    const after = apply(d, ops);
    expect(clipOf(after.doc, "c1")).toMatchObject({ speed: 2, duration: 30, in: 30 });
    expect(sourceRange(clipOf(after.doc, "c1"))).toEqual(sourceRange(clipOf(d, "c1")));
    expect(applyOps(after.doc, after.inverse).doc).toEqual(d);
  });

  it("half as fast is twice as long, when there is room and footage", () => {
    const d = alone();
    const after = apply(d, speedOps(clipOf(d, "c1"), 0.5, Infinity, L)!);
    expect(clipOf(after.doc, "c1")).toMatchObject({ speed: 0.5, duration: 120 });
    expect(applyOps(after.doc, after.inverse).doc).toEqual(d);
  });

  it("stops at the clip after it, showing less footage", () => {
    const d = sampleDoc(); // c2 starts where c1 ends
    const c1 = clipOf(d, "c1");
    expect(roomAfter(d.tracks[0], c1)).toBe(30);
    const after = apply(d, speedOps(c1, 0.5, roomAfter(d.tracks[0], c1), L)!);
    expect(clipOf(after.doc, "c1")).toMatchObject({ speed: 0.5, duration: 30 });
    expect(roomAfter(d.tracks[0], clipOf(d, "c2"))).toBe(Infinity);
  });

  it("keeps a clip that plays backward playing backward, inside its file", () => {
    const d = alone({ in: 59, speed: -1 });
    const faster = apply(d, speedOps(clipOf(d, "c1"), 2, Infinity, L)!);
    expect(clipOf(faster.doc, "c1")).toMatchObject({ speed: -2, duration: 30, in: 59 });
    expect(applyOps(faster.doc, faster.inverse).doc).toEqual(d);
    // Slower would need 120 frames, but only 60 frames of file lie behind frame 59.
    const slower = apply(d, speedOps(clipOf(d, "c1"), 0.5, Infinity, L)!);
    expect(clipOf(slower.doc, "c1")).toMatchObject({ speed: -0.5, duration: 120 });
    expect(fitsMedia(clipOf(slower.doc, "c1"), L)).toBe(true);
    expect(applyOps(slower.doc, slower.inverse).doc).toEqual(d);
  });

  it("stays between a tenth and sixteen times, on hundredths", () => {
    const c1 = clipOf(alone(), "c1");
    const speedIn = (ops: OpInput[] | null) => ops!.flatMap((op) => (op.op === "update_clip" ? [op.patch.speed] : []))[0];
    expect(speedIn(speedOps(c1, 99, Infinity, 100_000))).toBe(16);
    expect(speedIn(speedOps(c1, 0.001, Infinity, 100_000))).toBe(0.1);
    expect(speedIn(speedOps(c1, 1.234, Infinity, 100_000))).toBe(1.23);
    expect(speedOps(c1, 1, Infinity, L)).toEqual([]);
    expect(speedOps(c1, NaN, Infinity, L)).toBeNull();
    expect(speedOps(video("i", 0, 30, { type: "image" }) as MediaClip, 2, Infinity)).toBeNull();
  });

  it("gives a held frame a speed without changing its length", () => {
    const d = alone({ in: 10, speed: 0 });
    const after = apply(d, speedOps(clipOf(d, "c1"), 1, Infinity, L)!);
    expect(clipOf(after.doc, "c1")).toMatchObject({ speed: 1, duration: 60, in: 10 });
  });

  it("says the rate in words", () => {
    expect([rateLabel(1), rateLabel(2), rateLabel(0.5), rateLabel(0.25), rateLabel(1.5), rateLabel(0)]).toEqual([
      "Normal speed", "2× faster", "2× slower", "4× slower", "1.5× faster", "Holds one frame",
    ]);
    expect([speedBadge(2), speedBadge(0.5), speedBadge(-1), speedBadge(-2), speedBadge(0)]).toEqual(["2×", "0.5×", "Reverse", "Reverse 2×", "Hold"]);
  });
});

describe("the Speed field", () => {
  it("shows percent of as recorded, whichever way the clip plays", () => {
    const d = alone({ in: 59, speed: -1.5 });
    expect(clipFieldValue(clipOf(d, "c1"), "speed", fieldContext(d, clipOf(d, "c1")))).toBe("150");
    expect(clipFieldValue(d.tracks[1].clips[0], "speed", fieldContext(d, d.tracks[1].clips[0]))).toBe("");
  });
  it("sets the speed and the length together, up to the next clip", () => {
    const d = sampleDoc();
    const c1 = clipOf(d, "c1");
    const after = apply(d, clipFieldOps(c1, "speed", "200", fieldContext(d, c1), L)!);
    expect(clipOf(after.doc, "c1")).toMatchObject({ speed: 2, duration: 15 });
    const slowed = apply(d, clipFieldOps(c1, "speed", "50", fieldContext(d, c1), L)!);
    expect(clipOf(slowed.doc, "c1")).toMatchObject({ speed: 0.5, duration: 30 });
    expect(clipFieldOps(c1, "speed", "fast", fieldContext(d, c1), L)).toBeNull();
    expect(clipFieldOps(c1, "speed", "100", fieldContext(d, c1), L)).toEqual([]);
  });
});

describe("Reverse", () => {
  it("turns each selected video round and back, leaving held frames and locked tracks", () => {
    const d = sampleDoc();
    d.tracks[0].clips.push(video("h1", 60, 30, { speed: 0, in: 5 }));
    const after = apply(d, reverseOps(d, ["c1", "h1", "x1"]));
    expect(clipOf(after.doc, "c1")).toMatchObject({ speed: -1, in: 29 });
    expect(clipOf(after.doc, "h1").speed).toBe(0);
    expect(clipOf(apply(after.doc, reverseOps(after.doc, ["c1"])).doc, "c1")).toMatchObject({ speed: 1, in: 0 });
    d.tracks[0].locked = true;
    expect(reverseOps(d, ["c1"])).toEqual([]);
  });

  it("runs from its key and the clip menu, and says so with nothing to turn", () => {
    const store = makeStore();
    const notices = noticesOf(store);
    store.getState().select(["x1"]);
    runCommand("reverse-clip", ctx(store));
    expect(notices).toEqual([MESSAGES.nothingToReverse]);
    store.getState().select(["c1"]);
    expect(clipMenu(store.getState()).find((e) => e.id === "reverse-clip")).toMatchObject({ label: "Reverse", disabled: false });
    runCommand("reverse-clip", ctx(store));
    expect(clipOf(store.getState().doc, "c1").speed).toBe(-1);
    expect(clipMenu(store.getState()).find((e) => e.id === "reverse-clip")!.label).toBe("Play forward");
    store.getState().undo();
    expect(clipOf(store.getState().doc, "c1")).toMatchObject({ speed: 1, in: 0 });
  });

  it("is not offered for clips with no video among them", () => {
    const store = makeStore();
    store.getState().select(["x1"]);
    expect(clipMenu(store.getState()).some((e) => e.id === "reverse-clip" || e.id === "freeze-frame")).toBe(false);
  });
});

describe("Freeze frame", () => {
  it("cuts the clip at the playhead and holds that frame for two seconds, pushing the rest later", () => {
    const d = sampleDoc();
    const frozen = freezeFrameOps(d, ["c1"], 10, ids());
    if (!frozen.ok) throw new Error("not frozen");
    const after = apply(d, frozen.ops);
    const hold = FREEZE_SECONDS * d.fps;
    expect(after.doc.tracks[0].clips.map((c) => [c.id, c.start, c.duration])).toEqual([
      ["c1", 0, 10], [frozen.clipId, 10, hold], ["n2", 10 + hold, 20], ["c2", 30 + hold, 30],
    ]);
    expect(clipOf(after.doc, frozen.clipId)).toMatchObject({ type: "video", assetId: "a", in: 10, speed: 0 });
    expect(clipOf(after.doc, "n2").in).toBe(10);
    expect(applyOps(after.doc, after.inverse).doc).toEqual(d);
  });

  it("holds the frame the clip shows there at its own speed and way round", () => {
    const fast = alone({ in: 20, speed: 2 });
    const a = freezeFrameOps(fast, ["c1"], 15, ids());
    expect(a.ok && clipOf(apply(fast, a.ops).doc, a.clipId).in).toBe(50);
    const backward = alone({ in: 59, speed: -1 });
    const b = freezeFrameOps(backward, ["c1"], 15, ids());
    expect(b.ok && clipOf(apply(backward, b.ops).doc, b.clipId).in).toBe(44);
  });

  it("at a clip's first frame puts the hold before it, with no cut", () => {
    const d = sampleDoc();
    const frozen = freezeFrameOps(d, ["c2"], 30, ids());
    if (!frozen.ok) throw new Error("not frozen");
    expect(frozen.ops.map((op) => op.op)).toEqual(["add_clip"]);
    const after = apply(d, frozen.ops).doc;
    expect(after.tracks[0].clips.map((c) => c.id)).toEqual(["c1", frozen.clipId, "c2"]);
  });

  it("keeps the look the clip has on that frame, keyframes counted in", () => {
    const d = alone({ keyframes: { opacity: [{ at: 0, value: 0 }, { at: 20, value: 1 }] } });
    const frozen = freezeFrameOps(d, ["c1"], 10, ids());
    expect(frozen.ok && clipOf(apply(d, frozen.ops).doc, frozen.clipId).transform.opacity).toBeCloseTo(0.5);
  });

  it("needs a selected video under the playhead on an unlocked track", () => {
    const d = sampleDoc();
    expect(freezeFrameOps(d, ["c1"], 30, ids()).ok).toBe(false); // the playhead is on c2
    expect(freezeFrameOps(d, ["x1"], 10, ids()).ok).toBe(false);
    expect(freezeFrameOps(d, [], 10, ids()).ok).toBe(false);
    expect(freezeFrameOps(alone({ speed: 0 }), ["c1"], 10, ids()).ok).toBe(false);
    d.tracks[0].locked = true;
    expect(freezeFrameOps(d, ["c1"], 10, ids()).ok).toBe(false);
  });

  it("runs from its key, selects the held clip and undoes in one step", () => {
    const store = makeStore();
    const notices = noticesOf(store);
    runCommand("freeze-frame", ctx(store));
    expect(notices).toEqual([MESSAGES.nothingToFreeze]);
    store.getState().select(["c1"]);
    store.getState().seek(10);
    expect(clipMenu(store.getState()).find((e) => e.id === "freeze-frame")).toMatchObject({ label: "Freeze frame", disabled: false });
    runCommand("freeze-frame", ctx(store));
    const [heldId] = store.getState().selection.clipIds;
    expect(clipOf(store.getState().doc, heldId)).toMatchObject({ speed: 0, start: 10 });
    store.getState().undo();
    expect(store.getState().doc.tracks[0].clips.map((c) => c.id)).toEqual(["c1", "c2"]);
    store.getState().select(["c1"]);
    store.getState().seek(45); // on c2, which is not selected
    expect(clipMenu(store.getState()).find((e) => e.id === "freeze-frame")!.disabled).toBe(true);
  });
});

describe("a clip that plays backward or holds", () => {
  const d = alone({ in: 59, speed: -1 });
  const held = alone({ in: 10, speed: 0 });
  it("is silent in the preview and the export, and is moved to each frame", () => {
    for (const doc of [d, held]) {
      expect(clipSound(doc.tracks[0], clipOf(doc, "c1"))).toBeNull();
      expect(mediaWants(doc, 5, { playing: true, rate: 1 })[0]).toMatchObject({ rate: 0, volume: 0 });
    }
    expect(mediaWants(d, 5, { playing: true, rate: 1 })[0].seconds).toBeCloseTo(54 / 30);
    expect(mediaWants(held, 5, { playing: true, rate: 1 })[0].seconds).toBeCloseTo(10 / 30);
  });
  it("has no sound to separate", () => {
    expect(separateAudioOps(d, ["c1"], ids())).toEqual({ ok: false, why: "nothing" });
  });
  it("says so on the timeline", () => {
    expect(clipMarks(d.tracks[0], clipOf(d, "c1")).speed).toBe(-1);
    expect(clipMarks(held.tracks[0], clipOf(held, "c1")).speed).toBe(0);
    expect(clipMarks(alone().tracks[0], clipOf(alone(), "c1")).speed).toBeNull();
  });
});
