// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider } from "@/components/editor/media/media-context";
import { MESSAGES } from "@/lib/editor/messages";
import type { MediaClip, TimelineDoc } from "@/lib/timeline";
import { makeStore, noticesOf, sampleDoc } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

afterEach(cleanup);
const flush = () => act(async () => {});

// The sample project is upright (1080 x 1920); its video clip c1 shows the asset "a".
function show(options: { asset?: Parameters<typeof assetView>[0]; change?: (d: TimelineDoc) => void; canEdit?: boolean } = {}) {
  const doc = sampleDoc();
  options.change?.(doc);
  const store = makeStore({ doc, canEdit: options.canEdit ?? true });
  store.getState().select(["c1"]);
  const services = pretendMediaServices([assetView(options.asset)]);
  services.files = { get: async () => ({ ok: false as const, problem: "missing" as never }), put: async () => {} };
  render(
    <EditorProvider store={store}>
      <MediaProvider services={services}>
        <Inspector />
      </MediaProvider>
    </EditorProvider>,
  );
  return { store, notices: noticesOf(store) };
}
const button = () => screen.queryByRole("button", { name: "Reframe to follow the action" }) as HTMLButtonElement | null;

it("a wide video in an upright project can be reframed, and is told it is wider than the frame", () => {
  show();
  expect(screen.getByRole("heading", { name: "Reframe" })).toBeTruthy();
  expect(screen.getByText(/This video is wider than the frame/)).toBeTruthy();
  expect(button()!.disabled).toBe(false);
});

it("an upright video in a wide project is told it is taller", () => {
  show({ asset: { width: 1080, height: 1920 }, change: (d) => Object.assign(d, { format: "long_16x9", width: 1920, height: 1080 }) });
  expect(screen.getByText(/This video is taller than the frame/)).toBeTruthy();
});

it("a video that already has the frame's shape, or whose size is not known, has no Reframe section", () => {
  show({ asset: { width: 1080, height: 1920 } });
  expect(screen.queryByRole("heading", { name: "Reframe" })).toBeNull();
  cleanup();
  show({ asset: { width: null, height: null } });
  expect(screen.queryByRole("heading", { name: "Reframe" })).toBeNull();
});

it("says why a clip that is turned can't be reframed, and changes nothing", async () => {
  const { store, notices } = show({ change: (d) => void ((d.tracks[0].clips[0] as MediaClip).transform.rotation = 10) });
  fireEvent.click(button()!);
  await flush();
  expect(notices).toEqual([MESSAGES.reframeRefused.turned]);
  expect(store.getState().queue).toEqual([]);
});

it("says so when the file can't be read", async () => {
  const { store, notices } = show();
  fireEvent.click(button()!);
  await flush();
  expect(notices).toEqual([MESSAGES.reframeUnreadable]);
  expect(store.getState().queue).toEqual([]);
  expect(button()!.disabled).toBe(false);
});

it("is off for someone who can't edit", () => {
  show({ canEdit: false });
  expect(button()!.disabled).toBe(true);
});
