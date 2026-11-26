// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { EditorProvider } from "@/components/editor/context";
import { ReviewProvider } from "@/components/editor/review/review-context";
import { ReviewPanel } from "@/components/editor/review/review-panel";
import type { ReviewApi, Role } from "@/lib/review/client";
import { REVIEW_MESSAGES, type CommentView, type VersionView } from "@/lib/review/rules";
import { makeStore } from "../editor/fixtures";
import { act, cleanup, fireEvent, render, screen, within } from "../helpers/dom";

afterEach(cleanup);

const comment = (id: string, frame: number, body: string, over: Partial<CommentView> = {}): CommentView => ({ id, frame, body, authorId: "ana", author: "Ana", parentId: null, resolved: false, createdAt: new Date(Date.now() - 120_000).toISOString(), editedAt: null, ...over });
const version = (id: string, name: string, over: Partial<VersionView> = {}): VersionView => ({ id, name, version: 3, by: "Ben", createdAt: new Date(Date.now() - 3_600_000).toISOString(), stale: false, ...over });
const flush = () => act(async () => {});

// A pretend server: it keeps the comments and versions and answers as the routes do.
function show(options: { me?: string; role?: Role; comments?: CommentView[]; versions?: VersionView[]; canEdit?: boolean; fail?: Partial<Record<keyof ReviewApi, string>> } = {}) {
  const me = options.me ?? "ben";
  const kept = { comments: [...(options.comments ?? [])], versions: [...(options.versions ?? [])] };
  let n = 0;
  const failing = <T,>(key: keyof ReviewApi, work: () => T) => (options.fail?.[key] ? { ok: false as const, message: options.fail[key]! } : work());
  const api: ReviewApi = {
    comments: vi.fn(async () => failing("comments", () => ({ ok: true as const, comments: [...kept.comments], me, role: options.role ?? "editor" }))),
    addComment: vi.fn(async (input) => failing("addComment", () => {
      const made = comment(`new${++n}`, input.frame, input.body.trim(), { authorId: me, author: "Ben", parentId: input.parentId ?? null, createdAt: new Date().toISOString() });
      kept.comments.push(made);
      return { ok: true as const, comment: made };
    })),
    updateComment: vi.fn(async (id, patch) => failing("updateComment", () => {
      const index = kept.comments.findIndex((c) => c.id === id);
      kept.comments[index] = { ...kept.comments[index], ...(patch.body !== undefined ? { body: patch.body, editedAt: new Date().toISOString() } : {}), ...(patch.resolved !== undefined ? { resolved: patch.resolved } : {}) };
      return { ok: true as const, comment: kept.comments[index] };
    })),
    deleteComment: vi.fn(async (id) => failing("deleteComment", () => {
      kept.comments = kept.comments.filter((c) => c.id !== id && c.parentId !== id);
      return { ok: true as const };
    })),
    versions: vi.fn(async () => failing("versions", () => ({ ok: true as const, versions: [...kept.versions] }))),
    saveVersion: vi.fn(async (name) => failing("saveVersion", () => {
      kept.versions.unshift(version(`v${++n}`, name.trim(), { createdAt: new Date().toISOString() }));
      return { ok: true as const, id: `v${n}` };
    })),
    renameVersion: vi.fn(async (id, name) => failing("renameVersion", () => {
      kept.versions = kept.versions.map((v) => (v.id === id ? { ...v, name } : v));
      return { ok: true as const };
    })),
    deleteVersion: vi.fn(async (id) => failing("deleteVersion", () => {
      kept.versions = kept.versions.filter((v) => v.id !== id);
      return { ok: true as const };
    })),
    openVersion: vi.fn(async () => failing("openVersion", () => ({ ok: true as const, id: "copy1" }))),
  };
  const store = makeStore({ canEdit: options.canEdit ?? true });
  render(
    <EditorProvider store={store}>
      <ReviewProvider api={api} projectHref={(id) => `/s/team/editor/${id}`}>
        <ReviewPanel />
      </ReviewProvider>
    </EditorProvider>,
  );
  const threads = () => [...document.querySelectorAll<HTMLElement>("[data-comment]")];
  return { api, store, kept, threads };
}
const write = (label: string, text: string) => fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value: text } });

it("lists the comments as threads in timeline order, each with its moment, and hides resolved ones until asked", async () => {
  const { threads } = show({ comments: [comment("b", 300, "End card is late"), comment("a", 45, "Trim this"), comment("r", 45, "Agreed", { parentId: "a", author: "Cy", authorId: "cy" }), comment("d", 10, "Done already", { resolved: true })] });
  await flush();
  expect(threads().map((t) => t.dataset.comment)).toEqual(["a", "b"]);
  expect(within(threads()[0]).getByRole("button", { name: "Go to 0:01:15" })).toBeTruthy();
  expect(threads()[0].textContent).toContain("Agreed");
  fireEvent.click(screen.getByRole("switch", { name: "Show resolved (1)" }));
  expect(threads().map((t) => t.dataset.comment)).toEqual(["d", "a", "b"]);
});

it("a comment is written at the playhead, and its moment takes the playhead back there", async () => {
  const { api, store, threads } = show();
  await flush();
  expect(screen.getByText(/No comments yet/)).toBeTruthy();
  act(() => store.getState().seek(75));
  const send = screen.getByRole("button", { name: "Comment" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  write("Comment at 0:02:15", "The logo is cut off");
  fireEvent.click(send);
  await flush();
  expect(api.addComment).toHaveBeenCalledWith({ frame: 75, body: "The logo is cut off" });
  expect(threads()).toHaveLength(1);
  expect((screen.getByRole("textbox", { name: "Comment at 0:02:15" }) as HTMLTextAreaElement).value).toBe("");
  act(() => store.getState().seek(0));
  fireEvent.click(screen.getByRole("button", { name: "Go to 0:02:15" }));
  expect(store.getState().playhead).toBe(75);
});

it("typing in a comment never reaches the editor's own keys", async () => {
  show();
  await flush();
  const seen = vi.fn();
  window.addEventListener("keydown", seen);
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Comment at 0:00:00" }), { key: " " });
  window.removeEventListener("keydown", seen);
  expect(seen).not.toHaveBeenCalled();
});

it("a thread is replied to, resolved and reopened", async () => {
  const { api, threads } = show({ comments: [comment("a", 45, "Trim this")] });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Reply" }));
  write("Reply to Ana", "On it");
  fireEvent.click(within(threads()[0]).getByRole("button", { name: "Reply" }));
  await flush();
  expect(api.addComment).toHaveBeenCalledWith({ frame: 45, body: "On it", parentId: "a" });
  expect(threads()[0].textContent).toContain("On it");
  fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
  await flush();
  expect(threads()).toHaveLength(0);
  expect(screen.getByText("Every comment is resolved.")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "Show resolved (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await flush();
  expect(api.updateComment).toHaveBeenLastCalledWith("a", { resolved: false });
});

it("offers each person only what they may do", async () => {
  const mine = comment("m", 10, "Mine", { authorId: "cy", author: "Cy" });
  const theirs = comment("t", 20, "Theirs");
  const viewer = show({ me: "cy", role: "viewer", comments: [mine, theirs] });
  await flush();
  const [own, other] = viewer.threads();
  expect(["Edit", "Resolve", "Reply"].map((name) => within(own).queryByRole("button", { name }) !== null)).toEqual([true, true, true]);
  expect(within(own).queryByRole("button", { name: "Delete the comment by Cy" })).not.toBeNull();
  expect(["Edit", "Resolve"].map((name) => within(other).queryByRole("button", { name }) !== null)).toEqual([false, false]);
  expect(within(other).queryByRole("button", { name: "Delete the comment by Ana" })).toBeNull();
  expect(within(other).queryByRole("button", { name: "Reply" })).not.toBeNull();
  cleanup();
  const admin = show({ me: "zed", role: "admin", comments: [theirs] });
  await flush();
  expect(within(admin.threads()[0]).queryByRole("button", { name: "Delete the comment by Ana" })).not.toBeNull();
  expect(within(admin.threads()[0]).queryByRole("button", { name: "Edit" })).toBeNull();
});

it("a comment of one's own is edited and deleted", async () => {
  const { api, threads } = show({ me: "ana", comments: [comment("a", 45, "Tpyo")] });
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  write("Edit the comment", "Typo");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();
  expect(api.updateComment).toHaveBeenCalledWith("a", { body: "Typo" });
  expect(threads()[0].textContent).toContain("edited");
  fireEvent.click(screen.getByRole("button", { name: "Delete the comment by Ana" }));
  await flush();
  expect(threads()).toHaveLength(0);
});

it("says what went wrong, and keeps the words", async () => {
  show({ fail: { addComment: REVIEW_MESSAGES.commentsFull } });
  await flush();
  write("Comment at 0:00:00", "One more");
  fireEvent.click(screen.getByRole("button", { name: "Comment" }));
  await flush();
  expect(screen.getByRole("alert").textContent).toBe(REVIEW_MESSAGES.commentsFull);
  expect((screen.getByRole("textbox", { name: "Comment at 0:00:00" }) as HTMLTextAreaElement).value).toBe("One more");
});

it("says so when the comments can't be loaded, and tries again", async () => {
  const { api } = show({ fail: { comments: "down" } });
  await flush();
  expect(screen.getByText("Couldn't load the comments.")).toBeTruthy();
  const before = vi.mocked(api.comments).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await flush();
  expect(vi.mocked(api.comments).mock.calls.length).toBe(before + 1);
});

async function openVersions(options: Parameters<typeof show>[0] = {}) {
  const shown = show(options);
  await flush();
  fireEvent.click(screen.getByRole("radio", { name: "Versions" }));
  await flush();
  return shown;
}

it("a version is saved under a name and listed newest first", async () => {
  const { api } = await openVersions({ versions: [version("v0", "Rough cut")] });
  const save = screen.getByRole("button", { name: "Save version" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Name for this version" }), { target: { value: "Fine cut" } });
  fireEvent.click(save);
  await flush();
  expect(api.saveVersion).toHaveBeenCalledWith("Fine cut");
  expect(screen.getAllByRole("listitem").map((li) => li.querySelector("p")!.textContent)).toEqual(["Fine cut", "Rough cut"]);
  expect((screen.getByRole("textbox", { name: "Name for this version" }) as HTMLInputElement).value).toBe("");
});

it("opens a version as a new project and links to it", async () => {
  const { api } = await openVersions({ versions: [version("v0", "Rough cut")] });
  fireEvent.click(screen.getByRole("button", { name: "Open Rough cut as a new project" }));
  await flush();
  expect(api.openVersion).toHaveBeenCalledWith("v0");
  const link = within(screen.getByRole("status")).getByRole("link", { name: "Open it" });
  expect([link.getAttribute("href"), link.getAttribute("target")]).toEqual(["/s/team/editor/copy1", "_blank"]);
});

it("renames a version, and deletes one only on the second press", async () => {
  const { api, kept } = await openVersions({ versions: [version("v0", "Rough cut")] });
  fireEvent.click(screen.getByRole("button", { name: "Rename Rough cut" }));
  fireEvent.change(screen.getByRole("textbox", { name: "New name for Rough cut" }), { target: { value: "First cut" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await flush();
  expect(api.renameVersion).toHaveBeenCalledWith("v0", "First cut");
  fireEvent.click(screen.getByRole("button", { name: "Delete First cut" }));
  expect(kept.versions).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Yes, delete First cut" }));
  await flush();
  expect(kept.versions).toHaveLength(0);
  expect(screen.getByText("No versions yet.")).toBeTruthy();
});

it("a viewer sees the versions and can change none; a stale one can't be opened", async () => {
  await openVersions({ canEdit: false, versions: [version("v0", "Rough cut")] });
  expect(screen.queryByRole("button", { name: "Save version" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Open Rough cut as a new project" })).toBeNull();
  expect(screen.getByText("Rough cut")).toBeTruthy();
  cleanup();
  await openVersions({ versions: [version("v0", "Before the move", { stale: true })] });
  expect(screen.queryByRole("button", { name: "Open Before the move as a new project" })).toBeNull();
  expect(screen.getByText(REVIEW_MESSAGES.versionStale)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Delete Before the move" })).not.toBeNull();
});

it("waits for unsent changes before a version can be saved", async () => {
  const { store } = await openVersions();
  fireEvent.change(screen.getByRole("textbox", { name: "Name for this version" }), { target: { value: "Now" } });
  expect((screen.getByRole("button", { name: "Save version" }) as HTMLButtonElement).disabled).toBe(false);
  act(() => void store.getState().edit([{ op: "update_track", trackId: "v1", patch: { name: "Main" } }], "rename track"));
  expect((screen.getByRole("button", { name: "Save version" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Saving your changes first…")).toBeTruthy();
});

it("says so where there is no review", () => {
  render(
    <EditorProvider store={makeStore()}>
      <ReviewPanel />
    </EditorProvider>,
  );
  expect(screen.getByText("Review isn't available here.")).toBeTruthy();
});

it("the ruler pins each open thread's moment", async () => {
  const { Ruler } = await import("@/components/editor/timeline/ruler");
  cleanup();
  const api = { comments: async () => ({ ok: true as const, me: "ben", role: "editor" as const, comments: [comment("a", 45, "Trim this"), comment("r", 45, "Agreed", { parentId: "a" }), comment("d", 10, "Done", { resolved: true }), comment("far", 5000, "Out of sight")] }) } as unknown as ReviewApi;
  render(
    <EditorProvider store={makeStore()}>
      <ReviewProvider api={api} projectHref={(id) => id}>
        <Ruler zoom={2} fps={30} fromFrame={0} toFrame={600} max={600} end={600} onScrub={() => {}} />
      </ReviewProvider>
    </EditorProvider>,
  );
  await flush();
  const pins = [...document.querySelectorAll<HTMLElement>("[data-comment-pin]")];
  expect(pins.map((pin) => [pin.dataset.commentPin, pin.title])).toEqual([["a", "Ana: Trim this"]]);
});
