// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { CutoutSection, Inspector } from "@/components/editor/inspector";
import { MediaProvider } from "@/components/editor/media/media-context";
import { MESSAGES } from "@/lib/editor/messages";
import { CutoutError, type Cutout, type Cutter, type CutoutProgress } from "@/lib/media/cutout/client";
import type { UploadItem } from "@/lib/media/types";
import type { Clip, TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc, video } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";
import { openEverySection } from "../helpers/folds";

// These tests are about what the sections hold, so every section starts open.
beforeEach(openEverySection);

afterEach(cleanup);

function doc(): TimelineDoc {
  const d = sampleDoc();
  d.tracks.splice(1, 0, { id: "o1", kind: "overlay", name: "Overlay 1", muted: false, hidden: false, locked: false, clips: [video("pic", 0, 90, { type: "image", assetId: "photo" })] as Clip[] });
  return d;
}
const PHOTO = assetView({ id: "photo", kind: "image", name: "team photo", fileName: "team photo.jpg", originalFileId: "orig-photo", durationMs: null });
const flush = () => act(async () => {});

// A cutter the test steps through by hand.
function handCutter() {
  let progress: ((p: CutoutProgress) => void) | undefined;
  let finish!: (value: Cutout) => void;
  let refuse!: (error: unknown) => void;
  const cutter: Cutter = {
    cut: vi.fn<Cutter["cut"]>((_file, opts) => {
      progress = opts?.onProgress;
      return new Promise<Cutout>((resolve, reject) => {
        finish = resolve;
        refuse = reject;
        opts?.signal?.addEventListener("abort", () => reject(new CutoutError("cancelled", "Cancelled.")));
      });
    }),
  };
  return { cutter, say: (p: CutoutProgress) => act(() => progress?.(p)), finish: () => finish({ png: new Blob(["png"]), width: 4, height: 4, kept: 0.5 }), refuse: (code: "nothing" | "model") => refuse(new CutoutError(code, "x")) };
}

function show(canEdit = true) {
  const store = makeStore({ doc: doc(), canEdit });
  const services = pretendMediaServices([PHOTO]);
  services.files = { get: async () => ({ ok: true as const, blob: new Blob(["jpeg"]) }), put: async () => {} } as never;
  const added: File[] = [];
  const row = (over: Partial<UploadItem> = {}): UploadItem => ({ key: "row-1", fileName: "x.png", sizeBytes: 3, durationMs: null, stage: "uploading", sentBytes: 0, previewFraction: 0, assetId: null, message: null, canRetry: false, ...over });
  // As the real queue does: a file taken is a row in the library's list at once.
  services.queue = {
    ...services.queue,
    add: (files: File[]) => {
      added.push(...files);
      services.library.setState({ uploads: [row()] });
      return ["row-1"];
    },
  };
  const hand = handCutter();
  render(
    <EditorProvider store={store}>
      <MediaProvider services={services}>
        <CutoutSection clipId="pic" cutter={hand.cutter} />
      </MediaProvider>
    </EditorProvider>,
  );
  // The upload's row, then the new picture ready in the library.
  const arrive = () =>
    act(() => {
      services.library.setState((s) => ({ uploads: [row({ stage: "done", sentBytes: 3, assetId: "cutout-1" })], assets: { ...s.assets, "cutout-1": { ...PHOTO, id: "cutout-1", name: "team photo (cut out)" } } }));
    });
  const clip = () => store.getState().doc.tracks.flatMap((t) => t.clips).find((c) => c.id === "pic") as Clip & { assetId: string };
  const button = () => screen.getByRole("button", { name: "Remove background" }) as HTMLButtonElement;
  return { store, services, added, hand, arrive, clip, button, notices: noticesOf(store) };
}

it("an image clip's inspector has a Background section; a video's has none", () => {
  const store = makeStore({ doc: doc() });
  store.getState().select(["pic"]);
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices([PHOTO, assetView()])}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  expect(screen.getByRole("heading", { name: "Background" })).toBeTruthy();
  expect(screen.getByText(/works on people/)).toBeTruthy();
  act(() => store.getState().select(["c1"]));
  expect(screen.queryByRole("heading", { name: "Background" })).toBeNull();
});

it("says how far it is, uploads the cut-out and switches the clip to it once it is in the library", async () => {
  const { added, hand, arrive, clip, button, notices } = show();
  fireEvent.click(button());
  await flush();
  expect(button().disabled).toBe(true);
  hand.say({ stage: "model", done: 13_000_000, total: 25_888_640 });
  expect(screen.getByRole("status").textContent).toBe("Getting the model: 50% of 26 MB");
  hand.say({ stage: "model", done: 25_888_640, total: 25_888_640 });
  expect(screen.getByRole("status").textContent).toBe("Starting the model…");
  hand.say({ stage: "cutting", done: 0, total: 1 });
  expect(screen.getByRole("status").textContent).toBe("Cutting out…");
  hand.finish();
  await flush();
  expect(added.map((f) => f.name)).toEqual(["team photo (cut out).png"]);
  expect(screen.getByRole("status").textContent).toBe("Saving the cut-out…");
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull(); // the upload is the Media tab's now
  expect(clip().assetId).toBe("photo"); // not before the new picture is ready
  arrive();
  await flush();
  expect(clip().assetId).toBe("cutout-1");
  expect(notices).toEqual([MESSAGES.cutoutDone]);
  expect([button().disabled, screen.queryByRole("status")]).toEqual([false, null]);
});

it("Cancel stops it and changes nothing", async () => {
  const { added, clip, button, notices } = show();
  fireEvent.click(button());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await flush();
  expect([added.length, clip().assetId, notices, button().disabled]).toEqual([0, "photo", [], false]);
});

it("says so when there is no one in the picture", async () => {
  const { hand, clip, button, notices } = show();
  fireEvent.click(button());
  await flush();
  hand.refuse("nothing");
  await flush();
  expect([notices, clip().assetId]).toEqual([[MESSAGES.cutoutNothing], "photo"]);
});

it("is off for someone who can't edit", () => {
  const { button } = show(false);
  expect(button().disabled).toBe(true);
});
