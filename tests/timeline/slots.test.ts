import { describe as suite, expect, it } from "vitest";
import { DEFAULT_TRANSFORM, OpError, applyOps, describe, isPlaceholder, prepareOps, type OpInput, type TimelineDoc } from "@/lib/timeline";
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
});
