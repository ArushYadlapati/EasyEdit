import { describe, expect, it } from "vitest";
import { DEFAULT_TRANSFORM, VOLUME_MAX, applyOps, prepareOps, type Op, type TimelineDoc } from "@/lib/timeline";
import type { Clip, MediaClip } from "@/lib/timeline/types";
import { docWithCaptions } from "../helpers/docs";

// v1 holds a video clip c1 (frames 0 to 60), a1 an audio clip m1 (0 to 60), t1 a text clip x1.
const media = (id: string, type: MediaClip["type"], extra: Record<string, unknown> = {}) =>
  ({ id, type, assetId: "a", start: 0, duration: 60, in: 0, speed: 1, volume: 1, transform: { ...DEFAULT_TRANSFORM }, ...extra }) as Clip;
const text = { id: "x1", type: "text", start: 0, duration: 60, transform: { ...DEFAULT_TRANSFORM }, text: "hi", style: { fontFamily: "Inter", fontSize: 64, fontWeight: 700, color: "#fff", align: "center" } } as Clip;

function start(video: Record<string, unknown> = {}, audio: Record<string, unknown> = {}): TimelineDoc {
  const d = docWithCaptions("short_9x16");
  return applyOps(d, [
    { op: "add_clip", trackId: "v1", clip: media("c1", "video", video) },
    { op: "add_clip", trackId: "a1", clip: media("m1", "audio", audio) },
    { op: "add_clip", trackId: "t1", clip: text },
  ]).doc;
}
const find = (d: TimelineDoc, id: string) => d.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as MediaClip;
const patch = (clipId: string, p: Record<string, unknown>): Op[] => prepareOps([{ op: "update_clip", clipId, patch: p }]);
// Inverse ops are stored and sent as JSON, so an undo must still work after the trip.
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));

describe("volume", () => {
  it("goes from silent to four times as recorded, and no further", () => {
    expect(VOLUME_MAX).toBe(4);
    expect(find(applyOps(start(), patch("c1", { volume: 4 })).doc, "c1").volume).toBe(4);
    expect(find(applyOps(start(), patch("m1", { volume: 0 })).doc, "m1").volume).toBe(0);
    expect(() => applyOps(start(), patch("c1", { volume: 4.01 }))).toThrow(/volume/);
    expect(() => applyOps(start(), patch("c1", { volume: -0.1 }))).toThrow(/volume/);
  });
});

describe("sound fades", () => {
  it("sets a fade on a video or an audio clip, and undoes back to none", () => {
    for (const id of ["c1", "m1"]) {
      const before = start();
      const { doc, inverse } = applyOps(before, patch(id, { fadeIn: 15, fadeOut: 30 }));
      expect(find(doc, id)).toMatchObject({ fadeIn: 15, fadeOut: 30 });
      expect(inverse).toEqual([{ op: "update_clip", clipId: id, patch: { fadeIn: 0, fadeOut: 0 }, expect: { fadeIn: 15, fadeOut: 30 } }]);
      const undone = applyOps(doc, roundTrip(inverse)).doc;
      expect(find(undone, id)).toMatchObject({ fadeIn: 0, fadeOut: 0 }); // 0 means none, the same as the field being absent
    }
  });

  it("takes whole frames from 0 up, and may be longer than the clip (it is cut to fit where it is heard)", () => {
    expect(find(applyOps(start(), patch("c1", { fadeIn: 500 })).doc, "c1").fadeIn).toBe(500);
    expect(() => applyOps(start(), patch("c1", { fadeIn: -1 }))).toThrow(/fadeIn/);
    expect(() => applyOps(start(), patch("c1", { fadeOut: 1.5 }))).toThrow(/fadeOut/);
  });

  it("is refused on a clip with no sound of its own", () => {
    expect(() => applyOps(start(), patch("x1", { fadeIn: 10 }))).toThrow('"fadeIn" is not allowed on a text clip');
    const image = applyOps(docWithCaptions("short_9x16"), [{ op: "add_clip", trackId: "v1", clip: media("i1", "image") }]).doc;
    expect(() => applyOps(image, patch("i1", { fadeOut: 10 }))).toThrow('"fadeOut" is not allowed on an image clip');
    expect(() => applyOps(docWithCaptions("short_9x16"), [{ op: "add_clip", trackId: "v1", clip: media("i1", "image", { fadeIn: 5 }) }])).toThrow(
      '"fadeIn" is not allowed on an image clip',
    );
  });

  it("is compared by expect like any other field, a missing one counting as 0", () => {
    const d = start();
    expect(() => applyOps(d, prepareOps([{ op: "update_clip", clipId: "c1", patch: { fadeIn: 10 }, expect: { fadeIn: 0 } }]))).not.toThrow();
    expect(() => applyOps(d, prepareOps([{ op: "update_clip", clipId: "c1", patch: { fadeIn: 10 }, expect: { fadeIn: 5 } }]))).toThrow();
  });

  it("a split leaves the fade in on the left piece and the fade out on the right one, and undo puts the clip back", () => {
    const before = start({ fadeIn: 10, fadeOut: 20 });
    const { doc, inverse } = applyOps(before, [{ op: "split_clip", clipId: "c1", at: 30, newClipId: "c2" }]);
    expect(find(doc, "c1")).toMatchObject({ duration: 30, fadeIn: 10, fadeOut: 0 });
    expect(find(doc, "c2")).toMatchObject({ start: 30, duration: 30, fadeIn: 0, fadeOut: 20 });
    expect(applyOps(doc, roundTrip(inverse)).doc).toEqual(before);
  });

  it("a split of a clip with no fades adds no fade fields", () => {
    const { doc } = applyOps(start(), [{ op: "split_clip", clipId: "m1", at: 30, newClipId: "m2" }]);
    expect("fadeIn" in find(doc, "m1") || "fadeOut" in find(doc, "m1")).toBe(false);
    expect("fadeIn" in find(doc, "m2") || "fadeOut" in find(doc, "m2")).toBe(false);
  });
});

describe("an audio clip of a video's sound", () => {
  it("goes on an audio track like any audio clip, and not on a video track", () => {
    // The engine does not know what kind of file an asset id names; the server's media check allows this pairing.
    const d = docWithCaptions("short_9x16");
    expect(() => applyOps(d, [{ op: "add_clip", trackId: "a1", clip: media("s1", "audio", { assetId: "a-video-file" }) }])).not.toThrow();
    expect(() => applyOps(d, [{ op: "add_clip", trackId: "v1", clip: media("s1", "audio", { assetId: "a-video-file" }) }])).toThrow();
  });
});
