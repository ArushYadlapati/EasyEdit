import { describe, expect, it } from "vitest";
import { placeAtOps, syncPlan } from "@/lib/editor/sound-sync";
import { applyOps, prepareOps, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// v1 [c1 60–240] · a1 [m1 30–270, m2 300–390]
function takes(change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("c1", 60, 180)];
  d.tracks[3].clips = [video("m1", 30, 240, { type: "audio", assetId: "song" }), video("m2", 300, 90, { type: "audio", assetId: "song" })];
  change(d);
  return d;
}
const clipOf = (d: TimelineDoc, id: string) => d.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as MediaClip;

describe("which clip stays", () => {
  it("is the first video, and the other sounding clips move to it", () => {
    const plan = syncPlan(takes(), ["m1", "c1", "m2", "x1"])!;
    expect([plan.stays.clip.id, plan.moves.map((m) => m.clip.id), plan.skipped]).toEqual(["c1", ["m1", "m2"], 0]);
  });
  it("with no video is the earliest clip", () => {
    expect(syncPlan(takes(), ["m2", "m1"])!.stays.clip.id).toBe("m1");
  });
  it("leaves out a clip that plays faster, slower or backward, and needs two that are left", () => {
    const plan = syncPlan(takes((d) => void ((clipOf(d, "m2") as MediaClip).speed = 2)), ["c1", "m1", "m2"])!;
    expect([plan.moves.map((m) => m.clip.id), plan.skipped]).toEqual([["m1"], 1]);
    expect(syncPlan(takes((d) => void ((clipOf(d, "m1") as MediaClip).speed = -1)), ["c1", "m1"])).toBeNull();
    expect(syncPlan(takes(), ["c1"])).toBeNull();
    expect(syncPlan(takes(), ["c1", "x1"])).toBeNull();
  });
});

describe("putting a clip where it belongs", () => {
  const run = (d: TimelineDoc, id: string, start: number) => applyOps(d, prepareOps(placeAtOps(clipOf(d, id), start)!));
  it("moves it, and does nothing when it is there already", () => {
    expect(placeAtOps(clipOf(takes(), "m1"), 0)).toEqual([{ op: "move_clip", clipId: "m1", start: 0 }]);
    expect(placeAtOps(clipOf(takes(), "m1"), 30)).toEqual([]);
  });
  it("a place before the timeline's start keeps the clip's later part, from frame 0, on the same footage", () => {
    const d = takes();
    const after = run(d, "m1", -45).doc;
    // 45 frames fall before the start: the clip begins 45 frames into its file and is that much shorter.
    expect(clipOf(after, "m1")).toMatchObject({ start: 0, in: 45, duration: 195 });
    expect(applyOps(after, run(d, "m1", -45).inverse).doc).toEqual(d);
    // A clip already at frame 0 loses its first frames and stays at 0.
    const atZero = takes((x) => void (clipOf(x, "m1").start = 0));
    expect(clipOf(run(atZero, "m1", -10).doc, "m1")).toMatchObject({ start: 0, in: 10, duration: 230 });
  });
  it("is nothing when none of the clip would be left", () => {
    expect(placeAtOps(clipOf(takes(), "m1"), -240)).toBeNull();
    expect(placeAtOps(clipOf(takes(), "m1"), -239)).not.toBeNull();
  });
});
