// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider } from "@/components/editor/media/media-context";
import type { NestClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, text, video } from "../editor/fixtures";
import { cleanup, fireEvent, render, screen } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { openEverySection } from "../helpers/folds";

// These tests are about what the sections hold, so every section starts open.
beforeEach(openEverySection);

afterEach(cleanup);

// v1 [c1 0–30, c2 30–60] · t1 [x1 10–50]
function doc(): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30)];
  d.tracks[1].clips = [text("x1", 10, 40, { text: "Intro" })];
  return d;
}
function show(select: string[], canEdit = true) {
  const store = makeStore({ doc: doc(), canEdit });
  store.getState().select(select);
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([assetView()])}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  const nest = () => store.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.type === "nest") as NestClip | undefined;
  return { store, nest };
}

it("several clips selected can be made one nest, which is then what is selected and shown", () => {
  const { store, nest } = show(["c1", "c2", "x1"]);
  fireEvent.click(screen.getByRole("button", { name: "Nest clips" }));
  expect(nest()).toMatchObject({ start: 0, duration: 60, in: 0 });
  expect(store.getState().selection.clipIds).toEqual([nest()!.id]);
  expect(screen.getByRole("heading", { name: "Nest of 3 clips" })).toBeTruthy();
  expect(screen.getByText("3 clips on 2 tracks, drawn together as one picture. It plays 2.0 s of the 2.0 s it holds.")).toBeTruthy();
});

it("a nest has a volume of its own, takes a place, colours and a mask as a picture does, and has no crop or speed", () => {
  const { nest } = show(["c1", "c2", "x1"]);
  fireEvent.click(screen.getByRole("button", { name: "Nest clips" }));
  const volume = screen.getByLabelText("Volume") as HTMLInputElement;
  expect(volume.value).toBe("100");
  fireEvent.change(volume, { target: { value: "50" } });
  fireEvent.blur(volume);
  expect(nest()!.volume).toBe(0.5);
  for (const title of ["Color", "Mask"]) expect(screen.getByRole("heading", { name: title })).toBeTruthy();
  expect(screen.getByLabelText("Scale")).toBeTruthy();
  for (const title of ["Crop", "Speed", "Sound", "Scenes"]) expect(screen.queryByRole("heading", { name: title })).toBeNull();
  expect(screen.queryByRole("switch", { name: "Green screen" })).toBeNull();
});

it("Unnest puts the clips back and selects them", () => {
  const { store, nest } = show(["c1", "c2", "x1"]);
  fireEvent.click(screen.getByRole("button", { name: "Nest clips" }));
  fireEvent.click(screen.getByRole("button", { name: "Unnest" }));
  expect(nest()).toBeUndefined();
  expect(store.getState().selection.clipIds).toHaveLength(3);
  expect(store.getState().doc.tracks.map((t) => t.clips.map((c) => `${c.start}-${c.start + c.duration}`))).toEqual([["0-30", "30-60"], ["10-50"], [], []]);
  expect(screen.getByText("3 clips selected")).toBeTruthy();
});

it("is off for someone who can't edit", () => {
  show(["c1", "c2"], false);
  expect((screen.getByRole("button", { name: "Nest clips" }) as HTMLButtonElement).disabled).toBe(true);
});
