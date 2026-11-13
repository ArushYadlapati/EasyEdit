// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIELD_BOX, cx } from "@/components/ui/cx";
import { NumberInput, type NumberInputProps } from "@/components/ui/number-input";
import { act, fireEvent, render, screen } from "../helpers/dom";

function setup() {
  const onCommit = vi.fn();
  const onPreview = vi.fn();
  render(<NumberInput ariaLabel="Size" value={64} min={8} max={1000} onCommit={onCommit} onPreview={onPreview} />);
  return { input: screen.getByLabelText("Size") as HTMLInputElement, onCommit, onPreview };
}

it("previews while typing and commits once on Enter", () => {
  const { input, onCommit, onPreview } = setup();
  fireEvent.change(input, { target: { value: "72" } });
  expect(onPreview).toHaveBeenLastCalledWith(72);
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(72);
});

it("clamps to its range on blur, and puts back text that is not a number", () => {
  const { input, onCommit } = setup();
  fireEvent.change(input, { target: { value: "5000" } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledWith(1000);
  fireEvent.change(input, { target: { value: "abc" } });
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(input.value).toBe("64");
});

it("Escape puts the old value back and commits nothing", () => {
  const { input, onCommit, onPreview } = setup();
  fireEvent.change(input, { target: { value: "90" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("64");
  expect(onPreview).toHaveBeenLastCalledWith(null);
  fireEvent.blur(input);
  expect(onCommit).not.toHaveBeenCalled();
});

it("ArrowUp steps by step, and by ten steps with Shift, marking the key handled", () => {
  const onCommit = vi.fn();
  render(<NumberInput ariaLabel="Start" value={2} step={0.1} onCommit={onCommit} />);
  const input = screen.getByLabelText("Start");
  expect(fireEvent.keyDown(input, { key: "ArrowUp" })).toBe(false);
  expect(onCommit).toHaveBeenLastCalledWith(2.1);
  expect(fireEvent.keyDown(input, { key: "ArrowUp", shiftKey: true })).toBe(false);
  expect(onCommit).toHaveBeenLastCalledWith(3);
});

it("Enter then blur commits once, and Enter and Escape with a draft are marked handled", () => {
  const { input, onCommit } = setup();
  fireEvent.change(input, { target: { value: "72" } });
  expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
  fireEvent.blur(input);
  expect(onCommit).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "90" } });
  expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(false);
  expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(true);
});

describe("drag a value to change it", () => {
  // Animation frames run when frame() says.
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  beforeEach(() => {
    frames = new Map();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.set(++nextFrame, cb);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const frame = () =>
    act(() => {
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(0);
    });

  function setup(props: Partial<NumberInputProps> = {}, preview: (v: number | null) => boolean | void = () => undefined) {
    const onCommit = vi.fn();
    const onPreview = vi.fn(preview);
    const element = (over: Partial<NumberInputProps> = {}) => (
      <NumberInput ariaLabel="X" value={50} scrub={1} onCommit={onCommit} onPreview={onPreview} {...props} {...over} />
    );
    const view = render(element());
    const input = screen.getByLabelText("X") as HTMLInputElement;
    const press = (init: object = {}) => fireEvent.pointerDown(input, { button: 0, pointerId: 1, clientX: 100, ...init });
    const move = (dx: number, init: object = {}) => fireEvent.pointerMove(input, { pointerId: 1, clientX: 100 + dx, ...init });
    const release = (dx: number) => fireEvent.pointerUp(input, { pointerId: 1, clientX: 100 + dx });
    const drag = (dx: number, init: object = {}) => {
      press();
      move(dx, init);
      frame();
    };
    return { input, onCommit, onPreview, press, move, release, drag, view, rerender: (over: Partial<NumberInputProps>) => view.rerender(element(over)) };
  }

  it("dragging sideways changes the value and saves once", () => {
    const { input, onCommit, onPreview, press, move, release } = setup();
    expect(press()).toBe(false); // no caret, no text selection
    expect(input.hasPointerCapture(1)).toBe(true);
    expect(fireEvent.mouseDown(input, { button: 0 })).toBe(false); // nor from the mouse event after it
    move(10);
    move(20);
    expect(frames.size).toBe(1); // worked out once per frame
    frame();
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenLastCalledWith(70, { scrubbed: true });
    expect(input.value).toBe("70");
    expect(onCommit).not.toHaveBeenCalled();
    release(20);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(70, { scrubbed: true });
    expect(document.activeElement).not.toBe(input);
    expect(input.hasPointerCapture(1)).toBe(false);
    expect(fireEvent.mouseDown(input, { button: 0 })).toBe(true);
  });

  it("a release before the frame runs saves where it was let go", () => {
    const { onCommit, press, move, release } = setup();
    press();
    move(20);
    release(20);
    expect(onCommit).toHaveBeenCalledWith(70, { scrubbed: true });
    expect(frames.size).toBe(0);
  });

  it("a move of 3 px or less is not a drag", () => {
    const { onPreview, press, move } = setup();
    press();
    move(3);
    frame();
    expect(onPreview).not.toHaveBeenCalled();
    move(-4);
    frame();
    expect(onPreview).toHaveBeenLastCalledWith(46, { scrubbed: true });
  });

  it("Shift moves ten times as far", () => {
    const { onPreview, drag } = setup();
    drag(4, { shiftKey: true });
    expect(onPreview).toHaveBeenLastCalledWith(90, { scrubbed: true });
  });

  it("Cmd or Ctrl moves a tenth as far", () => {
    const ctrl = setup();
    ctrl.drag(20, { ctrlKey: true });
    expect(ctrl.onPreview).toHaveBeenLastCalledWith(52, { scrubbed: true });
    ctrl.view.unmount();
    const meta = setup();
    meta.drag(20, { metaKey: true });
    expect(meta.onPreview).toHaveBeenLastCalledWith(52, { scrubbed: true });
  });

  it("Shift and Ctrl together move ten times as far", () => {
    const { onPreview, drag } = setup();
    drag(4, { shiftKey: true, ctrlKey: true });
    expect(onPreview).toHaveBeenLastCalledWith(90, { scrubbed: true });
  });

  it("the keys are read from each move", () => {
    const { onPreview, input, move, drag } = setup();
    drag(20, { shiftKey: true });
    expect(input.value).toBe("250");
    move(20);
    frame();
    expect(onPreview).toHaveBeenLastCalledWith(70, { scrubbed: true });
  });

  it("a value that cannot apply is not shown", () => {
    const { input, onCommit, move, release, drag } = setup({}, (v) => (v !== null && v >= 60 ? false : undefined));
    drag(9);
    expect(input.value).toBe("59");
    move(20);
    frame();
    expect(input.value).toBe("59");
    release(20);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(59, { scrubbed: true });
  });

  it("when nothing applied, release saves nothing", () => {
    const { input, onCommit, onPreview, release, drag } = setup({}, (v) => (v === null ? undefined : false));
    drag(20);
    expect(input.value).toBe("50");
    release(20);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it("scrubRange stops a scrub but not typing", () => {
    const { input, onCommit, release, drag } = setup({ scrubRange: { min: 45, max: 55 } });
    drag(20);
    expect(input.value).toBe("55");
    release(20);
    expect(onCommit).toHaveBeenLastCalledWith(55, { scrubbed: true });
    fireEvent.change(input, { target: { value: "80" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).toHaveBeenLastCalledWith(80);
  });

  it("a scrubRange given as a function is read once, at the press", () => {
    const range = vi.fn(() => ({ min: 45, max: 55 }));
    const { input, move, drag } = setup({ scrubRange: range });
    expect(range).not.toHaveBeenCalled();
    drag(20);
    move(-20);
    frame();
    expect(input.value).toBe("45");
    expect(range).toHaveBeenCalledTimes(1);
  });

  it("a press without a move types instead", () => {
    const { input, onCommit, onPreview, press, release } = setup();
    press();
    release(0);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(2);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    // With the input focused, a press is the browser's.
    expect(press()).toBe(true);
    fireEvent.pointerMove(input, { pointerId: 1, clientX: 130 });
    frame();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("a press first leaves the field being typed in, so it saves", () => {
    const other = vi.fn();
    const onCommit = vi.fn();
    render(
      <>
        <NumberInput ariaLabel="Y" value={1} onCommit={other} />
        <NumberInput ariaLabel="X" value={50} scrub={1} onCommit={onCommit} />
      </>,
    );
    const y = screen.getByLabelText("Y") as HTMLInputElement;
    y.focus();
    fireEvent.change(y, { target: { value: "7" } });
    fireEvent.pointerDown(screen.getByLabelText("X"), { button: 0, pointerId: 1, clientX: 100 });
    expect(other).toHaveBeenCalledWith(7);
    expect(document.activeElement).not.toBe(y);
  });

  it("Escape mid-drag puts it back", () => {
    const { input, onCommit, onPreview, release, drag } = setup();
    drag(20);
    const later = vi.fn();
    window.addEventListener("keydown", later);
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
    window.removeEventListener("keydown", later);
    expect(later).not.toHaveBeenCalled();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(input.value).toBe("50");
    expect(input.hasPointerCapture(1)).toBe(false);
    release(20);
    expect(onCommit).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true); // the listener is gone
  });

  it.each(["pointerCancel", "lostPointerCapture"] as const)("%s puts it back", (name) => {
    const { input, onCommit, onPreview, release, drag } = setup();
    drag(20);
    fireEvent[name](input, { pointerId: 1 });
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(input.value).toBe("50");
    release(20);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("back where it started saves nothing", () => {
    const { onCommit, onPreview, move, release, drag } = setup();
    drag(20);
    move(0);
    frame();
    release(0);
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("min and max hold while dragging", () => {
    const { input, move, drag } = setup({ min: 40, max: 60 });
    drag(30);
    expect(input.value).toBe("60");
    move(-30);
    frame();
    expect(input.value).toBe("40");
  });

  it("a scrubbed value is rounded to its decimals", () => {
    const one = setup({ scrub: 0.37, decimals: 1 });
    one.drag(10);
    expect(one.onPreview).toHaveBeenLastCalledWith(53.7, { scrubbed: true });
    one.view.unmount();
    const four = setup({ scrub: 1 / 3 });
    four.drag(10);
    expect(four.onPreview).toHaveBeenLastCalledWith(53.3333, { scrubbed: true });
  });

  it("a disabled field cannot be dragged", () => {
    const { input, onPreview, press, move } = setup({ disabled: true });
    expect(press()).toBe(true);
    move(20);
    frame();
    expect(onPreview).not.toHaveBeenCalled();
    expect(input.value).toBe("50");
  });

  it("a field disabled mid-drag drops it", () => {
    const { input, onCommit, onPreview, release, drag, rerender } = setup();
    drag(20);
    rerender({ disabled: true });
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(input.value).toBe("50");
    release(20);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("unmounted mid-drag, it leaves no frame or key listener behind", () => {
    const { move, drag, view } = setup();
    drag(20);
    move(30);
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(true);
  });

  it("on a Mac a Ctrl press starts no drag", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const { onPreview, press, move } = setup();
    expect(press({ ctrlKey: true })).toBe(true);
    move(20, { ctrlKey: true });
    frame();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("only the main button drags", () => {
    const { onPreview, press, move } = setup();
    expect(press({ button: 2 })).toBe(true);
    move(20);
    frame();
    expect(onPreview).not.toHaveBeenCalled();
  });

  it("an arrow on a decimals={1} field rounds", () => {
    const onCommit = vi.fn();
    render(<NumberInput ariaLabel="Start" value={2.06} step={0.1} decimals={1} onCommit={onCommit} />);
    fireEvent.keyDown(screen.getByLabelText("Start"), { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(2.2);
  });

  it("a draggable value looks like a value, not a box", () => {
    const { input, view } = setup();
    for (const name of ["text-ed-accent", "cursor-ew-resize", "border-transparent"]) expect(input.classList.contains(name)).toBe(true);
    expect(input.classList.contains("bg-ed-raised")).toBe(false);
    view.unmount();
    render(<NumberInput ariaLabel="Plain" value={1} suffix="%" onCommit={() => {}} />);
    expect(screen.getByLabelText("Plain").className).toBe(cx(FIELD_BOX, "peer h-7 tabular-nums", "pr-7"));
  });
});
