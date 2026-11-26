// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider } from "@/components/editor/media/media-context";
import { FOLDS_KEY } from "@/lib/editor/inspector-folds";
import type { TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, video } from "../editor/fixtures";
import { cleanup, fireEvent, render, screen, within } from "../helpers/dom";
import { forgetFolds } from "../helpers/folds";
import { assetView, pretendMediaServices } from "../helpers/media-services";

beforeEach(forgetFolds);

function show(select: string, change: (d: TimelineDoc) => void = () => {}) {
  const doc = sampleDoc();
  change(doc);
  const store = makeStore({ doc });
  store.getState().select([select]);
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([assetView()])}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  return store;
}

// Each section's heading button, in the order shown: its name and whether it is open.
const sections = () =>
  screen.getAllByRole("heading", { level: 2 }).flatMap((h) => {
    const button = within(h).queryByRole("button");
    return button ? [[h.closest("section")!.dataset.section, button.getAttribute("aria-expanded")]] : [];
  });
const heading = (name: string) => within(screen.getByRole("heading", { name: new RegExp(`^${name}`) })).getByRole("button");

it("a video's sections come by how often they are used, with place, timing and sound open", () => {
  show("c1");
  expect(sections()).toEqual([
    ["position", "true"],
    ["timing", "true"],
    ["speed", "false"],
    ["sound", "true"],
    ["color", "false"],
    ["stylize", "false"],
    ["crop", "false"],
    ["mask", "false"],
    ["blend", "false"],
    ["stabilize", "false"],
    ["reframe", "false"], // the sample's video is wider than this upright project
    ["scenes", "false"],
    ["slot", "false"],
  ]);
  // A folded section's controls are out of the way: not shown, and not reached by Tab.
  expect(screen.queryByRole("button", { name: "Reset color" })).toBeNull();
  expect(screen.getByLabelText("Volume")).toBeTruthy();
});

it("a text opens on its words, place and timing", () => {
  show("x1");
  expect(sections().filter(([, open]) => open === "true").map(([id]) => id)).toEqual(["text", "position", "timing"]);
});

it("a heading opens and folds its section, names what it controls, and the choice is kept for that kind of clip", () => {
  show("c1");
  const color = heading("Color");
  expect(color.getAttribute("aria-expanded")).toBe("false");
  const body = document.getElementById(color.getAttribute("aria-controls")!)!;
  expect(body.hidden).toBe(true);
  fireEvent.click(color);
  expect(heading("Color").getAttribute("aria-expanded")).toBe("true");
  expect(body.hidden).toBe(false);
  expect(screen.getByRole("button", { name: "Reset color" })).toBeTruthy();
  fireEvent.click(heading("Sound"));
  expect(heading("Sound").getAttribute("aria-expanded")).toBe("false");
  expect(JSON.parse(window.localStorage.getItem(FOLDS_KEY)!)).toEqual({ "video.color": true, "video.sound": false });

  // The next time, and for another video, they are as left; a text clip keeps its own.
  cleanup();
  show("c2");
  expect(heading("Color").getAttribute("aria-expanded")).toBe("true");
  expect(heading("Sound").getAttribute("aria-expanded")).toBe("false");
  cleanup();
  show("x1");
  expect(heading("Position").getAttribute("aria-expanded")).toBe("true");
});

it("a folded section says when something in it changes the clip", () => {
  show("c1", (d) => {
    d.tracks[0].clips[0] = video("c1", 0, 30, { speed: 2, blend: "screen" });
  });
  expect(within(heading("Speed")).getByText("Changed")).toBeTruthy();
  expect(heading("Speed").textContent).toContain("Changed: Speed");
  expect(heading("Blend").textContent).toContain("Changed: Blend mode");
  expect(within(heading("Color")).queryByText("Changed")).toBeNull();
  // Open, its own fields say it.
  fireEvent.click(heading("Speed"));
  expect(within(heading("Speed")).queryByText("Changed")).toBeNull();
});

it("a section's actions show only while it is open", () => {
  show("c1");
  // Position's keyframe arrows sit in its heading row.
  expect(screen.getByRole("button", { name: "Previous keyframe" })).toBeTruthy();
  fireEvent.click(heading("Position"));
  expect(screen.queryByRole("button", { name: "Previous keyframe" })).toBeNull();
});

it("the project, a track and several clips have no folds", () => {
  show("c1");
  cleanup();
  const store = makeStore();
  store.getState().select(["c1", "c2"]);
  render(
    <EditorProvider store={store}>
      <Inspector />
    </EditorProvider>,
  );
  expect(screen.getAllByRole("heading").every((h) => within(h).queryByRole("button") === null)).toBe(true);
});
