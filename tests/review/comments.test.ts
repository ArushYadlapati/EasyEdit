import { describe, expect, it } from "vitest";
import type { DB } from "@/db";
import type { Actor } from "@/lib/actor";
import { createProject, deleteProject } from "@/lib/projects/service";
import { addComment, deleteComment, listComments, updateComment } from "@/lib/review/comments";
import { REVIEW_LIMITS, REVIEW_MESSAGES, threadsOf } from "@/lib/review/rules";
import { personalSpaceId } from "@/lib/spaces/types";
import { projectComments } from "@/db/schema";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";

// Ana administers the team, Ben edits it, Cy views it; Dee is in another space.
async function setup() {
  const db = await makeTestDb();
  await joinSpace(db, { id: "ana", name: "Ana" }, "admin");
  await joinSpace(db, { id: "ben", name: "Ben" }, "editor");
  await joinSpace(db, { id: "cy", name: "Cy" }, "viewer");
  await joinSpace(db, { id: "dee", name: "Dee" }, "admin", personalSpaceId("dee"));
  const ana = testActor({ userId: "ana", role: "admin" });
  const ben = testActor({ userId: "ben", role: "editor" });
  const cy = testActor({ userId: "cy", role: "viewer" });
  const dee = testActor({ userId: "dee", role: "admin", spaceId: personalSpaceId("dee") });
  const project = (await createProject(db, ben, { name: "Reveal", format: "short_9x16" })).id;
  return { db, ana, ben, cy, dee, project };
}
const refusal = async (work: Promise<unknown>) => work.then(() => null, (error: { code?: string; status?: number; message: string }) => [error.code, error.status, error.message]);
const say = (db: DB, actor: Actor, project: string, frame: number, body: string, parentId?: string) => addComment(db, actor, project, { frame, body, parentId });

describe("leaving a comment", () => {
  it("anyone in the space can, a viewer too, at a moment of the project", async () => {
    const { db, cy, ben, project } = await setup();
    const made = await say(db, cy, project, 90, "  The logo is cut off here.  ");
    expect(made).toMatchObject({ frame: 90, body: "The logo is cut off here.", authorId: "cy", author: "Cy", parentId: null, resolved: false, editedAt: null });
    expect(await listComments(db, ben, project)).toEqual([made]);
  });
  it("lists every comment by its moment, then by when it was written", async () => {
    const { db, ana, ben, cy, project } = await setup();
    const late = await say(db, ana, project, 300, "End card");
    const early = await say(db, ben, project, 30, "Intro");
    const reply = await say(db, cy, project, 999, "Agreed", early.id);
    expect(reply.frame).toBe(30); // a reply sits at its thread's moment
    const listed = await listComments(db, ana, project);
    expect(listed.map((c) => c.id)).toEqual([early.id, reply.id, late.id]);
    expect(threadsOf(listed).map((t) => [t.top.body, t.replies.map((r) => r.body)])).toEqual([["Intro", ["Agreed"]], ["End card", []]]);
  });
  it("refuses an empty or over-long comment, a bad frame, and a reply to a reply", async () => {
    const { db, ben, project } = await setup();
    expect(await refusal(say(db, ben, project, 0, "   "))).toEqual(["INVALID", 400, REVIEW_MESSAGES.commentEmpty]);
    expect(await refusal(say(db, ben, project, 0, "x".repeat(REVIEW_LIMITS.commentChars + 1)))).toEqual(["INVALID", 400, REVIEW_MESSAGES.commentTooLong]);
    for (const frame of [-1, 1.5, Number.NaN, "3"]) expect((await refusal(addComment(db, ben, project, { frame, body: "x" })))?.[0]).toBe("INVALID");
    const top = await say(db, ben, project, 10, "One");
    const reply = await say(db, ben, project, 10, "Two", top.id);
    expect(await refusal(say(db, ben, project, 10, "Three", reply.id))).toEqual(["INVALID", 400, REVIEW_MESSAGES.replyToReply]);
    expect(await refusal(say(db, ben, project, 10, "Three", "nope"))).toEqual(["NOT_FOUND", 404, REVIEW_MESSAGES.commentGone]);
  });
  it("stops at the most a project can hold", async () => {
    const { db, ben, project } = await setup();
    await db.insert(projectComments).values(Array.from({ length: REVIEW_LIMITS.commentsPerProject }, (_, i) => ({ id: `c${i}`, projectId: project, author: "ben", frame: i, body: "x" })));
    expect(await refusal(say(db, ben, project, 0, "One more"))).toEqual(["CONFLICT", 409, REVIEW_MESSAGES.commentsFull]);
  });
  it("is not for someone outside the space, nor on a deleted project", async () => {
    const { db, ben, dee, project } = await setup();
    expect((await refusal(say(db, dee, project, 0, "Hello")))?.slice(0, 2)).toEqual(["NOT_FOUND", 404]);
    expect((await refusal(listComments(db, dee, project)))?.slice(0, 2)).toEqual(["NOT_FOUND", 404]);
    const made = await say(db, ben, project, 0, "Hello");
    expect((await refusal(updateComment(db, dee, project, made.id, { resolved: true })))?.slice(0, 2)).toEqual(["NOT_FOUND", 404]);
    expect((await refusal(deleteComment(db, dee, project, made.id)))?.slice(0, 2)).toEqual(["NOT_FOUND", 404]);
    await deleteProject(db, ben, project);
    expect((await refusal(listComments(db, ben, project)))?.slice(0, 2)).toEqual(["NOT_FOUND", 404]);
  });
});

describe("changing a comment", () => {
  it("only the person who wrote it edits its words", async () => {
    const { db, ana, cy, project } = await setup();
    const made = await say(db, cy, project, 10, "Tpyo");
    expect(await refusal(updateComment(db, ana, project, made.id, { body: "Typo" }))).toEqual(["FORBIDDEN", 403, REVIEW_MESSAGES.notYours]);
    const edited = await updateComment(db, cy, project, made.id, { body: " Typo " });
    expect([edited.body, edited.editedAt !== null]).toEqual(["Typo", true]);
    expect((await updateComment(db, cy, project, made.id, { body: "Typo" })).editedAt).toBe(edited.editedAt); // the same words are no edit
    expect(await refusal(updateComment(db, cy, project, made.id, { body: "" }))).toEqual(["INVALID", 400, REVIEW_MESSAGES.commentEmpty]);
  });
  it("an editor or the person who wrote it resolves a thread, and reopens it", async () => {
    const { db, ana, ben, cy, project } = await setup();
    const bens = await say(db, ben, project, 10, "Fix the cut");
    expect(await refusal(updateComment(db, cy, project, bens.id, { resolved: true }))).toEqual(["FORBIDDEN", 403, REVIEW_MESSAGES.cannotResolve]);
    expect((await updateComment(db, ana, project, bens.id, { resolved: true })).resolved).toBe(true);
    expect((await updateComment(db, ben, project, bens.id, { resolved: false })).resolved).toBe(false);
    const cys = await say(db, cy, project, 20, "Mine");
    expect((await updateComment(db, cy, project, cys.id, { resolved: true })).resolved).toBe(true); // a viewer resolves their own
    const reply = await say(db, ben, project, 0, "ok", cys.id);
    expect(await refusal(updateComment(db, ben, project, reply.id, { resolved: true }))).toEqual(["INVALID", 400, REVIEW_MESSAGES.replyToReply]);
    expect((await refusal(updateComment(db, ben, project, bens.id, { resolved: "yes" })))?.[0]).toBe("INVALID");
  });
});

describe("deleting a comment", () => {
  it("is for the person who wrote it or an admin, and a thread's first comment takes its replies", async () => {
    const { db, ana, ben, cy, project } = await setup();
    const top = await say(db, cy, project, 10, "Top");
    await say(db, ben, project, 10, "Reply", top.id);
    const other = await say(db, ben, project, 40, "Other");
    expect(await refusal(deleteComment(db, ben, project, top.id))).toEqual(["FORBIDDEN", 403, REVIEW_MESSAGES.cannotDelete]);
    await deleteComment(db, cy, project, top.id);
    expect((await listComments(db, ana, project)).map((c) => c.body)).toEqual(["Other"]);
    await deleteComment(db, ana, project, other.id); // an admin deletes anyone's
    expect(await listComments(db, ana, project)).toEqual([]);
    expect(await refusal(deleteComment(db, ana, project, other.id))).toEqual(["NOT_FOUND", 404, REVIEW_MESSAGES.commentGone]);
  });
  it("a comment of one project can't be reached through another", async () => {
    const { db, ben, project } = await setup();
    const elsewhere = (await createProject(db, ben, { name: "Other", format: "short_9x16" })).id;
    const made = await say(db, ben, project, 10, "Here");
    expect(await refusal(deleteComment(db, ben, elsewhere, made.id))).toEqual(["NOT_FOUND", 404, REVIEW_MESSAGES.commentGone]);
    expect(await refusal(updateComment(db, ben, elsewhere, made.id, { body: "x" }))).toEqual(["NOT_FOUND", 404, REVIEW_MESSAGES.commentGone]);
  });
});
