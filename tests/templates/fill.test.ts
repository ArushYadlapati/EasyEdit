import { describe, expect, it } from "vitest";
import { fillSlots, type FillAsset } from "@/lib/templates/fill";
import { DEFAULT_TRANSFORM, applyOps, createEmptyDoc, prepareOps, toTemplateDoc, type TimelineDoc } from "@/lib/timeline";

const style = { fontFamily: "Inter", fontSize: 96, fontWeight: 800, color: "#FFFFFF", align: "center" } as const;
const T = { ...DEFAULT_TRANSFORM, x: 0.3 };

function template(): TimelineDoc {
  let d = createEmptyDoc("short_9x16");
  d.tracks = [];
  d = applyOps(
    d,
    prepareOps([
      { op: "add_track", track: { id: "v", kind: "video", name: "V" } },
      { op: "add_track", track: { id: "t", kind: "text", name: "T" } },
      { op: "add_track", track: { id: "a", kind: "audio", name: "A" } },
      { op: "add_clip", trackId: "v", clip: { id: "c1", type: "video", assetId: "old", start: 10, duration: 240, in: 0, speed: 1, volume: 1, transform: T, slot: { name: "hero_clip" } } },
      { op: "add_clip", trackId: "t", clip: { id: "t1", type: "text", text: "Hi", style, start: 0, duration: 60, transform: DEFAULT_TRANSFORM, slot: { name: "title" } } },
      { op: "add_clip", trackId: "t", clip: { id: "t2", type: "text", text: "Hi", style, start: 70, duration: 60, transform: DEFAULT_TRANSFORM, slot: { name: "title" } } },
      { op: "add_clip", trackId: "a", clip: { id: "a1", type: "audio", assetId: "oldm", start: 0, duration: 240, in: 0, speed: 1, volume: 1, transform: DEFAULT_TRANSFORM, slot: { name: "music" } } },
    ]),
  ).doc;
  return toTemplateDoc(d);
}

const assets = new Map<string, FillAsset>([
  ["vid3", { id: "vid3", kind: "video", durationFrames: 90 }],
  ["vid20", { id: "vid20", kind: "video", durationFrames: 600 }],
  ["vidnull", { id: "vidnull", kind: "video", durationFrames: null }],
  ["img", { id: "img", kind: "image", durationFrames: null }],
  ["aud", { id: "aud", kind: "audio", durationFrames: 1000 }],
]);

const ok = (r: ReturnType<typeof fillSlots>) => {
  if ("error" in r) throw new Error(r.error);
  return r.ops;
};
const shortOf = (r: ReturnType<typeof fillSlots>) => {
  if ("error" in r) throw new Error(r.error);
  return r.short;
};
const err = (r: ReturnType<typeof fillSlots>) => ("error" in r ? r.error : null);

describe("fillSlots", () => {
  it("updates every text clip with the name", () => {
    const ops = ok(fillSlots(template(), [{ slot: "title", text: "New" }], assets));
    expect(ops).toEqual([
      { op: "update_clip", clipId: "t1", patch: { text: "New" } },
      { op: "update_clip", clipId: "t2", patch: { text: "New" } },
    ]);
  });

  it("fills a placeholder keeping id, start, transform and slot; one undo restores it", () => {
    const doc = template();
    const before = structuredClone(doc);
    const ops = ok(fillSlots(doc, [{ slot: "hero_clip", assetId: "vid20", inFrames: 5 }], assets));
    expect(ops[0]).toEqual({ op: "remove_clip", clipId: "c1" });
    expect(ops[1]).toMatchObject({
      op: "add_clip",
      trackId: "v",
      clip: { id: "c1", type: "video", assetId: "vid20", start: 10, duration: 240, in: 5, speed: 1, volume: 1, transform: T, slot: { name: "hero_clip" } },
    });
    expect(doc).toEqual(before);
    const r = applyOps(doc, prepareOps(ops));
    expect(r.doc.tracks[0].clips[0]).toMatchObject({ id: "c1", type: "video", assetId: "vid20" });
    const undone = applyOps(r.doc, r.inverse);
    expect(undone.doc.tracks[0].clips[0]).toEqual(before.tracks[0].clips[0]);
  });

  it("trims a short video to the footage, and rejects a start past the end", () => {
    const ops = ok(fillSlots(template(), [{ slot: "hero_clip", assetId: "vid3" }], assets));
    expect(ops[1]).toMatchObject({ clip: { duration: 90, in: 0 } });
    const ops2 = ok(fillSlots(template(), [{ slot: "hero_clip", assetId: "vid3", inFrames: 30 }], assets));
    expect(ops2[1]).toMatchObject({ clip: { duration: 60, in: 30 } });
    expect(err(fillSlots(template(), [{ slot: "hero_clip", assetId: "vid3", inFrames: 90 }], assets))).toBe(
      "hero_clip: the footage has nothing left after the start point",
    );
    expect(err(fillSlots(template(), [{ slot: "hero_clip", assetId: "vid3", inFrames: 500 }], assets))).toContain("hero_clip");
  });

  it("reports a slot the footage does not cover, with where the footage ends", () => {
    expect(shortOf(fillSlots(template(), [{ slot: "hero_clip", assetId: "vid3", inFrames: 30 }], assets))).toEqual([
      { slot: "hero_clip", filledFrames: 60, slotFrames: 240, trackId: "v", endFrame: 70 },
    ]);
    expect(shortOf(fillSlots(template(), [{ slot: "hero_clip", assetId: "vid20" }], assets))).toEqual([]);
    expect(shortOf(fillSlots(template(), [{ slot: "hero_clip", assetId: "img" }], assets))).toEqual([]);
  });

  it("uses the slot duration when the footage length is unknown, and for images", () => {
    expect(ok(fillSlots(template(), [{ slot: "hero_clip", assetId: "vidnull" }], assets))[1]).toMatchObject({ clip: { duration: 240 } });
    expect(ok(fillSlots(template(), [{ slot: "hero_clip", assetId: "img" }], assets))[1]).toMatchObject({ clip: { type: "image", duration: 240 } });
  });

  it("fills an already-filled media slot too", () => {
    const filled = applyOps(template(), prepareOps(ok(fillSlots(template(), [{ slot: "hero_clip", assetId: "img" }], assets)))).doc;
    const ops = ok(fillSlots(filled, [{ slot: "hero_clip", assetId: "vid20" }], assets));
    expect(ops[1]).toMatchObject({ clip: { id: "c1", type: "video", assetId: "vid20" } });
  });

  it("checks kinds", () => {
    const d = template();
    expect(err(fillSlots(d, [{ slot: "hero_clip", assetId: "aud" }], assets))).toBe("hero_clip takes a video or image");
    expect(err(fillSlots(d, [{ slot: "music", assetId: "img" }], assets))).toBe("music takes audio");
    expect(err(fillSlots(d, [{ slot: "music", assetId: "vid20" }], assets))).toBe("music takes audio");
    expect(ok(fillSlots(d, [{ slot: "music", assetId: "aud" }], assets))[1]).toMatchObject({ clip: { type: "audio", duration: 240 } });
    expect(err(fillSlots(d, [{ slot: "hero_clip", text: "x" }], assets))).toBe("hero_clip takes a video or image");
    expect(err(fillSlots(d, [{ slot: "music", text: "x" }], assets))).toBe("music takes audio");
    expect(err(fillSlots(d, [{ slot: "title", assetId: "img" }], assets))).toBe("title takes text");
  });

  it("reports bad fills", () => {
    const d = template();
    expect(err(fillSlots(d, [{ slot: "title" }], assets))).toBe("title: give text or a media id");
    expect(err(fillSlots(d, [{ slot: "title", text: "x", assetId: "img" }], assets))).toBe("title: give text or a media id");
    expect(err(fillSlots(d, [{ slot: "hero_clip", assetId: "nope" }], assets))).toBe("No media with id nope");
    expect(err(fillSlots(d, [{ slot: "title", text: "a" }, { slot: "title", text: "b" }], assets))).toBe("title is listed twice");
    expect(err(fillSlots(d, [{ slot: "nope", text: "a" }], assets))).toBe("No slot named nope. Slots: hero_clip, title, music");
    expect(err(fillSlots(createEmptyDoc("short_9x16"), [{ slot: "nope", text: "a" }], assets))).toBe("This project has no slots");
  });

  it("fills on a hidden track, and applyOps throws TRACK_LOCKED on a locked one", () => {
    const hidden = applyOps(template(), [{ op: "update_track", trackId: "v", patch: { hidden: true } }]).doc;
    const ops = ok(fillSlots(hidden, [{ slot: "hero_clip", assetId: "img" }], assets));
    expect(() => applyOps(hidden, prepareOps(ops))).not.toThrow();
    const locked = applyOps(template(), [{ op: "update_track", trackId: "v", patch: { locked: true } }]).doc;
    const lops = ok(fillSlots(locked, [{ slot: "hero_clip", assetId: "img" }], assets));
    expect(() => applyOps(locked, prepareOps(lops))).toThrowError(expect.objectContaining({ code: "TRACK_LOCKED" }));
  });
});
