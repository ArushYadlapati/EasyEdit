import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { rowsOf, type DB } from "@/db";
import { projects, socialPost, user as userTable } from "@/db/schema";
import { FORBIDDEN_BODY } from "@/lib/api-errors";
import { DriveError } from "@/lib/drive/token";
import { LIMITS, type Limits } from "@/lib/limits";
import { ServiceError } from "@/lib/service-error";
import { slugFor } from "@/lib/spaces/paths";
import { listMySpaces, roleIn, spaceOfProject } from "@/lib/spaces/service";
import { ConnectionBrokenError, OAuthError } from "@/lib/storage/google-oauth";
import { open, seal } from "@/lib/storage/secret-box";
import type { SocialConfig } from "./config";
import { channelAccess, findConnection } from "./connections";
import { refusalMessage, SOCIAL_MESSAGES } from "./messages";
import { isVideoId, postFormProblem, type PostForm, videoUrl, type Visibility } from "./rules";
import { cancelUpload, openVideoUpload, uploadState, videoChannel } from "./youtube-api";

// Posting a video to a space's YouTube channel. The server opens the upload at YouTube, with the video's facts
// fixed, and hands the person's browser that one upload's address; the bytes go from the browser straight to
// YouTube. What a call refuses comes out as a ServiceError.

export type PostDeps = { config: SocialConfig; fetch?: typeof fetch; limits?: Limits };

export type PostStatus = "uploading" | "posted" | "failed" | "canceled";

type Row = typeof socialPost.$inferSelect;

const notFound = () => new ServiceError("NOT_FOUND", 404, "Post not found");
const ended = () => new ServiceError("CONFLICT", 409, "This post has already ended.");
const unreachable = () => new ServiceError("PLATFORM_REFUSED", 502, SOCIAL_MESSAGES.unreachable);
const brokenConnection = () => new ServiceError("CONNECTION_BROKEN", 409, SOCIAL_MESSAGES.broken);

// What the editor needs to offer posting for a project: nothing when this server has no posting or the person may
// not post there; else the space's channel (or that it has none), and where an admin connects one.
export type PostingStatus =
  | { available: false }
  | { available: true; channel: string | null; broken: boolean; canConnect: boolean; settingsPath: string };

export async function postingStatus(db: DB, cfg: SocialConfig | null, userId: string, projectId: string): Promise<PostingStatus> {
  if (!cfg) return { available: false };
  const spaceId = await spaceOfProject(db, projectId);
  const space = spaceId ? ((await listMySpaces(db, userId)).find((mine) => mine.id === spaceId) ?? null) : null;
  if (!space || space.role === "viewer") return { available: false };
  const connection = await findConnection(db, cfg, space.id);
  return {
    available: true,
    channel: connection ? (connection.channelTitle ?? connection.email) : null,
    broken: connection?.broken ?? false,
    canConnect: space.role === "admin",
    settingsPath: `/s/${slugFor(space)}/settings/socials`,
  };
}

export type StartPostInput = { userId: string; projectId: string; form: PostForm; sizeBytes: number };

// The post's row, written before YouTube is asked for anything and only while the space is under its limit for
// 24 hours (one statement, so requests arriving together can't all slip under it by more than the usual hair).
// Every row counts, however its post ended: each used some of the site's allowance at YouTube. null: at the limit.
async function reserve(db: DB, limits: Limits, row: { id: string; spaceId: string; projectId: string; userId: string; title: string; visibility: Visibility; sizeBytes: number }): Promise<boolean> {
  const made = rowsOf<{ id: string }>(
    await db.execute(sql`
      insert into social_post (id, space_id, project_id, platform, posted_by, title, visibility, size_bytes)
      select ${row.id}, ${row.spaceId}, ${row.projectId}, 'youtube', ${row.userId}, ${row.title}, ${row.visibility}, ${row.sizeBytes}
      where (select count(*) from social_post where space_id = ${row.spaceId} and created_at > now() - interval '1 day') < ${limits.socialPostsPerSpacePerDay}
      returning id
    `),
  );
  return made.length === 1;
}

// Starts a post of a project's exported video: checks who asks, the form and the day's limit, then opens the upload
// at YouTube. Returns the post's id and the upload's address, for the person who started it and nobody else. A post
// YouTube would not open leaves no row: nothing was used.
export async function startPost(db: DB, deps: PostDeps, input: StartPostInput): Promise<{ id: string; uploadUrl: string }> {
  const limits = deps.limits ?? LIMITS;
  const spaceId = await spaceOfProject(db, input.projectId);
  const role = spaceId ? await roleIn(db, input.userId, spaceId) : null;
  if (!spaceId || !role) throw new ServiceError("NOT_FOUND", 404, "Project not found");
  if (role === "viewer") throw new ServiceError("FORBIDDEN", 403, FORBIDDEN_BODY.message);

  const problem = postFormProblem(input.form);
  if (problem) throw new ServiceError("INVALID", 400, problem);
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new ServiceError("INVALID", 400, "The video file is empty.");
  if (input.sizeBytes > limits.socialFileBytes) throw new ServiceError("INVALID", 400, "The video file is too large to post from EasyEdit.");
  // Before a row is written: a space with no channel never uses up its day.
  if (!(await findConnection(db, deps.config, spaceId))) throw new ServiceError("NOT_CONNECTED", 409, SOCIAL_MESSAGES.notConnected);

  const id = `sp_${nanoid(16)}`;
  const title = input.form.title.trim();
  if (!(await reserve(db, limits, { id, spaceId, projectId: input.projectId, userId: input.userId, title, visibility: input.form.visibility, sizeBytes: input.sizeBytes }))) {
    throw new ServiceError("LIMIT_EXCEEDED", 429, SOCIAL_MESSAGES.dayUsedUp);
  }

  let uploadUrl: string;
  try {
    const { accessToken } = await channelAccess(db, deps.config, spaceId, deps.fetch);
    uploadUrl = await openVideoUpload(
      accessToken,
      { title, description: input.form.description, visibility: input.form.visibility, madeForKids: input.form.madeForKids, sizeBytes: input.sizeBytes, origin: new URL(deps.config.redirectUri).origin },
      deps.fetch,
    );
  } catch (failure) {
    await db.delete(socialPost).where(and(eq(socialPost.id, id), eq(socialPost.status, "uploading")));
    if (failure instanceof ConnectionBrokenError) throw brokenConnection();
    if (failure instanceof OAuthError) throw unreachable();
    if (!(failure instanceof DriveError)) throw failure;
    console.error("Starting a YouTube post failed:", failure.message);
    throw new ServiceError("PLATFORM_REFUSED", 502, refusalMessage(failure));
  }

  // Only while the row is still this post's, uploading: a disconnect in between ended it, and its upload goes too.
  const kept = await db
    .update(socialPost)
    .set({ uploadUrlEnc: seal(uploadUrl, deps.config.tokenKey) })
    .where(and(eq(socialPost.id, id), eq(socialPost.status, "uploading")))
    .returning({ id: socialPost.id });
  if (kept.length === 0) {
    await cancelUpload(uploadUrl, deps.fetch).catch(() => {});
    throw new ServiceError("NOT_CONNECTED", 409, SOCIAL_MESSAGES.notConnected);
  }
  return { id, uploadUrl };
}

// A post, for the person who started it. Anyone else's reads as no such post.
async function ownPost(db: DB, userId: string, postId: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(socialPost)
    .where(and(eq(socialPost.id, postId), eq(socialPost.postedBy, userId)));
  if (!row) throw notFound();
  return row;
}

// Ends a post that is still uploading, once: a row that ended meanwhile is left as it is.
async function end(db: DB, row: Row, status: Exclude<PostStatus, "uploading">, videoId: string | null = null): Promise<void> {
  await db
    .update(socialPost)
    .set({ status, videoId, uploadUrlEnc: null, finishedAt: sql`now()` })
    .where(and(eq(socialPost.id, row.id), eq(socialPost.status, "uploading")));
}

export type PostProgress = { done: false; offset: number } | { done: true; videoId: string | null; url: string | null };

const posted = (videoId: string | null): PostProgress => ({ done: true, videoId, url: videoId ? videoUrl(videoId) : null });

// Whether the video id the person's browser gave is one to record. When the space's channel can be read (its id is
// known and the connection works), an id of a video on another channel is not taken. When it can't be read, the id
// is taken on the poster's word: they are an editor of the space and started this post.
async function hintStands(db: DB, deps: PostDeps, row: Row, videoId: string): Promise<boolean> {
  try {
    const { accessToken, connection } = await channelAccess(db, deps.config, row.spaceId, deps.fetch);
    if (connection.channelId === null) return true;
    // A video YouTube doesn't show yet says nothing either way; one on another channel is not this post's.
    const channelId = await videoChannel(accessToken, videoId, deps.fetch);
    return channelId === null || channelId === connection.channelId;
  } catch (failure) {
    if (failure instanceof ServiceError || failure instanceof ConnectionBrokenError || failure instanceof DriveError || failure instanceof OAuthError) return true;
    throw failure;
  }
}

// Asks YouTube how far the post's upload got, and records a finished one. `hint`: the video id the person's browser
// read from YouTube's answer to its last piece. YouTube's own answer here comes first; the hint is used when that
// answer names no video, or when YouTube no longer answers for the session at all (gone, or refused).
async function settle(db: DB, deps: PostDeps, row: Row, hint: string | null): Promise<PostProgress> {
  if (row.status === "posted") return posted(row.videoId);
  if (row.status !== "uploading" || row.uploadUrlEnc === null) throw ended();
  const hinted = isVideoId(hint) ? hint : null;
  const takeHint = async (): Promise<string | null> => (hinted && (await hintStands(db, deps, row, hinted)) ? hinted : null);
  let sessionUrl: string;
  try {
    sessionUrl = open(row.uploadUrlEnc, deps.config.tokenKey);
  } catch {
    await end(db, row, "failed");
    throw new ServiceError("EXPIRED", 410, SOCIAL_MESSAGES.expired);
  }
  let state: Awaited<ReturnType<typeof uploadState>>;
  try {
    state = await uploadState(sessionUrl, row.sizeBytes, deps.fetch);
  } catch (failure) {
    if (!(failure instanceof DriveError)) throw failure;
    // No answer, or YouTube's own fault: nothing is known, so nothing is recorded and the caller may ask again.
    if (failure.status === 0 || failure.status >= 500) throw unreachable();
    // YouTube won't answer for the session any more. With a video id that stands, that is a finished upload;
    // without one, an upload that ran out of time.
    const videoId = await takeHint();
    if (videoId) {
      await end(db, row, "posted", videoId);
      return posted(videoId);
    }
    await end(db, row, "failed");
    throw new ServiceError("EXPIRED", 410, SOCIAL_MESSAGES.expired);
  }
  if (!state.done) return { done: false, offset: state.offset };
  const videoId = state.videoId ?? (await takeHint());
  await end(db, row, "posted", videoId);
  return posted(videoId);
}

// How much of the upload YouTube holds, asked by the browser after a piece failed.
export async function postOffset(db: DB, deps: PostDeps, input: { userId: string; postId: string }): Promise<{ offset: number; done: boolean }> {
  const row = await ownPost(db, input.userId, input.postId);
  const progress = await settle(db, deps, row, null);
  return progress.done ? { offset: row.sizeBytes, done: true } : { offset: progress.offset, done: false };
}

// The browser says every byte was sent: YouTube is asked, and the post is recorded with the video's link.
export async function finishPost(db: DB, deps: PostDeps, input: { userId: string; postId: string; videoId?: string | null }): Promise<{ videoId: string | null; url: string | null }> {
  const row = await ownPost(db, input.userId, input.postId);
  const progress = await settle(db, deps, row, input.videoId ?? null);
  if (!progress.done) throw new ServiceError("CONFLICT", 409, SOCIAL_MESSAGES.notFinished);
  return { videoId: progress.videoId, url: progress.url };
}

export type PostEnd = { status: Exclude<PostStatus, "uploading">; url: string | null };

// The person stopped the post, or their browser gave up. YouTube is asked first: an upload it already has whole is
// a posted video, whatever the browser saw, and is recorded as one. Otherwise the upload is ended at YouTube (best
// effort) and the post recorded as stopped. A post that already ended is left as it is.
export async function cancelPost(db: DB, deps: PostDeps, input: { userId: string; postId: string; failed?: boolean }): Promise<PostEnd> {
  const row = await ownPost(db, input.userId, input.postId);
  if (row.status !== "uploading") return { status: row.status, url: row.videoId ? videoUrl(row.videoId) : null };
  const stopped = input.failed ? "failed" : "canceled";
  if (row.uploadUrlEnc !== null) {
    try {
      const sessionUrl = open(row.uploadUrlEnc, deps.config.tokenKey);
      const state = await uploadState(sessionUrl, row.sizeBytes, deps.fetch).catch(() => null);
      if (state?.done) {
        await end(db, row, "posted", state.videoId);
        return { status: "posted", url: state.videoId ? videoUrl(state.videoId) : null };
      }
      await cancelUpload(sessionUrl, deps.fetch);
    } catch (failure) {
      console.error("Ending a YouTube upload failed:", failure instanceof Error ? failure.name : "unknown");
    }
  }
  await end(db, row, stopped);
  return { status: stopped, url: null };
}

export type PostListItem = {
  id: string;
  title: string;
  visibility: Visibility;
  status: PostStatus;
  url: string | null;
  postedBy: string | null; // the person's name, when they still have an account
  projectName: string | null;
  createdAt: Date;
};

// An upload still open this long after it began will never finish: YouTube has closed it, or the tab is gone.
const STALE_MS = 24 * 60 * 60 * 1000;

// The space's latest posts, newest first, for its settings page. One still "uploading" a day later reads as not
// finished.
export async function listPosts(db: DB, spaceId: string, limit = 20, now: Date = new Date()): Promise<PostListItem[]> {
  const rows = await db
    .select({ id: socialPost.id, title: socialPost.title, visibility: socialPost.visibility, status: socialPost.status, videoId: socialPost.videoId, postedBy: userTable.name, projectName: projects.name, createdAt: socialPost.createdAt })
    .from(socialPost)
    .leftJoin(userTable, eq(userTable.id, socialPost.postedBy))
    .leftJoin(projects, eq(projects.id, socialPost.projectId))
    .where(eq(socialPost.spaceId, spaceId))
    .orderBy(desc(socialPost.createdAt), desc(socialPost.id))
    .limit(limit);
  return rows.map(({ videoId, ...row }) => ({
    ...row,
    status: row.status === "uploading" && now.getTime() - row.createdAt.getTime() > STALE_MS ? "failed" : row.status,
    url: videoId ? videoUrl(videoId) : null,
  }));
}
