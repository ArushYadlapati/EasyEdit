// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AudioMeter } from "@/components/editor/audio-meter";
import { EditorProvider } from "@/components/editor/context";
import { SoundProvider } from "@/components/editor/sound-context";
import { Timeline } from "@/components/editor/timeline/timeline";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import type { Levels, SoundBus } from "@/lib/audio/sound-bus";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";

// Animation frames are run by hand, with the clock moved along as each one runs.
let frames: FrameRequestCallback[] = [];
let clock = 0;
beforeEach(() => {
  frames = [];
  clock = 1000;
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => void (frames[id - 1] = () => {}));
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1400);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
// Runs the waiting frames `ms` later; those they ask for wait for the next step.
function step(ms = 16) {
  clock += ms;
  const due = frames;
  frames = [];
  act(() => due.forEach((run) => run(clock)));
}

// A mix that reads whatever the test says is sounding.
function pretendBus(levels: { now: Levels | null }) {
  const bus: SoundBus = { line: () => ({ setGain() {}, close() {} }), unlock: vi.fn(), levels: () => levels.now, close: vi.fn() };
  return bus;
}

function show(levels: { now: Levels | null } = { now: null }, store = makeStore()) {
  const bus = pretendBus(levels);
  const view = render(
    <EditorProvider store={store}>
      <SoundProvider bus={bus}>
        <ContextMenuProvider>
          <AudioMeter />
        </ContextMenuProvider>
      </SoundProvider>
    </EditorProvider>,
  );
  const fills = () => [...view.container.querySelectorAll<HTMLElement>("[data-meter-fill]")].map((el) => el.style.clipPath);
  const holds = () => [...view.container.querySelectorAll<HTMLElement>("[data-meter-hold]")].map((el) => [el.style.top, el.style.opacity]);
  const overs = () => [...view.container.querySelectorAll<HTMLElement>("[data-over]")].map((el) => el.dataset.over);
  return { store, bus, view, fills, holds, overs };
}

it("rests empty, with its scale and both sides named", () => {
  const { fills, overs } = show();
  expect(screen.getByRole("group", { name: "Audio meter" })).toBeTruthy();
  expect(fills()).toEqual(["inset(100% 0 0 0)", "inset(100% 0 0 0)"]);
  expect(overs()).toEqual(["false", "false"]);
  for (const mark of ["0", "6", "12", "18", "24", "36", "48", "L", "R"]) expect(screen.getByText(mark)).toBeTruthy();
  expect(screen.getByText("-∞")).toBeTruthy();
});

it("follows the mix while playing: each side to its level, a line at the peak, and the peak in numbers", () => {
  const levels = { now: { left: 1, right: 0.5 } as Levels | null };
  const { store, fills, holds } = show(levels);
  act(() => store.getState().play());
  step();
  // Full scale fills the bar; -6 dB is a tenth down the 60 dB scale.
  expect(fills()).toEqual(["inset(0.00% 0 0 0)", "inset(10.03% 0 0 0)"]);
  expect(holds()).toEqual([["0.00%", "1"], ["10.03%", "1"]]);
  expect(screen.getByText("0.0")).toBeTruthy();
  // The sound stops: the bars fall at 30 dB a second while the peak line waits.
  levels.now = { left: 0, right: 0 };
  step(200);
  expect(fills()[0]).toBe("inset(10.00% 0 0 0)");
  expect(holds()[0]).toEqual(["0.00%", "1"]);
  // A frame that comes late, as after the tab slept, counts for a quarter second at most.
  step(5000);
  expect(fills()[0]).toBe("inset(22.50% 0 0 0)");
});

it("keeps falling after a pause, then stops repainting once it is at rest", () => {
  const levels = { now: { left: 0.5, right: 0.5 } as Levels | null };
  const { store, fills } = show(levels);
  act(() => store.getState().play());
  step();
  levels.now = { left: 0, right: 0 };
  act(() => store.getState().pause());
  step(100);
  expect(fills()[0]).not.toBe("inset(100% 0 0 0)");
  expect(frames.length).toBe(1); // still falling
  for (let i = 0; i < 40; i++) step(250);
  expect(fills()).toEqual(["inset(100.00% 0 0 0)", "inset(100.00% 0 0 0)"]);
  expect(frames).toEqual([]); // nothing left to paint
  expect(screen.getByText("-∞")).toBeTruthy();
});

it("lights a side that went past full scale until it is clicked, and clears it when playback starts again", () => {
  const levels = { now: { left: 1.4, right: 0.3 } as Levels | null };
  const { store, overs } = show(levels);
  act(() => store.getState().play());
  step();
  expect(overs()).toEqual(["true", "false"]);
  levels.now = { left: 0.1, right: 0.1 };
  step(2000);
  expect(overs()).toEqual(["true", "false"]); // it stays lit
  fireEvent.click(screen.getByRole("button", { name: "Clear the left overload light" }));
  expect(overs()).toEqual(["false", "false"]);
  levels.now = { left: 0.1, right: 2 };
  step();
  expect(overs()).toEqual(["false", "true"]);
  act(() => store.getState().pause());
  act(() => store.getState().play());
  expect(overs()).toEqual(["false", "false"]);
});

it("reads nothing where there is no mix yet", () => {
  const { store, fills } = show({ now: null });
  act(() => store.getState().play());
  step();
  expect(fills()).toEqual(["inset(100.00% 0 0 0)", "inset(100.00% 0 0 0)"]);
});

it("hides from its right-click menu", () => {
  const { store } = show();
  fireEvent.contextMenu(screen.getByRole("group", { name: "Audio meter" }), { clientX: 5, clientY: 5 });
  fireEvent.click(screen.getByRole("menuitem", { name: /Hide audio meter/ }));
  expect(store.getState().showAudioMeter).toBe(false);
});

it("sits at the end of the timeline until this browser hides it", () => {
  const store = makeStore();
  render(
    <EditorProvider store={store}>
      <Timeline />
    </EditorProvider>,
  );
  expect(screen.getByRole("group", { name: "Audio meter" })).toBeTruthy();
  act(() => store.getState().setShowAudioMeter(false));
  expect(screen.queryByRole("group", { name: "Audio meter" })).toBeNull();
  act(() => store.getState().setShowAudioMeter(true));
  expect(screen.getByRole("group", { name: "Audio meter" })).toBeTruthy();
});

it("the editor's mix is set up by the first press or key, and let go with the editor", () => {
  const bus = pretendBus({ now: null });
  const view = render(
    <SoundProvider bus={bus}>
      <button type="button">Play</button>
    </SoundProvider>,
  );
  expect(bus.unlock).not.toHaveBeenCalled();
  fireEvent.pointerDown(screen.getByRole("button"));
  expect(bus.unlock).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document.body, { key: " " });
  expect(bus.unlock).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(bus.close).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(document.body, { key: " " });
  expect(bus.unlock).toHaveBeenCalledTimes(2);
});
