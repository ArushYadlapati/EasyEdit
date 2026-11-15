// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { EditorScreen } from "@/components/editor/editor-screen";
import { collectPageFonts, loadFonts, loadFontsStrict } from "@/components/editor/page-fonts";
import { Preview } from "@/components/editor/preview";
import { PROBE_BASE, type FontRule } from "@/lib/export/fonts";
import { makeStore, sampleDoc } from "../editor/fixtures";
import { act, render } from "../helpers/dom";
import { fakeCtx } from "../render/fake-ctx";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as { fonts?: unknown }).fonts;
});

const stubFonts = (load: (font: string, text: string) => Promise<unknown>) => {
  const fn = vi.fn(load);
  Object.defineProperty(document, "fonts", { value: { load: fn }, configurable: true });
  return fn;
};
const GEIST = '700 100px "Geist", sans-serif'; // in happy-dom the font variable is unset, so the resolver falls back

it("the preview asks for the font faces that its clips' own characters need", () => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const load = stubFonts(async () => []);
  const store = makeStore();
  act(() => {
    store.getState().edit([{ op: "update_clip", clipId: "x1", patch: { text: "Žofia" } }], "text");
  });
  render(<EditorProvider store={store}><EditorScreen spaceSlug="seattle-solvers" /></EditorProvider>);
  // both text clips are Geist 700: "Žofia" adds Ž, and the other clip's "hi" adds h
  expect(load).toHaveBeenCalledWith(GEIST, `${PROBE_BASE}Žh`);
  // a new character asks again, by font and text together; a redraw of the same text asks nothing
  act(() => {
    store.getState().edit([{ op: "update_clip", clipId: "x1", patch: { text: "Žofia Q" } }], "text");
  });
  expect(load).toHaveBeenCalledWith(GEIST, `${PROBE_BASE}ŽQh`);
  const asked = load.mock.calls.length;
  act(() => store.getState().seek(1));
  expect(load.mock.calls.length).toBe(asked);
});

it("the strict loader refuses a face that did not load; the other never refuses", async () => {
  const request = [{ font: GEIST, text: "hi" }];
  await expect(loadFontsStrict(request)).rejects.toThrow(); // no document.fonts at all
  await expect(loadFonts(request)).resolves.toBeUndefined();
  stubFonts(async () => [{ status: "error" }]);
  await expect(loadFontsStrict(request)).rejects.toThrow();
  stubFonts(async () => { throw new Error("NetworkError"); });
  await expect(loadFontsStrict(request)).rejects.toThrow();
  await expect(loadFonts(request)).resolves.toBeUndefined();
  stubFonts(async () => [{ status: "loaded" }]);
  await expect(loadFontsStrict(request)).resolves.toBeUndefined();
  stubFonts(async () => []); // a font only the computer has, or none: nothing to load
  await expect(loadFontsStrict(request)).resolves.toBeUndefined();
});

it("the strict loader lets a face of an installed font fail, but not a face with a file to fetch", async () => {
  const rules: FontRule[] = [
    { family: "Geist", src: 'url("/g.woff2") format("woff2")', baseUrl: "https://app.test/a.css", descriptors: {} },
    { family: "Geist Fallback", src: 'local("Arial")', baseUrl: "https://app.test/a.css", descriptors: {} },
  ];
  const request = [{ font: '700 100px "Geist", "Geist Fallback"', text: "hi" }];
  // Chrome without Arial: any load that names the fallback rejects
  const load = stubFonts(async (font) => {
    if (font.includes("Geist Fallback")) throw new DOMException("x", "NetworkError");
    return [{ status: "loaded" }];
  });
  await expect(loadFontsStrict(request, rules)).resolves.toBeUndefined();
  expect(load).toHaveBeenCalledWith('700 100px "Geist"', "hi");
  stubFonts(async (font) => (font.includes("Geist Fallback") ? [] : [{ status: "error" }]));
  await expect(loadFontsStrict(request, rules)).rejects.toThrow();
});

// Added beyond the brief: each catches the removal of one rule of the strict loader the test above leaves unchecked.

it("the strict loader still asks for the whole font as the preview does, and asks nothing strict of an installed-only font", async () => {
  const rules: FontRule[] = [
    { family: "Geist", src: 'url("/g.woff2") format("woff2")', baseUrl: "https://app.test/a.css", descriptors: {} },
    { family: "Geist Fallback", src: 'local("Arial")', baseUrl: "https://app.test/a.css", descriptors: {} },
  ];
  let load = stubFonts(async () => [{ status: "loaded" }]);
  await loadFontsStrict([{ font: '700 100px "Geist", "Geist Fallback"', text: "hi" }], rules);
  expect(load.mock.calls).toEqual([['700 100px "Geist", "Geist Fallback"', "hi"], ['700 100px "Geist"', "hi"]]);
  load = stubFonts(async () => [{ status: "error" }]);
  await expect(loadFontsStrict([{ font: '700 100px "Geist Fallback"', text: "hi" }], rules)).resolves.toBeUndefined();
  expect(load.mock.calls).toEqual([['700 100px "Geist Fallback"', "hi"]]);
});

it("the strict loader reads the page's own font rules when it is given none", async () => {
  const style = document.createElement("style");
  style.textContent = '@font-face { font-family: "Geist Fallback"; src: local("Arial"); } @font-face { font-family: "Geist"; src: url("/g.woff2"); }';
  document.head.appendChild(style);
  try {
    const load = stubFonts(async (font) => (font.includes("Geist Fallback") ? [{ status: "error" }] : [{ status: "loaded" }]));
    await expect(loadFontsStrict([{ font: '700 100px "Geist", "Geist Fallback"', text: "hi" }])).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledWith('700 100px "Geist"', "hi");
  } finally {
    style.remove();
  }
});

it("collects the export's fonts: each loaded with its characters, then measured on this page", async () => {
  const load = stubFonts(async () => [{ status: "loaded" }]);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: (t: string) => ({ width: t.length * 10 }) } as never);
  const bundle = await collectPageFonts(sampleDoc());
  expect(load).toHaveBeenCalledWith(GEIST, `${PROBE_BASE}h`);
  expect(bundle).toEqual({
    families: { Geist: '"Geist", sans-serif' },
    faces: [], // happy-dom's page has no @font-face rules
    probes: [{ font: GEIST, text: `${PROBE_BASE}h`, width: (PROBE_BASE.length + 1) * 10 }],
  });
});

// Added beyond the brief: each catches the removal of one rule the three tests above leave unchecked.

it("measures each probe in its own font, and stops when a face did not load or the page has no canvas", async () => {
  const { ctx } = fakeCtx(); // measures half the font's size per character
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  stubFonts(async () => [{ status: "loaded" }]);
  const bundle = await collectPageFonts(sampleDoc());
  expect(bundle.probes).toEqual([{ font: GEIST, text: `${PROBE_BASE}h`, width: ((PROBE_BASE.length + 1) * 100) / 2 }]);
  stubFonts(async () => [{ status: "error" }]);
  await expect(collectPageFonts(sampleDoc())).rejects.toThrow();
  stubFonts(async () => [{ status: "loaded" }]);
  getContext.mockReturnValue(null);
  await expect(collectPageFonts(sampleDoc())).rejects.toThrow();
});

it("the preview draws again once a face loads, and asks nothing new for an edit that adds no character", async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let lastId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(++lastId, cb);
    return lastId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const runFrames = () => {
    const due = [...frames.values()];
    frames.clear();
    act(() => due.forEach((cb) => cb(0)));
  };
  const { ctx, calls } = fakeCtx();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  let loaded!: () => void;
  const load = stubFonts(() => new Promise((resolve) => (loaded = () => resolve([{ status: "loaded" }]))));
  const store = makeStore();
  render(<EditorProvider store={store}><Preview /></EditorProvider>);
  runFrames();
  expect(load).toHaveBeenCalledTimes(1);
  // moving a clip changes the document but not its characters
  act(() => {
    store.getState().edit([{ op: "move_clip", clipId: "x1", start: 10 }], "move");
  });
  runFrames();
  expect(load).toHaveBeenCalledTimes(1);
  const draws = () => calls.filter(([name]) => name === "setTransform").length;
  const before = draws();
  await act(async () => loaded());
  runFrames();
  expect(draws()).toBe(before + 1);
});
