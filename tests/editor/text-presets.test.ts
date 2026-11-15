import { describe, expect, it } from "vitest";
import { TEXT_PRESETS, TOOL_PRESETS, presetClip, presetFont } from "@/lib/editor/text-presets";

const fonts = { title: "Bebas Neue", subtitle: "Inter", body: "Orbitron" };
const preset = (id: string) => TOOL_PRESETS.find((p) => p.id === id)!;

describe("text presets", () => {
  it("the Text tab offers Title, Subtitle and Body text", () => {
    expect(TEXT_PRESETS.map((p) => p.label)).toEqual(["Title", "Subtitle", "Body text"]);
    expect(TOOL_PRESETS.map((p) => p.id)).toEqual(["title", "subtitle", "body", "lower-third"]);
  });

  it("a preset takes its role's kit font at the nearest weight", () => {
    expect(presetFont(preset("title"), fonts)).toEqual({ fontFamily: "Bebas Neue", fontWeight: 400 });
    expect(presetFont(preset("subtitle"), fonts)).toEqual({ fontFamily: "Inter", fontWeight: 500 });
    expect(presetFont(preset("body"), fonts)).toEqual({ fontFamily: "Orbitron", fontWeight: 400 });
    expect(presetFont(preset("lower-third"), fonts)).toEqual({ fontFamily: "Orbitron", fontWeight: 600 });
    expect(presetClip(preset("title"), 0, 30, 3, fonts).style).toMatchObject({ fontFamily: "Bebas Neue", fontWeight: 400, fontSize: 96 });
  });

  it("without fonts a preset is Geist", () => {
    expect(presetClip(preset("title"), 0, 30).style).toMatchObject({ fontFamily: "Geist", fontWeight: 700 });
  });
});
