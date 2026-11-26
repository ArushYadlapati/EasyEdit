// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { MediaProvider } from "@/components/editor/media/media-context";
import { TimelineFileDialog, type TimelineFileMode } from "@/components/editor/timeline-file-dialog";
import { writeFcp7 } from "@/lib/interchange/fcp7";
import type { Sequence } from "@/lib/interchange/model";
import { createEmptyDoc, type TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, video } from "../editor/fixtures";
import { fireEvent, render, screen, waitFor } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

afterEach(() => vi.restoreAllMocks());

const CUT: Sequence = {
  name: "Rough cut",
  fps: 30,
  width: 1920,
  height: 1080,
  clips: [
    { name: "intake", fileName: "intake.mp4", kind: "video", track: 0, start: 0, duration: 2, in: 1, speed: 1, sound: true },
    { name: "b roll", fileName: "B roll.mov", kind: "video", track: 0, start: 2, duration: 1, in: 0, speed: 1 },
  ],
  markers: [{ at: 1, name: "Hook" }],
  notes: [],
};
const xmlFile = (name = "cut.xml") => new File([writeFcp7(CUT, 30, { width: 1920, height: 1080 })], name, { type: "application/xml" });

function show(mode: TimelineFileMode, opts: { doc?: TimelineDoc; canEdit?: boolean } = {}) {
  const store = makeStore({ doc: opts.doc ?? createEmptyDoc("long_16x9"), canEdit: opts.canEdit ?? true });
  const onClose = vi.fn();
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([assetView()])}>
        <TimelineFileDialog mode={mode} onClose={onClose} />
      </MediaProvider>
    </EditorProvider>,
  );
  return { store, onClose, notices: noticesOf(store) };
}
const choose = (file: File) => fireEvent.change(screen.getByLabelText("Timeline file"), { target: { files: [file] } });

it("shows what a timeline would bring in before anything changes, then imports it as one change", async () => {
  const { store, onClose, notices } = show("import");
  const importButton = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
  expect(importButton.disabled).toBe(true);
  choose(xmlFile());
  await waitFor(() => expect(importButton.disabled).toBe(false));
  expect(screen.getByText("cut.xml")).toBeTruthy();
  expect(screen.getByText(/2 clips on 1 video track and 0 audio tracks, with 1 marker\. 1 of 2 found their file in the library\./)).toBeTruthy();
  expect(screen.getByText(/Not in the library \(1\)/)).toBeTruthy();
  expect(screen.getByText("B roll.mov")).toBeTruthy();
  // Nothing has changed yet.
  expect(store.getState().doc.tracks[0].clips).toEqual([]);
  fireEvent.click(importButton);
  const clips = store.getState().doc.tracks[0].clips;
  expect(clips.map((c) => [c.type, c.start, c.duration])).toEqual([["video", 0, 60], ["placeholder", 60, 30]]);
  expect(clips[0]).toMatchObject({ assetId: "a", in: 30, volume: 1 });
  expect(store.getState().doc.markers).toMatchObject([{ at: 30, name: "Hook" }]);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "import timeline" });
  expect(notices).toEqual(["Imported 2 clips."]);
  expect(onClose).toHaveBeenCalledTimes(1);
  store.getState().undo();
  expect(store.getState().doc.tracks[0].clips).toEqual([]);
  expect(store.getState().doc.markers).toBeUndefined();
});

it("says what is wrong with a file that is no timeline, and keeps Import off", async () => {
  show("import");
  choose(new File(["just my notes"], "notes.txt"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("not a timeline this can read"));
  expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  // A second file replaces the first one's answer.
  choose(xmlFile("second.xml"));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText("second.xml")).toBeTruthy();
});

it("writes the project's cut in the chosen format, with a note of what stays behind", () => {
  const doc = createEmptyDoc("long_16x9");
  doc.tracks[0].clips = [video("c1", 0, 60, { in: 30 })];
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cut");
  const clicked: { download: string; href: string }[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href });
  });
  const { onClose } = show("export", { doc, canEdit: false });
  expect(screen.getByText("1 clip will be written.")).toBeTruthy();
  expect(screen.getByText(/Relink the media by file name in the other program\./)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download .xml" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "EDL" }));
  expect(screen.getByText(/one video track and its cuts/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Download .edl" }));
  expect(clicked).toEqual([{ download: "Qual recap.edl", href: "blob:cut" }]);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("has nothing to write for a project with no media, and nothing shows while closed", () => {
  const { unmount } = render(<TimelineFileDialog mode={null} onClose={() => {}} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  unmount();
  show("export");
  expect(screen.getByText("This project has no video, image or audio clips to write.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Download .xml" }) as HTMLButtonElement).disabled).toBe(true);
});
