import { describe, expect, it } from "vitest";
import { packBytes } from "@/lib/color/cube";
import { LIMITS } from "@/lib/limits";
import { findClip } from "@/lib/editor/store";
import { ADJUST_KEYS, NO_ADJUST, NO_STYLE, NO_TONE, STYLE_KEYS, TONE_KEYS, applyOps, describe as describeDoc, isAdjusted, isStyled, isToned, prepareOps, type Lut, type MediaClip, type Op, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc, video } from "../editor/fixtures";

const c1 = (d: TimelineDoc) => findClip(d, "c1")!.clip as MediaClip;
const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops));
const patch = (clipId: string, p: Record<string, unknown>, expect?: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId, patch: p, ...(expect && { expect }) } as OpInput];
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));
const lut = (id: string | undefined, size = 2, name = "Film"): Omit<Lut, "id"> & { id?: string } => ({ ...(id && { id }), name, size, data: packBytes(new Uint8Array(size ** 3 * 3).fill(7)) });

describe("stylised effects in the ops", () => {
  it("are colour changes like the rest: set one at a time, 0 until set, undone to 0", () => {
    expect(ADJUST_KEYS).toEqual([...TONE_KEYS, ...STYLE_KEYS]);
    expect(Object.keys(NO_ADJUST)).toEqual([...ADJUST_KEYS]);
    const set = run(sampleDoc(), patch("c1", { adjust: { grain: 0.4, pixelate: 12 } }));
    expect(c1(set.doc).adjust).toEqual({ grain: 0.4, pixelate: 12 });
    expect([isStyled(c1(set.doc).adjust), isToned(c1(set.doc).adjust), isAdjusted(c1(set.doc).adjust)]).toEqual([true, false, true]);
    const undone = applyOps(set.doc, roundTrip(set.inverse)).doc;
    expect(c1(undone).adjust).toEqual({ grain: 0, pixelate: 0 });
    expect(isStyled(c1(undone).adjust)).toBe(false);
  });
  it("stay in range, on pictures only", () => {
    const d = sampleDoc();
    for (const key of ["sharpen", "grain", "split", "glitch", "vhs"]) {
      expect(() => run(d, patch("c1", { adjust: { [key]: 1.5 } }))).toThrow(new RegExp(key));
      expect(() => run(d, patch("c1", { adjust: { [key]: -0.1 } }))).toThrow(new RegExp(key));
    }
    expect(() => run(d, patch("c1", { adjust: { pixelate: 201 } }))).toThrow(/pixelate/);
    expect(() => run(d, patch("x1", { adjust: { grain: 0.2 } }))).toThrow(/"adjust" is not allowed on a text clip/);
  });
  it("each kind is taken off without touching the other", () => {
    const both = run(sampleDoc(), patch("c1", { adjust: { brightness: 0.3, blur: 4, vhs: 0.5, sharpen: 1 } })).doc;
    const plainStyle = run(both, patch("c1", { adjust: { ...NO_STYLE } })).doc;
    expect([isToned(c1(plainStyle).adjust), isStyled(c1(plainStyle).adjust)]).toEqual([true, false]);
    const plainTone = run(both, patch("c1", { adjust: { ...NO_TONE } })).doc;
    expect([isToned(c1(plainTone).adjust), isStyled(c1(plainTone).adjust)]).toEqual([false, true]);
  });
  it("are listed for agents", () => {
    const d = run(sampleDoc(), patch("c1", { adjust: { glitch: 0.5, hue: 10 } })).doc;
    expect(describeDoc(d, { detail: true })).toContain('adjust={"hue":10,"glitch":0.5}');
  });
});

describe("a grade in the ops", () => {
  const wheel = { x: 0.3, y: -0.2, level: 0.1 };
  const bend = [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }];

  it("sets one part at a time and keeps the others", () => {
    const one = run(sampleDoc(), patch("c1", { grade: { lift: wheel } })).doc;
    const two = run(one, patch("c1", { grade: { curve: bend } })).doc;
    expect(c1(two).grade).toEqual({ lift: wheel, curve: bend });
  });
  it("undoes each part to its rest, and redoes it", () => {
    const set = run(sampleDoc(), patch("c1", { grade: { gain: wheel, curveR: bend, lut: "L1", lutAmount: 0.5 } }));
    const undone = applyOps(set.doc, roundTrip(set.inverse));
    expect(c1(undone.doc).grade).toEqual({ gain: { x: 0, y: 0, level: 0 }, curveR: [], lut: null, lutAmount: 1 });
    expect(c1(applyOps(undone.doc, roundTrip(undone.inverse)).doc).grade).toEqual({ gain: wheel, curveR: bend, lut: "L1", lutAmount: 0.5 });
  });
  it("an expect guards one part, and a part never set counts as its rest", () => {
    const guarded = patch("c1", { grade: { gamma: wheel } }, { grade: { gamma: { x: 0, y: 0, level: 0 } } });
    const after = run(sampleDoc(), guarded).doc;
    expect(c1(after).grade?.gamma).toEqual(wheel);
    expect(() => run(after, guarded)).toThrow();
    expect(() => run(sampleDoc(), patch("c1", { grade: { lutAmount: 0.3 } }, { grade: { lutAmount: 1, curve: [] } }))).not.toThrow();
  });
  it("refuses a puck outside its circle, a curve out of order or of one point, and anything but a picture", () => {
    const d = sampleDoc();
    d.tracks[3].clips = [video("m1", 0, 30, { type: "audio" })];
    expect(() => run(d, patch("c1", { grade: { lift: { x: 0.9, y: 0.9, level: 0 } } }))).toThrow(/inside its circle/);
    expect(() => run(d, patch("c1", { grade: { lift: { x: 0, y: 0, level: 2 } } }))).toThrow(/lift/);
    expect(() => run(d, patch("c1", { grade: { curve: [{ x: 0.5, y: 0 }, { x: 0.2, y: 1 }] } }))).toThrow(/left to right/);
    expect(() => run(d, patch("c1", { grade: { curve: [{ x: 0.5, y: 0.5 }] } }))).toThrow(/two points or more/);
    expect(() => run(d, patch("c1", { grade: { curve: [{ x: 0, y: 1.2 }, { x: 1, y: 1 }] } }))).toThrow(/curve/);
    expect(() => run(d, patch("c1", { grade: { curve: Array.from({ length: LIMITS.curvePoints + 1 }, (_, i) => ({ x: i / 20, y: 0 })) } }))).toThrow(/curve/);
    expect(() => run(d, patch("c1", { grade: { tint: 1 } }))).toThrow();
    expect(() => run(d, patch("m1", { grade: { lift: wheel } }))).toThrow(/"grade" is not allowed on an audio clip/);
    expect(() => run(d, patch("x1", { grade: { lift: wheel } }))).toThrow(/"grade" is not allowed on a text clip/);
  });
  it("is listed for agents by the parts that change the picture", () => {
    expect(describeDoc(sampleDoc(), { detail: true })).not.toMatch(/grade|LUTs/);
    const d = run(sampleDoc(), [{ op: "add_lut", lut: lut("L1") }, ...patch("c1", { grade: { lift: wheel, gamma: { x: 0, y: 0, level: 0 }, curve: bend, curveB: [], lut: "L1", lutAmount: 0.5 } })]).doc;
    const said = describeDoc(d, { detail: true });
    expect(said).toContain(`grade=${JSON.stringify({ lift: wheel, curve: bend, lut: "L1", lutAmount: 0.5 })}`);
    expect(said).toContain('LUTs: L1 "Film"');
  });
  it("survives a split on both pieces", () => {
    const d = run(sampleDoc(), patch("c1", { grade: { lift: wheel }, adjust: { vhs: 0.5 } })).doc;
    const at = c1(d).start + 5;
    const split = run(d, [{ op: "split_clip", clipId: "c1", at, newClipId: "c1b" }]).doc;
    expect((findClip(split, "c1b")!.clip as MediaClip).grade).toEqual({ lift: wheel });
    expect((findClip(split, "c1b")!.clip as MediaClip).adjust).toEqual({ vhs: 0.5 });
  });
});

describe("the project's look-up tables", () => {
  it("are added with an id of their own and removed, each undone by the other", () => {
    const added = run(sampleDoc(), [{ op: "add_lut", lut: lut(undefined) }]);
    const [stored] = added.doc.luts!;
    expect(stored).toMatchObject({ name: "Film", size: 2 });
    expect(stored.id.length).toBeGreaterThan(0);
    const undone = applyOps(added.doc, roundTrip(added.inverse));
    expect(undone.doc.luts).toBeUndefined();
    expect(applyOps(undone.doc, roundTrip(undone.inverse)).doc.luts).toEqual([stored]);
  });
  it("go back where they were when a removal is undone", () => {
    const three = run(sampleDoc(), [{ op: "add_lut", lut: lut("a") }, { op: "add_lut", lut: lut("b", 2, "B") }, { op: "add_lut", lut: lut("c") }]).doc;
    const removed = run(three, [{ op: "remove_lut", lutId: "b", expect: { name: "B" } }]);
    expect(removed.doc.luts!.map((l) => l.id)).toEqual(["a", "c"]);
    expect(applyOps(removed.doc, roundTrip(removed.inverse)).doc.luts!.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
  it("leave a clip's grade naming a table that is gone, so an undo brings the look back", () => {
    const d = run(sampleDoc(), [{ op: "add_lut", lut: lut("L1") }, ...patch("c1", { grade: { lut: "L1" } })]).doc;
    const gone = run(d, [{ op: "remove_lut", lutId: "L1" }]);
    expect(c1(gone.doc).grade?.lut).toBe("L1");
    expect(applyOps(gone.doc, roundTrip(gone.inverse)).doc.luts![0].id).toBe("L1");
  });
  it("refuse a second with the same id, one too many, a wrong size or text that is not a table", () => {
    const one = run(sampleDoc(), [{ op: "add_lut", lut: lut("L1") }]).doc;
    expect(() => run(one, [{ op: "add_lut", lut: lut("L1") }])).toThrow(/already exists/);
    expect(() => run(one, [{ op: "remove_lut", lutId: "nope" }])).toThrow(/not found/);
    expect(() => run(one, [{ op: "remove_lut", lutId: "L1", expect: { name: "Other" } }])).toThrow();
    const full = run(sampleDoc(), Array.from({ length: LIMITS.lutsPerProject }, (_, i) => ({ op: "add_lut", lut: lut(`l${i}`) }) as OpInput)).doc;
    expect(() => run(full, [{ op: "add_lut", lut: lut("more") }])).toThrow(/at most/);
    expect(() => run(sampleDoc(), [{ op: "add_lut", lut: { ...lut("x"), size: 3 } }])).toThrow(/size × size × size/);
    expect(() => run(sampleDoc(), [{ op: "add_lut", lut: { ...lut("x"), size: LIMITS.lutSize + 1 } }])).toThrow();
    expect(() => run(sampleDoc(), [{ op: "add_lut", lut: { ...lut("x"), data: "!".repeat(32) } }])).toThrow(/base64/);
    expect(() => run(sampleDoc(), [{ op: "add_lut", lut: { ...lut("x"), name: "" } }])).toThrow();
  });
  it("a full-size table fits a change and a project many times over", () => {
    const big = lut("L1", LIMITS.lutSize);
    expect(big.data.length).toBe(19652);
    expect(big.data.length * LIMITS.lutsPerProject).toBeLessThan(LIMITS.docBytes / 4);
    expect(big.data.length * 2).toBeLessThan(LIMITS.opLogRowBytes / 4);
    expect(() => run(sampleDoc(), [{ op: "add_lut", lut: big }])).not.toThrow();
  });
});
