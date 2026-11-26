// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EffectsPanel } from "@/components/editor/effects-panel";
import { Inspector } from "@/components/editor/inspector";
import { findClip } from "@/lib/editor/store";
import { newShapeClip, type ShapeClip, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { fireEvent, render, screen } from "../helpers/dom";
import { openEverySection } from "../helpers/folds";

// These tests are about what the sections hold, so every section starts open.
beforeEach(openEverySection);

function docWith(clip: ShapeClip): TimelineDoc {
  const doc = sampleDoc();
  doc.tracks.splice(1, 0, { id: "s1", kind: "shape", name: "Shapes 1", muted: false, hidden: false, locked: false, clips: [clip] });
  return doc;
}
const shape = (tool: "rect" | "ellipse" | "star" | "line" | "arrow", extra: Partial<ShapeClip> = {}): ShapeClip => ({
  id: "sh",
  ...newShapeClip(tool, { start: 0, duration: 60, x: 0.5, y: 0.5, width: 400, height: 200 }, { width: 1080, height: 1920 }),
  ...extra,
});

function open(clip: ShapeClip) {
  const store = makeStore({ doc: docWith(clip) });
  store.getState().select(["sh"]);
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  return store;
}
const saved = (store: ReturnType<typeof makeStore>) => findClip(store.getState().doc, "sh")!.clip as ShapeClip;

describe("the inspector for a shape", () => {
  it("a rectangle shows its outline, rounding and fill, and no crop", () => {
    open(shape("rect"));
    expect(screen.getByRole("heading", { name: "Rectangle" })).toBeTruthy();
    expect((screen.getByLabelText("Outline width") as HTMLInputElement).value).toBe("11");
    expect((screen.getByLabelText("Rounding") as HTMLInputElement).value).toBe("0");
    expect(screen.getByRole("switch", { name: "Fill" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("Crop left")).toBeNull();
    expect(screen.queryByText("Heads")).toBeNull();
  });

  it("changing the outline width saves one change and keeps the box's size", () => {
    const store = open(shape("rect"));
    const width = screen.getByLabelText("Outline width");
    fireEvent.change(width, { target: { value: "24" } });
    fireEvent.keyDown(width, { key: "Enter" });
    expect(store.getState().queue).toMatchObject([{ label: "style change", ops: [{ op: "update_clip", clipId: "sh", patch: { strokeWidth: 24 } }] }]);
    expect(saved(store)).toMatchObject({ strokeWidth: 24, width: 400, height: 200 });
  });

  it("dashes, rounding and a fill", () => {
    const store = open(shape("rect"));
    fireEvent.click(screen.getByRole("radio", { name: "Dashed" }));
    const rounding = screen.getByLabelText("Rounding");
    fireEvent.change(rounding, { target: { value: "500" } });
    fireEvent.keyDown(rounding, { key: "Enter" });
    fireEvent.click(screen.getByRole("switch", { name: "Fill" }));
    expect(saved(store)).toMatchObject({ dash: "dashed", radius: 100, fill: "#ffd400" });
    // With a fill the outline can go; the fill then can't.
    fireEvent.click(screen.getByRole("switch", { name: "Outline" }));
    expect(saved(store).stroke).toBeNull();
    expect((screen.getByRole("switch", { name: "Fill" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the outline of an unfilled box can't be turned off", () => {
    open(shape("ellipse"));
    expect(screen.getByRole("heading", { name: "Ellipse" })).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Outline" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Rounding")).toBeNull();
  });

  it("Width and Height change the box's own size, never its scale", () => {
    const store = open(shape("rect"));
    const height = screen.getByLabelText("Height");
    fireEvent.change(height, { target: { value: "300" } });
    fireEvent.keyDown(height, { key: "Enter" });
    expect(saved(store)).toMatchObject({ width: 600, height: 300, transform: { scale: 1 } }); // locked aspect by default
    expect(saved(store).transform.stretch).toBeUndefined();
  });

  it("an arrow has heads, a head look and size, a path and a length", () => {
    const store = open(shape("arrow"));
    expect(screen.getByRole("heading", { name: "Arrow" })).toBeTruthy();
    expect(screen.queryByLabelText("Height")).toBeNull();
    expect((screen.getByLabelText("Arrow length") as HTMLInputElement).value).toBe("400");
    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    fireEvent.click(screen.getByRole("radio", { name: "Open" }));
    fireEvent.click(screen.getByRole("radio", { name: "Curved" }));
    // Curved gives the line its first point, a quarter of its length out from its middle.
    expect(saved(store)).toMatchObject({ heads: "both", head: "open", points: [{ x: 0, y: 0.25 }] });
    expect(screen.getByText(/1 point\. Drag a point anywhere/)).toBeTruthy();
    const bend = screen.getByLabelText("Bend");
    fireEvent.change(bend, { target: { value: "-40" } });
    fireEvent.keyDown(bend, { key: "Enter" });
    expect(saved(store).points).toEqual([{ x: 0, y: -0.4 }]);
    fireEvent.click(screen.getByRole("radio", { name: "Straight" }));
    expect(saved(store).points).toEqual([]);
    expect(screen.queryByLabelText("Bend")).toBeNull();
    expect(screen.getByText("Drag the small dot on the line to curve it.")).toBeTruthy();
  });

  it("a line through several points says how many, and has no one Bend to give", () => {
    const store = open(shape("arrow", { points: [{ x: -0.2, y: 0.3 }, { x: 0.1, y: -0.2 }, { x: 0.3, y: 0.5 }] }));
    expect((screen.getByRole("radio", { name: "Curved" }) as HTMLInputElement).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByLabelText("Bend")).toBeNull();
    expect(screen.getByText(/^3 points\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Straight" }));
    expect(saved(store).points).toEqual([]);
  });

  it("an older bent arrow reads as curved, and its Bend moves it over to a point", () => {
    const store = open(shape("arrow", { bend: 0.3 }));
    const bend = screen.getByLabelText("Bend") as HTMLInputElement;
    expect(bend.value).toBe("30");
    fireEvent.change(bend, { target: { value: "10" } });
    fireEvent.keyDown(bend, { key: "Enter" });
    expect(saved(store)).toMatchObject({ points: [{ x: 0, y: 0.1 }], bend: 0 });
  });

  it("a star has an outline, a fill and corner rounding like a rectangle", () => {
    const store = open(shape("star"));
    expect(screen.getByRole("heading", { name: "Star" })).toBeTruthy();
    const rounding = screen.getByLabelText("Rounding");
    fireEvent.change(rounding, { target: { value: "12" } });
    fireEvent.keyDown(rounding, { key: "Enter" });
    expect(saved(store).radius).toBe(12);
    expect(screen.queryByText("Heads")).toBeNull();
  });

  it("an arrow with no heads is a Line", () => {
    const store = open(shape("arrow"));
    fireEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(saved(store).heads).toBe("none");
    expect(screen.getByRole("heading", { name: "Line" })).toBeTruthy();
    expect(screen.queryByText("Head size")).toBeNull();
  });

  it("a viewer sees the settings and can't change them", () => {
    const store = makeStore({ doc: docWith(shape("arrow")), canEdit: false });
    store.getState().select(["sh"]);
    render(<EditorProvider store={store}><Inspector /></EditorProvider>);
    expect((screen.getByLabelText("Line width") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "Both" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the Effects tab offers a shape its transitions, without crossfade", () => {
    const store = makeStore({ doc: docWith(shape("rect")) });
    store.getState().select(["sh"]);
    render(<EditorProvider store={store}><EffectsPanel /></EditorProvider>);
    const inKinds = [...(screen.getAllByRole("combobox")[0] as HTMLSelectElement).options].map((o) => o.textContent);
    expect(inKinds).toContain("Fade");
    expect(inKinds).not.toContain("Crossfade");
  });
});
