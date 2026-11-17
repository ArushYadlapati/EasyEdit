// @vitest-environment happy-dom
import { Component, type ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NewProjectDialog } from "@/components/dashboard/new-project-dialog";
import type { DashboardFolder } from "@/lib/dashboard/view";
import type { TemplateSummary } from "@/lib/templates/types";
import type { FormState } from "@/lib/projects/dashboard-actions";
import { FRAME_SIZE_MESSAGE } from "@/lib/timeline/presets";
import { act, fireEvent, render, screen, waitFor } from "../helpers/dom";

const FOLDERS: DashboardFolder[] = [{ id: "f1", name: "Season 2026", projectCount: 0 }];

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

let action: ReturnType<typeof vi.fn<Action>>;
let onClose: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  localStorage.clear();
  action = vi.fn<Action>(async () => ({}));
  onClose = vi.fn<() => void>();
});

afterEach(() => vi.restoreAllMocks());

const TEMPLATE: TemplateSummary = {
  id: "tpl1",
  name: "Quick promo",
  description: "",
  format: "long_16x9",
  width: 1920,
  height: 1080,
  builtIn: true,
  slots: [1, 2, 3].map((n) => ({
    name: `slot_${n}`,
    kind: "text" as const,
    filled: false,
    clipIds: [],
  })),
  updatedAt: null,
};

function dialog({ open = true, folderId = null as string | null, templates = [] as TemplateSummary[] } = {}) {
  return <NewProjectDialog open={open} onClose={onClose} folders={FOLDERS} templates={templates} folderId={folderId} action={action} />;
}

const textbox = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const radio = (name: string | RegExp) =>
  screen.getByRole("radio", {
    name: typeof name === "string" ? new RegExp(`^${name}`) : name,
  });
const checked = (name: string | RegExp) => radio(name).getAttribute("aria-checked") === "true";
const createButton = () => screen.getByRole("button", { name: "Create project" }) as HTMLButtonElement;
const folderSelect = () => screen.getByRole("combobox", { name: "Folder" }) as HTMLSelectElement;
const frameStyle = () => document.querySelector("[data-blank-frame]")!.getAttribute("style") ?? "";
const type = (name: string, value: string) => fireEvent.change(textbox(name), { target: { value } });
const sent = (call = 0) => action.mock.calls[call][1];

// Makes one storage method throw. happy-dom binds a storage method onto the instance the first time it is read, so a
// spy on Storage.prototype stops reaching it once an earlier test has opened the dialog, and a spy on the instance
// cannot be restored through its proxy. The page is handed a storage whose method throws instead.
function refuse(method: "getItem" | "setItem", message: string) {
  const real = window.localStorage;
  const fail = vi.fn(() => {
    throw new Error(message);
  });
  const storage = {
    getItem: (key: string) => real.getItem(key),
    setItem: (key: string, value: string) => real.setItem(key, value),
    [method]: fail,
  };
  vi.spyOn(window, "localStorage", "get").mockReturnValue(storage as unknown as Storage);
  return fail;
}

async function clickCreate() {
  await act(async () => {
    fireEvent.click(createButton());
  });
}

it("opens with Untitled project selected, Vertical 9:16 chosen and its blank frame", () => {
  render(dialog());
  const name = textbox("Name");
  expect(name.value).toBe("Untitled project");
  expect(document.activeElement).toBe(name);
  expect([name.selectionStart, name.selectionEnd]).toEqual([0, 16]);
  expect(name.maxLength).toBe(100);
  expect(checked(/^Vertical 9:16/)).toBe(true);
  expect(textbox("Width").value).toBe("1080");
  expect(textbox("Height").value).toBe("1920");
  expect(textbox("Width").inputMode).toBe("decimal");
  expect(textbox("Height").inputMode).toBe("decimal");
  expect(screen.getByText("1080 × 1920 px · 9:16")).toBeTruthy();
  expect(frameStyle()).toContain("aspect-ratio: 1080 / 1920");
  expect(screen.getByText("Frame rate")).toBeTruthy();
  expect(screen.getByText("30 fps")).toBeTruthy();
  expect(textbox("Width").parentElement!.textContent).toBe("px");
  expect(folderSelect().value).toBe("");
  expect([...folderSelect().options].map((o) => [o.value, o.text])).toEqual([
    ["", "No folder"],
    ["f1", "Season 2026"],
  ]);
  expect(screen.queryByText(/ pixels$/)).toBeNull();
  const units = screen.getByRole("radiogroup", { name: "Units" });
  expect([...units.querySelectorAll("[role=radio]")].map((r) => r.textContent)).toEqual(["Pixels", "Centimeters", "Inches"]);
  expect(checked("Pixels")).toBe(true);
  expect(screen.getByText("Centimeters and inches count 96 pixels to the inch.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(createButton().disabled).toBe(false);
});

it("is a large dialog whose fields scroll beside a preview that stays in view", () => {
  render(dialog());
  const box = screen.getByRole("dialog", { name: "New project" });
  expect(box.className.split(" ")).toContain("h-[min(92dvh,760px)]");
  const form = textbox("Name").form!;
  const columns = form.parentElement!;
  expect(columns.className.split(" ")).toEqual(
    expect.arrayContaining(["md:grid", "md:h-full", "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", "md:gap-6", "md:overflow-hidden"]),
  );
  expect(form.className.split(" ")).toEqual(expect.arrayContaining(["md:overflow-y-auto", "md:px-1"]));
  const surround = document.querySelector("[data-blank-frame]")!.parentElement!.parentElement!;
  expect(columns.children[1]).toBe(surround);
  expect(surround.className.split(" ")).toEqual(expect.arrayContaining(["bg-ed-raised", "rounded-md", "h-56", "md:h-full"]));
  expect(surround.className).not.toContain("overflow-y-auto");
  expect(surround.lastElementChild!.textContent).toBe("1080 × 1920 px · 9:16");
  // Create sits in the footer, outside the form and its scrolling.
  expect(form.contains(createButton())).toBe(false);
});

it("each opening starts fresh", () => {
  const { rerender } = render(dialog());
  type("Name", "Poster");
  fireEvent.click(radio(/^Landscape 16:9/));
  fireEvent.change(folderSelect(), { target: { value: "f1" } });
  expect(textbox("Name").value).toBe("Poster");
  rerender(dialog({ open: false }));
  rerender(dialog());
  expect(textbox("Name").value).toBe("Untitled project");
  expect(document.activeElement).toBe(textbox("Name"));
  expect(checked(/^Vertical 9:16/)).toBe(true);
  expect(textbox("Width").value).toBe("1080");
  expect(frameStyle()).toContain("aspect-ratio: 1080 / 1920");
  expect(folderSelect().value).toBe("");
});

it("a first opening after starting closed reads the saved unit then", () => {
  const { rerender } = render(dialog({ open: false }));
  expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  localStorage.setItem("easyedit.new-project-units", "in");
  rerender(dialog());
  expect(checked("Inches")).toBe(true);
  expect(textbox("Width").value).toBe("11.25");
  expect(document.activeElement).toBe(textbox("Name"));
});

it("starts in the folder in view", () => {
  render(dialog({ folderId: "f1" }));
  expect(folderSelect().value).toBe("f1");
});

it("a named size fills the size, and a typed size picks Custom or the named size it matches", () => {
  render(dialog());
  fireEvent.click(radio(/^Landscape 16:9/));
  expect(textbox("Width").value).toBe("1920");
  expect(textbox("Height").value).toBe("1080");
  expect(screen.getByText("1920 × 1080 px · 16:9")).toBeTruthy();
  type("Width", "1000");
  expect(checked("Custom size")).toBe(true);
  expect(screen.getByText("1000 × 1080 px · 25:27")).toBeTruthy();
  type("Width", "1080");
  type("Height", "1920");
  expect(checked(/^Vertical 9:16/)).toBe(true);
});

it("Custom size changes nothing else", () => {
  render(dialog());
  fireEvent.click(radio("Custom size"));
  expect(checked("Custom size")).toBe(true);
  expect(textbox("Width").value).toBe("1080");
  expect(textbox("Height").value).toBe("1920");
  expect(screen.getByText("1080 × 1920 px · 9:16")).toBeTruthy();
});

it("swap turns portrait into landscape", () => {
  render(dialog());
  fireEvent.click(screen.getByRole("button", { name: "Swap width and height" }));
  expect(checked(/^Landscape 16:9/)).toBe(true);
  expect(textbox("Width").value).toBe("1920");
  expect(textbox("Height").value).toBe("1080");
});

it("inches show the pixel size, and the choice is remembered", () => {
  const { unmount } = render(dialog());
  fireEvent.click(radio("Inches"));
  expect(textbox("Width").value).toBe("11.25");
  expect(textbox("Height").value).toBe("20");
  expect(localStorage.getItem("easyedit.new-project-units")).toBe("in");
  type("Width", "4");
  type("Height", "6");
  expect(screen.getByText("384 × 576 pixels")).toBeTruthy();
  expect(screen.getByText("4 × 6 in · 384 × 576 px · 2:3")).toBeTruthy();
  expect(screen.getByText("Centimeters and inches count 96 pixels to the inch.")).toBeTruthy();
  expect(textbox("Width").parentElement!.textContent).toBe("in");
  expect(textbox("Height").parentElement!.textContent).toBe("in");
  type("Width", "");
  expect(screen.queryByText(/ pixels$/)).toBeNull();
  type("Width", "4");
  unmount();
  render(dialog());
  expect(checked("Inches")).toBe(true);
});

it("centimeters show the pixel size", () => {
  render(dialog());
  fireEvent.click(radio("Centimeters"));
  expect(localStorage.getItem("easyedit.new-project-units")).toBe("cm");
  type("Width", "10");
  type("Height", "15");
  expect(screen.getByText("378 × 566 pixels")).toBeTruthy();
  expect(screen.getByText("10 × 14.98 cm · 378 × 566 px")).toBeTruthy();
});

it("a named size fills the size in the unit chosen", () => {
  render(dialog());
  fireEvent.click(radio("Inches"));
  fireEvent.click(radio(/^Landscape 16:9/));
  expect(textbox("Width").value).toBe("20");
  expect(textbox("Height").value).toBe("11.25");
  expect(screen.getByText("20 × 11.25 in · 1920 × 1080 px · 16:9")).toBeTruthy();
});

it("a typed inch value is kept, and the pixels are even", () => {
  render(dialog());
  fireEvent.click(radio("Inches"));
  type("Width", "4.01");
  type("Height", "6");
  expect(textbox("Width").value).toBe("4.01");
  expect(screen.getByText("384 × 576 pixels")).toBeTruthy();
});

it("an odd number of pixels becomes the even size shown under the frame", async () => {
  render(dialog());
  type("Width", "1081");
  expect(screen.getByText("1082 × 1920 px")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(createButton().disabled).toBe(false);
  await clickCreate();
  expect(action).toHaveBeenCalledTimes(1);
  expect(sent().get("format")).toBe("custom");
  expect(sent().get("width")).toBe("1082");
  expect(sent().get("height")).toBe("1920");
});

it("a blocked storage starts in Pixels", () => {
  const getItem = refuse("getItem", "blocked");
  render(dialog());
  expect(getItem).toHaveBeenCalled();
  expect(checked("Pixels")).toBe(true);
});

it("an unknown saved unit starts in Pixels", () => {
  localStorage.setItem("easyedit.new-project-units", "ft");
  render(dialog());
  expect(checked("Pixels")).toBe(true);
  expect(textbox("Width").value).toBe("1080");
});

it("a refused unit save is ignored", () => {
  const setItem = refuse("setItem", "full");
  const errors = vi.spyOn(console, "error");
  render(dialog());
  fireEvent.click(radio("Inches"));
  expect(errors).not.toHaveBeenCalled();
  expect(setItem).toHaveBeenCalledWith("easyedit.new-project-units", "in");
  expect(checked("Inches")).toBe(true);
});

it("a size outside the limits disables Create and says why", () => {
  render(dialog());
  type("Width", "5000");
  expect(screen.getByRole("alert").textContent).toBe(FRAME_SIZE_MESSAGE);
  expect(screen.getByRole("alert").className.split(" ")).toContain("text-ed-danger");
  expect(createButton().disabled).toBe(true);
  expect(frameStyle()).toContain("aspect-ratio: 1080 / 1920");
  expect(screen.getByText("1080 × 1920 px · 9:16")).toBeTruthy();
  type("Width", "");
  expect(createButton().disabled).toBe(true);
  expect(checked("Custom size")).toBe(true);
  expect(screen.getByRole("alert").textContent).toBe(FRAME_SIZE_MESSAGE);
  type("Width", "1080");
  expect(createButton().disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("the frame follows the last size inside the limits", () => {
  render(dialog());
  type("Width", "1000");
  expect(frameStyle()).toContain("aspect-ratio: 1000 / 1920");
  type("Width", "5000");
  expect(frameStyle()).toContain("aspect-ratio: 1000 / 1920");
  expect(screen.getByText("1000 × 1920 px")).toBeTruthy();
});

it("Create belongs to the form, so Enter in the name creates", async () => {
  render(dialog());
  const name = textbox("Name");
  expect(name.form).not.toBeNull();
  expect(createButton().form).toBe(name.form);
  expect(createButton().type).toBe("submit");
  let submitted = true;
  await act(async () => {
    submitted = fireEvent.submit(name.form!);
  });
  expect(action).toHaveBeenCalledTimes(1);
  expect(submitted).toBe(false); // the page itself is never submitted
});

it("Enter cannot create a size outside the limits", async () => {
  render(dialog());
  type("Width", "5000");
  const name = textbox("Name");
  const errors = vi.spyOn(console, "error");
  let submitted = true;
  await act(async () => {
    submitted = fireEvent.submit(name.form!);
  });
  expect(action).not.toHaveBeenCalled();
  expect(submitted).toBe(false);
  expect(errors).not.toHaveBeenCalled();
});

it("Create is held while the project is being made", async () => {
  // The create never settles while the test looks. It is finished at the end: React holds every later transition
  // until a running async action settles, and that would reach the tests after this one.
  let finish: (state: FormState) => void = () => {};
  action = vi.fn<Action>(() => new Promise<FormState>((resolve) => (finish = resolve)));
  render(dialog());
  await clickCreate();
  await clickCreate();
  expect(action).toHaveBeenCalledTimes(1);
  expect(createButton().disabled).toBe(true);
  await act(async () => {
    fireEvent.submit(textbox("Name").form!);
  });
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => finish({}));
});

it("Create sends the name, the format, and a custom size's pixels and folder", async () => {
  render(dialog());
  fireEvent.click(radio("Inches"));
  type("Width", "4");
  type("Height", "6");
  fireEvent.change(folderSelect(), { target: { value: "f1" } });
  await clickCreate();
  expect(action).toHaveBeenCalledTimes(1);
  const data = sent();
  expect(data.get("name")).toBe("Untitled project");
  expect(data.get("format")).toBe("custom");
  expect(data.get("width")).toBe("384");
  expect(data.get("height")).toBe("576");
  expect(data.get("folderId")).toBe("f1");
});

it("the name is sent as typed", async () => {
  render(dialog());
  type("Name", "  Qual recap ");
  await clickCreate();
  expect(sent().get("name")).toBe("  Qual recap ");
});

it("a named size sends no width or height", async () => {
  render(dialog());
  await clickCreate();
  expect(action).toHaveBeenCalledTimes(1);
  const data = sent();
  expect(data.get("format")).toBe("short_9x16");
  expect(data.has("width")).toBe(false);
  expect(data.has("height")).toBe(false);
  expect(data.get("folderId")).toBe("");
});

it("the server's sentence shows in the dialog", async () => {
  action = vi.fn<Action>(async () => ({
    error: "Your role doesn't allow this.",
  }));
  const errors = vi.spyOn(console, "error");
  render(dialog());
  await clickCreate();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Your role doesn't allow this."));
  expect(screen.getByRole("alert").className.split(" ")).toContain("text-ed-danger");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(textbox("Name")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  expect(errors).not.toHaveBeenCalled();
});

it("the daily project limit's sentence shows in the dialog", async () => {
  const text = "You've reached today's limit for new projects (25). It frees up over the next 24 hours.";
  action = vi.fn<Action>(async () => ({ error: text }));
  render(dialog());
  await clickCreate();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(text));
});

it("a create that fails without an answer says so in the dialog", async () => {
  action = vi.fn<Action>(async () => {
    throw new TypeError("Failed to fetch");
  });
  render(dialog());
  await clickCreate();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Something went wrong. Try again."));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(textbox("Name").value).toBe("Untitled project");
  expect(createButton().disabled).toBe(false);
  expect(onClose).not.toHaveBeenCalled();
  action.mockImplementation(async () => ({}));
  await clickCreate();
  expect(action).toHaveBeenCalledTimes(2);
});

// Records the error a child throws while rendering.
class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  static caught: unknown = null;
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    Boundary.caught = error;
    return { error };
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

it("a create that went through still hands its redirect to the router", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  Boundary.caught = null;
  const digest = "NEXT_REDIRECT;push;/editor/p1;307;";
  action = vi.fn<Action>(async () => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest });
  });
  render(<Boundary>{dialog()}</Boundary>);
  await clickCreate();
  expect((Boundary.caught as { digest?: string } | null)?.digest).toBe(digest);
});

it("Cancel or Escape closes it", () => {
  render(dialog());
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);
});

it("shows no Start from row without templates", () => {
  render(dialog());
  expect(screen.queryByRole("radiogroup", { name: "Start from" })).toBeNull();
});

it("choosing a template hides the format fields, shows its format and sends templateId", async () => {
  render(dialog({ templates: [TEMPLATE] }));
  expect(radio("Blank").getAttribute("aria-checked")).toBe("true");
  expect(radio("Quick promo").textContent).toContain("3 slots");
  expect(radio("Quick promo").textContent).toContain("Starter");
  fireEvent.click(radio("Quick promo"));
  expect(screen.queryByRole("radiogroup", { name: "Format" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Width" })).toBeNull();
  expect(screen.getAllByText("Landscape 16:9 \u00b7 1920\u00d71080").length).toBeGreaterThan(0);
  await clickCreate();
  expect(sent().get("templateId")).toBe("tpl1");
  expect(sent().get("format")).toBeNull();
  expect(sent().get("name")).toBe("Untitled project");
});

it("choosing Blank again brings the format fields back with the earlier choice", () => {
  render(dialog({ templates: [TEMPLATE] }));
  fireEvent.click(radio(/^Square 1:1/));
  fireEvent.click(radio("Quick promo"));
  fireEvent.click(radio("Blank"));
  expect(checked(/^Square 1:1/)).toBe(true);
  expect(textbox("Width").value).toBe("1080");
});

it("arrow keys move the Start from choice", () => {
  render(dialog({ templates: [TEMPLATE] }));
  fireEvent.keyDown(radio("Blank"), { key: "ArrowRight" });
  expect(radio("Quick promo").getAttribute("aria-checked")).toBe("true");
});
