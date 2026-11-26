import { describe, expect, it } from "vitest";
import { findClip } from "@/lib/editor/store";
import { applyOps, describe as describeDoc, prepareOps, remapSpans, spanAt, spanHas, spansProblem, styleSpan, type OpInput, type TextClip, type TextSpan, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, text } from "../editor/fixtures";

const bold = (from: number, to: number): TextSpan => ({ from, to, fontWeight: 700 });
const red = (from: number, to: number): TextSpan => ({ from, to, color: "#ff0000" });

describe("which spans a text can have", () => {
  it("are inside it, at least a character long, in order without overlapping, each changing something", () => {
    expect(spansProblem("hello world", [bold(0, 5), red(6, 11)])).toBeNull();
    expect(spansProblem("hello", [])).toBeNull();
    expect(spansProblem("hello", [bold(3, 3)])).toMatch(/empty/);
    expect(spansProblem("hello", [bold(2, 9)])).toMatch(/past the text's 5 characters/);
    expect(spansProblem("hello world", [bold(0, 6), red(5, 8)])).toMatch(/must not overlap/);
    expect(spansProblem("hello world", [red(6, 8), bold(0, 2)])).toMatch(/in order/);
    expect(spansProblem("hello", [{ from: 0, to: 2 }])).toMatch(/changes nothing/);
  });
});

describe("spans when the words change", () => {
  // "the big robot": big is bold.
  const before = "the big robot";
  const spans = [bold(4, 7)];
  it("stay on their words when something is typed before them, and stay put when it is typed after", () => {
    expect(remapSpans(before, "see the big robot", spans)).toEqual([bold(8, 11)]);
    expect(remapSpans(before, "the big robot wins", spans)).toEqual([bold(4, 7)]);
    expect(remapSpans(before, before, spans)).toEqual(spans);
  });
  it("grow with what is typed inside them, and not with what is typed at their end", () => {
    expect(remapSpans(before, "the biiig robot", spans)).toEqual([bold(4, 9)]);
    expect(remapSpans(before, "the bigger robot", spans)).toEqual([bold(4, 7)]);
  });
  it("shrink when part of them is deleted, and go when all of them is", () => {
    expect(remapSpans(before, "the bg robot", spans)).toEqual([bold(4, 6)]);
    expect(remapSpans(before, "the robot", spans)).toEqual([]);
    expect(remapSpans(before, "the b robot", spans)).toEqual([bold(4, 5)]);
  });
  it("follow a replacement that reaches into them, and are dropped when the whole text is replaced", () => {
    // "big" typed over with "tiny": the span covered all that was replaced, and stays on what replaced it.
    expect(remapSpans("the big robot", "the tiny robot", [bold(4, 7)])).toEqual([bold(4, 8)]);
    // A change that only reaches into a span leaves it the part that was not touched.
    expect(remapSpans("the big robot", "the biXXbot", [bold(4, 7)])).toEqual([bold(4, 6)]);
    expect(remapSpans("the big robot", "thXXig robot", [bold(4, 7)])).toEqual([bold(4, 6)]);
    // Typing just before a span, or just after it, is not in it.
    expect(remapSpans("the big robot", "the very big robot", [bold(4, 7)])).toEqual([bold(9, 12)]);
    expect(remapSpans(before, "something else", spans)).toEqual([]);
    expect(remapSpans(before, "", spans)).toEqual([]);
  });
  it("keep several in order, and join two that come to touch with the same look", () => {
    const two = [bold(0, 3), bold(8, 13)];
    expect(remapSpans(before, "the robot", two)).toEqual([bold(0, 3), bold(4, 9)]);
    // Deleting " big " leaves "therobot": the two bold stretches now touch, and are one.
    expect(remapSpans(before, "therobot", two)).toEqual([bold(0, 8)]);
    expect(remapSpans(before, "therobot", [bold(0, 3), red(8, 13)])).toEqual([bold(0, 3), red(3, 8)]);
  });
});

describe("giving a stretch a look", () => {
  it("makes a span, and widens one of the same look beside it", () => {
    expect(styleSpan([], 4, 7, { fontWeight: 700 })).toEqual([bold(4, 7)]);
    expect(styleSpan([bold(4, 7)], 7, 13, { fontWeight: 700 })).toEqual([bold(4, 13)]);
    expect(styleSpan([], 5, 5, { fontWeight: 700 })).toEqual([]);
  });
  it("adds to what is there, cutting a span at the stretch's edges", () => {
    // Red laid over the middle of a bold stretch.
    expect(styleSpan([bold(0, 10)], 3, 6, { color: "#ff0000" })).toEqual([bold(0, 3), { from: 3, to: 6, fontWeight: 700, color: "#ff0000" }, bold(6, 10)]);
    // And over a stretch that is only partly bold.
    expect(styleSpan([bold(0, 4)], 2, 8, { italic: true })).toEqual([bold(0, 2), { from: 2, to: 4, fontWeight: 700, italic: true }, { from: 4, to: 8, italic: true }]);
  });
  it("takes one look off a stretch and leaves its others, or clears it", () => {
    const both = [{ from: 0, to: 10, fontWeight: 700, color: "#ff0000" }];
    expect(styleSpan(both, 0, 10, { fontWeight: undefined })).toEqual([red(0, 10)]);
    expect(styleSpan(both, 4, 6, "clear")).toEqual([{ from: 0, to: 4, fontWeight: 700, color: "#ff0000" }, { from: 6, to: 10, fontWeight: 700, color: "#ff0000" }]);
    expect(styleSpan([bold(2, 5)], 0, 9, { fontWeight: undefined })).toEqual([]);
  });
  it("says whether all of a stretch has a look, and which span a character is in", () => {
    expect([spanHas([bold(2, 8)], 3, 6, "fontWeight", 700), spanHas([bold(2, 8)], 0, 6, "fontWeight", 700), spanHas([], 0, 0, "fontWeight", 700)]).toEqual([true, false, false]);
    expect([spanAt([bold(2, 8)], 2), spanAt([bold(2, 8)], 8), spanAt(null, 0)]).toEqual([bold(2, 8), null, null]);
  });
});

describe("spans in the ops", () => {
  const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
  const x1 = (d: TimelineDoc) => findClip(d, "x1")!.clip as TextClip;
  const titled = (words = "the big robot") => {
    const d = sampleDoc();
    d.tracks[1].clips = [text("x1", 0, 60, { text: words })];
    return d;
  };
  const set = (spans: TextSpan[] | null): OpInput[] => [{ op: "update_clip", clipId: "x1", patch: { spans } }];

  it("are set whole, undone to none, and refused when they do not fit the words", () => {
    const styled = run(titled(), set([bold(4, 7)]));
    expect(x1(styled.doc).spans).toEqual([bold(4, 7)]);
    expect(x1(applyOps(styled.doc, styled.inverse).doc).spans).toBeNull();
    expect(() => run(titled(), set([bold(4, 99)]))).toThrow(/spans are invalid: a span ends at 99/);
    expect(() => run(titled(), set([bold(4, 7), red(6, 9)]))).toThrow(/must not overlap/);
    expect(() => run(titled(), set([{ from: 0, to: 3, color: "red" } as never]))).toThrow();
    expect(() => run(titled(), set([{ from: 0, to: 3, size: 90 } as never]))).toThrow();
    expect(() => run(sampleDoc(), [{ op: "update_clip", clipId: "c1", patch: { spans: [bold(0, 1)] } }])).toThrow(/"spans" is not allowed on a video clip/);
  });
  it("move with the words when only the words are changed, and the undo puts both back", () => {
    const styled = run(titled(), set([bold(4, 7)])).doc;
    const typed = run(styled, [{ op: "update_clip", clipId: "x1", patch: { text: "see the big robot" } }]);
    expect([x1(typed.doc).text, x1(typed.doc).spans]).toEqual(["see the big robot", [bold(8, 11)]]);
    expect(applyOps(typed.doc, typed.inverse).doc).toEqual(styled);
    // Words that no longer hold the span: it goes, and comes back with them.
    const gone = run(styled, [{ op: "update_clip", clipId: "x1", patch: { text: "new words" } }]);
    expect(x1(gone.doc).spans).toBeNull();
    expect(applyOps(gone.doc, gone.inverse).doc).toEqual(styled);
  });
  it("are what the op says when it names both the words and the spans", () => {
    const styled = run(titled(), set([bold(4, 7)])).doc;
    const both = run(styled, [{ op: "update_clip", clipId: "x1", patch: { text: "a red robot", spans: [red(2, 5)] } }]).doc;
    expect(x1(both).spans).toEqual([red(2, 5)]);
    expect(() => run(styled, [{ op: "update_clip", clipId: "x1", patch: { text: "hi", spans: [red(2, 5)] } }])).toThrow(/past the text's 2 characters/);
  });
  it("come with a new clip, and are listed for agents", () => {
    const added = run(titled(), [{ op: "add_clip", trackId: "t1", clip: { ...text("x9", 100, 30, { text: "go team" }), spans: [red(3, 7)] } as never }]).doc;
    expect((findClip(added, "x9")!.clip as TextClip).spans).toEqual([red(3, 7)]);
    expect(() => run(titled(), [{ op: "add_clip", trackId: "t1", clip: { ...text("x9", 100, 30, { text: "go" }), spans: [red(3, 7)] } as never }])).toThrow(/spans are invalid/);
    expect(describeDoc(added, { detail: true })).toContain('spans=[{"from":3,"to":7,"color":"#ff0000"}]');
    expect(describeDoc(titled(), { detail: true })).not.toContain("spans=");
  });
});
