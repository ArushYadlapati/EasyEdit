// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider, useExportDeps } from "@/components/editor/context";
import { browserExportDeps, exportMediaDeps } from "@/components/editor/export/browser-deps";
import type { ExportDeps } from "@/components/editor/export/deps";
import { downloadBlob } from "@/components/editor/export/download";
import { MediaProvider } from "@/components/editor/media/media-context";
import { collectPageFonts } from "@/components/editor/page-fonts";
import { canEncodeAac } from "@/lib/export/aac";
import { gatherMedia } from "@/lib/export/gather-media";
import { MEMORY_LIMIT_BYTES } from "@/lib/export/sinks";
import { checkSupport } from "@/lib/export/support";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { render } from "../helpers/dom";
import { assetView, pretendMediaServices, unreachableLibrary } from "../helpers/media-services";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as { locks?: unknown }).locks; // a test that fails half-way leaves no lock manager behind
});

const deps = () => browserExportDeps(pretendMediaServices([]));

const fileHandle = () => ({
  name: "My video.mp4",
  createWritable: async () => ({ write: async () => {}, close: async () => {}, abort: async () => {} }),
  getFile: async () => ({ size: 0 }),
});

it("asks where to save with the suggested name, and reports the name the person chose", async () => {
  const picker = vi.fn(async () => fileHandle());
  vi.stubGlobal("showSaveFilePicker", picker);
  const picked = await deps().pickTarget("Qual recap.mp4");
  expect(picker).toHaveBeenCalledWith({
    suggestedName: "Qual recap.mp4", id: "easyedit-export", startIn: "videos",
    types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
  });
  expect(picked).toMatchObject({ fileName: "My video.mp4", held: null, target: { limit: null } });
  expect(deps().savesToFile).toBe(true);
});

it("asks for another click when the save dialog cannot open, and returns nothing when the person closes it", async () => {
  vi.stubGlobal("showSaveFilePicker", async () => { throw new DOMException("closed", "AbortError"); });
  expect(await deps().pickTarget("Qual recap.mp4")).toBeNull();
  for (const name of ["SecurityError", "NotAllowedError"]) {
    vi.stubGlobal("showSaveFilePicker", async () => { throw new DOMException("no", name); });
    expect(await deps().pickTarget("Qual recap.mp4"), name).toBe("again");
  }
});

it("holds the bytes when there is no save dialog, and leaves saving them to a click", async () => {
  vi.stubGlobal("showSaveFilePicker", undefined);
  const urls = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:made");
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  const made = deps();
  expect(made.savesToFile).toBe(false);
  const picked = await made.pickTarget("Qual recap.mp4");
  if (picked === null || picked === "again" || picked.held === null) throw new Error("no held target");
  expect([picked.fileName, picked.target.limit, picked.held()]).toEqual(["Qual recap.mp4", MEMORY_LIMIT_BYTES, null]);
  const sink = await picked.target.open();
  await sink.write(0, new Uint8Array([1, 2]));
  await sink.close();
  const blob = picked.held();
  expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([1, 2]);
  expect(names).toEqual([]); // nothing downloads by itself, long after the click
  made.download(blob!, "Qual recap.mp4");
  expect(names).toEqual(["Qual recap.mp4"]);
  expect(urls).toHaveBeenCalledTimes(1);
});

it("says no where the browser has no video encoder", async () => {
  expect(deps().supportProbe.hasVideoEncoder).toBe(false); // happy-dom has none
  expect(await checkSupport(deps().supportProbe, { width: 1080, height: 1920, fps: 30 })).toEqual({ browser: false, sizes: {}, audio: false });
  expect(await deps().supportProbe.canEncodeAudio()).toBe(false);
});

it("holds a lock of its own for as long as the export runs, and copes without Web Locks", async () => {
  expect(() => deps().keepRunning()()).not.toThrow(); // happy-dom's navigator.locks is null
  const granted: (() => Promise<unknown>)[] = [];
  const request = vi.fn((_name: string, work: () => Promise<unknown>) => { granted.push(work); return Promise.resolve(); });
  Object.defineProperty(navigator, "locks", { value: { request }, configurable: true });
  const first = deps().keepRunning();
  const second = deps().keepRunning();
  const [[a], [b]] = request.mock.calls;
  expect(a).toMatch(/^easyedit-export-/);
  expect(b).not.toBe(a); // two tabs' exports each hold a lock
  first(); // let go before the lock is granted
  await expect(granted[0]()).resolves.toBeUndefined(); // granted later: it ends at once
  const held = granted[1]();
  let over = false;
  void held.then(() => { over = true; });
  await Promise.resolve();
  expect(over).toBe(false);
  second();
  await held;
  expect(over).toBe(true);
});

it("starts the export worker from its module file", () => {
  const started: { url: URL; options: WorkerOptions }[] = [];
  vi.stubGlobal(
    "Worker",
    class {
      constructor(url: URL, options: WorkerOptions) {
        started.push({ url, options });
      }
    },
  );
  deps().createWorker();
  expect(started).toHaveLength(1);
  expect(started[0].url.pathname).toMatch(/\/src\/workers\/export\.worker\.ts$/); // Vitest's worker transform adds a query
  expect(started[0].options).toEqual({ type: "module" });
});

it("reads media through the editor's library and files", async () => {
  const services = pretendMediaServices([assetView()]);
  const blob = new Blob(["prev-a"]);
  services.files = { get: async (fileId) => (fileId === "prev-a" ? { ok: true, blob } : { ok: false, problem: "missing" }), put: async () => {} };
  const media = exportMediaDeps(services);
  expect(media.library().assets.a).toEqual(assetView());
  await expect(media.ensure(["a"])).resolves.toBeUndefined(); // already known: nothing is asked of the server
  expect(await media.readFile("prev-a")).toBe(blob);
  expect(await media.readFile("orig-x")).toBeNull();
});

it("an asset the server could not be asked about stops the export, and is not drawn as missing", async () => {
  const services = { ...pretendMediaServices([]), library: unreachableLibrary() };
  const read = gatherMedia(sampleDoc(), exportMediaDeps(services), { signal: new AbortController().signal, onReading: () => {}, sound: false });
  await expect(read).rejects.toMatchObject({ name: "ExportError", code: "media", detail: "a" });
});

it("useExportDeps gives the provider's deps, or the browser's, made once for the editor's media", () => {
  const seen: ExportDeps[] = [];
  function Probe() {
    seen.push(useExportDeps());
    return null;
  }
  const store = makeStore();
  const given = deps();
  const { rerender } = render(<EditorProvider store={store} exportDeps={given}><Probe /></EditorProvider>);
  expect(seen.at(-1)).toBe(given);
  const services = pretendMediaServices([]);
  const shell = <EditorProvider store={store}><MediaProvider services={services}><Probe /></MediaProvider></EditorProvider>;
  rerender(shell);
  const made = seen.at(-1);
  rerender(<EditorProvider store={store}><MediaProvider services={services}><Probe /></MediaProvider></EditorProvider>);
  expect(made).not.toBe(given);
  expect(seen.at(-1)).toBe(made);
});

// Beyond the brief's tests: each one below fails when one of browser-deps' rules is taken out.

it("opens the save dialog inside the click, before anything is awaited", () => {
  const picker = vi.fn(() => new Promise<never>(() => {}));
  vi.stubGlobal("showSaveFilePicker", picker);
  void deps().pickTarget("Qual recap.mp4");
  expect(picker).toHaveBeenCalledTimes(1);
});

it("reads what this browser has, and asks its encoders with the export's settings", async () => {
  const asked: unknown[] = [];
  const answers = (supported: unknown) => ({ isConfigSupported: async (config: unknown) => (asked.push(config), { supported }) });
  vi.stubGlobal("Worker", class {});
  vi.stubGlobal("OffscreenCanvas", undefined);
  vi.stubGlobal("VideoEncoder", answers(true));
  expect(deps().supportProbe).toMatchObject({ hasWorkers: true, hasOffscreenCanvas: false, hasVideoEncoder: false }); // no VideoFrame
  vi.stubGlobal("Worker", undefined);
  vi.stubGlobal("OffscreenCanvas", class {});
  vi.stubGlobal("VideoFrame", class {});
  const probe = deps().supportProbe;
  expect(probe).toMatchObject({ hasWorkers: false, hasOffscreenCanvas: true, hasVideoEncoder: true });
  const config = { codec: "avc1.640028", width: 1080, height: 1920, bitrate: 8_000_000, framerate: 30, hardwareAcceleration: "no-preference", latencyMode: "quality", avc: { format: "avc" } } as const;
  expect(await probe.canEncode(config)).toBe(true);
  expect(asked).toEqual([config]);
  vi.stubGlobal("VideoEncoder", answers(undefined));
  expect(await probe.canEncode(config)).toBe(false);
  vi.stubGlobal("VideoEncoder", { isConfigSupported: async () => { throw new TypeError("bad config"); } });
  expect(await probe.canEncode(config)).toBe(false);
  expect(probe.canEncodeAudio).toBe(canEncodeAac);
});

it("hands a held file to the browser at its own address, and lets the address go a minute later", () => {
  vi.useFakeTimers();
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:made");
  const revoked = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const links: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { links.push(this.href); });
  downloadBlob(new Blob(["x"]), "Qual recap.mp4");
  expect(links).toEqual(["blob:made"]);
  vi.advanceTimersByTime(59_999);
  expect(revoked).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revoked).toHaveBeenCalledWith("blob:made");
});

it("names only the assets that got no answer", async () => {
  const library = unreachableLibrary();
  library.setState({ assets: { a: assetView() } });
  const media = exportMediaDeps({ ...pretendMediaServices([]), library });
  await expect(media.ensure(["a", "b", "c"])).rejects.toMatchObject({ name: "ExportError", code: "media", detail: "b,c" });
});

it("takes fonts from the page, media through the editor's library, and time from the page's clock", async () => {
  const made = browserExportDeps({ ...pretendMediaServices([]), library: unreachableLibrary() });
  expect(made.collectFonts).toBe(collectPageFonts);
  const read = made.collectMedia(sampleDoc(), { signal: new AbortController().signal, onReading: () => {}, sound: false });
  await expect(read).rejects.toMatchObject({ code: "media", detail: "a" });
  vi.spyOn(performance, "now").mockReturnValue(1234);
  expect(made.now()).toBe(1234);
});
