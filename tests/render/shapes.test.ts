import { describe, expect, it } from "vitest";
import { drawFrame } from "@/lib/render/compositor";
import { drawShape } from "@/lib/render/shapes";
import { createEmptyDoc, newShapeClip, type ShapeClip, type TimelineDoc } from "@/lib/timeline";
import { fakeCtx, type Call } from "./fake-ctx";

const frame = { width: 1080, height: 1920 };
const make = (tool: "rect" | "ellipse" | "line" | "arrow", extra: Partial<ShapeClip> = {}): ShapeClip => ({
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
    const curve = named(calls, "quadraticCurveTo")[0];
    expect(curve[3]).toBeLessThan(200); // the line stops inside the head
    expect(curve[4]).toBeCloseTo(0);
    expect(named(calls, "fill")).toHaveLength(1);
    expect(named(calls, "lineTo")).toContainEqual(["lineTo", 200, 0]); // the head's tip
  });

  it("a line has no head and runs end to end", () => {
    const calls = draw(make("line"));
    expect(named(calls, "moveTo")[0]).toEqual(["moveTo", -200, 0]);
    expect(named(calls, "quadraticCurveTo")[0].slice(3)).toEqual([200, 0]);
    expect(named(calls, "fill")).toHaveLength(0);
  });

  it("both heads, open, are two extra strokes; a bend lifts the curve's control point", () => {
    const calls = draw(make("arrow", { heads: "both", head: "open", bend: 0.25 }));
    expect(named(calls, "stroke")).toHaveLength(3);
    const curve = named(calls, "quadraticCurveTo")[0];
    expect(curve[2]).toBeCloseTo(200); // control y = 2 × 0.25 × 400
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
