// @vitest-environment happy-dom
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { BlankFrame } from "@/components/dashboard/blank-frame";
import { FormatCards } from "@/components/dashboard/format-cards";
import { FORMAT_PRESETS } from "@/lib/timeline/presets";
import { PresetId, type FormatId } from "@/lib/timeline/types";
import { fireEvent, render, screen, within } from "../helpers/dom";

const NAMES = [/^Vertical 9:16/, /^Feed 4:5/, /^Square 1:1/, /^Landscape 16:9/, /^Landscape 4K/, /^Custom size/] as const;

it("six cards in a radio group; the chosen one is checked and alone in the tab order", () => {
  render(<FormatCards value="long_16x9" onChange={() => {}} />);
  const group = screen.getByRole("radiogroup", { name: "Format" });
  const radios = within(group).getAllByRole("radio");
  expect(radios).toEqual(NAMES.map((name) => screen.getByRole("radio", { name })));
  const chosen = screen.getByRole("radio", { name: /^Landscape 16:9/ });
  for (const radio of radios) {
    const isChosen = radio === chosen;
    expect(radio.getAttribute("aria-checked")).toBe(String(isChosen));
    expect(radio.tabIndex).toBe(isChosen ? 0 : -1);
    const classes = radio.className.split(" ");
    expect(classes.includes("border-ed-accent") && classes.includes("bg-ed-accent-weak")).toBe(isChosen);
  }
  expect(within(chosen).getByText("YouTube")).toBeTruthy(); // where it is usually posted
  expect(within(radios[0]).getByText("Reels / Shorts")).toBeTruthy();
  expect(within(radios[5]).getByText("Any size")).toBeTruthy();
  expect(group.className.split(" ")).toEqual(expect.arrayContaining(["grid", "grid-cols-2", "sm:grid-cols-3", "md:grid-cols-2", "lg:grid-cols-3", "gap-2"]));

  // Each card has a small shape: a preset's outline in its own aspect ratio, the custom card's icon.
  PresetId.options.forEach((id, index) => {
    const shapes = radios[index].querySelectorAll<HTMLElement>("[data-format-shape]");
    expect(shapes).toHaveLength(1);
    expect(shapes[0].closest("[aria-hidden='true']")).not.toBeNull();
    const { width, height } = FORMAT_PRESETS[id];
    expect(shapes[0].getAttribute("style")).toContain(`aspect-ratio: ${width} / ${height}`);
  });
  const custom = screen.getByRole("radio", { name: /^Custom size/ });
  expect(custom.querySelector("[data-format-shape]")).toBeNull();
  expect(custom.querySelector("svg.lucide-ellipsis")?.getAttribute("aria-hidden")).toBe("true");
});

it("arrow keys move the choice and focus, and wrap", () => {
  const onChange = vi.fn();
  const { rerender } = render(<FormatCards value="short_9x16" onChange={onChange} />);
  expect(fireEvent.keyDown(screen.getByRole("radio", { name: /^Vertical 9:16/ }), { key: "ArrowLeft" })).toBe(false);
  expect(onChange).toHaveBeenLastCalledWith("custom");
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: /^Custom size/ }));

  rerender(<FormatCards value="custom" onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole("radio", { name: /^Custom size/ }), { key: "ArrowRight" });
  expect(onChange).toHaveBeenLastCalledWith("short_9x16");
  expect(document.activeElement).toBe(screen.getByRole("radio", { name: /^Vertical 9:16/ }));

  rerender(<FormatCards value="short_9x16" onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole("radio", { name: /^Vertical 9:16/ }), { key: "ArrowDown" });
  expect(onChange).toHaveBeenLastCalledWith("feed_4x5");

  rerender(<FormatCards value="feed_4x5" onChange={onChange} />);
  fireEvent.keyDown(screen.getByRole("radio", { name: /^Feed 4:5/ }), { key: "ArrowUp" });
  expect(onChange).toHaveBeenLastCalledWith("short_9x16");

  onChange.mockClear();
  expect(fireEvent.keyDown(screen.getByRole("radio", { name: /^Feed 4:5/ }), { key: "a" })).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});

it("a click chooses", () => {
  const onChange = vi.fn<(format: FormatId) => void>();
  render(<FormatCards value="long_16x9" onChange={onChange} />);
  fireEvent.click(screen.getByRole("radio", { name: /^Square 1:1/ }));
  expect(onChange).toHaveBeenCalledWith("square_1x1");
});

it("a disabled picker offers no choice", () => {
  const onChange = vi.fn();
  render(<FormatCards value="long_16x9" onChange={onChange} disabled />);
  for (const radio of screen.getAllByRole("radio")) expect((radio as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /^Square 1:1/ }));
  expect(onChange).not.toHaveBeenCalled();
});

it("the blank frame takes the project's shape", () => {
  const { container } = render(<BlankFrame width={816} height={1056} className="h-40" />);
  const frame = container.querySelector<HTMLElement>("[data-blank-frame]")!;
  expect(frame.getAttribute("style")).toContain("aspect-ratio: 816 / 1056");
  expect(frame.className.split(" ")).toEqual(expect.arrayContaining(["bg-black", "outline-ed-line"]));
  const wrapper = container.firstElementChild as HTMLElement;
  expect(wrapper.getAttribute("aria-hidden")).toBe("true");
  expect(wrapper.contains(frame)).toBe(true);
  expect(wrapper.className.split(" ")).toEqual(expect.arrayContaining(["[container-type:size]", "h-40"]));
  // happy-dom drops a width with container units, so the width that fits both ways is read from the server's markup.
  expect(renderToString(<BlankFrame width={816} height={1056} />)).toContain(`width:min(100cqw, ${816 / 1056} * 100cqh)`);
});
