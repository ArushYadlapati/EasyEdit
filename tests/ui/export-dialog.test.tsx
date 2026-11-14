// @vitest-environment happy-dom
import { useEffect } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import type { ExportDeps, PickedTarget } from "@/components/editor/export/deps";
import { useExport, type Exporter } from "@/components/editor/export/use-export";
import { ExportError } from "@/lib/export/messages";
import { memoryTarget } from "@/lib/export/sinks";
import { createEmptyDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, text } from "../editor/fixtures";
import { NO_MEDIA, type FakeWorker } from "../export/fakes";
import { act, cleanup, fireEvent, render, screen } from "../helpers/dom";
import { assetView } from "../helpers/media-services";
import { fakeExportDeps } from "./export-fakes";
import { click, dialog, emit, flush, openDialog, show, startExport } from "./export-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SUPPORTED = { hasWorkers: true, hasOffscreenCanvas: true, hasVideoEncoder: true, canEncodeAudio: async () => true };
const SOUND = "Sound isn't exported yet. The file's sound track is silent.";
const COPIES = "Video clips export from their 720p preview copies.";
const TOO_LONG = "This video is too long to export in this browser. Use Chrome or Edge, or pick the draft size.";

it("shows what will be made, then reads the media, exports, counts frames and names the saved file", async () => {
  const { store, workers, target, picked } = show();
  const d = await openDialog();
  expect(d.getByRole("combobox").textContent).toBe("Same as project (1080 × 1920)Draft (720 × 1280)");
  for (const fact of ["1080 × 1920", "30 fps", "0:04:00", "Up to about 4.1 MB", "MP4, H.264 video", COPIES, SOUND]) expect(d.getByText(fact)).toBeTruthy();

  await click("Export video");
  expect(picked).toEqual(["Qual recap.mp4"]);
  expect(store.getState().exporting).toBe(true);
  const start = workers[0].posted[0];
  expect(start).toMatchObject({
    type: "start",
    job: {
      video: { width: 1080, height: 1920, fps: 30, codec: "avc1.640028", bitrate: 8_000_000 }, acceleration: "no-preference",
      media: { clips: { c1: { fileId: "prev-a" }, c2: { fileId: "prev-a" } } },
    },
  });
  expect(start.type === "start" && Object.keys(start.job.media.files)).toEqual(["prev-a"]);
  await emit(workers[0], { type: "progress", framesDone: 60, totalFrames: 120 });
  expect(d.getByText("Frame 60 of 120")).toBeTruthy();
  expect(d.getByRole("progressbar").getAttribute("value")).toBe("60");
  expect(d.getByRole("progressbar").getAttribute("max")).toBe("120");

  await emit(workers[0], { type: "done", bytes: 1_234_567, hasAudio: true });
  expect(d.getByRole("status").textContent).toContain("Saved Qual recap.mp4");
  expect(d.getByRole("status").textContent).toContain("1.2 MB");
  expect(d.queryByText(/The project changed/)).toBeNull();
  expect(d.queryByText("This file has no sound track.")).toBeNull();
  expect([workers[0].terminated, target.sinks[0].closed, store.getState().exporting]).toEqual([1, 1, false]);
  await click("Done");
  expect(screen.queryByText("Export", { selector: "h2" })).toBeNull();
});

it("exports the size that was picked, under a name that says so", async () => {
  const { workers, picked } = show();
  const d = await openDialog();
  await act(async () => { fireEvent.change(d.getByRole("combobox"), { target: { value: "draft" } }); });
  for (const fact of ["720 × 1280", "Up to about 1.3 MB"]) expect(d.getByText(fact)).toBeTruthy();
  expect(d.queryByText(COPIES)).toBeNull(); // a draft is no larger than the preview copies
  await click("Export video");
  expect(picked).toEqual(["Qual recap (draft).mp4"]);
  expect(workers[0].posted[0]).toMatchObject({ job: { video: { width: 720, height: 1280, codec: "avc1.64001f", bitrate: 2_500_000 } } });
});

it("turns off a size this computer cannot encode and starts on one it can", async () => {
  show({ supportProbe: { ...SUPPORTED, canEncode: async (config) => config.width < 1000 } });
  const select = (await openDialog()).getByRole("combobox") as HTMLSelectElement;
  expect([...select.querySelectorAll("option")].map((o) => [o.textContent, o.disabled])).toEqual([
    ["Same as project (1080 × 1920) (not supported on this computer)", true], ["Draft (720 × 1280)", false],
  ]);
  expect(select.value).toBe("draft");
});

it("says so, and offers nothing, in a browser that cannot export", async () => {
  show({ supportProbe: { ...SUPPORTED, hasVideoEncoder: false, canEncode: async () => true } });
  const d = await openDialog();
  expect(d.getByText("This browser can't export video. Use a recent version of Chrome or Edge on a computer.")).toBeTruthy();
  expect(d.queryByRole("button", { name: "Export video" })).toBeNull();
});

it("does not export an empty project", async () => {
  show({}, { doc: createEmptyDoc("short_9x16") });
  const d = await openDialog();
  expect(d.getByText("This project is empty. Add a clip, then export.")).toBeTruthy();
  expect((d.getByRole("button", { name: "Export video" }) as HTMLButtonElement).disabled).toBe(true);
});

it("waits for media that is not ready, says why, and checks again when the library changes", async () => {
  const { media } = show({}, { assets: [assetView({ previewStatus: "pending" })] });
  const d = await openDialog();
  const reason = "2 clips use media that is still uploading or being prepared. Export once it's ready.";
  expect(d.getByText(reason)).toBeTruthy();
  expect((d.getByRole("button", { name: "Export video" }) as HTMLButtonElement).disabled).toBe(true);
  act(() => media.library.getState().put(assetView()));
  expect(d.queryByText(reason)).toBeNull();
  expect((d.getByRole("button", { name: "Export video" }) as HTMLButtonElement).disabled).toBe(false);
});

it("exports removed media as the preview's placeholder, and says how many clips do", async () => {
  const { workers } = show({}, { assets: [assetView({ removed: true })] });
  const d = await openDialog();
  expect(d.getByText("2 clips have no media to show, so they export as the placeholders in the preview.")).toBeTruthy();
  await click("Export video");
  expect(workers[0].posted[0]).toMatchObject({ job: { media: { files: {}, clips: { c1: { label: "Media removed" }, c2: { label: "Media removed" } } } } });
});

it("exports with the sound plan this browser can write", async () => {
  for (const audio of [true, false]) {
    const seen: boolean[] = [];
    show({
      supportProbe: { ...SUPPORTED, canEncode: async () => true, canEncodeAudio: async () => audio },
      collectMedia: async (_doc, options) => { seen.push(options.sound); return NO_MEDIA; },
    });
    await openDialog();
    await click("Export video");
    expect(seen).toEqual([audio]);
    cleanup();
  }
});

it("says it is reading the media before the frames start", async () => {
  let release = () => {};
  const { workers } = show({}, {
    readFile: (fileId) => new Promise((resolve) => { release = () => resolve({ ok: true, blob: new File([fileId], fileId) }); }),
  });
  const d = await startExport();
  expect(d.getByText("Reading media: 0 of 1")).toBeTruthy();
  expect(workers).toEqual([]);
  await act(async () => { release(); });
  await flush();
  expect(d.getByText("Reading media: 1 of 1")).toBeTruthy();
  await emit(workers[0], { type: "progress", framesDone: 10, totalFrames: 120 });
  expect(d.getByText("Frame 10 of 120")).toBeTruthy();
});

it("stops in plain words when a media file cannot be read", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const { workers, target, store } = show({}, { readFile: async () => ({ ok: false, problem: "offline" }) });
  const d = await startExport();
  expect(d.getByRole("alert").textContent).toBe("A media file couldn't be read, so the export was stopped. Check your connection and try again.");
  expect(logged).toHaveBeenCalledWith("Export failed:", "media", "prev-a");
  expect([workers.length, target.sinks[0].aborted, store.getState().exporting]).toEqual([0, 1, false]);
});

it("does nothing when the save dialog is closed without a choice", async () => {
  const { store, workers } = show({ pickTarget: async () => null });
  const d = await startExport();
  expect(workers).toEqual([]);
  expect(store.getState().exporting).toBe(false);
  expect(d.getByRole("button", { name: "Export video" })).toBeTruthy();
});

it("Cancel stops the worker, discards the bytes and goes back to the choices", async () => {
  const { store, workers, target } = show();
  const d = await startExport();
  await emit(workers[0], { type: "progress", framesDone: 10, totalFrames: 120 });
  await click("Cancel");
  expect(workers[0].terminated).toBe(1);
  expect(target.sinks[0]).toMatchObject({ closed: 0, aborted: 1 });
  expect(target.discarded).toBe(1);
  expect(store.getState().exporting).toBe(false);
  expect(d.getByText("Export canceled.")).toBeTruthy();
  expect(d.getByRole("button", { name: "Export video" })).toBeTruthy();
});

it("Cancel while the media is read goes back to the choices at once", async () => {
  const { store, workers } = show({}, { readFile: () => new Promise(() => {}) }); // a read that never ends
  const d = await startExport();
  expect(d.getByText("Reading media: 0 of 1")).toBeTruthy();
  await click("Cancel");
  expect(d.getByText("Export canceled.")).toBeTruthy();
  expect([store.getState().exporting, workers.length]).toEqual([false, 0]);
});

it("asks where to save inside the click, once, however often it is clicked", async () => {
  let answer: (picked: PickedTarget | null) => void = () => {};
  const asked: string[] = [];
  const { workers, target } = show({ pickTarget: (name) => { asked.push(name); return new Promise((resolve) => { answer = resolve; }); } });
  const d = await openDialog();
  const button = d.getByRole("button", { name: "Export video" });
  act(() => { fireEvent.click(button); }); // no await: the save dialog must already have been asked for
  expect(asked).toEqual(["Qual recap.mp4"]);
  act(() => { fireEvent.click(button); }); // a double-click
  await act(async () => { answer({ target, fileName: "Qual recap.mp4", held: null }); });
  await flush();
  expect([asked.length, workers.length]).toEqual([1, 1]);
});

it("asks for a second click when the save dialog could not open from the first", async () => {
  const answers: ("again" | null)[] = ["again", null];
  const { store, workers } = show({ pickTarget: async () => answers.shift() ?? null });
  const d = await openDialog();
  await click("Export video");
  expect(d.getByRole("alert").textContent).toBe("Click Export video again to choose where to save.");
  expect([workers.length, store.getState().exporting]).toEqual([0, false]);
  await click("Export video"); // the person closes the save dialog this time
  expect(d.queryByRole("alert")).toBeNull();
});

it("starts nothing when the editor closes while the save dialog is open", async () => {
  let answer: (picked: PickedTarget | null) => void = () => {};
  const keepRunning = vi.fn(() => () => {});
  const { store, workers, target, view } = show({ keepRunning, pickTarget: () => new Promise((resolve) => { answer = resolve; }) });
  await startExport();
  view.unmount();
  await act(async () => { answer({ target, fileName: "Qual recap.mp4", held: null }); });
  await flush();
  expect([workers.length, store.getState().exporting, target.sinks.length, keepRunning.mock.calls.length]).toEqual([0, false, 0, 0]);
});

it("holds the tab's lock for as long as the export runs, and lets it go at every end", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const ends: [string, (worker: FakeWorker) => Promise<void>][] = [
    ["done", (worker) => emit(worker, { type: "done", bytes: 1, hasAudio: true })],
    ["failed", (worker) => emit(worker, { type: "failed", code: "font", detail: "" })],
    ["canceled", () => click("Cancel")],
  ];
  for (const [name, end] of ends) {
    const release = vi.fn();
    const keepRunning = vi.fn(() => release);
    const { workers, view } = show({ keepRunning });
    await startExport();
    expect([keepRunning.mock.calls.length, release.mock.calls.length], name).toEqual([1, 0]);
    await end(workers[0]);
    expect(release, name).toHaveBeenCalledTimes(1);
    view.unmount();
  }
  const release = vi.fn();
  const left = show({ keepRunning: () => release });
  await startExport();
  left.view.unmount(); // leaving the editor
  await flush();
  expect(release).toHaveBeenCalledTimes(1);
  const keepRunning = vi.fn(() => () => {});
  show({ keepRunning, pickTarget: async () => null });
  await startExport();
  expect(keepRunning).not.toHaveBeenCalled();
});

it("shows each step before the frames: checking this browser, then preparing", async () => {
  let supported = () => {};
  const gate = new Promise<void>((resolve) => { supported = resolve; });
  show({
    supportProbe: { ...SUPPORTED, canEncode: async () => { await gate; return true; } },
    collectFonts: () => new Promise(() => {}), // fonts that never finish loading
  });
  const d = await openDialog();
  expect(d.getByText("Checking this browser…")).toBeTruthy();
  expect(d.queryByRole("button", { name: "Export video" })).toBeNull();
  await act(async () => { supported(); });
  await flush();
  await click("Export video");
  expect(d.getByText("Preparing…")).toBeTruthy();
  expect(d.getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it("checks this browser each time the dialog opens, at the project's size then", async () => {
  const canEncode = vi.fn(async () => true);
  show({ supportProbe: { ...SUPPORTED, canEncode } });
  await openDialog();
  expect(canEncode).toHaveBeenCalledTimes(2); // Same as project, then Draft
  await click("Close");
  await openDialog();
  expect(canEncode).toHaveBeenCalledTimes(4);
});

it("waits for the media library before it offers Export video", async () => {
  show({}, { loaded: false, assets: [] });
  const d = await openDialog();
  expect(d.getByText("Checking the media library…")).toBeTruthy();
  expect((d.getByRole("button", { name: "Export video" }) as HTMLButtonElement).disabled).toBe(true);
});

it("says the file will have no sound track where this browser cannot encode AAC", async () => {
  show({ supportProbe: { ...SUPPORTED, canEncode: async () => true, canEncodeAudio: async () => false } });
  const d = await openDialog();
  expect(d.getByText("Sound isn't exported yet. This file will have no sound track.")).toBeTruthy();
  expect(d.queryByText(SOUND)).toBeNull();
});

it("says up front when a video is too long to hold in a browser without a save dialog", async () => {
  const long = createEmptyDoc("short_9x16");
  long.tracks[1].clips = [text("a", 0, 36_000)]; // 20 minutes: about 1.2 GB at full size, about 394 MB as a draft
  show({ savesToFile: false }, { doc: long });
  const d = await openDialog();
  expect(d.getByText(TOO_LONG)).toBeTruthy();
  expect((d.getByRole("button", { name: "Export video" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { fireEvent.change(d.getByRole("combobox"), { target: { value: "draft" } }); });
  expect(d.queryByText(TOO_LONG)).toBeNull();
  expect((d.getByRole("button", { name: "Export video" }) as HTMLButtonElement).disabled).toBe(false);
});

it("holds the file when there is no save dialog, and saves it only when Download is clicked", async () => {
  let saved: Blob | null = null;
  const target = memoryTarget((blob) => { saved = blob; });
  const { workers, download } = show({ savesToFile: false, pickTarget: async (name) => ({ target, fileName: name, held: () => saved }) });
  const d = await startExport();
  await emit(workers[0], { type: "chunk", seq: 0, position: 0, data: new Uint8Array([1, 2]) });
  await emit(workers[0], { type: "done", bytes: 2, hasAudio: true });
  expect(d.getByRole("status").textContent).toContain("Your video is ready.");
  expect(download).not.toHaveBeenCalled(); // not minutes after the click, with nobody there
  await click("Download");
  expect(download).toHaveBeenCalledWith(saved, "Qual recap.mp4");
  await click("Done");
  expect(screen.queryByText("Export", { selector: "h2" })).toBeNull();
});

it("counts frames with thousands separated, and offers no Cancel once every frame is in", async () => {
  const { workers } = show();
  const d = await startExport();
  await emit(workers[0], { type: "progress", framesDone: 1000, totalFrames: 1800 });
  expect(d.getByText("Frame 1,000 of 1,800")).toBeTruthy();
  await emit(workers[0], { type: "progress", framesDone: 1800, totalFrames: 1800 });
  expect(d.getByText("Finishing…")).toBeTruthy();
  expect(d.queryByRole("button", { name: "Cancel" })).toBeNull();
});

it("shows a failure in plain words and lets the person try again", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const { store, workers, target } = show();
  const d = await startExport();
  await emit(workers[0], { type: "failed", code: "font-mismatch", detail: '700 100px "Geist"' });
  expect(d.getByRole("alert").textContent).toBe("Text would not look the same as in the preview, so the export was stopped. Reload the page and try again.");
  expect(logged).toHaveBeenCalledWith("Export failed:", "font-mismatch", '700 100px "Geist"');
  expect([target.sinks[0].aborted, store.getState().exporting]).toEqual([1, false]);
  await click("Try again");
  expect(d.getByRole("button", { name: "Export video" })).toBeTruthy();
});

it("says when it is trying again with the slower encoder", async () => {
  const { workers } = show();
  const d = await startExport();
  await emit(workers[0], { type: "failed", code: "encoder", detail: "x" });
  await emit(workers[1], { type: "progress", framesDone: 10, totalFrames: 120 });
  expect(d.getByText("Trying again with a slower encoder.")).toBeTruthy();
  expect(d.getByText("Frame 10 of 120")).toBeTruthy();
});

it("offers Cancel and says it is trying again as soon as a second try begins, even after every frame was in", async () => {
  const { workers } = show();
  const d = await startExport();
  await emit(workers[0], { type: "progress", framesDone: 120, totalFrames: 120 });
  expect(d.queryByRole("button", { name: "Cancel" })).toBeNull();
  await emit(workers[0], { type: "failed", code: "encoder", detail: "x" });
  expect(workers).toHaveLength(2);
  expect(d.getByText("Frame 0 of 120")).toBeTruthy();
  expect(d.getByText("Trying again with a slower encoder.")).toBeTruthy();
  expect(d.getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it("shows the time left once a second has passed, then that it is finishing", async () => {
  let clock = 0;
  const { workers } = show({ now: () => clock });
  const d = await startExport();
  await emit(workers[0], { type: "progress", framesDone: 1, totalFrames: 120 });
  expect(d.queryByText(/left$/)).toBeNull();
  clock = 3_000;
  await emit(workers[0], { type: "progress", framesDone: 30, totalFrames: 120 });
  expect(d.getByText("About 10 seconds left")).toBeTruthy();
  await emit(workers[0], { type: "progress", framesDone: 120, totalFrames: 120 });
  expect(d.getByText("Finishing…")).toBeTruthy();
});

it("an edit made during the export does not reach the file, and the result says so", async () => {
  const { store, workers } = show();
  const d = await startExport();
  act(() => {
    store.getState().edit([{ op: "remove_clip", clipId: "x1" }], "delete");
  });
  const start = workers[0].posted[0];
  expect(start.type === "start" && start.job.doc).toEqual(sampleDoc()); // the worker has the project as it was
  await emit(workers[0], { type: "done", bytes: 1_000, hasAudio: false });
  expect(d.getByText("The project changed while this was exporting. The file shows it as it was when the export started.")).toBeTruthy();
  expect(d.getByText("This file has no sound track.")).toBeTruthy();
});

it("a safe area changed during the export is no change to the file", async () => {
  const { store, workers } = show();
  const d = await startExport();
  act(() => {
    store.getState().edit([{ op: "set_safe_area", format: "short_9x16", size: { width: 0.8, height: 0.5 } }], "safe area");
  });
  expect(store.getState().doc.safeAreas).toEqual({ short_9x16: { width: 0.8, height: 0.5 } });
  await emit(workers[0], { type: "done", bytes: 1_000, hasAudio: true });
  expect(d.queryByText(/The project changed/)).toBeNull();
});

it("exports the edits not yet sent: the file is the project as the editor shows it", async () => {
  const { store, workers } = show();
  act(() => {
    store.getState().edit([{ op: "remove_clip", clipId: "x2" }], "delete");
  });
  expect(store.getState().queue).toHaveLength(1);
  await startExport();
  const start = workers[0].posted[0];
  const doc = start.type === "start" ? start.job.doc : null;
  expect(doc).toEqual(store.getState().doc);
  expect(doc).not.toEqual(sampleDoc());
});

it("exports the project as last made: a drag in progress is not in the file", async () => {
  const { store, workers } = show();
  act(() => {
    store.getState().setGesture([{ op: "move_clip", clipId: "x2", start: 95 }]);
  });
  await startExport();
  const start = workers[0].posted[0];
  expect(start.type === "start" && start.job.doc).toEqual(sampleDoc());
});

it("keeps exporting when the dialog is closed, and shows the progress in the top bar", async () => {
  const { workers } = show();
  expect(screen.getByRole("button", { name: "Export" }).className).toContain("bg-ed-accent"); // the primary action's color
  await startExport();
  await emit(workers[0], { type: "progress", framesDone: 60, totalFrames: 120 });
  await click("Close");
  expect(workers[0].terminated).toBe(0);
  expect(screen.getByRole("button", { name: "Exporting 50%" }).className).not.toContain("bg-ed-accent");
  await click("Exporting 50%"); // the top bar's button, which opens the dialog again
  expect(dialog().getByText("Frame 60 of 120")).toBeTruthy();
});

it("progress draws nothing else of the editor again, and the top bar only when its percentage changes", async () => {
  const { workers, renders } = show();
  await startExport();
  await click("Close");
  await emit(workers[0], { type: "progress", framesDone: 60, totalFrames: 1200 });
  const before = renders();
  for (const framesDone of [61, 62, 63]) await emit(workers[0], { type: "progress", framesDone, totalFrames: 1200 }); // still 5%
  expect(renders()).toBe(before);
  await emit(workers[0], { type: "progress", framesDone: 600, totalFrames: 1200 });
  expect(renders()).toBeGreaterThan(before);
  expect(screen.getByRole("button", { name: "Exporting 50%" })).toBeTruthy();
});

it("a project deleted during an export keeps the way back to its progress and Cancel", async () => {
  const { store } = show();
  await startExport();
  await click("Close");
  act(() => store.getState().setStatus("deleted"));
  expect((screen.getByRole("button", { name: "Exporting 0%" }) as HTMLButtonElement).disabled).toBe(false);
  await click("Exporting 0%");
  expect(dialog().getByRole("button", { name: "Cancel" })).toBeTruthy();
});

it("leaving the editor cancels the export", async () => {
  const { store, workers, target, view } = show();
  await startExport();
  view.unmount();
  await flush();
  expect(workers[0].terminated).toBe(1);
  expect(target.sinks[0]).toMatchObject({ closed: 0, aborted: 1 });
  expect(target.discarded).toBe(1);
  expect(store.getState().exporting).toBe(false);
});

// Beyond the brief: rules the tests above leave uncaught.

it("offers only the sizes it asked this browser about, and asks again at the new size when it opens", async () => {
  const { store } = show();
  const d = await openDialog();
  act(() => {
    store.getState().edit([{ op: "set_format", format: "long_4k" }], "format");
  });
  expect(d.getByRole("combobox").textContent).toBe("Same as project (3840 × 2160)Draft (1280 × 720)");
  await click("Close");
  const again = await openDialog();
  expect(again.getByRole("combobox").textContent).toBe("Same as project (3840 × 2160)1080p (1920 × 1080)Draft (1280 × 720)");
});

it("is off for a deleted project with no export running, and is no edit control: a viewer exports too", async () => {
  const { store, workers } = show({}, { canEdit: false });
  const button = screen.getByRole("button", { name: "Export" }) as HTMLButtonElement;
  expect([button.disabled, button.hasAttribute("data-edit-control")]).toEqual([false, false]);
  const d = await openDialog();
  expect(d.queryAllByRole("button").filter((b) => b.hasAttribute("data-edit-control"))).toEqual([]);
  expect(d.getByRole("combobox").hasAttribute("data-edit-control")).toBe(false);
  await click("Export video");
  expect(workers).toHaveLength(1);
  expect(d.getByRole("button", { name: "Cancel" }).hasAttribute("data-edit-control")).toBe(false);
  await click("Cancel");
  await click("Close");
  act(() => store.getState().setStatus("deleted"));
  expect((screen.getByRole("button", { name: "Export" }) as HTMLButtonElement).disabled).toBe(true);
});

it("tells its caller how each export ended, and lets a held file go once reset or the editor closes", async () => {
  const onFinish = vi.fn();
  let saved: Blob | null = null;
  const target = memoryTarget((blob) => { saved = blob; });
  const made = fakeExportDeps({ savesToFile: false, pickTarget: async (name) => ({ target, fileName: name, held: () => saved }) });
  let exporter: Exporter | null = null;
  function Harness() {
    const made = useExport({ onFinish });
    useEffect(() => { exporter = made; });
    return null;
  }
  const view = render(<EditorProvider store={makeStore()} exportDeps={made.deps}><Harness /></EditorProvider>);
  const finishHeld = async (worker: number) => {
    await act(async () => { void exporter!.start("project", true); });
    await flush();
    await emit(made.workers[worker], { type: "chunk", seq: 0, position: 0, data: new Uint8Array([1, 2]) });
    await emit(made.workers[worker], { type: "done", bytes: 2, hasAudio: true });
  };
  await finishHeld(0);
  expect(onFinish).toHaveBeenLastCalledWith(expect.objectContaining({ status: "done", bytes: 2 }), "Qual recap.mp4", true);
  act(() => exporter!.download());
  expect(made.download).toHaveBeenCalledTimes(1);
  act(() => exporter!.reset());
  act(() => exporter!.download());
  expect(made.download).toHaveBeenCalledTimes(1);

  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => { void exporter!.start("draft", true); });
  await flush();
  await emit(made.workers[1], { type: "failed", code: "font", detail: "" });
  expect(onFinish).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", code: "font" }), "Qual recap (draft).mp4", false);
  act(() => exporter!.reset());

  await finishHeld(2);
  view.unmount();
  exporter!.download();
  expect(made.download).toHaveBeenCalledTimes(1);
});

it("shows no earlier answer while it asks this browser again", async () => {
  let gate = Promise.resolve();
  show({ supportProbe: { ...SUPPORTED, canEncode: async () => { await gate; return true; } } });
  await openDialog();
  await click("Close");
  let answer = () => {};
  gate = new Promise<void>((resolve) => { answer = resolve; });
  const d = await openDialog();
  expect(d.getByText("Checking this browser…")).toBeTruthy();
  await act(async () => { answer(); });
  await flush();
  expect(d.getByRole("button", { name: "Export video" })).toBeTruthy();
});

it("lets a long video through where it is saved to a file as it is made", async () => {
  const long = createEmptyDoc("short_9x16");
  long.tracks[1].clips = [text("a", 0, 36_000)];
  show({}, { doc: long });
  const d = await openDialog();
  expect(d.queryByText(TOO_LONG)).toBeNull();
  expect((d.getByRole("button", { name: "Export video" }) as HTMLButtonElement).disabled).toBe(false);
});

it("Done goes back to the choices for the next export", async () => {
  const { workers } = show();
  await startExport();
  await emit(workers[0], { type: "done", bytes: 1, hasAudio: true });
  await click("Done");
  const d = await openDialog();
  expect(d.getByRole("button", { name: "Export video" })).toBeTruthy();
});

it("counts the time left from the first frame's moment, and the top bar the whole percent done", async () => {
  let clock = 1_000;
  const { workers } = show({ now: () => clock });
  const d = await startExport();
  await emit(workers[0], { type: "progress", framesDone: 1, totalFrames: 120 });
  clock = 4_000;
  await emit(workers[0], { type: "progress", framesDone: 30, totalFrames: 120 });
  expect(d.getByText("About 10 seconds left")).toBeTruthy();
  await emit(workers[0], { type: "progress", framesDone: 1_199, totalFrames: 2_000 });
  expect(screen.getByRole("button", { name: "Exporting 59%" })).toBeTruthy();
});

it("takes the request for another click away as soon as the person clicks again", async () => {
  const answers: Promise<"again" | null>[] = [Promise.resolve("again"), new Promise(() => {})]; // the second dialog stays open
  show({ pickTarget: () => answers.shift() ?? Promise.resolve(null) });
  const d = await openDialog();
  await click("Export video");
  expect(d.getByRole("alert")).toBeTruthy();
  await click("Export video");
  expect(d.queryByRole("alert")).toBeNull();
});

it("saves the frame under the playhead as an image, at the chosen size", async () => {
  const { store, saveFrame } = show();
  act(() => store.getState().seek(45));
  const d = await openDialog();
  await click("Save frame as image");
  expect(saveFrame).toHaveBeenLastCalledWith(sampleDoc(), 45, { width: 1080, height: 1920 }, "Qual recap frame 000045.png");
  act(() => store.getState().seek(120)); // the end of the project: the last frame is 119
  await act(async () => { fireEvent.change(d.getByRole("combobox"), { target: { value: "draft" } }); });
  await click("Save frame as image");
  expect(saveFrame).toHaveBeenLastCalledWith(sampleDoc(), 119, { width: 720, height: 1280 }, "Qual recap frame 000119.png");
});

it("says why a frame could not be saved, without speaking of an export", async () => {
  const cases = [
    [new ExportError("font", ""), "A font didn't load, so the frame wasn't saved. Check your connection, reload the page and try again."],
    [new ExportError("decode", "prev-a"), "A video clip couldn't be decoded in this browser, so the frame wasn't saved."],
    [new Error("odd"), "The frame couldn't be saved. Try again."],
  ] as const;
  for (const [error, text] of cases) {
    const { view } = show({ saveFrame: async () => { throw error; } });
    const d = await openDialog();
    await click("Save frame as image");
    expect(d.getByRole("alert").textContent).toBe(text);
    view.unmount();
  }
});

it("saves one frame at a time: a second click while a save runs does nothing", async () => {
  let finish: () => void = () => {};
  const save = vi.fn<ExportDeps["saveFrame"]>(() => new Promise<void>((resolve) => { finish = resolve; }));
  show({ saveFrame: save });
  const d = await openDialog();
  const button = () => d.getByRole("button", { name: "Save frame as image" }) as HTMLButtonElement;
  await act(async () => { fireEvent.click(button()); fireEvent.click(button()); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(button().disabled).toBe(true);
  await act(async () => { finish(); });
  await flush();
  expect(button().disabled).toBe(false);
  await click("Save frame as image");
  expect(save).toHaveBeenCalledTimes(2);
});

it("the second click of a double-click never starts what replaced the first", async () => {
  const first = show();
  let d = await startExport();
  await act(async () => { fireEvent.click(d.getByRole("button", { name: "Cancel" }), { detail: 1 }); });
  await flush();
  await act(async () => { fireEvent.click(d.getByRole("button", { name: "Export video" }), { detail: 2 }); });
  await flush();
  expect([first.picked, first.workers.length]).toEqual([["Qual recap.mp4"], 1]); // no second save dialog
  const save = d.getByRole("button", { name: "Save frame as image" });
  await act(async () => { fireEvent.click(save, { detail: 1 }); });
  await flush();
  await act(async () => { fireEvent.click(save, { detail: 2 }); });
  expect(first.saveFrame).toHaveBeenCalledTimes(1);
  first.view.unmount();

  let saved: Blob | null = null;
  const memory = memoryTarget((blob) => { saved = blob; });
  const held = show({ savesToFile: false, pickTarget: async (name) => ({ target: memory, fileName: name, held: () => saved }) });
  d = await startExport();
  await emit(held.workers[0], { type: "done", bytes: 1, hasAudio: true });
  const download = d.getByRole("button", { name: "Download" });
  await act(async () => { fireEvent.click(download, { detail: 1 }); fireEvent.click(download, { detail: 2 }); });
  expect(held.download).toHaveBeenCalledTimes(1);
});

it("cannot save a frame while media is not ready, or of an empty project", async () => {
  const waiting = show({}, { assets: [assetView({ status: "uploading" })] });
  const d = await openDialog();
  expect((d.getByRole("button", { name: "Save frame as image" }) as HTMLButtonElement).disabled).toBe(true);
  waiting.view.unmount();
  show({}, { doc: createEmptyDoc("short_9x16") });
  const empty = await openDialog();
  expect((empty.getByRole("button", { name: "Save frame as image" }) as HTMLButtonElement).disabled).toBe(true);
});

// Beyond the brief: rules the tests above do not catch when they are removed.
it("keeps Save frame quiet beside Export video, on for a video too long to hold, its sentence gone at the next click", async () => {
  const long = createEmptyDoc("short_9x16");
  long.tracks[1].clips = [text("a", 0, 36_000)];
  let saves = 0; // the first save fails, the second never ends
  show({ savesToFile: false, saveFrame: () => (++saves === 1 ? Promise.reject(new ExportError("font", "")) : new Promise(() => {})) }, { doc: long });
  const d = await openDialog();
  const footer = d.getByRole("button", { name: "Export video" }).parentElement!;
  expect([...footer.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Save frame as image", "Export video"]);
  const save = d.getByRole("button", { name: "Save frame as image" }) as HTMLButtonElement;
  expect(save.className).toContain("border-transparent");
  expect(save.className).not.toContain("bg-ed-accent");
  expect(d.getByText(TOO_LONG)).toBeTruthy();
  expect(save.disabled).toBe(false);
  await click("Save frame as image");
  expect(d.getByRole("alert")).toBeTruthy();
  await click("Save frame as image");
  expect(d.queryByRole("alert")).toBeNull();
});
