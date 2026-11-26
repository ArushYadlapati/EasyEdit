// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider } from "@/components/editor/media/media-context";
import { MESSAGES } from "@/lib/editor/messages";
import { findClip } from "@/lib/editor/store";
import { LOOKS, lookPatch, type MediaClip, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc } from "../editor/fixtures";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

function show(opts: { doc?: TimelineDoc; canEdit?: boolean; select?: string[] } = {}) {
  const store = makeStore({ doc: opts.doc ?? sampleDoc(), canEdit: opts.canEdit ?? true });
  store.getState().select(opts.select ?? ["c1"]);
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([assetView()])}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  const clip = () => findClip(store.getState().doc, "c1")!.clip as MediaClip;
  const field = (name: string) => screen.getByLabelText(name) as HTMLInputElement;
  const type = (name: string, value: string) => {
    fireEvent.change(field(name), { target: { value } });
    fireEvent.blur(field(name));
  };
  return { store, clip, field, type, notices: noticesOf(store) };
}
const withClip = (change: (clip: MediaClip) => void) => {
  const d = sampleDoc();
  change(findClip(d, "c1")!.clip as MediaClip);
  return d;
};
// A square 200 px a side at the page's corner, which is what every drag below is measured against.
function boxed<T extends Element>(el: T): T {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) });
  return el;
}
const openGrade = () => fireEvent.click(screen.getByRole("button", { name: "Wheels, curves and LUT" }));
const cubeFile = (name: string, size = 2) => {
  let text = `LUT_3D_SIZE ${size}\n`;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) text += `${b / (size - 1)} ${g / (size - 1)} ${r / (size - 1)}\n`;
  return new File([text], name, { type: "text/plain" });
};

it("lists every look and shows a strength only while a look is on", () => {
  const { clip, field, type } = show();
  const looks = within(screen.getByRole("group", { name: "Looks" })).getAllByRole("button");
  expect(looks.map((b) => b.textContent)).toEqual(["None", ...LOOKS.map((l) => l.label)]);
  expect(screen.queryByLabelText("Look strength")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Noir" }));
  expect(screen.getByRole("button", { name: "Noir" }).getAttribute("aria-pressed")).toBe("true");
  expect(field("Look strength").value).toBe("100");
  type("Look strength", "50");
  expect(clip().adjust).toMatchObject(lookPatch(LOOKS.find((l) => l.id === "noir")!, 0.5));
  // Half a look is still that look.
  expect(screen.getByRole("button", { name: "Noir" }).getAttribute("aria-pressed")).toBe("true");
  expect(field("Look strength").value).toBe("50");
  // It stops at 1%, so the field never goes away under the hand dragging it: None takes a look off.
  type("Look strength", "0");
  expect(field("Look strength").value).toBe("1");
  fireEvent.click(screen.getByRole("button", { name: "None" }));
  expect(screen.queryByLabelText("Look strength")).toBeNull();
});

it("sets each stylised effect and takes them all off without touching the colours", () => {
  const { store, clip, field, type } = show({ doc: withClip((c) => void (c.adjust = { brightness: 0.2 })) });
  expect(screen.getByRole("heading", { name: "Stylize" })).toBeTruthy();
  const reset = screen.getByRole("button", { name: "Reset effects" }) as HTMLButtonElement;
  expect(reset.disabled).toBe(true);
  expect((["Sharpen", "Film grain", "Pixelate", "Color split", "Glitch", "VHS"] as const).map((name) => field(name).value)).toEqual(["0", "0", "0", "0", "0", "0"]);
  type("Film grain", "40");
  type("Pixelate", "16");
  expect(clip().adjust).toMatchObject({ grain: 0.4, pixelate: 16, brightness: 0.2 });
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "effect change" });
  fireEvent.click(reset);
  expect(clip().adjust).toMatchObject({ grain: 0, pixelate: 0, vhs: 0, brightness: 0.2 });
  expect((screen.getByRole("button", { name: "Reset color" }) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps the grade folded away until asked for, and open for a picture that has one", () => {
  show();
  expect(screen.queryByRole("slider", { name: "Shadows color" })).toBeNull();
  openGrade();
  expect(["Shadows color", "Midtones color", "Highlights color"].map((name) => screen.getByRole("slider", { name }).getAttribute("aria-valuetext"))).toEqual(["No push", "No push", "No push"]);
  fireEvent.click(screen.getByRole("button", { name: "Hide wheels, curves and LUT" }));
  expect(screen.queryByRole("slider", { name: "Shadows color" })).toBeNull();
});

it("opens the grade by itself for a graded picture", () => {
  show({ doc: withClip((c) => void (c.grade = { gain: { x: 0, y: 0, level: 0.2 } })) });
  expect(screen.getByRole("slider", { name: "Highlights color" })).toBeTruthy();
  expect((screen.getByLabelText("Highlights") as HTMLInputElement).value).toBe("20");
});

it("dragging a wheel's puck shows each place and saves one change when let go", () => {
  const { store, clip } = show();
  openGrade();
  const pad = boxed(screen.getByRole("slider", { name: "Midtones color" }));
  const before = store.getState().queue.length;
  fireEvent.pointerDown(pad, { button: 0, clientX: 150, clientY: 100, pointerId: 1 });
  // Shown, not yet saved.
  expect(clip().grade).toBeUndefined();
  expect(pad.querySelector("[data-puck]")!.getAttribute("style")).toContain("left: 75%");
  fireEvent.pointerMove(pad, { clientX: 100, clientY: 40, pointerId: 1 });
  fireEvent.pointerUp(pad, { pointerId: 1 });
  expect(clip().grade).toEqual({ gamma: { x: 0, y: 0.6, level: 0 } });
  expect(store.getState().queue.length).toBe(before + 1);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "color grade" });
  expect(pad.getAttribute("aria-valuenow")).toBe("60");
  // A drag past the rim stays on it; a double click goes back to the middle.
  fireEvent.pointerDown(pad, { button: 0, clientX: 500, clientY: 100, pointerId: 2 });
  fireEvent.pointerUp(pad, { pointerId: 2 });
  expect(clip().grade!.gamma).toEqual({ x: 1, y: 0, level: 0 });
  fireEvent.doubleClick(pad);
  expect(clip().grade!.gamma).toEqual({ x: 0, y: 0, level: 0 });
  store.getState().undo();
  expect(clip().grade!.gamma).toEqual({ x: 1, y: 0, level: 0 });
});

it("the arrow keys nudge a puck, and its brightness is a number beside it", () => {
  const { clip, type } = show();
  openGrade();
  const pad = screen.getByRole("slider", { name: "Shadows color" });
  fireEvent.keyDown(pad, { key: "ArrowRight" });
  expect(clip().grade!.lift).toEqual({ x: 0.05, y: 0, level: 0 });
  fireEvent.keyDown(pad, { key: "ArrowUp", shiftKey: true });
  expect(clip().grade!.lift).toEqual({ x: 0.05, y: 0.2, level: 0 });
  type("Shadows", "-25");
  expect(clip().grade!.lift).toEqual({ x: 0.05, y: 0.2, level: -0.25 });
  fireEvent.keyDown(pad, { key: "Delete" });
  expect(clip().grade!.lift).toEqual({ x: 0, y: 0, level: -0.25 });
});

it("a press on the curve adds a point and drags it; a double click takes it out", () => {
  const { store, clip } = show();
  openGrade();
  const svg = boxed(screen.getByRole("group", { name: "All curve" }));
  expect(svg.querySelectorAll("[data-point]").length).toBe(2);
  const before = store.getState().queue.length;
  fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 60, pointerId: 1 });
  expect(svg.querySelectorAll("[data-point]").length).toBe(3);
  fireEvent.pointerMove(svg, { clientX: 80, clientY: 40, pointerId: 1 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  expect(clip().grade).toEqual({ curve: [{ x: 0, y: 0 }, { x: 0.4, y: 0.8 }, { x: 1, y: 1 }] });
  expect(store.getState().queue.length).toBe(before + 1);
  // A press on the point drags that one: no fourth point.
  fireEvent.pointerDown(svg, { button: 0, clientX: 82, clientY: 42, pointerId: 2 });
  fireEvent.pointerMove(svg, { clientX: 60, clientY: 100, pointerId: 2 });
  fireEvent.pointerUp(svg, { pointerId: 2 });
  expect(clip().grade!.curve).toEqual([{ x: 0, y: 0 }, { x: 0.3, y: 0.5 }, { x: 1, y: 1 }]);
  fireEvent.doubleClick(svg, { clientX: 60, clientY: 100 });
  expect(clip().grade!.curve).toEqual([]);
  expect((screen.getByRole("button", { name: "Reset curve" }) as HTMLButtonElement).disabled).toBe(true);
});

it("each colour has a curve of its own, moved with the keys and reset alone", () => {
  const { clip } = show();
  openGrade();
  fireEvent.click(screen.getByRole("radio", { name: "Red" }));
  const svg = boxed(screen.getByRole("group", { name: "Red curve" }));
  fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  expect(clip().grade!.curveR).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]);
  const middle = screen.getByRole("slider", { name: "Point 2 of 3" });
  fireEvent.keyDown(middle, { key: "ArrowUp", shiftKey: true });
  expect(clip().grade!.curveR![1]).toEqual({ x: 0.5, y: 0.6 });
  expect(clip().grade!.curve).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Reset curve" }));
  expect(clip().grade!.curveR).toEqual([]);
  fireEvent.keyDown(screen.getByRole("slider", { name: "Point 1 of 2" }), { key: "Delete" });
  expect(clip().grade!.curveR).toEqual([]); // a curve keeps its two ends
});

it("reads a .cube file into the project and onto the clip, with a strength and a way out", async () => {
  const { store, clip, field, type } = show();
  openGrade();
  expect(screen.queryByLabelText("LUT strength")).toBeNull();
  fireEvent.change(screen.getByLabelText("LUT file"), { target: { files: [cubeFile("Teal and Orange.cube")] } });
  await waitFor(() => expect(store.getState().doc.luts?.length).toBe(1));
  const [lut] = store.getState().doc.luts!;
  expect(lut).toMatchObject({ name: "Teal and Orange", size: 2 });
  expect(clip().grade).toEqual({ lut: lut.id });
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "import LUT" });
  expect((screen.getByLabelText("LUT") as HTMLSelectElement).value).toBe(lut.id);
  expect(field("LUT strength").value).toBe("100");
  type("LUT strength", "60");
  expect(clip().grade!.lutAmount).toBe(0.6);
  fireEvent.change(screen.getByLabelText("LUT"), { target: { value: "" } });
  expect(clip().grade!.lut).toBeNull();
  expect(store.getState().doc.luts?.length).toBe(1); // still the project's
  fireEvent.change(screen.getByLabelText("LUT"), { target: { value: lut.id } });
  fireEvent.click(screen.getByRole("button", { name: "Remove from project" }));
  expect(store.getState().doc.luts).toBeUndefined();
  expect(clip().grade!.lut).toBeNull();
  store.getState().undo();
  expect(store.getState().doc.luts?.[0].id).toBe(lut.id);
  expect(clip().grade!.lut).toBe(lut.id);
});

it("says what is wrong with a file that is not a table, and changes nothing", async () => {
  const { store, notices } = show();
  openGrade();
  fireEvent.change(screen.getByLabelText("LUT file"), { target: { files: [new File(["just some words"], "notes.cube")] } });
  await waitFor(() => expect(notices).toContain("That file has no look-up table in it."));
  expect(store.getState().doc.luts).toBeUndefined();
  expect(MESSAGES.lutsFull.length).toBeGreaterThan(20);
});

it("Reset color takes the colours and the whole grade off, and leaves the effects", () => {
  const { clip } = show({ doc: withClip((c) => {
    c.adjust = { saturation: 0.5, blur: 3, grain: 0.3 };
    c.grade = { lift: { x: 0.2, y: 0, level: 0 }, curve: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }], lut: "gone", lutAmount: 0.5 };
  }) });
  fireEvent.click(screen.getByRole("button", { name: "Reset color" }));
  expect(clip().adjust).toMatchObject({ saturation: 0, blur: 0, grain: 0.3 });
  expect(clip().grade).toEqual({ lift: { x: 0, y: 0, level: 0 }, gamma: { x: 0, y: 0, level: 0 }, gain: { x: 0, y: 0, level: 0 }, curve: [], curveR: [], curveG: [], curveB: [], lut: null, lutAmount: 1 });
  expect((screen.getByRole("button", { name: "Reset color" }) as HTMLButtonElement).disabled).toBe(true);
});

it("a viewer sees the grade but can change none of it", () => {
  const { store, clip } = show({ canEdit: false, doc: withClip((c) => void (c.grade = { gain: { x: 0.3, y: 0, level: 0 } })) });
  const pad = boxed(screen.getByRole("slider", { name: "Highlights color" }));
  fireEvent.pointerDown(pad, { button: 0, clientX: 20, clientY: 20, pointerId: 1 });
  fireEvent.pointerUp(pad, { pointerId: 1 });
  fireEvent.keyDown(pad, { key: "ArrowLeft" });
  const svg = boxed(screen.getByRole("group", { name: "All curve" }));
  fireEvent.pointerDown(svg, { button: 0, clientX: 100, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(svg, { pointerId: 1 });
  expect(clip().grade).toEqual({ gain: { x: 0.3, y: 0, level: 0 } });
  expect(store.getState().gesture).toBeNull();
  expect((screen.getByRole("button", { name: "Import .cube" }) as HTMLButtonElement).disabled).toBe(true);
});

it("every colour and effect has a keyframe diamond: a keyed one is typed at the playhead, and Reset clears its keyframes", () => {
  const { store, clip, field, type } = show();
  const start = clip().start;
  const seek = (frame: number) => act(() => store.getState().seek(frame));
  seek(start + 4);
  for (const name of ["Brightness", "Warmth", "Blur", "Film grain", "VHS"]) expect(screen.getByRole("button", { name: `Add ${name} keyframe` })).toBeTruthy();
  type("Film grain", "20");
  fireEvent.click(screen.getByRole("button", { name: "Add Film grain keyframe" }));
  expect(clip().keyframes).toEqual({ grain: [{ at: 4, value: 0.2 }] });
  expect(screen.getByRole("button", { name: "Remove Film grain keyframe" })).toBeTruthy();
  seek(start + 10);
  type("Film grain", "80");
  expect(clip().keyframes!.grain).toEqual([{ at: 4, value: 0.2 }, { at: 10, value: 0.8 }]);
  seek(start + 7);
  expect(field("Film grain").value).toBe("50");
  fireEvent.click(screen.getByRole("button", { name: "Reset effects" }));
  expect(clip().keyframes!.grain).toEqual([]);
  expect(clip().adjust!.grain).toBe(0);
  expect(field("Film grain").value).toBe("0");
});

it("an adjustment layer shows its amount, the colours, the effects and its timing, and nothing a picture alone has", () => {
  const d = sampleDoc();
  d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [{ id: "adj", type: "adjustment", start: 0, duration: 60, transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, fit: "cover" } }] });
  const { store, field, type } = show({ doc: d, select: ["adj"] });
  const layer = () => findClip(store.getState().doc, "adj")!.clip as { adjust?: Record<string, number>; transform: { opacity: number } };
  expect(screen.getByRole("heading", { name: "Adjustment layer" })).toBeTruthy();
  expect(["Color", "Stylize", "Timing"].map((name) => !!screen.queryByRole("heading", { name }))).toEqual([true, true, true]);
  expect(["Blend", "Position", "Crop", "Sound", "Speed"].map((name) => !!screen.queryByRole("heading", { name }))).toEqual([false, false, false, false, false]);
  expect([screen.queryByLabelText("Corner rounding"), screen.queryByRole("switch", { name: "Green screen" })]).toEqual([null, null]);
  expect(field("Amount").value).toBe("100");
  type("Amount", "40");
  expect(layer().transform.opacity).toBe(0.4);
  expect(screen.getByRole("button", { name: "Add Opacity keyframe" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Vintage" }));
  expect(layer().adjust).toMatchObject({ temperature: 0.3, vignette: 0.45 });
  type("VHS", "50");
  expect(layer().adjust).toMatchObject({ vhs: 0.5 });
  openGrade();
  expect(screen.getByRole("slider", { name: "Shadows color" })).toBeTruthy();
});

it("a mask is off until switched on, then shows its shape, place, size, soft edge and Invert", () => {
  const { clip, field, type } = show();
  expect(screen.getByRole("heading", { name: "Mask" })).toBeTruthy();
  expect(screen.queryByLabelText("Mask width")).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Show only part of the picture" }));
  expect(clip().mask).toEqual({ shape: "ellipse", x: 0.5, y: 0.5, width: 0.6, height: 0.6, feather: 0.1 });
  expect([field("Mask X").value, field("Mask width").value, field("Soft edge").value]).toEqual(["50", "60", "10"]);
  fireEvent.click(screen.getByRole("radio", { name: "Rectangle" }));
  type("Mask width", "30");
  fireEvent.click(screen.getByRole("switch", { name: "Invert" }));
  expect(clip().mask).toEqual({ shape: "rect", x: 0.5, y: 0.5, width: 0.3, height: 0.6, feather: 0.1, invert: true });
  fireEvent.click(screen.getByRole("switch", { name: "Show only part of the picture" }));
  expect(clip().mask).toBeNull();
  expect(screen.queryByLabelText("Mask width")).toBeNull();
});

it("scopes are counted only while shown, and name which one is on", () => {
  show();
  expect(screen.queryByRole("img", { name: /of the frame in the preview/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Scopes" }));
  expect(screen.getByRole("img", { name: "Histogram of the frame in the preview" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Vectorscope" }));
  expect(screen.getByRole("img", { name: "Vectorscope of the frame in the preview" })).toBeTruthy();
  expect(screen.getByText(/grey is the middle/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hide scopes" }));
  expect(screen.queryByRole("img", { name: /of the frame in the preview/ })).toBeNull();
});
