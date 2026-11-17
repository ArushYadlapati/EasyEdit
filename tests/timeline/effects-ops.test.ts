import { describe, expect, it } from "vitest";
import { DEFAULT_TRANSFORM, applyOps, prepareOps, type Op, type TimelineDoc } from "@/lib/timeline";
import type { Clip, MediaClip, TextClip } from "@/lib/timeline/types";
import { docWithCaptions } from "../helpers/docs";

const doc0 = () => docWithCaptions("short_9x16");
const clip = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: "video",
    assetId: "a",
    start,
    duration,
    in: 0,
    speed: 1,
    volume: 1,
    transform: { ...DEFAULT_TRANSFORM },
    ...extra,
  }) as Clip;
const audioClip = (id: string, start: number, duration: number) =>
  ({ ...clip(id, start, duration), type: "audio" }) as Clip;
const textClip = (id: string, start: number, duration: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    type: "text",
    start,
    duration,
    transform: { ...DEFAULT_TRANSFORM },
    text: "hi",
    style: { fontFamily: "Inter", fontSize: 64, fontWeight: 700, color: "#fff", align: "center" },
    ...extra,
  }) as Clip;

// Inverse ops are stored and sent as JSON, so an undo must still work after the trip.
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));

function withClips(clips: { trackId: string; clip: Clip }[]): TimelineDoc {
  return applyOps(
    doc0(),
    clips.map(({ trackId, clip }) => ({ op: "add_clip", trackId, clip })),
  ).doc;
}
function find(doc: TimelineDoc, id: string): Clip {
  for (const t of doc.tracks) for (const c of t.clips) if (c.id === id) return c;
  throw new Error(`no clip ${id}`);
}
function refused(fn: () => unknown, message: RegExp) {
  expect(fn).toThrow(expect.objectContaining({ name: "OpError", code: "INVALID", message: expect.stringMatching(message) }));
}

describe("effects: update_clip undo survives JSON", () => {
  it("adding a transition is undone after JSON", () => {
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60) }]);
    const { doc, inverse } = applyOps(d, [
      { op: "update_clip", clipId: "c1", patch: { transitionIn: { kind: "fade", frames: 15 } } },
    ]);
    expect(find(doc, "c1")).toMatchObject({ transitionIn: { kind: "fade", frames: 15 } });
    const undone = applyOps(doc, roundTrip(inverse)).doc;
    const c = find(undone, "c1") as MediaClip;
    expect(c.transitionIn ?? null).toBeNull();
  });

  it("first keyframe is undone after JSON", () => {
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60) }]);
    const { doc, inverse } = applyOps(d, [
      { op: "update_clip", clipId: "c1", patch: { keyframes: { x: [{ at: 0, value: 0.2 }] } } },
    ]);
    expect(find(doc, "c1").keyframes?.x).toEqual([{ at: 0, value: 0.2 }]);
    const undone = applyOps(doc, roundTrip(inverse)).doc;
    expect(find(undone, "c1").keyframes?.x ?? []).toEqual([]);
  });

  it("an animation and emphasis on a text clip are undone after JSON", () => {
    const d = withClips([{ trackId: "t1", clip: textClip("t", 0, 60) }]);
    const { doc, inverse } = applyOps(d, [
      {
        op: "update_clip",
        clipId: "t",
        patch: { animationIn: { preset: "pop", frames: 10 }, emphasis: { preset: "shake" } },
      },
    ]);
    const undone = find(applyOps(doc, roundTrip(inverse)).doc, "t") as TextClip;
    expect(undone.animationIn ?? null).toBeNull();
    expect(undone.emphasis ?? null).toBeNull();
  });

  it("patching one property keeps the others", () => {
    const x = [{ at: 0, value: 0.2 }, { at: 30, value: 0.8 }];
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60, { keyframes: { x } }) }]);
    const { doc, inverse } = applyOps(d, [
      { op: "update_clip", clipId: "c1", patch: { keyframes: { scale: [{ at: 0, value: 1.2 }] } } },
    ]);
    expect(find(doc, "c1").keyframes).toEqual({ x, scale: [{ at: 0, value: 1.2 }] });
    // The undo touches only scale, so a teammate's later change to x would survive it.
    expect(roundTrip(inverse)).toEqual([
      {
        op: "update_clip",
        clipId: "c1",
        patch: { keyframes: { scale: [] } },
        expect: { keyframes: { scale: [{ at: 0, value: 1.2 }] } },
      },
    ]);
    const undone = find(applyOps(doc, roundTrip(inverse)).doc, "c1");
    expect(undone.keyframes?.x).toEqual(x);
    expect(undone.keyframes?.scale ?? []).toEqual([]);
  });

  it("the undo ops still parse as ops", () => {
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60) }]);
    const { inverse } = applyOps(d, [
      {
        op: "update_clip",
        clipId: "c1",
        patch: { transitionOut: { kind: "dip", frames: 8 }, keyframes: { opacity: [{ at: 0, value: 0 }] } },
      },
    ]);
    expect(() => prepareOps(roundTrip(inverse))).not.toThrow();
  });
});

describe("effects: fields that do not fit the clip", () => {
  it("a transition on an audio clip is refused", () => {
    const d = withClips([{ trackId: "a1", clip: audioClip("s", 0, 60) }]);
    refused(
      () => applyOps(d, [{ op: "update_clip", clipId: "s", patch: { transitionIn: { kind: "fade", frames: 15 } } }]),
      /"transitionIn" is not allowed on a.* audio clip/,
    );
  });

  it("keyframes on an audio clip are refused", () => {
    const d = withClips([{ trackId: "a1", clip: audioClip("s", 0, 60) }]);
    refused(
      () => applyOps(d, [{ op: "update_clip", clipId: "s", patch: { keyframes: { x: [{ at: 0, value: 0 }] } } }]),
      /"keyframes" is not allowed on a.* audio clip/,
    );
  });

  it("an animation on a video clip is refused", () => {
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60) }]);
    refused(
      () => applyOps(d, [{ op: "update_clip", clipId: "c1", patch: { animationIn: { preset: "fade", frames: 10 } } }]),
      /"animationIn" is not allowed on a.* video clip/,
    );
  });

  it("a transition on a text clip is refused", () => {
    const d = withClips([{ trackId: "t1", clip: textClip("t", 0, 60) }]);
    refused(
      () => applyOps(d, [{ op: "update_clip", clipId: "t", patch: { transitionOut: { kind: "fade", frames: 10 } } }]),
      /"transitionOut" is not allowed on a.* text clip/,
    );
  });

  it("emphasis on text is accepted", () => {
    const d = withClips([{ trackId: "t1", clip: textClip("t", 0, 60) }]);
    const { doc } = applyOps(d, [
      { op: "update_clip", clipId: "t", patch: { emphasis: { preset: "highlight_word", color: "#FFD400" } } },
    ]);
    expect(find(doc, "t")).toMatchObject({ emphasis: { preset: "highlight_word", color: "#FFD400" } });
  });

  it("an unknown key is still refused", () => {
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60) }]);
    refused(() => applyOps(d, [{ op: "update_clip", clipId: "c1", patch: { transitionn: null } }]), /patch is invalid/);
  });

  it("add_clip refuses an audio clip with a transition and a video clip with emphasis", () => {
    refused(
      () => applyOps(doc0(), [{ op: "add_clip", trackId: "a1", clip: { ...audioClip("s", 0, 60), transitionIn: { kind: "fade", frames: 5 } } as Clip }]),
      /add_clip: "transitionIn" is not allowed on a.* audio clip/,
    );
    refused(
      () => applyOps(doc0(), [{ op: "add_clip", trackId: "v1", clip: clip("c1", 0, 60, { emphasis: { preset: "pulse" } }) }]),
      /add_clip: "emphasis" is not allowed on a.* video clip/,
    );
  });
});

describe("effects: trim and split", () => {
  it("trim start shifts keyframes and undo restores them", () => {
    const x = [{ at: 0, value: 0.1 }, { at: 30, value: 0.9 }];
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60, { keyframes: { x } }) }]);
    const { doc, inverse } = applyOps(d, [{ op: "trim_clip", clipId: "c1", edge: "start", to: 10 }]);
    expect(find(doc, "c1").keyframes?.x?.map((k) => k.at)).toEqual([-10, 20]);
    const undone = applyOps(doc, roundTrip(inverse)).doc;
    expect(find(undone, "c1").keyframes?.x).toEqual(x);
    expect(undone).toEqual(d);
  });

  it("trim end leaves keyframes alone", () => {
    const x = [{ at: 0, value: 0.1 }, { at: 30, value: 0.9 }];
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60, { keyframes: { x } }) }]);
    const { doc } = applyOps(d, [{ op: "trim_clip", clipId: "c1", edge: "end", to: 40 }]);
    expect(find(doc, "c1").keyframes?.x).toEqual(x);
  });

  it("split hands transitions to the right halves", () => {
    const fade = { kind: "fade", frames: 10 };
    const dip = { kind: "dip", frames: 8, color: "#000000" };
    const x = [{ at: 0, value: 0.1 }, { at: 40, value: 0.9 }];
    const d = withClips([
      { trackId: "v1", clip: clip("c1", 0, 60, { transitionIn: fade, transitionOut: dip, keyframes: { x } }) },
    ]);
    const { doc } = applyOps(d, [{ op: "split_clip", clipId: "c1", at: 30, newClipId: "c2" }]);
    const left = find(doc, "c1");
    const right = find(doc, "c2");
    expect(left).toMatchObject({ transitionIn: fade, transitionOut: null, keyframes: { x } });
    expect(right).toMatchObject({ transitionIn: null, transitionOut: dip });
    expect(right.keyframes?.x?.map((k) => k.at)).toEqual([-30, 10]);
  });

  it("split hands text animations to the right halves and keeps emphasis on both", () => {
    const d = withClips([
      {
        trackId: "t1",
        clip: textClip("t", 0, 60, {
          animationIn: { preset: "pop", frames: 10 },
          animationOut: { preset: "fade", frames: 10 },
          emphasis: { preset: "pulse" },
        }),
      },
    ]);
    const { doc, inverse } = applyOps(d, [{ op: "split_clip", clipId: "t", at: 20, newClipId: "t2" }]);
    expect(find(doc, "t")).toMatchObject({ animationIn: { preset: "pop" }, animationOut: null, emphasis: { preset: "pulse" } });
    expect(find(doc, "t2")).toMatchObject({ animationIn: null, animationOut: { preset: "fade" }, emphasis: { preset: "pulse" } });
    expect(applyOps(doc, roundTrip(inverse)).doc).toEqual(d);
  });

  it("split then undo restores the clip exactly", () => {
    const d = withClips([
      {
        trackId: "v1",
        clip: clip("c1", 0, 60, {
          transitionIn: { kind: "crossfade", frames: 12 },
          transitionOut: { kind: "slide", frames: 9, direction: "up" },
          keyframes: { scale: [{ at: 5, value: 1 }, { at: 50, value: 1.15, ease: "ease_in_out" }] },
        }),
      },
    ]);
    const { doc, inverse } = applyOps(d, [{ op: "split_clip", clipId: "c1", at: 25, newClipId: "c2" }]);
    const undone = applyOps(doc, roundTrip(inverse)).doc;
    expect(find(undone, "c1")).toStrictEqual(find(d, "c1"));
    expect(undone).toEqual(d);
  });

  it("splitting a clip with no effects adds no effect fields", () => {
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60) }]);
    const { doc, inverse } = applyOps(d, [{ op: "split_clip", clipId: "c1", at: 30, newClipId: "c2" }]);
    expect(Object.keys(find(doc, "c1"))).toEqual(Object.keys(find(d, "c1")));
    expect(Object.keys(find(doc, "c2"))).toEqual(Object.keys(find(d, "c1")));
    expect(inverse).toHaveLength(2);
  });
});

describe("effects: expect", () => {
  it("expect on transitionIn", () => {
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60) }]);
    const fade = { kind: "fade", frames: 15 } as const;
    const { doc } = applyOps(d, [
      { op: "update_clip", clipId: "c1", patch: { transitionIn: fade }, expect: { transitionIn: null } },
    ]);
    expect(find(doc, "c1")).toMatchObject({ transitionIn: fade });
    expect(() =>
      applyOps(doc, [
        { op: "update_clip", clipId: "c1", patch: { transitionIn: { kind: "zoom", frames: 5 } }, expect: { transitionIn: null } },
      ]),
    ).toThrow(expect.objectContaining({ code: "STALE" }));
  });

  it("expect on a keyframe list that is not there yet", () => {
    const d = withClips([{ trackId: "v1", clip: clip("c1", 0, 60) }]);
    const { doc } = applyOps(d, [
      {
        op: "update_clip",
        clipId: "c1",
        patch: { keyframes: { y: [{ at: 0, value: 0.3 }] } },
        expect: { keyframes: { y: [] } },
      },
    ]);
    expect(find(doc, "c1").keyframes?.y).toEqual([{ at: 0, value: 0.3 }]);
  });

  it("the new expect fields parse", () => {
    expect(() =>
      prepareOps([
        {
          op: "update_clip",
          clipId: "c1",
          patch: {},
          expect: {
            keyframes: { x: [] },
            transitionIn: null,
            transitionOut: { kind: "fade", frames: 3 },
            animationIn: null,
            animationOut: null,
            emphasis: { preset: "shake" },
          },
        },
      ]),
    ).not.toThrow();
  });
});
