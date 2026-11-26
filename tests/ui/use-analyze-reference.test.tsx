// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyzeError, analyzeVideo, type AnalyzeDeps, type AnalyzeProgress } from "@/components/style/analyze-video";
import { useAnalyzeReference, type AnalyzeReferenceOptions } from "@/components/style/use-analyze-reference";
import { failAnalysis, saveAnalysis } from "@/lib/style/client";
import { STYLE_MESSAGES, STYLE_WORDS } from "@/lib/style/messages";
import type { StyleReference, VideoAnalysis } from "@/lib/style/types";
import type { AssetView } from "@/lib/media/types";
import { act, renderHook, waitFor } from "../helpers/dom";
import { assetView } from "../helpers/media-services";

vi.mock("@/lib/style/client", () => ({ saveAnalysis: vi.fn(), failAnalysis: vi.fn() }));
vi.mock("@/components/style/analyze-video", async (original) => ({
  ...(await original<typeof import("@/components/style/analyze-video")>()),
  analyzeVideo: vi.fn(),
}));

type Settle<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function settle<T>(): Settle<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

type Found = Awaited<ReturnType<typeof analyzeVideo>>;
type Look = Settle<Found> & { asset: AssetView; deps: AnalyzeDeps; signal?: AbortSignal; listen?: boolean; onProgress?: (p: AnalyzeProgress) => void };

// Each look-over the hook starts, in order. One ends when the test settles it, or with an AbortError when it is stopped.
let looks: Look[] = [];
const DEPS = { now: () => new Date() } as unknown as AnalyzeDeps;
const FOUND: Found = { analysis: { kind: "video", seconds: 6 } as VideoAnalysis, sheet: new Blob(["jpeg"]) };

const reference = (id: string, over: Partial<StyleReference> = {}): StyleReference => ({
  id,
  kind: "video",
  title: `Video ${id}`,
  status: "pending",
  assetId: `asset-${id}`,
  analysis: null,
  hasSheet: false,
  createdAt: "2026-11-25T10:00:00.000Z",
  ...over,
});
const assetOf = (id: string) => assetView({ id: `asset-${id}` });

beforeEach(() => {
  looks = [];
  vi.mocked(analyzeVideo).mockImplementation((asset, deps, options = {}) => {
    const look: Look = { ...settle<Found>(), asset, deps, ...options };
    options.signal?.addEventListener("abort", () => look.reject(new DOMException("Canceled.", "AbortError")));
    looks.push(look);
    return look.promise;
  });
  vi.mocked(saveAnalysis).mockImplementation(async (id) => reference(id, { status: "ready", hasSheet: true }));
  vi.mocked(failAnalysis).mockImplementation(async (id, reason) => reference(id, { status: "failed", failure: reason }));
});

afterEach(() => {
  vi.clearAllMocks();
});

function setup(options: AnalyzeReferenceOptions = {}) {
  const onDone = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useAnalyzeReference({ deps: DEPS, onDone, onError, ...options }));
  return { ...hook, onDone, onError, now: () => hook.result.current };
}

describe("looking over the style's videos", () => {
  it("looks over one at a time, in the order asked, and saves what it found", async () => {
    const { now, onDone } = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = now().run(reference("r1"), assetOf("r1"));
      second = now().run(reference("r2"), assetOf("r2"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    expect(looks[0]).toMatchObject({ asset: assetOf("r1"), deps: DEPS });
    expect(looks[0].signal).toBeInstanceOf(AbortSignal);
    expect(now().progress).toEqual({ r1: { stage: "shots", done: 0 }, r2: { stage: "waiting", done: 0 } });

    act(() => looks[0].onProgress?.({ stage: "listening", done: 0.42 }));
    expect(now().progress.r1).toEqual({ stage: "listening", done: 0.42 });

    await act(async () => {
      looks[0].resolve(FOUND);
      await first;
    });
    expect(saveAnalysis).toHaveBeenCalledWith("r1", FOUND.analysis, FOUND.sheet);
    expect(onDone).toHaveBeenCalledWith(reference("r1", { status: "ready", hasSheet: true }));
    await waitFor(() => expect(looks).toHaveLength(2));
    expect(looks[1].asset).toEqual(assetOf("r2"));
    expect(now().progress).toEqual({ r2: { stage: "shots", done: 0 } });

    await act(async () => {
      looks[1].resolve(FOUND);
      await second;
    });
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(now().progress).toEqual({});
    expect(failAnalysis).not.toHaveBeenCalled();
  });

  it("says it is saving while what it found is on its way", async () => {
    const saved = settle<StyleReference>();
    vi.mocked(saveAnalysis).mockReturnValue(saved.promise);
    const { now, onDone } = setup();
    let done!: Promise<void>;
    act(() => {
      done = now().run(reference("r1"), assetOf("r1"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    looks[0].resolve(FOUND);
    await waitFor(() => expect(now().progress.r1).toEqual({ stage: "saving", done: 0 }));
    await act(async () => {
      saved.resolve(reference("r1", { status: "ready" }));
      await done;
    });
    expect(onDone).toHaveBeenCalledWith(reference("r1", { status: "ready" }));
    expect(now().progress).toEqual({});
  });

  it("passes on whether to listen", async () => {
    const { now } = setup({ listen: false });
    act(() => void now().run(reference("r1"), assetOf("r1")));
    await waitFor(() => expect(looks).toHaveLength(1));
    expect(looks[0].listen).toBe(false);
  });

  it("doesn't queue the same video twice", async () => {
    const { now } = setup();
    let first!: Promise<void>;
    let again!: Promise<void>;
    act(() => {
      first = now().run(reference("r1"), assetOf("r1"));
      again = now().run(reference("r1"), assetOf("r1"));
    });
    expect(again).toBe(first);
    await waitFor(() => expect(looks).toHaveLength(1));
    await act(async () => {
      looks[0].resolve(FOUND);
      await first;
    });
    expect(analyzeVideo).toHaveBeenCalledOnce();
    expect(saveAnalysis).toHaveBeenCalledOnce();
  });
});

describe("when a video can't be looked over or saved", () => {
  it("marks it failed with why, in the person's words", async () => {
    const { now, onDone } = setup();
    let done!: Promise<void>;
    act(() => {
      done = now().run(reference("r1"), assetOf("r1"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    await act(async () => {
      looks[0].reject(new AnalyzeError("unreadable", "The video's file couldn't be read."));
      await done;
    });
    expect(saveAnalysis).not.toHaveBeenCalled();
    expect(failAnalysis).toHaveBeenCalledWith("r1", STYLE_WORDS.analysisFailed.unreadable);
    expect(onDone).toHaveBeenCalledWith(reference("r1", { status: "failed", failure: STYLE_WORDS.analysisFailed.unreadable }));
  });

  it("uses the general words for anything unexpected", async () => {
    const { now } = setup();
    let done!: Promise<void>;
    act(() => {
      done = now().run(reference("r1"), assetOf("r1"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    await act(async () => {
      looks[0].reject(new TypeError("x is undefined"));
      await done;
    });
    expect(failAnalysis).toHaveBeenCalledWith("r1", STYLE_WORDS.analysisFailed.unknown);
  });

  it("marks it failed with the server's words when the server refuses what was found", async () => {
    vi.mocked(saveAnalysis).mockRejectedValue(new Error(STYLE_MESSAGES.sheetTooBig));
    const { now, onDone } = setup();
    let done!: Promise<void>;
    act(() => {
      done = now().run(reference("r1"), assetOf("r1"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    await act(async () => {
      looks[0].resolve(FOUND);
      await done;
    });
    expect(failAnalysis).toHaveBeenCalledWith("r1", STYLE_MESSAGES.sheetTooBig);
    expect(onDone).toHaveBeenCalledWith(reference("r1", { status: "failed", failure: STYLE_MESSAGES.sheetTooBig }));
  });

  it("never shows a browser's own words when the server couldn't be reached", async () => {
    vi.mocked(saveAnalysis).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { now, onDone } = setup();
    let first!: Promise<void>;
    act(() => {
      first = now().run(reference("r1"), assetOf("r1"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    await act(async () => {
      looks[0].resolve(FOUND);
      await first;
    });
    expect(failAnalysis).toHaveBeenCalledWith("r1", STYLE_WORDS.analysisNotSaved);
    expect(onDone).toHaveBeenCalledWith(reference("r1", { status: "failed", failure: STYLE_WORDS.analysisNotSaved }));

    // Neither save arrives: the page is told in its own words, which fit what went wrong.
    vi.mocked(saveAnalysis).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.mocked(failAnalysis).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.mocked(failAnalysis).mockRejectedValueOnce(new TypeError("Load failed"));
    const second = setup();
    let found!: Promise<void>;
    let broken!: Promise<void>;
    act(() => {
      found = second.now().run(reference("r2"), assetOf("r2"));
      broken = second.now().run(reference("r3"), assetOf("r3"));
    });
    await waitFor(() => expect(looks).toHaveLength(2));
    await act(async () => {
      looks[1].resolve(FOUND);
      await found;
    });
    await waitFor(() => expect(looks).toHaveLength(3));
    await act(async () => {
      looks[2].reject(new AnalyzeError("noPicture", "No frame of the video could be read."));
      await broken;
    });
    expect(second.onError.mock.calls).toEqual([
      [reference("r2"), STYLE_WORDS.analysisNotSaved],
      [reference("r3"), STYLE_WORDS.analysisFailed.noPicture],
    ]);
  });

  it("says so when nothing could reach the server, and goes on to the next", async () => {
    vi.mocked(saveAnalysis).mockRejectedValueOnce(new Error("What we found in that video couldn't be saved. Try again."));
    vi.mocked(failAnalysis).mockRejectedValueOnce(new Error("What we found in that video couldn't be saved. Try again."));
    const { now, onDone, onError } = setup();
    let first!: Promise<void>;
    act(() => {
      first = now().run(reference("r1"), assetOf("r1"));
      void now().run(reference("r2"), assetOf("r2"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    await act(async () => {
      looks[0].resolve(FOUND);
      await first;
    });
    expect(onError).toHaveBeenCalledWith(reference("r1"), "What we found in that video couldn't be saved. Try again.");
    expect(onDone).not.toHaveBeenCalled();
    await waitFor(() => expect(looks).toHaveLength(2));
  });
});

describe("canceling", () => {
  it("takes a waiting video out of the queue at once", async () => {
    const { now } = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = now().run(reference("r1"), assetOf("r1"));
      second = now().run(reference("r2"), assetOf("r2"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    act(() => now().cancel("r2"));
    await second; // settles without waiting for r1
    expect(now().progress).toEqual({ r1: { stage: "shots", done: 0 } });
    await act(async () => {
      looks[0].resolve(FOUND);
      await first;
    });
    expect(looks).toHaveLength(1);
    expect(saveAnalysis).toHaveBeenCalledTimes(1);
  });

  it("stops the video being looked over, leaves it pending, and goes on to the next", async () => {
    const { now, onDone, onError } = setup();
    let first!: Promise<void>;
    act(() => {
      first = now().run(reference("r1"), assetOf("r1"));
      void now().run(reference("r2"), assetOf("r2"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    await act(async () => {
      now().cancel("r1");
      await first;
    });
    expect(looks[0].signal?.aborted).toBe(true);
    await waitFor(() => expect(looks).toHaveLength(2));
    expect(saveAnalysis).not.toHaveBeenCalled();
    expect(failAnalysis).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(now().progress).toEqual({ r2: { stage: "shots", done: 0 } });
  });

  it("waits for a stopped video to finish stopping before it starts the next, so two are never looked over at once", async () => {
    // The first look-over takes a while to notice it was stopped (it is decoding the sound, say): it doesn't end on abort.
    vi.mocked(analyzeVideo).mockImplementationOnce((asset, deps, options = {}) => {
      const look: Look = { ...settle<Found>(), asset, deps, ...options };
      looks.push(look);
      return look.promise;
    });
    const { now } = setup();
    let first!: Promise<void>;
    act(() => {
      first = now().run(reference("r1"), assetOf("r1"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    const slow = looks[0];
    vi.mocked(analyzeVideo).mockClear();
    let again!: Promise<void>;
    let next!: Promise<void>;
    await act(async () => {
      now().cancel("r1");
      await first;
      again = now().run(reference("r1"), assetOf("r1"));
      next = now().run(reference("r2"), assetOf("r2"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(analyzeVideo).not.toHaveBeenCalled();
    expect(now().progress).toEqual({ r1: { stage: "waiting", done: 0 }, r2: { stage: "waiting", done: 0 } });

    await act(async () => {
      slow.resolve(FOUND); // it finished anyway: what it found isn't saved
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(saveAnalysis).not.toHaveBeenCalled();
    await waitFor(() => expect(analyzeVideo).toHaveBeenCalledOnce());
    await act(async () => {
      looks[1].resolve(FOUND);
      await again;
    });
    await waitFor(() => expect(analyzeVideo).toHaveBeenCalledTimes(2));
    await act(async () => {
      looks[2].resolve(FOUND);
      await next;
    });
    expect(vi.mocked(saveAnalysis).mock.calls.map(([id]) => id)).toEqual(["r1", "r2"]);
  });

  it("can look over a canceled video again", async () => {
    const { now, onDone } = setup();
    let again!: Promise<void>;
    act(() => {
      void now().run(reference("r1"), assetOf("r1"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    act(() => {
      now().cancel("r1");
      again = now().run(reference("r1"), assetOf("r1"));
    });
    await waitFor(() => expect(looks).toHaveLength(2));
    expect(now().progress.r1).toEqual({ stage: "shots", done: 0 });
    await act(async () => {
      looks[1].resolve(FOUND);
      await again;
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("stops everything when the page goes away", async () => {
    const { now, unmount, onDone, onError } = setup();
    act(() => {
      void now().run(reference("r1"), assetOf("r1"));
      void now().run(reference("r2"), assetOf("r2"));
    });
    await waitFor(() => expect(looks).toHaveLength(1));
    unmount();
    expect(looks[0].signal?.aborted).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(looks).toHaveLength(1);
    expect(saveAnalysis).not.toHaveBeenCalled();
    expect(failAnalysis).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
