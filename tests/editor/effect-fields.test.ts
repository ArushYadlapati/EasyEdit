import { describe, expect, it } from "vitest";
import {
  ANIMATION_IN,
  ANIMATION_OUT,
  EMPHASIS,
  TRANSITION_KINDS,
  animationOps,
  emphasisOps,
  emphasisOptions,
  emphasisPercent,
  pickEmphasis,
  pickTransition,
  transitionOps,
  withEmphasisPercent,
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
  it("offers shake and pulse for emphasis, and highlight word only to a clip that has it", () => {
    expect(EMPHASIS.map((e) => e.value)).toEqual(["shake", "pulse"]);
    expect(emphasisOptions(undefined)).toEqual(EMPHASIS);
    expect(emphasisOptions("pulse")).toEqual(EMPHASIS);
    expect(emphasisOptions("highlight_word")).toEqual([...EMPHASIS, { value: "highlight_word", label: "Highlight word" }]);
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
  it("keeps an emphasis's amount and speed from shake to pulse, and nothing else", () => {
    expect(pickEmphasis({ preset: "shake", amount: 0.5, speed: 2 }, "pulse")).toStrictEqual({ preset: "pulse", amount: 0.5, speed: 2 });
    expect(pickEmphasis({ preset: "pulse", speed: 0.5 }, "shake")).toStrictEqual({ preset: "shake", speed: 0.5 });
    expect(pickEmphasis({ preset: "highlight_word", color: "#ff0000", amount: 2 }, "shake")).toStrictEqual({ preset: "shake" });
  });
});

describe("emphasis amount and speed", () => {
  it("are shown as whole percents, 100 when left out", () => {
    expect(emphasisPercent({ preset: "shake" }, "amount")).toBe(100);
    expect(emphasisPercent({ preset: "shake", amount: 0.37, speed: 2.5 }, "amount")).toBe(37);
    expect(emphasisPercent({ preset: "shake", amount: 0.37, speed: 2.5 }, "speed")).toBe(250);
  });
  it("are kept as factors, whole percents and in range, and 100% as no value", () => {
    const shake = { preset: "shake" as const };
    expect(withEmphasisPercent(shake, "amount", 50)).toStrictEqual({ preset: "shake", amount: 0.5 });
    expect(withEmphasisPercent(shake, "amount", 33.6)).toStrictEqual({ preset: "shake", amount: 0.34 });
    expect(withEmphasisPercent(shake, "amount", 0)).toStrictEqual({ preset: "shake", amount: 0.1 });
    expect(withEmphasisPercent(shake, "amount", 1000)).toStrictEqual({ preset: "shake", amount: 3 });
    expect(withEmphasisPercent(shake, "speed", 10)).toStrictEqual({ preset: "shake", speed: 0.25 });
    expect(withEmphasisPercent(shake, "speed", 1000)).toStrictEqual({ preset: "shake", speed: 4 });
    expect(withEmphasisPercent({ preset: "pulse", amount: 2, speed: 3 }, "amount", 100)).toStrictEqual({ preset: "pulse", speed: 3 });
  });
  it("send the whole emphasis, and nothing when it is unchanged", () => {
    const shaking = text("x1", 0, 60, { emphasis: { preset: "shake", amount: 0.5 } }) as TextClip;
    expect(emphasisOps(shaking, withEmphasisPercent(shaking.emphasis!, "speed", 200))).toEqual([
      { op: "update_clip", clipId: "x1", patch: { emphasis: { preset: "shake", amount: 0.5, speed: 2 } } },
    ]);
    expect(emphasisOps(shaking, withEmphasisPercent(shaking.emphasis!, "amount", 50))).toEqual([]);
  });
});
