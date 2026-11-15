// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Preview } from "@/components/editor/preview";
import { ZoomMenu } from "@/components/editor/zoom-menu";
import { DEFAULT_PREFS, createSettingsStore, type BoardZoom } from "@/lib/editor/settings";
import type { EditorInit } from "@/lib/editor/types";
import { drawFrame } from "@/lib/render/compositor";
import { makeStore } from "../editor/fixtures";
import { fakeCtx } from "../render/fake-ctx";
import { act, fireEvent, render, screen, within } from "../helpers/dom";

vi.mock("@/lib/render/compositor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/render/compositor")>();
  return { ...actual, drawFrame: vi.fn() };
});

// A pool that plays nothing.
const { pool } = vi.hoisted(() => ({
  pool: {
    sync: () => {},
    preload: () => {},
    resolveSource: () => null,
    label: () => "",
    onChange: () => () => {},
    dispose: () => {},
  },
}));
vi.mock("@/components/editor/media/media-pool", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/editor/media/media-pool")>()),
  createMediaPool: () => pool,
}));

// The board's pane as the browser would measure it; every other element measures 0.
let pane = { width: 572, height: 992 };
let observed: ResizeObserverCallback[] = [];

beforeEach(() => {
  pane = { width: 572, height: 992 };
  observed = [];
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-board") ? pane.width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-board") ? pane.height : 0;
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        observed.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(fakeCtx().ctx as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(drawFrame).mockClear();
});

function show(opts: { boardZoom?: BoardZoom; over?: Partial<EditorInit>; strict?: boolean } = {}) {
  const store = makeStore(opts.over);
  const save = { prefs: vi.fn(), keymap: vi.fn() };
  const settings = createSettingsStore({ prefs: { ...DEFAULT_PREFS, boardZoom: opts.boardZoom ?? "fill" } }, save);
  const tree: ReactNode = (
    <EditorProvider store={store} settings={settings}>
      <Preview />
      <ZoomMenu />
    </EditorProvider>
  );
  render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { store, settings, save };
}

const board = () => document.querySelector<HTMLElement>("[data-board]")!;
const frame = () => document.querySelector<HTMLElement>("[data-frame]")!;
const trigger = () => screen.getByRole("button", { name: /^Preview zoom: / });
const classes = (el: Element) => el.className.split(" ");

function pick(name: string) {
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}

function resizePane(width: number, height: number) {
  pane = { width, height };
  act(() => {
    for (const callback of observed) callback([], {} as ResizeObserver);
  });
}

describe("board zoom", () => {
  it("the zoom button reads Fill and names itself", () => {
    show();
    const button = screen.getByRole("button", { name: "Preview zoom: Fill to size" });
    expect(button.textContent).toBe("Board: Fill");
    expect(button.getAttribute("title")).toBe("Preview zoom");
    expect(classes(button)).toEqual(expect.arrayContaining(["shrink-0", "tabular-nums"]));
    // Where it sits, just before View as, is the control row's test.
    const chevron = button.querySelector("svg")!;
    expect(chevron.getAttribute("aria-hidden")).toBe("true");
    expect(chevron.getAttribute("width")).toBe("12");
    expect(frame().style.width).toBe("540px");
    expect(frame().style.height).toBe("960px");
    expect(frame().style.left).toBe("16px");
    expect(frame().style.top).toBe("16px");
    expect(classes(frame())).toEqual(expect.arrayContaining(["absolute", "outline", "outline-ed-line"]));
    expect(classes(board())).toEqual(expect.arrayContaining(["absolute", "inset-0", "overflow-hidden", "overscroll-contain"]));
    expect(classes(board())).not.toContain("overflow-auto");
    // The content is the board's scrolled box, and holds the frame with its canvas.
    const content = frame().parentElement!;
    expect(content.parentElement).toBe(board());
    expect(content.style.width).toBe("572px");
    expect(content.style.height).toBe("992px");
    expect(classes(board().parentElement!)).toEqual(expect.arrayContaining(["relative", "min-h-0", "flex-1"]));
    expect(within(frame()).getByRole("img", { name: "Preview" })).toBeTruthy();
    // The canvas keeps its backing size.
    const canvas = screen.getByRole("img", { name: "Preview" }) as HTMLCanvasElement;
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
  });

  it("the menu lists Fill to size, the presets and Custom…, the current one checked", () => {
    show();
    fireEvent.click(trigger());
    const menu = screen.getByRole("menu", { name: "Preview zoom: Fill to size" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Fill to size", "25%", "50%", "75%", "100%", "150%", "200%", "Custom…"]);
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false", "false", "false", "false", "false", "false", "false"]);
    const separators = within(menu).getAllByRole("separator");
    expect(separators.map((separator) => separator.nextElementSibling)).toEqual([items[1], items[7]]);
  });

  it("picking 100% shows the frame at its real size, scrolled to its middle", () => {
    const { settings } = show();
    const draws = vi.mocked(drawFrame).mock.calls.length;
    pick("100%");
    expect(frame().style.width).toBe("1080px");
    expect(frame().style.height).toBe("1920px");
    expect(classes(board())).toContain("overflow-auto");
    expect(classes(board())).not.toContain("overflow-hidden");
    expect(classes(board())).toContain("overscroll-contain");
    expect(board().scrollLeft).toBe(270);
    expect(board().scrollTop).toBe(480);
    expect(trigger().textContent).toBe("Board: 100%");
    expect(trigger().getAttribute("aria-label")).toBe("Preview zoom: 100%");
    expect(settings.getState().boardZoom).toBe(100);
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitemradio", { name: "100%" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Fill to size" }).getAttribute("aria-checked")).toBe("false");
    expect(vi.mocked(drawFrame).mock.calls.length).toBe(draws);
  });

  it("a later zoom keeps the middle the person scrolled to", () => {
    show();
    pick("100%");
    // The person scrolls to the frame's top-left corner.
    act(() => {
      board().scrollLeft = 16;
      board().scrollTop = 16;
      board().dispatchEvent(new Event("scroll"));
    });
    pick("200%");
    // (16 + 286 − 16) / 1 = 286 project px across, (16 + 496 − 16) = 496 down; at 200% that is 16 + 572 − 286.
    expect(board().scrollLeft).toBe(302);
    expect(board().scrollTop).toBe(512);
    pick("Fill to size");
    expect(board().scrollLeft).toBe(0);
    expect(board().scrollTop).toBe(0);
    expect(frame().style.width).toBe("540px");
  });

  it("Custom… takes a typed percentage", () => {
    const { settings } = show();
    pick("Custom…");
    const dialog = within(screen.getByRole("dialog", { name: "Custom zoom" }));
    const field = dialog.getByRole("textbox", { name: "Zoom" }) as HTMLInputElement;
    expect(field.value).toBe("50"); // Fill shows its own size
    expect(field.hasAttribute("data-autofocus")).toBe(true);
    expect(dialog.getByText("From 10% to 400%.")).toBeTruthy();
    expect(dialog.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.change(field, { target: { value: "133" } });
    fireEvent.click(dialog.getByRole("button", { name: "Apply" }));
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(trigger().textContent).toBe("Board: 133%");
    expect(settings.getState().boardZoom).toBe(133);
    expect(frame().style.width).toBe(`${1080 * 1.33}px`);
    fireEvent.click(trigger());
    expect(screen.getByRole("menuitemradio", { name: "Custom…" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByRole("menuitemradio").filter((item) => item.getAttribute("aria-checked") === "true")).toHaveLength(1);
    // Picked again, it starts at the zoom in use; Enter applies, and the value is kept within 10% to 400%.
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Custom…" }));
    const again = within(screen.getByRole("dialog", { name: "Custom zoom" })).getByRole("textbox", { name: "Zoom" }) as HTMLInputElement;
    expect(again.value).toBe("133");
    fireEvent.change(again, { target: { value: "1000" } });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(trigger().textContent).toBe("Board: 400%");
    expect(settings.getState().boardZoom).toBe(400);
  });

  it("Custom… rounds to a whole percent, and Cancel changes nothing", () => {
    const { settings, save } = show({ boardZoom: 100 });
    pick("Custom…");
    let field = within(screen.getByRole("dialog", { name: "Custom zoom" })).getByRole("textbox", { name: "Zoom" });
    fireEvent.change(field, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.querySelector("dialog[open]")).toBeNull();
    expect(settings.getState().boardZoom).toBe(100);
    expect(save.prefs).not.toHaveBeenCalled();
    pick("Custom…");
    field = within(screen.getByRole("dialog", { name: "Custom zoom" })).getByRole("textbox", { name: "Zoom" });
    expect((field as HTMLInputElement).value).toBe("100");
    // The field itself keeps whole percents within range once it commits.
    fireEvent.change(field, { target: { value: "1000" } });
    fireEvent.blur(field);
    expect((field as HTMLInputElement).value).toBe("400");
    fireEvent.change(field, { target: { value: "66.6" } });
    fireEvent.blur(field);
    expect((field as HTMLInputElement).value).toBe("67");
    fireEvent.change(field, { target: { value: "66.6" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(settings.getState().boardZoom).toBe(67);
    pick("Custom…");
    field = within(screen.getByRole("dialog", { name: "Custom zoom" })).getByRole("textbox", { name: "Zoom" });
    fireEvent.change(field, { target: { value: "5" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(settings.getState().boardZoom).toBe(10);
    expect(trigger().textContent).toBe("Board: 10%");
  });

  it("Fill refits when the pane changes; a fixed size stays", () => {
    show();
    resizePane(572, 592);
    expect(frame().style.width).toBe("315px");
    expect(frame().style.left).toBe("128.5px");
    expect(frame().style.top).toBe("16px");
    pick("100%");
    resizePane(572, 992);
    expect(frame().style.width).toBe("1080px");
    resizePane(400, 300);
    expect(frame().style.width).toBe("1080px");
  });

  it("at a fixed size a pane resize keeps the middle", () => {
    show();
    pick("100%");
    expect([board().scrollLeft, board().scrollTop]).toEqual([270, 480]);
    resizePane(372, 792);
    // The middle stays at (540, 960): 16 + 540 − 186 across, 16 + 960 − 396 down.
    expect([board().scrollLeft, board().scrollTop]).toEqual([370, 580]);
  });

  it("a saved zoom opens with the frame's middle in view", () => {
    show({ boardZoom: 100, strict: true });
    expect(frame().style.width).toBe("1080px");
    expect([board().scrollLeft, board().scrollTop]).toEqual([270, 480]);
  });

  it("the zoom is remembered", () => {
    const { save } = show();
    pick("100%");
    expect(save.prefs).toHaveBeenCalledWith(expect.objectContaining({ boardZoom: 100 }));
  });

  it("a fresh render starts at the saved zoom", () => {
    show({ boardZoom: 150 });
    expect(trigger().textContent).toBe("Board: 150%");
    expect(screen.getByRole("button", { name: "Preview zoom: 150%" })).toBeTruthy();
    expect(frame().style.width).toBe("1620px");
  });

  it("a sideways swipe in the editor is never the browser's Back", () => {
    const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");
    expect(css).toContain("html:has(.editor) { overscroll-behavior-x: none; }");
  });

  it("a viewer can zoom", () => {
    const { settings } = show({ over: { canEdit: false } });
    expect(trigger().hasAttribute("data-edit-control")).toBe(false);
    expect((trigger() as HTMLButtonElement).disabled).toBe(false);
    pick("150%");
    expect(settings.getState().boardZoom).toBe(150);
    expect(frame().style.width).toBe("1620px");
  });
});
