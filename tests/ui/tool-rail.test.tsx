// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { ToolRail } from "@/components/editor/tool-rail";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";

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
    expect(names).toEqual(["Selection", "Razor", "Text", "Guide", "Crop", "Split", "Delete", "Ripple delete"]);
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

  it("each button's tooltip names its key", () => {
    const { button } = show();
    expect(button("Selection").title).toBe("Selection (V)");
    expect(button("Razor").title).toBe("Razor (C)");
    expect(button("Text").title).toBe("Text (T)");
    expect(button("Guide").title).toBe("Guide (G)");
    expect(button("Crop").title).toBe("Crop (R)");
    expect(button("Split").title).toBe("Split (S)");
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
    for (const name of ["Razor", "Text", "Guide", "Crop", "Split", "Delete", "Ripple delete"]) expect(button(name).disabled, name).toBe(true);
  });

  it("keeps a tab stop when the button it was on is disabled", () => {
    const { store, button } = show();
    act(() => store.getState().select(["x1"]));
    button("Selection").focus();
    fireEvent.keyDown(button("Selection"), { key: "End" });
    expect(document.activeElement).toBe(button("Ripple delete"));
    fireEvent.click(button("Ripple delete"));
    expect(button("Ripple delete").disabled).toBe(true);
    const stops = ["Selection", "Razor", "Text", "Guide", "Crop", "Split", "Delete", "Ripple delete"].filter((n) => button(n).tabIndex === 0);
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
