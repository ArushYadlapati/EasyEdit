// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { CLIP_HEIGHT, CLIP_TOP } from "@/components/editor/timeline/clip-view";
import { Timeline } from "@/components/editor/timeline/timeline";
import { captionOps } from "@/lib/captions/actions";
import { DEFAULT_BRAND_FONTS } from "@/lib/brand/types";
import { applyOps, prepareOps, type CaptionWord, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, video } from "../editor/fixtures";
import { act, fireEvent, render, screen } from "../helpers/dom";

const w = (t: string, s: number, e: number): CaptionWord => ({ t, s, e });
const WORDS = [w("hello", 0, 400), w("there.", 450, 900), w("second", 1000, 1400), w("line", 1450, 1800)];

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1400);
});
afterEach(() => vi.restoreAllMocks());

// c1 plays the words from frame 60, so the lines start at 60 and 90.
function captionedDoc(): TimelineDoc {
  const doc = sampleDoc();
  doc.tracks[0].clips = [video("c1", 60, 90)];
  return applyOps(doc, prepareOps(captionOps(doc, { assetId: "a", words: WORDS, clipIds: ["c1"], fonts: DEFAULT_BRAND_FONTS }), () => "g")).doc;
}

function setup(doc: TimelineDoc) {
  const store = makeStore({ doc });
  render(
    <EditorProvider store={store}>
      <Timeline />
    </EditorProvider>,
  );
  act(() => store.getState().setZoom(2));
  return store;
}

// The clips on the Captions track's row, in order.
const captionClips = () => [...document.querySelectorAll<HTMLElement>('[role=group][aria-label="Captions"] [data-clip-id]')];
const captionClip = () => captionClips()[0];

it("auto captions make one caption clip on the Captions track, as long as its clip, a plain block named Captions 1", () => {
  setup(captionedDoc());
  expect(captionClips()).toHaveLength(1);
  const clip = captionClip();
  // The clip runs 60–150: two pixels a frame.
  expect([clip.style.left, clip.style.width]).toEqual(["120px", "180px"]);
  expect([clip.style.top, clip.style.height]).toEqual([`${CLIP_TOP}px`, `${CLIP_HEIGHT}px`]);
  expect(clip.getAttribute("aria-label")).toMatch(/^Captions 1, /);
  expect(clip.textContent).toBe("Captions 1");
  // One cohesive block: no lines or dividers drawn inside it, and no block per line.
  expect(clip.querySelectorAll("[data-caption-line]")).toHaveLength(0);
  expect(document.querySelectorAll("[data-cue]")).toHaveLength(0);
  expect(screen.queryByText("hello there.")).toBeNull();
  expect(screen.queryByText("Captions show here. Add them in the Captions tab.")).toBeNull();
});

it("a press on the caption clip selects it alone, though it is linked with its clip", () => {
  const store = setup(captionedDoc());
  const clip = captionClip();
  fireEvent.pointerDown(clip, { button: 0, pointerId: 1 });
  expect(store.getState().selection.clipIds).toEqual([clip.dataset.clipId]);
});

it("Split at the playhead cuts the caption clip in two: Captions 1 and Captions 2, each selected on its own", () => {
  const store = setup(captionedDoc());
  const id = captionClip().dataset.clipId!;
  act(() => {
    store.getState().select([id]);
    store.getState().seek(90);
  });
  act(() => {
    store.getState().edit([{ op: "split_clip", clipId: id, at: 90 }], "split");
  });
  const pieces = captionClips();
  expect(pieces.map((el) => el.textContent)).toEqual(["Captions 1", "Captions 2"]);
  expect(pieces.map((el) => el.getAttribute("aria-label")!.split(",")[0])).toEqual(["Captions 1", "Captions 2"]);
  expect(document.querySelectorAll("[data-caption-line]")).toHaveLength(0);
  fireEvent.pointerDown(pieces[1], { button: 0, pointerId: 1 });
  expect(store.getState().selection.clipIds).toEqual([pieces[1].dataset.clipId]);
  // Numbered by where they start: the one moved in front of the other becomes Captions 1.
  act(() => {
    store.getState().edit([{ op: "move_clip", clipId: pieces[1].dataset.clipId!, start: 0 }], "move");
  });
  expect(captionClips().map((el) => [el.dataset.clipId, el.textContent])).toEqual([
    [pieces[1].dataset.clipId, "Captions 1"],
    [pieces[0].dataset.clipId, "Captions 2"],
  ]);
});

it("captions switched on the old way show as one plain block per clip; a click moves the playhead to its start", () => {
  const doc = sampleDoc();
  doc.tracks[0].clips = [video("c1", 60, 90, { captions: true })];
  doc.captions = { transcripts: { a: WORDS } };
  const store = setup(doc);
  const blocks = document.querySelectorAll<HTMLElement>("[data-cue]");
  expect(blocks).toHaveLength(1);
  expect([blocks[0].style.left, blocks[0].style.width, blocks[0].textContent]).toEqual(["120px", "132px", "Captions"]);
  fireEvent.click(blocks[0]);
  expect(store.getState().playhead).toBe(60);
});

it("says where captions come from when there are none", () => {
  setup(sampleDoc());
  expect(screen.getByText("Captions show here. Add them in the Captions tab.")).toBeTruthy();
  expect(screen.queryByText("Captions are not available yet.")).toBeNull();
});
