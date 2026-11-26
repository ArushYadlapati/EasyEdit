// @vitest-environment happy-dom
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { MediaServices } from "@/components/editor/media/media-context";
import type { MediaApi } from "@/lib/media/api";
import { createLibraryStore } from "@/lib/media/library-store";
import { createLocalFolder } from "@/lib/media/local-folder";
import { MEDIA_MESSAGES } from "@/lib/media/messages";
import type { StyleApi } from "@/components/style/style-api";
import { StylePage, type StyleProject } from "@/components/style/style-page";
import type { AnalyzeReferenceOptions, ReferenceProgress } from "@/components/style/use-analyze-reference";
import type { AssetView, UploadItem } from "@/lib/media/types";
import type { ChannelStatus } from "@/lib/style/channel";
import { STYLE_MESSAGES, STYLE_WORDS } from "@/lib/style/messages";
import { applyStylePatch, DEFAULT_STYLE, type Style, type StylePatch, type StyleReference, type VideoAnalysis } from "@/lib/style/types";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { act, fireEvent, render, screen, waitFor, within } from "../helpers/dom";
import { fakeFolder } from "../helpers/fake-folder";
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
    // Named for what it is, not as something to do: a viewer can't add to it.
    expect(screen.getByRole("region", { name: "What your style learns from" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Learn from your videos" })).toBeNull();
    // Who changed it last sits under the heading, not off at the far side on its own.
    expect(within(yourStyle()).getByText("Last changed by Claude (for Ada), 2 hours ago").className).not.toMatch(/ml-auto/);
    expect(screen.getByText("Bright and quick.")).toBeTruthy();
    expect(screen.getByText("Quick: A new shot every 1.2 to 2.5 seconds.")).toBeTruthy();
    expect(screen.getByText("long intros")).toBeTruthy();
    expect(screen.getByText("Keep it bright.")).toBeTruthy();
    expect(screen.getByText("Video r1")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("region", { name: "Try it" })).toBeNull();
  });

  it("tells a viewer when nothing is filled in yet, and who can fill it in", () => {
    page({ canEdit: false, style: DEFAULT_STYLE });
    expect(within(yourStyle()).getByText("Nothing yet. An editor can fill this in.")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "What your style learns from" })).getByText("Nothing yet.")).toBeTruthy();
  });

  it("tells a viewer a video couldn't be looked at without the reason meant for the editor, and offers nothing to press", () => {
    const failed = reference("r1", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.unreadable });
    page({ canEdit: false, references: [failed], assets: [assetView({ id: "asset-r1" })] });
    expect(screen.getByText(STYLE_WORDS.learn.failedViewer)).toBeTruthy();
    expect(screen.queryByText(STYLE_WORDS.analysisFailed.unreadable)).toBeNull();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
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
    // Add does nothing for a link like this, so it's off until the link is changed.
    const add = screen.getByRole("button", { name: "Add link" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.click(add);
    expect(api.addReference).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Video link"), { target: { value: "https://vm.tiktok.com/ZMh1a2b3c/" } });
    expect(screen.getByRole("alert").textContent).toBe(STYLE_MESSAGES.tiktokShareLink);
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Video link"), { target: { value: "https://www.instagram.com/reel/Cabc123/" } });
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
    // Add and Cancel sit together, so a narrow window wraps them as a pair.
    expect(screen.getByRole("button", { name: "Add link" }).parentElement).toBe(screen.getByRole("button", { name: "Cancel" }).parentElement);
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
    act(() => analyze.options!.onDone!(reference("r1", { analysis: measured({ sheet: { times: [0.2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], columns: 4, rows: 3 } }) })));
    expect(screen.getByText("38 s · 24 shots, about 1.6 s each · talks 170 words a minute")).toBeTruthy();
    // The card shows the strip's first tile only: the strip drawn 4 tiles wide and 3 high, from its top-left corner.
    const picture = learn().querySelector("img")!;
    expect(picture.getAttribute("src")).toBe("/api/style/references/r1/sheet?v=2026-11-25T20%3A00%3A00.000Z");
    expect([picture.style.width, picture.style.height]).toEqual(["400%", "300%"]);
    expect(picture.parentElement!.style.aspectRatio).toBe("1080 / 1920");
  });

  it("shows a measured video's still from the library once it has loaded, in place of its strip's first tile", async () => {
    const base = pretendMediaServices([assetView({ id: "asset-r1", posterFileId: "post-r1" })]);
    const files = { ...base.files, get: vi.fn(async (id: string) => (id === "post-r1" ? { ok: true as const, blob: new Blob(["still"], { type: "image/jpeg" }) } : new Promise<never>(() => {}))) };
    page({ services: { ...base, files }, references: [reference("r1", { analysis: measured({ sheet: { times: [0.2, 1, 2], columns: 3, rows: 1 } }) })] });
    await waitFor(() => expect(learn().querySelector("img")?.getAttribute("src")).toMatch(/^blob:/));
    expect(files.get).toHaveBeenCalledWith("post-r1");
    expect(learn().querySelectorAll("img")).toHaveLength(1);
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
    // Upload a video, then what happens next.
    const hint = within(dialog).getByText("New uploads appear here once they're ready to pick.");
    const upload = within(dialog).getByRole("button", { name: STYLE_WORDS.video.upload });
    expect(upload.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("names a link whose details couldn't be read by its site, and still opens its address", () => {
    const url = "https://www.tiktok.com/@paperplanesclub/video/7301234567890123456";
    const unread = linkReference("r1", {
      provider: "tiktok",
      title: url,
      author: undefined,
      url,
      thumbnailUrl: undefined,
      analysis: { kind: "link", provider: "tiktok", title: url, fetchedAt: NOW.toISOString(), unreadable: true },
    });
    page({ references: [unread] });
    const title = within(learn()).getByRole("link", { name: "TikTok video from @paperplanesclub" });
    expect(title.getAttribute("href")).toBe(url);
    expect(within(learn()).getByRole("button", { name: "Remove TikTok video from @paperplanesclub" })).toBeTruthy();
    expect(within(learn()).queryByText(url)).toBeNull();
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
    expect(within(learn()).getByRole("link", { name: "YouTube video" }).getAttribute("href")).toBe(url);
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
    expect(within(dialog).getByText("The newest public videos on Paper Planes Club.")).toBeTruthy();
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

  it("is off, saying what it waits for, until something it can learn from is ready", () => {
    const fill = () => screen.getByRole("button", { name: "Fill in from my videos" }) as HTMLButtonElement;
    const { view } = page();
    expect(fill().disabled).toBe(true);
    expect(within(yourStyle()).getByText(STYLE_WORDS.form.fillInFirst).id).toBe(fill().getAttribute("aria-describedby"));
    view.unmount();

    page({ references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })], assets: [assetView({ id: "asset-r1" })] });
    expect(fill().disabled).toBe(true);
    expect(within(yourStyle()).getByText("We can fill this in once a video above has been looked at.")).toBeTruthy();
    expect(within(yourStyle()).queryByRole("status")).toBeNull();
    // Once the video has been looked at, it can be used.
    act(() => analyze.options!.onDone!(reference("r1")));
    expect(fill().disabled).toBe(false);
    expect(within(yourStyle()).queryByText("We can fill this in once a video above has been looked at.")).toBeNull();
    expect(fill().hasAttribute("aria-describedby")).toBe(false);
  });

  it("says so when nothing added could be looked at, rather than to add a video or wait", () => {
    const failed = reference("r1", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.unreadable });
    page({ references: [failed], assets: [assetView({ id: "asset-r1" })] });
    const fill = screen.getByRole("button", { name: "Fill in from my videos" }) as HTMLButtonElement;
    expect(fill.disabled).toBe(true);
    expect(within(yourStyle()).getByText(STYLE_WORDS.form.fillInFailed).id).toBe(fill.getAttribute("aria-describedby"));
    expect(within(yourStyle()).queryByText(STYLE_WORDS.form.fillInFirst)).toBeNull();
    expect(within(yourStyle()).queryByText(STYLE_WORDS.form.fillInWaiting)).toBeNull();
  });

  it("names what it filled in from: the videos, links or projects it read", () => {
    const project = reference("r2", {
      kind: "project",
      assetId: undefined,
      projectId: "p1",
      hasSheet: false,
      analysis: {
        kind: "project",
        seconds: 40,
        format: "short_9x16",
        fps: 30,
        shots: shots(20, 2),
        text: { clips: 0, perMinute: 0, fonts: [], averageWords: 0, sizes: { small: 0, medium: 0, large: 0 } },
        captions: null,
        transitions: { fade: 0, crossfade: 0, slide: 0, zoom: 0, whip: 0, dip: 0 },
        textAnimations: {},
        music: null,
        speedChanges: 0,
        looks: {},
        effects: [],
      },
    });
    page({ references: [reference("r1"), project], style: DEFAULT_STYLE });
    fireEvent.click(screen.getByRole("button", { name: "Fill in from my videos" }));
    expect(within(yourStyle()).getByRole("status").textContent).toMatch(/^Filled in \d+ fields from your videos and projects\. Check them, then save\.$/);
    // Only what was read is named, in the page's order, each kind once.
    expect(STYLE_WORDS.form.filledSome(1, ["link"])).toBe("Filled in 1 field from your links. Check them, then save.");
    expect(STYLE_WORDS.form.filledSome(3, ["project", "link", "video", "link"])).toBe("Filled in 3 fields from your videos, links and projects. Check them, then save.");
  });

  it("gives a sentence room to show: the summary, how you open, and voice and tone grow with what's typed", () => {
    page();
    for (const name of ["In a sentence or two", "How you open", "Voice and tone"]) {
      const box = screen.getByLabelText(name);
      expect(box.tagName).toBe("TEXTAREA");
      expect(box.className).toContain("[field-sizing:content]");
    }
    // Where a browser can't size a box to its words, it gets as many rows.
    expect(screen.getByLabelText("In a sentence or two").getAttribute("rows")).toBe("3");
    expect(screen.getByLabelText("How you open").getAttribute("rows")).toBe("2");
  });

  it("shows the server's words when a save is refused", async () => {
    const api = fakeApi({ saveStyle: vi.fn(async () => Promise.reject(new Error('Pace: use "calm", "steady", "quick" or "rapid".'))) });
    page({ api });
    fireEvent.click(within(screen.getByRole("radiogroup", { name: "Pace" })).getByRole("radio", { name: "Steady" }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("alert").textContent).toBe('Pace: use "calm", "steady", "quick" or "rapid".');
  });
});

// A video kept in a media folder on this computer, with its copies there too.
const localVideo = (id: string) => assetView({ id, originalFileId: `local:${id}`, previewFileId: `local:${id}:preview`, posterFileId: `local:${id}:poster` });

// Media services whose media folder this browser remembers, as the browser answers for it now and once asked. load: when
// the remembered folder is found (at once unless given).
function withFolder(services: MediaServices, permission: Parameters<typeof fakeFolder>[1], load?: Promise<void>) {
  const kept = fakeFolder("Footage", permission);
  const local = createLocalFolder({ load: async () => (await load, kept), save: async () => {} });
  return { services: { ...services, local }, kept };
}

describe("a video kept in a media folder on this computer", () => {
  it("isn't looked at while the browser wants a click to open the folder again, and is once Open folder is pressed", async () => {
    const waiting = reference("r1", { status: "pending", analysis: null, hasSheet: false });
    const { services, kept } = withFolder(pretendMediaServices([localVideo("asset-r1")]), { now: "prompt", onAsk: "granted" });
    page({ references: [waiting], services });
    const card = await within(learn()).findByText(STYLE_WORDS.learn.folderLocked("Footage"));
    expect(analyze.run).not.toHaveBeenCalled();
    expect(within(learn()).queryByText(STYLE_WORDS.learn.notLookedAt)).toBeNull();
    await act(async () => fireEvent.click(within(card.parentElement!).getByRole("button", { name: "Open folder" })));
    expect(kept.asked).toBe(1);
    expect(analyze.run).toHaveBeenCalledWith(waiting, expect.objectContaining({ id: "asset-r1" }));
    expect(within(learn()).queryByText(STYLE_WORDS.learn.folderLocked("Footage"))).toBeNull();
  });

  it("waits for the folder to be looked up before looking at the video, so it isn't marked unreadable by mistake", async () => {
    let found!: () => void;
    const lookup = new Promise<void>((resolve) => (found = resolve));
    const { services } = withFolder(pretendMediaServices([localVideo("asset-r1"), assetView({ id: "asset-r2" })]), { now: "granted" }, lookup);
    page({ references: [reference("r1", { status: "pending", analysis: null, hasSheet: false }), reference("r2", { status: "pending", analysis: null, hasSheet: false })], services });
    // A video in the space's storage needn't wait.
    expect(analyze.run).toHaveBeenCalledTimes(1);
    expect(analyze.run).toHaveBeenCalledWith(expect.objectContaining({ id: "r2" }), expect.objectContaining({ id: "asset-r2" }));
    await act(async () => found());
    expect(analyze.run).toHaveBeenCalledTimes(2);
    expect(analyze.run).toHaveBeenLastCalledWith(expect.objectContaining({ id: "r1" }), expect.objectContaining({ id: "asset-r1" }));
  });

  it("offers Open folder in place of Try again, and tries again once it's open", async () => {
    const failed = reference("r1", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.unreadable });
    const { services } = withFolder(pretendMediaServices([localVideo("asset-r1")]), { now: "prompt", onAsk: "granted" });
    page({ references: [failed], services });
    await within(learn()).findByText(STYLE_WORDS.learn.folderLocked("Footage"));
    expect(within(learn()).queryByRole("button", { name: "Try again" })).toBeNull();
    await act(async () => fireEvent.click(within(learn()).getByRole("button", { name: "Open folder" })));
    expect(analyze.run).toHaveBeenCalledWith(failed, expect.objectContaining({ id: "asset-r1" }));
  });

  it("doesn't offer Open folder for a video that would only fail again, or one taken out of the media", async () => {
    const tooLong = reference("r1", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.tooLong });
    const removed = reference("r2", { status: "pending", analysis: null, hasSheet: false });
    const { services } = withFolder(pretendMediaServices([localVideo("asset-r1"), { ...localVideo("asset-r2"), removed: true }]), { now: "prompt", onAsk: "granted" });
    page({ references: [tooLong, removed], services });
    await waitFor(() => expect(services.local.state()).toBe("locked"));
    expect(within(learn()).queryByRole("button", { name: "Open folder" })).toBeNull();
    expect(within(learn()).queryByText(STYLE_WORDS.learn.folderLocked("Footage"))).toBeNull();
    expect(within(learn()).getByText(STYLE_WORDS.analysisFailed.tooLong)).toBeTruthy();
    expect(within(learn()).queryByRole("button", { name: "Try again" })).toBeNull();
    expect(within(learn()).getByText(STYLE_WORDS.analysisFailed.missing)).toBeTruthy();
  });

  it("keeps offering Open folder when the browser is told no", async () => {
    const { services } = withFolder(pretendMediaServices([localVideo("asset-r1")]), { now: "prompt", onAsk: "denied" });
    page({ references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })], services });
    await act(async () => fireEvent.click(await within(learn()).findByRole("button", { name: "Open folder" })));
    expect(analyze.run).not.toHaveBeenCalled();
    expect(within(learn()).getByRole("button", { name: "Open folder" })).toBeTruthy();
  });

  it("is offered in Add a video, as the Media tab offers it, rather than saying the space has no storage", async () => {
    const { services } = withFolder(pretendMediaServices([]), { now: "prompt", onAsk: "granted" });
    page({ services, storageReady: false });
    fireEvent.click(screen.getByRole("button", { name: "Add a video" }));
    const dialog = screen.getByRole("dialog", { name: "Add a video" });
    await within(dialog).findByText(MEDIA_MESSAGES.folderLocked("Footage"));
    expect(within(dialog).queryByText(STYLE_WORDS.video.noStorage)).toBeNull();
    expect(within(dialog).queryByRole("button", { name: STYLE_WORDS.video.upload })).toBeNull();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Open folder" })));
    expect(within(dialog).getByRole("button", { name: STYLE_WORDS.video.upload })).toBeTruthy();
    expect(within(dialog).queryByText(MEDIA_MESSAGES.folderLocked("Footage"))).toBeNull();
  });
});

describe("Try again", () => {
  // A library whose full list doesn't hold the video (still on its way, or the video is older than the newest it
  // lists), and whose answer for the video by its id is given.
  function libraryAsked(byId: (ids: string[]) => ReturnType<MediaApi["list"]>) {
    const base = pretendMediaServices([], { loaded: false });
    const list = vi.fn((ids?: string[]) => (ids ? byId(ids) : new Promise<never>(() => {})));
    return { services: { ...base, library: createLibraryStore({ api: { list } as unknown as MediaApi }) }, list };
  }
  const failed = reference("r1", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.unreadable });

  it("asks for a video the library hasn't listed yet before saying it's gone", async () => {
    const { services, list } = libraryAsked(async () => ({ ok: true, assets: [assetView({ id: "asset-r1" })], setUp: true }));
    page({ references: [failed], services });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(list).toHaveBeenCalledWith(["asset-r1"]);
    expect(screen.queryByText(STYLE_WORDS.analysisFailed.missing)).toBeNull();
    expect(analyze.run).toHaveBeenCalledWith(failed, expect.objectContaining({ id: "asset-r1" }));
  });

  it("says the server couldn't be reached, not that the video is gone, when there's no answer", async () => {
    const { services } = libraryAsked(async () => ({ ok: false, kind: "network", message: "" }));
    page({ references: [failed], services });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(screen.getByRole("alert").textContent).toBe(MEDIA_MESSAGES.noAnswer);
    expect(analyze.run).not.toHaveBeenCalled();
  });

  it("says the video is gone when the server says so", async () => {
    const { services } = libraryAsked(async () => ({ ok: true, assets: [], setUp: true }));
    page({ references: [failed], services });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try again" })));
    expect(screen.getByRole("alert").textContent).toBe(STYLE_WORDS.analysisFailed.missing);
    expect(analyze.run).not.toHaveBeenCalled();
  });

  it("isn't offered for a video longer than a style looks at, which would only fail again", () => {
    const tooLong = reference("r1", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.tooLong });
    const { view } = page({ references: [tooLong], assets: [assetView({ id: "asset-r1" })] });
    expect(screen.getByText(STYLE_WORDS.analysisFailed.tooLong)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Video r1" })).toBeTruthy();
    view.unmount();

    // Known from the library to be too long, whatever went wrong.
    const other = reference("r1", { status: "failed", analysis: null, hasSheet: false, failure: STYLE_WORDS.analysisFailed.unknown });
    page({ references: [other], assets: [assetView({ id: "asset-r1", durationMs: 5 * 60 * 60 * 1000 })] });
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("leaving the page", () => {
  const upload = (over: Partial<UploadItem> = {}): UploadItem => ({
    key: "k1",
    fileName: "match.mp4",
    sizeBytes: 400_000_000,
    durationMs: 60_000,
    stage: "uploading",
    sentBytes: 1000,
    previewFraction: 0,
    assetId: "up1",
    message: null,
    canRetry: false,
    ...over,
  });
  // Whether closing or reloading the tab now would make the browser ask first.
  const asksBeforeUnload = () => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  // A link elsewhere in the app, as the settings tabs and the sidebar are. followed: each click it got, with whether
  // the app's own handling was stopped.
  function appLink(href = "/s/seattle-solvers/settings/brand") {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = "Brand kit";
    const followed: boolean[] = [];
    link.addEventListener("click", (event) => {
      followed.push(event.defaultPrevented);
      event.preventDefault(); // the test's window stays where it is
    });
    document.body.append(link);
    return { link, followed, [Symbol.dispose]: () => link.remove() };
  }

  it("asks first while an upload started here is running, since leaving stops it", async () => {
    const services = pretendMediaServices([]);
    page({ services });
    expect(asksBeforeUnload()).toBe(false);
    act(() => services.library.getState().setUploads([upload()]));
    expect(asksBeforeUnload()).toBe(true);

    using app = appLink();
    fireEvent.click(app.link);
    const dialog = screen.getByRole("dialog", { name: STYLE_WORDS.leave.title });
    expect(within(dialog).getByText(STYLE_WORDS.leave.uploading)).toBeTruthy();
    expect(app.followed).toEqual([]);
    fireEvent.click(within(dialog).getByRole("button", { name: STYLE_WORDS.leave.stay }));
    expect(screen.queryByRole("dialog", { name: STYLE_WORDS.leave.title })).toBeNull();
    expect(app.followed).toEqual([]);

    fireEvent.click(app.link);
    await act(async () => fireEvent.click(within(screen.getByRole("dialog", { name: STYLE_WORDS.leave.title })).getByRole("button", { name: STYLE_WORDS.leave.leave })));
    expect(app.followed).toEqual([false]);
    expect(screen.queryByRole("dialog", { name: STYLE_WORDS.leave.title })).toBeNull();
  });

  it("lets a link go once the upload is done, and leaves links to other sites and new tabs to the browser", () => {
    const services = pretendMediaServices([]);
    page({ services });
    act(() => services.library.getState().setUploads([upload()]));
    {
      using elsewhere = appLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      fireEvent.click(elsewhere.link);
      expect(elsewhere.followed).toEqual([false]);
    }
    {
      using app = appLink();
      fireEvent.click(app.link, { metaKey: true });
      expect(app.followed).toEqual([false]);
    }
    act(() => services.library.getState().setUploads([upload({ stage: "done" })]));
    expect(asksBeforeUnload()).toBe(false);
    using app = appLink();
    fireEvent.click(app.link);
    expect(app.followed).toEqual([false]);
    expect(screen.queryByRole("dialog", { name: STYLE_WORDS.leave.title })).toBeNull();
  });

  it("asks first while there are changes Save hasn't sent, and not once they're saved", async () => {
    page();
    expect(asksBeforeUnload()).toBe(false);
    fireEvent.change(screen.getByLabelText("Voice and tone"), { target: { value: "Friendly" } });
    expect(asksBeforeUnload()).toBe(true);
    {
      using app = appLink();
      fireEvent.click(app.link);
      const dialog = screen.getByRole("dialog", { name: STYLE_WORDS.leave.title });
      expect(within(dialog).getByText(STYLE_WORDS.leave.unsaved)).toBeTruthy();
      expect(within(dialog).queryByText(STYLE_WORDS.leave.uploading)).toBeNull();
      fireEvent.click(within(dialog).getByRole("button", { name: STYLE_WORDS.leave.stay }));
    }
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(asksBeforeUnload()).toBe(false);
  });

  it("counts a number box typed into as a change, even before it holds a number", () => {
    page({ style: DEFAULT_STYLE });
    fireEvent.change(screen.getByLabelText("Typical shot"), { target: { value: "abc" } });
    expect(asksBeforeUnload()).toBe(true);
  });

  it("asks first while a video is being looked at", () => {
    analyze.progress = { r1: { stage: "shots", done: 0.3 } };
    page({ references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })], assets: [assetView({ id: "asset-r1" })] });
    expect(asksBeforeUnload()).toBe(true);
    using app = appLink();
    fireEvent.click(app.link);
    expect(within(screen.getByRole("dialog", { name: STYLE_WORDS.leave.title })).getByText(STYLE_WORDS.leave.looking)).toBeTruthy();
  });

  it("never asks a viewer, who has nothing to lose", () => {
    analyze.progress = { r1: { stage: "shots", done: 0.3 } };
    page({ canEdit: false, references: [reference("r1", { status: "pending", analysis: null, hasSheet: false })] });
    expect(asksBeforeUnload()).toBe(false);
  });

  it("shows an upload that stopped when its page was left as stopped, with how to finish it, not as still uploading", () => {
    const services = pretendMediaServices([assetView({ id: "up1", name: "match", status: "uploading", originalFileId: null }), assetView({ id: "up2", name: "pit tour", status: "uploading", originalFileId: null })]);
    services.library.getState().setUploads([upload({ assetId: "up2", fileName: "pit tour.mp4" })]);
    page({ services });
    fireEvent.click(screen.getByRole("button", { name: "Add a video" }));
    const dialog = screen.getByRole("dialog", { name: "Add a video" });
    const tile = (name: string) => within(dialog).getByRole("button", { name: `Add ${name}` });
    expect(within(tile("match")).getByText(STYLE_WORDS.video.uploadStopped)).toBeTruthy();
    expect((tile("match") as HTMLButtonElement).disabled).toBe(true);
    expect(within(tile("pit tour")).getByText(STYLE_WORDS.video.uploading)).toBeTruthy();
  });
});

describe("Try it", () => {
  it("waits until the style has something for an agent to read", async () => {
    const api = fakeApi({ addReference: vi.fn(async () => linkReference("r9")) });
    page({ api, style: DEFAULT_STYLE });
    expect(screen.queryByRole("region", { name: "Try it" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Paste a link" }));
    fireEvent.change(screen.getByLabelText("Video link"), { target: { value: "https://vimeo.com/76979871" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add link" })));
    expect(screen.getByRole("region", { name: "Try it" })).toBeTruthy();
  });

  it("shows once a field is saved", async () => {
    page({ style: DEFAULT_STYLE });
    fireEvent.change(screen.getByLabelText("Voice and tone"), { target: { value: "Friendly" } });
    expect(screen.queryByRole("region", { name: "Try it" })).toBeNull(); // not before it's saved
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(screen.getByRole("region", { name: "Try it" })).toBeTruthy();
  });
});
