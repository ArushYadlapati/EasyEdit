import { describe, expect, it } from "vitest";
import { numberText, profilePatch, sameValue, tidyProfile, typedLength, typedShot } from "@/lib/style/draft";
import { StyleProfilePatch } from "@/lib/style/types";

describe("the form's profile as it would be saved", () => {
  it("trims text, drops blank list rows and parts of Captions left unset, and leaves out what says nothing", () => {
    expect(
      tidyProfile({
        summary: "  Bright and quick.  ",
        hook: "   ",
        always: [" open on the best moment ", "", "  "],
        never: ["", " "],
        captions: { on: true, look: undefined, uppercase: false },
        formats: [],
        pace: "quick",
      }),
    ).toEqual({ summary: "Bright and quick.", always: ["open on the best moment"], captions: { on: true, uppercase: false }, pace: "quick" });
  });
});

describe("what Save sends", () => {
  it("is only the fields that changed, with null for one emptied", () => {
    const saved = { summary: "Bright.", pace: "quick" as const, never: ["long intros"], captions: { on: true, look: "karaoke" as const } };
    const draft = { summary: "Bright. ", pace: "calm" as const, never: [], captions: { look: "karaoke" as const, on: true }, music: "soft" as const };
    const patch = profilePatch(saved, draft);
    expect(patch).toEqual({ pace: "calm", never: null, music: "soft" });
    expect(StyleProfilePatch.parse(patch)).toEqual(patch);
  });

  it("is nothing when the form holds what was saved", () => {
    expect(profilePatch({ always: ["a"], lengthSeconds: { min: 15, max: 45 } }, { always: ["a", ""], lengthSeconds: { max: 45, min: 15 } })).toEqual({});
  });

  it("notices a list in another order", () => {
    expect(profilePatch({ formats: ["short_9x16", "long_16x9"] }, { formats: ["long_16x9", "short_9x16"] })).toEqual({ formats: ["long_16x9", "short_9x16"] });
  });
});

describe("two values", () => {
  it("are the same when they hold the same, ignoring fields left undefined", () => {
    expect(sameValue({ on: true, look: undefined }, { on: true })).toBe(true);
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a"], "a")).toBe(false);
    expect(sameValue({ on: true }, { on: false })).toBe(false);
    expect(sameValue(undefined, null)).toBe(false);
  });
});

describe("the number boxes", () => {
  it("take a typical length of two numbers in range, the shorter first, or none at all", () => {
    expect(typedLength("", " ")).toEqual({ ok: true });
    expect(typedLength("15", "45")).toEqual({ ok: true, value: { min: 15, max: 45 } });
    expect(typedLength("30", "30")).toEqual({ ok: true, value: { min: 30, max: 30 } });
    expect(typedLength("15", "")).toEqual({ ok: false });
    expect(typedLength("45", "15")).toEqual({ ok: false });
    expect(typedLength("0", "15")).toEqual({ ok: false });
    expect(typedLength("15", "4000")).toEqual({ ok: false });
    expect(typedLength("fifteen", "45")).toEqual({ ok: false });
  });

  it("take a typical shot in range, to a tenth of a second", () => {
    expect(typedShot("")).toEqual({ ok: true });
    expect(typedShot("1.64")).toEqual({ ok: true, value: 1.6 });
    expect(typedShot("0.1")).toEqual({ ok: false });
    expect(typedShot("61")).toEqual({ ok: false });
    expect(typedShot("quick")).toEqual({ ok: false });
  });

  it("show a number as it was saved, and nothing for none", () => {
    expect(numberText(undefined)).toBe("");
    expect(numberText(1.6)).toBe("1.6");
    expect(numberText(45)).toBe("45");
  });
});
