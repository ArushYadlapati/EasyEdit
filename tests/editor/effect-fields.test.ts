import { describe, expect, it } from "vitest";
import {
  ANIMATION_IN,
  ANIMATION_OUT,
  TRANSITION_KINDS,
  animationOps,
  emphasisOps,
  pickEmphasis,
  pickTransition,
  transitionOps,
} from "@/lib/editor/effect-fields";
import type { MediaClip, TextClip } from "@/lib/timeline";
import { text, video } from "./fixtures";

const v = video("c1", 0, 60) as MediaClip;
const t = text("x1", 0, 60) as TextClip;

describe("effect option lists", () => {
  it("offers Crossfade only for In", () => {
    expect(TRANSITION_KINDS.find((k) => k.value === "crossfade")).toMatchObject({ in: true, out: false });
    expect(TRANSITION_KINDS.filter((k) => k.out).map((k) => k.value)).not.toContain("crossfade");
  });
  it("keeps typewriter and scale punch out of Out", () => {
    expect(ANIMATION_IN.map((a) => a.value)).toContain("typewriter");
    expect(ANIMATION_OUT.map((a) => a.value)).not.toContain("typewriter");
    expect(ANIMATION_OUT.map((a) => a.value)).not.toContain("scale_punch");
  });
});

describe("op builders", () => {
  it("sends the whole transition in one update_clip", () => {
    expect(transitionOps(v, "in", { kind: "fade", frames: 15 })).toEqual([
      { op: "update_clip", clipId: "c1", patch: { transitionIn: { kind: "fade", frames: 15 } } },
    ]);
  });
  it("sends null for None and nothing when unchanged", () => {
    const withOut = video("c1", 0, 60, { transitionOut: { kind: "zoom", frames: 9 } }) as MediaClip;
    expect(transitionOps(withOut, "out", null)).toEqual([{ op: "update_clip", clipId: "c1", patch: { transitionOut: null } }]);
    expect(transitionOps(withOut, "out", { frames: 9, kind: "zoom" })).toEqual([]);
    expect(transitionOps(v, "in", null)).toEqual([]);
  });
  it("builds animation and emphasis ops", () => {
    expect(animationOps(t, "in", { preset: "pop", frames: 12 })).toEqual([
      { op: "update_clip", clipId: "x1", patch: { animationIn: { preset: "pop", frames: 12 } } },
    ]);
    expect(emphasisOps(t, { preset: "shake" })).toEqual([{ op: "update_clip", clipId: "x1", patch: { emphasis: { preset: "shake" } } }]);
    expect(emphasisOps(t, null)).toEqual([]);
  });
});

describe("picking a kind", () => {
  it("fills the extras each kind needs and keeps the length", () => {
    expect(pickTransition(null, "slide", 30)).toEqual({ kind: "slide", frames: 15, direction: "left" });
    expect(pickTransition({ kind: "fade", frames: 20 }, "dip", 30)).toEqual({ kind: "dip", frames: 20, color: "#000000" });
    expect(pickTransition({ kind: "slide", frames: 9, direction: "up" }, "zoom", 30)).toEqual({ kind: "zoom", frames: 9 });
    expect(pickEmphasis(null, "highlight_word")).toEqual({ preset: "highlight_word", color: "#FFD400" });
    expect(pickEmphasis({ preset: "highlight_word", color: "#ff0000" }, "pulse")).toEqual({ preset: "pulse" });
  });
});
