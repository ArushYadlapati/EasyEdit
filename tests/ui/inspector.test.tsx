// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/editor/brand/brand-context";
import { EditorProvider } from "@/components/editor/context";
import { FONT_LIST } from "@/lib/brand/fonts";
import { DEFAULT_BRAND_KIT } from "@/lib/brand/types";
import { Inspector } from "@/components/editor/inspector";
import { MediaProvider, type MediaServices } from "@/components/editor/media/media-context";
import { MESSAGES, explainOpError } from "@/lib/editor/messages";
import { DEFAULT_PREFS, createSettingsStore } from "@/lib/editor/settings";
import { findClip, viewDoc } from "@/lib/editor/store";
import { LIMITS } from "@/lib/limits";
import { DEFAULT_TRANSFORM, isCropped } from "@/lib/timeline";
import { entry, makeStore, sampleDoc, text, video } from "../editor/fixtures";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

it("previews while typing and saves one change on blur", () => {
  const store = makeStore();
  store.getState().select(["x1"]);
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  const field = screen.getByLabelText("Text");
  fireEvent.change(field, { target: { value: "GO" } });
  expect(findClip(viewDoc(store.getState()), "x1")!.clip).toMatchObject({ text: "GO" });
  expect(store.getState().queue).toEqual([]);
  fireEvent.blur(field);
  expect(store.getState().queue).toMatchObject([{ label: "text edit", ops: [{ op: "update_clip", clipId: "x1", patch: { text: "GO" } }] }]);
});

it("shows the project with nothing selected, and switches the format", () => {
  const store = makeStore();
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  expect(screen.getByText("Select a clip to edit it.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Format"), { target: { value: "long_16x9" } });
  expect(store.getState().doc).toMatchObject({ format: "long_16x9", width: 1920, height: 1080 });
  expect(store.getState().queue).toMatchObject([{ label: "format change" }]);
});

it("with nothing selected a custom project shows its width and height", () => {
  const custom = { ...sampleDoc(), format: "custom" as const, width: 816, height: 1056 };
  const store = makeStore({ doc: custom });
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  expect((screen.getByRole("combobox", { name: "Format" }) as HTMLSelectElement).value).toBe("custom");
  expect((screen.getByLabelText("Width") as HTMLInputElement).value).toBe("816");
  expect((screen.getByLabelText("Height") as HTMLInputElement).value).toBe("1056");
});

it("a viewer sees a custom project's size in the inspector", () => {
  const custom = { ...sampleDoc(), format: "custom" as const, width: 816, height: 1056 };
  const store = makeStore({ doc: custom, canEdit: false });
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  expect((screen.getByLabelText("Width") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Height") as HTMLInputElement).disabled).toBe(true);
});

it("saves the clamped value when a size above the maximum is confirmed with Enter", () => {
  const store = makeStore();
  store.getState().select(["x1"]);
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  const size = screen.getByLabelText("Size");
  fireEvent.change(size, { target: { value: "5000" } });
  fireEvent.keyDown(size, { key: "Enter" });
  expect(store.getState().gesture).toBeNull();
  expect(store.getState().queue).toMatchObject([
    { label: "style change", ops: [{ op: "update_clip", clipId: "x1", patch: { style: { fontSize: 1000 } } }] },
  ]);
  expect(findClip(store.getState().doc, "x1")!.clip).toMatchObject({ style: { fontSize: 1000 } });
});

it("a refused text says so on blur and shows the saved text again", () => {
  const store = makeStore();
  store.getState().select(["x1"]);
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  const field = screen.getByLabelText("Text") as HTMLTextAreaElement;
  fireEvent.change(field, { target: { value: "a\u0000b" } });
  fireEvent.blur(field);
  expect(store.getState().notice).toMatchObject({ tone: "error", text: explainOpError("INVALID") });
  expect(store.getState().queue).toEqual([]);
  expect(store.getState().gesture).toBeNull();
  expect(field.value).toBe("hi");
});

it("edits a selected track through the track commands", () => {
  const store = makeStore();
  store.getState().selectTrack("t1");
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  expect(screen.getByText("Text · 2 clips")).toBeTruthy();
  expect(screen.queryByRole("switch", { name: "Muted" })).toBeNull();
  const name = screen.getByLabelText("Name");
  fireEvent.change(name, { target: { value: "Titles" } });
  expect(fireEvent.keyDown(name, { key: "Enter" })).toBe(false);
  fireEvent.blur(name);
  fireEvent.click(screen.getByRole("switch", { name: "Locked" }));
  expect(store.getState().queue.map((e) => e.label)).toEqual(["rename track", "track change"]);
  expect(store.getState().doc.tracks[1]).toMatchObject({ name: "Titles", locked: true });
  expect((screen.getByRole("button", { name: "Remove track" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Unlock the track to remove it.")).toBeTruthy();
});

it("a viewer sees the values with every edit control disabled", () => {
  const store = makeStore({ canEdit: false });
  store.getState().select(["x1"]);
  const { container } = render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  expect((screen.getByLabelText("Text") as HTMLTextAreaElement).value).toBe("hi");
  expect((screen.getByLabelText("Size") as HTMLInputElement).value).toBe("64");
  const controls = [...container.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input, select, textarea")];
  expect(controls.length).toBeGreaterThan(10);
  for (const control of controls) {
    expect(control.hasAttribute("data-edit-control")).toBe(true);
    expect(control.disabled).toBe(true);
  }
});

it("a clip removed by someone else while its field is typed in ends the edit", () => {
  const store = makeStore();
  store.getState().select(["x1"]);
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  fireEvent.change(screen.getByLabelText("Text"), { target: { value: "GO" } });
  act(() => {
    store.getState().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x1" }])]);
  });
  expect(store.getState().gesture).toBeNull();
  expect(store.getState().notice).toMatchObject({ text: MESSAGES.clipGone });
  expect(screen.getByText("Select a clip to edit it.")).toBeTruthy();
  expect(store.getState().queue).toEqual([]);
});

it("the color swatch previews while it moves and saves once when it closes; a bad hex value is reported", () => {
  const store = makeStore();
  store.getState().select(["x1"]);
  render(<EditorProvider store={store}><Inspector /></EditorProvider>);
  const swatch = screen.getByLabelText("Color");
  fireEvent.input(swatch, { target: { value: "#ff0000" } });
  expect(findClip(viewDoc(store.getState()), "x1")!.clip).toMatchObject({ style: { color: "#ff0000" } });
  expect(store.getState().queue).toEqual([]);
  fireEvent.change(swatch);
  expect(store.getState().gesture).toBeNull();
  expect(store.getState().queue).toMatchObject([{ label: "style change", ops: [{ patch: { style: { color: "#ff0000" } } }] }]);

  const hex = screen.getByLabelText("Hex color") as HTMLInputElement;
  fireEvent.change(hex, { target: { value: "red" } });
  fireEvent.keyDown(hex, { key: "Enter" });
  expect(store.getState().notice).toMatchObject({ tone: "error", text: explainOpError("INVALID") });
  expect(hex.value).toBe("#ff0000");
  expect(store.getState().queue).toHaveLength(1);
});

describe("fix round 1", () => {
  function setup(select: { clip?: string; track?: string } = { clip: "x1" }) {
    const store = makeStore();
    if (select.clip) store.getState().select([select.clip]);
    if (select.track) store.getState().selectTrack(select.track);
    render(<EditorProvider store={store}><Inspector /></EditorProvider>);
    return store;
  }
  const clipOf = (store: ReturnType<typeof makeStore>, id: string) => findClip(store.getState().doc, id)!.clip;
  const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  it.each([
    ["Size", "72", { op: "update_clip", clipId: "x1", patch: { style: { fontSize: 72 } } }, "style change"],
    ["Start", "0.5", { op: "move_clip", clipId: "x1", start: 15 }, "timing change"],
  ] as const)("an in-range %s confirmed with Enter is saved as one edit", (label, value, op, editLabel) => {
    const store = setup();
    fireEvent.change(input(label), { target: { value } });
    expect(store.getState().queue).toEqual([]);
    fireEvent.keyDown(input(label), { key: "Enter" });
    expect(store.getState().gesture).toBeNull();
    expect(store.getState().queue).toMatchObject([{ label: editLabel, ops: [op] }]);
    expect(input(label).value).toBe(value);
  });

  it.each([
    ["X", "270", { transform: { x: 0.25 } }],
    ["Opacity", "40", { transform: { opacity: 0.4 } }],
  ] as const)("an in-range %s is saved on blur", (label, value, patch) => {
    const store = setup();
    fireEvent.change(input(label), { target: { value } });
    expect(store.getState().queue).toEqual([]);
    fireEvent.blur(input(label));
    expect(store.getState().gesture).toBeNull();
    expect(store.getState().queue).toMatchObject([{ label: "position change", ops: [{ op: "update_clip", clipId: "x1", patch }] }]);
    expect(input(label).value).toBe(value);
  });

  it("a time that rounds to the current frame saves nothing and says nothing", () => {
    const store = setup({ clip: "x2" });
    fireEvent.change(input("Start"), { target: { value: "3.01" } });
    fireEvent.keyDown(input("Start"), { key: "Enter" });
    expect(store.getState().queue).toEqual([]);
    expect(store.getState().notice).toBeNull();
    expect(store.getState().gesture).toBeNull();
  });

  it("a number that is not plain decimal is refused, not read as hex", () => {
    const store = setup();
    fireEvent.change(input("Start"), { target: { value: "0x10" } });
    expect(store.getState().gesture).toBeNull();
    fireEvent.keyDown(input("Start"), { key: "Enter" });
    expect(store.getState().queue).toEqual([]);
    expect(store.getState().notice).toMatchObject({ tone: "error", text: explainOpError("INVALID") });
    expect(clipOf(store, "x1").start).toBe(0);
  });

  it.each([["Text", "GO", { text: "GO" }, "text edit"], ["Size", "72", { style: { fontSize: 72 } }, "style change"]] as const)(
    "a %s typed and left by selecting another clip is saved",
    (label, value, patch, editLabel) => {
      const store = setup();
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      act(() => store.getState().select(["x2"]));
      expect(store.getState().gesture).toBeNull();
      expect(store.getState().queue).toMatchObject([{ label: editLabel, ops: [{ op: "update_clip", clipId: "x1", patch }] }]);
      expect(clipOf(store, "x2")).toMatchObject({ text: "hi", style: { fontSize: 64 } });
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe(label === "Text" ? "hi" : "64");
    },
  );

  it("a draft left by selecting a track is saved too", () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "GO" } });
    act(() => store.getState().selectTrack("v1"));
    expect(store.getState().gesture).toBeNull();
    expect(store.getState().queue).toMatchObject([{ label: "text edit" }]);
  });

  it("a remote removal while a number is typed saves nothing and does not throw", () => {
    const store = setup();
    fireEvent.change(input("Size"), { target: { value: "72" } });
    act(() => {
      store.getState().applyRemote([entry(6, [{ op: "remove_clip", clipId: "x1" }])]);
    });
    expect(store.getState().gesture).toBeNull();
    expect(store.getState().queue).toEqual([]);
    expect(screen.getByText("Select a clip to edit it.")).toBeTruthy();
  });

  it("a text field saves only the gesture it started", () => {
    const store = setup();
    const field = screen.getByLabelText("Text");
    fireEvent.change(field, { target: { value: "GO" } });
    act(() => {
      store.getState().setGesture([{ op: "move_clip", clipId: "c1", start: 200 }]);
    });
    fireEvent.blur(field);
    expect(store.getState().queue).toEqual([]);
    expect(store.getState().gesture?.ops).toMatchObject([{ op: "move_clip", clipId: "c1" }]);
  });

  it.each([
    ["Text", "GO", "hi"],
    ["Size", "72", "64"],
    ["Hex color", "#00ff00", "#ffffff"],
  ])("Escape in %s puts the saved value back and saves nothing", (label, value, saved) => {
    const store = setup();
    const field = screen.getByLabelText(label) as HTMLInputElement;
    fireEvent.change(field, { target: { value } });
    expect(store.getState().gesture).not.toBeNull();
    expect(fireEvent.keyDown(field, { key: "Escape" })).toBe(false);
    expect(field.value).toBe(saved);
    expect(store.getState().gesture).toBeNull();
    fireEvent.blur(field);
    expect(store.getState().queue).toEqual([]);
  });

  it("two fields edited one after the other give two edits, each with its own label", () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "GO" } });
    fireEvent.blur(screen.getByLabelText("Text"));
    fireEvent.change(input("Rotation"), { target: { value: "-45" } });
    fireEvent.blur(input("Rotation"));
    expect(store.getState().queue).toMatchObject([
      { label: "text edit", ops: [{ op: "update_clip", clipId: "x1", patch: { text: "GO" } }] },
      { label: "position change", ops: [{ op: "update_clip", clipId: "x1", patch: { transform: { rotation: -45 } } }] },
    ]);
  });

  it("Weight and Align each send one edit", () => {
    const store = setup();
    fireEvent.change(screen.getByLabelText("Weight"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("radio", { name: "Left" }));
    expect(store.getState().queue).toMatchObject([
      { label: "style change", ops: [{ op: "update_clip", clipId: "x1", patch: { style: { fontWeight: 500 } } }] },
      { label: "style change", ops: [{ op: "update_clip", clipId: "x1", patch: { style: { align: "left" } } }] },
    ]);
    expect(store.getState().queue).toHaveLength(2);
  });

  it("Hidden and Muted each send one edit, and Remove track removes the track", () => {
    const store = setup({ track: "v1" });
    fireEvent.click(screen.getByRole("switch", { name: "Hidden" }));
    fireEvent.click(screen.getByRole("switch", { name: "Muted" }));
    expect(store.getState().queue).toMatchObject([
      { label: "track change", ops: [{ op: "update_track", trackId: "v1", patch: { hidden: true } }] },
      { label: "track change", ops: [{ op: "update_track", trackId: "v1", patch: { muted: true } }] },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove track" }));
    expect(store.getState().queue).toHaveLength(3);
    expect(store.getState().queue[2]).toMatchObject({ label: "remove track", ops: [{ op: "remove_track", trackId: "v1" }] });
    expect(store.getState().doc.tracks.some((t) => t.id === "v1")).toBe(false);
  });

  it("Escape on the track name keeps the old name, and the name is limited to the track name length", () => {
    const store = setup({ track: "t1" });
    const name = input("Name");
    expect(name.maxLength).toBe(LIMITS.trackNameChars);
    fireEvent.change(name, { target: { value: "Titles" } });
    expect(fireEvent.keyDown(name, { key: "Escape" })).toBe(false);
    expect(name.value).toBe("Text 1");
    fireEvent.blur(name);
    expect(store.getState().queue).toEqual([]);
    expect(store.getState().doc.tracks[1].name).toBe("Text 1");
  });

  it.each([
    ["cap", 0, "Captions · No clips"],
    ["t1", 1, "Text · 1 clip"],
    ["t1", 3, "Text · 3 clips"],
  ] as const)("counts the clips of a track (%s, %i)", (trackId, clips, line) => {
    const store = makeStore();
    if (trackId === "t1" && clips === 1) store.getState().edit([{ op: "remove_clip", clipId: "x2" }], "delete");
    if (clips === 3) store.getState().edit([{ op: "add_clip", trackId: "t1", clip: text("x3", 200, 30) }], "add");
    store.getState().selectTrack(trackId);
    render(<EditorProvider store={store}><Inspector /></EditorProvider>);
    expect(screen.getByText(line)).toBeTruthy();
  });
});

describe("media", () => {
  function showMedia(media: MediaServices, store = makeStore(), clipId = "c1") {
    store.getState().select([clipId]);
    const view = render(
      <EditorProvider store={store}>
        <MediaProvider services={media}>
          <Inspector />
        </MediaProvider>
      </EditorProvider>,
    );
    const section = () => screen.getByRole("heading", { name: "Media" }).parentElement!;
    // What each caption of the section reads, in order.
    const facts = () => Object.fromEntries([...section().querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]));
    return { view, section, facts, store };
  }

  it("a media clip shows its file and length", () => {
    const ready = showMedia(pretendMediaServices([assetView({ name: "intake", durationMs: 12_500 })]));
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual(["Video clip", "Media"]);
    expect(ready.facts()).toEqual({ File: "intake", "Media length": "0:12" });
    expect(ready.section().querySelector("input, textarea, select, button")).toBeNull();
    expect(screen.getByLabelText("Length")).toBeTruthy(); // the Timing section's field keeps its name
    ready.view.unmount();

    const removed = showMedia(pretendMediaServices([assetView({ removed: true })]));
    expect(removed.facts().File).toBe("Media removed");
    removed.view.unmount();

    const media = pretendMediaServices([], { loaded: false });
    const unknown = showMedia(media);
    expect(unknown.facts()).toEqual({ File: "Loading" });
    act(() => media.library.setState({ loaded: true }));
    expect(unknown.facts()).toEqual({ File: "Media not found" });
    unknown.view.unmount();

    const doc = sampleDoc();
    doc.tracks[0].clips[0] = video("c1", 0, 30, { type: "image" });
    // An image has no length, even when the library would give one.
    const image = showMedia(pretendMediaServices([assetView({ kind: "image", name: "logo", durationMs: 5_000 })]), makeStore({ doc }));
    expect(screen.getByRole("heading", { name: "Image" })).toBeTruthy();
    expect(image.facts()).toEqual({ File: "logo" });
    expect(within(image.section()).queryByText("Media length")).toBeNull();
  });

  it("a typed length stops at the end of the media", () => {
    // c2, at 30, is 30 frames from the start of a 2 s video (60 frames at 30 fps): it can end at 90 at the latest.
    const { store } = showMedia(pretendMediaServices([assetView({ durationMs: 2_000 })]), makeStore(), "c2");
    const length = screen.getByLabelText("Length");
    fireEvent.change(length, { target: { value: "10" } });
    fireEvent.keyDown(length, { key: "Enter" });
    expect(store.getState().queue).toMatchObject([{ label: "timing change", ops: [{ op: "trim_clip", clipId: "c2", edge: "end", to: 90 }] }]);
  });
});

describe("position and size in your units", () => {
  function setup(clipId = "x1", settings = createSettingsStore({ prefs: DEFAULT_PREFS })) {
    const store = makeStore();
    store.getState().select([clipId]);
    render(<EditorProvider store={store} settings={settings}><Inspector /></EditorProvider>);
    return { store, settings };
  }
  const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
  const lock = () => screen.getByRole("button", { name: "Lock aspect ratio" });
  const saved = (store: ReturnType<typeof makeStore>) => findClip(store.getState().doc, "x1")!.clip.transform;

  it("Width and Height show the drawn size, and the lock keeps the shape", () => {
    const { store, settings } = setup();
    expect(input("Width").value).toBe("64");
    expect(input("Height").value).toBe("77");
    fireEvent.change(input("Width"), { target: { value: "128" } });
    expect(findClip(viewDoc(store.getState()), "x1")!.clip.transform.scale).toBe(2); // previewed while typing
    expect(store.getState().queue).toEqual([]);
    fireEvent.keyDown(input("Width"), { key: "Enter" });
    expect(store.getState().queue.at(-1)).toMatchObject({ label: "size change" });
    expect(saved(store).scale).toBe(2);
    expect(input("Height").value).toBe("154");

    fireEvent.click(lock());
    expect(lock().getAttribute("aria-pressed")).toBe("false");
    expect(settings.getState().lockAspect).toBe(false);
    fireEvent.change(input("Width"), { target: { value: "64" } });
    fireEvent.keyDown(input("Width"), { key: "Enter" });
    expect(saved(store).stretch).toBe(0.5);
    expect(input("Width").value).toBe("64");
    expect(input("Height").value).toBe("154");
    expect(store.getState().queue.map((e) => e.label)).toEqual(["size change", "size change"]);
  });

  it("unlocked, Height changes the scale and keeps the width", () => {
    const { store, settings } = setup();
    act(() => settings.getState().set({ lockAspect: false }));
    fireEvent.change(input("Height"), { target: { value: "38.4" } });
    fireEvent.keyDown(input("Height"), { key: "Enter" });
    expect(saved(store)).toMatchObject({ scale: 0.5, stretch: 2 });
    expect(input("Width").value).toBe("64");
    expect(input("Height").value).toBe("38");
  });

  it("a placeholder video is as big as the frame", () => {
    setup("c1");
    expect(input("Width").value).toBe("1080");
    expect(input("Height").value).toBe("1920");
  });

  it("a video is its library size fitted to the frame, and follows the library when the size arrives", () => {
    const store = makeStore();
    store.getState().select(["c1"]);
    const media = pretendMediaServices([assetView({ width: null, height: null })]);
    render(
      <EditorProvider store={store}>
        <MediaProvider services={media}>
          <Inspector />
        </MediaProvider>
      </EditorProvider>,
    );
    expect(input("Width").value).toBe("1080");
    expect(input("Height").value).toBe("1920");
    // A 1920 × 1080 video covers the 1080 × 1920 frame: 1920 tall, 3413 wide.
    act(() => media.library.setState({ assets: { a: assetView({ width: 1920, height: 1080 }) } }));
    expect(input("Width").value).toBe("3413");
    expect(input("Height").value).toBe("1920");
  });

  it("units follow Settings", () => {
    const { store } = setup("x1", createSettingsStore({ prefs: { ...DEFAULT_PREFS, units: "in" } }));
    expect(input("Y").value).toBe("10");
    expect(input("Y").parentElement!.textContent).toContain("in");
    fireEvent.keyDown(input("Y"), { key: "ArrowUp" });
    expect(saved(store).y).toBe(0.505);
    expect(input("Y").value).toBe("10.1");
  });

  it("in pixels an arrow moves the clip a pixel", () => {
    const { store } = setup();
    expect(input("X").parentElement!.textContent).toContain("px");
    fireEvent.keyDown(input("X"), { key: "ArrowUp" });
    expect(saved(store).x).toBe(0.500926);
    expect(input("X").value).toBe("541");
  });

  it("a units change in Settings shows at once", () => {
    const { settings } = setup();
    expect(input("X").value).toBe("540");
    act(() => settings.getState().set({ units: "cm" }));
    expect(input("X").value).toBe("14.29");
    expect(input("Width").parentElement!.textContent).toContain("cm");
  });

  it("the lock starts on", () => {
    setup();
    expect(lock().getAttribute("aria-pressed")).toBe("true");
  });

  it("the lock is between Width and Height", () => {
    setup();
    const section = screen.getByRole("heading", { name: "Position" }).parentElement!;
    const names = [...section.querySelectorAll("input, button")].map((c) => c.getAttribute("aria-label"));
    expect(names).toEqual(["X", "Y", "Width", "Lock aspect ratio", "Height", "Scale", "Rotation", "Opacity"]);
  });
});

describe("drag a value to change it", () => {
  // Animation frames run when frame() says.
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  beforeEach(() => {
    frames = new Map();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.set(++nextFrame, cb);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const frame = () =>
    act(() => {
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(0);
    });

  function setup(clipId = "x1", over: { canEdit?: boolean; settings?: ReturnType<typeof createSettingsStore> } = {}) {
    const store = makeStore({ canEdit: over.canEdit ?? true });
    store.getState().select([clipId]);
    render(
      <EditorProvider store={store} settings={over.settings ?? createSettingsStore({ prefs: DEFAULT_PREFS })}>
        <Inspector />
      </EditorProvider>,
    );
    const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    const press = (label: string) => fireEvent.pointerDown(input(label), { button: 0, pointerId: 1, clientX: 100 });
    const move = (label: string, dx: number) => {
      fireEvent.pointerMove(input(label), { pointerId: 1, clientX: 100 + dx });
      frame();
    };
    const release = (label: string, dx: number) => fireEvent.pointerUp(input(label), { pointerId: 1, clientX: 100 + dx });
    const shown = (id = clipId) => findClip(viewDoc(store.getState()), id)!.clip;
    const labels = () => store.getState().queue.map((e) => e.label);
    return { store, input, press, move, release, shown, labels };
  }

  it("dragging the X value saves one position change", () => {
    const { store, input, press, move, release, shown, labels } = setup();
    press("X");
    move("X", 20);
    expect(shown().transform.x).toBe(0.518519);
    expect(input("X").value).toBe("560");
    expect(store.getState().queue).toEqual([]);
    release("X", 20);
    expect(labels()).toEqual(["position change"]);
    expect(store.getState().queue[0].ops).toMatchObject([{ op: "update_clip", clipId: "x1", patch: { transform: { x: 0.518519 } } }]);
    expect(store.getState().gesture).toBeNull();
    expect(input("X").value).toBe("560");
  });

  it("Escape mid-drag puts it back", () => {
    const { store, input, press, move, release, shown } = setup();
    press("X");
    move("X", 20);
    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
    expect(store.getState().gesture).toBeNull();
    expect(shown().transform.x).toBe(0.5);
    expect(input("X").value).toBe("540");
    release("X", 20);
    expect(store.getState().queue).toEqual([]);
    expect(findClip(store.getState().doc, "x1")!.clip.transform.x).toBe(0.5);
  });

  it("a draft in Y is saved before a drag on X starts", () => {
    const { store, input, press, move, release } = setup();
    input("Y").focus();
    fireEvent.change(input("Y"), { target: { value: "1000" } });
    press("X");
    expect(store.getState().queue).toMatchObject([{ label: "position change", ops: [{ patch: { transform: { y: 0.520833 } } }] }]);
    move("X", 20);
    release("X", 20);
    expect(store.getState().queue).toMatchObject([
      { label: "position change", ops: [{ patch: { transform: { y: 0.520833 } } }] },
      { label: "position change", ops: [{ patch: { transform: { x: 0.518519 } } }] },
    ]);
  });

  it("scrubbing Start stops at the clip before it", () => {
    const { store, input, press, move, release, labels } = setup("x2");
    expect(input("Start").value).toBe("3");
    press("Start");
    move("Start", -5);
    expect(input("Start").value).toBe("2.83"); // a frame a pixel, to two places
    move("Start", -40);
    expect(input("Start").value).toBe("2");
    release("Start", -40);
    expect(labels()).toEqual(["timing change"]);
    expect(findClip(store.getState().doc, "x2")!.clip.start).toBe(60);
  });

  it("Start's limits are read when the press starts", () => {
    const { store, input, press, move } = setup("x2");
    // Someone else shortens x1 to end at 75, after the field was drawn.
    act(() => {
      store.getState().applyRemote([entry(6, [{ op: "trim_clip", clipId: "x1", edge: "end", to: 75 }])]);
    });
    press("Start");
    move("Start", -40);
    expect(input("Start").value).toBe("2.5");
  });

  it("Length stops at the clip after it", () => {
    const { input, press, move, shown } = setup("c1");
    expect(input("Length").value).toBe("1");
    press("Length");
    move("Length", 40);
    expect(input("Length").value).toBe("1");
    move("Length", -6);
    expect(input("Length").value).toBe("0.8");
    expect(shown("c1").duration).toBe(24);
  });

  it("a dragged Length stops at the end of the media", () => {
    // c2, at 30, is 30 frames from the start of a 2 s video: it can end at 90 at the latest.
    const store = makeStore();
    store.getState().select(["c2"]);
    render(
      <EditorProvider store={store}>
        <MediaProvider services={pretendMediaServices([assetView({ durationMs: 2_000 })])}>
          <Inspector />
        </MediaProvider>
      </EditorProvider>,
    );
    const length = screen.getByLabelText("Length") as HTMLInputElement;
    fireEvent.pointerDown(length, { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(length, { pointerId: 1, clientX: 200 });
    frame();
    expect(length.value).toBe("2");
    fireEvent.pointerUp(length, { pointerId: 1, clientX: 200 });
    expect(store.getState().queue).toMatchObject([{ label: "timing change", ops: [{ op: "trim_clip", clipId: "c2", edge: "end", to: 90 }] }]);
  });

  it("a cm scrub shows two decimals", () => {
    const { input, press, move } = setup("x1", { settings: createSettingsStore({ prefs: { ...DEFAULT_PREFS, units: "cm" } }) });
    expect(input("X").value).toBe("14.29");
    press("X");
    move("X", 10);
    expect(input("X").value).toBe("14.55");
  });

  it("Size, Scale, Rotation and Opacity move one a pixel, to one place", () => {
    const { store, input, press, move, release, shown } = setup();
    const drag = (label: string, dx: number, init: object = {}) => {
      press(label);
      fireEvent.pointerMove(input(label), { pointerId: 1, clientX: 100 + dx, ...init });
      frame();
      release(label, dx);
    };
    drag("Size", 8);
    drag("Rotation", 15, { ctrlKey: true });
    drag("Opacity", -25);
    drag("Scale", 7, { ctrlKey: true });
    expect(input("Rotation").value).toBe("1.5");
    expect(shown()).toMatchObject({ style: { fontSize: 72 }, transform: { rotation: 1.5, opacity: 0.75 } });
    expect(shown().transform.scale).toBe(1.007);
    expect(store.getState().queue.map((e) => e.label)).toEqual(["style change", "position change", "position change", "size change"]);
    move("X", 0); // nothing held
  });

  it("a size that cannot apply stays at the last one that did", () => {
    const { store, input, press, move, release, shown } = setup();
    expect(input("Width").value).toBe("64");
    press("Width");
    move("Width", -60);
    expect(input("Width").value).toBe("4");
    expect(shown().transform.scale).toBe(0.0625);
    move("Width", -70);
    expect(input("Width").value).toBe("4");
    expect(shown().transform.scale).toBe(0.0625); // the picture stays with the number
    release("Width", -70);
    expect(store.getState().queue).toMatchObject([{ label: "size change", ops: [{ patch: { transform: { scale: 0.0625 } } }] }]);
    expect(store.getState().notice).toBeNull();
  });

  it("a viewer cannot drag a value", () => {
    const { store, input, press, move, release } = setup("x1", { canEdit: false });
    press("X");
    move("X", 20);
    expect(store.getState().gesture).toBeNull();
    expect(input("X").value).toBe("540");
    release("X", 20);
    expect(store.getState().queue).toEqual([]);
  });
});

describe("crop numbers and Reset crop", () => {
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  beforeEach(() => {
    frames = new Map();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frames.set(++nextFrame, cb);
      return nextFrame;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const frame = () =>
    act(() => {
      const due = [...frames.values()];
      frames.clear();
      for (const cb of due) cb(0);
    });

  function setup(clipId = "x1", canEdit = true) {
    const store = makeStore({ canEdit });
    store.getState().select([clipId]);
    render(<EditorProvider store={store}><Inspector /></EditorProvider>);
    const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
    const reset = () => screen.getByRole("button", { name: "Reset crop" }) as HTMLButtonElement;
    const crop = () => findClip(store.getState().doc, clipId)!.clip.transform.crop;
    const labels = () => store.getState().queue.map((e) => e.label);
    return { store, input, reset, crop, labels };
  }

  it("Crop left 10 crops one side in one change", () => {
    const { store, input, reset, crop, labels } = setup();
    expect(["Crop left", "Crop top", "Crop right", "Crop bottom"].map((l) => input(l).value)).toEqual(["0", "0", "0", "0"]);
    expect(reset().disabled).toBe(true);
    fireEvent.change(input("Crop left"), { target: { value: "10" } });
    fireEvent.keyDown(input("Crop left"), { key: "Enter" });
    expect(labels()).toEqual(["crop"]);
    expect(store.getState().queue[0].ops).toMatchObject([
      { op: "update_clip", clipId: "x1", patch: { transform: { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } } } },
    ]);
    expect(input("Crop left").value).toBe("10");
    expect(reset().disabled).toBe(false);
    fireEvent.click(reset());
    expect(labels()).toEqual(["crop", "crop"]);
    expect(isCropped(crop())).toBe(false);
    expect(input("Crop left").value).toBe("0");
    expect(reset().disabled).toBe(true);
  });

  it("a typed side above 95 is not previewed, and saves as 95", () => {
    const { store, input, crop } = setup("c1");
    fireEvent.change(input("Crop left"), { target: { value: "99" } });
    expect(store.getState().gesture).toBeNull();
    fireEvent.keyDown(input("Crop left"), { key: "Enter" });
    expect(crop()).toEqual({ left: 0.95, top: 0, right: 0, bottom: 0 });
  });

  it("a typed side stops where its opposite leaves 5%", () => {
    const { input, crop } = setup("c1");
    fireEvent.change(input("Crop right"), { target: { value: "30" } });
    fireEvent.blur(input("Crop right"));
    fireEvent.change(input("Crop left"), { target: { value: "90" } });
    fireEvent.keyDown(input("Crop left"), { key: "Enter" });
    expect(crop()).toEqual({ left: 0.65, top: 0, right: 0.3, bottom: 0 });
    expect(input("Crop left").value).toBe("65");
  });

  it("dragging Crop left 20 px crops 10%", () => {
    const { store, input, crop, labels } = setup();
    fireEvent.pointerDown(input("Crop left"), { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(input("Crop left"), { pointerId: 1, clientX: 120 });
    frame();
    expect(input("Crop left").value).toBe("10");
    expect(findClip(viewDoc(store.getState()), "x1")!.clip.transform.crop).toEqual({ left: 0.1, top: 0, right: 0, bottom: 0 });
    fireEvent.pointerUp(input("Crop left"), { pointerId: 1, clientX: 120 });
    expect(crop()!.left).toBe(0.1);
    expect(labels()).toEqual(["crop"]);
  });

  it("each side reads in percent, and a fine drag keeps one place", () => {
    const { input, crop } = setup();
    expect(input("Crop bottom").parentElement!.textContent).toContain("%");
    fireEvent.pointerDown(input("Crop top"), { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(input("Crop top"), { pointerId: 1, clientX: 105, ctrlKey: true });
    frame();
    expect(input("Crop top").value).toBe("0.3");
    fireEvent.pointerUp(input("Crop top"), { pointerId: 1, clientX: 105, ctrlKey: true });
    expect(crop()).toEqual({ left: 0, top: 0.003, right: 0, bottom: 0 });
  });

  it("a dragged side stops where its opposite leaves 5%, read when the press starts", () => {
    const { store, input, crop } = setup();
    act(() => {
      store.getState().edit([{ op: "update_clip", clipId: "x1", patch: { transform: { crop: { left: 0, top: 0, right: 0.5, bottom: 0 } } } }], "crop");
    });
    fireEvent.pointerDown(input("Crop left"), { button: 0, pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(input("Crop left"), { pointerId: 1, clientX: 300 });
    frame();
    expect(input("Crop left").value).toBe("45");
    fireEvent.pointerUp(input("Crop left"), { pointerId: 1, clientX: 300 });
    expect(crop()).toEqual({ left: 0.45, top: 0, right: 0.5, bottom: 0 });
  });

  it("a viewer sees the crop and cannot reset it", () => {
    const doc = sampleDoc();
    doc.tracks[0].clips[0] = video("c1", 0, 30, { transform: { ...DEFAULT_TRANSFORM, crop: { left: 0, top: 0.25, right: 0, bottom: 0 } } });
    const store = makeStore({ doc, canEdit: false });
    store.getState().select(["c1"]);
    render(<EditorProvider store={store}><Inspector /></EditorProvider>);
    expect((screen.getByLabelText("Crop top") as HTMLInputElement).value).toBe("25");
    const reset = screen.getByRole("button", { name: "Reset crop" }) as HTMLButtonElement;
    expect(reset.hasAttribute("data-edit-control")).toBe(true);
    expect(reset.disabled).toBe(true);
  });

  it("an audio clip has no crop", () => {
    const doc = sampleDoc();
    doc.tracks[3].clips = [video("au", 0, 30, { type: "audio" })];
    const store = makeStore({ doc });
    store.getState().select(["au"]);
    render(<EditorProvider store={store}><Inspector /></EditorProvider>);
    expect(screen.queryByLabelText("Crop left")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reset crop" })).toBeNull();
  });
});

describe("the Font menu", () => {
  function setup(clip = text("x1", 0, 60), canEdit = true) {
    const doc = sampleDoc();
    doc.tracks[1].clips = [clip];
    const store = makeStore({ doc, canEdit });
    store.getState().select(["x1"]);
    const initial = { ...DEFAULT_BRAND_KIT, fonts: { title: "Orbitron", subtitle: "Geist", body: "Inter" } };
    render(
      <EditorProvider store={store}>
        <BrandProvider spaceId="team1" canEdit={canEdit} initial={initial} api={{ fetch: vi.fn(), save: vi.fn() }}><Inspector /></BrandProvider>
      </EditorProvider>,
    );
    return store;
  }
  const fontMenu = () => screen.getByLabelText("Font") as HTMLSelectElement;

  it("lists the kit fonts first, then every font", () => {
    setup();
    const groups = [...fontMenu().querySelectorAll("optgroup")];
    expect(groups.map((g) => g.label)).toEqual(["Brand kit", "All fonts"]);
    expect([...groups[0].querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Title · Orbitron", "Subtitle · Geist", "Body · Inter"]);
    expect(groups[1].querySelectorAll("option").length).toBe(FONT_LIST.length);
    expect(fontMenu().value).toBe("Geist");
  });

  it("choosing a font sends one edit and snaps the weight", () => {
    const store = setup();
    fireEvent.change(fontMenu(), { target: { value: "Bebas Neue" } });
    expect(store.getState().queue).toMatchObject([
      { label: "style change", ops: [{ op: "update_clip", clipId: "x1", patch: { style: { fontFamily: "Bebas Neue", fontWeight: 400 } } }] },
    ]);
    expect([...(screen.getByLabelText("Weight") as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["Regular"]);
  });

  it("the menu shows the clip's font by its name, not as a kit role it may not have come from", () => {
    setup(); // Geist, which is also the kit's Subtitle font
    expect(fontMenu().selectedOptions[0].textContent).toBe("Geist");
    expect(fontMenu().selectedOptions[0].parentElement?.getAttribute("label")).toBe("All fonts");
  });

  it("choosing a kit role's font sets that font", () => {
    const store = setup();
    const title = [...fontMenu().querySelectorAll("option")].find((o) => o.textContent === "Title · Orbitron")!;
    fireEvent.change(fontMenu(), { target: { value: title.value } });
    expect(store.getState().queue).toMatchObject([
      { label: "style change", ops: [{ op: "update_clip", clipId: "x1", patch: { style: { fontFamily: "Orbitron" } } }] },
    ]);
    expect(fontMenu().selectedOptions[0].textContent).toBe("Orbitron");
  });

  it("an unlisted font shows as the selected entry", () => {
    setup(text("x1", 0, 60, { style: { fontFamily: "Comic Sans MS", fontSize: 64, fontWeight: 700, color: "#ffffff", align: "center" } }));
    expect(fontMenu().value).toBe("Comic Sans MS");
    expect((screen.getByLabelText("Weight") as HTMLSelectElement).options).toHaveLength(5);
  });

  it("a viewer's Font menu is disabled", () => {
    setup(text("x1", 0, 60), false);
    expect(fontMenu().disabled).toBe(true);
  });
});
