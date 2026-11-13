// @vitest-environment happy-dom
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { EditorShell } from "@/components/editor/editor-shell";
import { createMediaServices, type MediaServices } from "@/components/editor/media/media-context";
import { browserThumbnailDeps } from "@/components/editor/thumbnail-deps";
import { formatTimecode } from "@/lib/editor/geometry";
import { DEFAULT_KEYMAP, KEYMAP_KEY, formatKeymap, setKeys, setOff } from "@/lib/editor/keymap";
import { DEFAULT_LAYOUT } from "@/lib/editor/layout";
import { createMediaDrop, type MediaDrop } from "@/lib/editor/media-drop";
import { DEFAULT_PREFS, createSettingsStore, type SettingsStore } from "@/lib/editor/settings";
import type { ThumbnailCanvas, ThumbnailDeps } from "@/lib/editor/thumbnail";
import { startThumbnailTrigger } from "@/lib/editor/thumbnail-trigger";
import type { EditorInit } from "@/lib/editor/types";
import type { MediaApi } from "@/lib/media/api";
import { createLibraryStore, type RefreshReason } from "@/lib/media/library-store";
import type { UploadItem } from "@/lib/media/types";
import type { UploadQueue } from "@/lib/media/upload-queue";
import { sampleDoc } from "../editor/fixtures";
import { dragEvent } from "../helpers/drag-events";
import { act, fireEvent, render, screen } from "../helpers/dom";
import { happyDOM } from "../helpers/layout";
import { assetView } from "../helpers/media-services";
import { fakeCtx } from "../render/fake-ctx";

// The existing tests get the real services; a test of the media wiring hands the shell its own for one render.
vi.mock("@/components/editor/media/media-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/editor/media/media-context")>();
  return { ...real, createMediaServices: vi.fn(real.createMediaServices) };
});
// The real drop, wrapped so a test can reach the one the shell made, and the store it was given.
vi.mock("@/lib/editor/media-drop", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/editor/media-drop")>();
  return { ...real, createMediaDrop: vi.fn(real.createMediaDrop) };
});
// The real settings store, wrapped so a test can read the one the shell made.
vi.mock("@/lib/editor/settings", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/editor/settings")>();
  return { ...real, createSettingsStore: vi.fn(real.createSettingsStore) };
});
// The real thumbnail trigger and page deps, wrapped so a test can read what the shell gave them or hand it its own.
vi.mock("@/lib/editor/thumbnail-trigger", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/editor/thumbnail-trigger")>();
  return { ...real, startThumbnailTrigger: vi.fn(real.startThumbnailTrigger) };
});
vi.mock("@/components/editor/thumbnail-deps", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/editor/thumbnail-deps")>();
  return { ...real, browserThumbnailDeps: vi.fn(real.browserThumbnailDeps) };
});

const EDITOR_URL = "http://localhost:3000/editor/p1";
const PREFS_TEXT = () => document.cookie.split("; ").find((c) => c.startsWith("easyedit-prefs="));
// happy-dom keeps a cookie set with max-age=0, empty; a date in the past removes it.
const expireCookies = () => {
  happyDOM().setURL(EDITOR_URL);
  for (const name of ["easyedit-prefs", "easyedit-layout"]) document.cookie = `${name}=; path=/editor; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
};

const initial = (): EditorInit => ({ projectId: "p1", name: "Qual recap", doc: sampleDoc(), version: 5, me: { id: "u1", name: "Ada" }, canEdit: true });

// The projects API as the shell's fetch sees it. While `hold` is on, each post waits for release().
function stubServer() {
  const requests: string[] = [];
  const waiting: (() => void)[] = [];
  let version = 5;
  const server = {
    requests,
    hold: false,
    posts: () => requests.filter((r) => r.startsWith("POST")).length,
    versionChecks: () => requests.filter((r) => r.endsWith("/version")).length,
    release() {
      server.hold = false;
      waiting.splice(0).forEach((answer) => answer());
    },
  };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url}`);
    if (method === "POST") {
      const answer = () => Response.json({ version: ++version, ops: [], inverse: [] });
      return server.hold ? new Promise<Response>((resolve) => waiting.push(() => resolve(answer()))) : answer();
    }
    if (url.endsWith("/version")) return Response.json({ version });
    return Response.json({ version, entries: [], hasMore: false });
  });
  return server;
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const after = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const addTitle = (name = "Add title") => act(() => fireEvent.click(screen.getByRole("button", { name })));
const unloadListeners = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([type]) => type === "beforeunload").length;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Back to the real functions, with no calls kept: every test renders the shell.
  vi.mocked(startThumbnailTrigger).mockReset();
  vi.mocked(browserThumbnailDeps).mockReset();
  expireCookies();
  localStorage.clear();
});

it("asks before the page unloads only while edits are unsent", async () => {
  const server = stubServer();
  const added = vi.spyOn(window, "addEventListener");
  const removed = vi.spyOn(window, "removeEventListener");
  render(<EditorShell initial={initial()} />);
  expect(unloadListeners(added)).toBe(0);

  server.hold = true;
  await addTitle();
  expect(unloadListeners(added)).toBe(1);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);

  server.release();
  await flush();
  expect(server.posts()).toBe(1);
  expect(unloadListeners(removed)).toBe(1);
  const later = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(later);
  expect(later.defaultPrevented).toBe(false);
});

it("leaving the editor with edits still queued sends them all, then stops", async () => {
  const server = stubServer();
  const { unmount } = render(<EditorShell initial={initial()} />);
  server.hold = true;
  await addTitle();
  await addTitle("Add subtitle");
  expect(server.posts()).toBe(1); // the first is in flight, the second waits
  unmount(); // "Projects" or the Back button: a navigation inside the app
  server.release();
  await flush();
  expect(server.posts()).toBe(2);
  const sent = server.requests.length;
  await after(120_000);
  expect(server.requests).toHaveLength(sent); // and no more polling
});

it("under strict mode one sync runs", async () => {
  const server = stubServer();
  render(
    <StrictMode>
      <EditorShell initial={initial()} />
    </StrictMode>,
  );
  await addTitle();
  await flush();
  expect(server.posts()).toBe(1);
  await after(2000);
  expect(server.versionChecks()).toBe(1);
});

// Media services that write down what the shell asks of them: a real library store over routes that answer an
// empty library, with its refresh and ensure wrapped, a queue that records calls, and files that never arrive.
// A promise that has failed, and writes down whether anyone took its failure.
const handled: boolean[] = [];
function failed(): Promise<void> {
  const promise = Promise.reject(new Error("broke"));
  const at = handled.push(false) - 1;
  const then = promise.then.bind(promise);
  promise.then = ((onFulfilled, onRejected) => {
    if (onRejected) handled[at] = true;
    return then(onFulfilled, onRejected);
  }) as typeof promise.then;
  return promise;
}

function pretendMedia(options: { refreshFails?: boolean } = {}) {
  const fails = async (): Promise<never> => {
    throw new Error("not called in these tests");
  };
  const api: MediaApi = {
    list: vi.fn(async () => ({ ok: true as const, assets: [], setUp: true })),
    open: fails, offset: fails, complete: fails, openFile: fails, completeFile: fails, previewFailed: fails,
    update: fails, remove: fails, readToken: fails,
  };
  const library = createLibraryStore({ api });
  const { refresh: realRefresh, ensure: realEnsure } = library.getState();
  // The spies only write calls down. The promise goes back from a plain function: a spy would itself handle a rejection.
  const refresh = vi.fn<(reason: RefreshReason) => void>();
  const ensure = vi.fn<(ids: string[]) => void>();
  library.setState({
    refresh: (reason) => (refresh(reason), options.refreshFails ? failed() : realRefresh(reason)),
    ensure: (ids) => (ensure(ids), options.refreshFails ? failed() : realEnsure(ids)),
  });
  let active = 0;
  const queue = {
    add: vi.fn(() => ["k1"]), cancel: vi.fn(), retry: vi.fn(), resume: vi.fn(), dismiss: vi.fn(), stop: vi.fn(),
    items: () => [],
    active: vi.fn(() => active),
  } satisfies UploadQueue;
  const services: MediaServices = { library, queue, files: { get: () => new Promise(() => {}), put: async () => {} }, dispose: vi.fn() };
  vi.mocked(createMediaServices).mockReturnValueOnce(services);
  return { api, library, refresh, ensure, queue, services, setActive: (n: number) => void (active = n) };
}

const reasons = (refresh: { mock: { calls: [RefreshReason][] } }) => refresh.mock.calls.map(([reason]) => reason);
const uploading: UploadItem = {
  key: "k1", fileName: "climb.mov", sizeBytes: 20_000_000, durationMs: null, stage: "uploading", sentBytes: 8_000_000, previewFraction: 0,
  assetId: "x1", message: null, canRetry: false,
};

it("loads the library when the editor opens, on focus and on the timer", async () => {
  stubServer();
  const media = pretendMedia();
  const { unmount } = render(<EditorShell initial={initial()} />);
  await flush();
  expect(reasons(media.refresh)).toEqual(["open"]);
  await act(() => void window.dispatchEvent(new Event("focus")));
  expect(reasons(media.refresh)).toEqual(["open", "focus"]);
  await after(30_000);
  expect(reasons(media.refresh)).toEqual(["open", "focus", "timer"]);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await after(30_000);
  expect(reasons(media.refresh)).toEqual(["open", "focus", "timer"]);
  visibility.mockReturnValue("visible");
  await after(30_000);
  expect(reasons(media.refresh)).toEqual(["open", "focus", "timer", "timer"]);
  unmount();
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  await after(60_000);
  expect(reasons(media.refresh)).toEqual(["open", "focus", "timer", "timer"]);
  expect(media.queue.resume).toHaveBeenCalledTimes(1); // the focus before unmount
  expect(media.ensure).toHaveBeenCalledTimes(1);
});

it("the Media tab uses the editor's own services", async () => {
  stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  await act(() => void fireEvent.click(screen.getByRole("tab", { name: "Media" })));
  await flush();
  expect(reasons(media.refresh)).toEqual(["open", "tab"]);
});

it("takes up stopped uploads when the connection returns and on focus", async () => {
  stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  expect(media.queue.resume).not.toHaveBeenCalled();
  await act(() => void window.dispatchEvent(new Event("online")));
  expect(media.queue.resume).toHaveBeenCalledTimes(1);
  await act(() => void window.dispatchEvent(new Event("focus")));
  expect(media.queue.resume).toHaveBeenCalledTimes(2);
});

it("asks the library for the assets the project names", async () => {
  stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  expect(media.ensure.mock.calls).toEqual([[["a"]]]);
  await addTitle();
  expect(media.ensure.mock.calls.length).toBeGreaterThan(1);
  expect(media.ensure).toHaveBeenLastCalledWith(["a"]);
  const calls = media.ensure.mock.calls.length;
  await act(() => void media.library.getState().setQuery("x")); // not a change of the document
  await act(() => void fireEvent.keyDown(document.body, { key: "ArrowRight" })); // the playhead moves; the document does not
  await flush();
  expect(media.ensure).toHaveBeenCalledTimes(calls);
});

it("asks before the page unloads while an upload is running", async () => {
  stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  media.setActive(1);
  await act(() => void media.library.getState().setUploads([uploading]));
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);

  media.setActive(0);
  await act(() => void media.library.getState().setUploads([]));
  const later = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(later);
  expect(later.defaultPrevented).toBe(false);
});

it("leaving the editor stops uploads and removes nothing", async () => {
  stubServer();
  const media = pretendMedia();
  const { unmount } = render(<EditorShell initial={initial()} />);
  await flush();
  expect(media.services.dispose).not.toHaveBeenCalled();
  unmount();
  expect(media.services.dispose).toHaveBeenCalledTimes(1);
  expect(media.queue.cancel).not.toHaveBeenCalled();
  // The shell listens to the library no longer: an upload list told now adds no guard to the page.
  media.setActive(1);
  media.library.getState().setUploads([uploading]);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
});

// The upload of climb.mov (key k1, as the pretend queue names every file) is in, and its asset ready: 2 s long.
const landUpload = (media: ReturnType<typeof pretendMedia>) =>
  act(() => {
    media.library.getState().setUploads([{ ...uploading, stage: "done", sentBytes: uploading.sizeBytes, durationMs: 2_000 }]);
    media.library.getState().put(assetView({ id: "x1", name: "climb", fileName: "climb.mov", durationMs: 2_000 }));
  });
const climbClips = () => screen.queryAllByRole("button", { name: /^Video clip "climb"/ });

it("a file dropped on the timeline is uploaded and placed; one dropped on the inspector goes only to the library", async () => {
  const server = stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  // The timeline's own drop: at its scroller, the drop area's first child.
  const scroller = timelineDrop().firstElementChild!;
  const climb = [new File(["x"], "climb.mov", { lastModified: 1 })];
  const over = dragEvent("dragover", FILES);
  expect(fireEvent(scroller, over)).toBe(false);
  expect((over as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("copy");
  expect(fireEvent(scroller, dragEvent("drop", { files: climb }))).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(1);
  expect(media.queue.add).toHaveBeenCalledWith(climb);
  expect(climbClips()).toEqual([]);
  await landUpload(media);
  await flush();
  expect(climbClips()).toHaveLength(1);
  expect(climbClips()[0].getAttribute("aria-pressed")).not.toBe("true"); // landed, not selected
  expect(server.posts()).toBe(1);

  // On the inspector: to the library only.
  const details = screen.getByRole("complementary", { name: "Details" });
  expect(fireEvent(details, dragEvent("drop", { files: [new File(["y"], "b.mov")] }))).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(2);
  await flush();
  expect(server.posts()).toBe(1);
  expect(climbClips()).toHaveLength(1);

  const timeline = screen.getByRole("region", { name: "Timeline" });
  const files = [new File(["x"], "a.mov", { lastModified: 1 })];
  const carryingFiles = { dataTransfer: { types: ["Files"], files } };
  // On the timeline's frame outside its scrolling area: to the library only. false: the default is prevented, so the
  // browser does not open the file in place of the editor.
  expect(fireEvent.dragOver(timeline, carryingFiles)).toBe(false);
  expect(fireEvent.drop(timeline, carryingFiles)).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(3);
  expect(media.queue.add).toHaveBeenLastCalledWith(files);
  await flush();
  expect(server.posts()).toBe(1);
  // A drag of text or of something on the page is left to the browser.
  const carryingText = { dataTransfer: { types: ["text/plain"], files: [] } };
  expect(fireEvent.dragOver(timeline, carryingText)).toBe(true);
  expect(fireEvent.drop(timeline, carryingText)).toBe(true);
  expect(fireEvent.dragOver(scroller, carryingText)).toBe(true);
  expect(fireEvent.drop(scroller, carryingText)).toBe(true);
  expect(media.queue.add).toHaveBeenCalledTimes(3);

  await act(() => void fireEvent.click(screen.getByRole("tab", { name: "Media" })));
  await flush();
  expect(fireEvent.drop(screen.getByRole("tabpanel", { name: "Media" }), carryingFiles)).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(4);
  expect(media.queue.add).toHaveBeenLastCalledWith(files);
});

const selectedTab = () => screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true")?.textContent;
const timelineDrop = () => screen.getByRole("region", { name: "Timeline" }).querySelector<HTMLElement>("[data-drop]")!;
const FILES = { types: ["Files"] };

it("a file dragged over the preview opens the Media tab, shows its drop text and lights the timeline", async () => {
  stubServer();
  pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  expect(selectedTab()).toBe("Text");
  expect(timelineDrop().dataset.drop).toBe("idle");
  const preview = screen.getByRole("main", { name: "Preview" });
  await act(() => void fireEvent(preview, dragEvent("dragenter", FILES)));
  expect(selectedTab()).toBe("Media");
  expect(screen.getByText("Drop to upload")).toBeTruthy();
  expect(timelineDrop().dataset.drop).toBe("armed");
  const glow = timelineDrop().lastElementChild!;
  expect(glow.classList.contains("bg-ed-accent-weak/50")).toBe(true);
  expect(glow.classList.contains("pointer-events-none")).toBe(true);
  // The panel edges let the drag through to what is under them.
  for (const edge of screen.getAllByRole("separator")) expect(edge.classList.contains("pointer-events-none")).toBe(true);

  await act(() => void fireEvent(preview, dragEvent("drop", { files: [new File(["x"], "a.mov")] })));
  expect(screen.queryByText("Drop to upload")).toBeNull();
  expect(selectedTab()).toBe("Media");
  expect(timelineDrop().dataset.drop).toBe("idle");
  for (const edge of screen.getAllByRole("separator")) expect(edge.classList.contains("pointer-events-none")).toBe(false);
});

it("without uploads set up the tab still switches and the timeline stays dark", async () => {
  stubServer();
  const media = pretendMedia();
  vi.mocked(media.api.list).mockImplementation(async () => ({ ok: true as const, assets: [], setUp: false }));
  render(<EditorShell initial={initial()} />);
  await flush();
  expect(media.library.getState().setUp).toBe(false);
  await act(() => void fireEvent(screen.getByRole("main", { name: "Preview" }), dragEvent("dragenter", FILES)));
  await flush();
  expect(selectedTab()).toBe("Media");
  expect(screen.queryByText("Drop to upload")).toBeNull();
  expect(timelineDrop().dataset.drop).toBe("idle");
});

it("a file dropped on the inspector goes to the library only", async () => {
  const server = stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  const details = screen.getByRole("complementary", { name: "Details" });
  const over = dragEvent("dragover", FILES);
  expect(fireEvent(details, over)).toBe(false);
  expect((over as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("copy");
  const files = [new File(["x"], "a.mov"), new File(["y"], "b.jpg")];
  expect(fireEvent(details, dragEvent("drop", { files }))).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(1);
  expect(media.queue.add).toHaveBeenCalledWith(files);
  await flush();
  expect(server.posts()).toBe(0); // nothing was added to the timeline
});

it("a file dropped on the top row goes to the library only", async () => {
  const server = stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  const banner = screen.getByRole("banner");
  const over = dragEvent("dragover", FILES);
  expect(fireEvent(banner, over)).toBe(false);
  expect((over as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("copy");
  const files = [new File(["x"], "a.mov")];
  expect(fireEvent(banner, dragEvent("drop", { files }))).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(1);
  expect(media.queue.add).toHaveBeenCalledWith(files);  await flush();
  expect(server.posts()).toBe(0);
});

it("a viewer gets none of it", async () => {
  stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={{ ...initial(), canEdit: false }} />);
  await flush();
  const preview = screen.getByRole("main", { name: "Preview" });
  await act(() => void fireEvent(preview, dragEvent("dragenter", FILES)));
  expect(selectedTab()).toBe("Text");
  expect(timelineDrop().dataset.drop).toBe("idle");
  for (const edge of screen.getAllByRole("separator")) expect(edge.classList.contains("pointer-events-none")).toBe(false);
  const over = dragEvent("dragover", FILES);
  expect(fireEvent(preview, over)).toBe(false); // the file still never opens in the window
  expect((over as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("none");
  expect(fireEvent(preview, dragEvent("drop", { files: [new File(["x"], "a.mov")] }))).toBe(false);
  expect(media.queue.add).not.toHaveBeenCalled();
});

it("with a dialog open or without uploads set up, a file dropped on the inspector is refused", async () => {
  stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  const details = screen.getByRole("complementary", { name: "Details" });
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  try {
    const over = dragEvent("dragover", FILES);
    expect(fireEvent(details, over)).toBe(false);
    expect((over as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("none");
    expect(fireEvent(details, dragEvent("drop", { files: [new File(["x"], "a.mov")] }))).toBe(false);
    expect(media.queue.add).not.toHaveBeenCalled();
  } finally {
    dialog.remove();
  }

  act(() => media.library.setState({ setUp: false }));
  const notSetUp = dragEvent("dragover", FILES);
  expect(fireEvent(details, notSetUp)).toBe(false);
  expect((notSetUp as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("none");
  expect(fireEvent(details, dragEvent("drop", { files: [new File(["x"], "a.mov")] }))).toBe(false);
  expect(media.queue.add).not.toHaveBeenCalled();
});

it("under StrictMode, a file over the window still opens the Media tab", async () => {
  stubServer();
  pretendMedia();
  render(
    <StrictMode>
      <EditorShell initial={initial()} />
    </StrictMode>,
  );
  await flush();
  await act(() => void fireEvent(screen.getByRole("main", { name: "Preview" }), dragEvent("dragenter", FILES)));
  expect(selectedTab()).toBe("Media");
  expect(screen.getByText("Drop to upload")).toBeTruthy();
  expect(timelineDrop().dataset.drop).toBe("armed");
});

it("under StrictMode, a file dropped on the timeline still lands once its upload is in", async () => {
  const server = stubServer();
  const media = pretendMedia();
  render(
    <StrictMode>
      <EditorShell initial={initial()} />
    </StrictMode>,
  );
  await flush();
  const scroller = timelineDrop().firstElementChild!;
  fireEvent(scroller, dragEvent("dragover", FILES));
  expect(fireEvent(scroller, dragEvent("drop", { files: [new File(["x"], "climb.mov")] }))).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(1);
  await landUpload(media);
  await flush();
  expect(climbClips()).toHaveLength(1);
  expect(server.posts()).toBe(1);
});

const shellDrop = () => {
  const made = vi.mocked(createMediaDrop).mock;
  return { drop: made.results.at(-1)!.value as MediaDrop, store: made.calls.at(-1)![0].store };
};

it("losing edit access mid-drag turns the drop look off", async () => {
  stubServer();
  pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  await act(() => void fireEvent(screen.getByRole("main", { name: "Preview" }), dragEvent("dragenter", FILES)));
  expect(timelineDrop().dataset.drop).toBe("armed");
  const { drop, store } = shellDrop();
  act(() => store.getState().revokeEditing());
  expect(drop.state.getState().incoming).toBe(null);
  expect(timelineDrop().dataset.drop).toBe("idle");
  expect(screen.queryByText("Drop to upload")).toBeNull();
});

it("a deleted project takes no drag", async () => {
  stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  const { drop, store } = shellDrop();
  act(() => store.getState().setStatus("deleted"));
  await act(() => void fireEvent(document.body, dragEvent("dragenter", FILES)));
  expect(drop.state.getState().incoming).toBe(null);
  const over = dragEvent("dragover", FILES);
  expect(fireEvent(document.body, over)).toBe(false);
  expect((over as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("none");
  expect(fireEvent(document.body, dragEvent("drop", { files: [new File(["x"], "a.mov")] }))).toBe(false);
  expect(media.queue.add).not.toHaveBeenCalled();
});

const boardDrop = () => document.querySelector<HTMLElement>("[data-board]")!.parentElement!;
const placeholderTexts = () =>
  [...screen.getByRole("region", { name: "Timeline" }).querySelectorAll("[data-upload-placeholder]")].map((p) => p.textContent);

it("a file dropped on the transport goes only to the library", async () => {
  const server = stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  const transport = screen.getByRole("button", { name: /^Go to start/ });
  const over = dragEvent("dragover", FILES);
  expect(fireEvent(transport, over)).toBe(false);
  expect((over as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("copy");
  const files = [new File(["x"], "climb.mov")];
  expect(fireEvent(transport, dragEvent("drop", { files }))).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(1);
  expect(media.queue.add).toHaveBeenCalledWith(files);
  act(() => media.library.getState().setUploads([uploading]));
  await flush();
  expect(placeholderTexts()).toEqual([]);
  await landUpload(media);
  await flush();
  expect(climbClips()).toEqual([]);
  expect(server.posts()).toBe(0);
});

it("the timeline shows a placeholder for a board drop", async () => {
  const server = stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={initial()} />);
  await flush();
  const { store } = shellDrop();
  act(() => store.getState().seek(60));
  const over = dragEvent("dragover", FILES);
  expect(fireEvent(boardDrop(), over)).toBe(false);
  expect((over as unknown as { dataTransfer: DataTransfer }).dataTransfer.dropEffect).toBe("copy");
  expect(fireEvent(boardDrop(), dragEvent("drop", { files: [new File(["x"], "climb.mov")] }))).toBe(false);
  expect(media.queue.add).toHaveBeenCalledTimes(1);
  act(() => media.library.getState().setUploads([uploading])); // 40% sent
  await flush();
  expect(placeholderTexts()).toEqual(["climb.mov · Uploading 40%"]);
  await landUpload(media);
  await flush();
  expect(placeholderTexts()).toEqual([]);
  expect(climbClips()).toHaveLength(1);
  const landed = store.getState().doc.tracks.find((t) => t.id === "v1")!.clips.find((c) => c.type === "video" && c.assetId === "x1");
  expect(landed).toMatchObject({ start: 60, duration: 60 });
  expect(server.posts()).toBe(1);
});

it("leaving the editor stops watching drags", async () => {
  stubServer();
  pretendMedia();
  const removed = vi.spyOn(window, "removeEventListener");
  const { unmount } = render(<EditorShell initial={initial()} />);
  await flush();
  unmount();
  const watched = removed.mock.calls.filter(([type, , options]) => type === "dragenter" && options === true);
  expect(watched).toHaveLength(1);
});

it("a refresh or ensure that fails leaves no rejection unhandled", async () => {
  stubServer();
  handled.length = 0;
  const media = pretendMedia({ refreshFails: true });
  const { unmount } = render(<EditorShell initial={initial()} />);
  await flush();
  await act(() => void window.dispatchEvent(new Event("focus")));
  await after(30_000);
  await addTitle();
  await after(10);
  unmount();
  expect(reasons(media.refresh)).toEqual(["open", "focus", "timer"]);
  expect(media.ensure.mock.calls.length).toBeGreaterThan(1);
  expect(handled.length).toBe(media.refresh.mock.calls.length + media.ensure.mock.calls.length);
  expect(handled.every(Boolean)).toBe(true);
});

it("the real services ask the media routes once on open, and nothing after the editor is left", async () => {
  const server = stubServer();
  const { unmount } = render(<EditorShell initial={initial()} />);
  await flush();
  const media = () => server.requests.filter((r) => r.includes("/api/media"));
  expect(media()).toEqual(["GET /api/media", "GET /api/media?ids=a"]);
  unmount();
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("online"));
  await after(120_000);
  expect(media()).toEqual(["GET /api/media", "GET /api/media?ids=a"]);
});

it("starts from the panel sizes the page read, and keeps a new size in the browser's cookie", () => {
  stubServer();
  happyDOM().setURL("http://localhost:3000/editor/p1");
  render(<EditorShell initial={initial()} layout={{ left: 300, right: 240, timeline: 400 }} />);
  const left = screen.getByRole("separator", { name: "Left panel width" });
  expect(left.parentElement!.style.getPropertyValue("--ed-left-w")).toBe("300px");
  fireEvent.keyDown(left, { key: "ArrowLeft" });
  expect(document.cookie).toContain("easyedit-layout=284_240_400");
});

const pressed = (name: string) => screen.getByRole("button", { name }).getAttribute("aria-pressed");
const leftWidth = () => screen.getByRole("separator", { name: "Left panel width" }).parentElement!.style.getPropertyValue("--ed-left-w");
const shellSettings = () => vi.mocked(createSettingsStore).mock.results[0].value as SettingsStore;

it("snapping and safe zones are remembered in this browser", () => {
  stubServer();
  happyDOM().setURL(EDITOR_URL);
  const first = render(<EditorShell initial={initial()} />);
  expect(PREFS_TEXT()).toBeUndefined(); // nothing is written until something changes
  fireEvent.click(screen.getByRole("button", { name: "Safe zones" }));
  expect(document.cookie).toContain("sz:0");
  expect(PREFS_TEXT()).toBe("easyedit-prefs=u:px.sz:0.sn:1.z:fill.st:30.tx:30");
  fireEvent.click(screen.getByRole("button", { name: "Snap" }));
  expect(PREFS_TEXT()).toBe("easyedit-prefs=u:px.sz:0.sn:0.z:fill.st:30.tx:30");
  first.unmount();

  // The page read the cookie: the store starts from it. With no newer cookie the page's values stand.
  expireCookies();
  render(<EditorShell initial={initial()} prefs={{ ...DEFAULT_PREFS, snapping: false }} />);
  expect(pressed("Snap")).toBe("false");
  expect(pressed("Safe zones")).toBe("true");
  expect(PREFS_TEXT()).toBeUndefined();
});

it("a change in Settings is kept with the snapping and safe zones of the moment", () => {
  stubServer();
  happyDOM().setURL(EDITOR_URL);
  vi.mocked(createSettingsStore).mockClear();
  render(<EditorShell initial={initial()} prefs={{ ...DEFAULT_PREFS, safeZones: false }} />);
  act(() => shellSettings().getState().set({ units: "in", stillSeconds: 4.5 }));
  expect(PREFS_TEXT()).toBe("easyedit-prefs=u:in.sz:0.sn:1.z:fill.st:45.tx:30");
  act(() => shellSettings().getState().set({ lockAspect: false }));
  expect(PREFS_TEXT()).toBe("easyedit-prefs=u:in.sz:0.sn:1.z:fill.st:45.tx:30");
});

it("the editor's controls read the lengths the page gave", async () => {
  stubServer();
  render(<EditorShell initial={initial()} prefs={{ ...DEFAULT_PREFS, textSeconds: 5 }} />);
  await addTitle();
  const fps = sampleDoc().fps;
  expect(screen.getByRole("button", { name: `Text clip "Your title", ${formatTimecode(0, fps)} to ${formatTimecode(5 * fps, fps)}` })).toBeTruthy();
});

it("a newer cookie wins over the page's props after mount", () => {
  stubServer();
  happyDOM().setURL(EDITOR_URL);
  document.cookie = "easyedit-prefs=u:cm.sz:1.sn:0.z:fill.st:30.tx:30; path=/editor";
  document.cookie = "easyedit-layout=300_240_; path=/editor";
  vi.mocked(createSettingsStore).mockClear();
  const written = vi.spyOn(document, "cookie", "set");
  render(<EditorShell initial={initial()} prefs={DEFAULT_PREFS} layout={DEFAULT_LAYOUT} />);
  expect(shellSettings().getState().units).toBe("cm");
  expect(pressed("Snap")).toBe("false");
  expect(leftWidth()).toBe("300px");
  // Nothing was saved by taking the cookie's values.
  expect(written).not.toHaveBeenCalled();
  written.mockRestore();
  expect(PREFS_TEXT()).toBe("easyedit-prefs=u:cm.sz:1.sn:0.z:fill.st:30.tx:30");
  expect(document.cookie).toContain("easyedit-layout=300_240_");
  // A later toggle saves the cookie's other values with it.
  fireEvent.click(screen.getByRole("button", { name: "Snap" }));
  expect(PREFS_TEXT()).toBe("easyedit-prefs=u:cm.sz:1.sn:1.z:fill.st:30.tx:30");
});

it("after a newer layout cookie, going back to the page's size is saved", () => {
  stubServer();
  happyDOM().setURL(EDITOR_URL);
  document.cookie = "easyedit-layout=300_240_; path=/editor";
  render(<EditorShell initial={initial()} layout={{ left: 284, right: 240, timeline: null }} />);
  expect(leftWidth()).toBe("300px");
  fireEvent.keyDown(screen.getByRole("separator", { name: "Left panel width" }), { key: "ArrowLeft" });
  expect(leftWidth()).toBe("284px");
  expect(document.cookie).toContain("easyedit-layout=284_240_");
});

it("the keymap kept in this browser is loaded after mount, and a change is kept", () => {
  stubServer();
  // Stored in another order than the editor writes it, so a write would show.
  const raw = JSON.stringify({ off: ["split"], v: 1 });
  localStorage.setItem(KEYMAP_KEY, raw);
  vi.mocked(createSettingsStore).mockClear();
  render(<EditorShell initial={initial()} />);
  expect(shellSettings().getState().keymap).toEqual(setOff(DEFAULT_KEYMAP, "split", true));
  expect(localStorage.getItem(KEYMAP_KEY)).toBe(raw);
  act(() => shellSettings().getState().setKeymap(DEFAULT_KEYMAP));
  expect(localStorage.getItem(KEYMAP_KEY)).toBe(formatKeymap(DEFAULT_KEYMAP));
});

it("under strict mode the keymap and a newer cookie are taken once, and nothing is saved", () => {
  stubServer();
  happyDOM().setURL(EDITOR_URL);
  document.cookie = "easyedit-prefs=u:in.sz:0.sn:1.z:50.st:30.tx:30; path=/editor";
  localStorage.setItem(KEYMAP_KEY, JSON.stringify({ off: ["split"], v: 1 }));
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  vi.mocked(createSettingsStore).mockClear();
  render(
    <StrictMode>
      <EditorShell initial={initial()} />
    </StrictMode>,
  );
  expect(pressed("Safe zones")).toBe("false");
  const used = vi.mocked(createSettingsStore).mock.results.map((r) => (r.value as SettingsStore).getState());
  expect(used.some((s) => s.units === "in" && s.boardZoom === 50 && s.keymap.off.includes("split"))).toBe(true);
  expect(setItem).not.toHaveBeenCalled();
  expect(PREFS_TEXT()).toBe("easyedit-prefs=u:in.sz:0.sn:1.z:50.st:30.tx:30");
});

it("a keymap saved in this browser shows once the page has loaded", () => {
  stubServer();
  const km = setKeys(DEFAULT_KEYMAP, "split", "Mod+Shift+S");
  localStorage.setItem(KEYMAP_KEY, formatKeymap(km));
  // The server's HTML, and so hydration, has the default hints.
  expect(renderToString(<EditorShell initial={initial()} />)).toContain('title="Split (S)"');
  render(<EditorShell initial={initial()} />);
  expect(screen.getByRole("button", { name: "Split" }).getAttribute("title")).toBe("Split (Ctrl+Shift+S)");
});

it("the browser's menu is off in the editor and on in text fields and links", async () => {
  stubServer();
  const { unmount } = render(<EditorShell initial={initial()} />);
  await flush();
  const preview = screen.getByRole("main", { name: "Preview" });
  expect(fireEvent.contextMenu(preview)).toBe(false);
  expect(fireEvent.contextMenu(screen.getByRole("region", { name: "Timeline" }))).toBe(false);
  const snap = screen.getByRole("button", { name: "Snap" });
  expect(fireEvent.contextMenu(snap)).toBe(false);
  expect(fireEvent.contextMenu(snap.querySelector("svg")!)).toBe(false); // an icon is no link

  await act(() => void fireEvent.click(screen.getByRole("tab", { name: "Media" })));
  await flush();
  expect(fireEvent.contextMenu(screen.getByRole("searchbox", { name: "Search media" }))).toBe(true);
  const projects = screen.getByRole("link", { name: "Projects" });
  expect(fireEvent.contextMenu(projects)).toBe(true);
  expect(fireEvent.contextMenu(projects.querySelector("svg")!)).toBe(true); // inside the link

  // A text area, and anything inside an element whose text can be edited.
  const area = document.createElement("textarea");
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  const word = document.createElement("span");
  editable.append(word);
  preview.append(area, editable);
  expect(fireEvent.contextMenu(area)).toBe(true);
  expect(fireEvent.contextMenu(word)).toBe(true);
  area.remove();
  editable.remove();

  // Gone with the editor.
  unmount();
  expect(fireEvent.contextMenu(document.body)).toBe(true);
});

// The page's side of drawing a thumbnail, with everything succeeding: a ready video asset "a", files that read,
// decodes that answer, and a canvas whose context records and whose toBlob answers a JPEG.
const JPEG = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
function fakeDeps(over: Partial<ThumbnailDeps> = {}) {
  const frame = { image: {} as CanvasImageSource, width: 1280, height: 720 };
  const makeCanvas = vi.fn(
    (): ThumbnailCanvas => ({ getContext: () => fakeCtx().ctx, toBlob: (done) => done(JPEG) }),
  );
  return {
    library: () => ({ assets: { a: assetView() }, loaded: true }),
    readFile: async (fileId: string) => new Blob([fileId]),
    decodeVideo: async () => frame,
    decodeImage: async () => frame,
    loadFonts: async () => {},
    resolveFont: (f: string) => f,
    makeCanvas,
    ...over,
  } satisfies ThumbnailDeps;
}
const puts = (server: { requests: string[] }) => server.requests.filter((r) => r.startsWith("PUT"));

it("the editor starts one thumbnail trigger with the stored picture's version", () => {
  stubServer();
  const { unmount } = render(<EditorShell initial={{ ...initial(), thumbnailVersion: 3 }} />);
  expect(startThumbnailTrigger).toHaveBeenCalledTimes(1);
  expect(startThumbnailTrigger).toHaveBeenCalledWith(expect.objectContaining({ storedVersion: 3 }));
  unmount();
  render(<EditorShell initial={initial()} />);
  expect(vi.mocked(startThumbnailTrigger).mock.calls.at(-1)![0].storedVersion).toBeNull();
});

it("a saved change is drawn and sent once, 4 seconds later", async () => {
  const fake = fakeDeps();
  vi.mocked(browserThumbnailDeps).mockReturnValue(fake);
  const server = stubServer();
  render(<EditorShell initial={{ ...initial(), thumbnailVersion: 5 }} />);
  await addTitle();
  await after(3_999);
  expect(puts(server)).toEqual([]);
  await after(1);
  await flush();
  expect(puts(server)).toEqual(["PUT /api/projects/p1/thumbnail?v=6"]);
  expect(server.posts()).toBe(1);
});

it("with no 2D canvas, a saved change sends nothing and reads no file", async () => {
  const server = stubServer();
  const media = pretendMedia();
  render(<EditorShell initial={{ ...initial(), thumbnailVersion: 5 }} />);
  const deps = vi.mocked(browserThumbnailDeps).mock.results.at(-1)!.value as ThumbnailDeps;
  const read = vi.spyOn(deps, "readFile");
  const made = vi.spyOn(deps, "makeCanvas");
  await act(() => media.library.getState().put(assetView()));
  await addTitle();
  await after(10_000);
  expect(made).toHaveBeenCalledTimes(1); // the capture got as far as the canvas, which has no 2D context here
  expect(read).not.toHaveBeenCalled();
  expect(server.requests.filter((r) => r.includes("/thumbnail"))).toEqual([]);
  expect(server.posts()).toBe(1);
});

it("leaving before the picture is drawn sends none", async () => {
  const fake = fakeDeps();
  vi.mocked(browserThumbnailDeps).mockReturnValue(fake);
  const server = stubServer();
  const { unmount } = render(<EditorShell initial={{ ...initial(), thumbnailVersion: 5 }} />);
  await addTitle();
  await after(3_999);
  unmount();
  await after(10_000);
  expect(puts(server)).toEqual([]);
  expect(fake.makeCanvas).not.toHaveBeenCalled();
});

it("edits still being sent when the editor is left draw no picture", async () => {
  const fake = fakeDeps();
  vi.mocked(browserThumbnailDeps).mockReturnValue(fake);
  const server = stubServer();
  const { unmount } = render(<EditorShell initial={{ ...initial(), thumbnailVersion: 5 }} />);
  server.hold = true;
  await addTitle();
  await addTitle("Add subtitle");
  unmount();
  server.release();
  await flush();
  await after(10_000);
  expect(server.posts()).toBe(2);
  expect(puts(server)).toEqual([]);
  expect(fake.makeCanvas).not.toHaveBeenCalled();
});

it("leaving stops the picture before the media services close", () => {
  stubServer();
  const media = pretendMedia();
  const realStart = vi.mocked(startThumbnailTrigger).getMockImplementation()!;
  let stop: Mock<() => void> | undefined;
  vi.mocked(startThumbnailTrigger).mockImplementationOnce((deps) => (stop = vi.fn(realStart(deps))));
  const { unmount } = render(<EditorShell initial={initial()} />);
  unmount();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(stop!.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(media.services.dispose).mock.invocationCallOrder[0]);
});

it("under strict mode one trigger draws once", async () => {
  const fake = fakeDeps();
  vi.mocked(browserThumbnailDeps).mockReturnValue(fake);
  const server = stubServer();
  render(
    <StrictMode>
      <EditorShell initial={initial()} />
    </StrictMode>,
  );
  await after(4_000);
  await flush();
  expect(puts(server)).toEqual(["PUT /api/projects/p1/thumbnail?v=5"]);
});

it("a picture waits for an upload, then follows once it is ready", async () => {
  const media = pretendMedia();
  const fake = fakeDeps({ library: () => media.library.getState() });
  vi.mocked(browserThumbnailDeps).mockReturnValue(fake);
  const server = stubServer();
  render(<EditorShell initial={{ ...initial(), thumbnailVersion: 5 }} />);
  await flush(); // the library's first load lands
  await act(() => media.library.getState().put(assetView({ status: "uploading" })));
  await addTitle();
  await after(10_000);
  expect(puts(server)).toEqual([]);
  expect(fake.makeCanvas).not.toHaveBeenCalled();
  await act(() => media.library.getState().put(assetView()));
  await after(0);
  await flush();
  expect(puts(server)).toEqual(["PUT /api/projects/p1/thumbnail?v=6"]);
});
