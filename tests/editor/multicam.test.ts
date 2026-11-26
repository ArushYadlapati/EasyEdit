import { describe, expect, it } from "vitest";
import { angleSoundOps, anglesOf, cutToAngleOps, shownAngle, soundAngle } from "@/lib/editor/multicam";
import { applyOps, prepareOps, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "./fixtures";

// Three cameras on the same ten seconds: A on the main track, B and C on overlay tracks above it (C on top).
function doc(change: (d: TimelineDoc) => void = () => {}): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("a", 0, 300, { assetId: "camA" })];
  d.tracks[1].clips = [];
  const overlay = (id: string, name: string, clip: ReturnType<typeof video>) => ({ id, kind: "overlay" as const, name, muted: false, hidden: false, locked: false, clips: [clip] });
  d.tracks.splice(1, 0, overlay("o1", "Camera B", video("b", 0, 300, { assetId: "camB" })), overlay("o2", "Camera C", video("c", 30, 200, { assetId: "camC" })));
  change(d);
  return d;
}
const ALL = ["a", "b", "c"];
const ids = () => {
  let n = 0;
  return () => `g${++n}`;
};
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops)).doc;
// Each angle's clips as "start-end:opacity".
const rows = (d: TimelineDoc) => Object.fromEntries(["v1", "o1", "o2"].map((id) => [id, d.tracks.find((t) => t.id === id)!.clips.map((c) => `${c.start}-${c.start + c.duration}:${c.transform.opacity}`)]));
const cut = (d: TimelineDoc, trackId: string, frame: number, gen = ids()) => {
  const made = cutToAngleOps(d, anglesOf(d, d.tracks.flatMap((t) => t.clips.filter((c) => c.type === "video").map((c) => c.id))), trackId, frame, gen);
  if (!made.ok) throw new Error(made.why);
  return run(d, made.ops);
};

describe("the angles", () => {
  it("are the tracks that hold the videos picked, from the top row down", () => {
    expect(anglesOf(doc(), ALL)).toEqual([{ trackId: "o2", name: "Camera C" }, { trackId: "o1", name: "Camera B" }, { trackId: "v1", name: "Video 1" }]);
    expect(anglesOf(doc(), ["a", "b"]).map((a) => a.trackId)).toEqual(["o1", "v1"]);
    expect(anglesOf(doc(), ["a", "x1"])).toHaveLength(1);
    expect(anglesOf(doc(), [])).toEqual([]);
  });
});

describe("cutting to an angle", () => {
  it("a first cut shows the angle picked from the playhead to the end of its footage, and hides the others there", () => {
    const after = cut(doc(), "o1", 90);
    expect(rows(after)).toEqual({ v1: ["0-90:1", "90-300:0"], o1: ["0-300:1"], o2: ["30-90:1", "90-230:0"] });
    expect(shownAngle(after, anglesOf(after, ["a", "b", "c", "g1", "g2"]), 120)).toBe("o1");
  });
  it("hides a camera that only starts later, too: it does not come back in over the angle picked", () => {
    const after = cut(doc(), "v1", 0);
    expect(rows(after)).toEqual({ v1: ["0-300:1"], o1: ["0-300:0"], o2: ["30-230:0"] });
    const angles = anglesOf(after, ALL);
    expect([0, 29, 30, 150, 299].map((frame) => shownAngle(after, angles, frame))).toEqual(["v1", "v1", "v1", "v1", "v1"]);
  });
  it("cut after cut makes a programme: each stretch shows one angle, and the footage stays in step", () => {
    const gen = ids();
    let d = cut(doc(), "v1", 0, gen); // open on camera A
    d = cut(d, "o2", 60, gen); // to C
    d = cut(d, "o1", 120, gen); // to B
    d = cut(d, "v1", 180, gen); // back to A
    const angles = anglesOf(d, d.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    expect([10, 70, 130, 200].map((frame) => shownAngle(d, angles, frame))).toEqual(["v1", "o2", "o1", "v1"]);
    // No frame of any camera moved: every piece still plays its file from where it sits.
    for (const track of d.tracks.filter((t) => t.kind !== "text" && t.kind !== "caption" && t.kind !== "audio")) {
      const first = track.clips[0] as MediaClip;
      for (const clip of track.clips as MediaClip[]) expect(clip.in - first.in).toBe(clip.start - first.start);
    }
  });
  it("a cut made between two others changes only the stretch up to the next change of angle", () => {
    const gen = ids();
    let d = cut(doc(), "v1", 0, gen);
    d = cut(d, "o1", 100, gen);
    // Back at 50, to C: only frames 50 to 100 change.
    d = cut(d, "o2", 50, gen);
    const angles = anglesOf(d, d.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    expect([20, 60, 99, 100, 200].map((frame) => shownAngle(d, angles, frame))).toEqual(["v1", "o2", "o2", "o1", "o1"]);
  });
  it("cuts nothing at a clip's own start, and nothing at all when the angle already shows", () => {
    const made = cutToAngleOps(doc(), anglesOf(doc(), ALL), "v1", 0, ids());
    expect(made).toMatchObject({ ok: true, newClipIds: [] }); // A and B start at 0, and C lies wholly inside the stretch
    expect(made.ok && made.ops).toEqual([{ op: "update_clip", clipId: "c", patch: { transform: { opacity: 0 } } }, { op: "update_clip", clipId: "b", patch: { transform: { opacity: 0 } } }]);
    const shown = cut(doc(), "v1", 0);
    expect(cutToAngleOps(shown, anglesOf(shown, ALL), "v1", 50, ids())).toEqual({ ok: false, why: "already" });
  });
  it("undoes as one change", () => {
    const made = cutToAngleOps(doc(), anglesOf(doc(), ALL), "o1", 90, ids());
    if (!made.ok) throw new Error(made.why);
    const applied = applyOps(doc(), prepareOps(made.ops));
    expect(applyOps(applied.doc, applied.inverse).doc).toEqual(doc());
    expect(made.newClipIds).toEqual(["g1", "g2"]);
  });
  it("is refused with one angle, where the angle has no footage, or when a track it would change is locked", () => {
    expect(cutToAngleOps(doc(), anglesOf(doc(), ["a"]), "v1", 90, ids())).toEqual({ ok: false, why: "one-angle" });
    expect(cutToAngleOps(doc(), anglesOf(doc(), ALL), "t1", 90, ids())).toEqual({ ok: false, why: "one-angle" });
    expect(cutToAngleOps(doc(), anglesOf(doc(), ALL), "o2", 10, ids())).toEqual({ ok: false, why: "nothing-here" }); // camera C starts at 30
    const locked = doc((d) => void (d.tracks[0].locked = true));
    expect(cutToAngleOps(locked, anglesOf(locked, ALL), "o1", 90, ids())).toEqual({ ok: false, why: "locked" });
  });
});

describe("the programme's sound", () => {
  it("comes from one angle: the others are made silent, and a silent one picked is turned back on", () => {
    const angles = anglesOf(doc(), ALL);
    expect(soundAngle(doc(), ALL, angles)).toBeNull(); // all three sound
    const ops = angleSoundOps(doc(), ALL, angles, "v1");
    expect(ops).toEqual([{ op: "update_clip", clipId: "c", patch: { volume: 0 } }, { op: "update_clip", clipId: "b", patch: { volume: 0 } }]);
    const after = run(doc(), ops);
    expect(soundAngle(after, ALL, angles)).toBe("v1");
    expect(angleSoundOps(after, ALL, angles, "v1")).toEqual([]);
    const toB = run(after, angleSoundOps(after, ALL, angles, "o1"));
    expect(soundAngle(toB, ALL, angles)).toBe("o1");
    expect((toB.tracks[1].clips[0] as MediaClip).volume).toBe(1);
  });
  it("keeps a volume that was set, and changes only the clips given", () => {
    const quiet = doc((d) => void ((d.tracks[0].clips[0] as MediaClip).volume = 0.4));
    const angles = anglesOf(quiet, ALL);
    expect(angleSoundOps(quiet, ALL, angles, "v1").map((op) => (op as { clipId: string }).clipId)).toEqual(["c", "b"]);
    expect(angleSoundOps(quiet, ["a", "b"], angles, "v1")).toEqual([{ op: "update_clip", clipId: "b", patch: { volume: 0 } }]);
  });
});
