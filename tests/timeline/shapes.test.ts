import { describe, expect, it } from "vitest";
import {
  Clip,
  DEFAULT_TRANSFORM,
  applyOps,
  arrowEnds,
  arrowFromEnds,
  arrowPoint,
  createEmptyDoc,
  describe as describeDoc,
  newShapeClip,
  prepareOps,
  shapeBox,
  shapeName,
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
  it("a new rectangle, ellipse, line and arrow are valid clips", () => {
    for (const tool of ["rect", "ellipse", "line", "arrow"] as const) {
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
    expect(arrowPoint(a, 0.5).y).toBeCloseTo(100);
    expect(arrowPoint(a, 0).x).toBeCloseTo(-200);
    expect(arrowPoint(a, 1).x).toBeCloseTo(200);
    expect(shapeBox(a).bottom).toBeGreaterThan(100);
    expect(shapeBox(rect())).toEqual({ left: -150, top: -100, right: 150, bottom: 100 });
  });
});
