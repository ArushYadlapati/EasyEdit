import type { ReactNode } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { LANE_GUTTER } from "@/components/editor/timeline/playhead";
import { Timeline } from "@/components/editor/timeline/timeline";
import { HEADER_WIDTH, ROW_HEIGHT, RULER_HEIGHT } from "@/lib/editor/geometry";
import type { SettingsStore } from "@/lib/editor/settings";
import { findClip, viewDoc, type EditorStore } from "@/lib/editor/store";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "./dom";
import { rect } from "./layout";

// happy-dom does no layout. Every element is 1400 px wide, the scroller's left edge is at 0 on screen
// and nothing is scrolled, so frame 0 of every lane is at HEADER_WIDTH + LANE_GUTTER and the rows
// start under the ruler. Rows top to bottom: cap, t1, v1, a1. Animation frames run when frame() says.
export const ZOOM = 2;
export const LANE_LEFT = HEADER_WIDTH + LANE_GUTTER;
export const x = (frame: number) => LANE_LEFT + frame * ZOOM;
export const y = (row: number) => RULER_HEIGHT + row * ROW_HEIGHT + ROW_HEIGHT / 2;

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

// The number of animation frames asked for and not yet run.
export function pendingFrames(): number {
  return frames.size;
}

// Registers, for the calling test file, the 1400 px client width and the hand-run animation-frame queue.
export function installTimelineStubs(): void {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1400);
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
}

// Renders EditorProvider > wrap(MediaProvider? > Timeline); MediaProvider only when media is given. settings: the
// preferences the provider hands out, else its own defaults.
export function renderTimeline(
  store: EditorStore = makeStore(),
  opts: { media?: MediaServices; settings?: SettingsStore; wrap?(timeline: ReactNode): ReactNode } = {},
) {
  const { media, settings, wrap = (timeline: ReactNode) => timeline } = opts;
  const view = render(
    <EditorProvider store={store} settings={settings}>
      {wrap(
        media ? (
          <MediaProvider services={media}>
            <Timeline />
          </MediaProvider>
        ) : (
          <Timeline />
        ),
      )}
    </EditorProvider>,
  );
  act(() => store.getState().setZoom(ZOOM));
  const scroller = screen.getByRole("slider", { name: "Playhead" }).closest<HTMLElement>(".overflow-auto")!;
  scroller.getBoundingClientRect = () => rect(0, 0, 1400, 400);
  const lanes = [...view.container.querySelectorAll<HTMLElement>("[data-lane]")];
  for (const lane of lanes) lane.getBoundingClientRect = () => rect(LANE_LEFT, 0, 1400 - LANE_LEFT, ROW_HEIGHT);
  const rows = lanes[0].parentElement!.parentElement!;
  rows.getBoundingClientRect = () => rect(0, RULER_HEIGHT, 1400, 4 * ROW_HEIGHT);
  const st = () => store.getState();
  const clip = (id: string) => view.container.querySelector<HTMLElement>(`[data-clip-id="${id}"]`)!;
  const at = (clientX: number, clientY: number) => ({ button: 0, pointerId: 1, clientX, clientY });
  const press = (el: HTMLElement, clientX: number, clientY: number, over: object = {}) => fireEvent.pointerDown(el, { ...at(clientX, clientY), ...over });
  const move = (clientX: number, clientY: number) => fireEvent.pointerMove(scroller, at(clientX, clientY));
  const release = (clientX: number, clientY: number) => fireEvent.pointerUp(scroller, at(clientX, clientY));
  const frame = () =>
    act(() => {
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(performance.now());
    });
  const startOf = (id: string) => findClip(st().doc, id)!.clip.start;
  const shownStart = (id: string) => findClip(viewDoc(st()), id)!.clip.start;
  return { store, st, view, scroller, lanes, rows, clip, press, move, release, frame, startOf, shownStart };
}
