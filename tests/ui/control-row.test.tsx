// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { ControlRow } from "@/components/editor/control-row";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { formatLabel } from "@/lib/timeline";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

function showRow() {
  const store = makeStore();
  const { container } = render(
    <EditorProvider store={store}>
      <ControlRow duration={120} fps={30} />
    </EditorProvider>,
  );
  return { store, row: container.firstElementChild as HTMLElement };
}

const names = (root: HTMLElement) => [...root.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "");

describe("the control row", () => {
  it("holds the play controls and the timeline's tools, left to right", () => {
    const { row } = showRow();
    const all = names(row);
    const at = (pattern: RegExp) => all.findIndex((n) => pattern.test(n));
    const order = [/^Add track$/, /^Play$/, /^Current time/, /^Preview zoom: /, /^View as: /, /^Snap$/, /^Zoom timeline out$/, /^Zoom timeline in$/, /^Fit timeline$/].map(at);
    expect(order.every((i) => i >= 0), JSON.stringify(all)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Split and the deletes are on the tool rail now.
    expect(all).not.toContain("Split");
    expect(all).not.toContain("Delete");
  });

  it("names the board's zoom as the board's", () => {
    showRow();
    expect(screen.getByRole("button", { name: /^Preview zoom: / }).textContent).toBe("Board: Fill");
  });

  it("keeps to one line, the format label giving way first", () => {
    const { row } = showRow();
    expect(row.className).not.toMatch(/flex-wrap|overflow-x/);
    const format = within(row).getByText(formatLabel(sampleDoc()));
    expect(format.className).toMatch(/\btruncate\b/);
    expect(format.className).toMatch(/\bmin-w-0\b/);
  });

  it("View as has Show guides, which turns the guides off and on", () => {
    const { store } = showRow();
    fireEvent.click(screen.getByRole("button", { name: /^View as: / }));
    const item = screen.getByRole("menuitemcheckbox", { name: "Show guides" });
    expect(item.getAttribute("aria-checked")).toBe("true");
    act(() => fireEvent.click(item));
    expect(store.getState().showGuides).toBe(false);
  });
});

describe("the editor screen", () => {
  it("shows one time readout, under the preview no more", () => {
    const store = makeStore();
    render(
      <EditorProvider store={store}>
        <EditorScreen spaceSlug="seattle-solvers" />
      </EditorProvider>,
    );
    expect(screen.getAllByRole("button", { name: /^Current time/ })).toHaveLength(1);
    const preview = screen.getByRole("main", { name: "Preview" });
    expect(within(preview).queryByRole("button", { name: "Play" })).toBeNull();
    const timeline = screen.getByRole("region", { name: "Timeline" });
    expect(within(timeline).getByRole("button", { name: "Play" })).toBeTruthy();
  });
});
