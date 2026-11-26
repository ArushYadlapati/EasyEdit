// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider } from "@/components/editor/media/media-context";
import { MESSAGES } from "@/lib/editor/messages";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { openEverySection } from "../helpers/folds";

// These tests are about what the sections hold, so every section starts open.
beforeEach(openEverySection);

afterEach(cleanup);

// Two cameras on the same ten seconds: A on the main track, B on an overlay track above it.
function doc(): TimelineDoc {
  const d = sampleDoc();
  d.tracks[0].clips = [video("a", 0, 300)];
  d.tracks[1].clips = [];
  d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Camera B", muted: false, hidden: false, locked: false, clips: [video("b", 0, 300)] });
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
  const rows = () => Object.fromEntries(["v1", "o1"].map((id) => [id, store.getState().doc.tracks.find((t) => t.id === id)!.clips.map((c) => `${c.start}-${c.start + c.duration}:${c.transform.opacity}`)]));
  const cameras = () => within(screen.getByRole("group", { name: "Cut to a camera" })).getAllByRole("button") as HTMLButtonElement[];
  return { store, rows, cameras, notices: noticesOf(store) };
}

it("offers a camera for each track that holds a selected video, the top one first", () => {
  const { cameras } = show(["a", "b"]);
  expect(screen.getByRole("heading", { name: "Multicam" })).toBeTruthy();
  expect(cameras().map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["Cut to 1: Camera B", "false"], ["Cut to 2: Video 1", "false"]]);
  cleanup();
  show(["a", "x1"]); // one camera and a title
  expect(screen.queryByRole("heading", { name: "Multicam" })).toBeNull();
});

it("cuts to a camera at the playhead, shows which one is on, and keeps the cameras selected for the next cut", () => {
  const { store, rows, cameras } = show(["a", "b"]);
  fireEvent.click(cameras()[1]); // open on camera A
  expect(rows()).toEqual({ v1: ["0-300:1"], o1: ["0-300:0"] });
  expect(cameras().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  act(() => store.getState().seek(90));
  fireEvent.click(cameras()[0]); // to B at three seconds
  expect(rows()).toEqual({ v1: ["0-90:1", "90-300:0"], o1: ["0-90:0", "90-300:1"] });
  expect(cameras().map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  act(() => store.getState().seek(150));
  fireEvent.click(cameras()[1]); // back to A at five
  expect(rows()).toEqual({ v1: ["0-90:1", "90-150:0", "150-300:1"], o1: ["0-90:0", "90-150:1", "150-300:0"] });
  expect(store.getState().queue.filter((e) => e.label === "cut to camera")).toHaveLength(3);
  expect(store.getState().selection.clipIds).toHaveLength(6); // every piece of both cameras
  // Each cut is one undo.
  act(() => store.getState().undo());
  expect(rows()).toEqual({ v1: ["0-90:1", "90-300:0"], o1: ["0-90:0", "90-300:1"] });
});

it("says so when the camera already shows, or has no footage there", () => {
  const { store, cameras, notices } = show(["a", "b"]);
  fireEvent.click(cameras()[1]);
  fireEvent.click(cameras()[1]);
  act(() => store.getState().seek(400));
  fireEvent.click(cameras()[0]);
  expect(notices).toEqual([MESSAGES.angleRefused.already, MESSAGES.angleRefused["nothing-here"]]);
});

it("takes the sound from one camera and silences the other", () => {
  const { store } = show(["a", "b"]);
  const from = screen.getByLabelText("Sound from") as HTMLSelectElement;
  expect([...from.options].map((o) => o.text)).toEqual(["Every camera", "1: Camera B", "2: Video 1"]);
  fireEvent.change(from, { target: { value: "v1" } });
  const volumes = () => ["v1", "o1"].map((id) => (store.getState().doc.tracks.find((t) => t.id === id)!.clips[0] as MediaClip).volume);
  expect(volumes()).toEqual([1, 0]);
  expect((screen.getByLabelText("Sound from") as HTMLSelectElement).value).toBe("v1");
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "sound from camera" });
  fireEvent.change(screen.getByLabelText("Sound from"), { target: { value: "o1" } });
  expect(volumes()).toEqual([0, 1]);
});

it("is off for someone who can't edit", () => {
  const { cameras } = show(["a", "b"], false);
  expect(cameras().every((b) => b.disabled)).toBe(true);
  expect((screen.getByLabelText("Sound from") as HTMLSelectElement).disabled).toBe(true);
});
