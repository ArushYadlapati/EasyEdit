// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { MESSAGES } from "@/lib/editor/messages";
import { DEFAULT_TRANSFORM, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, text, video } from "../editor/fixtures";
import { cleanup, fireEvent, render, screen, waitFor } from "../helpers/dom";
import { docWithCaptions } from "../helpers/docs";
import { assetView, pretendMediaServices } from "../helpers/media-services";

// The video the scanner "reads", 160 × 90 at 30 frames a second: a patterned square on a textured wall. where: its
// place at a second of the file, or null once it is gone.
let where: (seconds: number) => { x: number; y: number } | null = () => null;
const scanned: { from: number; to: number; side: number }[] = [];
const [W, H] = [160, 90];
function frame(at: { x: number; y: number } | null): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 90 + 40 * Math.sin(x * 0.31) * Math.cos(y * 0.27) + 25 * Math.sin((x + y) * 0.11) + 15 * Math.sin(x * 0.9 + y * 1.3);
    if (at && Math.abs(x - Math.round(at.x)) <= 6 && Math.abs(y - Math.round(at.y)) <= 6) v = (x + y) % 2 === 0 ? 250 : 60;
    rgba.set([v, v, v, 255], (y * W + x) * 4);
  }
  return rgba;
}
vi.mock("@/components/editor/media/frame-decode", async (original) => ({
  ...(await original<typeof import("@/components/editor/media/frame-decode")>()),
  scanFrames: async (_blob: Blob, from: number, to: number, side: number, each: (seconds: number, rgba: Uint8ClampedArray, width: number, height: number) => void) => {
    scanned.push({ from, to, side });
    for (let f = Math.round(from * 30); f < Math.round(to * 30); f++) each(f / 30, frame(where(f / 30)), W, H);
    return true;
  },
}));

afterEach(() => {
  scanned.length = 0;
  cleanup();
});

// A 16:9 project: the video c1 from frame 0 for ten seconds, and the title x1 on it from 1 s to 3 s.
function doc(at: { x: number; y: number }): TimelineDoc {
  const d = docWithCaptions("long_16x9");
  d.tracks[0].clips = [video("c1", 0, 300)];
  d.tracks[1].clips = [text("x1", 30, 60, { transform: { ...DEFAULT_TRANSFORM, ...at } })];
  return d;
}
function show(at: { x: number; y: number }, playhead: number, opts: { canEdit?: boolean; readable?: boolean } = {}) {
  const store = makeStore({ doc: doc(at), canEdit: opts.canEdit ?? true });
  store.getState().select(["x1"]);
  store.getState().seek(playhead);
  const services = pretendMediaServices([assetView({ width: 1920, height: 1080 })]);
  const media: MediaServices = { ...services, files: { get: async () => (opts.readable === false ? { ok: false, problem: "missing" as never } : { ok: true, blob: new Blob(["x"]) }), put: async () => {} } };
  render(
    <EditorProvider store={store}>
      <MediaProvider services={media}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  const keys = () => (store.getState().doc.tracks[1].clips[0] as { keyframes?: { x?: { at: number; value: number }[]; y?: { at: number; value: number }[] } }).keyframes;
  return { store, notices: noticesOf(store), keys };
}
// The square's place in the small frame, as a share of the frame.
const share = (p: { x: number; y: number }) => ({ x: p.x / (W - 1), y: p.y / (H - 1) });

it("Follow gives the clip keyframes that keep it on what was under it, forward and backward from the playhead", async () => {
  // The square crosses the wall in a straight line: 1.5 small pixels a frame across, half a pixel down.
  where = (seconds) => ({ x: 20 + seconds * 30 * 1.5, y: 30 + seconds * 30 * 0.5 });
  const playhead = 60; // two seconds in, the middle of the title
  const { store, notices, keys } = show(share(where(2)!), playhead);
  fireEvent.click(screen.getByRole("button", { name: "Follow what is under it" }));
  expect(screen.getByRole("button", { name: "Following…" })).toBeTruthy();
  await waitFor(() => expect(notices).toEqual([MESSAGES.followed]));
  expect(scanned).toEqual([{ from: 1, to: 3, side: 256 }]); // the part of the file the title is over
  const { x, y } = keys()!;
  // Far fewer keyframes than the sixty frames followed, though the pretend video moves a whole pixel at a time.
  expect(x!.length).toBeLessThanOrEqual(30);
  expect([x![0].at, x!.at(-1)!.at]).toEqual([0, 59]);
  // At the title's first frame the square is where it was at one second, and at its last where it is at 2.97 s.
  const first = share(where(1)!);
  const last = share(where(1 + 59 / 30)!);
  expect(Math.abs(x![0].value - first.x)).toBeLessThan(0.012);
  expect(Math.abs(y![0].value - first.y)).toBeLessThan(0.02);
  expect(Math.abs(x!.at(-1)!.value - last.x)).toBeLessThan(0.012);
  expect(Math.abs(y!.at(-1)!.value - last.y)).toBeLessThan(0.02);
  expect(store.getState().queue.filter((e) => e.label === "follow")).toHaveLength(1);
  store.getState().undo();
  expect(keys()?.x ?? []).toEqual([]);
});

it("follows for as long as the thing is there, and says where it lost it", async () => {
  // Gone from 2.5 s on.
  where = (seconds) => (seconds < 2.5 ? { x: 40 + seconds * 20, y: 45 } : null);
  const { notices, keys } = show(share(where(1.5)!), 45);
  fireEvent.click(screen.getByRole("button", { name: "Follow what is under it" }));
  await waitFor(() => expect(notices).toHaveLength(1));
  expect(notices[0]).toMatch(/^It follows what was under it for 1\.5 s, then loses it\./);
  expect(keys()!.x!.at(-1)!.at).toBeLessThan(46); // 2.5 s of the file is the title's frame 45
});

it("says so when there is nothing to hold on to, no video under it, or the file cannot be read", async () => {
  where = () => null; // a wall of soft texture, with the title over a part that has too little to tell it apart
  const flat = show({ x: 0.5, y: 0.5 }, 60);
  const real = frame;
  void real;
  fireEvent.click(screen.getByRole("button", { name: "Follow what is under it" }));
  await waitFor(() => expect(flat.notices).toHaveLength(1));
  cleanup();
  const nothing = show({ x: 0.5, y: 0.5 }, 10); // the playhead is not on the title
  fireEvent.click(screen.getByRole("button", { name: "Follow what is under it" }));
  expect(nothing.notices).toEqual([MESSAGES.followRefused["not-a-follower"]]);
  cleanup();
  const gone = show({ x: 0.5, y: 0.5 }, 60, { readable: false });
  fireEvent.click(screen.getByRole("button", { name: "Follow what is under it" }));
  await waitFor(() => expect(gone.notices).toEqual([MESSAGES.followUnreadable]));
});

it("is for a text, a shape or an image, and off for someone who can't edit", () => {
  show({ x: 0.5, y: 0.5 }, 60, { canEdit: false });
  expect((screen.getByRole("button", { name: "Follow what is under it" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  const store = makeStore({ doc: doc({ x: 0.5, y: 0.5 }) });
  store.getState().select(["c1"]);
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([assetView()])}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  expect(screen.queryByRole("heading", { name: "Follow" })).toBeNull();
});
