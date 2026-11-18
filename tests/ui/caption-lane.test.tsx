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

it("shows each caption line as a block on the Captions track, where and as long as it shows", () => {
  setup(captionedDoc());
  const first = screen.getByTitle("hello there.");
  const second = screen.getByTitle("second line");
  // "hello there." runs from frame 60 until the next line starts at 90; "second line" stays 12 frames (400 ms) after
  // its last word ends at frame 114, so until 126. Two pixels a frame.
  expect([first.style.left, first.style.width]).toEqual(["120px", "60px"]);
  expect([second.style.left, second.style.width]).toEqual(["180px", "72px"]);
  expect([first.style.top, first.style.height]).toEqual([`${CLIP_TOP}px`, `${CLIP_HEIGHT}px`]);
  expect(first.closest("[role=group]")?.getAttribute("aria-label")).toBe("Captions");
  expect(screen.queryByText("Captions show here. Add them in the Captions tab.")).toBeNull();
});

it("a click on a line moves the playhead to its start", () => {
  const store = setup(captionedDoc());
  fireEvent.click(screen.getByTitle("second line"));
  expect(store.getState().playhead).toBe(90);
});

it("says where captions come from when there are none", () => {
  setup(sampleDoc());
  expect(screen.getByText("Captions show here. Add them in the Captions tab.")).toBeTruthy();
  expect(screen.queryByText("Captions are not available yet.")).toBeNull();
});
