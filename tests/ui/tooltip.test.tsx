// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "@/components/ui/icon-button";
import { TIP_DELAY_MS, TIP_WARM_MS, placeTip } from "@/components/ui/tooltip";
import { act, fireEvent, render, screen, tipOf } from "../helpers/dom";

const tips = () => [...document.querySelectorAll("[data-tooltip]")].map((t) => t.textContent);
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const rest = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  // Each test starts cold: long enough after the last tip that the next one waits again.
  vi.advanceTimersByTime(TIP_WARM_MS * 10);
});
afterEach(() => void vi.useRealTimers());

function show() {
  render(
    <div>
      <IconButton label="Split" shortcut="S">x</IconButton>
      <IconButton label="Arrow" shortcut="Shift+A" hint="Click again for a line">y</IconButton>
      <IconButton label="Snap">z</IconButton>
      <IconButton label="Delete" shortcut="Backspace" disabled>w</IconButton>
    </div>,
  );
}

describe("an icon button's tooltip", () => {
  it("shows a moment after the pointer rests on the button, far sooner than the browser's own", () => {
    show();
    fireEvent.pointerEnter(button("Split"));
    expect(tips()).toEqual([]);
    rest(TIP_DELAY_MS - 1);
    expect(tips()).toEqual([]);
    rest(1);
    expect(tips()).toEqual(["Split (S)"]);
    expect(TIP_DELAY_MS).toBeLessThanOrEqual(200);
    // The browser's tooltip would show as well, a second later, so the button has no title.
    expect(button("Split").title).toBe("");
  });

  it("is drawn inside its button, out of a screen reader's way, and never takes the pointer", () => {
    show();
    fireEvent.pointerEnter(button("Split"));
    rest(TIP_DELAY_MS);
    const tip = document.querySelector("[data-tooltip]") as HTMLElement;
    expect(tip.parentElement).toBe(button("Split"));
    expect(tip.getAttribute("aria-hidden")).toBe("true");
    expect(tip.className).toContain("pointer-events-none");
    expect(tip.className).toContain("fixed");
    expect(tip.style.visibility).toBe("visible");
    expect(screen.getByRole("button", { name: "Split" })).toBe(button("Split"));
  });

  it("goes when the pointer leaves, and a pointer that only passes over never shows one", () => {
    show();
    fireEvent.pointerEnter(button("Split"));
    rest(TIP_DELAY_MS / 2);
    fireEvent.pointerLeave(button("Split"));
    rest(TIP_DELAY_MS * 4);
    expect(tips()).toEqual([]);
    fireEvent.pointerEnter(button("Split"));
    rest(TIP_DELAY_MS);
    expect(tips()).toHaveLength(1);
    fireEvent.pointerLeave(button("Split"));
    expect(tips()).toEqual([]);
  });

  it("the next button's shows at once, until the pointer has been away a while", () => {
    show();
    fireEvent.pointerEnter(button("Split"));
    rest(TIP_DELAY_MS);
    fireEvent.pointerLeave(button("Split"));
    rest(TIP_WARM_MS - 50);
    fireEvent.pointerEnter(button("Snap"));
    expect(tips()).toEqual(["Snap"]);
    fireEvent.pointerLeave(button("Snap"));
    rest(TIP_WARM_MS + 50);
    fireEvent.pointerEnter(button("Split"));
    expect(tips()).toEqual([]);
    rest(TIP_DELAY_MS);
    expect(tips()).toEqual(["Split (S)"]);
  });

  it("shows at once when the pointer goes straight from one button onto the next", () => {
    show();
    fireEvent.pointerEnter(button("Split"));
    rest(TIP_DELAY_MS);
    // A real pointer leaves one and enters the other in the same moment, before anything is drawn again.
    act(() => {
      fireEvent.pointerLeave(button("Split"));
      fireEvent.pointerEnter(button("Snap"));
    });
    expect(tips()).toEqual(["Snap"]);
  });

  it("goes on a press, on Escape, when anything scrolls, and when the window loses focus", () => {
    show();
    const rested = () => {
      fireEvent.pointerLeave(button("Split"));
      fireEvent.pointerEnter(button("Split"));
      rest(TIP_DELAY_MS);
      expect(tips()).toHaveLength(1);
    };
    rested();
    fireEvent.pointerDown(button("Split"));
    expect(tips()).toEqual([]);
    rested();
    fireEvent.keyDown(button("Split"), { key: "Escape" });
    expect(tips()).toEqual([]);
    rested();
    fireEvent.scroll(document.body);
    expect(tips()).toEqual([]);
    rested();
    fireEvent.blur(window);
    expect(tips()).toEqual([]);
  });

  it("a press before it shows cancels it", () => {
    show();
    fireEvent.pointerEnter(button("Split"));
    fireEvent.pointerDown(button("Split"));
    rest(TIP_DELAY_MS * 4);
    expect(tips()).toEqual([]);
  });

  it("a touch shows none", () => {
    show();
    fireEvent.pointerEnter(button("Split"), { pointerType: "touch" });
    rest(TIP_DELAY_MS * 4);
    expect(tips()).toEqual([]);
  });

  it("shows at once for a button reached with the keyboard, and goes when focus moves on", () => {
    show();
    const split = button("Split");
    const matches = split.matches.bind(split);
    vi.spyOn(split, "matches").mockImplementation((selector: string) => (selector === ":focus-visible" ? true : matches(selector)));
    fireEvent.focus(split);
    expect(tips()).toEqual(["Split (S)"]);
    fireEvent.blur(split);
    expect(tips()).toEqual([]);
    // Focus that came from a click shows none.
    const snap = button("Snap");
    vi.spyOn(snap, "matches").mockImplementation(() => false);
    fireEvent.focus(snap);
    expect(tips()).toEqual([]);
  });

  it("carries a second, quieter line for what else the button does", () => {
    show();
    fireEvent.pointerEnter(button("Arrow"));
    rest(TIP_DELAY_MS);
    const tip = document.querySelector("[data-tooltip]") as HTMLElement;
    expect(tip.firstChild?.textContent).toBe("Arrow (Shift+A)");
    expect(tip.querySelector("span")?.textContent).toBe("Click again for a line");
    expect(tip.querySelector("span")?.className).toContain("text-ed-muted");
  });

  it("tells a screen reader the key and the second line, and nothing twice", () => {
    show();
    const told = (name: string) => document.getElementById(button(name).getAttribute("aria-describedby") ?? "none");
    expect(told("Split")?.textContent).toBe("Split (S)");
    expect(told("Split")?.hidden).toBe(true);
    expect(told("Arrow")?.textContent).toBe("Arrow (Shift+A). Click again for a line");
    // A name with nothing to add is not said twice, and a disabled button's title does the telling.
    expect(button("Snap").hasAttribute("aria-describedby")).toBe(false);
    expect(button("Delete").hasAttribute("aria-describedby")).toBe(false);
    expect(tipOf(button("Delete"))).toBe("Delete (Backspace)");
  });

  it("a disabled button keeps the browser's tooltip, and draws none of its own", () => {
    show();
    expect(button("Delete").title).toBe("Delete (Backspace)");
    fireEvent.pointerEnter(button("Delete"));
    rest(TIP_DELAY_MS * 4);
    expect(tips()).toEqual([]);
  });

  it("a button that turns disabled while its tooltip shows loses it", () => {
    const { rerender } = render(<IconButton label="Undo">u</IconButton>);
    fireEvent.pointerEnter(button("Undo"));
    rest(TIP_DELAY_MS);
    expect(tips()).toEqual(["Undo"]);
    rerender(<IconButton label="Undo" disabled>u</IconButton>);
    expect(tips()).toEqual([]);
  });

  it("keeps the caller's own handlers", () => {
    const seen: string[] = [];
    render(
      <IconButton label="Play" onPointerEnter={() => seen.push("enter")} onPointerLeave={() => seen.push("leave")} onPointerDown={() => seen.push("down")} onFocus={() => seen.push("focus")} onBlur={() => seen.push("blur")} onKeyDown={(e) => seen.push(e.key)}>
        p
      </IconButton>,
    );
    const play = button("Play");
    fireEvent.pointerEnter(play);
    fireEvent.pointerDown(play);
    fireEvent.pointerLeave(play);
    fireEvent.focus(play);
    fireEvent.keyDown(play, { key: "Escape" });
    fireEvent.blur(play);
    expect(seen).toEqual(["enter", "down", "leave", "focus", "Escape", "blur"]);
  });
});

describe("where a tooltip goes", () => {
  const view = { width: 1000, height: 600 };
  const size = { width: 80, height: 24 };

  it("under its button, centred on it", () => {
    expect(placeTip({ left: 100, top: 10, right: 128, bottom: 38 }, size, view, "bottom")).toEqual({ left: 74, top: 44 });
  });

  it("above a button at the bottom of the window", () => {
    expect(placeTip({ left: 100, top: 560, right: 128, bottom: 588 }, size, view, "bottom")).toEqual({ left: 74, top: 530 });
  });

  it("kept inside the window's sides", () => {
    expect(placeTip({ left: 2, top: 10, right: 30, bottom: 38 }, size, view, "bottom").left).toBe(4);
    expect(placeTip({ left: 970, top: 10, right: 998, bottom: 38 }, size, view, "bottom").left).toBe(916);
  });

  it("to the right of a button in a vertical strip, centred on it, or to its left with no room", () => {
    expect(placeTip({ left: 300, top: 100, right: 328, bottom: 128 }, size, view, "right")).toEqual({ left: 334, top: 102 });
    expect(placeTip({ left: 960, top: 100, right: 988, bottom: 128 }, size, view, "right")).toEqual({ left: 874, top: 102 });
    expect(placeTip({ left: 300, top: 0, right: 328, bottom: 10 }, size, view, "right").top).toBe(4);
  });
});
