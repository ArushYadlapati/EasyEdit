import { describe, expect, it } from "vitest";
import { drawFrame } from "@/lib/render/compositor";
import { drawShape } from "@/lib/render/shapes";
import { createEmptyDoc, newShapeClip, type ShapeClip, type ShapeTool, type TimelineDoc } from "@/lib/timeline";
import { fakeCtx, type Call } from "./fake-ctx";

const frame = { width: 1080, height: 1920 };
const make = (tool: ShapeTool, extra: Partial<ShapeClip> = {}): ShapeClip => ({
  id: "s",
  ...newShapeClip(tool, { start: 0, duration: 60, x: 0.5, y: 0.5, width: 400, height: 200 }, frame),
  ...extra,
});
const named = (calls: Call[], name: string) => calls.filter((c) => c[0] === name);

function draw(clip: ShapeClip): Call[] {
  const { ctx, calls } = fakeCtx();
  drawShape(ctx, clip);
  return calls;
}

describe("drawing shapes", () => {
  it("a rectangle is an outline only, centred on the origin", () => {
    const calls = draw(make("rect"));
    expect(named(calls, "rect")).toEqual([["rect", -200, -100, 400, 200]]);
    expect(named(calls, "stroke")).toHaveLength(1);
    expect(named(calls, "fill")).toHaveLength(0);
    expect(calls).toContainEqual(["set lineWidth", 11]);
    expect(calls).toContainEqual(["set strokeStyle", "#FFD400"]);
  });

  it("rounding is clamped to half the short side", () => {
    const calls = draw(make("rect", { radius: 500 }));
    expect(named(calls, "arcTo")).toHaveLength(4);
    expect(named(calls, "arcTo").every((c) => c[5] === 100)).toBe(true);
  });

  it("a fill is painted under the outline, and no outline means no stroke", () => {
    const calls = draw(make("ellipse", { fill: "#112233" }));
    expect(named(calls, "ellipse")).toEqual([["ellipse", 0, 0, 200, 100, 0, 0, Math.PI * 2]]);
    const fillAt = calls.findIndex((c) => c[0] === "fill");
    const strokeAt = calls.findIndex((c) => c[0] === "stroke");
    expect(fillAt).toBeGreaterThan(-1);
    expect(fillAt).toBeLessThan(strokeAt);
    expect(named(draw(make("ellipse", { fill: "#112233", stroke: null })), "stroke")).toHaveLength(0);
  });

  it("dashes and dots scale with the line width", () => {
    expect(named(draw(make("rect", { dash: "dashed", strokeWidth: 10 })), "setLineDash")).toContainEqual(["setLineDash", [30, 20]]);
    expect(named(draw(make("rect", { dash: "dotted", strokeWidth: 10 })), "setLineDash")).toContainEqual(["setLineDash", [0, 20]]);
  });

  it("an arrow is a line with a filled head at its tip", () => {
    const calls = draw(make("arrow"));
    const curve = named(calls, "bezierCurveTo")[0];
    expect(curve[5]).toBeCloseTo(200 - 0.8 * 44, 3); // the line stops inside the head: 4 × the 11 px line, less a fifth
    expect(curve[6]).toBeCloseTo(0);
    expect(named(calls, "fill")).toHaveLength(1);
    expect(named(calls, "lineTo")).toContainEqual(["lineTo", 200, 0]); // the head's tip
  });

  it("a line has no head and runs end to end", () => {
    const calls = draw(make("line"));
    expect(named(calls, "moveTo")[0]).toEqual(["moveTo", -200, 0]);
    expect(named(calls, "bezierCurveTo")).toHaveLength(1);
    expect(named(calls, "bezierCurveTo")[0].slice(5)).toEqual([200, 0]);
    expect(named(calls, "fill")).toHaveLength(0);
  });

  it("both heads, open, are two extra strokes; a bend carries the line through its middle point", () => {
    const calls = draw(make("arrow", { heads: "both", head: "open", bend: 0.25 }));
    expect(named(calls, "stroke")).toHaveLength(3);
    const pieces = named(calls, "bezierCurveTo");
    expect(pieces).toHaveLength(2);
    expect(pieces[0].slice(5)).toEqual([0, 100]); // the middle, 0.25 × 400 out
    expect(pieces[1].slice(5)).toEqual([200, 0]);
  });

  it("a line passes through each of its points in order", () => {
    const calls = draw(make("line", { points: [{ x: -0.25, y: -0.5 }, { x: 0.75, y: 0.25 }] }));
    expect(named(calls, "moveTo")[0]).toEqual(["moveTo", -200, 0]);
    expect(named(calls, "bezierCurveTo").map((c) => c.slice(5))).toEqual([[-100, -200], [300, 100], [200, 0]]);
    expect(named(calls, "stroke")).toHaveLength(1);
  });

  it("a head points the way its line comes in, not along the straight run between the ends", () => {
    // The line swings out below the tip and comes back up into it.
    const calls = draw(make("arrow", { points: [{ x: 0.5, y: 0.5 }] }));
    const head = named(calls, "lineTo");
    const tip = head.find((c) => c[1] === 200 && c[2] === 0)!;
    expect(tip).toBeTruthy();
    const base = named(calls, "moveTo")[1]; // the head's first corner, behind the tip
    expect(base[2] as number).toBeGreaterThan(20); // below the tip: the head points up and back, where the line arrives from
  });

  it("a triangle, a diamond, a pentagon, a hexagon and a star are drawn corner to corner and closed", () => {
    for (const [tool, corners] of [["triangle", 3], ["diamond", 4], ["pentagon", 5], ["hexagon", 6], ["star", 10]] as const) {
      const calls = draw(make(tool, { fill: "#112233" }));
      expect(named(calls, "moveTo"), tool).toHaveLength(1);
      expect(named(calls, "lineTo"), tool).toHaveLength(corners - 1);
      expect(named(calls, "closePath"), tool).toHaveLength(1);
      expect(named(calls, "fill"), tool).toHaveLength(1);
      expect(named(calls, "stroke"), tool).toHaveLength(1);
      expect(calls, tool).toContainEqual(["set lineJoin", "miter"]);
    }
    expect(named(draw(make("triangle")), "moveTo")[0]).toEqual(["moveTo", 0, -100]); // the top corner of a 400 × 200 box
  });

  it("a rounded star has an arc at every corner, none wider than its sides allow", () => {
    const calls = draw(make("star", { radius: 500 }));
    const arcs = named(calls, "arcTo");
    expect(arcs).toHaveLength(10);
    const radii = arcs.map((c) => c[5] as number);
    expect(radii.every((r) => r > 0 && r < 200)).toBe(true); // far short of the 500 asked for
    // A tip is a narrow corner and takes a tighter arc than the wide corner between two tips.
    expect(radii[0]).toBeLessThan(radii[1]);
    expect(calls).toContainEqual(["set lineJoin", "round"]);
    expect(named(draw(make("triangle", { radius: 10 })), "arcTo").every((c) => c[5] === 10)).toBe(true);
  });

  it("heads on a dashed arrow are drawn solid", () => {
    const calls = draw(make("arrow", { dash: "dashed" }));
    const dashes = named(calls, "setLineDash").map((c) => c[1]);
    expect(dashes).toEqual([[33, 22], []]);
  });
});

describe("shapes in a frame", () => {
  it("drawFrame draws a shape clip at its place", () => {
    const doc: TimelineDoc = createEmptyDoc("short_9x16");
    doc.tracks.splice(1, 0, { id: "s1", kind: "shape", name: "Shapes 1", muted: false, hidden: false, locked: false, clips: [make("ellipse")] });
    const { ctx, calls } = fakeCtx();
    drawFrame(ctx, doc, 10);
    expect(named(calls, "translate")).toContainEqual(["translate", 540, 960]);
    expect(named(calls, "ellipse")).toHaveLength(1);
  });
});
