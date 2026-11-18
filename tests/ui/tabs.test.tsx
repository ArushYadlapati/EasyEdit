// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { Tabs } from "@/components/ui/tabs";
import { fireEvent, render, screen } from "../helpers/dom";

const TABS = [
  { id: "a", label: "Text" },
  { id: "b", label: "Media" },
  { id: "c", label: "Captions" },
  { id: "d", label: "Brand kit" },
];

it("wraps onto more rows with wrap, its tabs never cut off; without it, a row of tabs that truncate", () => {
  const { unmount } = render(<Tabs label="Add" value="a" tabs={TABS} onChange={() => {}} compact wrap />);
  expect(screen.getByRole("tablist").classList.contains("flex-wrap")).toBe(true);
  for (const tab of screen.getAllByRole("tab")) expect(tab.classList.contains("truncate")).toBe(false);
  unmount();

  render(<Tabs label="Add" value="a" tabs={TABS} onChange={() => {}} compact />);
  expect(screen.getByRole("tablist").classList.contains("flex-wrap")).toBe(false);
  for (const tab of screen.getAllByRole("tab")) expect(tab.classList.contains("truncate")).toBe(true);
});

it("the arrow keys move along the tabs across a wrap, in order", () => {
  const onChange = vi.fn();
  render(<Tabs label="Add" value="b" tabs={TABS} onChange={onChange} compact wrap />);
  fireEvent.keyDown(screen.getByRole("tab", { name: "Media" }), { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith("c");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Captions" }), { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith("d");
  fireEvent.keyDown(screen.getByRole("tab", { name: "Brand kit" }), { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith("a");
});
