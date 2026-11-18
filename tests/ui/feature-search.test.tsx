// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { TopBar } from "@/components/editor/top-bar";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";

afterEach(() => {
  vi.restoreAllMocks();
});

type Handlers = Partial<Parameters<typeof TopBar>[0]>;

function setup(canEdit = true, handlers: Handlers = {}) {
  const store = makeStore({ canEdit });
  const props = {
    onShowShortcuts: vi.fn(),
    onShowSettings: vi.fn(),
    onShowSettingsAt: vi.fn(),
    onOpenPanel: vi.fn(),
    onResetLayout: vi.fn(),
    onExport: vi.fn(),
    ...handlers,
  };
  render(
    <EditorProvider store={store}>
      <TopBar spaceSlug="seattle-solvers" {...props} />
    </EditorProvider>,
  );
  const field = screen.getByRole("combobox", { name: "Search tools and actions" }) as HTMLInputElement;
  return { store, props, field };
}

const type = (field: HTMLInputElement, text: string) => fireEvent.change(field, { target: { value: text } });
const key = (field: HTMLInputElement, k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(field, { key: k, ...init });
const options = () => screen.queryAllByRole("option").map((o) => o.textContent);
const activeOption = (field: HTMLInputElement) => document.getElementById(field.getAttribute("aria-activedescendant") ?? "")?.textContent;

it("sits in the top bar and opens a grouped list of everything when focused", () => {
  const { field } = setup();
  expect(field.getAttribute("aria-expanded")).toBe("false");
  act(() => field.focus());
  expect(field.getAttribute("aria-expanded")).toBe("true");
  const list = screen.getByRole("listbox", { name: "Results" });
  expect(list.textContent).toContain("Tools");
  expect(list.textContent).toContain("Panels");
  expect(options().length).toBeGreaterThan(40);
});

it("narrows the list as you type, and Enter runs the best match", () => {
  const { store, field } = setup();
  act(() => field.focus());
  type(field, "blade");
  expect(activeOption(field)).toContain("Razor tool");
  key(field, "Enter");
  expect(store.getState().tool).toBe("razor");
  // The list closes, the query clears and focus leaves the field, so the editor's keys work again.
  expect(field.getAttribute("aria-expanded")).toBe("false");
  expect(field.value).toBe("");
  expect(document.activeElement).not.toBe(field);
});

it("the arrow keys move through the results while focus stays in the field", () => {
  const { field } = setup();
  act(() => field.focus());
  type(field, "track");
  const first = activeOption(field);
  key(field, "ArrowDown");
  expect(activeOption(field)).not.toBe(first);
  key(field, "ArrowUp");
  expect(activeOption(field)).toBe(first);
  key(field, "ArrowUp"); // wraps to the last
  expect(activeOption(field)).toBe(options().at(-1));
  expect(document.activeElement).toBe(field);
});

it("shows each result's key and says when nothing matches", () => {
  const { field } = setup();
  act(() => field.focus());
  type(field, "split at");
  expect(options()[0]).toMatch(/Split at the playhead.*S$/);
  type(field, "qwertyuiop");
  expect(options()).toEqual([]);
  expect(screen.getByText("No results for “qwertyuiop”")).toBeTruthy();
});

it("opens panels, settings and the project's actions through the editor's handlers", () => {
  const { field, props } = setup();
  const pick = (query: string) => {
    act(() => field.focus());
    type(field, query);
    key(field, "Enter");
  };
  pick("effects");
  expect(props.onOpenPanel).toHaveBeenCalledWith("right", "effects");
  pick("brand kit");
  expect(props.onOpenPanel).toHaveBeenCalledWith("left", "brand");
  pick("units");
  expect(props.onShowSettingsAt).toHaveBeenCalledWith("general");
  pick("reset panel");
  expect(props.onResetLayout).toHaveBeenCalledTimes(1);
  pick("export");
  expect(props.onExport).toHaveBeenCalledTimes(1);
});

it("adds text, a track and a shape tool from the list", () => {
  const { store, field } = setup();
  const pick = (query: string) => {
    act(() => field.focus());
    type(field, query);
    key(field, "Enter");
  };
  const texts = () => store.getState().doc.tracks.flatMap((t) => t.clips).filter((c) => c.type === "text").length;
  const before = texts();
  pick("add title");
  expect(texts()).toBe(before + 1);
  const tracks = store.getState().doc.tracks.length;
  pick("add audio track");
  expect(store.getState().doc.tracks.length).toBe(tracks + 1);
  pick("ellipse");
  expect(store.getState().tool).toBe("shape");
  expect(store.getState().shapeTool).toBe("ellipse");
});

it("Rename project starts renaming the name in the top bar", () => {
  const { field } = setup();
  act(() => field.focus());
  type(field, "rename");
  key(field, "Enter");
  expect(screen.getByRole("textbox", { name: "Project name" })).toBeTruthy();
});

it("lists a viewer's edits greyed, and picking one does nothing", () => {
  const { store, field } = setup(false);
  act(() => field.focus());
  type(field, "razor");
  const razor = screen.getAllByRole("option").find((o) => o.textContent?.startsWith("Razor tool"))!;
  expect(razor.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(razor);
  key(field, "Enter");
  expect(store.getState().tool).toBe("select");
  // The list stays open: nothing ran.
  expect(field.getAttribute("aria-expanded")).toBe("true");
});

it("a click runs a result; Escape closes the list and hands focus back", () => {
  const { store, field } = setup();
  const before = document.createElement("button");
  document.body.append(before);
  act(() => before.focus());
  act(() => field.focus());
  type(field, "snapping");
  fireEvent.click(screen.getAllByRole("option")[0]);
  expect(store.getState().snapping).toBe(false);
  expect(document.activeElement).toBe(before);

  act(() => field.focus());
  key(field, "Escape");
  expect(field.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(before);
  before.remove();
});

it("the search key focuses the field from anywhere in the editor, and the panels' tabs follow the search", () => {
  const store = makeStore();
  render(
    <EditorProvider store={store}>
      <EditorScreen spaceSlug="seattle-solvers" />
    </EditorProvider>,
  );
  const field = screen.getByRole("combobox", { name: "Search tools and actions" }) as HTMLInputElement;
  const isMac = navigator.platform.startsWith("Mac");
  fireEvent.keyDown(document.body, { key: "k", metaKey: isMac, ctrlKey: !isMac });
  expect(document.activeElement).toBe(field);
  type(field, "activity");
  key(field, "Enter");
  expect(screen.getByRole("tab", { name: "Activity" }).getAttribute("aria-selected")).toBe("true");
  act(() => field.focus());
  type(field, "media panel");
  key(field, "Enter");
  expect(screen.getByRole("tab", { name: "Media" }).getAttribute("aria-selected")).toBe("true");
});
