// Review: comments left at a moment of a project, and named versions of it. Shared by the server and the browser.

export const REVIEW_LIMITS = {
  commentChars: 2000,
  commentsPerProject: 500,
  versionNameChars: 80,
  versionsPerProject: 20,
  frameMax: 100_000_000, // a comment's frame; no project is this long
} as const;

// A comment as the editor shows it. A reply (parentId set) sits under its top-level comment and at its moment.
export type CommentView = {
  id: string;
  frame: number;
  body: string;
  authorId: string;
  author: string; // their name
  parentId: string | null;
  resolved: boolean; // top-level comments only
  createdAt: string; // ISO
  editedAt: string | null;
};

// A named version of a project: its timeline as it was when saved. stale: saved before the project moved to this
// space, so its media is not here and it cannot be opened.
export type VersionView = { id: string; name: string; version: number; by: string; createdAt: string; stale: boolean };

export const REVIEW_MESSAGES = {
  commentEmpty: "Write something first.",
  commentTooLong: `A comment can be up to ${REVIEW_LIMITS.commentChars} characters.`,
  commentsFull: `This project has the most comments it can hold (${REVIEW_LIMITS.commentsPerProject}). Delete some first.`,
  commentGone: "That comment was deleted.",
  notYours: "Only the person who wrote a comment can change it.",
  cannotResolve: "Only an editor or the person who wrote it can resolve a comment.",
  cannotDelete: "Only an admin or the person who wrote it can delete a comment.",
  replyToReply: "Reply to the first comment of the thread.",
  nameEmpty: `Give the version a name, up to ${REVIEW_LIMITS.versionNameChars} characters.`,
  versionsFull: `A project keeps up to ${REVIEW_LIMITS.versionsPerProject} versions. Delete one first.`,
  versionGone: "That version was deleted.",
  versionStale: "This version was saved before the project moved to this space, so its media is not here.",
  failed: "Couldn't reach the server. Try again.",
} as const;

// A comment's text as it is kept: trimmed. null when it is empty or too long.
export function commentBody(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const body = text.trim();
  return body.length >= 1 && body.length <= REVIEW_LIMITS.commentChars ? body : null;
}

// A version's name as it is kept: one line, trimmed. null when it is empty or too long.
export function versionName(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const name = text.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= REVIEW_LIMITS.versionNameChars ? name : null;
}

export const isFrame = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= REVIEW_LIMITS.frameMax;

// Comments as threads, in timeline order: each top-level comment (earliest moment first, then oldest first) with its
// replies, oldest first. A reply whose top-level comment is not in the list is left out.
export type Thread = { top: CommentView; replies: CommentView[] };
export function threadsOf(comments: readonly CommentView[]): Thread[] {
  const byTime = (a: CommentView, b: CommentView) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const tops = comments.filter((c) => c.parentId === null).sort((a, b) => a.frame - b.frame || byTime(a, b));
  return tops.map((top) => ({ top, replies: comments.filter((c) => c.parentId === top.id).sort(byTime) }));
}

// The name of the project a version opens as: "Project (version)", cut to the longest a project's name can be.
export function openedName(project: string, version: string, max: number): string {
  const tail = ` (${version})`;
  if (tail.length >= max) return `${project} copy`.slice(0, max);
  return `${project.slice(0, max - tail.length)}${tail}`;
}
