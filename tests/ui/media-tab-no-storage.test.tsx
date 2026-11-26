// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider, gateStorage, useMediaSpace, type MediaServices, type StorageSetup } from "@/components/editor/media/media-context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import type { MediaApi } from "@/lib/media/api";
import { createLibraryStore } from "@/lib/media/library-store";
import { MEDIA_MESSAGES } from "@/lib/media/messages";
import type { AssetView } from "@/lib/media/types";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, renderHook, screen, waitFor } from "../helpers/dom";
import { createLocalFolder, type LocalFolder } from "@/lib/media/local-folder";
import { fakeFolder, type FakeFolder } from "../helpers/fake-folder";
import { idleFolder } from "../helpers/media-services";

const PERSONAL: StorageSetup = { kind: "personal", slug: "personal", isAdmin: true, block: null, ownsConnection: true, ownerEmail: null };
const TEAM_ADMIN: StorageSetup = { kind: "team", slug: "robots", isAdmin: true, block: null, ownsConnection: true, ownerEmail: "u1@gmail.com" };
// A finished video with no pictures to read, so the row asks Drive for nothing.
const READY: AssetView = {
  id: "v1", kind: "video", name: "Clip one", fileName: "clip.mp4", sizeBytes: 1000, status: "ready", removed: false, durationMs: 5000, width: 1920,
  height: 1080, fps: 30, hasAudio: true, originalFileId: "orig-v1", previewStatus: "none", previewFileId: null, posterFileId: null, event: null,
  uploadedBy: "u1", uploadedByName: "Ada Lovelace", createdAt: "2026-11-01T10:00:00.000Z",
};
const TEAM_MEMBER: StorageSetup = { kind: "team", slug: "robots", isAdmin: false, block: null, ownsConnection: false, ownerEmail: "u1@gmail.com" };

function setup(options: { storageReady?: boolean; storageProblem?: "none" | "broken" | null; setUp?: boolean; storageSetup?: StorageSetup; assets?: AssetView[]; local?: LocalFolder }) {
  const refused = vi.fn(async (): Promise<never> => {
    throw new Error("not called");
  });
  const list = vi.fn(async () => ({ ok: true as const, assets: options.assets ?? [], setUp: options.setUp ?? true }));
  const api = { list, update: refused, remove: refused, open: refused, offset: refused, complete: refused, openFile: refused, completeFile: refused, previewFailed: refused, readToken: refused } as unknown as MediaApi;
  const queue = { add: vi.fn(() => []), cancel: vi.fn(), retry: vi.fn(), resume: vi.fn(), dismiss: vi.fn(), stop: vi.fn(), items: () => [], active: () => 0 };
  const services: MediaServices = { library: createLibraryStore({ api }), queue, files: { get: vi.fn(() => new Promise<never>(() => {})), put: vi.fn(async () => {}) }, local: options.local ?? idleFolder(), dispose: vi.fn() };
  const view = render(
    <EditorProvider store={makeStore({ canEdit: true })}>
      <ContextMenuProvider>
        <MediaProvider services={services} spaceId="s1" storageReady={options.storageReady} storageProblem={options.storageProblem} storageSetup={options.storageSetup ?? PERSONAL}>
          <LeftPanel />
        </MediaProvider>
      </ContextMenuProvider>
    </EditorProvider>,
  );
  return { list, view, queue };
}

async function openMedia() {
  fireEvent.click(screen.getByRole("tab", { name: "Media" }));
  await act(async () => {});
}

const link = (name: string) => screen.getByRole("link", { name });

describe("the Media tab of a space with no storage", () => {
  it("a personal space: set up your storage, with Choose account and no upload, file input or drop target", async () => {
    const { list, view } = setup({ storageReady: false, storageProblem: "none" });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Set up your storage" })).toBeTruthy();
    expect(screen.getByText("Pick a Google account for your own videos.")).toBeTruthy();
    expect(link("Choose account").getAttribute("href")).toBe("/s/personal/settings/storage");
    expect(screen.queryByText("Storage comes next")).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("a team: its admins choose where its videos go, everyone else is told an admin does", async () => {
    const admin = setup({ storageReady: false, storageProblem: "none", storageSetup: TEAM_ADMIN });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Set up this team's storage" })).toBeTruthy();
    expect(screen.getByText("Choose where this team's videos are stored.")).toBeTruthy();
    expect(link("Choose account").getAttribute("href")).toBe("/s/robots/settings/storage");
    admin.view.unmount();

    setup({ storageReady: false, storageProblem: "none", storageSetup: TEAM_MEMBER });
    await openMedia();
    expect(screen.getByRole("heading", { name: "No storage yet" })).toBeTruthy();
    expect(screen.getByText("An admin needs to choose where this team's videos are stored.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("a server with no storage settings sends nobody to set it up", async () => {
    const personal = setup({ storageReady: false, storageProblem: "none", storageSetup: { ...PERSONAL, block: "server" } });
    await openMedia();
    expect(screen.getByRole("heading", { name: "No storage yet" })).toBeTruthy();
    expect(screen.getByText("Storage isn't set up on this server yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    personal.view.unmount();
  });

  it("says the Drive needs reconnecting when its connection broke, with Reconnect for admins and no upload", async () => {
    const admin = setup({ storageReady: false, storageProblem: "broken", storageSetup: TEAM_ADMIN, setUp: false });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Google Drive needs reconnecting" })).toBeTruthy();
    expect(screen.getByText("EasyEdit can't reach this space's Google Drive any more. An admin can reconnect it in storage settings.")).toBeTruthy();
    expect(link("Reconnect").getAttribute("href")).toBe("/s/robots/settings/storage");
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(admin.view.container.querySelector('input[type="file"]')).toBeNull();
    admin.view.unmount();

    setup({ storageReady: false, storageProblem: "broken", storageSetup: TEAM_MEMBER });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Google Drive needs reconnecting" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Reconnect" })).toBeNull();
  });

  it("a team's library still lists below the broken card, so what is there still plays; uploads stay off", async () => {
    const { list, view } = setup({ storageReady: false, storageProblem: "broken", storageSetup: TEAM_MEMBER, setUp: false, assets: [READY] });
    await openMedia();
    expect(list).toHaveBeenCalled();
    const heading = screen.getByRole("heading", { name: "Google Drive needs reconnecting" });
    const library = screen.getByRole("list", { name: "Media" });
    expect(heading.compareDocumentPosition(library) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the card is above the list
    expect(screen.getByText("Clip one")).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search media" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(MEDIA_MESSAGES.notSetUp)).toBeNull(); // the card already says why
  });

  it("a personal space's broken Drive has nothing left to read with: the card alone, no list", async () => {
    const { list } = setup({ storageReady: false, storageProblem: "broken", storageSetup: PERSONAL, assets: [READY] });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Google Drive needs reconnecting" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Media" })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("an admin who didn't connect the broken account is told who can reconnect it", async () => {
    const other = setup({ storageReady: false, storageProblem: "broken", storageSetup: { ...TEAM_ADMIN, ownsConnection: false, ownerEmail: "bea@gmail.com" } });
    await openMedia();
    expect(screen.queryByRole("link", { name: "Reconnect" })).toBeNull();
    expect(screen.getByText("Only bea@gmail.com can reconnect it.")).toBeTruthy();
    other.view.unmount();
    setup({ storageReady: false, storageProblem: "broken", storageSetup: { ...TEAM_ADMIN, ownsConnection: false, ownerEmail: null } });
    await openMedia();
    expect(screen.getByText("Only the person who connected it can reconnect it.")).toBeTruthy();
  });

  it("wins over a Drive that is not set up", async () => {
    setup({ storageReady: false, setUp: false });
    await openMedia();
    expect(screen.getByText("Pick a Google account for your own videos.")).toBeTruthy();
    expect(screen.queryByText(MEDIA_MESSAGES.notSetUp)).toBeNull();
  });

  it("keeps the upload and the not-set-up message for a space with storage", async () => {
    // What the editor page hands over for Seattle Solvers when its Drive settings are missing or unreadable.
    const { list } = setup({ storageReady: true, storageProblem: null, setUp: false });
    await openMedia();
    expect(list).toHaveBeenCalled(); // the library is still listed
    expect(screen.queryByText("Set up your storage")).toBeNull();
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(screen.getByText(MEDIA_MESSAGES.notSetUp)).toBeTruthy();
  });
});

describe("the media space context", () => {
  it("defaults to storage ready with no provider, as MediaProvider does without the prop", () => {
    const bare = renderHook(() => useMediaSpace());
    expect(bare.result.current).toEqual({ spaceId: null, storageReady: true, storageProblem: null, storageSetup: null, stock: false });
    const provided = renderHook(() => useMediaSpace(), {
      wrapper: ({ children }) => <MediaProvider services={{} as MediaServices}>{children}</MediaProvider>,
    });
    expect(provided.result.current).toEqual(bare.result.current);
  });
});

describe("gateStorage", () => {
  it("leaves the services as they are where there is storage", () => {
    const services = { queue: { add: vi.fn(() => ["k1"]) } } as unknown as MediaServices;
    expect(gateStorage(services, true)).toBe(services);
  });

  it("makes the queue take no file where there is none, so a drop makes no group", () => {
    const add = vi.fn(() => ["k1"]);
    const services = { queue: { add }, local: idleFolder() } as unknown as MediaServices;
    const gated = gateStorage(services, false);
    expect(gated.queue.add([new File(["x"], "a.mov")])).toEqual([]);
    expect(add).not.toHaveBeenCalled();
  });
});

describe("media kept in a folder on this computer", () => {
  const memory = () => ({ load: async () => null, save: async () => {} });
  // What Chrome and Edge have and the test browser lacks: a folder picker, here answering with a folder in memory.
  function withPicker(picked: FakeFolder | null) {
    const pick = vi.fn(async () => {
      if (!picked) throw new DOMException("closed", "AbortError");
      return picked;
    });
    vi.stubGlobal("showDirectoryPicker", pick);
    return pick;
  }
  afterEach(() => vi.unstubAllGlobals());

  it("is offered under the storage card, and says so where the browser cannot pick a folder", async () => {
    setup({ storageReady: false, storageProblem: "none" });
    await openMedia();
    expect(screen.getByText(MEDIA_MESSAGES.folderNeedsChrome)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use a folder on this computer" })).toBeNull();
  });

  it("choosing a folder turns uploading on in a space with no storage: files go to the queue and the library is listed", async () => {
    const picked = fakeFolder("Footage");
    const pick = withPicker(picked);
    const local = createLocalFolder(memory());
    const { list, view, queue } = setup({ storageReady: false, storageProblem: "none", local });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Set up your storage" })).toBeTruthy();
    expect(screen.getByText(MEDIA_MESSAGES.folderOffer)).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Use a folder on this computer" }));
    await waitFor(() => expect(screen.getByText(MEDIA_MESSAGES.folderReady("Footage"))).toBeTruthy());
    expect(pick).toHaveBeenCalledWith({ id: "easyedit-media", mode: "readwrite" });
    // The storage card gives way to the upload controls.
    expect(screen.queryByRole("heading", { name: "Set up your storage" })).toBeNull();
    const upload = screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement;
    expect(upload.disabled).toBe(false);
    expect(list).toHaveBeenCalled();
    const input = view.container.querySelector('input[type="file"]:not([aria-label])') as HTMLInputElement;
    const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(queue.add).toHaveBeenCalledWith([file]);
    // With no Drive to go back to, the way out is to stop using the folder.
    fireEvent.click(screen.getByRole("button", { name: "Stop using it" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Set up your storage" })).toBeTruthy());
    expect(local.state()).toBe("none");
  });

  it("a remembered folder waits for a click before it opens again", async () => {
    withPicker(null);
    const picked = fakeFolder("Footage", { now: "prompt" });
    const local = createLocalFolder({ load: async () => picked, save: async () => {} });
    await local.restore();
    setup({ storageReady: false, storageProblem: "none", local });
    await openMedia();
    expect(screen.getByText(MEDIA_MESSAGES.folderLocked("Footage"))).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open folder" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy());
    expect(picked.asked).toBe(1);
  });

  it("where Drive works, the folder is an offer under Upload, and leaving it goes back to Drive", async () => {
    withPicker(fakeFolder("Footage"));
    const local = createLocalFolder(memory());
    setup({ storageReady: true, local });
    await openMedia();
    expect(screen.getByText(MEDIA_MESSAGES.folderOfferWithDrive)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use a folder on this computer" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Use Google Drive" })).toBeTruthy());
    expect(screen.getByRole("button", { name: "Change folder" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use Google Drive" }));
    await waitFor(() => expect(screen.getByText(MEDIA_MESSAGES.folderOfferWithDrive)).toBeTruthy());
  });

  it("is for a Personal space only: a team is offered no folder, with or without storage, picker or not", async () => {
    const bare = setup({ storageReady: false, storageProblem: "none", storageSetup: TEAM_ADMIN });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Set up this team's storage" })).toBeTruthy();
    expect(screen.queryByText(MEDIA_MESSAGES.folderNeedsChrome)).toBeNull();
    bare.view.unmount();

    withPicker(fakeFolder("Footage"));
    const noStorage = setup({ storageReady: false, storageProblem: "none", storageSetup: TEAM_ADMIN });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Set up this team's storage" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Media folder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Use a folder on this computer" })).toBeNull();
    noStorage.view.unmount();

    setup({ storageReady: true, storageSetup: TEAM_MEMBER });
    await openMedia();
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Media folder" })).toBeNull();
    expect(screen.queryByText(MEDIA_MESSAGES.folderOfferWithDrive)).toBeNull();
  });

  it("a folder a team's browser still has open counts for nothing: the storage card stays and nothing can be added", async () => {
    withPicker(null);
    const local = createLocalFolder(memory());
    await local.choose(async () => fakeFolder("Footage"));
    expect(local.state()).toBe("ready");
    const { list, view } = setup({ storageReady: false, storageProblem: "none", storageSetup: TEAM_ADMIN, local });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Set up this team's storage" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByText(MEDIA_MESSAGES.folderReady("Footage"))).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("in a team whose Drive works, an open folder changes nothing: uploads are the Drive's", async () => {
    const local = createLocalFolder(memory());
    await local.choose(async () => fakeFolder("Footage"));
    setup({ storageReady: true, setUp: false, storageSetup: TEAM_MEMBER, local });
    await openMedia();
    // With the Drive not set up, the folder does not turn uploading on, and the line that says why is still there.
    expect((screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(MEDIA_MESSAGES.notSetUp)).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Media folder" })).toBeNull();
  });

  it("the gate lets files through only with storage or an open folder", async () => {
    const add = vi.fn(() => ["k"]);
    const local = createLocalFolder(memory());
    const services = { queue: { add }, local } as unknown as MediaServices;
    expect(gateStorage(services, true)).toBe(services);
    const gated = gateStorage(services, false);
    expect(gated.queue.add([new File(["x"], "a.mp4")])).toEqual([]);
    await local.choose(async () => fakeFolder());
    expect(gated.queue.add([new File(["x"], "a.mp4")])).toEqual(["k"]);
  });
});
