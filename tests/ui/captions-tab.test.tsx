// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/editor/brand/brand-context";
import { CaptionsProvider } from "@/components/editor/captions/captions-context";
import { EditorProvider } from "@/components/editor/context";
import { LeftPanel } from "@/components/editor/left-panel";
import { MediaProvider } from "@/components/editor/media/media-context";
import { ContextMenuProvider } from "@/components/ui/context-menu";
import { captionOps, type AutoCaptionDeps } from "@/lib/captions/actions";
import { TranscribeError, type TranscribeProgress, type Transcriber } from "@/lib/captions/speech/client";
import { DEFAULT_BRAND_KIT, type BrandKit } from "@/lib/brand/types";
import { findClip } from "@/lib/editor/store";
import type { AssetView } from "@/lib/media/types";
import { applyOps, prepareOps, type CaptionWord, type Clip, type TimelineDoc } from "@/lib/timeline";
import { makeStore, sampleDoc, video } from "../editor/fixtures";
import { act, fireEvent, render, screen, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

const w = (t: string, s: number, e: number): CaptionWord => ({ t, s, e });
// Two lines: a sentence ends after "there." At 30 fps the second starts at frame 30, 0:01.
const WORDS = [w("hello", 0, 400), w("there.", 450, 900), w("second", 1000, 1400), w("line", 1450, 1800)];
const KIT: BrandKit = { ...DEFAULT_BRAND_KIT, fonts: { title: "Orbitron", subtitle: "Geist", body: "Inter" } };
const INTAKE = assetView({ id: "a", name: "intake" });

// sampleDoc (c1 and c2, both of "a", and a Captions track) with captions on for c1 and c1 made long enough to play all
// the words.
function captionedDoc(): TimelineDoc {
  const doc = sampleDoc();
  doc.tracks[0].clips = [video("c1", 0, 90), video("c2", 90, 30)];
  return applyOps(doc, prepareOps(captionOps(doc, { assetId: "a", words: WORDS, clipIds: ["c1"], fonts: KIT.fonts }), () => "g")).doc;
}

// A transcriber the test drives: each call waits until answered, and reports progress when told to.
function drivenTranscriber() {
  const calls: { signal?: AbortSignal; progress(p: TranscribeProgress): void; answer(words: CaptionWord[] | TranscribeError): void }[] = [];
  const transcriber: Transcriber = {
    transcribe: (_file, opts = {}) =>
      new Promise<CaptionWord[]>((resolve, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new TranscribeError("cancelled", "x")));
        calls.push({
          signal: opts.signal,
          progress: (p) => opts.onProgress?.(p),
          answer: (a) => (a instanceof TranscribeError ? reject(a) : resolve(a)),
        });
      }),
  };
  return { transcriber, calls };
}

function setup(options: { canEdit?: boolean; doc?: TimelineDoc; assets?: AssetView[]; deps?: Partial<AutoCaptionDeps> } = {}) {
  const { canEdit = true, doc = sampleDoc(), assets = [INTAKE] } = options;
  const store = makeStore({ canEdit, doc });
  const driven = drivenTranscriber();
  const deps: AutoCaptionDeps = {
    transcriber: driven.transcriber,
    fetchSaved: vi.fn(async () => null),
    save: vi.fn(async () => true),
    files: { get: async (fileId) => ({ ok: true, blob: new Blob([fileId]) }), put: async () => {} },
    assets: () => Object.fromEntries(assets.map((a) => [a.id, a])),
    ensure: async () => [],
    fonts: () => KIT.fonts,
    ...options.deps,
  };
  render(
    <EditorProvider store={store}>
      <MediaProvider services={pretendMediaServices(assets)}>
        <BrandProvider spaceId="team1" canEdit={canEdit} initial={KIT} api={{ fetch: vi.fn(), save: vi.fn() }}>
          <CaptionsProvider deps={deps}>
            <ContextMenuProvider>
              <LeftPanel />
            </ContextMenuProvider>
          </CaptionsProvider>
        </BrandProvider>
      </MediaProvider>
    </EditorProvider>,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Captions" }));
  return { store, deps, calls: driven.calls };
}

const autoButton = () => screen.getByRole("button", { name: "Auto captions" }) as HTMLButtonElement;
const flush = () => act(async () => {});
const clipOf = (doc: TimelineDoc, id: string) => findClip(doc, id)!.clip as Clip & { captions?: boolean };

it("lists Captions as the third tab", () => {
  setup();
  expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Text", "Media", "Captions", "Brand kit"]);
});

it("says what Auto captions works on, from the selection", () => {
  const { store } = setup();
  expect(screen.getByText("Captions every clip with sound.")).toBeTruthy();
  expect(autoButton().disabled).toBe(false);
  act(() => store.getState().select(["c1", "x1"]));
  expect(screen.getByText("Captions the selected clips.")).toBeTruthy();
  expect(autoButton().disabled).toBe(false);
  // Only other kinds of clip selected: nothing to caption, and no falling back to the whole project.
  act(() => store.getState().select(["x1"]));
  expect(screen.getByText("Select a video or audio clip, or select nothing to caption every clip with sound.")).toBeTruthy();
  expect(autoButton().disabled).toBe(true);
});

it("asks for a video or audio clip in a project with none", () => {
  const doc = sampleDoc();
  doc.tracks[0].clips = [];
  setup({ doc });
  expect(screen.getByText("Add a video or audio clip to caption it.")).toBeTruthy();
  expect(autoButton().disabled).toBe(true);
});

it("disables the caption buttons while editing is blocked: a project deleted elsewhere, or a drag", () => {
  const { store } = setup({ doc: captionedDoc() });
  act(() => store.getState().select(["c1"]));
  const buttons = () => ["Auto captions", "Transcribe again", "Remove captions"].map((name) => screen.getByRole("button", { name }) as HTMLButtonElement);
  expect(buttons().map((b) => b.disabled)).toEqual([false, false, false]);
  act(() => void store.getState().setGesture([{ op: "move_clip", clipId: "c2", start: 100 }]));
  expect(buttons().map((b) => b.disabled)).toEqual([true, true, true]);
  act(() => void store.getState().setGesture(null));
  act(() => store.getState().setStatus("deleted"));
  expect(buttons().map((b) => b.disabled)).toEqual([true, true, true]);
});

it("disables Auto captions for a viewer", () => {
  setup({ canEdit: false });
  expect(autoButton().disabled).toBe(true);
});

it("disables Auto captions in a project with no video or audio clip", () => {
  const doc = sampleDoc();
  doc.tracks[0].clips = [];
  setup({ doc });
  expect(autoButton().disabled).toBe(true);
});

it("shows each stage while it runs, and captions the file when the words come", async () => {
  const { store, calls } = setup({ deps: { fetchSaved: vi.fn(async () => null) } });
  fireEvent.click(autoButton());
  expect(autoButton().disabled).toBe(true);
  await flush();
  expect(calls).toHaveLength(1);

  act(() => calls[0].progress({ stage: "model", done: 42, total: 100 }));
  expect(screen.getByText("Getting the speech model… 42%")).toBeTruthy();
  act(() => calls[0].progress({ stage: "sound", done: 0, total: 185 }));
  expect(screen.getByText("Reading the sound…")).toBeTruthy();
  act(() => calls[0].progress({ stage: "speech", done: 70, total: 185 }));
  expect(screen.getByText("Listening… 1:10 of 3:05")).toBeTruthy();

  calls[0].answer(WORDS);
  await flush();
  expect(autoButton().disabled).toBe(false);
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  expect(store.getState().undoStack.map((e) => e.label)).toEqual(["auto captions"]);
  expect(clipOf(store.getState().doc, "c1").captions).toBe(true);
});

it("says it is checking for saved captions while it asks, using them only once found, and names the file when there are several", async () => {
  const answers: ((words: CaptionWord[] | null) => void)[] = [];
  const doc = sampleDoc();
  doc.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, { assetId: "b" })];
  const { calls } = setup({
    doc,
    assets: [INTAKE, assetView({ id: "b", name: "speech" })],
    deps: { fetchSaved: vi.fn(() => new Promise<CaptionWord[] | null>((resolve) => answers.push(resolve))) },
  });
  fireEvent.click(autoButton());
  await flush();
  expect(screen.getByText("Checking for saved captions…")).toBeTruthy();
  expect(screen.queryByText("Using saved captions…")).toBeNull();
  expect(screen.getByText("1 of 2 · intake")).toBeTruthy();
  // None saved for the first file: it is heard, and "Using saved captions…" never shows.
  await act(async () => answers[0](null));
  expect(screen.queryByText("Using saved captions…")).toBeNull();
  expect(screen.getByText("Reading the sound…")).toBeTruthy();
  await act(async () => calls[0].answer(WORDS));
  expect(screen.getByText("2 of 2 · speech")).toBeTruthy();
  expect(screen.getByText("Checking for saved captions…")).toBeTruthy();
});

it("says the model is a one-time download only once getting it has taken more than 2 seconds", async () => {
  const { calls } = setup();
  fireEvent.click(autoButton());
  await flush();
  vi.useFakeTimers();
  try {
    act(() => calls[0].progress({ stage: "model", done: 0, total: 100 }));
    expect(screen.queryByText("A one-time download.")).toBeNull();
    act(() => vi.advanceTimersByTime(1500));
    act(() => calls[0].progress({ stage: "model", done: 60, total: 100 }));
    expect(screen.queryByText("A one-time download.")).toBeNull();
    act(() => vi.advanceTimersByTime(600));
    expect(screen.getByText("A one-time download.")).toBeTruthy();
    act(() => calls[0].progress({ stage: "sound", done: 0, total: 185 }));
    expect(screen.queryByText("A one-time download.")).toBeNull();
    // A model stage that ends quickly (the model is already in the browser) never shows it.
    act(() => calls[0].progress({ stage: "model", done: 100, total: 100 }));
    act(() => vi.advanceTimersByTime(1000));
    act(() => calls[0].progress({ stage: "speech", done: 0, total: 185 }));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("A one-time download.")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it("Cancel stops the run, changes nothing and lets it start again", async () => {
  const { store, calls } = setup();
  fireEvent.click(autoButton());
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await flush();
  expect(calls[0].signal?.aborted).toBe(true);
  expect(store.getState().queue).toEqual([]);
  expect(autoButton().disabled).toBe(false);
});

it("shows a failure as an alert and says when a file has no speech", async () => {
  const doc = sampleDoc();
  doc.tracks[0].clips = [video("c1", 0, 30), video("c2", 30, 30, { assetId: "b" })];
  const { store, calls } = setup({ doc, assets: [INTAKE, assetView({ id: "b", name: "b-roll", hasAudio: false })] });
  fireEvent.click(autoButton());
  await flush();
  calls[0].answer(new TranscribeError("model", "x"));
  await flush();
  expect(screen.getByRole("alert").textContent).toBe("Couldn't caption intake: the speech model couldn't be loaded.");
  expect(store.getState().notice).toMatchObject({ tone: "info", text: "No speech found in b-roll." });
  expect(store.getState().queue).toEqual([]);
});

it("offers Transcribe again and Remove captions for selected captioned clips", async () => {
  const { store, calls } = setup({ doc: captionedDoc() });
  expect(screen.queryByRole("button", { name: "Remove captions" })).toBeNull();
  act(() => store.getState().select(["c1"]));
  fireEvent.click(screen.getByRole("button", { name: "Remove captions" }));
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "remove captions", ops: [{ op: "update_clip", clipId: "c1", patch: { captions: false } }] });

  act(() => store.getState().undo());
  fireEvent.click(screen.getByRole("button", { name: "Transcribe again" }));
  await flush();
  expect(calls).toHaveLength(1); // the saved words were not asked for
});

it("shows the style only once the project has captions", () => {
  setup();
  expect(screen.queryByRole("button", { name: "Karaoke" })).toBeNull();
});

it("changes the look, size, position and case of the captions", () => {
  const { store } = setup({ doc: captionedDoc() });
  const last = () => store.getState().queue.at(-1);
  const karaoke = screen.getByRole("button", { name: "Karaoke" });
  expect(karaoke.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "One word" }));
  expect(last()).toMatchObject({ label: "caption style", ops: [{ op: "set_caption_style", patch: { preset: "word" } }] });
  expect(screen.getByRole("button", { name: "One word" }).getAttribute("aria-pressed")).toBe("true");

  const size = screen.getByLabelText("Size");
  fireEvent.change(size, { target: { value: "90" } });
  fireEvent.keyDown(size, { key: "Enter" });
  expect(last()).toMatchObject({ label: "caption style", ops: [{ op: "set_caption_style", patch: { fontSize: 90 } }] });

  fireEvent.change(screen.getByLabelText("Position"), { target: { value: "30" } });
  expect(last()).toMatchObject({ ops: [{ op: "set_caption_style", patch: { y: 0.3 } }] });

  fireEvent.click(screen.getByLabelText("Uppercase"));
  expect(last()).toMatchObject({ ops: [{ op: "set_caption_style", patch: { uppercase: true } }] });

  fireEvent.change(screen.getByLabelText("Font"), { target: { value: "Anton" } });
  expect(last()).toMatchObject({ ops: [{ op: "set_caption_style", patch: { fontFamily: "Anton", fontWeight: 400 } }] });

  fireEvent.change(screen.getByLabelText("Highlight color hex"), { target: { value: "#00ff00" } });
  fireEvent.keyDown(screen.getByLabelText("Highlight color hex"), { key: "Enter" });
  expect(last()).toMatchObject({ ops: [{ op: "set_caption_style", patch: { highlight: "#00ff00" } }] });
  expect(store.getState().queue.every((e) => e.label === "auto captions" || e.label === "caption style")).toBe(true);
});

it("lists the caption lines in order; a time goes there", () => {
  const { store } = setup({ doc: captionedDoc() });
  const lines = screen.getAllByRole("textbox", { name: /^Caption at / }) as HTMLInputElement[];
  expect(lines.map((l) => l.value)).toEqual(["hello there.", "second line"]);
  fireEvent.click(screen.getByRole("button", { name: "0:01" }));
  expect(store.getState().playhead).toBe(30);
});

it("Enter saves a retyped line as one edit; Escape puts it back", () => {
  const { store } = setup({ doc: captionedDoc() });
  const line = () => screen.getAllByRole("textbox", { name: /^Caption at / })[1] as HTMLInputElement;
  fireEvent.change(line(), { target: { value: "second time" } });
  fireEvent.keyDown(line(), { key: "Escape" });
  expect(line().value).toBe("second line");
  fireEvent.blur(line());
  expect(store.getState().queue).toEqual([]);

  fireEvent.change(line(), { target: { value: "second time" } });
  fireEvent.keyDown(line(), { key: "Enter" });
  expect(store.getState().queue).toMatchObject([
    { label: "edit caption", ops: [{ op: "splice_caption_words", assetId: "a", index: 2, remove: 2, insert: [w("second", 1000, 1400), w("time", 1450, 1800)] }] },
  ]);
  expect(line().value).toBe("second time");
});

it("says so when a typed fix can't be applied because the line changed meanwhile", () => {
  const { store } = setup({ doc: captionedDoc() });
  const line = () => screen.getAllByRole("textbox", { name: /^Caption at / })[1] as HTMLInputElement;
  fireEvent.change(line(), { target: { value: "second time" } });
  // A teammate fixes the same words first.
  const fixed = [...WORDS.slice(0, 2), w("secant", 1000, 1400), w("line", 1450, 1800)];
  act(() => void store.getState().edit([{ op: "set_transcript", assetId: "a", words: fixed }], "edit caption"));
  const queued = store.getState().queue.length;
  fireEvent.keyDown(line(), { key: "Enter" });
  expect(store.getState().queue).toHaveLength(queued);
  expect(store.getState().doc.captions?.transcripts?.a).toEqual(fixed);
  expect(store.getState().notice).toMatchObject({ tone: "info", text: "That caption changed while you were typing. Try again." });
  expect(line().value).toBe("secant line");
});

it("says when there are no captions yet", () => {
  setup();
  expect(screen.getByText("No captions yet.")).toBeTruthy();
});

it("disables every control for a viewer", () => {
  const { store } = setup({ canEdit: false, doc: captionedDoc() });
  act(() => store.getState().select(["c1"]));
  const panel = screen.getByRole("tabpanel");
  const controls = panel.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("[data-edit-control]");
  expect(controls.length).toBeGreaterThan(10);
  for (const control of controls) expect(control.disabled).toBe(true);
  expect(within(panel).getByRole("button", { name: "Remove captions" }).hasAttribute("disabled")).toBe(true);
});

it("Cut video turns each line's words into buttons, and the picked words are cut out of the video", () => {
  const { store } = setup({ doc: captionedDoc() });
  // Fix words is the first mode: the lines are boxes to retype.
  expect(screen.getByRole("textbox", { name: "Caption at 0:00" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Cut video" }));
  expect(screen.queryByRole("textbox", { name: "Caption at 0:00" })).toBeNull();
  const cut = () => screen.getByRole("button", { name: /^Cut (\d+ )?words?$/ }) as HTMLButtonElement;
  expect(cut().disabled).toBe(true);
  const second = within(screen.getByRole("group", { name: "Words at 0:01" }));
  fireEvent.click(second.getByRole("button", { name: "second" }));
  fireEvent.click(second.getByRole("button", { name: "line" }));
  expect(second.getByRole("button", { name: "second" }).getAttribute("aria-pressed")).toBe("true");
  expect(cut().textContent).toBe("Cut 2 words");
  fireEvent.click(second.getByRole("button", { name: "line" })); // unpicked again
  expect(cut().textContent).toBe("Cut 1 word");
  fireEvent.click(cut());
  // "second" ran from frame 30 to 42 of c1: twelve frames are gone and c2 moved up.
  const clips = store.getState().doc.tracks[0].clips;
  expect(clips.map((c) => [c.start, c.duration])).toEqual([[0, 30], [30, 48], [78, 30]]);
  expect(store.getState().queue.at(-1)).toMatchObject({ label: "cut words" });
  expect(screen.queryByRole("button", { name: "second" })).toBeNull();
  expect(cut().disabled).toBe(true);
});

it("Cut pauses and Cut filler words say so when there is nothing to cut, and a viewer cannot cut", () => {
  const { store } = setup({ doc: captionedDoc() });
  fireEvent.click(screen.getByRole("radio", { name: "Cut video" }));
  fireEvent.click(screen.getByRole("button", { name: "Cut pauses" }));
  expect(store.getState().notice?.text).toBe("No long pauses to cut.");
  fireEvent.click(screen.getByRole("button", { name: "Cut filler words" }));
  expect(store.getState().notice?.text).toBe("No filler words to cut.");
  expect(store.getState().queue).toHaveLength(0);
});

it("a viewer sees the words but cannot pick or cut them", () => {
  setup({ doc: captionedDoc(), canEdit: false });
  fireEvent.click(screen.getByRole("radio", { name: "Cut video" }));
  expect((screen.getByRole("button", { name: "second" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Cut pauses" }) as HTMLButtonElement).disabled).toBe(true);
});

it("captions download as subtitle files once there are lines, and import needs one clip that sounds", () => {
  const { store } = setup({ doc: captionedDoc() });
  expect((screen.getByRole("button", { name: "Download .srt" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Download .vtt" }) as HTMLButtonElement).disabled).toBe(false);
  const importButton = () => screen.getByRole("button", { name: "Import subtitles" }) as HTMLButtonElement;
  expect(importButton().disabled).toBe(true);
  act(() => store.getState().select(["c2"]));
  expect(importButton().disabled).toBe(false);
  act(() => store.getState().select(["x1"]));
  expect(importButton().disabled).toBe(true);
});

it("a project with no captions has nothing to download", () => {
  setup();
  expect((screen.getByRole("button", { name: "Download .srt" }) as HTMLButtonElement).disabled).toBe(true);
});

it("an imported subtitle file becomes the selected clip's captions", async () => {
  const { store } = setup();
  act(() => store.getState().select(["c1"]));
  const file = new File(["1\n00:00:00,000 --> 00:00:00,900\nfrom a file\n"], "subs.srt");
  fireEvent.change(screen.getByLabelText("Subtitle file"), { target: { files: [file] } });
  await flush();
  await flush();
  expect(clipOf(store.getState().doc, "c1").captions).toBe(true);
  expect(store.getState().notice?.text).toBe("Imported 1 line of captions.");
  expect((screen.getByRole("textbox", { name: "Caption at 0:00" }) as HTMLInputElement).value).toBe("from a file");
});
