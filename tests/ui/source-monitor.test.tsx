// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { SourceMonitor, sourceClock } from "@/components/editor/media/source-monitor";
import type { AssetView } from "@/lib/media/types";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen, waitFor } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// v1 [a 0–60, b 60–120] with the playhead on the cut, and a ten-second video "z" in the library.
const Z = assetView({ id: "z", name: "interview", durationMs: 10_000, previewFileId: "prev-z", originalFileId: "orig-z" });
function project(): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("a", 0, 60), video("b", 60, 60, { in: 100 })];
  return d;
}
function show(opts: { asset?: AssetView; canEdit?: boolean; readable?: boolean; doc?: TimelineDoc; playhead?: number } = {}) {
  const store = makeStore({ doc: opts.doc ?? project(), canEdit: opts.canEdit ?? true });
  store.getState().seek(opts.playhead ?? 60);
  const asset = opts.asset ?? Z;
  const read: string[] = [];
  const services = pretendMediaServices([asset]);
  const media: MediaServices = {
    ...services,
    files: { get: async (fileId) => (read.push(fileId), opts.readable === false ? { ok: false, problem: "missing" as never } : { ok: true, blob: new Blob([fileId]) }), put: async () => {} },
  };
  const onClose = vi.fn();
  render(
    <EditorProvider store={store}>
      <MediaProvider services={media}>
        <SourceMonitor asset={asset} onClose={onClose} />
      </MediaProvider>
    </EditorProvider>,
  );
  const row = () => store.getState().doc.tracks[0].clips.map((c) => [c.start, c.duration, (c as MediaClip).in, (c as MediaClip).assetId]);
  return { store, read, onClose, row, notices: noticesOf(store) };
}
const position = () => screen.getByRole("slider", { name: "Position in the file" }) as HTMLInputElement;
const goTo = (seconds: number) => fireEvent.change(position(), { target: { value: String(seconds) } });
const status = () => screen.getByRole("status").textContent;
const ready = () => waitFor(() => expect(position().disabled).toBe(false));

it("writes a file's own time to a tenth of a second", () => {
  expect([0, 7.46, 59.99, 61.5, 600].map(sourceClock)).toEqual(["0:00.0", "0:07.4", "0:59.9", "1:01.5", "10:00.0"]);
});

it("opens the file the preview plays, whole: In at its start and Out at its end", async () => {
  const { read } = show();
  expect(screen.getByRole("heading", { name: "Source: interview" })).toBeTruthy();
  await ready();
  expect(read).toEqual(["prev-z"]);
  expect(status()).toBe("0:00.0 of 0:10.0 · In 0:00.0 · Out 0:10.0 · 10.0 s marked");
  expect(screen.getByText(/Goes at the playhead, 0:02\.0\./)).toBeTruthy();
});

it("marks an In and an Out at the position, and Overwrite puts that part over what is at the playhead", async () => {
  const { store, row } = show();
  await ready();
  goTo(2);
  fireEvent.click(screen.getByRole("button", { name: "Mark In" }));
  goTo(3.5);
  fireEvent.click(screen.getByRole("button", { name: "Mark Out" }));
  expect(status()).toBe("0:03.5 of 0:10.0 · In 0:02.0 · Out 0:03.5 · 1.5 s marked");
  fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
  // 45 frames from the file's frame 60 go over the first 45 frames of b, which keeps its footage.
  expect(row()).toEqual([[0, 60, 0, "a"], [60, 45, 60, "z"], [105, 15, 145, "a"]]);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "overwrite from source" });
  // The new clip is selected and the playhead is at its end, ready for the next part.
  const added = store.getState().doc.tracks[0].clips[1];
  expect([store.getState().selection.clipIds, store.getState().playhead]).toEqual([[added.id], 105]);
  act(() => store.getState().undo());
  expect(store.getState().doc).toEqual(project());
});

it("Insert makes room at the playhead: what follows on the track moves later", async () => {
  const { store, row } = show();
  await ready();
  goTo(4);
  fireEvent.click(screen.getByRole("button", { name: "Mark In" }));
  goTo(5);
  fireEvent.click(screen.getByRole("button", { name: "Mark Out" }));
  fireEvent.click(screen.getByRole("button", { name: "Insert" }));
  expect(row()).toEqual([[0, 60, 0, "a"], [60, 30, 120, "z"], [90, 60, 100, "a"]]);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "insert from source" });
  // It stays open: the same part again lands after the first.
  fireEvent.click(screen.getByRole("button", { name: "Insert" }));
  expect(row().map((r) => r[0])).toEqual([0, 60, 90, 120]);
  expect(screen.getByRole("heading", { name: "Source: interview" })).toBeTruthy();
});

it("keeps In before Out: marking an In past the Out moves the Out, and the other way round", async () => {
  show();
  await ready();
  goTo(6);
  fireEvent.click(screen.getByRole("button", { name: "Mark Out" }));
  goTo(8);
  fireEvent.click(screen.getByRole("button", { name: "Mark In" }));
  expect(status()).toContain("In 0:08.0 · Out 0:08.0"); // a frame long
  goTo(1);
  fireEvent.click(screen.getByRole("button", { name: "Mark Out" }));
  expect(status()).toContain("In 0:00.9 · Out 0:01.0");
  fireEvent.click(screen.getByRole("button", { name: "Clear marks" }));
  expect(status()).toContain("In 0:00.0 · Out 0:10.0 · 10.0 s marked");
});

it("takes its keys: I and O mark, comma inserts, full stop overwrites", async () => {
  const { row } = show();
  await ready();
  // Wherever the focus is: here it is on a button in the dialog's footer, as it is after a click on it.
  const body = screen.getByRole("button", { name: "Overwrite" });
  goTo(1);
  fireEvent.keyDown(body, { key: "i" });
  goTo(2);
  fireEvent.keyDown(body, { key: "o" });
  expect(status()).toContain("In 0:01.0 · Out 0:02.0");
  fireEvent.keyDown(body, { key: "," });
  expect(row()).toEqual([[0, 60, 0, "a"], [60, 30, 30, "z"], [90, 60, 100, "a"]]);
  fireEvent.keyDown(body, { key: "." });
  expect(row()).toEqual([[0, 60, 0, "a"], [60, 30, 30, "z"], [90, 30, 30, "z"], [120, 30, 130, "a"]]);
  // With Ctrl or Cmd held they are the browser's or the editor's, not the monitor's.
  fireEvent.keyDown(body, { key: ",", metaKey: true });
  expect(row()).toHaveLength(4);
});

it("an image has a length to show for and no marks", async () => {
  const still = assetView({ id: "i", kind: "image", name: "logo", durationMs: null, previewFileId: null, previewStatus: "none", originalFileId: "orig-i" });
  const { row, read } = show({ asset: still, playhead: 120 });
  await waitFor(() => expect(screen.getByRole("img", { name: "logo" })).toBeTruthy());
  expect(read).toEqual(["orig-i"]);
  expect(screen.queryByRole("button", { name: "Mark In" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Shows for (seconds)"), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
  expect(row().at(-1)).toEqual([120, 60, 0, "i"]);
});

it("goes on the track picked, or on a new one when the project has none for it", async () => {
  const song = assetView({ id: "s", kind: "audio", name: "theme", durationMs: 8_000, previewFileId: null, previewStatus: "none", originalFileId: "orig-s" });
  const none = project();
  none.tracks = none.tracks.filter((t) => t.kind !== "audio");
  const { store } = show({ asset: song, doc: none });
  await ready();
  const track = screen.getByRole("combobox", { name: "Track" }) as HTMLSelectElement;
  expect([[...track.options].map((o) => o.text), track.disabled]).toEqual([["A new track"], true]);
  fireEvent.click(screen.getByRole("button", { name: "Overwrite" }));
  const made = store.getState().doc.tracks.find((t) => t.kind === "audio")!;
  expect([made.name, made.clips.map((c) => [c.start, c.duration])]).toEqual(["Audio 1", [[60, 240]]]);
  // Now the menu names it.
  expect([...(screen.getByRole("combobox", { name: "Track" }) as HTMLSelectElement).options].map((o) => o.text)).toEqual(["Audio 1"]);
});

it("says so when the file can't be read, and leaves Insert and Overwrite off for that and for a viewer", async () => {
  const gone = show({ readable: false });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This file couldn't be read here."));
  expect(["Insert", "Overwrite"].map((name) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled)).toEqual([true, true]);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(gone.onClose).toHaveBeenCalledTimes(1);
  cleanup();
  const viewer = show({ canEdit: false });
  await ready();
  expect(["Insert", "Overwrite"].map((name) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled)).toEqual([true, true]);
  fireEvent.keyDown(document.body, { key: "." });
  expect(viewer.store.getState().doc).toEqual(project());
});

it("leaves the keys alone while a field is typed in, and lets go of them when it closes", async () => {
  const { row, store } = show();
  await ready();
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Track" }), { key: "." });
  expect(row()).toHaveLength(2);
  cleanup();
  fireEvent.keyDown(document.body, { key: "." });
  expect(store.getState().doc).toEqual(project());
});
