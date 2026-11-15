import { describe, expect, it } from "vitest";
import { guideAt, guideAxisOf, guideLines, offFrame, snapGuide } from "@/lib/editor/guides";

const frame = { width: 1080, height: 1920 };

describe("guide geometry", () => {
  it("a mostly sideways drag makes a vertical guide, a mostly up-and-down one a horizontal guide", () => {
    expect(guideAxisOf(10, 3)).toBe("x");
    expect(guideAxisOf(-2, -9)).toBe("y");
    expect(guideAxisOf(5, 5)).toBe("x");
  });

  it("snaps to the frame's edges and centre line within the distance, and not with snapping off", () => {
    expect(snapGuide(0.52, "x", frame, 30, true)).toEqual({ at: 0.5, snapped: true }); // 561.6 px is 21.6 from 540
    expect(snapGuide(0.52, "y", frame, 30, true)).toEqual({ at: 0.52, snapped: false }); // 998.4 is 38.4 from 960
    expect(snapGuide(0.01, "x", frame, 30, true)).toEqual({ at: 0, snapped: true });
    expect(snapGuide(0.995, "y", frame, 30, true)).toEqual({ at: 1, snapped: true });
    expect(snapGuide(0.52, "x", frame, 30, false)).toEqual({ at: 0.52, snapped: false });
  });

  it("finds the nearest guide within the slop", () => {
    const guides = [
      { id: "a", axis: "x" as const, at: 0.5 },
      { id: "b", axis: "y" as const, at: 0.25 },
      { id: "c", axis: "x" as const, at: 0.51 },
    ];
    expect(guideAt(guides, { x: 546, y: 100 }, frame, 8)?.id).toBe("c"); // 6 from a (540), 4.8 from c (550.8)
    expect(guideAt(guides, { x: 100, y: 484 }, frame, 8)?.id).toBe("b"); // 4 from 480
    expect(guideAt(guides, { x: 100, y: 1000 }, frame, 8)).toBeNull();
  });

  it("a guide dragged past an edge is off the frame", () => {
    expect([offFrame(-0.01), offFrame(0), offFrame(1), offFrame(1.2)]).toEqual([true, false, false, true]);
  });

  it("gives each guide's place in project pixels", () => {
    expect(guideLines([{ id: "a", axis: "x", at: 0.5 }, { id: "b", axis: "y", at: 0.25 }], frame)).toEqual({ x: [540], y: [480] });
  });
});
