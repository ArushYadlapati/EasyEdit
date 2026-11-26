// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { MESSAGES } from "@/lib/editor/messages";
import { moveAt } from "@/lib/media/steady";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, video } from "../editor/fixtures";
import { cleanup, fireEvent, render, screen, waitFor } from "../helpers/dom";
import { docWithCaptions } from "../helpers/docs";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { openEverySection } from "../helpers/folds";

// The button, not the section heading of the same name, which folds the section.
const stabilizeButton = () => screen.getAllByRole("button", { name: "Stabilize" }).find((b) => !b.hasAttribute("aria-expanded"))!;

// These tests are about what the sections hold, so every section starts open.
beforeEach(openEverySection);

// The video the scanner "reads", 160 × 90 at 30 frames a second: a textured wall seen by a camera that is `camera`
// pixels off at each second of the file.
let camera: (seconds: number) => { x: number; y: number } = () => ({ x: 0, y: 0 });
const scanned: { from: number; to: number; side: number }[] = [];
let flat = false; // the wall painted one grey, with nothing on it to go by
const [W, H] = [160, 90];
function frame(off: { x: number; y: number }): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  if (flat) return rgba.fill(128);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [u, v] = [x - off.x, y - off.y];
    const value = 110 + 50 * Math.sin(u * 0.31) * Math.cos(v * 0.27) + 30 * Math.sin((u + v) * 0.11) + 25 * Math.sin(u * 0.9 + v * 1.3);
    rgba.set([value, value, value, 255], (y * W + x) * 4);
  }
  return rgba;
}
vi.mock("@/components/editor/media/frame-decode", async (original) => ({
  ...(await original<typeof import("@/components/editor/media/frame-decode")>()),
  scanFrames: async (_blob: Blob, from: number, to: number, side: number, each: (seconds: number, rgba: Uint8ClampedArray, width: number, height: number) => void) => {
    scanned.push({ from, to, side });
    for (let f = Math.round(from * 30); f < Math.round(to * 30); f++) each(f / 30, frame(camera(f / 30)), W, H);
    return true;
  },
}));

afterEach(() => {
  scanned.length = 0;
  cleanup();
});

// c1 plays three seconds of its file from one second in.
function doc(extra: Record<string, unknown> = {}): TimelineDoc {
  const d = docWithCaptions("long_16x9");
  d.tracks[0].clips = [video("c1", 0, 90, { in: 30, ...extra })];
  return d;
}
function show(opts: { canEdit?: boolean; readable?: boolean; doc?: TimelineDoc } = {}) {
  const store = makeStore({ doc: opts.doc ?? doc(), canEdit: opts.canEdit ?? true });
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
  const clip = () => store.getState().doc.tracks[0].clips[0] as MediaClip;
  return { store, notices: noticesOf(store), clip };
}
// A hand's shake: whole pixels, a different way every frame, the same on every run.
const shake = (seconds: number) => {
  const f = Math.round(seconds * 30);
  return { x: Math.round(4 * Math.sin(f * 1.7) + 2 * Math.sin(f * 0.6)), y: Math.round(3 * Math.cos(f * 2.3)) };
};

it("Stabilize keeps on the clip the moves that undo the camera's shake, and says how much larger the picture is drawn", async () => {
  camera = shake;
  const { store, notices, clip } = show();
  expect(screen.getByText(/Takes a hand-held camera's shake out/)).toBeTruthy();
  fireEvent.click(stabilizeButton());
  expect(screen.getByRole("button", { name: "Looking at the motion…" })).toBeTruthy();
  await waitFor(() => expect(notices).toHaveLength(1));
  expect(scanned).toEqual([{ from: 1, to: 4 + 1 / 30, side: 192 }]); // the part of the file the clip plays
  const steady = clip().steady!;
  expect(notices[0]).toBe(MESSAGES.steadied(steady.zoom));
  expect(steady.from).toBe(30);
  expect(steady.zoom).toBeGreaterThan(1.02);
  expect(steady.zoom).toBeLessThanOrEqual(1.25);
  // With its move, each frame's picture sits far closer to one place than the camera left it.
  const left = (file: number) => shake(file / 30).x / W;
  const after = (file: number) => left(file) + moveAt(steady, file).dx;
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  const middle = Array.from({ length: 30 }, (_, i) => 60 + i);
  expect(spread(middle.map(after))).toBeLessThan(spread(middle.map(left)) / 3);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "stabilize" });
  // Now it says so, and can be taken off.
  expect(screen.getByText(/^Stabilized: the picture is moved against the camera's shake/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stabilize again" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove stabilizing" }));
  expect(clip().steady).toBeNull();
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "remove stabilizing" });
});

it("stronger evens the path out over longer, so it moves the picture further", async () => {
  camera = (seconds) => ({ x: Math.round(6 * Math.sin(seconds * 4)), y: 0 }); // a slow sway
  const zoomAt = async (strength: string) => {
    const { notices, clip } = show();
    fireEvent.change(screen.getByLabelText("How steady"), { target: { value: strength } });
    fireEvent.click(stabilizeButton());
    await waitFor(() => expect(notices).toHaveLength(1));
    const zoom = clip().steady?.zoom ?? 1;
    cleanup();
    return zoom;
  };
  const [light, strong] = [await zoomAt("light"), await zoomAt("strong")];
  expect(strong).toBeGreaterThan(light);
});

it("leaves a steady clip alone, and says when the file cannot be read", async () => {
  camera = () => ({ x: 0, y: 0 });
  const still = show();
  fireEvent.click(stabilizeButton());
  await waitFor(() => expect(still.notices).toEqual([MESSAGES.steadyAlready]));
  expect(still.clip().steady).toBeUndefined();
  cleanup();
  const gone = show({ readable: false });
  fireEvent.click(stabilizeButton());
  await waitFor(() => expect(gone.notices).toEqual([MESSAGES.steadyUnreadable]));
});

it("changes nothing when the picture is too flat to tell how it moved", async () => {
  flat = true;
  const { notices, clip } = show();
  fireEvent.click(stabilizeButton());
  await waitFor(() => expect(notices).toEqual([MESSAGES.steadyUnsure]));
  expect(clip().steady).toBeUndefined();
  flat = false;
});

it("is for a video that plays, and off for someone who can't edit", () => {
  show({ canEdit: false });
  expect((stabilizeButton() as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  show({ doc: doc({ speed: 0 }) }); // a held frame has no motion
  expect(screen.queryByRole("heading", { name: "Stabilize" })).toBeNull();
  cleanup();
  show({ doc: doc({ type: "image" }) });
  expect(screen.queryByRole("heading", { name: "Stabilize" })).toBeNull();
});
