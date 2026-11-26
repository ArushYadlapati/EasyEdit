import { afterEach, expect, it, vi } from "vitest";
import { createMediaServices } from "@/components/editor/media/media-context";
import { createIngest, type Ingest } from "@/lib/media/ingest-protocol";
import { createUploadQueue, type QueueDeps, type UploadQueue } from "@/lib/media/upload-queue";
import type { AssetView, UploadItem } from "@/lib/media/types";
import { folderMemory } from "@/components/editor/media/folder-memory";
import { fakeFolder, type FakeFolder } from "../helpers/fake-folder";

// The queue and the worker are stood in for, so that what createMediaServices hands them can be looked at.
const order: string[] = [];
vi.mock("@/lib/media/upload-queue", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/media/upload-queue")>();
  return {
    ...real,
    createUploadQueue: vi.fn((): UploadQueue => ({
      add: () => [], cancel() {}, retry() {}, resume() {}, dismiss() {}, items: () => [], active: () => 0,
      stop: () => void order.push("queue.stop"),
    })),
  };
});
vi.mock("@/lib/media/ingest-protocol", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/media/ingest-protocol")>();
  return {
    ...real,
    createIngest: vi.fn((): Ingest => ({
      probe: async () => null,
      derive: async () => ({ preview: null, poster: null, previewProblem: null }),
      dispose: () => void order.push("ingest.dispose"),
    })),
  };
});

// The folder this browser remembers for a space, whichever space asks.
const remembered = { folder: null as FakeFolder | null };
vi.mock("@/components/editor/media/folder-memory", () => ({
  folderMemory: vi.fn(() => ({ load: async () => remembered.folder, save: async () => {} })),
}));

const queueDeps = (): QueueDeps => vi.mocked(createUploadQueue).mock.lastCall![0];

afterEach(() => {
  remembered.folder = null;
  vi.mocked(folderMemory).mockClear();
  order.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ASSET = { id: "v1", name: "field", status: "ready", removed: false } as AssetView;
const ITEM = { key: "k1", fileName: "field.mp4", stage: "uploading" } as UploadItem;

it("the queue tells the library and the local files what it learns, and takes the library's event", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "X", message: "No network in this test." }, { status: 400 })));
  const services = createMediaServices("s1");
  const deps = queueDeps();
  deps.onChange([ITEM]);
  expect(services.library.getState().uploads).toEqual([ITEM]);
  deps.onAsset(ASSET);
  expect(services.library.getState().assets.v1).toEqual(ASSET);
  services.library.getState().setUploadEvent("Qualifier 2026-11-08");
  expect(deps.event()).toBe("Qualifier 2026-11-08");
  const poster = new Blob(["jpeg"]);
  deps.onPreviewFile("post-v1", poster);
  const got = await services.files.get("post-v1"); // from this browser, with no request to Drive
  expect(got.ok && (await got.blob.text())).toBe("jpeg");
  expect(fetch).not.toHaveBeenCalled();
});

it("waits between tries with a sleep that resolves", async () => {
  vi.useFakeTimers();
  createMediaServices("s1");
  let slept = false;
  void queueDeps().sleep(1000).then(() => (slept = true));
  await vi.advanceTimersByTimeAsync(999);
  expect(slept).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(slept).toBe(true);
});

it("dispose stops the uploads first, then ends the worker", () => {
  const services = createMediaServices("s1");
  services.dispose();
  expect(order).toEqual(["queue.stop", "ingest.dispose"]);
});

it("starts the ingest worker from its module file", () => {
  const started: { url: URL; options: WorkerOptions }[] = [];
  vi.stubGlobal(
    "Worker",
    class {
      constructor(url: URL, options: WorkerOptions) {
        started.push({ url, options });
      }
    },
  );
  createMediaServices("s1");
  const startWorker = vi.mocked(createIngest).mock.lastCall![0];
  startWorker();
  expect(started).toHaveLength(1);
  expect(started[0].url.href).toMatch(/\/src\/workers\/ingest\.worker\.ts$/);
  expect(started[0].options).toEqual({ type: "module" });
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

it("a Personal space's services open the folder this browser remembers, and the queue keeps new files in it", async () => {
  remembered.folder = fakeFolder("Footage");
  const services = createMediaServices("s1", { localFolder: true });
  await settled();
  expect(folderMemory).toHaveBeenCalledWith("s1");
  expect(services.local.state()).toBe("ready");
  expect(queueDeps().local?.()).toBe(services.local);
});

it("any other space's services never look for a folder, and the queue keeps nothing on this computer", async () => {
  remembered.folder = fakeFolder("Footage");
  for (const services of [createMediaServices("team1"), createMediaServices("team1", { localFolder: false })]) {
    const deps = queueDeps();
    await settled();
    expect(services.local.state()).toBe("none");
    expect(deps.local?.() ?? null).toBeNull();
    // Even a folder that got opened some other way takes no file.
    await services.local.choose(async () => fakeFolder("Other"));
    expect(deps.local?.() ?? null).toBeNull();
  }
  expect(folderMemory).not.toHaveBeenCalled();
});
