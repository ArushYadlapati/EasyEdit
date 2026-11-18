// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/editor/brand/brand-context";
import { EditorProvider } from "@/components/editor/context";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider } from "@/components/editor/media/media-context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/brand/types";
import { findClip } from "@/lib/editor/store";
import { makeStore, sampleDoc, text } from "../editor/fixtures";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

const image = (id: string, name: string) => assetView({ id, kind: "image", name, durationMs: null, previewStatus: "none", previewFileId: null, posterFileId: null });
const logo = image("l1", "Solvers logo");
const photo = image("l2", "Field photo");
const KIT: BrandKit = { ...DEFAULT_BRAND_KIT, fonts: { title: "Orbitron", subtitle: "Geist", body: "Inter" }, colors: ["#ff5a1f"], logos: [logo] };

function setup(canEdit = true, doc = sampleDoc()) {
  const store = makeStore({ canEdit, doc });
  const save = vi.fn(async (_space: string, patch: { logoAssetIds?: string[] }) => ({ ...KIT, logos: (patch.logoAssetIds ?? []).map((id) => (id === "l1" ? logo : photo)) }));
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([logo, photo, assetView({ id: "v1" })])}>
        <BrandProvider spaceId="team1" canEdit={canEdit} initial={KIT} api={{ fetch: vi.fn(), save }}>
          <ContextMenuProvider>
            <LeftPanel />
          </ContextMenuProvider>
        </BrandProvider>
      </MediaProvider>
    </EditorProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Brand kit" }));
  return { store, save };
}

const clipOf = (store: ReturnType<typeof makeStore>, id: string) => findClip(store.getState().doc, id)!.clip;

it("the left panel has Text, Media and Brand kit tabs", () => {
  setup();
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Text", "Media", "Brand kit"]);
});

it("clicking Title adds a title in the kit font", () => {
  const { store } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Add title" }));
  const clip = clipOf(store, store.getState().selection.clipIds[0]);
  expect(clip.type === "text" && [clip.text, clip.style.fontFamily]).toEqual(["Your title", "Orbitron"]);
});

it("clicking a swatch recolors the selected text clip", () => {
  const { store } = setup();
  act(() => store.getState().select(["x1", "c1"]));
  fireEvent.click(screen.getByRole("button", { name: "#ff5a1f" }));
  const x1 = clipOf(store, "x1");
  expect(x1.type === "text" && x1.style.color).toBe("#ff5a1f");
  expect(store.getState().queue).toMatchObject([{ label: "style change", ops: [{ op: "update_clip", clipId: "x1", patch: { style: { color: "#ff5a1f" } } }] }]);
});

it("clicking a swatch with no text selected says so", () => {
  const { store } = setup();
  act(() => store.getState().select(["c1"]));
  fireEvent.click(screen.getByRole("button", { name: "#ff5a1f" }));
  expect(store.getState().queue).toEqual([]);
  expect(store.getState().notice).toMatchObject({ tone: "info", text: "Select a text clip or a shape to recolor it." });
});

// sampleDoc with a locked text track t9 holding x9.
function withLockedText() {
  const doc = sampleDoc();
  doc.tracks.splice(2, 0, { ...doc.tracks[1], id: "t9", name: "Text 2", locked: true, clips: [text("x9", 0, 30)] });
  return doc;
}

it("clicking a swatch recolors the selected text but leaves out text on a locked track", () => {
  const { store } = setup(true, withLockedText());
  act(() => store.getState().select(["x1", "x9"]));
  fireEvent.click(screen.getByRole("button", { name: "#ff5a1f" }));
  expect(store.getState().queue).toMatchObject([{ label: "style change", ops: [{ op: "update_clip", clipId: "x1", patch: { style: { color: "#ff5a1f" } } }] }]);
  const x9 = clipOf(store, "x9");
  expect(x9.type === "text" && x9.style.color).toBe("#ffffff");
});

it("clicking a swatch with only locked text selected says the track is locked", () => {
  const { store } = setup(true, withLockedText());
  act(() => store.getState().select(["x9", "c1"]));
  fireEvent.click(screen.getByRole("button", { name: "#ff5a1f" }));
  expect(store.getState().queue).toEqual([]);
  expect(store.getState().notice).toMatchObject({ tone: "error", text: "That track is locked." });
});

it("clicking a logo adds it at the playhead, on top of the video at a medium size", () => {
  const { store } = setup();
  act(() => store.getState().seek(12));
  fireEvent.click(screen.getByRole("button", { name: "Add Solvers logo" }));
  const id = store.getState().selection.clipIds[0];
  const clip = clipOf(store, id);
  expect(clip).toMatchObject({ type: "image", assetId: "l1", start: 12, transform: { x: 0.5, y: 0.5, fit: "contain", scale: 0.4 } });
  const doc = store.getState().doc;
  const track = doc.tracks.find((t) => t.clips.some((c) => c.id === id))!;
  expect(track.kind).toBe("overlay");
  expect(doc.tracks.findIndex((t) => t === track)).toBeGreaterThan(doc.tracks.findIndex((t) => t.kind === "video")); // drawn above the video
  expect(store.getState().queue).toMatchObject([{ label: "add logo" }]);
});

it("Add logo marks an image from the library", async () => {
  const { save } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Add logo" }));
  const dialog = screen.getByRole("dialog", { name: "Add a logo" });
  expect(within(dialog).queryByRole("button", { name: "Use intake" })).toBeNull(); // a video is not offered
  expect((within(dialog).getByRole("button", { name: "Solvers logo is in the kit" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Use Field photo" })));
  expect(save).toHaveBeenCalledWith("team1", { logoAssetIds: ["l1", "l2"] });
  expect(screen.getByRole("button", { name: "Add Field photo" })).toBeTruthy();
});

it("a viewer can't add from the kit or change it", () => {
  setup(false);
  expect(screen.queryByRole("button", { name: "Add title" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add Solvers logo" })).toBeNull();
  expect(screen.getByText("Orbitron")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add logo" })).toBeNull();
});

it("a kit that failed to load says so, offers to try again, and can't be changed meanwhile", async () => {
  const store = makeStore();
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(KIT);
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([logo])}>
        <BrandProvider spaceId="team1" canEdit api={{ fetch, save: vi.fn() }}>
          <LeftPanel />
        </BrandProvider>
      </MediaProvider>
    </EditorProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Brand kit" }));
  expect(await screen.findByText("The brand kit couldn't be loaded.")).toBeTruthy();
  expect(screen.queryByLabelText("New color")).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("New color")).toBeTruthy();
});

it("a logo whose image was removed from the library leaves the kit and the next save", async () => {
  const store = makeStore();
  const save = vi.fn(async () => ({ ...KIT, logos: [photo] }));
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([{ ...logo, removed: true }, photo])}>
        <BrandProvider spaceId="team1" canEdit initial={KIT} api={{ fetch: vi.fn(), save }}>
          <LeftPanel />
        </BrandProvider>
      </MediaProvider>
    </EditorProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Brand kit" }));
  expect(screen.queryByRole("button", { name: "Add Solvers logo" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Add logo" }));
  await act(async () => fireEvent.click(within(screen.getByRole("dialog", { name: "Add a logo" })).getByRole("button", { name: "Use Field photo" })));
  expect(save).toHaveBeenCalledWith("team1", { logoAssetIds: ["l2"] });
});
