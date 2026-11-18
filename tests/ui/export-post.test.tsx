// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExportDeps } from "@/components/editor/export/deps";
import { SOCIAL_MESSAGES } from "@/lib/social/messages";
import type { PostInput, PostOutcome, Posting } from "@/lib/social/post-client";
import type { PostingStatus } from "@/lib/social/posts";
import { act, fireEvent, screen } from "../helpers/dom";
import { fakeTarget } from "../export/fakes";
import { click, dialog, emit, flush, show, startExport } from "./export-helpers";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const CHANNEL: PostingStatus = { available: true, channel: "Seattle Solvers", broken: false, canConnect: false, settingsPath: "/s/seattle-solvers/settings/socials" };
const FILE = new Blob(["0123456789"], { type: "video/mp4" });

// A posting that records what it was asked and ends each post the way the test says, when the test says.
function fakePosting(status: PostingStatus = CHANNEL) {
  const posts: PostInput[] = [];
  let settle: (outcome: PostOutcome) => void = () => {};
  const posting: Posting = {
    status: vi.fn(async () => status),
    post: vi.fn((input: PostInput) => {
      posts.push(input);
      return new Promise<PostOutcome>((resolve) => {
        settle = resolve;
        input.signal.addEventListener("abort", () => resolve({ status: "canceled" }));
      });
    }),
  };
  return { posting, posts, end: async (outcome: PostOutcome) => { await act(async () => settle(outcome)); await flush(); } };
}

// The editor with an export that has just finished, saved to a file that can be read back.
async function exported(posting: Posting | undefined, over: { read?: () => Promise<Blob | null> } = {}) {
  const target = fakeTarget();
  const pickTarget: ExportDeps["pickTarget"] = async (name) => ({ target, fileName: name, held: null, read: over.read ?? (async () => FILE) });
  const made = show({ posting, pickTarget });
  const d = await startExport();
  await emit(made.workers[0], { type: "done", bytes: 10, hasAudio: true });
  return { ...made, d };
}

const type = async (label: string, value: string) => {
  await act(async () => { fireEvent.change(dialog().getByLabelText(label), { target: { value } }); });
};

describe("posting an export to YouTube", () => {
  it("offers nothing where posting does not exist, or the person may not post", async () => {
    const none = await exported(undefined);
    expect(none.d.queryByRole("button", { name: "Post to YouTube" })).toBeNull();
    none.view.unmount();
    const { posting } = fakePosting({ available: false });
    const { d } = await exported(posting);
    expect(posting.status).toHaveBeenCalledWith("p1");
    expect(d.queryByRole("button", { name: "Post to YouTube" })).toBeNull();
    expect(d.queryByText(/YouTube/)).toBeNull();
  });

  it("asks about the channel only once an export has finished", async () => {
    const { posting } = fakePosting();
    const made = show({ posting });
    await startExport();
    expect(posting.status).not.toHaveBeenCalled();
    await emit(made.workers[0], { type: "done", bytes: 10, hasAudio: true });
    expect(posting.status).toHaveBeenCalledOnce();
  });

  it("asks again when the dialog opens and when the window comes back, so a channel connected meanwhile shows", async () => {
    let status: PostingStatus = { ...CHANNEL, channel: null, canConnect: true };
    const posting: Posting = { status: vi.fn(async () => status), post: vi.fn() };
    const { d } = await exported(posting);
    expect(d.queryByRole("button", { name: "Post to YouTube" })).toBeNull();
    status = CHANNEL; // connected in another tab
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await flush();
    expect(d.getByRole("button", { name: "Post to YouTube" })).toBeTruthy();
    expect(d.queryByRole("link", { name: "Open Socials settings" })).toBeNull();

    status = { available: false };
    await click("Close");
    await click("Export");
    expect(posting.status).toHaveBeenCalledTimes(3);
    expect(dialog().queryByRole("button", { name: "Post to YouTube" })).toBeNull();
  });

  it("the form starts on the project's name, Private, and says when the video is a Short", async () => {
    const { posting, posts } = fakePosting();
    const { d } = await exported(posting);
    await click("Post to YouTube");
    expect(d.getByText("Post this video to Seattle Solvers on YouTube.")).toBeTruthy();
    expect((d.getByLabelText("Title") as HTMLInputElement).value).toBe("Qual recap");
    expect((d.getByLabelText("Who can see it") as HTMLSelectElement).value).toBe("private");
    expect(d.getByRole("switch", { name: "This video is made for kids" }).getAttribute("aria-checked")).toBe("false");
    expect(d.getByText(/YouTube will show this as a Short/)).toBeTruthy();
    expect(posts).toEqual([]); // nothing is posted by opening the form
  });

  it("Post sends the exported file with the form, shows the upload, then the link", async () => {
    const { posting, posts, end } = fakePosting();
    const { d } = await exported(posting);
    await click("Post to YouTube");
    await type("Title", "Qualifier 2 recap");
    await type("Description", "Our best match yet");
    await type("Who can see it", "unlisted");
    await click("Post");
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ projectId: "p1", file: FILE, form: { title: "Qualifier 2 recap", description: "Our best match yet", visibility: "unlisted", madeForKids: false } });
    expect(d.getByText("Posting to Seattle Solvers…")).toBeTruthy();
    expect(d.getByRole("progressbar", { name: "Upload progress" }).getAttribute("max")).toBe("10");
    await act(async () => posts[0].onProgress(4));
    expect(d.getByRole("progressbar").getAttribute("value")).toBe("4");
    expect(d.queryByRole("button", { name: "Post" })).toBeNull();

    await end({ status: "posted", url: "https://youtu.be/video000001" });
    expect(d.getByRole("status").textContent).toBe("Posted to Seattle Solvers.");
    expect(d.getByRole("link", { name: "Open on YouTube" }).getAttribute("href")).toBe("https://youtu.be/video000001");
    expect(d.queryByText(/It's private/)).toBeNull();
    await click("Done");
    expect(screen.queryByText("Export", { selector: "h2" })).toBeNull();
  });

  it("says a private video is private, and shows no link when YouTube named no video", async () => {
    const { posting, end } = fakePosting();
    const { d } = await exported(posting);
    await click("Post to YouTube");
    await click("Post");
    await end({ status: "posted", url: null });
    expect(d.getByText(/It's private: only you can see it/)).toBeTruthy();
    expect(d.queryByRole("link", { name: "Open on YouTube" })).toBeNull();
  });

  it("refuses a form YouTube would refuse, without posting", async () => {
    const { posting, posts } = fakePosting();
    const { d } = await exported(posting);
    await click("Post to YouTube");
    await type("Title", "  ");
    await click("Post");
    expect(d.getByRole("alert").textContent).toBe("Give the video a title.");
    expect(posts).toEqual([]);
  });

  it("says to export again when the saved file can't be read any more", async () => {
    const { posting, posts } = fakePosting();
    const { d } = await exported(posting, { read: async () => null });
    await click("Post to YouTube");
    await click("Post");
    expect(d.getByRole("alert").textContent).toBe(SOCIAL_MESSAGES.cantRead);
    expect(posts).toEqual([]);
  });

  it("a post that failed goes back to the form with the reason and what was typed", async () => {
    const { posting, posts, end } = fakePosting();
    const { d } = await exported(posting);
    await click("Post to YouTube");
    await type("Title", "Take two");
    await click("Post");
    await end({ status: "failed", message: SOCIAL_MESSAGES.quota });
    expect(d.getByRole("alert").textContent).toBe(SOCIAL_MESSAGES.quota);
    expect((d.getByLabelText("Title") as HTMLInputElement).value).toBe("Take two");
    await click("Post");
    expect(posts).toHaveLength(2);
  });

  it("Cancel stops the upload and goes back to the form", async () => {
    const { posting, posts } = fakePosting();
    const { d } = await exported(posting);
    await click("Post to YouTube");
    await click("Post");
    await click("Cancel");
    expect(posts[0].signal.aborted).toBe(true);
    expect(d.getByRole("button", { name: "Post" })).toBeTruthy();
    expect(d.queryByRole("alert")).toBeNull();
  });

  it("Back returns to the finished export, and a double-click on Post posts once", async () => {
    const { posting, posts } = fakePosting();
    const { d } = await exported(posting);
    await click("Post to YouTube");
    await click("Back");
    expect(d.getByRole("status").textContent).toContain("Saved Qual recap.mp4");
    await click("Post to YouTube");
    await act(async () => {
      const button = d.getByRole("button", { name: "Post" });
      fireEvent.click(button, { detail: 1 });
      fireEvent.click(button, { detail: 2 });
    });
    await flush();
    expect(posts).toHaveLength(1);
  });

  it("keeps uploading while the dialog is closed, and shows where it stands when opened again", async () => {
    const { posting, posts, end } = fakePosting();
    await exported(posting);
    await click("Post to YouTube");
    await click("Post");
    await click("Close");
    expect(screen.queryByText("Export", { selector: "h2" })).toBeNull();
    expect(posts[0].signal.aborted).toBe(false);
    await end({ status: "posted", url: "https://youtu.be/video000001" });
    await click("Export");
    expect(dialog().getByRole("status").textContent).toBe("Posted to Seattle Solvers.");
  });

  it("leaving the editor stops the upload", async () => {
    const { posting, posts } = fakePosting();
    const { view } = await exported(posting);
    await click("Post to YouTube");
    await click("Post");
    view.unmount();
    expect(posts[0].signal.aborted).toBe(true);
  });

  it("with no channel, tells an admin where to connect one and anyone else who can", async () => {
    const admin = await exported(fakePosting({ ...CHANNEL, channel: null, canConnect: true }).posting);
    expect(admin.d.queryByRole("button", { name: "Post to YouTube" })).toBeNull();
    const link = admin.d.getByRole("link", { name: "Open Socials settings" });
    expect(link.getAttribute("href")).toBe("/s/seattle-solvers/settings/socials");
    expect(link.getAttribute("target")).toBe("_blank");
    admin.view.unmount();
    const editor = await exported(fakePosting({ ...CHANNEL, channel: null }).posting);
    expect(editor.d.getByText("An admin of this space can connect a YouTube channel in Settings, Socials.")).toBeTruthy();
    expect(editor.d.queryByRole("link")).toBeNull();
  });

  it("a broken connection offers no Post, and says who must reconnect", async () => {
    const editor = await exported(fakePosting({ ...CHANNEL, broken: true }).posting);
    expect(editor.d.queryByRole("button", { name: "Post to YouTube" })).toBeNull();
    expect(editor.d.getByText(SOCIAL_MESSAGES.broken)).toBeTruthy();
    editor.view.unmount();
    const admin = await exported(fakePosting({ ...CHANNEL, broken: true, canConnect: true }).posting);
    expect(admin.d.getByText(/needs connecting again/)).toBeTruthy();
    expect(admin.d.getByRole("link", { name: "Open Socials settings" })).toBeTruthy();
  });

  it("posts a file held in memory where the browser has no save dialog", async () => {
    const { posting, posts } = fakePosting();
    const held = new Blob(["abc"]);
    const target = fakeTarget();
    const made = show({ posting, savesToFile: false, pickTarget: async (name) => ({ target, fileName: name, held: () => held }) });
    await startExport();
    await emit(made.workers[0], { type: "done", bytes: 3, hasAudio: true });
    await click("Post to YouTube");
    await click("Post");
    expect(posts[0].file).toBe(held);
  });
});
