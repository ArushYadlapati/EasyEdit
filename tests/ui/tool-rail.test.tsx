// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { ToolRail } from "@/components/editor/tool-rail";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { act, fireEvent, render, screen, tipOf, within } from "../helpers/dom";

function show(canEdit = true, doc = sampleDoc()) {
  const store = makeStore({ canEdit, doc });
  render(
    <EditorProvider store={store}>
      <ToolRail />
    </EditorProvider>,
  );
  return { store, button: (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement };
}

describe("the tool rail", () => {
  it("lists the tools, then the clip commands, in one vertical toolbar", () => {
    show();
    const bar = screen.getByRole("toolbar", { name: "Tools" });
    expect(bar.getAttribute("aria-orientation")).toBe("vertical");
    const names = [...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Selection", "Razor", "Text", "Shape: Rectangle", "Arrow", "Guide", "Crop", "Split", "Delete", "Ripple delete"]);
  });

  it("a click picks a tool and shows it pressed", () => {
    const { store, button } = show();
    expect(button("Selection").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Razor"));
    expect(store.getState().tool).toBe("razor");
    expect(button("Razor").getAttribute("aria-pressed")).toBe("true");
    expect(button("Selection").getAttribute("aria-pressed")).toBe("false");
    // Split and the deletes are commands, not tools.
    expect(button("Split").getAttribute("aria-pressed")).toBeNull();
  });

  it("each button's description names its key, and what a second click does", () => {
    const { store, button } = show();
    const told = (name: string) => tipOf(button(name));
    expect(told("Selection")).toBe("Selection (V)");
    expect(told("Razor")).toBe("Razor (C)");
    expect(told("Text")).toBe("Text (T)");
    expect(told("Shape: Rectangle")).toBe("Shape: Rectangle (U). Drag on the preview; click again for more shapes");
    expect(told("Arrow")).toBe("Arrow (Shift+A). Drag on the preview; click again for a line");
    expect(told("Guide")).toBe("Guide (G). Drag on the preview; click again to add one in the middle");
    expect(told("Crop")).toBe("Crop (R)");
    expect(told("Split")).toBe("Split (S)");
    act(() => store.getState().setLineTool("line"));
    expect(told("Line")).toBe("Line (Shift+L). Drag on the preview; click again for an arrow");
    // The browser's own slow tooltip is left to the disabled buttons, which get no hover of their own.
    expect(button("Selection").title).toBe("");
    expect(button("Delete").title).toBe("Delete (Del)");
  });

  it("Line and Arrow are one button: a click picks it, another click switches what it draws", () => {
    const { store, button } = show();
    fireEvent.click(button("Arrow"));
    expect([store.getState().tool, store.getState().lineTool]).toEqual(["line", "arrow"]);
    expect(button("Arrow").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Arrow"));
    expect([store.getState().tool, store.getState().lineTool]).toEqual(["line", "line"]);
    expect(button("Line").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("button", { name: "Arrow" })).toBeNull();
    fireEvent.click(button("Line"));
    expect([store.getState().tool, store.getState().lineTool]).toEqual(["line", "arrow"]);
    // Another tool, then back: the first click only picks it, and it still draws what it drew.
    fireEvent.click(button("Razor"));
    fireEvent.click(button("Arrow"));
    expect([store.getState().tool, store.getState().lineTool]).toEqual(["line", "arrow"]);
    // It leaves the Shape tool's own shape as it was.
    expect(store.getState().shapeTool).toBe("rect");
  });

  it("Split and Delete act on the playhead and the selection", () => {
    const { store, button } = show();
    expect(button("Delete").disabled).toBe(true);
    act(() => store.getState().select(["x1"]));
    fireEvent.click(button("Delete"));
    expect(store.getState().queue.map((e) => e.label)).toEqual(["delete"]);
  });

  it("Delete is ready for a selected guide too", () => {
    const { store, button } = show(true, { ...sampleDoc(), guides: [{ id: "gd1", axis: "x", at: 0.5 }] });
    act(() => store.getState().selectGuide("gd1"));
    expect(button("Delete").disabled).toBe(false);
    fireEvent.click(button("Delete"));
    expect(store.getState().queue.map((e) => e.label)).toEqual(["remove guide"]);
  });

  it("a viewer can only use Selection", () => {
    const { button } = show(false);
    expect(button("Selection").disabled).toBe(false);
    for (const name of ["Razor", "Text", "Shape: Rectangle", "Arrow", "Guide", "Crop", "Split", "Delete", "Ripple delete"]) expect(button(name).disabled, name).toBe(true);
  });

  it("keeps a tab stop when the button it was on is disabled", () => {
    const { store, button } = show();
    act(() => store.getState().select(["x1"]));
    button("Selection").focus();
    fireEvent.keyDown(button("Selection"), { key: "End" });
    expect(document.activeElement).toBe(button("Ripple delete"));
    fireEvent.click(button("Ripple delete"));
    expect(button("Ripple delete").disabled).toBe(true);
    const stops = ["Selection", "Razor", "Text", "Arrow", "Guide", "Crop", "Split", "Delete", "Ripple delete"].filter((n) => button(n).tabIndex === 0);
    expect(stops).toEqual(["Selection"]);
  });

  it("is one tab stop; the arrow keys move between its buttons", () => {
    const { button } = show();
    expect(button("Selection").tabIndex).toBe(0);
    expect(button("Razor").tabIndex).toBe(-1);
    button("Selection").focus();
    fireEvent.keyDown(button("Selection"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(button("Razor"));
    expect(button("Razor").tabIndex).toBe(0);
    fireEvent.keyDown(button("Razor"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(button("Selection"));
    fireEvent.keyDown(button("Selection"), { key: "End" });
    expect(document.activeElement).toBe(button("Split")); // Delete and Ripple delete are disabled with nothing selected
  });
});

describe("adding without a drag", () => {
  function showWithMenus() {
    const store = makeStore();
    render(
      <EditorProvider store={store}>
        <ContextMenuProvider>
          <ToolRail />
        </ContextMenuProvider>
      </EditorProvider>,
    );
    return { store, button: (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement };
  }

  it("the Shape list ends with adding the current shape in the middle of the frame", () => {
    const { store, button } = showWithMenus();
    fireEvent.click(button("Shape: Rectangle"));
    fireEvent.click(button("Shape: Rectangle")); // a second click opens the list
    const menu = screen.getByRole("menu", { name: "Shapes" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Add a rectangle in the middle" }));
    const added = store.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === store.getState().selection.clipIds[0]);
    expect(added).toMatchObject({ type: "shape", shape: "rect", transform: { x: 0.5, y: 0.5 } });
    expect(store.getState().tool).toBe("select");
  });

  it("ArrowRight on Line opens its list, which adds an arrow in the middle", () => {
    const { store, button } = showWithMenus();
    fireEvent.keyDown(button("Arrow"), { key: "ArrowRight" });
    fireEvent.click(within(screen.getByRole("menu", { name: "Line or arrow" })).getByRole("menuitem", { name: "Add an arrow in the middle" }));
    expect(store.getState().doc.tracks.flatMap((t) => t.clips).some((c) => c.type === "shape" && c.shape === "arrow")).toBe(true);
  });

  it("Guide has a list too: a guide down or across the middle, selected", () => {
    const { store, button } = showWithMenus();
    fireEvent.click(button("Guide"));
    expect(store.getState().tool).toBe("guide");
    fireEvent.click(button("Guide"));
    fireEvent.click(within(screen.getByRole("menu", { name: "Guide" })).getByRole("menuitem", { name: "Add a guide across the middle" }));
    expect(store.getState().doc.guides).toMatchObject([{ axis: "y", at: 0.5 }]);
    expect(store.getState().guideId).toBe(store.getState().doc.guides![0].id);
    expect(button("Guide").getAttribute("aria-haspopup")).toBe("menu");
  });
});
