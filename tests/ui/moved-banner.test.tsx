// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { MovedBanner } from "@/components/editor/moved-banner";
import { NoticeBar } from "@/components/editor/notice-bar";
import { MOVE_MESSAGES } from "@/lib/projects/move-messages";
import { makeStore } from "../editor/fixtures";
import { act, render, screen } from "../helpers/dom";

function editor() {
  const store = makeStore();
  render(
    <EditorProvider store={store}>
      <MovedBanner />
      <NoticeBar />
    </EditorProvider>,
  );
  return store;
}

const classes = (el: Element) => el.className.split(" ");
// The frame's look without its padding, which differs only because the notice bar ends in a Dismiss button.
const look = (el: Element) => classes(el).filter((c) => !/^p[trblxy]?-/.test(c)).sort();

it("shows nothing until the project moves", () => {
  editor();
  expect(screen.queryByText(MOVE_MESSAGES.moved)).toBeNull();
  expect(screen.queryByText(MOVE_MESSAGES.movedAway)).toBeNull();
});

it("a moved project's banner looks like the notice bar, with no stripe down its side", () => {
  const store = editor();
  act(() => store.getState().markMoved());
  act(() => store.getState().notify("info", "Saved.", { label: "See templates", href: "/s/crew/settings/templates" }));
  const message = screen.getByText(MOVE_MESSAGES.moved);
  expect(message.getAttribute("role")).toBe("alert");
  const banner = message.parentElement!;
  const notice = screen.getByText("Saved.").parentElement!;
  expect(look(banner)).toEqual(look(notice));
  expect(classes(banner)).toEqual(expect.arrayContaining(["rounded-md", "border", "border-ed-line", "bg-ed-raised", "text-[13px]", "leading-5"]));
  for (const frame of [banner, notice]) expect(classes(frame).filter((c) => c.startsWith("border-l"))).toEqual([]);
  const link = screen.getByRole("link", { name: "Open it there" });
  expect(link.getAttribute("href")).toBe("/editor/p1");
  expect(link.className).toBe(screen.getByRole("link", { name: "See templates" }).className);
});

it("its folder mark is in the warn color and hidden from screen readers; the words stay in the text color", () => {
  const store = editor();
  act(() => store.getState().markMoved());
  const banner = screen.getByText(MOVE_MESSAGES.moved).parentElement!;
  const mark = banner.querySelector("svg")!;
  expect(mark.getAttribute("aria-hidden")).toBe("true");
  expect(mark.getAttribute("class")).toContain("text-ed-warn");
  expect(classes(banner)).toContain("text-ed-text");
  expect(banner.querySelectorAll(".text-ed-warn")).toHaveLength(1);
});

it("moved to a space the person is not in: the banner says so and links nowhere", () => {
  const store = editor();
  act(() => store.getState().markMoved(true));
  expect(screen.getByText(MOVE_MESSAGES.movedAway).getAttribute("role")).toBe("alert");
  expect(screen.queryByText(MOVE_MESSAGES.moved)).toBeNull();
  expect(screen.queryByRole("link", { name: "Open it there" })).toBeNull();
});
