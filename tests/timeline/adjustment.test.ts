import { describe, expect, it } from "vitest";
import { addAdjustmentLayer, applyLook } from "@/lib/editor/actions";
import { ADJUSTMENT_SECONDS, addAdjustmentOps } from "@/lib/editor/adjustment";
import { clipRects } from "@/lib/editor/clip-box";
import { canvasItems } from "@/lib/editor/canvas-geometry";
import { clipFieldOps, clipFieldValue, fieldContext, type ClipField } from "@/lib/editor/inspector-fields";
import { laneMenu } from "@/lib/editor/menus";
import { searchItems } from "@/lib/editor/search";
import { findClip } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import { activeClips, adjustmentsAt, drawFrame, type Ctx2D, type LayerUse, type ResolvedSource } from "@/lib/render/compositor";
import type { FinishPass } from "@/lib/render/finish-gl";
import { needsFinisher } from "@/lib/render/grade";
import { DEFAULT_TRANSFORM, adjustAt, applyOps, describe as describeDoc, isColorClip, prepareOps, slotOf, type AdjustmentClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx, type Call } from "../render/fake-ctx";

const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const layer = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) => ({ id, type: "adjustment" as const, start, duration, transform: { ...DEFAULT_TRANSFORM }, ...extra });
const patch = (clipId: string, p: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId, patch: p }];
const adj = (d: TimelineDoc) => findClip(d, "adj")!.clip as AdjustmentClip;
// The sample project with an overlay track o1 right in front of its video track: v1, o1, t1, cap, a1.
const withOverlay = () => run(sampleDoc(), [{ op: "add_track", track: { id: "o1", kind: "overlay", name: "Overlay 1" }, index: 1 }]).doc;
// And an adjustment layer adj on that track, over the first two seconds.
function layered(extra: Record<string, unknown> = {}): TimelineDoc {
  return run(withOverlay(), [{ op: "add_clip", trackId: "o1", clip: layer("adj", 0, 60, extra) }]).doc;
}

describe("an adjustment layer in the ops", () => {
  it("goes on a video or overlay track and nowhere else, and never over another clip", () => {
    const d = withOverlay();
    expect(() => run(d, [{ op: "add_clip", trackId: "o1", clip: layer("adj", 0, 30) }])).not.toThrow();
    expect(() => run(d, [{ op: "add_clip", trackId: "t1", clip: layer("adj", 200, 30) }])).toThrow(/adjustment clip "adj" cannot go on text track/);
    expect(() => run(d, [{ op: "add_clip", trackId: "a1", clip: layer("adj", 200, 30) }])).toThrow(/cannot go on audio track/);
    const c1 = findClip(d, "c1")!.clip;
    expect(() => run(d, [{ op: "add_clip", trackId: "v1", clip: layer("adj", c1.start, 10) }])).toThrow();
  });
  it("takes colours, effects and a grade, each set and undone like a video's", () => {
    const set = run(layered(), patch("adj", { adjust: { saturation: -1, grain: 0.3 }, grade: { gain: { x: 0, y: 0, level: 0.2 } } }));
    expect(adj(set.doc)).toMatchObject({ adjust: { saturation: -1, grain: 0.3 }, grade: { gain: { x: 0, y: 0, level: 0.2 } } });
    const undone = applyOps(set.doc, JSON.parse(JSON.stringify(set.inverse))).doc;
    expect(adj(undone).adjust).toEqual({ saturation: 0, grain: 0 });
    expect(isColorClip(adj(set.doc))).toBe(true);
    expect(slotOf(adj(set.doc))).toBeUndefined();
  });
  it("takes nothing a layer with no picture can use", () => {
    const d = layered();
    for (const key of ["blend", "chroma", "rounding", "transitionIn", "captions", "sound", "fadeIn"]) {
      expect(() => run(d, patch("adj", { [key]: key === "blend" ? "screen" : key === "rounding" ? 0.5 : null }))).toThrow();
    }
    expect(() => run(d, patch("adj", { assetId: "a" }))).toThrow();
    expect(() => run(d, patch("adj", { transform: { opacity: 0.5 } }))).not.toThrow();
  });
  it("keys its opacity and its colours, and nothing else", () => {
    const d = layered();
    expect(() => run(d, patch("adj", { keyframes: { opacity: [{ at: 0, value: 0 }, { at: 15, value: 1 }], vhs: [{ at: 0, value: 1 }] } }))).not.toThrow();
    expect(() => run(d, patch("adj", { keyframes: { x: [{ at: 0, value: 0.5 }] } }))).toThrow(/an adjustment layer takes only opacity and colour keyframes/);
    expect(() => run(d, patch("adj", { keyframes: { volume: [{ at: 0, value: 1 }] } }))).toThrow(/only a video or audio clip takes volume keyframes/);
    const keyed = run(d, patch("adj", { keyframes: { brightness: [{ at: 0, value: 0 }, { at: 10, value: 1 }] } })).doc;
    expect(adjustAt(adj(keyed), 5).brightness).toBeCloseTo(0.5);
  });
  it("is moved, trimmed and split like any clip", () => {
    const d = layered({ adjust: { vhs: 0.5 } });
    const moved = run(d, [{ op: "move_clip", clipId: "adj", start: 30 }, { op: "trim_clip", clipId: "adj", edge: "end", to: 70 }]).doc;
    expect(adj(moved)).toMatchObject({ start: 30, duration: 40 });
    const split = run(moved, [{ op: "split_clip", clipId: "adj", at: 50, newClipId: "a2" }]).doc;
    expect(adj(split)).toMatchObject({ start: 30, duration: 20 });
    expect(findClip(split, "a2")!.clip).toMatchObject({ type: "adjustment", start: 50, duration: 20, adjust: { vhs: 0.5 } });
    const removed = run(split, [{ op: "remove_clip", clipId: "adj" }]);
    expect(findClip(removed.doc, "adj")).toBeNull();
    expect(findClip(applyOps(removed.doc, removed.inverse).doc, "adj")).not.toBeNull();
  });
  it("is listed for agents with how much of it shows and what it changes", () => {
    const d = layered({ transform: { ...DEFAULT_TRANSFORM, opacity: 0.6 }, adjust: { contrast: 0.2 } });
    expect(describeDoc(d)).toMatch(/adj {2}adjustment {2}.* amount=0\.6 adjust=\{"contrast":0\.2\}/);
    expect(describeDoc(d, { detail: true })).toMatch(/adj {2}adjustment .*amount=0\.6 adjust=\{"contrast":0\.2\}/);
  });
});

describe("where an adjustment layer is", () => {
  it("has no box on the frame, so it is never picked or dragged there", () => {
    const d = layered();
    expect(clipRects(d, adj(d), { source: () => null, measure: () => 0 })).toBeNull();
    expect(activeClips(d, 5).map((c) => c.clip.id)).not.toContain("adj");
    expect(canvasItems(d, 5, { source: () => null, measure: () => 0 }).map((i) => i.clipId)).not.toContain("adj");
    expect(adjustmentsAt(d, 5).map((l) => l.clip.id)).toEqual(["adj"]);
    expect(adjustmentsAt(d, 60)).toEqual([]);
    d.tracks.find((t) => t.id === "o1")!.hidden = true;
    expect(adjustmentsAt(d, 5)).toEqual([]);
  });
  it("needs the graphics card only when it grades or stylises", () => {
    expect(needsFinisher(layered({ adjust: { brightness: 0.3 } }))).toBe(false);
    expect(needsFinisher(layered({ adjust: { glitch: 0.3 } }))).toBe(true);
    expect(needsFinisher(layered({ grade: { lift: { x: 0.2, y: 0, level: 0 } } }))).toBe(true);
  });
});

describe("drawing an adjustment layer", () => {
  const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 1080, height: 1920 };
  type Fake = { ctx: Ctx2D; calls: Call[] };
  function fake(): Fake {
    const made = fakeCtx();
    (made.ctx as unknown as { canvas: unknown }).canvas = { width: 1080, height: 1920, of: made };
    made.calls.length = 0;
    return made;
  }
  // A video on the first track, the layer on the second, text on the track after it.
  function draw(extra: Record<string, unknown>, opts: { noLayers?: boolean; frame?: number } = {}) {
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [video("c", 0, 60)];
    d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [layer("adj", 0, 30, extra)] });
    const frameCtx = fake();
    const layers: Partial<Record<LayerUse, Fake>> = { under: fake(), tone: fake(), finish: fake() };
    const passes: FinishPass[] = [];
    drawFrame(frameCtx.ctx, d, opts.frame ?? 10, {
      resolveSource: () => PICTURE,
      makeLayer: (_w, _h, use) => (opts.noLayers ? null : layers[use]!.ctx),
      finish: (_source, _w, _h, pass) => {
        passes.push(pass);
        return { tag: "finished" } as unknown as CanvasImageSource;
      },
    });
    return { frame: frameCtx.calls, layers, passes, canvas: (frameCtx.ctx as unknown as { canvas: unknown }).canvas };
  }
  const names = (calls: Call[]) => calls.map(([name]) => name);

  it("that changes nothing draws nothing", () => {
    const plain = draw({});
    expect(plain.layers.under!.calls).toEqual([]);
    expect(draw({ adjust: { brightness: 0 }, grade: {} }).frame).toEqual(plain.frame);
    expect(draw({ adjust: { brightness: 0.5 }, transform: { ...DEFAULT_TRANSFORM, opacity: 0 } }).frame).toEqual(plain.frame);
    expect(draw({ adjust: { brightness: 0.5 } }, { frame: 40 }).frame).toEqual(draw({}, { frame: 40 }).frame); // past its end
  });
  it("copies the frame so far, and draws the copy back with its colours at its opacity", () => {
    const { frame, layers, canvas } = draw({ adjust: { brightness: 0.5 }, transform: { ...DEFAULT_TRANSFORM, opacity: 0.4 } });
    expect(layers.under!.calls).toEqual([["save"], ["setTransform", 1, 0, 0, 1, 0, 0], ["clearRect", 0, 0, 1080, 1920], ["drawImage", canvas, 0, 0], ["restore"]]);
    const underCanvas = (layers.under!.ctx as unknown as { canvas: unknown }).canvas;
    const tail = frame.slice(-5);
    expect(tail).toEqual([["save"], ["set globalAlpha", 0.4], ["set filter", "brightness(1.5)"], ["drawImage", underCanvas, 0, 0, 1080, 1920], ["restore"]]);
    // The video under it was drawn first.
    expect(names(frame).indexOf("drawImage")).toBeLessThan(frame.length - 5);
  });
  it("sends a grade or a stylised effect through the finisher, the whole frame at once", () => {
    const { frame, layers, passes } = draw({ adjust: { vhs: 1 }, grade: { gain: { x: 0, y: 0, level: 0.5 } } });
    expect(passes).toHaveLength(1);
    expect(passes[0].style.vhs).toBe(1);
    expect(passes[0].grade!.wheels!.gain).toEqual([1.25, 1.25, 1.25]);
    expect(layers.finish!.calls).toContainEqual(["drawImage", (layers.under!.ctx as unknown as { canvas: unknown }).canvas, 0, 0, 1080, 1920]);
    expect(frame.at(-3)).toEqual(["drawImage", { tag: "finished" }, 0, 0]);
  });
  it("uses its keyframed colours and opacity at the frame", () => {
    const keyframes = { opacity: [{ at: 0, value: 0 }, { at: 20, value: 1 }], saturation: [{ at: 0, value: 0 }, { at: 20, value: -1 }] };
    const { frame } = draw({ keyframes });
    expect(frame).toContainEqual(["set globalAlpha", 0.5]);
    expect(frame).toContainEqual(["set filter", "saturate(0.5)"]);
  });
  it("changes what is under it and not what is over it", () => {
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [video("c", 0, 60)];
    d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [layer("adj", 0, 30, { adjust: { brightness: 0.5 } })] });
    const textAt = d.tracks.findIndex((t) => t.kind === "text");
    d.tracks[textAt].clips = [{ id: "x", type: "text", start: 0, duration: 30, text: "HI", transform: { ...DEFAULT_TRANSFORM }, style: { fontFamily: "Inter", fontSize: 80, fontWeight: 700, color: "#ffffff", align: "center" } }];
    const frameCtx = fake();
    const under = fake();
    drawFrame(frameCtx.ctx, d, 10, { resolveSource: () => PICTURE, makeLayer: () => under.ctx, finish: null });
    const order = names(frameCtx.calls);
    expect(order.indexOf("set filter")).toBeLessThan(order.indexOf("fillText"));
    expect(order.indexOf("set filter")).toBeGreaterThan(order.indexOf("drawImage"));
  });
  it("is left out where there is no canvas to copy the frame to", () => {
    expect(draw({ adjust: { brightness: 0.5 } }, { noLayers: true }).frame).toEqual(draw({}, { noLayers: true }).frame);
  });
});

describe("adding an adjustment layer", () => {
  it("goes on the front-most picture track where it is free, for five seconds or until the next clip", () => {
    const d = sampleDoc(); // v1 holds clips up to frame 60
    const plan = addAdjustmentOps(d, 70, { clip: "adj", track: "tNew" });
    expect(plan).toEqual({ ok: true, clipId: "adj", ops: [{ op: "add_clip", trackId: "v1", clip: layer("adj", 70, ADJUSTMENT_SECONDS * d.fps) }] });
    d.tracks[0].clips.push(video("later", 100, 30));
    const before = addAdjustmentOps(d, 70, { clip: "adj", track: "tNew" });
    expect(before.ok && before.ops).toEqual([{ op: "add_clip", trackId: "v1", clip: layer("adj", 70, 30) }]);
    expect(() => run(d, before.ok ? before.ops : [])).not.toThrow();
    // With an overlay track in front, that is the one it goes on.
    const over = withOverlay();
    expect((addAdjustmentOps(over, 12, { clip: "adj", track: "tNew" }) as { ops: OpInput[] }).ops).toEqual([{ op: "add_clip", trackId: "o1", clip: layer("adj", 12, ADJUSTMENT_SECONDS * over.fps) }]);
  });
  it("gets an overlay track of its own, right in front of the pictures, when that track is taken or locked", () => {
    const d = sampleDoc();
    const plan = addAdjustmentOps(d, 12, { clip: "adj", track: "tNew" }); // frame 12 is inside c1
    expect(plan.ok && plan.ops[0]).toMatchObject({ op: "add_track", track: { id: "tNew", kind: "overlay", name: "Overlay 1" }, index: 1 });
    const done = run(d, plan.ok ? plan.ops : []).doc;
    expect(done.tracks.map((t) => t.id)).toEqual(["v1", "tNew", "t1", "cap", "a1"]); // text stays in front of it
    expect(done.tracks[1].clips.map((c) => c.id)).toEqual(["adj"]);
    const locked = sampleDoc();
    locked.tracks[0].locked = true;
    expect((addAdjustmentOps(locked, 70, { clip: "adj", track: "tNew" }) as { ops: OpInput[] }).ops[0]).toMatchObject({ op: "add_track" });
  });
  it("is refused when it needs a track and the project is full", () => {
    const d = sampleDoc();
    while (d.tracks.length < LIMITS.tracksPerProject) d.tracks.push({ id: `extra${d.tracks.length}`, kind: "audio", name: `Extra ${d.tracks.length}`, muted: false, hidden: false, locked: false, clips: [] });
    expect(addAdjustmentOps(d, 12, { clip: "adj", track: "tNew" })).toEqual({ ok: false, reason: "tracks" });
  });
  it("from the editor: lands at the playhead, is selected, takes a look, and undoes in one step", () => {
    const store = makeStore();
    store.getState().seek(15);
    const id = addAdjustmentLayer(store)!;
    const added = findClip(store.getState().doc, id)!.clip;
    expect(added).toMatchObject({ type: "adjustment", start: 15 });
    expect(store.getState().selection.clipIds).toEqual([id]);
    applyLook(store, id, "noir");
    expect((findClip(store.getState().doc, id)!.clip as AdjustmentClip).adjust).toMatchObject({ saturation: -1 });
    store.getState().undo();
    store.getState().undo();
    expect(findClip(store.getState().doc, id)).toBeNull();
    const viewer = makeStore({ canEdit: false });
    expect(addAdjustmentLayer(viewer)).toBeNull();
    expect(noticesOf(viewer)).toEqual([]);
  });
  it("is in the search and the timeline's menu", () => {
    const state = makeStore().getState();
    expect(laneMenu(state, false, null).map((e) => e.label)).toContain("Add adjustment layer");
    const input = { canEdit: true, deleted: false, busy: false, hasSelection: false, canUndo: false, canRedo: false, canPaste: false, canZoomIn: true, canZoomOut: true, snapping: true, showAudioMeter: true, showSafeZones: false, leftTabs: [], rightTabs: [], trackCount: 4, hasCaptions: false, canSaveTemplate: false };
    const item = searchItems(input as never).find((i) => i.id === "adjustment-layer")!;
    expect(item).toMatchObject({ label: "Add adjustment layer", group: "Add", action: { kind: "adjustment" }, disabled: false });
    expect(searchItems({ ...input, canEdit: false } as never).find((i) => i.id === "adjustment-layer")!.disabled).toBe(true);
  });
});

describe("an adjustment layer's fields", () => {
  const field = (d: TimelineDoc, name: ClipField, raw: string) => clipFieldOps(adj(d), name, raw, fieldContext(d, adj(d)));
  const shown = (d: TimelineDoc, name: ClipField) => clipFieldValue(adj(d), name, fieldContext(d, adj(d)));
  it("its amount is its opacity, and its colours are a video's", () => {
    const d = layered({ adjust: { contrast: 0.2 } });
    expect([shown(d, "opacity"), shown(d, "contrast"), shown(d, "grain")]).toEqual(["100", "20", "0"]);
    expect(field(d, "opacity", "40")).toEqual(patch("adj", { transform: { opacity: 0.4 } }));
    expect(field(d, "grain", "30")).toEqual(patch("adj", { adjust: { grain: 0.3 } }));
    expect(field(d, "gainLevel", "50")).toEqual(patch("adj", { grade: { gain: { x: 0, y: 0, level: 0.5 } } }));
  });
  it("has none of a picture's own fields", () => {
    const d = layered();
    expect((["rounding", "chroma", "flipH", "blend", "volume", "speed"] as const).map((f) => shown(d, f))).toEqual(["", "", "", "", "", ""]);
    expect(field(d, "rounding", "20")).toBeNull();
    expect(field(d, "blend", "screen")).toBeNull();
  });
});
