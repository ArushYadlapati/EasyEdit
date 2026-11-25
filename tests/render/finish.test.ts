import { describe, expect, it } from "vitest";
import { packBytes } from "@/lib/color/cube";
import { drawFrame, type Ctx2D, type LayerUse, type ResolvedSource } from "@/lib/render/compositor";
import { FRAGMENT, createFinisher, type FinishPass } from "@/lib/render/finish-gl";
import { bakeGrade, lutOf } from "@/lib/render/grade";
import type { Clip, Lut, TimelineDoc } from "@/lib/timeline";
import { video } from "../editor/fixtures";
import { docWithCaptions } from "../helpers/docs";
import { fakeCtx, type Call } from "./fake-ctx";

const PICTURE: ResolvedSource = { image: { tag: "frame" } as unknown as CanvasImageSource, width: 1080, height: 1920 };
const WHOLE = ["drawImage", PICTURE.image, -540, -960, 1080, 1920];
const FINISHED = { tag: "finished" } as unknown as CanvasImageSource;
const lut = (id: string, fill = 9): Lut => ({ id, name: "Film", size: 2, data: packBytes(new Uint8Array(24).fill(fill)) });

type Layer = { ctx: Ctx2D; calls: Call[] };
function layerOf(width = 1080, height = 1920): Layer {
  const layer = fakeCtx();
  (layer.ctx as unknown as { canvas: unknown }).canvas = { width, height, of: layer };
  layer.calls.length = 0;
  return layer;
}

// Draws one clip at frame 10 and says what the frame, each layer and the finisher were asked for.
function draw(clip: Clip, opts: { layers?: Partial<Record<LayerUse, Layer>>; finish?: "none" | "fails"; change?: (d: TimelineDoc) => void; width?: number } = {}) {
  const d = docWithCaptions("short_9x16");
  d.tracks[0].clips = [clip];
  opts.change?.(d);
  const { ctx, calls } = fakeCtx();
  (ctx as unknown as { canvas: unknown }).canvas = { width: opts.width ?? 1080, height: ((opts.width ?? 1080) / 1080) * 1920 };
  const passes: { source: unknown; width: number; height: number; pass: FinishPass }[] = [];
  const asked: LayerUse[] = [];
  drawFrame(ctx, d, 10, {
    resolveSource: () => PICTURE,
    makeLayer: (_w, _h, use) => {
      asked.push(use);
      return opts.layers?.[use]?.ctx ?? null;
    },
    finish:
      opts.finish === "none"
        ? null
        : (source, width, height, pass) => {
            passes.push({ source, width, height, pass });
            return opts.finish === "fails" ? null : FINISHED;
          },
  });
  return { onFrame: calls.slice(calls.findIndex(([name]) => name === "scale") + 1, -1), passes, asked };
}
const pictured = (extra: Record<string, unknown>) => video("c", 0, 30, extra);
const ON_FRAME = (what: unknown) => [["setTransform", 1, 0, 0, 1, 0, 0], ["drawImage", what, 0, 0], ["setTransform", expect.anything()]];

describe("a picture with nothing for the graphics card", () => {
  it("is drawn straight onto the frame: no layer, no finisher", () => {
    for (const extra of [{}, { adjust: { grain: 0, vhs: 0 } }, { grade: {} }, { grade: { lift: { x: 0, y: 0, level: 0 }, curve: [], lut: null } }, { grade: { lut: "gone" } }]) {
      const { onFrame, passes, asked } = draw(pictured(extra), { layers: { finish: layerOf() } });
      expect(onFrame).toEqual([WHOLE]);
      expect(passes).toEqual([]);
      expect(asked).toEqual([]);
    }
  });
  it("stays on the old path when only its colours are changed", () => {
    const { onFrame, passes } = draw(pictured({ adjust: { brightness: 0.1 } }), { layers: { finish: layerOf() } });
    expect(onFrame).toEqual([["set filter", "brightness(1.1)"], WHOLE]);
    expect(passes).toEqual([]);
  });
});

describe("a stylised or graded picture", () => {
  it("is painted on a layer, finished, and the finished picture drawn onto the frame", () => {
    const finish = layerOf();
    const { onFrame, passes, asked } = draw(pictured({ adjust: { grain: 0.4, pixelate: 12 } }), { layers: { finish } });
    expect(finish.calls).toEqual([["save"], ["setTransform", 1, 0, 0, 1, 0, 0], ["clearRect", 0, 0, 1080, 1920], ["setTransform", expect.anything()], WHOLE, ["restore"]]);
    expect(onFrame).toEqual(ON_FRAME(FINISHED));
    expect(asked).toEqual(["finish"]);
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ width: 1080, height: 1920 });
    expect((passes[0].source as { of: Layer }).of).toBe(finish);
    expect(passes[0].pass).toEqual({
      style: { sharpen: 0, grain: 0.4, pixelate: 12, split: 0, glitch: 0, vhs: 0 },
      grade: null,
      project: { width: 1080, height: 1920 },
      scale: 1,
      time: 10 / 30,
    });
  });
  it("tells the finisher how small the canvas is, so an effect is the same share of a preview", () => {
    const { passes } = draw(pictured({ adjust: { pixelate: 12 } }), { layers: { finish: layerOf(540, 960) }, width: 540 });
    expect(passes[0]).toMatchObject({ width: 540, height: 960, pass: { scale: 0.5, project: { width: 1080, height: 1920 } } });
  });
  it("has its colours changed first, on a layer of their own, and that is what is finished", () => {
    const finish = layerOf();
    const tone = layerOf();
    const { onFrame, asked } = draw(pictured({ adjust: { temperature: 1, brightness: 0.2, vhs: 1 } }), { layers: { finish, tone } });
    expect(asked).toEqual(["finish", "tone"]);
    expect(tone.calls).toContainEqual(["set filter", "brightness(1.2)"]);
    expect(tone.calls).toContainEqual(WHOLE);
    // The warmed picture joins the finishing layer, not the frame.
    expect(finish.calls.slice(4, -1)).toEqual([["setTransform", 1, 0, 0, 1, 0, 0], ["drawImage", (tone.ctx as unknown as { canvas: unknown }).canvas, 0, 0], ["setTransform", expect.anything()]]);
    expect(onFrame).toEqual(ON_FRAME(FINISHED));
  });
  it("carries its grade, with the project's table unpacked", () => {
    const grade = { gain: { x: 0, y: 0, level: 0.5 }, curve: [{ x: 0, y: 0.2 }, { x: 1, y: 1 }], lut: "L1", lutAmount: 0.6 };
    const { passes } = draw(pictured({ grade }), { layers: { finish: layerOf() }, change: (d) => void (d.luts = [lut("L1")]) });
    const baked = passes[0].pass.grade!;
    expect(baked.wheels!.gain).toEqual([1.25, 1.25, 1.25]);
    expect(baked.curves!.length).toBe(1024);
    expect(baked.curves![0]).toBe(51); // 0.2 of 255
    expect(baked.lut).toMatchObject({ size: 2 });
    expect([...baked.lut!.data]).toEqual(new Array(24).fill(9));
    expect(baked.lutAmount).toBe(0.6);
    expect(passes[0].pass.style).toEqual({ sharpen: 0, grain: 0, pixelate: 0, split: 0, glitch: 0, vhs: 0 });
  });
  it("keeps its opacity and blend, which the frame sets before the finished picture lands", () => {
    const d = docWithCaptions("short_9x16");
    d.tracks[0].clips = [pictured({ blend: "screen", adjust: { glitch: 1 } })];
    const { ctx, calls } = fakeCtx();
    (ctx as unknown as { canvas: unknown }).canvas = { width: 1080, height: 1920 };
    drawFrame(ctx, d, 10, { resolveSource: () => PICTURE, makeLayer: () => layerOf().ctx, finish: () => FINISHED });
    const names = calls.map(([name]) => name);
    expect(names.indexOf("set globalCompositeOperation")).toBeLessThan(names.lastIndexOf("drawImage"));
    expect(calls[names.lastIndexOf("drawImage")]).toEqual(["drawImage", FINISHED, 0, 0]);
  });
});

describe("where the graphics card or a layer is missing", () => {
  it("no layer: the picture is drawn plain, its colour changes still on", () => {
    expect(draw(pictured({ adjust: { grain: 1 } })).onFrame).toEqual([WHOLE]);
    expect(draw(pictured({ adjust: { grain: 1, contrast: 0.5 } })).onFrame).toEqual([["set filter", "contrast(1.5)"], WHOLE]);
  });
  it("no finisher, or one that cannot run: the layer is drawn as it is", () => {
    for (const finish of ["none", "fails"] as const) {
      const layer = layerOf();
      const { onFrame } = draw(pictured({ adjust: { grain: 1 } }), { layers: { finish: layer }, finish });
      expect(onFrame).toEqual(ON_FRAME((layer.ctx as unknown as { canvas: unknown }).canvas));
    }
  });
  it("a finisher with no canvas to work on gives null every time, and asks only once", () => {
    let asked = 0;
    const finisher = createFinisher(() => {
      asked++;
      return null;
    });
    const pass: FinishPass = { style: { sharpen: 0, grain: 1, pixelate: 0, split: 0, glitch: 0, vhs: 0 }, grade: null, project: { width: 10, height: 10 }, scale: 1, time: 0 };
    expect(finisher({} as TexImageSource, 10, 10, pass)).toBeNull();
    expect(finisher({} as TexImageSource, 10, 10, pass)).toBeNull();
    expect(asked).toBe(1);
  });
});

describe("a grade made ready to draw", () => {
  it("is worked out once for the same grade and tables", () => {
    const grade = { lift: { x: 0.1, y: 0, level: 0 }, lut: "L1" };
    const luts = [lut("L1")];
    const first = bakeGrade(grade, luts);
    expect(bakeGrade(grade, luts)).toBe(first);
    expect(bakeGrade({ ...grade }, luts)).not.toBe(first);
    expect(bakeGrade({ ...grade }, luts)!.lut).toBe(first!.lut); // the table itself is unpacked once
    expect(bakeGrade(grade, [])!.lut).toBeNull(); // the table left the project
    expect(bakeGrade(grade, luts)!.lut).not.toBeNull(); // and came back
  });
  it("is nothing when no part changes the picture", () => {
    expect(bakeGrade(undefined, undefined)).toBeNull();
    expect(bakeGrade({}, undefined)).toBeNull();
    expect(bakeGrade({ lut: "L1", lutAmount: 0 }, [lut("L1")])).toBeNull();
    expect(bakeGrade({ lut: "L1" }, [{ ...lut("L1"), data: "AAAA" }])).toBeNull(); // not a table of its size
  });
  it("reads a table again when its text has changed under the same id", () => {
    expect([...lutOf([lut("L9", 9)], "L9")!.data.slice(0, 2)]).toEqual([9, 9]);
    expect([...lutOf([lut("L9", 4)], "L9")!.data.slice(0, 2)]).toEqual([4, 4]);
    expect(lutOf([lut("L9", 9)], "nope")).toBeNull();
    expect(lutOf(undefined, "L9")).toBeNull();
  });
});

describe("the shader", () => {
  it("reads the curves at the middle of each of their 256 steps", () => {
    expect(FRAGMENT).toContain("(rgb * 255.0 + 0.5) / 256.0");
    expect(FRAGMENT.startsWith("#version 300 es")).toBe(true);
  });
});
