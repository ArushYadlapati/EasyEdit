// @vitest-environment happy-dom
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { MediaServices } from "@/components/editor/media/media-context";
import type { StyleApi } from "@/components/style/style-api";
import { StylePage, type StyleProject } from "@/components/style/style-page";
import type { AnalyzeReferenceOptions, ReferenceProgress } from "@/components/style/use-analyze-reference";
import type { AssetView } from "@/lib/media/types";
import type { ChannelStatus } from "@/lib/style/channel";
import { STYLE_MESSAGES, STYLE_WORDS } from "@/lib/style/messages";
import { applyStylePatch, DEFAULT_STYLE, type Style, type StylePatch, type StyleReference, type VideoAnalysis } from "@/lib/style/types";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";
import { assetView, pretendMediaServices } from "../helpers/media-services";

// The hook that looks videos over in the browser is tested on its own (use-analyze-reference.test.tsx). Here it only
// says what the page asked of it, and the test plays its answers.
const analyze = vi.hoisted(() => ({
  run: vi.fn<(reference: StyleReference, asset: AssetView) => Promise<void>>(async () => {}),
  cancel: vi.fn(),
  progress: {} as Record<string, ReferenceProgress>,
  options: null as AnalyzeReferenceOptions | null,
}));
vi.mock("@/components/style/use-analyze-reference", () => ({
  useAnalyzeReference: (options: AnalyzeReferenceOptions) => {
    analyze.options = options;
    return { run: analyze.run, progress: analyze.progress, cancel: analyze.cancel };
  },
}));

const NOW = new Date("2026-11-25T21:00:00.000Z");
const JARGON = /oembed|mcp|json|analysis|contact sheet|token/i;

const shots = (count: number, medianSeconds: number) => ({ count, averageSeconds: medianSeconds, medianSeconds, firstSeconds: medianSeconds, perMinute: 60 / medianSeconds });
const measured = (over: Partial<VideoAnalysis> = {}): VideoAnalysis => ({
  kind: "video",
  seconds: 38,
  width: 1080,
  height: 1920,
  shots: shots(24, 1.6),
  cuts: [],
  speech: { words: 108, perMinute: 170, opening: "Okay so today", talkingShare: 0.9 },
  sound: null,
  color: { brightness: 0.5, saturation: 0.4, warmth: 0 },
  sheet: null,
  analyzedAt: "2026-11-25T20:00:00.000Z",
  ...over,
});

function reference(id: string, over: Partial<StyleReference> = {}): StyleReference {
  return { id, kind: "video", title: `Video ${id}`, status: "ready", assetId: `asset-${id}`, analysis: measured(), hasSheet: true, createdAt: "2026-11-25T20:00:00.000Z", ...over };
}
const linkReference = (id: string, over: Partial<StyleReference> = {}): StyleReference => ({
  id,
  kind: "link",
  title: "Paper planes",
  status: "ready",
  provider: "youtube",
  author: "Paper Planes Club",
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  analysis: { kind: "link", provider: "youtube", title: "Paper planes", author: "Paper Planes Club", fetchedAt: "2026-11-25T20:00:00.000Z" },
  hasSheet: false,
  createdAt: "2026-11-25T20:00:00.000Z",
  ...over,
});

const STYLE: Style = { profile: { summary: "Bright and quick.", pace: "quick" }, notes: "", updatedAt: "2026-11-25T19:00:00.000Z", updatedBy: "agent:claude:u1", updatedByName: "Claude (for Ada)" };
const PROJECTS: StyleProject[] = [
  { id: "p1", name: "Match day", updatedAt: "2026-11-24T21:00:00.000Z" },
  { id: "p2", name: "Pit tour", updatedAt: "2026-11-20T21:00:00.000Z" },
  { id: "p3", name: "Kickoff", updatedAt: "2026-11-10T21:00:00.000Z" },
];

type FakeApi = { [K in keyof StyleApi]: Mock<StyleApi[K]> };

function fakeApi(over: Partial<FakeApi> = {}): FakeApi {
  const api = {
    saveStyle: vi.fn(async (_space: string, patch: StylePatch): Promise<Style> => ({
      profile: applyStylePatch(STYLE.profile, patch.profile ?? {}),
      notes: patch.notes ?? STYLE.notes,
      updatedAt: NOW.toISOString(),
      updatedBy: "u1",
      updatedByName: "Ada",
    })),
    addReference: vi.fn(async (): Promise<StyleReference> => {
      throw new Error("not expected");
    }),
    removeReference: vi.fn(async () => {}),
    fetchChannel: vi.fn(async (): Promise<ChannelStatus> => ({ on: true, connected: false })),
    addChannelVideo: vi.fn(async (): Promise<StyleReference> => {
      throw new Error("not expected");
    }),
    ...over,
  };
  return api as never;
}

type Options = {
  canEdit?: boolean;
  isAdmin?: boolean;
  style?: Style;
  references?: StyleReference[];
  assets?: AssetView[];
  services?: MediaServices;
  storageReady?: boolean;
  api?: FakeApi;
  channelOn?: boolean;
  spaceName?: string | null;
  strict?: boolean; // drawn as React's development mode draws it, mounting everything twice
};

function page(options: Options = {}) {
  const api = options.api ?? fakeApi();
  const view = render(
    <StylePage
      spaceId={SEED_TEAM_ID}
      spaceSlug="seattle-solvers"
      spaceName={options.spaceName === undefined ? "Seattle Solvers" : options.spaceName}
      canEdit={options.canEdit ?? true}
      isAdmin={options.isAdmin ?? true}
      initialStyle={options.style ?? STYLE}
      initialReferences={options.references ?? []}
      projects={PROJECTS}
      storageReady={options.storageReady ?? true}
      channelOn={options.channelOn ?? false}
      services={options.services ?? pretendMediaServices(options.assets ?? [])}
      api={api}
      now={NOW}
    />,
    options.strict ? { wrapper: StrictMode } : undefined,
  );
  return { api, view };
}

const learn = () => screen.getByRole("region", { name: "Learn from your videos" });
const yourStyle = () => screen.getByRole("region", { name: "Your style" });

beforeEach(() => {
  analyze.run.mockClear();
  analyze.cancel.mockClear();
  analyze.progress = {};
  analyze.options = null;
});

describe("the Style page", () => {
  it("has its three sections for an editor, and the line to ask an agent", () => {
    page();
    expect(screen.getByText(STYLE_WORDS.intro)).toBeTruthy();
    expect(within(learn()).getByText(STYLE_WORDS.learn.empty)).toBeTruthy();
    for (const name of ["Add a video", "Paste a link", "Pick past projects"]) expect(within(learn()).getByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "From your YouTube channel" })).toBeNull();
    expect(within(yourStyle()).getByText("Last changed by Claude (for Ada), 2 hours ago")).toBeTruthy();
    const tryIt = screen.getByRole("region", { name: "Try it" });
    expect(within(tryIt).getByText("Edit my latest project in the Seattle Solvers style.")).toBeTruthy();
    expect(within(tryIt).getByRole("button", { name: "Copy what to ask your agent" })).toBeTruthy();
  });

  it("asks about a personal space's style without a name", () => {
    page({ spaceName: null });
    expect(screen.getByText("Edit my latest project in my personal style.")).toBeTruthy();
  });

  it("shows a viewer the style and what it learns from, with nothing to change", () => {
    page({ canEdit: false, references: [reference("r1"), linkReference("r2")], style: { ...STYLE, profile: { ...STYLE.profile, never: ["long intros"] }, notes: "Keep it bright." } });
    expect(screen.getByText(STYLE_WORDS.introViewer)).toBeTruthy();
    expect(screen.getByText("Bright and quick.")).toBeTruthy();
    expect(screen.getByText("Quick: A new shot every 1.2 to 2.5 seconds.")).toBeTruthy();
    expect(screen.getByText("long intros")).toBeTruthy();
    expect(screen.getByText("Keep it bright.")).toBeTruthy();
    expect(screen.getByText("Video r1")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("region", { name: "Try it" })).toBeNull();
  });

  it("tells a viewer when nothing is filled in yet", () => {
    page({ canEdit: false, style: DEFAULT_STYLE });
    expect(screen.getByText(STYLE_WORDS.form.empty)).toBeTruthy();
    expect(screen.getByText(STYLE_WORDS.learn.emptyViewer)).toBeTruthy();
  });

  it("uses no technical words", async () => {
    const references = [
      reference("r1"),
      reference("r2", { status: "pending", analysis: null, hasSheet: false }),
      reference("r3", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.unreadable }),
      linkReference("r4"),
      linkReference("r5", { provider: "tiktok", url: "https://www.tiktok.com/@a/video/1", analysis: { kind: "link", provider: "tiktok", title: "x", fetchedAt: NOW.toISOString(), unreadable: true } }),
      reference("r6", { kind: "project", assetId: undefined, projectId: "p1", hasSheet: false, analysis: null }),
    ];
    page({ references, channelOn: true });
    expect(document.body.textContent).not.toMatch(JARGON);
    fireEvent.click(screen.getByRole("button", { name: "Paste a link" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick past projects" }));
    expect(document.body.textContent).not.toMatch(JARGON);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Pick past projects" })).getByRole("button", { name: "Close" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "From your YouTube channel" })));
    expect(document.body.textContent).not.toMatch(JARGON);
    fireEvent.click(within(screen.getByRole("dialog", { name: "From your YouTube channel" })).getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Add a video" }));
    expect(document.body.textContent).not.toMatch(JARGON);
  });
});

describe("learning from links", () => {
  it("adds a pasted link and shows it", async () => {
    const added = linkReference("r9");
    const api = fakeApi({ addReference: vi.fn(async () => added) });
    page({ api });
    fireEvent.click(screen.getByRole("button", { name: "Paste a link" }));
    fireEvent.change(screen.getByLabelText("Video link"), { target: { value: " youtu.be/dQw4w9WgXcQ " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add link" })));
    expect(api.addReference).toHaveBeenCalledWith(SEED_TEAM_ID, { kind: "link", url: "youtu.be/dQw4w9WgXcQ" });
    expect(screen.queryByLabelText("Video link")).toBeNull();
    const card = within(learn()).getByRole("link", { name: "Paper planes" });
    expect(card.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(within(learn()).getByText("YouTube · Paper Planes Club")).toBeTruthy();
    const picture = learn().querySelector("img");
    expect(picture?.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("tells an Instagram link at once why it can't be read, and offers to upload instead", () => {
    const { api } = page();
    fireEvent.click(screen.getByRole("button", { name: "Paste a link" }));
    fireEvent.change(screen.getByLabelText("Video link"), { target: { value: "https://www.instagram.com/reel/Cabc123/" } });
    expect(screen.getByRole("alert").textContent).toBe(STYLE_MESSAGES.instagram);
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(api.addReference).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: STYLE_WORDS.link.uploadInstead }));
    expect(screen.getByRole("dialog", { name: "Add a video" })).toBeTruthy();
  });

  it("says what to paste only once Add is pressed, and the server's words when it refuses", async () => {
    const api = fakeApi({ addReference: vi.fn(async () => Promise.reject(new Error(STYLE_MESSAGES.alreadyAdded))) });
    page({ api });
    fireEvent.click(screen.getByRole("button", { name: "Paste a link" }));
    const box = screen.getByLabelText("Video link");
    fireEvent.change(box, { target: { value: "https://example.com/video" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    expect(screen.getByRole("alert").textContent).toBe(STYLE_MESSAGES.badLink);
    expect(api.addReference).not.toHaveBeenCalled();
    fireEvent.change(box, { target: { value: "https://vimeo.com/76979871" } });
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add link" })));
    expect(screen.getByRole("alert").textContent).toBe(STYLE_MESSAGES.alreadyAdded);
  });
});

describe("learning from past projects", () => {
  it("adds the ticked projects in order", async () => {
    const api = fakeApi({
      addReference: vi.fn(async (_space: string, source: { kind: string; projectId?: string }) =>
        reference(`ref-${source.projectId}`, { kind: "project", title: PROJECTS.find((p) => p.id === source.projectId)!.name, projectId: source.projectId, assetId: undefined, hasSheet: false, analysis: null }),
      ),
    });
    page({ api, references: [reference("ref-p2", { kind: "project", title: "Pit tour", projectId: "p2", assetId: undefined, hasSheet: false, analysis: null })] });
    fireEvent.click(screen.getByRole("button", { name: "Pick past projects" }));
    const dialog = screen.getByRole("dialog", { name: "Pick past projects" });
    const box = (name: RegExp) => within(dialog).getByRole("checkbox", { name });
    expect((box(/Pit tour/) as HTMLInputElement).checked).toBe(true);
    expect((box(/Pit tour/) as HTMLInputElement).disabled).toBe(true);
    expect(within(dialog).getByText("Edited 1 day ago")).toBeTruthy();
    fireEvent.click(box(/Kickoff/));
    fireEvent.click(box(/Match day/));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Add 2 projects" })));
    expect(api.addReference.mock.calls.map((call) => call[1])).toEqual([
      { kind: "project", projectId: "p3" },
      { kind: "project", projectId: "p1" },
    ]);
    expect(screen.queryByRole("dialog", { name: "Pick past projects" })).toBeNull();
    expect(within(learn()).getByText("Kickoff")).toBeTruthy();
    expect(within(learn()).getByText("Match day")).toBeTruthy();
  });

  it("says when the ticked projects fill the style, and locks the rest", () => {
    page({ references: Array.from({ length: 11 }, (_, i) => linkReference(`r${i}`, { url: `https://vimeo.com/${i + 1}` })) });
    fireEvent.click(screen.getByRole("button", { name: "Pick past projects" }));
    const dialog = screen.getByRole("dialog", { name: "Pick past projects" });
    expect(within(dialog).getByText("You can add 1 more.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Kickoff/ }));
    expect(within(dialog).getByText("That's all your style has room for.")).toBeTruthy();
    expect((within(dialog).getByRole("checkbox", { name: /Match day/ }) as HTMLInputElement).disabled).toBe(true);
  });

  it("stops at a project the server refuses and says why", async () => {
    const api = fakeApi({ addReference: vi.fn(async () => Promise.reject(new Error(STYLE_MESSAGES.projectGone))) });
    page({ api });
    fireEvent.click(screen.getByRole("button", { name: "Pick past projects" }));
    const dialog = screen.getByRole("dialog", { name: "Pick past projects" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Kickoff/ }));
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 project" })));
    expect(within(dialog).getByRole("alert").textContent).toBe(STYLE_MESSAGES.projectGone);
  });
});

describe("learning from the space's videos", () => {
  it("adds a video from the library, which is then looked over", async () => {
    const intake = assetView({ id: "a", name: "intake" });
    const added = reference("r7", { title: "intake", assetId: "a", status: "pending", analysis: null, hasSheet: false });
    const api = fakeApi({ addReference: vi.fn(async () => added) });
    page({ api, assets: [intake, assetView({ id: "s1", kind: "audio", name: "theme" })] });
    fireEvent.click(screen.getByRole("button", { name: "Add a video" }));
    const dialog = screen.getByRole("dialog", { name: "Add a video" });
    expect(within(dialog).queryByText("theme")).toBeNull();
    expect(within(dialog).getByText("0:12")).toBeTruthy();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Add intake" })));
    expect(api.addReference).toHaveBeenCalledWith(SEED_TEAM_ID, { kind: "video", assetId: "a" });
    expect(screen.queryByRole("dialog", { name: "Add a video" })).toBeNull();
    expect(analyze.run).toHaveBeenCalledWith(added, intake);
  });

  it("looks a waiting video over once, as soon as the page is open, and shows what it found", async () => {
    const waiting = reference("r1", { status: "pending", analysis: null, hasSheet: false });
    page({ references: [waiting], assets: [assetView({ id: "asset-r1" })] });
    expect(analyze.run).toHaveBeenCalledTimes(1);
    expect(analyze.run).toHaveBeenCalledWith(waiting, expect.objectContaining({ id: "asset-r1" }));
    expect(screen.getByText(STYLE_WORDS.learn.notLookedAt)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Paste a link" })); // the page drawn again doesn't start it again
    expect(analyze.run).toHaveBeenCalledTimes(1);
    act(() => analyze.options!.onDone!(reference("r1")));
    expect(screen.getByText("38 s · 24 shots, about 1.6 s each · talks 170 words a minute")).toBeTruthy();
    expect(learn().querySelector("img")?.getAttribute("src")).toBe("/api/style/references/r1/sheet?v=2026-11-25T20%3A00%3A00.000Z");
  });

  it("still looks a waiting video over when React's development mode mounts the page twice", () => {
    // The real runner stops every run when the page goes, and development mode makes it go and come straight back, so
    // the page has to start the run again rather than count it as started.
    page({ strict: true, references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })], assets: [assetView({ id: "asset-r1" })] });
    expect(analyze.run).toHaveBeenCalledTimes(2);
    expect(analyze.run).toHaveBeenLastCalledWith(expect.objectContaining({ id: "r1" }), expect.objectContaining({ id: "asset-r1" }));
    fireEvent.click(screen.getByRole("button", { name: "Paste a link" }));
    expect(analyze.run).toHaveBeenCalledTimes(2);
  });

  it("says so when a waiting video's file was taken out of the media, rather than waiting for ever", () => {
    page({ references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })], assets: [assetView({ id: "asset-r1", removed: true })] });
    expect(analyze.run).not.toHaveBeenCalled();
    expect(screen.getByText(STYLE_WORDS.analysisFailed.missing)).toBeTruthy();
    expect(screen.queryByText(STYLE_WORDS.learn.notLookedAt)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull(); // opening the page doesn't announce it
  });

  it("uploads a video into the media the way the Media tab does, taking the same kinds of file", () => {
    const base = pretendMediaServices([]);
    const add = vi.fn((files: File[]) => (files.length > 0 ? [] : []));
    page({ services: { ...base, queue: { ...base.queue, add } } });
    fireEvent.click(screen.getByRole("button", { name: "Add a video" }));
    const dialog = screen.getByRole("dialog", { name: "Add a video" });
    expect(within(dialog).getByText(STYLE_WORDS.video.uploadsShowHere)).toBeTruthy();
    const input = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.getAttribute("accept")).toBe(".mp4,.m4v,.mov,.webm");
    const file = new File(["x"], "match.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(add).toHaveBeenCalledWith([file]);
  });

  it("says why there's no upload where the space's storage isn't set up", () => {
    page({ storageReady: false });
    fireEvent.click(screen.getByRole("button", { name: "Add a video" }));
    const dialog = screen.getByRole("dialog", { name: "Add a video" });
    expect(within(dialog).getByText(STYLE_WORDS.video.noStorage)).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: STYLE_WORDS.video.upload })).toBeNull();
  });

  it("shows how far looking a video over has got", () => {
    analyze.progress = { r1: { stage: "listening", done: 0.42 } };
    page({ references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })], assets: [assetView({ id: "asset-r1" })] });
    expect(screen.getByText("Listening… 42%")).toBeTruthy();
  });

  it("doesn't look videos over for a viewer", () => {
    page({ canEdit: false, references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })], assets: [assetView({ id: "asset-r1" })] });
    expect(analyze.run).not.toHaveBeenCalled();
    expect(screen.getByText(STYLE_WORDS.learn.notLookedAtViewer)).toBeTruthy();
  });

  it("says why a video couldn't be looked over, with Try again", () => {
    const failed = reference("r1", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.unreadable });
    page({ references: [failed], assets: [assetView({ id: "asset-r1" })] });
    expect(analyze.run).not.toHaveBeenCalled();
    expect(screen.getByText(STYLE_WORDS.analysisFailed.unreadable)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(analyze.run).toHaveBeenCalledWith(failed, expect.objectContaining({ id: "asset-r1" }));
  });

  it("shows a save that couldn't reach the server on the video's card", () => {
    const waiting = reference("r1", { status: "pending", analysis: null, hasSheet: false });
    page({ references: [waiting], assets: [assetView({ id: "asset-r1" })] });
    act(() => analyze.options!.onError!(waiting, STYLE_WORDS.analysisNotSaved));
    expect(screen.getByRole("alert").textContent).toBe(STYLE_WORDS.analysisNotSaved);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("removes a reference, and stops looking it over", async () => {
    const { api } = page({ references: [reference("r1"), linkReference("r2")] });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove Video r1" })));
    expect(api.removeReference).toHaveBeenCalledWith("r1");
    expect(analyze.cancel).toHaveBeenCalledWith("r1");
    expect(screen.queryByText("Video r1")).toBeNull();
    expect(screen.getByText("Paper planes")).toBeTruthy();
  });

  it("says why a remove didn't go through, never the browser's own words", async () => {
    const api = fakeApi({ removeReference: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) });
    page({ api, references: [reference("r1")] });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove Video r1" })));
    expect(screen.getByRole("alert").textContent).toMatch(/Check your connection/);
    expect(screen.getByText("Video r1")).toBeTruthy();
  });

  it("can't add more once the style is full", () => {
    page({ references: Array.from({ length: 12 }, (_, i) => linkReference(`r${i}`, { url: `https://vimeo.com/${i + 1}` })) });
    expect((screen.getByRole("button", { name: "Add a video" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Paste a link" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(STYLE_MESSAGES.tooManyReferences)).toBeTruthy();
  });
});

describe("learning from the YouTube channel", () => {
  it("says when no channel is connected, and where an admin connects one", async () => {
    page({ channelOn: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "From your YouTube channel" })));
    const dialog = screen.getByRole("dialog", { name: "From your YouTube channel" });
    expect(within(dialog).getByText(STYLE_WORDS.channel.notConnected)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: STYLE_WORDS.channel.connect }).getAttribute("href")).toBe("/s/seattle-solvers/settings/socials");
  });

  it("asks for the channel's videos only once its dialog opens, and again each time it does", async () => {
    const { api } = page({ channelOn: true });
    expect(api.fetchChannel).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "From your YouTube channel" })));
    fireEvent.click(within(screen.getByRole("dialog", { name: "From your YouTube channel" })).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "From your YouTube channel" })).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "From your YouTube channel" })));
    expect(api.fetchChannel).toHaveBeenCalledTimes(2);
  });

  it("tells an editor who isn't an admin to ask one", async () => {
    const api = fakeApi({ fetchChannel: vi.fn(async () => ({ on: true, connected: false, message: STYLE_MESSAGES.channelHidden }) as ChannelStatus) });
    page({ channelOn: true, isAdmin: false, api });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "From your YouTube channel" })));
    const dialog = screen.getByRole("dialog", { name: "From your YouTube channel" });
    expect(within(dialog).getByText(STYLE_MESSAGES.channelHidden)).toBeTruthy();
    expect(within(dialog).getByText(STYLE_WORDS.channel.askAdmin)).toBeTruthy();
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("says plainly when the channel's videos couldn't be fetched", async () => {
    const api = fakeApi({ fetchChannel: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) });
    page({ channelOn: true, api });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "From your YouTube channel" })));
    const dialog = screen.getByRole("dialog", { name: "From your YouTube channel" });
    expect(within(dialog).getByRole("alert").textContent).toMatch(/Check your connection/);
  });

  it("reads a channel video's details again once YouTube's 30 days are up", async () => {
    // After 30 days only the video's address is kept, and it stands in for the title.
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const old = linkReference("r1", {
      provider: "channel",
      title: url,
      author: undefined,
      thumbnailUrl: undefined,
      analysis: { kind: "link", provider: "channel", title: url, fetchedAt: "2026-10-01T00:00:00.000Z" },
    });
    const fresh = linkReference("r1", { provider: "channel", analysis: { kind: "link", provider: "channel", title: "Paper planes", author: "Paper Planes Club", fetchedAt: NOW.toISOString() } });
    const api = fakeApi({ addChannelVideo: vi.fn(async () => fresh) });
    page({ channelOn: true, api, references: [old] });
    expect(screen.getByText(STYLE_WORDS.learn.channelStale)).toBeTruthy();
    expect(within(learn()).getByRole("link", { name: url }).getAttribute("href")).toBe(url);
    expect(within(learn()).queryByText("Paper planes")).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh" })));
    expect(api.addChannelVideo).toHaveBeenCalledWith(SEED_TEAM_ID, "dQw4w9WgXcQ");
    expect(screen.queryByText(STYLE_WORDS.learn.channelStale)).toBeNull();
    expect(within(learn()).getByRole("link", { name: "Paper planes" })).toBeTruthy();
    expect(screen.getByText("Your YouTube channel · Paper Planes Club")).toBeTruthy();
  });

  it("lists the channel's newest videos and adds one", async () => {
    const video = { id: "dQw4w9WgXcQ", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", title: "Paper planes", seconds: 95 };
    const other = { id: "abcdefghijk", url: "https://www.youtube.com/watch?v=abcdefghijk", title: "Kickoff", thumbnailUrl: "https://evil.example/x.jpg" };
    const api = fakeApi({
      fetchChannel: vi.fn(async () => ({ on: true, connected: true, channelTitle: "Paper Planes Club", videos: [video, other] }) as ChannelStatus),
      addChannelVideo: vi.fn(async () => linkReference("r9", { provider: "channel" })),
    });
    page({ channelOn: true, api });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "From your YouTube channel" })));
    const dialog = screen.getByRole("dialog", { name: "From your YouTube channel" });
    expect(within(dialog).getByText("The newest videos on Paper Planes Club.")).toBeTruthy();
    expect(within(dialog).getByText("1 min 35 s")).toBeTruthy();
    expect(dialog.querySelector("img")).toBeNull(); // a picture from anywhere else isn't shown
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Add Paper planes" })));
    expect(api.addChannelVideo).toHaveBeenCalledWith(SEED_TEAM_ID, "dQw4w9WgXcQ");
    await waitFor(() => expect(within(dialog).getByText("Added")).toBeTruthy());
    expect(within(learn()).getByText("Your YouTube channel · Paper Planes Club")).toBeTruthy();
  });
});

describe("the style form", () => {
  it("saves only the fields that changed", async () => {
    const { api } = page();
    const save = () => screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Pace" })).getByRole("radio", { name: "Calm" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Where you post" })).getByRole("button", { name: "YouTube" }));
    fireEvent.change(screen.getByLabelText("Notes for AI agents"), { target: { value: "  Keep it bright.  " } });
    expect(save().disabled).toBe(false);
    await act(async () => fireEvent.click(save()));
    expect(api.saveStyle).toHaveBeenCalledWith(SEED_TEAM_ID, { profile: { pace: "calm", formats: ["long_16x9"] }, notes: "Keep it bright." });
    expect(within(yourStyle()).getByRole("status").textContent).toBe("Saved.");
    expect(save().disabled).toBe(true);
    expect(screen.getByText("Last changed by Ada, just now")).toBeTruthy();
  });

  it("doesn't count a number saved with more places than its box shows as a change", async () => {
    const { api } = page({ style: { ...STYLE, profile: { pace: "quick", shotSeconds: 1.64, lengthSeconds: { min: 15.333, max: 45 } } } });
    expect((screen.getByLabelText("Typical shot") as HTMLInputElement).value).toBe("1.64");
    expect((screen.getByLabelText("Shortest, in seconds") as HTMLInputElement).value).toBe("15.33");
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Voice and tone"), { target: { value: "Friendly" } });
    await act(async () => fireEvent.click(save));
    expect(api.saveStyle).toHaveBeenCalledWith(SEED_TEAM_ID, { profile: { voice: "Friendly" } });
  });

  it("clears a field with null", async () => {
    const { api } = page();
    fireEvent.click(screen.getByRole("button", { name: "Clear Pace" }));
    fireEvent.change(screen.getByLabelText("In a sentence or two"), { target: { value: "  " } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(api.saveStyle).toHaveBeenCalledWith(SEED_TEAM_ID, { profile: { summary: null, pace: null } });
  });

  it("keeps the pace and typical shot agreeing", () => {
    page();
    const shot = screen.getByLabelText("Typical shot") as HTMLInputElement;
    fireEvent.change(shot, { target: { value: "5" } });
    const calm = within(screen.getByRole("radiogroup", { name: "Pace" })).getByRole("radio", { name: "Calm" });
    expect(calm.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Pace" })).getByRole("radio", { name: "Rapid" }));
    expect(shot.value).toBe("");
  });

  it("won't save a length that doesn't make sense, and says why", () => {
    page();
    const shortest = screen.getByLabelText("Shortest, in seconds");
    fireEvent.change(shortest, { target: { value: "45" } });
    fireEvent.change(screen.getByLabelText("Longest, in seconds"), { target: { value: "15" } });
    fireEvent.blur(shortest);
    expect(screen.getByRole("alert").textContent).toBe("Use two numbers from 1 to 3,600, the shorter one first.");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("drops empty rows of Always and Never before saving, and takes out a row that is removed", async () => {
    const { api } = page();
    fireEvent.click(screen.getByRole("button", { name: "Add to Always" }));
    fireEvent.change(screen.getByLabelText("Always, item 1"), { target: { value: " Open on the best moment " } });
    fireEvent.click(screen.getByRole("button", { name: "Add to Always" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Never" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Never" }));
    fireEvent.change(screen.getByLabelText("Never, item 2"), { target: { value: "Long intros" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove item 1 from Never" }));
    expect((screen.getByLabelText("Never, item 1") as HTMLInputElement).value).toBe("Long intros");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(api.saveStyle).toHaveBeenCalledWith(SEED_TEAM_ID, { profile: { always: ["Open on the best moment"], never: ["Long intros"] } });
  });

  it("fills in only the empty fields from the videos, and tags them until saved", async () => {
    const references = [
      reference("r1"),
      reference("r2", { analysis: measured({ seconds: 44, shots: shots(20, 1.7) }) }),
      reference("r3", { status: "pending", analysis: null, hasSheet: false }),
    ];
    const { api } = page({ references, style: { ...STYLE, profile: { summary: "Bright and quick.", pace: "calm" } } });
    fireEvent.click(screen.getByRole("button", { name: "Fill in from my videos" }));
    // Pace was set (calm), so neither it nor a typical shot that disagrees with it is filled.
    expect(within(screen.getByRole("radiogroup", { name: "Pace" })).getByRole("radio", { name: "Calm" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByLabelText("Typical shot") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Shortest, in seconds") as HTMLInputElement).value).toBe("35");
    expect((screen.getByLabelText("Longest, in seconds") as HTMLInputElement).value).toBe("45");
    expect((screen.getByLabelText("How you open") as HTMLInputElement).value).toBe('Starts talking straight away: "Okay so today"');
    expect((screen.getByLabelText("In a sentence or two") as HTMLTextAreaElement).value).toBe("Bright and quick.");
    expect(within(yourStyle()).getByRole("status").textContent).toBe("Filled in 4 fields from your videos. Check them, then save.");
    expect(within(yourStyle()).getAllByText(STYLE_WORDS.form.filledTag)).toHaveLength(4);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    const sent = api.saveStyle.mock.calls[0][1] as StylePatch;
    expect(Object.keys(sent.profile ?? {}).sort()).toEqual(["captions", "formats", "hook", "lengthSeconds"]);
    expect(sent.profile).toMatchObject({ lengthSeconds: { min: 35, max: 45 }, formats: ["short_9x16"], captions: { on: true } });
    expect(within(yourStyle()).queryByText(STYLE_WORDS.form.filledTag)).toBeNull();
  });

  it("takes the Filled in tag off a field once it's changed by hand", () => {
    page({ references: [reference("r1")], style: { ...STYLE, profile: { summary: "Bright and quick.", pace: "calm" } } });
    fireEvent.click(screen.getByRole("button", { name: "Fill in from my videos" }));
    const tags = () => within(yourStyle()).queryAllByText(STYLE_WORDS.form.filledTag).length;
    const filled = tags();
    expect(filled).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("How you open"), { target: { value: "Straight to the goal" } });
    expect(tags()).toBe(filled - 1);
  });

  it("says what to do first when there's nothing to fill in from", () => {
    page({ references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })] });
    fireEvent.click(screen.getByRole("button", { name: "Fill in from my videos" }));
    expect(within(yourStyle()).getByRole("status").textContent).toBe(STYLE_WORDS.form.fillInFirst);
  });

  it("shows the server's words when a save is refused", async () => {
    const api = fakeApi({ saveStyle: vi.fn(async () => Promise.reject(new Error('Pace: use "calm", "steady", "quick" or "rapid".'))) });
    page({ api });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Pace" })).getByRole("radio", { name: "Steady" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("alert").textContent).toBe('Pace: use "calm", "steady", "quick" or "rapid".');
  });
});
