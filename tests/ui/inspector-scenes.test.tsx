// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { MESSAGES } from "@/lib/editor/messages";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "../editor/fixtures";
import { cleanup, fireEvent, render, screen, waitFor } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { openEverySection } from "../helpers/folds";

// These tests are about what the sections hold, so every section starts open.
beforeEach(openEverySection);

// The video the scanner "reads": its shots as [seconds, colour], shown at 30 frames a second. null: unreadable.
let shots: [number, [number, number, number]][] | null = [];
const scanned: { from: number; to: number; side: number }[] = [];
vi.mock("@/components/editor/media/frame-decode", async (original) => ({
  ...(await original<typeof import("@/components/editor/media/frame-decode")>()),
  scanFrames: async (_blob: Blob, from: number, to: number, side: number, each: (seconds: number, rgba: Uint8ClampedArray, width: number, height: number) => void) => {
    scanned.push({ from, to, side });
    if (shots === null) return false;
    let at = 0;
    for (const [seconds, color] of shots) {
      for (let i = 0; i < seconds * 30; i++, at++) {
        const moment = at / 30;
        if (moment >= from && moment < to) each(moment, new Uint8ClampedArray(8 * 8 * 4).map((_, b) => (b % 4 === 3 ? 255 : color[b % 4])), 8, 8);
      }
    }
    return true;
  },
}));

afterEach(() => {
  scanned.length = 0;
  cleanup();
});

// c1: six seconds on the timeline from frame 30, playing its file from one second in.
const footage = (extra: Record<string, unknown> = {}) => {
  const d = sampleDoc();
  d.tracks[0].clips = [video("c1", 30, 180, { in: 30, ...extra })];
  return d;
};
function show(opts: { doc?: TimelineDoc; canEdit?: boolean; readable?: boolean } = {}) {
  const store = makeStore({ doc: opts.doc ?? footage(), canEdit: opts.canEdit ?? true });
  store.getState().select(["c1"]);
  const services = pretendMediaServices([assetView()]);
  const media: MediaServices = { ...services, files: { get: async () => (opts.readable === false ? { ok: false, problem: "missing" as never } : { ok: true, blob: new Blob(["x"]) }), put: async () => {} } };
  render(
    <EditorProvider store={store}>
      <MediaProvider services={media}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  return { store, notices: noticesOf(store), clips: () => store.getState().doc.tracks[0].clips as MediaClip[] };
}
const RED: [number, number, number] = [200, 30, 30];
const BLUE: [number, number, number] = [30, 30, 200];
const GREEN: [number, number, number] = [30, 200, 30];

it("Split at scene changes looks through the part of the file the clip plays and splits it where the shot changes", async () => {
  shots = [[3, RED], [2, BLUE], [5, GREEN]]; // the file cuts at 3 s and at 5 s
  const { store, notices, clips } = show();
  fireEvent.click(screen.getByRole("button", { name: "Split at scene changes" }));
  expect(screen.getByRole("button", { name: "Looking for cuts…" })).toBeTruthy();
  await waitFor(() => expect(notices).toEqual([MESSAGES.scenesSplit(3)]));
  expect(scanned).toEqual([{ from: 1, to: 7, side: 64 }]); // the file from 1 s to 7 s, small
  // The file's 3 s and 5 s are two and four seconds into the clip: frames 90 and 150.
  expect(clips().map((c) => [c.start, c.duration, c.in])).toEqual([[30, 60, 30], [90, 60, 90], [150, 60, 150]]);
  expect(store.getState().selection.clipIds).toEqual(clips().map((c) => c.id));
  expect(store.getState().queue.filter((e) => e.label === "split at scene changes")).toHaveLength(1);
  store.getState().undo();
  expect(store.getState().doc).toEqual(footage());
});

it("says so when the clip is one shot, or its file cannot be read", async () => {
  shots = [[10, RED]];
  const one = show();
  fireEvent.click(screen.getByRole("button", { name: "Split at scene changes" }));
  await waitFor(() => expect(one.notices).toEqual([MESSAGES.oneScene]));
  expect(one.clips()).toHaveLength(1);
  cleanup();
  shots = null;
  const unread = show();
  fireEvent.click(screen.getByRole("button", { name: "Split at scene changes" }));
  await waitFor(() => expect(unread.notices).toEqual([MESSAGES.scenesUnreadable]));
  cleanup();
  const gone = show({ readable: false });
  fireEvent.click(screen.getByRole("button", { name: "Split at scene changes" }));
  await waitFor(() => expect(gone.notices).toEqual([MESSAGES.scenesUnreadable]));
  expect(scanned).toHaveLength(2); // a file that cannot be had is not scanned
});

it("is for a video that plays forward, and off for someone who can't edit", () => {
  show({ canEdit: false });
  expect((screen.getByRole("button", { name: "Split at scene changes" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  show({ doc: footage({ speed: -1, in: 200 }) });
  expect(screen.queryByRole("heading", { name: "Scenes" })).toBeNull();
  cleanup();
  show({ doc: footage({ type: "audio" }) });
  expect(screen.queryByRole("heading", { name: "Scenes" })).toBeNull();
});
