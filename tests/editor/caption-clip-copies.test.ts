import { expect, it } from "vitest";
import { DEFAULT_BRAND_FONTS } from "@/lib/brand/types";
import { captionOps } from "@/lib/captions/actions";
import { duplicateSelection } from "@/lib/editor/actions";
import { makeStore, sampleDoc, video } from "./fixtures";

const WORDS = [{ t: "hello", s: 0, e: 400 }];

function captioned() {
  const doc = sampleDoc();
  doc.tracks[0].clips = [video("c1", 0, 30)];
  const store = makeStore({ doc });
  expect(store.getState().edit(captionOps(doc, { assetId: "a", words: WORDS, clipIds: ["c1"], fonts: DEFAULT_BRAND_FONTS }), "auto captions").ok).toBe(true);
  return store;
}
const captions = (store: ReturnType<typeof makeStore>) => store.getState().doc.tracks.filter((t) => t.kind === "caption");

it("a duplicated caption clip goes on the Captions track, after the original", () => {
  const store = captioned();
  const cap = captions(store)[0].clips[0];
  store.getState().select([cap.id]);
  duplicateSelection(store);
  expect(captions(store)).toHaveLength(1);
  expect(captions(store)[0].clips.map((c) => [c.type, c.start, c.duration])).toEqual([
    ["caption", 0, 30],
    ["caption", 30, 30],
  ]);
});
