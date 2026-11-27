import { describe, expect, it } from "vitest";
import { rampSelection } from "@/lib/editor/actions";
import { RAMPS, RAMP_PIECES, SPEED_MAX, SPEED_MIN, rampOps } from "@/lib/editor/speed";
import { applyOps, fitsMedia, prepareOps, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "./fixtures";

// v1: c1 0–90 (file frames 30–120), then c2 right after it, then a gap, then c3.
function row(extra: Record<string, unknown> = {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("c1", 0, 90, { in: 30, ...extra }), video("c2", 90, 30), video("c3", 200, 30)];
  return d;
}
let n = 0;
const ids = () => `p${++n}`;
function ramped(d: TimelineDoc, rampId: (typeof RAMPS)[number]["id"], clipId = "c1") {
  n = 0;
  const made = rampOps(d, clipId, rampId, ids);
  if (!made.ok) throw new Error(made.why);
  const applied = applyOps(d, prepareOps(made.ops));
  const pieces = made.clipIds.map((id) => applied.doc.tracks[0].clips.find((c) => c.id === id) as MediaClip);
  return { made, doc: applied.doc, inverse: applied.inverse, pieces };
}

describe("the ramps", () => {
  it("each has a name in plain words, a sentence, and speeds a clip can be set to all the way through", () => {
    expect(RAMPS.map((r) => r.label)).toEqual(["Speed up", "Slow down", "Fast, slow, fast", "Slow-motion moment", "Fast start", "Fast finish"]);
    for (const ramp of RAMPS) {
      expect(ramp.says.length).toBeGreaterThan(10);
      for (let p = 0; p <= 1; p += 0.05) {
        expect(ramp.at(p)).toBeGreaterThanOrEqual(SPEED_MIN);
        expect(ramp.at(p)).toBeLessThanOrEqual(SPEED_MAX);
      }
    }
    const at = (id: string, p: number) => Number(RAMPS.find((r) => r.id === id)!.at(p).toFixed(2));
    expect([at("speed_up", 0), at("speed_up", 1), at("slow_down", 1), at("hero", 0.5), at("hero", 0), at("bullet", 0.5), at("bullet", 0.1), at("flash_in", 0), at("flash_in", 0.5), at("flash_out", 1)]).toEqual([1, 3, 0.33, 0.4, 2.5, 0.25, 1, 4, 1, 4]);
  });
});

describe("a speed ramp on a clip", () => {
  it("cuts it into linked pieces that play its footage end to end, each at its own speed", () => {
    const { pieces, made } = ramped(row(), "slow_down");
    expect(pieces).toHaveLength(RAMP_PIECES);
    expect(made.clipIds[0]).toBe("c1"); // the first piece is the clip itself
    // End to end on the timeline, and in the file: no frame skipped, none played twice.
    for (let i = 1; i < pieces.length; i++) {
      expect(pieces[i].start).toBe(pieces[i - 1].start + pieces[i - 1].duration);
      expect(pieces[i].in).toBe(pieces[i - 1].in + Math.round(pieces[i - 1].duration * pieces[i - 1].speed));
    }
    expect(pieces[0]).toMatchObject({ start: 0, in: 30 });
    const last = pieces.at(-1)!;
    expect(last.in + Math.round(last.duration * last.speed)).toBeLessThanOrEqual(120); // never past the footage it had
    expect(last.in + Math.round(last.duration * last.speed)).toBeGreaterThan(112);
    // It slows down all the way, and every piece fits a file as long as the clip's footage.
    const speeds = pieces.map((p) => p.speed);
    expect([...speeds].sort((a, b) => b - a)).toEqual(speeds);
    expect(speeds[0]).toBeCloseTo(1, 1);
    expect(speeds.at(-1)).toBeCloseTo(0.34, 1);
    for (const piece of pieces) expect(fitsMedia(piece, 120)).toBe(true);
    expect(new Set(pieces.map((p) => p.group)).size).toBe(1);
    expect(pieces[0].group).toBeTruthy();
  });
  it("moves what follows on the track by how much longer or shorter the whole became, and undoes whole", () => {
    const slow = ramped(row(), "slow_down");
    const end = slow.pieces.at(-1)!.start + slow.pieces.at(-1)!.duration;
    expect(end).toBeGreaterThan(90);
    const others = (d: TimelineDoc) => ["c2", "c3"].map((id) => d.tracks[0].clips.find((c) => c.id === id)!.start);
    expect(others(slow.doc)).toEqual([end, 200 + (end - 90)]);
    expect(applyOps(slow.doc, slow.inverse).doc).toEqual(row());
    const fast = ramped(row(), "speed_up");
    const fastEnd = fast.pieces.at(-1)!.start + fast.pieces.at(-1)!.duration;
    expect(fastEnd).toBeLessThan(90);
    expect(others(fast.doc)).toEqual([fastEnd, 200 - (90 - fastEnd)]);
    expect(applyOps(fast.doc, fast.inverse).doc).toEqual(row());
  });
  it("keeps the clip's way in on the first piece and its way out on the last, and everything else on all", () => {
    const { pieces } = ramped(row({ fadeIn: 5, fadeOut: 6, transitionIn: { kind: "fade", frames: 4 }, transitionOut: { kind: "fade", frames: 4 }, volume: 0.5, adjust: { grain: 0.2 }, speed: 2, in: 0 }), "hero");
    expect([pieces[0].fadeIn, pieces[0].transitionIn, pieces[0].fadeOut, pieces[0].transitionOut]).toEqual([5, { kind: "fade", frames: 4 }, undefined, undefined]);
    expect([pieces.at(-1)!.fadeOut, pieces.at(-1)!.transitionOut, pieces.at(-1)!.fadeIn]).toEqual([6, { kind: "fade", frames: 4 }, undefined]);
    expect(pieces[4].fadeIn ?? pieces[4].transitionOut).toBeUndefined();
    for (const piece of pieces) expect(piece).toMatchObject({ volume: 0.5, adjust: { grain: 0.2 }, assetId: "a" });
    // The ramp multiplies the clip's own speed, each piece taking the ramp at its own middle: the two middle pieces
    // of a 2× clip sit a little off the ramp's slowest point (0.4), at 0.46 × 2.
    expect(Math.min(...pieces.map((p) => p.speed))).toBe(0.92);
    expect(Math.max(...pieces.map((p) => p.speed))).toBeGreaterThan(4);
  });
  it("carries keyframes on, counted from each piece's own start", () => {
    const { pieces } = ramped(row({ keyframes: { opacity: [{ at: 0, value: 0 }, { at: 60, value: 1 }] } }), "speed_up");
    expect(pieces[0].keyframes!.opacity).toEqual([{ at: 0, value: 0 }, { at: 60, value: 1 }]);
    const third = pieces[2];
    expect(third.keyframes!.opacity).toEqual([{ at: -third.start, value: 0 }, { at: 60 - third.start, value: 1 }]);
  });
  it("uses fewer pieces for a short clip, and refuses one too short, backward, held, locked or not a clip that plays", () => {
    const short = row();
    (short.tracks[0].clips[0] as MediaClip).duration = 12;
    expect(ramped(short, "slow_down").pieces).toHaveLength(6);
    const tiny = row();
    (tiny.tracks[0].clips[0] as MediaClip).duration = 5;
    expect(rampOps(tiny, "c1", "slow_down", ids)).toEqual({ ok: false, why: "too-short" });
    expect(rampOps(row({ speed: -1 }), "c1", "slow_down", ids)).toEqual({ ok: false, why: "not-a-clip" });
    expect(rampOps(row({ speed: 0 }), "c1", "slow_down", ids)).toEqual({ ok: false, why: "not-a-clip" });
    expect(rampOps(row(), "x1", "slow_down", ids)).toEqual({ ok: false, why: "not-a-clip" });
    expect(rampOps(row(), "gone", "slow_down", ids)).toEqual({ ok: false, why: "not-a-clip" });
    const locked = row();
    locked.tracks[0].locked = true;
    expect(rampOps(locked, "c1", "slow_down", ids)).toEqual({ ok: false, why: "not-a-clip" });
    expect(rampOps(row(), "c1", "slow_down", ids, 5)).toEqual({ ok: false, why: "no-room" });
  });
});

describe("from the editor", () => {
  it("ramps the one selected clip in one change and selects its pieces", () => {
    const store = makeStore({ doc: row() });
    store.getState().select(["c1"]);
    rampSelection(store, "bullet");
    const { doc, selection, queue } = store.getState();
    expect(selection.clipIds).toHaveLength(RAMP_PIECES);
    expect(selection.clipIds[0]).toBe("c1");
    expect(queue.at(-1)).toMatchObject({ label: "speed ramp" });
    store.getState().undo();
    expect(store.getState().doc).toEqual(row());
    expect(doc.tracks[0].clips.length).toBe(RAMP_PIECES + 2);
  });
  it("says why when it cannot", () => {
    const store = makeStore({ doc: row() });
    const notices = noticesOf(store);
    rampSelection(store, "bullet");
    store.getState().select(["c1", "c2"]);
    rampSelection(store, "bullet");
    store.getState().select(["x1"]);
    rampSelection(store, "bullet");
    expect(notices).toEqual(["Select one video clip to ramp its speed.", "Select one video clip to ramp its speed.", "A speed ramp needs a video clip that plays forward, on an unlocked track."]);
    const viewer = makeStore({ doc: row(), canEdit: false });
    viewer.getState().select(["c1"]);
    rampSelection(viewer, "bullet");
    expect(viewer.getState().doc).toEqual(row());
  });
});
