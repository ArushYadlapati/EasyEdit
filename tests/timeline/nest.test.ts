import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSFORM, applyOps, describe as describeDoc, everyClip, expandNests, hasNests, nestFrame, nestLength, nestName, nestProblem, nestTracks, prepareOps,
  type MediaClip, type NestClip, type OpInput, type TimelineDoc,
} from "@/lib/timeline";
import { sampleDoc, text, video } from "../editor/fixtures";

// A nest of two tracks: a video a (0–60, from its file's frame 30) then b (60–120), and a title over the first second.
// It is 120 frames long inside. As given it sits at frame 100 of the project and plays all of itself.
function nest(over: Partial<NestClip> = {}): NestClip {
  return {
    id: "n1", type: "nest", start: 100, duration: 120, in: 0, volume: 1, transform: { ...DEFAULT_TRANSFORM },
    tracks: [
      { id: "v1", kind: "video", name: "Video 1", muted: false, hidden: false, locked: false, clips: [video("a", 0, 60, { in: 30 }), video("b", 60, 60)] as never },
      { id: "t1", kind: "text", name: "Text 1", muted: false, hidden: false, locked: false, clips: [text("x", 0, 30, { text: "Hello" })] as never },
    ],
    ...over,
  };
}
// The sample project with the nest on its video track after c1 and c2 (which end at 60).
function withNest(n: NestClip = nest()): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [...d.tracks[0].clips, n];
  return d;
}
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const nestOf = (d: TimelineDoc) => d.tracks[0].clips.find((c) => c.type === "nest") as NestClip;

describe("what a nest is", () => {
  it("is as long as the end of its last clip, and named for what it holds unless it has a name", () => {
    expect(nestLength(nest())).toBe(120);
    expect(nestName(nest())).toBe("Nest of 3 clips");
    expect(nestName(nest({ name: "Intro" }))).toBe("Intro");
    expect(nestFrame(nest({ in: 20 }), 130)).toBe(50); // 30 frames in, from frame 20 of its own timeline
  });
  it("is sound when it holds something on tracks that take it, without overlap, and plays a part that is there", () => {
    expect(nestProblem(nest())).toBeNull();
    expect(nestProblem(nest({ in: 20, duration: 100 }))).toBeNull();
    expect(nestProblem(nest({ in: 20, duration: 120 }))).toMatch(/plays to frame 140 of a timeline 120 frames long/);
    expect(nestProblem(nest({ tracks: [{ ...nest().tracks[0], clips: [] }] }))).toMatch(/at least one clip/);
    const overlap = nest();
    overlap.tracks[0].clips = [video("a", 0, 60), video("b", 50, 60)] as never;
    expect(nestProblem(overlap)).toMatch(/"a" and "b" overlap/);
    const wrong = nest();
    wrong.tracks[1].clips = [video("x", 0, 30)] as never;
    expect(nestProblem(wrong)).toMatch(/text track "t1" does not take the video clip "x"/);
    const twice = nest();
    twice.tracks[1].clips = [text("a", 0, 30)] as never;
    expect(nestProblem(twice)).toMatch(/ids of their own/);
  });
});

describe("a nest's tracks, for drawing it", () => {
  it("name each clip with the nest's id before its own, and are the same list each time", () => {
    const n = nest();
    const tracks = nestTracks(n);
    expect(tracks.map((t) => t.clips.map((c) => c.id))).toEqual([["n1/a", "n1/b"], ["n1/x"]]);
    expect(tracks[0].clips[0]).toMatchObject({ start: 0, duration: 60, in: 30 }); // on the nest's own timeline
    expect(nestTracks(n)).toBe(tracks);
  });
});

describe("a project with its nests laid out", () => {
  const laid = (n: NestClip = nest(), change: (d: TimelineDoc) => void = () => {}) => {
    const d = withNest(n);
    change(d);
    return expandNests(d);
  };
  const row = (d: TimelineDoc, id: string) => d.tracks.find((t) => t.id === id)!.clips.map((c) => [c.id, c.start, c.duration, (c as MediaClip).in]);

  it("puts each clip where the nest plays it, on a track of its own after the nest's track", () => {
    const d = laid();
    expect(d.tracks.map((t) => t.id).slice(0, 3)).toEqual(["v1", "n1/v1", "n1/t1"]);
    expect(row(d, "n1/v1")).toEqual([["n1/a", 100, 60, 30], ["n1/b", 160, 60, 0]]);
    expect(row(d, "n1/t1")).toEqual([["n1/x", 100, 30, undefined]]);
    // The nest stays where it is, and the project it came from is not touched.
    expect(d.tracks[0].clips.map((c) => c.type)).toEqual(["video", "video", "nest"]);
    expect(withNest().tracks).toHaveLength(d.tracks.length - 2);
  });
  it("cuts a clip to the part the nest plays, on the same footage, and drops what it does not reach", () => {
    // Frames 40 to 100 of the nest: the last 20 of a, the first 40 of b, and none of the title.
    const d = laid(nest({ in: 40, duration: 60 }));
    expect(row(d, "n1/v1")).toEqual([["n1/a", 100, 20, 70], ["n1/b", 120, 40, 0]]);
    expect(row(d, "n1/t1")).toEqual([]);
  });
  it("takes a way in off a clip cut at its start, a way out off one cut at its end, and moves keyframes with the cut", () => {
    const n = nest({ in: 10, duration: 40 });
    n.tracks[0].clips = [video("a", 0, 60, { fadeIn: 5, fadeOut: 6, transitionIn: { kind: "fade", frames: 4 }, keyframes: { opacity: [{ at: 0, value: 0 }, { at: 30, value: 1 }] } })] as never;
    const [a] = expandNests(withNest(n)).tracks.find((t) => t.id === "n1/v1")!.clips as MediaClip[];
    expect([a.fadeIn, a.fadeOut, a.transitionIn]).toEqual([undefined, undefined, undefined]);
    expect(a.keyframes!.opacity).toEqual([{ at: -10, value: 0 }, { at: 20, value: 1 }]);
    expect([a.start, a.duration, a.in]).toEqual([100, 40, 10]);
  });
  it("hides and mutes its tracks with the nest's own, and makes them as loud as the nest and its track", () => {
    const quiet = laid(nest({ volume: 0.5 }), (d) => void (d.tracks[0].volume = 0.5));
    expect(quiet.tracks.find((t) => t.id === "n1/v1")).toMatchObject({ volume: 0.25, hidden: false, muted: false, locked: true });
    const hidden = laid(nest(), (d) => void Object.assign(d.tracks[0], { hidden: true, muted: true }));
    expect(hidden.tracks.find((t) => t.id === "n1/t1")).toMatchObject({ hidden: true, muted: true });
    const inner = nest();
    inner.tracks[1].hidden = true;
    expect(laid(inner).tracks.find((t) => t.id === "n1/t1")!.hidden).toBe(true);
  });
  it("is the project itself when it has no nest, and is not laid out twice", () => {
    const plain = sampleDoc();
    expect(expandNests(plain)).toBe(plain);
    expect(hasNests(plain)).toBe(false);
    const once = laid();
    expect(expandNests(once)).toBe(once);
    expect(everyClip(withNest()).map((c) => c.id)).toEqual(["c1", "c2", "n1", "a", "b", "x", "x1", "x2"]);
  });
});

describe("a nest in the ops", () => {
  const add = (n: NestClip): OpInput[] => [{ op: "add_clip", trackId: "v1", clip: n }];
  it("is added whole, undone whole, and only where a nest may go", () => {
    const added = run(sampleDoc(), add(nest()));
    expect(nestOf(added.doc)).toEqual(nest());
    expect(applyOps(added.doc, added.inverse).doc).toEqual(sampleDoc());
    expect(() => run(sampleDoc(), [{ op: "add_clip", trackId: "t1", clip: nest({ start: 200 }) }])).toThrow();
    expect(() => run(sampleDoc(), add(nest({ start: 30 })))).toThrow(); // over c2
  });
  it("is refused when it is not sound, or holds a clip that could not be added on its own", () => {
    expect(() => run(sampleDoc(), add(nest({ duration: 130 })))).toThrow(/nest "n1" is invalid: it plays to frame 130/);
    const backward = nest();
    backward.tracks[0].clips = [{ ...video("a", 0, 60), type: "audio", speed: -1 }] as never;
    expect(() => run(sampleDoc(), add(backward))).toThrow();
    const spans = nest();
    spans.tracks[1].clips = [{ ...text("x", 0, 30, { text: "hi" }), spans: [{ from: 0, to: 9, fontWeight: 700 }] }] as never;
    expect(() => run(sampleDoc(), add(spans))).toThrow(/spans are invalid/);
    // No nest in a nest, and no empty slot.
    const deep = nest();
    deep.tracks[0].clips = [nest({ id: "n2", start: 0 })] as never;
    expect(() => run(sampleDoc(), add(deep))).toThrow();
  });
  it("trims through its own timeline: the start moves what it plays from, and neither end leaves what it holds", () => {
    const d = withNest(nest({ in: 20, duration: 80 }));
    const later = run(d, [{ op: "trim_clip", clipId: "n1", edge: "start", to: 110 }]);
    expect(nestOf(later.doc)).toMatchObject({ start: 110, duration: 70, in: 30 });
    expect(applyOps(later.doc, later.inverse).doc).toEqual(d);
    const earlier = run(d, [{ op: "trim_clip", clipId: "n1", edge: "start", to: 80 }]).doc;
    expect(nestOf(earlier)).toMatchObject({ start: 80, duration: 100, in: 0 });
    expect(() => run(d, [{ op: "trim_clip", clipId: "n1", edge: "start", to: 79 }])).toThrow(/cannot start before the start of what it holds/);
    expect(nestOf(run(d, [{ op: "trim_clip", clipId: "n1", edge: "end", to: 200 }]).doc)).toMatchObject({ duration: 100 });
    expect(() => run(d, [{ op: "trim_clip", clipId: "n1", edge: "end", to: 201 }])).toThrow(/cannot play past the end of what it holds/);
  });
  it("splits into two nests that each hold everything, the second playing on from the cut", () => {
    const d = withNest();
    const cut = run(d, [{ op: "split_clip", clipId: "n1", at: 150, newClipId: "n2" }]);
    const [left, right] = cut.doc.tracks[0].clips.filter((c) => c.type === "nest") as NestClip[];
    expect([left.id, left.start, left.duration, left.in]).toEqual(["n1", 100, 50, 0]);
    expect([right.id, right.start, right.duration, right.in]).toEqual(["n2", 150, 70, 50]);
    expect(right.tracks).toEqual(left.tracks);
    // Their clips are told apart by the nest they are in.
    const laid = expandNests(cut.doc);
    expect(laid.tracks.filter((t) => t.id.includes("/v1")).map((t) => t.clips.map((c) => [c.id, c.start, c.duration]))).toEqual([
      [["n1/a", 100, 50]],
      [["n2/a", 150, 10], ["n2/b", 160, 60]],
    ]);
    expect(applyOps(cut.doc, cut.inverse).doc).toEqual(d);
  });
  it("takes a volume, a name, a place, colours and a mask, and not new contents or a crop keyframe", () => {
    const d = withNest();
    const set = run(d, [{ op: "update_clip", clipId: "n1", patch: { volume: 0.5, name: "Intro", transform: { scale: 0.5 }, adjust: { saturation: -1 }, mask: { shape: "ellipse", x: 0.5, y: 0.5, width: 0.5, height: 0.5, feather: 0 }, keyframes: { opacity: [{ at: 0, value: 0 }, { at: 10, value: 1 }] } } }]);
    expect(nestOf(set.doc)).toMatchObject({ volume: 0.5, name: "Intro", adjust: { saturation: -1 }, transform: { scale: 0.5 } });
    // Undone, each is back at what having none means, and the undo survives being stored and read back.
    const undone = nestOf(applyOps(set.doc, JSON.parse(JSON.stringify(set.inverse))).doc);
    expect(undone).toMatchObject({ volume: 1, name: null, adjust: { saturation: 0 }, mask: null, transform: { scale: 1 }, keyframes: { opacity: [] } });
    expect(nestName(undone)).toBe("Nest of 3 clips");
    expect(() => run(d, [{ op: "update_clip", clipId: "n1", patch: { tracks: [] } as never }])).toThrow();
    expect(() => run(d, [{ op: "update_clip", clipId: "n1", patch: { keyframes: { cropLeft: [{ at: 0, value: 0.1 }] } } }])).toThrow(/a nest takes no crop keyframes/);
    expect(() => run(d, [{ op: "update_clip", clipId: "n1", patch: { in: 50 } }])).toThrow(/plays to frame 170/);
    expect(() => run(d, [{ op: "update_clip", clipId: "n1", patch: { sound: { gate: 0.5 } } }])).toThrow(/"sound" is not allowed on a nest clip/);
  });
  it("is listed for agents with what it holds", () => {
    const listed = describeDoc(withNest(nest({ name: "Intro" })), { detail: true });
    expect(listed).toContain('nest  3.33–7.33s');
    expect(listed).toContain('"Intro" 3 clips in=0.00s of 4.00s vol=1');
    expect(listed).toContain('in video "Video 1": a  video');
    expect(listed).toContain('in text "Text 1": x  text');
    expect(describeDoc(withNest())).toContain("n1  nest");
  });
});
