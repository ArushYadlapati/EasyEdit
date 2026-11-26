import { describe, expect, it } from "vitest";
import type { CurrentUser } from "@/lib/access-rules";
import { createProject } from "@/lib/projects/service";
import { createReviewApi } from "@/lib/review/client";
import { makeReviewHandlers } from "@/lib/review/handlers";
import { REVIEW_MESSAGES } from "@/lib/review/rules";
import { personalSpaceId } from "@/lib/spaces/types";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

// The routes, called through the browser's own client: its fetch is wired straight to the handlers.
async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ben", name: "Ben" }, "editor");
  await joinSpace(db, { id: "cy", name: "Cy" }, "viewer");
  await joinSpace(db, { id: "dee", name: "Dee" }, "admin", personalSpaceId("dee"));
  const project = (await createProject(db, testActor({ userId: "ben", role: "editor" }), { name: "Reveal", format: "short_9x16" })).id;
  const signedIn: { user: CurrentUser | null } = { user: testUser({ id: "ben", name: "Ben" }) };
  const handlers = makeReviewHandlers({ db: () => db, auth: async () => signedIn.user ?? Response.json({ code: "UNAUTHENTICATED", message: "Sign in" }, { status: 401 }) });
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const request = new Request(`https://app.test${url}`, { ...init, headers: { ...(init.headers as Record<string, string>), origin: "https://app.test", host: "app.test" } });
    const parts = new URL(request.url).pathname.split("/").slice(3); // <id>, comments | saved-versions, <item>?, open?
    const [id, kind, item, tail] = parts;
    const method = request.method;
    if (kind === "comments" && !item) return (method === "GET" ? handlers.comments : handlers.addComment)(request, { params: Promise.resolve({ id }) });
    if (kind === "comments") return (method === "PATCH" ? handlers.updateComment : handlers.deleteComment)(request, { params: Promise.resolve({ id, commentId: item }) });
    if (kind === "saved-versions" && !item) return (method === "GET" ? handlers.versions : handlers.saveVersion)(request, { params: Promise.resolve({ id }) });
    if (tail === "open") return handlers.openVersion(request, { params: Promise.resolve({ id, versionId: item }) });
    return (method === "PATCH" ? handlers.renameVersion : handlers.deleteVersion)(request, { params: Promise.resolve({ id, versionId: item }) });
  }) as typeof fetch;
  const as = (id: string | null) => void (signedIn.user = id ? testUser({ id, name: id }) : null);
  return { api: createReviewApi(project, fetchFn), as, handlers, project };
}

describe("comments over the routes", () => {
  it("are written, listed with who is asking, changed and deleted", async () => {
    const { api, as } = await setup();
    const added = await api.addComment({ frame: 45, body: "Trim this" });
    if (!added.ok) throw new Error(added.message);
    as("cy");
    const reply = await api.addComment({ frame: 0, body: "Yes", parentId: added.comment.id });
    expect(reply).toMatchObject({ ok: true, comment: { frame: 45, parentId: added.comment.id, author: "Cy" } });
    const listed = await api.comments();
    expect(listed).toMatchObject({ ok: true, me: "cy", role: "viewer", comments: [{ body: "Trim this" }, { body: "Yes" }] });
    expect(await api.updateComment(added.comment.id, { body: "x" })).toEqual({ ok: false, message: REVIEW_MESSAGES.notYours, gone: false });
    expect(await api.updateComment(added.comment.id, { resolved: true })).toEqual({ ok: false, message: REVIEW_MESSAGES.cannotResolve, gone: false });
    as("ben");
    expect(await api.updateComment(added.comment.id, { resolved: true })).toMatchObject({ ok: true, comment: { resolved: true } });
    expect(await api.deleteComment(added.comment.id)).toEqual({ ok: true });
    expect(await api.comments()).toMatchObject({ ok: true, comments: [] });
    expect(await api.deleteComment(added.comment.id)).toEqual({ ok: false, message: REVIEW_MESSAGES.commentGone, gone: true });
  });
  it("are for signed-in people of the project's space", async () => {
    const { api, as } = await setup();
    as(null);
    expect(await api.comments()).toMatchObject({ ok: false, message: "Sign in" });
    as("dee");
    expect(await api.comments()).toMatchObject({ ok: false, gone: true });
    expect(await api.addComment({ frame: 0, body: "Hi" })).toMatchObject({ ok: false, gone: true });
  });
  it("refuse a body that is not a JSON object, or a change of nothing", async () => {
    const { handlers, project, api } = await setup();
    const post = (body: string) => handlers.addComment(new Request(`https://app.test/api/projects/${project}/comments`, { method: "POST", body, headers: { origin: "https://app.test", host: "app.test" } }), { params: Promise.resolve({ id: project }) });
    for (const body of ["", "[1]", "nope", "3"]) expect([(await post(body)).status]).toEqual([400]);
    const added = await api.addComment({ frame: 1, body: "x" });
    expect(added.ok && (await api.updateComment(added.comment.id, {}))).toMatchObject({ ok: false, message: "Give body or resolved" });
  });
});

describe("versions over the routes", () => {
  it("are saved, listed, renamed, opened as a new project and deleted", async () => {
    const { api, as } = await setup();
    const saved = await api.saveVersion("Rough cut");
    if (!saved.ok) throw new Error(saved.message);
    expect(await api.renameVersion(saved.id, "Fine cut")).toEqual({ ok: true });
    as("cy");
    expect(await api.versions()).toMatchObject({ ok: true, versions: [{ id: saved.id, name: "Fine cut", by: "Ben", stale: false }] });
    expect(await api.saveVersion("Mine")).toMatchObject({ ok: false });
    expect(await api.openVersion(saved.id)).toMatchObject({ ok: false });
    as("ben");
    const opened = await api.openVersion(saved.id);
    expect(opened.ok && opened.id.length).toBe(12);
    expect(await api.deleteVersion(saved.id)).toEqual({ ok: true });
    expect(await api.openVersion(saved.id)).toEqual({ ok: false, message: REVIEW_MESSAGES.versionGone, gone: true });
    expect(await api.saveVersion("")).toEqual({ ok: false, message: REVIEW_MESSAGES.nameEmpty, gone: false });
  });
});
