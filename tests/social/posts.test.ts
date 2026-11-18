import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { projects, socialConnection, socialPost } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { LIMITS } from "@/lib/limits";
import { createProject } from "@/lib/projects/service";
import { saveYoutubeConnection } from "@/lib/social/connections";
import { SOCIAL_MESSAGES } from "@/lib/social/messages";
import { makePostHandlers } from "@/lib/social/post-handlers";
import { cancelPost, finishPost, listPosts, postingStatus, postOffset, startPost, type PostDeps } from "@/lib/social/posts";
import type { PostForm } from "@/lib/social/rules";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { open } from "@/lib/storage/secret-box";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { fakeYoutube, SOCIAL_BASE as BASE, socialTestConfig } from "../helpers/social";

const form = (over: Partial<PostForm> = {}): PostForm => ({ title: "  Match recap ", description: "Qualifier 2", visibility: "unlisted", madeForKids: false, ...over });
const refusal = (error: unknown) => (error && typeof error === "object" && "code" in error && "status" in error && "message" in error ? { code: error.code, status: error.status, message: error.message } : error);

async function setup(opts: { connect?: boolean } = {}) {
  const db = await makeTestDb();
  const cfg = socialTestConfig();
  const google = fakeYoutube(cfg);
  await joinSpace(db, { id: "u1", name: "Ada" }, "admin");
  await joinSpace(db, { id: "u2", name: "Bo" }, "editor");
  await joinSpace(db, { id: "u3" }, "viewer");
  const { id: projectId } = await createProject(db, testActor(), { name: "Robot reveal", format: "short_9x16" });
  if (opts.connect !== false) {
    await saveYoutubeConnection(db, cfg, { spaceId: SEED_TEAM_ID, connectedBy: "u1", googleSub: "g-yt-1", email: "team@gmail.com", channel: { id: "UC123", title: "Seattle Solvers" }, refreshToken: "1//yt-refresh-1", scopes: [] });
  }
  const deps: PostDeps = { config: cfg, fetch: google.fetch };
  const start = (over: Partial<Parameters<typeof startPost>[2]> = {}) => startPost(db, deps, { userId: "u2", projectId, form: form(), sizeBytes: 1000, ...over });
  const postRow = async (id: string) => (await db.select().from(socialPost).where(eq(socialPost.id, id)))[0];
  return { db, cfg, google, deps, projectId, start, postRow };
}

describe("startPost", () => {
  it("opens the upload at YouTube with the video's facts and the app's origin, and records the post", async () => {
    const { cfg, google, projectId, start, postRow } = await setup();
    const { id, uploadUrl } = await start();
    const session = google.sessions.get(uploadUrl);
    expect(session).toMatchObject({
      size: 1000,
      origin: BASE,
      token: "Bearer ya29.for.1//yt-refresh-1",
      body: { snippet: { title: "Match recap", description: "Qualifier 2" }, status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false } },
    });
    const row = await postRow(id);
    expect(row).toMatchObject({ spaceId: SEED_TEAM_ID, projectId, platform: "youtube", postedBy: "u2", title: "Match recap", visibility: "unlisted", sizeBytes: 1000, status: "uploading", videoId: null, finishedAt: null });
    expect(row.uploadUrlEnc).not.toContain("upload_id");
    expect(open(row.uploadUrlEnc!, cfg.tokenKey)).toBe(uploadUrl);
  });

  it("is for editors and admins of the project's space", async () => {
    const { db, google, start } = await setup();
    expect(refusal(await start({ userId: "u3" }).catch((e) => e))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(refusal(await start({ userId: "stranger" }).catch((e) => e))).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(refusal(await start({ projectId: "nope" }).catch((e) => e))).toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(google.sessions.size).toBe(0);
    expect(await db.select().from(socialPost)).toEqual([]);
    await expect(start({ userId: "u1" })).resolves.toMatchObject({ id: expect.stringMatching(/^sp_/) });
  });

  it("refuses a form or a file YouTube would refuse, before asking Google anything", async () => {
    const { google, start } = await setup();
    expect(refusal(await start({ form: form({ title: " " }) }).catch((e) => e))).toEqual({ code: "INVALID", status: 400, message: "Give the video a title." });
    expect(refusal(await start({ form: form({ description: "<b>" }) }).catch((e) => e))).toMatchObject({ code: "INVALID" });
    expect(refusal(await start({ sizeBytes: 0 }).catch((e) => e))).toMatchObject({ code: "INVALID", message: "The video file is empty." });
    expect(refusal(await start({ sizeBytes: LIMITS.socialFileBytes + 1 }).catch((e) => e))).toMatchObject({ code: "INVALID" });
    expect(google.calls).toEqual([]);
  });

  it("refuses a space with no channel, and one whose connection Google ended", async () => {
    const bare = await setup({ connect: false });
    expect(refusal(await bare.start().catch((e) => e))).toEqual({ code: "NOT_CONNECTED", status: 409, message: SOCIAL_MESSAGES.notConnected });
    const { db, google, start } = await setup();
    google.refreshRefusal = "invalid_grant";
    expect(refusal(await start().catch((e) => e))).toEqual({ code: "CONNECTION_BROKEN", status: 409, message: SOCIAL_MESSAGES.broken });
    expect((await db.select().from(socialConnection))[0].brokenAt).not.toBeNull();
    expect(await db.select().from(socialPost)).toEqual([]);
  });

  it("says in the person's words why YouTube refused, and records no post", async () => {
    const { db, google, start } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [reason, status, message] of [
      ["quotaExceeded", 403, SOCIAL_MESSAGES.quota],
      ["uploadLimitExceeded", 400, SOCIAL_MESSAGES.uploadLimit],
      ["youtubeSignupRequired", 401, SOCIAL_MESSAGES.noChannel],
      ["invalidTitle", 400, SOCIAL_MESSAGES.refused],
      ["forbidden", 403, SOCIAL_MESSAGES.notAllowed],
      ["backendError", 503, SOCIAL_MESSAGES.unreachable],
    ] as const) {
      google.openRefusal = { status, reason };
      expect(refusal(await start().catch((e) => e)), reason).toEqual({ code: "PLATFORM_REFUSED", status: 502, message });
    }
    expect(await db.select().from(socialPost)).toEqual([]);
  });

  it("a sign-in to the channel that Google refuses, without ending it, says so and leaves the connection whole", async () => {
    const { db, google, start } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    google.refreshRefusal = "invalid_client";
    expect(refusal(await start().catch((e) => e))).toEqual({ code: "PLATFORM_REFUSED", status: 502, message: SOCIAL_MESSAGES.notAllowed });
    expect((await db.select().from(socialConnection))[0].brokenAt).toBeNull();
    expect(await db.select().from(socialPost)).toEqual([]);
  });

  it("posts started together can't all slip under the limit", async () => {
    const { db, deps, google, projectId } = await setup();
    const limits = { ...LIMITS, socialPostsPerSpacePerDay: 2 };
    const tries = await Promise.allSettled(Array.from({ length: 6 }, () => startPost(db, { ...deps, limits }, { userId: "u2", projectId, form: form(), sizeBytes: 10 })));
    expect(tries.filter((t) => t.status === "fulfilled")).toHaveLength(2);
    expect(tries.filter((t) => t.status === "rejected").map((t) => refusal((t as PromiseRejectedResult).reason))).toEqual(Array(4).fill({ code: "LIMIT_EXCEEDED", status: 429, message: SOCIAL_MESSAGES.dayUsedUp }));
    expect(google.sessions.size).toBe(2); // the rest never reached YouTube
    expect(await db.select().from(socialPost)).toHaveLength(2);
  });

  it("stops at the space's limit for a day, counting posts however they ended", async () => {
    const { db, deps, start } = await setup();
    const limits = { ...LIMITS, socialPostsPerSpacePerDay: 2 };
    const one = await startPost(db, { ...deps, limits }, { userId: "u2", projectId: (await db.select().from(projects))[0].id, form: form(), sizeBytes: 10 });
    await cancelPost(db, deps, { userId: "u2", postId: one.id });
    await start({ userId: "u1" });
    const third = startPost(db, { ...deps, limits }, { userId: "u1", projectId: (await db.select().from(projects))[0].id, form: form(), sizeBytes: 10 });
    expect(refusal(await third.catch((e) => e))).toEqual({ code: "LIMIT_EXCEEDED", status: 429, message: SOCIAL_MESSAGES.dayUsedUp });
    // Yesterday's posts no longer count.
    await db.update(socialPost).set({ createdAt: new Date(Date.now() - 25 * 3600_000) });
    await expect(startPost(db, { ...deps, limits }, { userId: "u1", projectId: (await db.select().from(projects))[0].id, form: form(), sizeBytes: 10 })).resolves.toBeTruthy();
  });
});

describe("postOffset and finishPost", () => {
  it("tell how far the upload got, and record the video once YouTube has it all", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const { id, uploadUrl } = await start();
    expect(await postOffset(db, deps, { userId: "u2", postId: id })).toEqual({ offset: 0, done: false });
    google.receive(uploadUrl, 400);
    expect(await postOffset(db, deps, { userId: "u2", postId: id })).toEqual({ offset: 400, done: false });
    expect(refusal(await finishPost(db, deps, { userId: "u2", postId: id }).catch((e) => e))).toEqual({ code: "CONFLICT", status: 409, message: SOCIAL_MESSAGES.notFinished });
    google.receive(uploadUrl, 600);
    expect(await finishPost(db, deps, { userId: "u2", postId: id })).toEqual({ videoId: "video000001", url: "https://youtu.be/video000001" });
    expect(await postRow(id)).toMatchObject({ status: "posted", videoId: "video000001", uploadUrlEnc: null });
    expect((await postRow(id)).finishedAt).not.toBeNull();
    // Asked again, a recorded post answers without YouTube.
    const calls = google.calls.length;
    expect(await finishPost(db, deps, { userId: "u2", postId: id })).toEqual({ videoId: "video000001", url: "https://youtu.be/video000001" });
    expect(await postOffset(db, deps, { userId: "u2", postId: id })).toEqual({ offset: 1000, done: true });
    expect(google.calls).toHaveLength(calls);
  });

  it("an offset check that finds the upload whole records the post too", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const { id, uploadUrl } = await start();
    google.receive(uploadUrl, 1000);
    expect(await postOffset(db, deps, { userId: "u2", postId: id })).toEqual({ offset: 1000, done: true });
    expect(await postRow(id)).toMatchObject({ status: "posted", videoId: "video000001" });
  });

  it("takes YouTube's own id over the browser's, and the browser's only when YouTube names none", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const first = await start();
    google.receive(first.uploadUrl, 1000);
    expect((await finishPost(db, deps, { userId: "u2", postId: first.id, videoId: "hintedVideo" })).videoId).toBe("video000001");

    google.statusAnswersId = false;
    const second = await start();
    google.receive(second.uploadUrl, 1000);
    expect(await finishPost(db, deps, { userId: "u2", postId: second.id, videoId: "hintedVideo" })).toEqual({ videoId: "hintedVideo", url: "https://youtu.be/hintedVideo" });

    const third = await start();
    google.receive(third.uploadUrl, 1000);
    expect(await finishPost(db, deps, { userId: "u2", postId: third.id, videoId: "../not-an-id" })).toEqual({ videoId: null, url: null });
    expect(await postRow(third.id)).toMatchObject({ status: "posted", videoId: null });
  });

  it("a video id from the browser is not taken when the video is on another channel", async () => {
    const { db, deps, google, start, postRow } = await setup();
    google.statusAnswersId = false;
    google.videos.set("someoneElse", "UCother");
    const first = await start();
    google.receive(first.uploadUrl, 1000);
    expect(await finishPost(db, deps, { userId: "u2", postId: first.id, videoId: "someoneElse" })).toEqual({ videoId: null, url: null });
    expect(await postRow(first.id)).toMatchObject({ status: "posted", videoId: null });

    // With the session deleted by its holder, the same id records nothing: the post reads as one that ran out of time.
    google.statusAnswersId = true;
    const second = await start();
    google.sessions.get(second.uploadUrl)!.canceled = true;
    expect(refusal(await finishPost(db, deps, { userId: "u2", postId: second.id, videoId: "someoneElse" }).catch((e) => e))).toMatchObject({ code: "EXPIRED", status: 410 });
    expect(await postRow(second.id)).toMatchObject({ status: "failed", videoId: null });
  });

  it("a video id is taken on the poster's word when the channel can't be read", async () => {
    const { db, deps, google, start } = await setup();
    await db.update(socialConnection).set({ channelId: null, channelTitle: null });
    google.videos.set("someoneElse", "UCother");
    const { id, uploadUrl } = await start();
    google.sessions.delete(uploadUrl);
    expect((await finishPost(db, deps, { userId: "u2", postId: id, videoId: "someoneElse" })).videoId).toBe("someoneElse");
    expect(google.calls.filter((call) => call === "GET https://www.googleapis.com/youtube/v3/videos")).toEqual([]);
  });

  it("when YouTube refuses to say how a finished upload stands, the browser's id is used", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const { id, uploadUrl } = await start();
    google.receive(uploadUrl, 1000);
    google.statusRefusal = 400;
    expect(await finishPost(db, deps, { userId: "u2", postId: id, videoId: "video000001" })).toEqual({ videoId: "video000001", url: "https://youtu.be/video000001" });
    expect(await postRow(id)).toMatchObject({ status: "posted", videoId: "video000001" });
  });

  it("a session that is gone is a finished post when the browser has the video's id, else one that ran out of time", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const first = await start();
    google.sessions.delete(first.uploadUrl);
    expect(await finishPost(db, deps, { userId: "u2", postId: first.id, videoId: "hintedVideo" })).toEqual({ videoId: "hintedVideo", url: "https://youtu.be/hintedVideo" });

    const second = await start();
    google.sessions.delete(second.uploadUrl);
    expect(refusal(await postOffset(db, deps, { userId: "u2", postId: second.id }).catch((e) => e))).toEqual({ code: "EXPIRED", status: 410, message: SOCIAL_MESSAGES.expired });
    expect(await postRow(second.id)).toMatchObject({ status: "failed", uploadUrlEnc: null });
    expect(refusal(await finishPost(db, deps, { userId: "u2", postId: second.id, videoId: "hintedVideo" }).catch((e) => e))).toMatchObject({ code: "CONFLICT" });
  });

  it("a post is its starter's alone", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const { id, uploadUrl } = await start();
    google.receive(uploadUrl, 1000);
    for (const userId of ["u1", "u3", "stranger"]) {
      expect(refusal(await postOffset(db, deps, { userId, postId: id }).catch((e) => e))).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(refusal(await finishPost(db, deps, { userId, postId: id }).catch((e) => e))).toMatchObject({ code: "NOT_FOUND" });
      expect(refusal(await cancelPost(db, deps, { userId, postId: id }).catch((e) => e))).toMatchObject({ code: "NOT_FOUND" });
    }
    expect(await postRow(id)).toMatchObject({ status: "uploading" });
  });

  it("YouTube not answering leaves the post as it is", async () => {
    const { db, deps, start, postRow } = await setup();
    const { id } = await start();
    const down = { ...deps, fetch: (async () => Promise.reject(new Error("offline"))) as typeof fetch };
    expect(refusal(await postOffset(db, down, { userId: "u2", postId: id }).catch((e) => e))).toEqual({ code: "PLATFORM_REFUSED", status: 502, message: SOCIAL_MESSAGES.unreachable });
    expect(await postRow(id)).toMatchObject({ status: "uploading" });
  });
});

describe("cancelPost", () => {
  it("ends the upload at YouTube and records the post as stopped, or failed", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const one = await start();
    expect(await cancelPost(db, deps, { userId: "u2", postId: one.id })).toEqual({ status: "canceled", url: null });
    expect(google.sessions.get(one.uploadUrl)?.canceled).toBe(true);
    expect(await postRow(one.id)).toMatchObject({ status: "canceled", uploadUrlEnc: null });
    const two = await start();
    expect(await cancelPost(db, deps, { userId: "u2", postId: two.id, failed: true })).toEqual({ status: "failed", url: null });
    expect(await postRow(two.id)).toMatchObject({ status: "failed" });
  });

  it("an upload YouTube already has whole is a posted video, whatever the browser saw", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const { id, uploadUrl } = await start();
    google.receive(uploadUrl, 1000); // the last piece landed, its answer was lost
    expect(await cancelPost(db, deps, { userId: "u2", postId: id, failed: true })).toEqual({ status: "posted", url: "https://youtu.be/video000001" });
    expect(await postRow(id)).toMatchObject({ status: "posted", videoId: "video000001", uploadUrlEnc: null });
    expect(google.sessions.get(uploadUrl)?.canceled).toBe(false);
  });

  it("leaves a posted video alone", async () => {
    const { db, deps, google, start, postRow } = await setup();
    const { id, uploadUrl } = await start();
    google.receive(uploadUrl, 1000);
    await finishPost(db, deps, { userId: "u2", postId: id });
    expect(await cancelPost(db, deps, { userId: "u2", postId: id })).toEqual({ status: "posted", url: "https://youtu.be/video000001" });
    expect(await postRow(id)).toMatchObject({ status: "posted", videoId: "video000001" });
    expect(google.sessions.get(uploadUrl)?.canceled).toBe(false);
  });

  it("records the stop even when YouTube can't be told", async () => {
    const { db, deps, start, postRow } = await setup();
    const { id } = await start();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await cancelPost(db, { ...deps, fetch: (async () => Promise.reject(new Error("offline"))) as typeof fetch }, { userId: "u2", postId: id });
    expect(await postRow(id)).toMatchObject({ status: "canceled" });
  });
});

describe("postingStatus", () => {
  it("is unavailable without settings, for a viewer, a stranger and an unknown project", async () => {
    const { db, cfg, projectId } = await setup();
    expect(await postingStatus(db, null, "u1", projectId)).toEqual({ available: false });
    expect(await postingStatus(db, cfg, "u3", projectId)).toEqual({ available: false });
    expect(await postingStatus(db, cfg, "stranger", projectId)).toEqual({ available: false });
    expect(await postingStatus(db, cfg, "u1", "nope")).toEqual({ available: false });
  });

  it("names the space's channel, and says who can connect one", async () => {
    const { db, cfg, projectId } = await setup();
    expect(await postingStatus(db, cfg, "u2", projectId)).toEqual({ available: true, channel: "Seattle Solvers", broken: false, canConnect: false, settingsPath: "/s/seattle-solvers/settings/socials" });
    await db.update(socialConnection).set({ channelTitle: null, brokenAt: new Date(), brokenReason: "revoked" });
    expect(await postingStatus(db, cfg, "u1", projectId)).toEqual({ available: true, channel: "team@gmail.com", broken: true, canConnect: true, settingsPath: "/s/seattle-solvers/settings/socials" });
    const bare = await setup({ connect: false });
    expect(await postingStatus(bare.db, bare.cfg, "u1", bare.projectId)).toMatchObject({ available: true, channel: null, broken: false });
  });
});

describe("listPosts", () => {
  it("lists the space's posts newest first, with who posted and from which project", async () => {
    const { db, deps, google, start } = await setup();
    const one = await start();
    google.receive(one.uploadUrl, 1000);
    await finishPost(db, deps, { userId: "u2", postId: one.id });
    await db.update(socialPost).set({ createdAt: new Date(Date.now() - 60_000) }).where(eq(socialPost.id, one.id));
    await start({ userId: "u1", form: form({ title: "Second", visibility: "public" }) });
    const listed = await listPosts(db, SEED_TEAM_ID);
    expect(listed.map(({ title, visibility, status, url, postedBy, projectName }) => ({ title, visibility, status, url, postedBy, projectName }))).toEqual([
      { title: "Second", visibility: "public", status: "uploading", url: null, postedBy: "Ada", projectName: "Robot reveal" },
      { title: "Match recap", visibility: "unlisted", status: "posted", url: "https://youtu.be/video000001", postedBy: "Bo", projectName: "Robot reveal" },
    ]);
    expect(await listPosts(db, "team_other")).toEqual([]);
  });

  it("an upload still open a day later reads as one that didn't finish", async () => {
    const { db, start } = await setup();
    const { id } = await start();
    expect((await listPosts(db, SEED_TEAM_ID))[0].status).toBe("uploading");
    expect((await listPosts(db, SEED_TEAM_ID, 20, new Date(Date.now() + 25 * 3600_000)))[0]).toMatchObject({ id, status: "failed" });
  });
});

describe("the posting routes", () => {
  async function routes(opts: { configured?: boolean } = {}) {
    const world = await setup();
    const signedIn: { user: CurrentUser | null } = { user: testUser({ id: "u2" }) };
    const handlers = makePostHandlers({
      db: () => world.db as DB,
      auth: async () => signedIn.user ?? Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }),
      config: () => (opts.configured === false ? null : world.cfg),
      fetch: world.google.fetch,
    });
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      new Request(`${BASE}/api/social/youtube/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: BASE, host: "app.test", "x-forwarded-proto": "https", ...headers }, body: JSON.stringify(body) });
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
    const startBody = { projectId: world.projectId, title: "Match recap", description: "", visibility: "private", madeForKids: false, sizeBytes: 1000 };
    return { ...world, signedIn, handlers, post, ctx, startBody };
  }

  it("start, offset, finish: the whole of a post over HTTP", async () => {
    const { handlers, post, ctx, startBody, google } = await routes();
    const started = await handlers.start(post("posts", startBody));
    expect(started.status).toBe(201);
    const { id, uploadUrl } = (await started.json()) as { id: string; uploadUrl: string };
    expect(google.sessions.has(uploadUrl)).toBe(true);
    const offset = await handlers.offset(post(`posts/${id}/offset`, {}), ctx(id));
    expect(await offset.json()).toEqual({ offset: 0, done: false });
    google.receive(uploadUrl, 1000);
    const finished = await handlers.finish(post(`posts/${id}/finish`, {}), ctx(id));
    expect(finished.status).toBe(200);
    expect(await finished.json()).toEqual({ videoId: "video000001", url: "https://youtu.be/video000001" });
  });

  it("cancel answers with how the post ended", async () => {
    const { handlers, post, ctx, startBody, postRow } = await routes();
    const { id } = (await (await handlers.start(post("posts", startBody))).json()) as { id: string };
    const res = await handlers.cancel(post(`posts/${id}/cancel`, { failed: true }), ctx(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "failed", url: null });
    expect(await postRow(id)).toMatchObject({ status: "failed" });
  });

  it("refuses a signed-out caller, another site, a body it does not know, and a server without posting", async () => {
    const { handlers, post, ctx, startBody, signedIn, google } = await routes();
    expect((await handlers.start(post("posts", startBody, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await handlers.start(post("posts", { ...startBody, extra: 1 }))).status).toBe(400);
    expect((await handlers.start(post("posts", { ...startBody, visibility: "everyone" }))).status).toBe(400);
    expect((await handlers.finish(post("posts/x/finish", { videoId: 5 }), ctx("x"))).status).toBe(400);
    signedIn.user = null;
    expect((await handlers.start(post("posts", startBody))).status).toBe(401);
    expect((await handlers.status(new Request(`${BASE}/api/social/youtube/status?project=p`))).status).toBe(401);
    expect(google.sessions.size).toBe(0);

    const bare = await routes({ configured: false });
    const res = await bare.handlers.start(bare.post("posts", bare.startBody));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "NOT_SET_UP", message: "Posting to YouTube isn't set up on this server." });
    const status = await bare.handlers.status(new Request(`${BASE}/api/social/youtube/status?project=${bare.projectId}`));
    expect(await status.json()).toEqual({ available: false });
  });

  it("status tells the editor about the project's space", async () => {
    const { handlers, projectId } = await routes();
    const res = await handlers.status(new Request(`${BASE}/api/social/youtube/status?project=${projectId}`));
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ available: true, channel: "Seattle Solvers", broken: false, canConnect: false, settingsPath: "/s/seattle-solvers/settings/socials" });
  });
});
