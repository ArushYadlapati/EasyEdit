// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider, useMediaSpace, type MediaServices } from "@/components/editor/media/media-context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import type { MediaApi } from "@/lib/media/api";
import { createLibraryStore } from "@/lib/media/library-store";
import { MEDIA_MESSAGES } from "@/lib/media/messages";
import { makeStore } from "../editor/fixtures";
import { act, fireEvent, render, renderHook, screen } from "../helpers/dom";

const COPY = "Uploading to your personal space isn't ready yet. Seattle Solvers' media works as before.";

function setup(options: { storageReady?: boolean; setUp?: boolean }) {
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
        <MediaProvider services={services} spaceId="s1" storageReady={options.storageReady}>
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

describe("the Media tab of a space with no storage", () => {
  it("says storage comes next, with no upload button, file input or drop target", async () => {
    const { list, view } = setup({ storageReady: false });
    await openMedia();
    expect(screen.getByRole("heading", { name: "Storage comes next" })).toBeTruthy();
    expect(screen.getByText(COPY)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("wins over a Drive that is not set up", async () => {
    setup({ storageReady: false, setUp: false });
    await openMedia();
    expect(screen.getByText(COPY)).toBeTruthy();
    expect(screen.queryByText(MEDIA_MESSAGES.notSetUp)).toBeNull();
  });

  it("keeps the upload and the not-set-up message for a space with storage", async () => {
    setup({ storageReady: true, setUp: false });
    await openMedia();
    expect(screen.queryByText("Storage comes next")).toBeNull();
    expect(screen.getByRole("button", { name: "Upload" })).toBeTruthy();
    expect(screen.getByText(MEDIA_MESSAGES.notSetUp)).toBeTruthy();
  });
});

describe("the media space context", () => {
  it("defaults to storage ready with no provider, as MediaProvider does without the prop", () => {
    const bare = renderHook(() => useMediaSpace());
    expect(bare.result.current).toEqual({ spaceId: null, storageReady: true });
    const provided = renderHook(() => useMediaSpace(), {
      wrapper: ({ children }) => <MediaProvider services={{} as MediaServices}>{children}</MediaProvider>,
    });
    expect(provided.result.current).toEqual(bare.result.current);
  });
});
