import { describe, expect, it } from "vitest";
import { RED_ANGLE } from "@/lib/color/grade";
import { LIMITS } from "@/lib/limits";
import { CURVE_GAP, NO_GRADE, STRAIGHT, addPoint, curveOf, curveOps, importLutOps, isGraded, lutOfClip, movePoint, pickLutOps, puckAt, puckName, readCubeFile, removeLutOps, removePoint, wheelBackground, wheelOps } from "@/lib/editor/grade";
import { clipFieldOps, clipFieldValue, fieldContext, type ClipField } from "@/lib/editor/inspector-fields";
import { findClip } from "@/lib/editor/store";
import { applyOps, prepareOps, type MediaClip, type OpInput, type TimelineDoc } from "@/lib/timeline";
import { sampleDoc } from "./fixtures";

const run = (d: TimelineDoc, ops: OpInput[]) => applyOps(d, prepareOps(ops)).doc;
const c1 = (d: TimelineDoc) => findClip(d, "c1")!.clip as MediaClip;
const x1 = (d: TimelineDoc) => findClip(d, "x1")!.clip;
const patch = (p: Record<string, unknown>): OpInput[] => [{ op: "update_clip", clipId: "c1", patch: p }];
const field = (d: TimelineDoc, name: ClipField, raw: string, id = "c1") => clipFieldOps(findClip(d, id)!.clip, name, raw, fieldContext(d, findClip(d, id)!.clip));
const shown = (d: TimelineDoc, name: ClipField, id = "c1") => clipFieldValue(findClip(d, id)!.clip, name, fieldContext(d, findClip(d, id)!.clip));
const cube = (size: number, title = "") => {
  let text = `${title}LUT_3D_SIZE ${size}\n`;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) text += `${b / (size - 1)} ${g / (size - 1)} ${r / (size - 1)}\n`;
  return text;
};

describe("a wheel's puck", () => {
  it("stays inside the circle and snaps to the middle when all but there", () => {
    expect(puckAt(0.5, -0.25)).toEqual({ x: 0.5, y: -0.25 });
    expect(puckAt(3, 4)).toEqual({ x: 0.6, y: 0.8 });
    expect(puckAt(0.02, -0.02)).toEqual({ x: 0, y: 0 });
  });
  it("is one value in the clip's grade, sent whole, and nothing when it has not moved", () => {
    const d = sampleDoc();
    expect(wheelOps(c1(d), "lift", { x: 0.2, y: 0.1 })).toEqual(patch({ grade: { lift: { x: 0.2, y: 0.1, level: 0 } } }));
    expect(wheelOps(c1(d), "gain", { x: 0, y: 0 })).toEqual([]);
    const pushed = run(d, wheelOps(c1(d), "lift", { x: 0.2, y: 0.1 })!);
    expect(wheelOps(c1(pushed), "lift", { level: -0.5 })).toEqual(patch({ grade: { lift: { x: 0.2, y: 0.1, level: -0.5 } } }));
    expect(wheelOps(x1(d), "lift", { x: 0.2, y: 0.1 })).toBeNull();
  });
  it("is said in words", () => {
    expect(puckName({ x: 0, y: 0, level: 0.4 })).toBe("No push");
    const rad = (deg: number) => (deg * Math.PI) / 180;
    expect(puckName({ x: 0.5 * Math.cos(rad(RED_ANGLE)), y: 0.5 * Math.sin(rad(RED_ANGLE)), level: 0 })).toBe("50% towards red");
    expect(puckName({ x: Math.cos(rad(RED_ANGLE + 240)), y: Math.sin(rad(RED_ANGLE + 240)), level: 0 })).toBe("100% towards blue");
  });
  it("is drawn with every colour where the puck pushes towards it", () => {
    const css = wheelBackground();
    // Red sits 105° counter-clockwise from the right: 345° clockwise from the top, between the stops at 330° and 360°.
    expect(css).toContain("hsl(15 85% 55%) 330deg");
    expect(css).toContain("hsl(345 85% 55%) 0deg");
    expect(css).toContain("hsl(105 85% 55%) 240deg"); // green-yellow, lower left
    expect(css.startsWith("radial-gradient(")).toBe(true);
  });
  it("its brightness is a field, in percent", () => {
    const d = sampleDoc();
    expect(shown(d, "gammaLevel")).toBe("0");
    expect(field(d, "gammaLevel", "30")).toEqual(patch({ grade: { gamma: { x: 0, y: 0, level: 0.3 } } }));
    expect(field(d, "liftLevel", "-500")).toEqual(patch({ grade: { lift: { x: 0, y: 0, level: -1 } } }));
    expect(field(d, "gainLevel", "0")).toEqual([]);
    expect(field(d, "gainLevel", "bright")).toBeNull();
    expect(field(d, "gainLevel", "10", "x1")).toBeNull();
    expect(shown(run(d, field(d, "gammaLevel", "30")!), "gammaLevel")).toBe("30");
    expect(shown(d, "gammaLevel", "x1")).toBe("");
  });
});

describe("a curve's points", () => {
  it("are the straight line's two ends until it has its own", () => {
    expect(curveOf(undefined, "curve")).toBe(STRAIGHT);
    expect(curveOf({ curve: [] }, "curve")).toBe(STRAIGHT);
    const own = [{ x: 0, y: 0.2 }, { x: 1, y: 1 }];
    expect(curveOf({ curveR: own }, "curveR")).toBe(own);
    expect(curveOf({ curveR: own }, "curve")).toBe(STRAIGHT);
  });
  it("move between their neighbours and inside the square", () => {
    const three = [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }];
    expect(movePoint(three, 1, 0.3, 0.8)[1]).toEqual({ x: 0.3, y: 0.8 });
    expect(movePoint(three, 1, -5, 9)[1]).toEqual({ x: CURVE_GAP, y: 1 });
    expect(movePoint(three, 1, 5, -9)[1]).toEqual({ x: 1 - CURVE_GAP, y: 0 });
    expect(movePoint(three, 0, 0.9, 0.3)[0]).toEqual({ x: 0.5 - CURVE_GAP, y: 0.3 });
    expect(movePoint(three, 2, 0.1, 0.3)[2]).toEqual({ x: 0.5 + CURVE_GAP, y: 0.3 });
    expect(three[1]).toEqual({ x: 0.5, y: 0.5 }); // the list given is left alone
  });
  it("are added in order, where there is room", () => {
    const added = addPoint(STRAIGHT, 0.25, 0.6)!;
    expect(added).toEqual({ points: [{ x: 0, y: 0 }, { x: 0.25, y: 0.6 }, { x: 1, y: 1 }], index: 1 });
    expect(addPoint(added.points, 0.26, 0.1)).toBeNull(); // on top of another
    const full = Array.from({ length: LIMITS.curvePoints }, (_, i) => ({ x: i / (LIMITS.curvePoints - 1), y: 0.5 }));
    expect(addPoint(full, 0.03, 0.5)).toBeNull();
  });
  it("are taken out down to two", () => {
    expect(removePoint([{ x: 0, y: 0 }, { x: 0.5, y: 0.9 }, { x: 1, y: 1 }], 1)).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
    expect(removePoint(STRAIGHT, 0)).toBeNull();
  });
  it("are stored as nothing when they are the straight line, so Reset has nothing left to do", () => {
    const d = sampleDoc();
    const bent = curveOps(c1(d), "curveG", [{ x: 0, y: 0 }, { x: 0.4, y: 0.61234 }, { x: 1, y: 1 }])!;
    expect(bent).toEqual(patch({ grade: { curveG: [{ x: 0, y: 0 }, { x: 0.4, y: 0.612 }, { x: 1, y: 1 }] } }));
    const after = run(d, bent);
    expect(isGraded(c1(after).grade)).toBe(true);
    expect(curveOps(c1(after), "curveG", STRAIGHT)).toEqual(patch({ grade: { curveG: [] } }));
    expect(curveOps(c1(d), "curveG", STRAIGHT)).toEqual([]);
    expect(curveOps(c1(after), "curveG", c1(after).grade!.curveG!)).toEqual([]);
    expect(curveOps(x1(d), "curve", STRAIGHT)).toBeNull();
    expect(() => run(d, bent)).not.toThrow();
  });
});

describe("a look-up table from a file", () => {
  it("is read, named and packed", () => {
    const read = readCubeFile("Teal.cube", cube(2));
    expect(read).toMatchObject({ ok: true, lut: { name: "Teal", size: 2 } });
    expect(readCubeFile("a.cube", cube(2, 'TITLE "Bleach"\n'))).toMatchObject({ ok: true, lut: { name: "Bleach" } });
    expect(readCubeFile("a.cube", "nothing here")).toEqual({ ok: false, message: "That file has no look-up table in it." });
    const big = readCubeFile("big.cube", cube(33));
    expect(big.ok && big.lut.size).toBe(LIMITS.lutSize);
  });
  it("joins the project and the clip takes it, as one change that undoes whole", () => {
    const d = sampleDoc();
    const read = readCubeFile("Teal.cube", cube(2));
    if (!read.ok) throw new Error("unread");
    const ops = importLutOps(d, c1(d), read.lut, "L1")!;
    const done = applyOps(d, prepareOps(ops));
    expect(done.doc.luts).toEqual([{ id: "L1", ...read.lut }]);
    expect(c1(done.doc).grade).toEqual({ lut: "L1" });
    expect(lutOfClip(done.doc, c1(done.doc))?.name).toBe("Teal");
    expect(isGraded(c1(done.doc).grade)).toBe(true);
    const undone = applyOps(done.doc, done.inverse).doc;
    expect(undone.luts).toBeUndefined();
    expect(c1(undone).grade?.lut ?? null).toBeNull();
  });
  it("is not kept twice: the same table again only picks the one there", () => {
    const d = sampleDoc();
    const read = readCubeFile("Teal.cube", cube(2));
    if (!read.ok) throw new Error("unread");
    const once = run(d, importLutOps(d, c1(d), read.lut, "L1")!);
    expect(importLutOps(once, c1(once), { ...read.lut, name: "Other name" }, "L2")).toEqual([]);
    const off = run(once, pickLutOps(c1(once), null)!);
    expect(importLutOps(off, c1(off), read.lut, "L2")).toEqual(patch({ grade: { lut: "L1" } }));
  });
  it("is refused when the project is full, and for a clip with no picture", () => {
    let d = sampleDoc();
    for (let i = 0; i < LIMITS.lutsPerProject; i++) {
      const read = readCubeFile(`${i}.cube`, `${cube(2)}`.replace("LUT_3D_SIZE 2\n0 0 0", `LUT_3D_SIZE 2\n0 0 ${i / 100}`));
      if (!read.ok) throw new Error("unread");
      d = run(d, importLutOps(d, c1(d), read.lut, `l${i}`)!);
    }
    const one = readCubeFile("more.cube", cube(3));
    if (!one.ok) throw new Error("unread");
    expect(importLutOps(d, c1(d), one.lut, "more")).toBeNull();
    expect(importLutOps(sampleDoc(), x1(sampleDoc()), one.lut, "more")).toBeNull();
  });
  it("leaves the project with every clip letting go of it first, and comes back whole on undo", () => {
    const d = sampleDoc();
    const read = readCubeFile("Teal.cube", cube(2));
    if (!read.ok) throw new Error("unread");
    const once = run(d, importLutOps(d, c1(d), read.lut, "L1")!);
    const ops = removeLutOps(once, "L1");
    expect(ops).toEqual([...patch({ grade: { lut: null } }), { op: "remove_lut", lutId: "L1" }]);
    const removed = applyOps(once, prepareOps(ops));
    expect(removed.doc.luts).toBeUndefined();
    expect(lutOfClip(removed.doc, c1(removed.doc))).toBeNull();
    const back = applyOps(removed.doc, removed.inverse).doc;
    expect(lutOfClip(back, c1(back))?.id).toBe("L1");
    expect(removeLutOps(d, "L1")).toEqual([]);
  });
  it("its strength is a field while the picture has one", () => {
    const d = sampleDoc();
    expect(shown(d, "lutAmount")).toBe("");
    expect(field(d, "lutAmount", "50")).toBeNull();
    const withLut = run(d, patch({ grade: { lut: "L1" } }));
    expect(shown(withLut, "lutAmount")).toBe("100");
    expect(field(withLut, "lutAmount", "40")).toEqual(patch({ grade: { lutAmount: 0.4 } }));
    expect(field(withLut, "lutAmount", "100")).toEqual([]);
    expect(field(withLut, "lutAmount", "900")).toEqual([]);
  });
});

describe("a whole grade", () => {
  it("is on when a wheel is moved, a curve bent or a table named, and off after NO_GRADE", () => {
    expect([isGraded(undefined), isGraded({}), isGraded({ lift: { x: 0, y: 0, level: 0 }, curve: [], lut: null, lutAmount: 0.3 })]).toEqual([false, false, false]);
    const d = run(sampleDoc(), patch({ grade: { gain: { x: 0.1, y: 0, level: 0 }, curveB: [{ x: 0, y: 0.3 }, { x: 1, y: 1 }], lut: "gone", lutAmount: 0.4 } }));
    expect(isGraded(c1(d).grade)).toBe(true);
    const reset = run(d, patch({ grade: { ...NO_GRADE } }));
    expect(isGraded(c1(reset).grade)).toBe(false);
    expect(c1(reset).grade?.lutAmount).toBe(1);
  });
  it("the effect fields show percents and pixels and stay in range", () => {
    const d = sampleDoc();
    expect(field(d, "grain", "35")).toEqual(patch({ adjust: { grain: 0.35 } }));
    expect(field(d, "pixelate", "12.5")).toEqual(patch({ adjust: { pixelate: 12.5 } }));
    expect(field(d, "vhs", "400")).toEqual(patch({ adjust: { vhs: 1 } }));
    expect(field(d, "glitch", "-3")).toEqual([]);
    expect(field(d, "sharpen", "50", "x1")).toBeNull();
    const set = run(d, patch({ adjust: { split: 0.2, pixelate: 8 } }));
    expect((["split", "pixelate", "sharpen"] as const).map((f) => shown(set, f))).toEqual(["20", "8", "0"]);
  });
});
