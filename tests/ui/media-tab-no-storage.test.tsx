// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider, gateStorage, useMediaSpace, type MediaServices, type StorageSetup } from "@/components/editor/media/media-context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import type { MediaApi } from "@/lib/media/api";
import { createLibraryStore } from "@/lib/media/library-store";
import { MEDIA_MESSAGES } from "@/lib/media/messages";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, renderHook, screen } from "../helpers/dom";

const PERSONAL: StorageSetup = { kind: "personal", slug: "personal", isAdmin: true, block: null, ownsConnection: true, ownerEmail: null };
const TEAM_ADMIN: StorageSetup = { kind: "team", slug: "robots", isAdmin: true, block: null, ownsConnection: true, ownerEmail: "u1@gmail.com" };
const TEAM_MEMBER: StorageSetup = { kind: "team", slug: "robots", isAdmin: false, block: null, ownsConnection: false, ownerEmail: "u1@gmail.com" };

function setup(options: { storageReady?: boolean; storageProblem?: "none" | "broken" | null; setUp?: boolean; storageSetup?: StorageSetup }) {
  const refused = vi.fn(async (): Promise<never> => {
    throw new Error("not called");
  });
  const list = vi.fn(async () => ({ ok: true as const, assets: [], setUp: options.setUp ?? true }));
  const api = { list, update: refused, remove: refused, open: refused, offset: refused, complete: refused, openFile: refused, completeFile: refused, previewFailed: refused, readToken: refused } as unknown as MediaApi;
  const queue = { add: vi.fn(() => []), cancel: vi.fn(), retry: vi.fn(), resume: vi.fn(), dismiss: vi.fn(), stop: vi.fn(), items: () => [], active: () => 0 };
  const services: MediaServices = { library: createLibraryStore({ api }), queue, files: { get: vi.fn(() => new Promise<never>(() => {})), put: vi.fn(async () => {}) }, dispose: vi.fn() };
  const view = render(
    <EditorProvider store={makeStore({ canEdit: true })}>
      <ContextMenuProvider>
        <MediaProvider services={services} spaceId="s1" storageReady={options.storageReady} storageProblem={options.storageProblem} storageSetup={options.storageSetup ?? PERSONAL}>
          <LeftPanel />
        </MediaProvider>
      </ContextMenuProvider>
    </EditorProvider>,
  );
  return { list, view };
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

    setup({ storageReady: false, storageProblem: "none", storageSetup: { ...TEAM_ADMIN, block: "team" } });
    await openMedia();
    expect(screen.getByText("Team storage isn't set up on this server yet.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("says the Drive needs reconnecting when its connection broke, with Reconnect for admins and no upload", async () => {
    const admin = setup({ storageReady: false, storageProblem: "broken", storageSetup: TEAM_ADMIN });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Google Drive needs reconnecting" })).toBeTruthy();
    expect(screen.getByText("EasyEdit can't reach this space's Google Drive any more. An admin can reconnect it in storage settings.")).toBeTruthy();
    expect(link("Reconnect").getAttribute("href")).toBe("/s/robots/settings/storage");
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(admin.list).not.toHaveBeenCalled();
    admin.view.unmount();

    setup({ storageReady: false, storageProblem: "broken", storageSetup: TEAM_MEMBER });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Google Drive needs reconnecting" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Reconnect" })).toBeNull();
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
    expect(bare.result.current).toEqual({ spaceId: null, storageReady: true, storageProblem: null, storageSetup: null });
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
    const services = { queue: { add } } as unknown as MediaServices;
    const gated = gateStorage(services, false);
    expect(gated.queue.add([new File(["x"], "a.mov")])).toEqual([]);
    expect(add).not.toHaveBeenCalled();
  });
});
