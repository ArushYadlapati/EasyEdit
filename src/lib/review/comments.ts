import { and, asc, count, eq, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "@/db";
import { projectComments, projects } from "@/db/schema";
import { meetsRole } from "@/lib/access-rules";
import { requireRole, type Actor } from "@/lib/actor";
import { getUserNames } from "@/lib/projects/user-names";
import { ServiceError } from "@/lib/service-error";
import { REVIEW_LIMITS, REVIEW_MESSAGES, commentBody, isFrame, type CommentView } from "./rules";

// Review comments: notes left at a moment of a project by anyone in its space (a viewer too: reviewing is what a
// viewer is for). The person who wrote one can edit it; they or an editor can resolve it; they or an admin can
// delete it. Replies go one level deep and sit at their thread's moment.

type Row = typeof projectComments.$inferSelect;
const notFound = (id: string) => new ServiceError("NOT_FOUND", 404, `Project "${id}" not found`);
const gone = () => new ServiceError("NOT_FOUND", 404, REVIEW_MESSAGES.commentGone);

// Throws unless the project is one the actor can see: in their space and not deleted.
export async function assertProject(db: DB, actor: Actor, projectId: string): Promise<void> {
  const found = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, projectId), eq(projects.spaceId, actor.spaceId), isNull(projects.deletedAt)));
  if (!found[0]) throw notFound(projectId);
}

const view = (row: Row, names: Map<string, string>): CommentView => ({
  id: row.id,
  frame: row.frame,
  body: row.body,
  authorId: row.author,
  author: names.get(row.author) ?? "Someone",
  parentId: row.parentId,
  resolved: row.resolvedAt !== null,
  createdAt: row.createdAt.toISOString(),
  editedAt: row.editedAt?.toISOString() ?? null,
});

async function views(db: DB, rows: Row[]): Promise<CommentView[]> {
  const names = await getUserNames(db, rows.map((row) => row.author));
  return rows.map((row) => view(row, names));
}

async function commentOf(db: DB, projectId: string, commentId: string): Promise<Row> {
  const [row] = await db.select().from(projectComments).where(and(eq(projectComments.id, commentId), eq(projectComments.projectId, projectId)));
  if (!row) throw gone();
  return row;
}

export async function listComments(db: DB, actor: Actor, projectId: string): Promise<CommentView[]> {
  requireRole(actor, "viewer");
  await assertProject(db, actor, projectId);
  const rows = await db.select().from(projectComments).where(eq(projectComments.projectId, projectId)).orderBy(asc(projectComments.frame), asc(projectComments.createdAt), asc(projectComments.id));
  return views(db, rows);
}

export async function addComment(db: DB, actor: Actor, projectId: string, input: { frame: unknown; body: unknown; parentId?: unknown }): Promise<CommentView> {
  requireRole(actor, "viewer");
  await assertProject(db, actor, projectId);
  const body = commentBody(input.body);
  if (body === null) throw new ServiceError("INVALID", 400, typeof input.body === "string" && input.body.trim() ? REVIEW_MESSAGES.commentTooLong : REVIEW_MESSAGES.commentEmpty);
  let frame = input.frame;
  let parentId: string | null = null;
  if (input.parentId !== undefined && input.parentId !== null) {
    if (typeof input.parentId !== "string") throw new ServiceError("INVALID", 400, "parentId must be a comment's id");
    const parent = await commentOf(db, projectId, input.parentId);
    if (parent.parentId !== null) throw new ServiceError("INVALID", 400, REVIEW_MESSAGES.replyToReply);
    parentId = parent.id;
    frame = parent.frame; // a reply sits at its thread's moment
  }
  if (!isFrame(frame)) throw new ServiceError("INVALID", 400, "frame must be a whole number, 0 or more");
  const [{ total }] = await db.select({ total: count() }).from(projectComments).where(eq(projectComments.projectId, projectId));
  if (total >= REVIEW_LIMITS.commentsPerProject) throw new ServiceError("CONFLICT", 409, REVIEW_MESSAGES.commentsFull);
  const [row] = await db.insert(projectComments).values({ id: nanoid(12), projectId, author: actor.userId, frame, body, parentId }).returning();
  return (await views(db, [row]))[0];
}

// Changes a comment: its text (the person who wrote it), or whether it is resolved (they or an editor; a thread's
// first comment only).
export async function updateComment(db: DB, actor: Actor, projectId: string, commentId: string, patch: { body?: unknown; resolved?: unknown }): Promise<CommentView> {
  requireRole(actor, "viewer");
  await assertProject(db, actor, projectId);
  const row = await commentOf(db, projectId, commentId);
  const mine = row.author === actor.userId;
  const set: Partial<Row> = {};
  if (patch.body !== undefined) {
    if (!mine) throw new ServiceError("FORBIDDEN", 403, REVIEW_MESSAGES.notYours);
    const body = commentBody(patch.body);
    if (body === null) throw new ServiceError("INVALID", 400, typeof patch.body === "string" && patch.body.trim() ? REVIEW_MESSAGES.commentTooLong : REVIEW_MESSAGES.commentEmpty);
    if (body !== row.body) Object.assign(set, { body, editedAt: new Date() });
  }
  if (patch.resolved !== undefined) {
    if (typeof patch.resolved !== "boolean") throw new ServiceError("INVALID", 400, "resolved must be true or false");
    if (!mine && !meetsRole(actor.role, "editor")) throw new ServiceError("FORBIDDEN", 403, REVIEW_MESSAGES.cannotResolve);
    if (row.parentId !== null) throw new ServiceError("INVALID", 400, REVIEW_MESSAGES.replyToReply);
    if (patch.resolved !== (row.resolvedAt !== null)) Object.assign(set, { resolvedAt: patch.resolved ? new Date() : null, resolvedBy: patch.resolved ? actor.userId : null });
  }
  if (Object.keys(set).length === 0) return (await views(db, [row]))[0];
  const [updated] = await db.update(projectComments).set(set).where(eq(projectComments.id, row.id)).returning();
  if (!updated) throw gone();
  return (await views(db, [updated]))[0];
}

// Deletes a comment (the person who wrote it, or an admin). A thread's first comment takes its replies with it.
export async function deleteComment(db: DB, actor: Actor, projectId: string, commentId: string): Promise<void> {
  requireRole(actor, "viewer");
  await assertProject(db, actor, projectId);
  const row = await commentOf(db, projectId, commentId);
  if (row.author !== actor.userId && !meetsRole(actor.role, "admin")) throw new ServiceError("FORBIDDEN", 403, REVIEW_MESSAGES.cannotDelete);
  await db.delete(projectComments).where(eq(projectComments.id, row.id));
}
