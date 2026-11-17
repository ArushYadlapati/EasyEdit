import { describe as suite, expect, it } from "vitest";
import { DEFAULT_TRANSFORM, OpError, applyOps, describe, isPlaceholder, prepareOps, toTemplateDoc, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { createEmptyDoc } from "@/lib/timeline";

const style = { fontFamily: "Inter", fontSize: 96, fontWeight: 800, color: "#FFFFFF", align: "center" } as const;

function base(): TimelineDoc {
  let d = createEmptyDoc("short_9x16");
  d.tracks = [];
  d = applyOps(d, [
    { op: "add_track", track: { id: "v", kind: "video", name: "V" } },
    { op: "add_track", track: { id: "o", kind: "overlay", name: "O" } },
    { op: "add_track", track: { id: "t", kind: "text", name: "T" } },
    { op: "add_track", track: { id: "a", kind: "audio", name: "A" } },
  ]).doc;
  return d;
}

const ph = (id: string, accepts: "visual" | "audio", name = "hero_clip", extra: object = {}) => ({
  id,
  type: "placeholder" as const,
  start: 0,
  duration: 90,
  transform: DEFAULT_TRANSFORM,
  accepts,
  slot: { name, hint: "the hero shot" },
  ...extra,
});

const run = (doc: TimelineDoc, ...ops: OpInput[]) => applyOps(doc, prepareOps(ops));
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as OpError).code;
  }
  return null;
};

suite("slots", () => {
  it("places placeholders by what they accept", () => {
    const d = base();
    expect(() => run(d, { op: "add_clip", trackId: "v", clip: ph("p1", "visual") })).not.toThrow();
    expect(() => run(d, { op: "add_clip", trackId: "o", clip: ph("p1", "visual") })).not.toThrow();
    expect(() => run(d, { op: "add_clip", trackId: "a", clip: ph("p1", "audio") })).not.toThrow();
    expect(codeOf(() => run(d, { op: "add_clip", trackId: "t", clip: ph("p1", "visual") }))).toBe("WRONG_TRACK_KIND");
    expect(codeOf(() => run(d, { op: "add_clip", trackId: "a", clip: ph("p1", "visual") }))).toBe("WRONG_TRACK_KIND");
    expect(codeOf(() => run(d, { op: "add_clip", trackId: "v", clip: ph("p1", "audio") }))).toBe("WRONG_TRACK_KIND");
  });

  it("requires a valid slot", () => {
    const d = base();
    const noSlot: Record<string, unknown> = { ...ph("p1", "visual") };
    delete noSlot.slot;
    expect(codeOf(() => run(d, { op: "add_clip", trackId: "v", clip: noSlot as never }))).toBe("INVALID");
    expect(codeOf(() => run(d, { op: "add_clip", trackId: "v", clip: ph("p1", "visual", "Hero") }))).toBe("INVALID");
    expect(codeOf(() => run(d, { op: "add_clip", trackId: "v", clip: ph("p1", "visual", "1hero") }))).toBe("INVALID");
    expect(() => run(d, { op: "add_clip", trackId: "v", clip: ph("p1", "visual", "hero_clip") })).not.toThrow();
  });

  it("sets and removes a slot with update_clip, undo round-trips", () => {
    let d = run(base(), {
      op: "add_clip",
      trackId: "t",
      clip: { id: "x", type: "text", start: 0, duration: 30, text: "hi", transform: DEFAULT_TRANSFORM, style },
    }).doc;
    const before = structuredClone(d);
    const r = run(d, { op: "update_clip", clipId: "x", patch: { slot: { name: "title_text" } } });
    expect(r.doc.tracks[2].clips[0]).toMatchObject({ slot: { name: "title_text" } });
    const undone = applyOps(r.doc, r.inverse).doc;
    expect(undone).toEqual(before);
    expect("slot" in undone.tracks[2].clips[0]).toBe(false);
    const removed = run(r.doc, { op: "update_clip", clipId: "x", patch: { slot: null } });
    expect("slot" in removed.doc.tracks[2].clips[0]).toBe(false);
    expect(applyOps(removed.doc, removed.inverse).doc).toEqual(r.doc);
    d = r.doc;
  });

  it("refuses to clear a placeholder's slot", () => {
    const d = run(base(), { op: "add_clip", trackId: "v", clip: ph("p1", "visual") }).doc;
    expect(codeOf(() => run(d, { op: "update_clip", clipId: "p1", patch: { slot: null } }))).toBe("INVALID");
  });

  it("keeps the slot on both halves of a split", () => {
    let d = run(base(), { op: "add_clip", trackId: "v", clip: ph("p1", "visual") }).doc;
    d = run(d, { op: "split_clip", clipId: "p1", at: 30, newClipId: "p2" }).doc;
    const [l, r] = d.tracks[0].clips;
    expect(l.type).toBe("placeholder");
    expect(l.slot).toEqual({ name: "hero_clip", hint: "the hero shot" });
    expect(r.slot).toEqual(l.slot);
    let e = run(base(), {
      op: "add_clip",
      trackId: "v",
      clip: { id: "m", type: "video", start: 0, duration: 90, transform: DEFAULT_TRANSFORM, assetId: "a1", in: 0, speed: 1, volume: 1, slot: { name: "main" } },
    }).doc;
    e = run(e, { op: "split_clip", clipId: "m", at: 30, newClipId: "m2" }).doc;
    expect(e.tracks[0].clips.map((c) => c.slot)).toEqual([{ name: "main" }, { name: "main" }]);
  });

  it("trims and moves a placeholder", () => {
    let d = run(base(), { op: "add_clip", trackId: "v", clip: ph("p1", "visual") }).doc;
    d = run(d, { op: "trim_clip", clipId: "p1", edge: "start", to: 10 }).doc;
    d = run(d, { op: "trim_clip", clipId: "p1", edge: "end", to: 50 }).doc;
    d = run(d, { op: "move_clip", clipId: "p1", start: 100 }).doc;
    expect(d.tracks[0].clips[0]).toMatchObject({ start: 100, duration: 40 });
    expect(isPlaceholder(d.tracks[0].clips[0])).toBe(true);
    expect(codeOf(() => run(d, { op: "trim_clip", clipId: "p1", edge: "start", to: 120, in: 5 }))).toBe("INVALID");
  });

  it("describes placeholders and slotted clips", () => {
    let d = run(base(), { op: "add_clip", trackId: "v", clip: { ...ph("p1", "visual"), duration: 90 } }).doc;
    d = run(d, {
      op: "add_clip",
      trackId: "t",
      clip: { id: "x", type: "text", start: 0, duration: 30, text: "hi", transform: DEFAULT_TRANSFORM, style, slot: { name: "title_text" } },
    }).doc;
    const out = describe(d);
    expect(out).toContain('  p1  placeholder(visual)  0.00–3.00s  slot=hero_clip "the hero shot"');
    expect(out).toContain('  x  text  0.00–1.00s  "hi" slot=title_text');
    expect(describe(d, { detail: true })).toContain("slot=title_text");
  });

  it("a visual slot takes the video and image effects; an audio slot takes none", () => {
    const d = base();
    const fade = { kind: "fade", frames: 15 } as const;
    const keyframes = { x: [{ at: 0, value: 0.2 }, { at: 30, value: 0.8 }] };
    expect(() => run(d, { op: "add_clip", trackId: "v", clip: ph("p1", "visual", "hero_clip", { transitionIn: fade, transitionOut: fade, keyframes }) })).not.toThrow();
    expect(codeOf(() => run(d, { op: "add_clip", trackId: "a", clip: ph("p1", "audio", "music", { transitionIn: fade }) }))).toBe("INVALID");
    // A null is the neutral value, so an audio slot that spells out "none" is fine.
    expect(() => run(d, { op: "add_clip", trackId: "a", clip: ph("p1", "audio", "music", { transitionIn: null }) })).not.toThrow();
    expect(() => run(d, { op: "add_clip", trackId: "v", clip: ph("p1", "visual", "hero_clip", { transitionOut: { kind: "crossfade", frames: 5 } }) })).toThrow();

    const audio = run(d, { op: "add_clip", trackId: "a", clip: ph("p2", "audio", "music") }).doc;
    expect(() => run(audio, { op: "update_clip", clipId: "p2", patch: { keyframes } })).toThrow('"keyframes" is not allowed on an audio placeholder clip');
    const visual = run(d, { op: "add_clip", trackId: "v", clip: ph("p1", "visual") }).doc;
    expect(() => run(visual, { op: "update_clip", clipId: "p1", patch: { animationIn: { preset: "fade", frames: 5 } } })).toThrow(
      '"animationIn" is not allowed on a visual placeholder clip',
    );
  });

  it("update_clip sets a visual slot's transition and keyframes, and the undo puts back none", () => {
    const d = run(base(), { op: "add_clip", trackId: "v", clip: ph("p1", "visual") }).doc;
    const r = run(d, { op: "update_clip", clipId: "p1", patch: { transitionIn: { kind: "fade", frames: 15 }, keyframes: { scale: [{ at: 0, value: 1 }, { at: 60, value: 1.2 }] } } });
    expect(r.doc.tracks[0].clips[0]).toMatchObject({ type: "placeholder", transitionIn: { kind: "fade", frames: 15 }, keyframes: { scale: [{ at: 0, value: 1 }, { at: 60, value: 1.2 }] } });
    const undone = applyOps(r.doc, JSON.parse(JSON.stringify(r.inverse))).doc;
    expect(undone.tracks[0].clips[0]).toMatchObject({ transitionIn: null, keyframes: { scale: [] } });
    expect(describe(undone)).toBe(describe(d));
  });

  it("split and trim hand a slot's effects off like an image clip's", () => {
    const fadeIn = { kind: "fade", frames: 10 } as const;
    const dipOut = { kind: "dip", frames: 10, color: "#ffffff" } as const;
    const keyframes = { x: [{ at: 0, value: 0 }, { at: 90, value: 1 }] };
    const d = run(base(), { op: "add_clip", trackId: "v", clip: ph("p1", "visual", "hero_clip", { transitionIn: fadeIn, transitionOut: dipOut, keyframes }) }).doc;
    const split = run(d, { op: "split_clip", clipId: "p1", at: 30, newClipId: "p2" });
    const [l, r] = split.doc.tracks[0].clips;
    expect(l).toMatchObject({ type: "placeholder", transitionIn: fadeIn, transitionOut: null, keyframes });
    expect(r).toMatchObject({ type: "placeholder", transitionIn: null, transitionOut: dipOut, keyframes: { x: [{ at: -30, value: 0 }, { at: 60, value: 1 }] } });
    expect("in" in r).toBe(false);
    expect(applyOps(split.doc, JSON.parse(JSON.stringify(split.inverse))).doc.tracks[0].clips).toEqual(d.tracks[0].clips);

    const trimmed = run(d, { op: "trim_clip", clipId: "p1", edge: "start", to: 10 });
    expect(trimmed.doc.tracks[0].clips[0]).toMatchObject({ start: 10, keyframes: { x: [{ at: -10, value: 0 }, { at: 80, value: 1 }] }, transitionIn: fadeIn });
    expect("in" in trimmed.doc.tracks[0].clips[0]).toBe(false);
    expect(applyOps(trimmed.doc, trimmed.inverse).doc.tracks[0].clips[0]).toEqual(d.tracks[0].clips[0]);
  });

  it("describes a slot before its effects, on a placeholder and on a slotted clip", () => {
    const fade = { kind: "fade", frames: 15 } as const;
    let d = run(base(), { op: "add_clip", trackId: "v", clip: ph("p1", "visual", "hero_clip", { transitionIn: fade, keyframes: { x: [{ at: 0, value: 0.5 }] } }) }).doc;
    d = run(d, {
      op: "add_clip",
      trackId: "o",
      clip: { id: "m", type: "video", start: 0, duration: 90, transform: DEFAULT_TRANSFORM, assetId: "a1", in: 0, speed: 1, volume: 1, slot: { name: "broll" }, transitionOut: fade },
    }).doc;
    const out = describe(d);
    expect(out).toContain('  p1  placeholder(visual)  0.00–3.00s  slot=hero_clip "the hero shot" in=fade 0.50s kf=x');
    expect(out).toContain("vol=1 slot=broll out=fade 0.50s");
    const detail = describe(d, { detail: true });
    expect(detail).toContain('slot=hero_clip "the hero shot" in=fade 0.50s kf.x=0:0.5');
    expect(detail).toContain("slot=broll out=fade 0.50s");
  });

  it("a template keeps a slotted clip's effects on its placeholder", () => {
    const fade = { kind: "fade", frames: 15 } as const;
    const keyframes = { opacity: [{ at: 0, value: 0 }, { at: 15, value: 1 }] };
    let d = run(base(), {
      op: "add_clip",
      trackId: "v",
      clip: { id: "m", type: "video", start: 0, duration: 90, transform: DEFAULT_TRANSFORM, assetId: "a1", in: 0, speed: 1, volume: 1, slot: { name: "main" }, transitionIn: fade, transitionOut: null, keyframes },
    }).doc;
    d = run(d, {
      op: "add_clip",
      trackId: "a",
      clip: { id: "s", type: "audio", start: 0, duration: 90, transform: DEFAULT_TRANSFORM, assetId: "a2", in: 0, speed: 1, volume: 1, slot: { name: "music" } },
    }).doc;
    const t = toTemplateDoc(d);
    expect(t.tracks[0].clips[0]).toEqual({ id: "m", type: "placeholder", start: 0, duration: 90, transform: DEFAULT_TRANSFORM, accepts: "visual", slot: { name: "main" }, transitionIn: fade, transitionOut: null, keyframes });
    expect(t.tracks[3].clips[0]).toEqual({ id: "s", type: "placeholder", start: 0, duration: 90, transform: DEFAULT_TRANSFORM, accepts: "audio", slot: { name: "music" } });
  });
});
