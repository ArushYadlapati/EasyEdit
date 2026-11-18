// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { NoticeBar } from "@/components/editor/notice-bar";
import { makeStore } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen } from "../helpers/dom";

afterEach(() => vi.restoreAllMocks());

function show(href: string, setup?: (store: ReturnType<typeof makeStore>) => void) {
  const store = makeStore();
  setup?.(store);
  render(<EditorProvider store={store}><NoticeBar /></EditorProvider>);
  act(() => store.getState().notify("info", "Saved.", { label: "See templates", href }));
  return store;
}

it("the notice's link leaves the editor the way LeaveLink does: a real page load when edits cannot be sent", () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  show("/s/crew/settings/templates", (store) => {
    store.getState().edit([{ op: "move_clip", clipId: "x2", start: 100 }], "move");
    store.getState().setStatus("offline");
  });
  const link = screen.getByRole("link", { name: "See templates" });
  expect(link.getAttribute("href")).toBe("/s/crew/settings/templates");
  expect(fireEvent.click(link)).toBe(false);
  expect(assign).toHaveBeenCalledWith("/s/crew/settings/templates");
});

it("stays inside the app when nothing is at risk", () => {
  const assign = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  show("/s/crew/settings/templates");
  expect(fireEvent.click(screen.getByRole("link", { name: "See templates" }))).toBe(true);
  expect(assign).not.toHaveBeenCalled();
});

it("an error is said in the danger color, with no stripe down the notice's side", () => {
  const store = makeStore();
  render(<EditorProvider store={store}><NoticeBar /></EditorProvider>);
  act(() => store.getState().notify("error", "That clip is gone."));
  const words = screen.getByRole("alert");
  expect(words.textContent).toBe("That clip is gone.");
  expect(words.className.split(" ")).toContain("text-ed-danger");
  const frame = words.parentElement!;
  expect(frame.className.split(" ").filter((c) => c.startsWith("border-l"))).toEqual([]);
  expect(frame.className.split(" ")).toEqual(expect.arrayContaining(["border", "border-ed-line", "bg-ed-raised"]));
  act(() => store.getState().notify("info", "Saved."));
  expect(screen.getByRole("status").textContent).toBe("Saved.");
  expect(screen.getByRole("status").className).not.toContain("text-ed-danger");
  expect(screen.getByRole("alert").textContent).toBe("");
});

it("shows no link for an address outside this app", () => {
  for (const href of ["https://evil.example/", "//evil.example/", "javascript:alert(1)"]) {
    const store = show(href);
    expect(screen.queryByRole("link", { name: "See templates" })).toBeNull();
    expect(store.getState().notice?.text).toBe("Saved.");
    cleanup();
  }
});
