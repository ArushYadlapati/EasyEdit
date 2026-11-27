import { describe, expect, it } from "vitest";
import { DEFAULT_TRANSFORM, OpError, applyOps, type CaptionClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { docWithCaptions } from "../helpers/docs";

const cap = (extra: Partial<CaptionClip> = {}): CaptionClip => ({ id: "k1", type: "caption", assetId: "a", start: 0, duration: 90, transform: { ...DEFAULT_TRANSFORM }, ...extra });
const run = (doc: TimelineDoc, ops: OpInput[]) => applyOps(doc, ops as never).doc;
const code = (doc: TimelineDoc, ops: OpInput[]) => {
  try {
    applyOps(doc, ops as never);
    return null;
  } catch (error) {
    return error instanceof OpError ? error.code : String(error);
  }
};

describe("caption clips in the ops", () => {
  it("go on the Captions track and nowhere else, and nothing else goes there", () => {
    const d = docWithCaptions("short_9x16");
    const after = run(d, [{ op: "add_clip", trackId: "cap", clip: cap() }]);
    expect(after.tracks.find((t) => t.id === "cap")!.clips).toEqual([cap()]);
    expect(code(d, [{ op: "add_clip", trackId: "v1", clip: cap() }])).toBe("WRONG_TRACK_KIND");
    expect(code(d, [{ op: "add_clip", trackId: "cap", clip: { id: "x", type: "text", start: 0, duration: 30, transform: DEFAULT_TRANSFORM, text: "hi", style: { fontFamily: "Geist", fontSize: 40, fontWeight: 400, color: "#fff", align: "center" } } }])).toBe("WRONG_TRACK_KIND");
  });

  it("take no effects", () => {
    const d = docWithCaptions("short_9x16");
    expect(code(d, [{ op: "add_clip", trackId: "cap", clip: { ...cap(), keyframes: { opacity: [] } } as never }])).not.toBeNull();
    const after = run(d, [{ op: "add_clip", trackId: "cap", clip: cap() }]);
    expect(code(after, [{ op: "update_clip", clipId: "k1", patch: { transitionIn: { kind: "fade", duration: 10 } } } as never])).not.toBeNull();
  });

  it("split, trim, move and delete like any clip; a locked Captions track holds them", () => {
    let d = run(docWithCaptions("short_9x16"), [{ op: "add_clip", trackId: "cap", clip: cap() }]);
    d = run(d, [{ op: "split_clip", clipId: "k1", at: 30, newClipId: "k2" }]);
    expect(d.tracks.find((t) => t.id === "cap")!.clips.map((c) => [c.id, c.start, c.duration, c.type === "caption" && c.assetId])).toEqual([
      ["k1", 0, 30, "a"],
      ["k2", 30, 60, "a"],
    ]);
    d = run(d, [{ op: "move_clip", clipId: "k2", start: 40 }]);
    d = run(d, [{ op: "remove_clip", clipId: "k1" }]);
    expect(d.tracks.find((t) => t.id === "cap")!.clips.map((c) => [c.id, c.start])).toEqual([["k2", 40]]);
    d = run(d, [{ op: "update_track", trackId: "cap", patch: { locked: true } }]);
    expect(code(d, [{ op: "remove_clip", clipId: "k2" }])).toBe("TRACK_LOCKED");
  });
});
