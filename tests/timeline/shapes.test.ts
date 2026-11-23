import { describe, expect, it } from "vitest";
import {
  Clip,
  DEFAULT_TRANSFORM,
  applyOps,
  arrowEnds,
  arrowFromEnds,
  arrowKnots,
  arrowPath,
  arrowPlace,
  arrowShare,
  arrowThrough,
  BOX_SHAPES,
  createEmptyDoc,
  describe as describeDoc,
  newShapeClip,
  prepareOps,
  regularAspect,
  SHAPE_TOOLS,
  shapeBox,
  shapeCorners,
  shapeName,
  takesRadius,
  type Op,
  type ShapeClip,
  type TimelineDoc,
} from "@/lib/timeline";

const frame = { width: 1080, height: 1920 };

function docWithShapes(): TimelineDoc {
  const doc = createEmptyDoc("short_9x16");
  return applyOps(doc, [{ op: "add_track", track: { id: "s1", kind: "shape", name: "Shapes 1" }, index: 1 }]).doc;
}

const rect = (extra: Partial<ShapeClip> = {}): ShapeClip => ({
  id: "r1",
  ...newShapeClip("rect", { start: 0, duration: 60, x: 0.5, y: 0.5, width: 300, height: 200 }, frame),
  ...extra,
});
const arrow = (extra: Partial<ShapeClip> = {}): ShapeClip => ({
  id: "a1",
  ...newShapeClip("arrow", { start: 0, duration: 60, x: 0.5, y: 0.5, width: 400, height: 0 }, frame),
  ...extra,
});

function add(doc: TimelineDoc, clip: ShapeClip, trackId = "s1"): TimelineDoc {
  return applyOps(doc, [{ op: "add_clip", trackId, clip }]).doc;
}
function find(doc: TimelineDoc, id: string): ShapeClip {
  for (const t of doc.tracks) for (const c of t.clips) if (c.id === id) return c as ShapeClip;
  throw new Error(`no clip ${id}`);
}
function refused(fn: () => unknown, message: RegExp) {
  expect(fn).toThrow(expect.objectContaining({ name: "OpError", message: expect.stringMatching(message) }));
}
const roundTrip = (inverse: Op[]): Op[] => JSON.parse(JSON.stringify(inverse));

describe("shape clips: schema", () => {
  it("a new shape of every kind, a line and an arrow are valid clips", () => {
    expect(SHAPE_TOOLS).toEqual(["rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star", "line", "arrow"]);
    expect(BOX_SHAPES).toEqual(["rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star"]);
    for (const tool of SHAPE_TOOLS) {
      const clip = { id: "x", ...newShapeClip(tool, { start: 0, duration: 30, x: 0.5, y: 0.5, width: 100, height: 50 }, frame) };
      expect(Clip.safeParse(clip).success, tool).toBe(true);
    }
  });

  it("a line is an arrow with no heads, and its name says so", () => {
    const line = { id: "l", ...newShapeClip("line", { start: 0, duration: 30, x: 0.5, y: 0.5, width: 100, height: 0 }, frame) };
    expect(line).toMatchObject({ shape: "arrow", heads: "none", height: 0 });
    expect(shapeName(line)).toBe("Line");
    expect(shapeName(arrow())).toBe("Arrow");
    expect(shapeName(rect())).toBe("Rectangle");
    expect(shapeName({ ...rect(), shape: "star" })).toBe("Star");
  });

  it("the default outline is 1% of the frame's shorter side and yellow", () => {
    expect(rect()).toMatchObject({ strokeWidth: 11, stroke: "#FFD400", dash: "solid" });
  });

  it("refuses a stretch, a fill on an arrow, arrow fields on a box and radius on an ellipse", () => {
    expect(Clip.safeParse(rect({ transform: { ...DEFAULT_TRANSFORM, stretch: 2 } })).success).toBe(false);
    expect(Clip.safeParse(arrow({ fill: "#000000" })).success).toBe(false);
    expect(Clip.safeParse(arrow({ stroke: null })).success).toBe(false);
    expect(Clip.safeParse(rect({ bend: 0.2 })).success).toBe(false);
    expect(Clip.safeParse({ ...rect(), shape: "ellipse", radius: 4 }).success).toBe(false);
    expect(Clip.safeParse(rect({ stroke: null })).success).toBe(false); // nothing to see
    expect(Clip.safeParse(rect({ stroke: null, fill: "#112233" })).success).toBe(true);
  });

  it("every shape with corners takes a rounding and a fill; only an arrow takes points", () => {
    for (const kind of ["triangle", "diamond", "pentagon", "hexagon", "star"] as const) {
      expect(takesRadius(kind)).toBe(true);
      expect(Clip.safeParse({ ...rect(), shape: kind, radius: 12, fill: "#112233" }).success, kind).toBe(true);
      expect(Clip.safeParse({ ...rect(), shape: kind, points: [{ x: 0, y: 0.2 }] }).success, kind).toBe(false);
    }
    expect(takesRadius("ellipse")).toBe(false);
    expect(Clip.safeParse(arrow({ radius: 4 })).success).toBe(false);
    expect(Clip.safeParse(arrow({ points: [{ x: 0.2, y: -1.5 }, { x: -3, y: 4 }] })).success).toBe(true);
  });

  it("an arrow holds up to 12 points, each within 10 arrow lengths of its middle", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i / 20, y: 0.1 }));
    expect(Clip.safeParse(arrow({ points: many(12) })).success).toBe(true);
    expect(Clip.safeParse(arrow({ points: many(13) })).success).toBe(false);
    expect(Clip.safeParse(arrow({ points: [{ x: 0, y: 10 }] })).success).toBe(true);
    expect(Clip.safeParse(arrow({ points: [{ x: 0, y: 10.01 }] })).success).toBe(false);
    expect(Clip.safeParse(arrow({ points: [{ x: 0, y: 0.1, z: 1 } as never] })).success).toBe(false);
  });
});

describe("shape clips: ops", () => {
  it("goes on a shapes track and nowhere else", () => {
    const doc = add(docWithShapes(), rect());
    expect(find(doc, "r1").shape).toBe("rect");
    refused(() => add(docWithShapes(), rect(), "v1"), /track/);
    refused(() => add(docWithShapes(), rect(), "t1"), /track/);
  });

  it("op input takes a shape without an id and gives it one", () => {
    const { id, ...noId } = rect();
    expect(id).toBe("r1");
    const ops = prepareOps([{ op: "add_clip", trackId: "s1", clip: noId }]);
    const doc = applyOps(docWithShapes(), ops).doc;
    expect(doc.tracks.find((t) => t.id === "s1")!.clips).toHaveLength(1);
  });

  it("update_clip changes the outline and undoes after JSON", () => {
    const doc = add(docWithShapes(), rect());
    const { doc: next, inverse } = applyOps(doc, [{ op: "update_clip", clipId: "r1", patch: { strokeWidth: 24, dash: "dashed", radius: 30, fill: "#000000" } }]);
    expect(find(next, "r1")).toMatchObject({ strokeWidth: 24, dash: "dashed", radius: 30, fill: "#000000" });
    const undone = find(applyOps(next, roundTrip(inverse)).doc, "r1");
    expect(undone).toMatchObject({ strokeWidth: 11, dash: "solid" });
    expect(undone.radius ?? 0).toBe(0);
    expect(undone.fill ?? null).toBeNull();
  });

  it("update_clip refuses what the shape can't take", () => {
    const doc = add(add(docWithShapes(), rect()), arrow({ start: 60 }));
    refused(() => applyOps(doc, [{ op: "update_clip", clipId: "r1", patch: { transform: { stretch: 2 } } }]), /stretch/);
    refused(() => applyOps(doc, [{ op: "update_clip", clipId: "a1", patch: { fill: "#000000" } }]), /fill/);
    refused(() => applyOps(doc, [{ op: "update_clip", clipId: "r1", patch: { text: "hi" } }]), /text/);
    refused(() => applyOps(doc, [{ op: "update_clip", clipId: "a1", patch: { transitionIn: { kind: "crossfade", frames: 10 } } }]), /crossfade/);
  });

  it("an arrow takes heads, bend and a fade in", () => {
    const doc = add(docWithShapes(), arrow());
    const next = applyOps(doc, [
      { op: "update_clip", clipId: "a1", patch: { heads: "both", head: "open", headSize: 4, bend: -0.3, transitionIn: { kind: "fade", frames: 10 } } },
    ]).doc;
    expect(find(next, "a1")).toMatchObject({ heads: "both", head: "open", headSize: 4, bend: -0.3, transitionIn: { kind: "fade", frames: 10 } });
  });

  it("an arrow's points are set whole, checked, and undone back to none", () => {
    const doc = add(docWithShapes(), arrow());
    const points = [{ x: -0.2, y: 0.3 }, { x: 0.25, y: -0.4 }];
    const { doc: next, inverse } = applyOps(doc, [{ op: "update_clip", clipId: "a1", patch: { points } }]);
    expect(find(next, "a1").points).toEqual(points);
    expect(find(applyOps(next, roundTrip(inverse)).doc, "a1").points ?? []).toEqual([]);
    // The change is refused when the points are no longer what the sender saw.
    refused(() => applyOps(next, [{ op: "update_clip", clipId: "a1", patch: { points: [] }, expect: { points: [] } }]), /changed|stale|expect/i);
    expect(applyOps(next, [{ op: "update_clip", clipId: "a1", patch: { points: [] }, expect: { points } }]).doc).toBeTruthy();
    refused(() => applyOps(doc, [{ op: "update_clip", clipId: "a1", patch: { points: [{ x: 0, y: 99 }] } }]), /points/);
  });

  it("splits like any clip", () => {
    const doc = add(docWithShapes(), rect());
    const next = applyOps(doc, [{ op: "split_clip", clipId: "r1", at: 30, newClipId: "r2" }]).doc;
    expect(find(next, "r2")).toMatchObject({ type: "shape", shape: "rect", start: 30, duration: 30 });
  });

  it("describe lists a shape with its fields", () => {
    const doc = add(add(docWithShapes(), rect()), arrow({ start: 60, bend: 0.2 }));
    const text = describeDoc(doc, { detail: true });
    expect(text).toContain('shape="rect" width=300 height=200 stroke="#FFD400" strokeWidth=11 dash="solid"');
    expect(text).toContain('shape="arrow" width=400 stroke="#FFD400"');
    expect(text).toContain("bend=0.2");
    expect(text).toContain("[shape]");
    const pointed = add(docWithShapes(), arrow({ points: [{ x: 0, y: 0.2 }, { x: 0.3, y: -0.1 }] }));
    expect(describeDoc(pointed, { detail: true })).toContain('points=[{"x":0,"y":0.2},{"x":0.3,"y":-0.1}]');
    const star = add(docWithShapes(), { ...rect(), shape: "star" });
    expect(describeDoc(star)).toContain("shape(star)");
  });
});

describe("shape geometry", () => {
  it("an arrow's ends and its centre, length and rotation go both ways", () => {
    const a = arrowFromEnds({ x: 100, y: 200 }, { x: 400, y: 600 }, frame);
    expect(a.width).toBeCloseTo(500);
    const ends = arrowEnds(arrow({ width: a.width, transform: { ...DEFAULT_TRANSFORM, x: a.x, y: a.y, rotation: a.rotation } }), frame);
    expect(ends.tail.x).toBeCloseTo(100);
    expect(ends.tail.y).toBeCloseTo(200);
    expect(ends.tip.x).toBeCloseTo(400);
    expect(ends.tip.y).toBeCloseTo(600);
  });

  it("a bent arrow's middle sits bend × length out, and its box reaches it", () => {
    const a = arrow({ bend: 0.25 });
    expect(arrowThrough(a)).toEqual([{ x: 0, y: 0.25 }]);
    expect(arrowKnots(a)).toEqual([{ x: -200, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 0 }]);
    expect(arrowPath(a)).toHaveLength(2);
    expect(shapeBox(a).bottom).toBeGreaterThan(100);
    expect(shapeBox(a)).toMatchObject({ left: -200, right: 200 });
    expect(shapeBox(rect())).toEqual({ left: -150, top: -100, right: 150, bottom: 100 });
  });

  it("an arrow's own points are what its line passes through, ahead of an older bend", () => {
    const a = arrow({ bend: 0.25, points: [{ x: -0.25, y: -0.5 }, { x: 0.75, y: 0.1 }] });
    expect(arrowThrough(a)).toEqual(a.points);
    expect(arrowKnots(a)).toEqual([{ x: -200, y: 0 }, { x: -100, y: -200 }, { x: 300, y: 40 }, { x: 200, y: 0 }]);
    expect(arrowPath(a)).toHaveLength(3);
    // The box follows the line out past the tip and up to the first point.
    const box = shapeBox(a);
    expect(box.right).toBeGreaterThanOrEqual(300);
    expect(box.top).toBeLessThanOrEqual(-200);
    expect(arrowThrough(arrow({ points: [] }))).toEqual([]);
    expect(arrowThrough(arrow({ bend: 0.1, points: [] }))).toEqual([{ x: 0, y: 0.1 }]);
  });

  it("a point given in arrow lengths and its place on the frame go both ways, turned and scaled", () => {
    const a = arrow({ transform: { ...DEFAULT_TRANSFORM, x: 0.25, y: 0.75, rotation: 90, scale: 2 } });
    // 400 long at scale 2, pointing down: a quarter of a length along it is 200 px below its middle.
    const place = arrowPlace(a, frame, { x: 0.25, y: 0 });
    expect(place.x).toBeCloseTo(270);
    expect(place.y).toBeCloseTo(1640);
    // Its own +y, after a quarter turn clockwise, points left on the frame.
    expect(arrowPlace(a, frame, { x: 0, y: 0.5 }).x).toBeCloseTo(270 - 400);
    const back = arrowShare(a, frame, arrowPlace(a, frame, { x: -0.3, y: 1.2 }));
    expect(back.x).toBeCloseTo(-0.3);
    expect(back.y).toBeCloseTo(1.2);
  });

  it("a many-sided shape's corners fill its box, the first at the top", () => {
    const box = (kind: "triangle" | "diamond" | "pentagon" | "hexagon" | "star") => {
      const corners = shapeCorners({ shape: kind, width: 300, height: 200 })!;
      return {
        count: corners.length,
        left: Math.min(...corners.map((p) => p.x)),
        right: Math.max(...corners.map((p) => p.x)),
        top: Math.min(...corners.map((p) => p.y)),
        bottom: Math.max(...corners.map((p) => p.y)),
        first: corners[0],
      };
    };
    for (const [kind, count] of [["triangle", 3], ["diamond", 4], ["pentagon", 5], ["hexagon", 6], ["star", 10]] as const) {
      const b = box(kind);
      expect(b.count, kind).toBe(count);
      expect(b.left, kind).toBeCloseTo(-150);
      expect(b.right, kind).toBeCloseTo(150);
      expect(b.top, kind).toBeCloseTo(-100);
      expect(b.bottom, kind).toBeCloseTo(100);
      expect(b.first.y, kind).toBeCloseTo(-100);
    }
    expect(box("triangle").first.x).toBeCloseTo(0);
    expect(shapeCorners({ shape: "rect", width: 300, height: 200 })).toBeNull();
    expect(shapeCorners({ shape: "ellipse", width: 300, height: 200 })).toBeNull();
  });

  it("knows each shape's even-sided proportions", () => {
    expect(regularAspect("rect")).toBe(1);
    expect(regularAspect("ellipse")).toBe(1);
    expect(regularAspect("diamond")).toBe(1);
    expect(regularAspect("triangle")).toBeCloseTo(1.1547, 4); // equilateral
    expect(regularAspect("hexagon")).toBeCloseTo(1.1547, 4);
    expect(regularAspect("pentagon")).toBeCloseTo(1.0515, 4);
    expect(regularAspect("star")).toBeCloseTo(1.0515, 4);
  });
});

describe("the editing guide's shape example", () => {
  it("adds to a shapes track as it is written, and the guide explains every field", async () => {
    const { EXAMPLE_ARROW_CLIP, SHAPES_REFERENCE, buildEditingGuide } = await import("@/lib/mcp/guide");
    const ops = prepareOps([{ op: "add_clip", trackId: "s1", clip: structuredClone(EXAMPLE_ARROW_CLIP) as never }]);
    const doc = applyOps(docWithShapes(), ops).doc;
    expect(doc.tracks.find((t) => t.id === "s1")!.clips[0]).toMatchObject({ shape: "arrow", points: [{ x: 0, y: 0.2 }] });
    for (const kind of ["rect", "ellipse", "triangle", "diamond", "pentagon", "hexagon", "star", "arrow"]) expect(SHAPES_REFERENCE, kind).toContain(`"${kind}"`);
    for (const field of ["stroke", "strokeWidth", "dash", "fill", "radius", "heads", "head", "headSize", "bend", "points"]) expect(SHAPES_REFERENCE, field).toContain(field);
    expect(buildEditingGuide()).toContain("## Shapes\n");
  });
});
