// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/editor/brand/brand-context";
import { CaptionsProvider } from "@/components/editor/captions/captions-context";
import { EditorProvider } from "@/components/editor/context";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider } from "@/components/editor/media/media-context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import type { AutoCaptionDeps } from "@/lib/captions/actions";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/types";
import type { TextClip } from "@/lib/timeline";
import { makeStore } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

afterEach(cleanup);

function show(canEdit = true) {
  const store = makeStore({ canEdit });
  const deps = { transcriber: { transcribe: async () => [] }, fetchSaved: async () => null, save: async () => true, files: { get: async () => ({ ok: false, problem: "missing" }), put: async () => {} }, assets: () => ({}), ensure: async () => [], fonts: () => DEFAULT_BRAND_KIT.fonts } as unknown as AutoCaptionDeps;
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([assetView()])}>
        <BrandProvider spaceId="team1" canEdit={canEdit} initial={DEFAULT_BRAND_KIT} api={{ fetch: vi.fn(), save: vi.fn() }}>
          <CaptionsProvider deps={deps}>
            <ContextMenuProvider>
              <LeftPanel />
            </ContextMenuProvider>
          </CaptionsProvider>
        </BrandProvider>
      </MediaProvider>
    </EditorProvider>,
  );
  return store;
}

it("the Text tab has four rows of stickers, each a button that says what it adds", () => {
  show();
  expect(screen.getByRole("heading", { name: "Stickers" })).toBeTruthy();
  const groups = ["Reactions", "Pointers", "Marks", "Things"].map((name) => within(screen.getByRole("group", { name: `${name} stickers` })).getAllByRole("button"));
  expect(groups.map((g) => g.length)).toEqual([8, 8, 8, 8]);
  expect(groups[0][2].getAttribute("aria-label")).toBe("Add the fire sticker");
  expect(groups[0][2].textContent).toBe("🔥");
});

it("a click adds the sticker at the playhead and selects it", () => {
  const store = show();
  act(() => store.getState().seek(120));
  fireEvent.click(screen.getByRole("button", { name: "Add the rocket sticker" }));
  const [id] = store.getState().selection.clipIds;
  const clip = store.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as TextClip;
  expect(clip).toMatchObject({ type: "text", text: "🚀", start: 120, animationIn: { preset: "pop" } });
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "add sticker" });
});

it("is off for someone who can't edit", () => {
  show(false);
  expect((screen.getByRole("button", { name: "Add the fire sticker" }) as HTMLButtonElement).disabled).toBe(true);
});
