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

const captionClip = () => document.querySelector<HTMLElement>("[data-clip-id] [data-caption-line]")!.closest<HTMLElement>("[data-clip-id]")!;
const lines = () => [...captionClip().querySelectorAll<HTMLElement>("[data-caption-line]")];

it("auto captions make one caption clip on the Captions track, as long as its clip, with each line inside it", () => {
  setup(captionedDoc());
  const clip = captionClip();
  // The clip runs 60–150: two pixels a frame.
  expect([clip.style.left, clip.style.width]).toEqual(["120px", "180px"]);
  expect([clip.style.top, clip.style.height]).toEqual([`${CLIP_TOP}px`, `${CLIP_HEIGHT}px`]);
  expect(clip.getAttribute("aria-label")).toMatch(/^Captions, /);
  expect(clip.closest("[role=group]")?.getAttribute("aria-label")).toBe("Captions");
  // "hello there." from 60 until the next line at 90; "second line" until 126 (400 ms after its last word, at 114).
  expect(lines().map((l) => [l.textContent, l.style.left, l.style.width])).toEqual([
    ["hello there.", "0px", "60px"],
    ["second line", "60px", "72px"],
  ]);
  // One block, not one per line.
  expect(document.querySelectorAll("[data-cue]")).toHaveLength(0);
  expect(screen.queryByText("Captions show here. Add them in the Captions tab.")).toBeNull();
});

it("a press on the caption clip selects it alone, though it is linked with its clip", () => {
  const store = setup(captionedDoc());
  const clip = captionClip();
  fireEvent.pointerDown(clip, { button: 0, pointerId: 1 });
  expect(store.getState().selection.clipIds).toEqual([clip.dataset.clipId]);
});

it("Split at the playhead cuts the caption clip in two, each with its own lines", () => {
  const store = setup(captionedDoc());
  const id = captionClip().dataset.clipId!;
  act(() => {
    store.getState().select([id]);
    store.getState().seek(90);
  });
  act(() => {
    store.getState().edit([{ op: "split_clip", clipId: id, at: 90 }], "split");
  });
  const pieces = [...document.querySelectorAll<HTMLElement>("[data-clip-id]")].filter((el) => el.querySelector("[data-caption-line]"));
  expect(pieces.map((el) => [...el.querySelectorAll("[data-caption-line]")].map((l) => l.textContent))).toEqual([["hello there."], ["second line"]]);
});

it("captions switched on the old way show as one block per clip; a click moves the playhead to its start", () => {
  const doc = sampleDoc();
  doc.tracks[0].clips = [video("c1", 60, 90, { captions: true })];
  doc.captions = { transcripts: { a: WORDS } };
  const store = setup(doc);
  const blocks = document.querySelectorAll<HTMLElement>("[data-cue]");
  expect(blocks).toHaveLength(1);
  expect([blocks[0].style.left, blocks[0].style.width, blocks[0].title]).toEqual(["120px", "132px", "hello there. second line"]);
  fireEvent.click(blocks[0]);
  expect(store.getState().playhead).toBe(60);
});

it("says where captions come from when there are none", () => {
  setup(sampleDoc());
  expect(screen.getByText("Captions show here. Add them in the Captions tab.")).toBeTruthy();
  expect(screen.queryByText("Captions are not available yet.")).toBeNull();
});
