import { describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/limits";
import { OpError, TimelineDoc, applyOps, createEmptyDoc, prepareOps, type Op, type TimelineDoc as Doc } from "@/lib/timeline";

const doc0 = () => createEmptyDoc("short_9x16");
const withGuides = (...guides: { id: string; axis: "x" | "y"; at: number }[]): Doc => ({ ...doc0(), guides });

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof OpError ? e.code : "not an OpError";
  }
}

describe("guide ops", () => {
  it("add_guide creates the list and its inverse removes it", () => {
    const { doc, inverse } = applyOps(doc0(), [{ op: "add_guide", guide: { id: "g1", axis: "x", at: 0.5 } }]);
    expect(doc.guides).toEqual([{ id: "g1", axis: "x", at: 0.5 }]);
    expect(inverse).toEqual([{ op: "remove_guide", guideId: "g1", expect: { guide: { id: "g1", axis: "x", at: 0.5 } } }]);
  });

  it("add_guide appends after the guides already there", () => {
    const { doc } = applyOps(withGuides({ id: "g1", axis: "x", at: 0.5 }), [{ op: "add_guide", guide: { id: "g2", axis: "y", at: 0.25 } }]);
    expect(doc.guides?.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("move_guide sets at, and its inverse moves it back", () => {
    const { doc, inverse } = applyOps(withGuides({ id: "g1", axis: "y", at: 0.5 }), [{ op: "move_guide", guideId: "g1", at: 0.3 }]);
    expect(doc.guides).toEqual([{ id: "g1", axis: "y", at: 0.3 }]);
    expect(inverse).toEqual([{ op: "move_guide", guideId: "g1", at: 0.5, expect: { at: 0.3 } }]);
  });

  it("remove_guide drops the field with the last guide, and its inverse adds it back", () => {
    const before = withGuides({ id: "g1", axis: "x", at: 0.2 });
    const { doc, inverse } = applyOps(before, [{ op: "remove_guide", guideId: "g1" }]);
    expect("guides" in doc).toBe(false);
    expect(inverse).toEqual([{ op: "add_guide", guide: { id: "g1", axis: "x", at: 0.2 }, index: 0 }]);
    expect(applyOps(doc, inverse).doc).toEqual(before);
  });

  it("undoing a removal puts the guide back in its place in the list", () => {
    const before = withGuides({ id: "g1", axis: "x", at: 0.2 }, { id: "g2", axis: "y", at: 0.9 });
    const { doc, inverse } = applyOps(before, [{ op: "remove_guide", guideId: "g1" }]);
    expect(inverse).toEqual([{ op: "add_guide", guide: { id: "g1", axis: "x", at: 0.2 }, index: 0 }]);
    expect(applyOps(doc, inverse).doc.guides?.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  it("undoing a removal still works after a teammate removed another guide", () => {
    const four = withGuides(...["a", "b", "c", "d"].map((id) => ({ id, axis: "x" as const, at: 0.5 })));
    const mine = applyOps(four, [{ op: "remove_guide", guideId: "d" }]);
    const theirs = applyOps(mine.doc, [{ op: "remove_guide", guideId: "a" }]).doc;
    expect(applyOps(theirs, mine.inverse).doc.guides?.map((g) => g.id)).toEqual(["b", "c", "d"]);
  });

  it("a round trip through the inverse gives back the document", () => {
    const before = withGuides({ id: "g1", axis: "x", at: 0.2 }, { id: "g2", axis: "y", at: 0.9 });
    const ops: Op[] = [
      { op: "add_guide", guide: { id: "g3", axis: "y", at: 0.1 } },
      { op: "move_guide", guideId: "g1", at: 0.6 },
      { op: "remove_guide", guideId: "g2" },
    ];
    const { doc, inverse } = applyOps(before, ops);
    expect(applyOps(doc, inverse).doc).toEqual(before);
  });

  it("refuses a used id, a missing guide, a stale expect and too many guides", () => {
    const one = withGuides({ id: "g1", axis: "x", at: 0.5 });
    expect(codeOf(() => applyOps(one, [{ op: "add_guide", guide: { id: "g1", axis: "y", at: 0.1 } }]))).toBe("DUPLICATE_ID");
    expect(codeOf(() => applyOps(one, [{ op: "move_guide", guideId: "nope", at: 0.1 }]))).toBe("NOT_FOUND");
    expect(codeOf(() => applyOps(one, [{ op: "remove_guide", guideId: "nope" }]))).toBe("NOT_FOUND");
    expect(codeOf(() => applyOps(one, [{ op: "move_guide", guideId: "g1", at: 0.1, expect: { at: 0.4 } }]))).toBe("STALE");
    const full = withGuides(...Array.from({ length: LIMITS.guidesPerProject }, (_, i) => ({ id: `g${i}`, axis: "x" as const, at: 0.5 })));
    expect(codeOf(() => applyOps(full, [{ op: "add_guide", guide: { id: "more", axis: "x", at: 0.5 } }]))).toBe("LIMIT_EXCEEDED");
  });

  it("keeps a guide's position inside the frame", () => {
    expect(codeOf(() => prepareOps([{ op: "add_guide", guide: { axis: "x", at: 1.2 } }]))).toBe("INVALID");
    expect(codeOf(() => prepareOps([{ op: "move_guide", guideId: "g1", at: -0.1 }]))).toBe("INVALID");
  });

  it("gives a new guide an id when the input has none", () => {
    const [op] = prepareOps([{ op: "add_guide", guide: { axis: "y", at: 0.4 } }], () => "made");
    expect(op).toEqual({ op: "add_guide", guide: { id: "made", axis: "y", at: 0.4 } });
  });

  it("a document without guides still parses", () => {
    expect(TimelineDoc.safeParse(doc0()).success).toBe(true);
    expect(TimelineDoc.safeParse(withGuides({ id: "g1", axis: "x", at: 0.5 })).success).toBe(true);
  });
});
