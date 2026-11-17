import { describe, expect, it } from "vitest";
import { DEFAULT_TRANSFORM, applyOps, createEmptyDoc, mixedSlots, prepareOps, slotsOf, toTemplateDoc, type TimelineDoc } from "@/lib/timeline";

const style = { fontFamily: "Inter", fontSize: 96, fontWeight: 800, color: "#FFFFFF", align: "center" } as const;

function build(): TimelineDoc {
  let d = createEmptyDoc("short_9x16");
  d.tracks = [];
  d = applyOps(
    d,
    prepareOps([
      { op: "add_track", track: { id: "v", kind: "video", name: "V" } },
      { op: "add_track", track: { id: "t", kind: "text", name: "T" } },
      { op: "add_track", track: { id: "a", kind: "audio", name: "A" } },
      { op: "add_clip", trackId: "v", clip: { id: "c2", type: "image", assetId: "as2", start: 100, duration: 50, in: 0, speed: 1, volume: 1, transform: DEFAULT_TRANSFORM, slot: { name: "second" } } },
      { op: "add_clip", trackId: "v", clip: { id: "c1", type: "video", assetId: "as1", start: 0, duration: 90, in: 0, speed: 1, volume: 1, transform: DEFAULT_TRANSFORM, slot: { name: "hero_clip", hint: "hero" } } },
      { op: "add_clip", trackId: "v", clip: { id: "c3", type: "video", assetId: "as3", start: 200, duration: 30, in: 0, speed: 1, volume: 1, transform: DEFAULT_TRANSFORM } },
      { op: "add_clip", trackId: "t", clip: { id: "t1", type: "text", text: "Hi", style, start: 0, duration: 60, transform: DEFAULT_TRANSFORM, slot: { name: "title" } } },
      { op: "add_clip", trackId: "a", clip: { id: "a1", type: "audio", assetId: "as4", start: 0, duration: 90, in: 0, speed: 1, volume: 1, transform: DEFAULT_TRANSFORM, slot: { name: "music" } } },
    ]),
  ).doc;
  return d;
}

describe("slotsOf", () => {
  it("lists slots in track then start order with kinds and hints", () => {
    expect(slotsOf(build())).toEqual([
      { name: "hero_clip", kind: "visual", hint: "hero", filled: true, clipIds: ["c1"] },
      { name: "second", kind: "visual", filled: true, clipIds: ["c2"] },
      { name: "title", kind: "text", filled: true, clipIds: ["t1"] },
      { name: "music", kind: "audio", filled: true, clipIds: ["a1"] },
    ]);
  });

  it("marks a media slot unfilled while any of its clips is a placeholder", () => {
    const t = toTemplateDoc(build());
    const s = slotsOf(t);
    expect(s.map((x) => [x.name, x.kind, x.filled])).toEqual([
      ["hero_clip", "visual", false],
      ["second", "visual", false],
      ["title", "text", true],
      ["music", "audio", false],
    ]);
  });

  it("groups clips under one name and reports mixed kinds", () => {
    const d = build();
    d.tracks[1].clips.push({ id: "t2", type: "text", text: "x", style, start: 100, duration: 10, transform: DEFAULT_TRANSFORM, slot: { name: "hero_clip" } });
    const s = slotsOf(d).find((x) => x.name === "hero_clip")!;
    expect(s.kind).toBe("visual");
    expect(s.clipIds).toEqual(["c1", "t2"]);
    expect(mixedSlots(d)).toEqual(["hero_clip"]);
    expect(mixedSlots(build())).toEqual([]);
  });
});

describe("toTemplateDoc", () => {
  it("turns slotted media into placeholders and leaves the rest", () => {
    const d = build();
    const t = toTemplateDoc(d);
    const v = t.tracks[0].clips;
    expect(v[1]).toMatchObject({ id: "c2", type: "placeholder", accepts: "visual", start: 100, duration: 50, slot: { name: "second" } });
    expect(v[0]).toMatchObject({ id: "c1", type: "placeholder", accepts: "visual", slot: { name: "hero_clip", hint: "hero" } });
    expect(v[2].type).toBe("video");
    expect(t.tracks[1].clips[0].type).toBe("text");
    expect(t.tracks[2].clips[0]).toMatchObject({ type: "placeholder", accepts: "audio" });
    expect(Object.keys(v[0]).sort()).toEqual(["accepts", "duration", "id", "slot", "start", "transform", "type"]);
  });

  it("does not mutate its input", () => {
    const d = build();
    const before = structuredClone(d);
    const t = toTemplateDoc(d);
    expect(d).toEqual(before);
    expect(t).not.toBe(d);
  });
});
