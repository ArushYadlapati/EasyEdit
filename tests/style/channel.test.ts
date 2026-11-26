import { afterEach, describe, expect, it, vi } from "vitest";
import { socialConnection, styleReference } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import { saveYoutubeConnection } from "@/lib/social/connections";
import { SOCIAL_MESSAGES } from "@/lib/social/messages";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import { addFromChannel, CHANNEL_UPLOADS, channelStatus } from "@/lib/style/channel";
import { addChannelVideo, fetchChannel } from "@/lib/style/client";
import { makeStyleHandlers } from "@/lib/style/handlers";
import { STYLE_MESSAGES } from "@/lib/style/messages";
import { listReferences } from "@/lib/style/service";
import type { StyleReference } from "@/lib/style/types";
import { joinSpace, testActor, testUser } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { fakeYoutube, socialTestConfig } from "../helpers/social";

const API = "https://www.googleapis.com/youtube/v3";
const CHANNEL = "UC123";
const TOKEN = "Bearer ya29.for.1//yt-refresh-1";

const editor = testActor({ userId: "ed", email: "ed@gmail.com", role: "editor" });
const viewer = testActor({ userId: "vi", email: "vi@gmail.com", role: "viewer" });

const refusal = (error: unknown) => (error && typeof error === "object" && "code" in error && "status" in error && "message" in error ? { code: error.code, status: error.status, message: error.message } : error);

// A video as YouTube's videos answer describes it, on the space's channel unless told otherwise.
function video(id: string, over: { channelId?: string; title?: string } = {}) {
  return {
    id,
    snippet: {
      channelId: over.channelId ?? CHANNEL,
      channelTitle: "Seattle Solvers",
      title: over.title ?? `Match day ${id.at(-1)}`,
      description: "We won!\nThanks for watching.",
      tags: ["robotics", "FTC"],
      thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
    },
    contentDetails: { duration: "PT45S" },
  };
}

type Video = ReturnType<typeof video>;
const uploadIds = ["aaaaaaaaaa1", "aaaaaaaaaa2", "aaaaaaaaaa3"];

// The pretend Google of the posting tests (sign-in tokens, the channel), with the channel's uploads on top: its
// uploads list, and the videos answer for those and for videos on other channels.
function channelGoogle() {
  const cfg = socialTestConfig();
  const google = fakeYoutube(cfg);
  const world = {
    cfg,
    google,
    uploads: uploadIds.map((id) => video(id)) as Video[],
    elsewhere: [] as Video[], // videos YouTube shows that are on other channels
    refusal: null as { status: number; reason: string } | null, // what YouTube answers every channel read with
    down: false, // every read of the channel's videos gets no answer at all
    badSignIn: false, // Google's sign-in answers a refresh with something that isn't a token
    reads: [] as string[], // "<path> <authorization>" for each read of the channel's videos
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const path = url.origin + url.pathname;
      if (world.badSignIn && request.url === "https://oauth2.googleapis.com/token") return Response.json({ token_type: "Bearer" });
      const read = [`${API}/channels`, `${API}/playlistItems`, `${API}/videos`].includes(path) && url.searchParams.get("part")?.includes("contentDetails");
      if (!read) return google.fetch(input, init);
      world.reads.push(`${url.pathname.split("/").at(-1)} ${request.headers.get("authorization")}`);
      if (world.down) throw new TypeError("fetch failed");
      if (world.refusal) return Response.json({ error: { code: world.refusal.status, errors: [{ reason: world.refusal.reason }] } }, { status: world.refusal.status });
      if (path === `${API}/channels`) return Response.json({ items: [{ id: CHANNEL, contentDetails: { relatedPlaylists: { uploads: "UU123" } } }] });
      if (path === `${API}/playlistItems`) {
        const max = Number(url.searchParams.get("maxResults"));
        return Response.json({ items: world.uploads.slice(0, max).map((upload) => ({ contentDetails: { videoId: upload.id } })) });
      }
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return Response.json({ items: [...world.uploads, ...world.elsewhere].filter((item) => ids.includes(item.id)) });
    }) as typeof fetch,
  };
  return world;
}

async function setup(opts: { connect?: "yes" | "no" | "without read" } = {}) {
  const db = await makeTestDb();
  await joinSpace(db, { id: "u1", name: "Ada" }, "admin");
  await joinSpace(db, { id: "ed" }, "editor");
  await joinSpace(db, { id: "vi" }, "viewer");
  await joinSpace(db, { id: "out" }, "admin", personalSpaceId("out"));
  const world = channelGoogle();
  const connect = opts.connect ?? "yes";
  if (connect !== "no") {
    await saveYoutubeConnection(db, world.cfg, {
      spaceId: SEED_TEAM_ID,
      connectedBy: "u1",
      googleSub: "g-yt-1",
      email: "team@gmail.com",
      channel: connect === "yes" ? { id: CHANNEL, title: "Seattle Solvers" } : null,
      refreshToken: "1//yt-refresh-1",
      scopes: [],
    });
  }
  const status = (actor = editor) => channelStatus(db, actor, world.cfg, world.fetch);
  const add = (videoId: string, actor = editor) => addFromChannel(db, actor, world.cfg, videoId, world.fetch);
  const references = () => db.select().from(styleReference);
  return { db, world, status, add, references };
}

afterEach(() => vi.restoreAllMocks());

describe("channelStatus", () => {
  it("is off on a server without YouTube, without asking anyone anything", async () => {
    const { db, world } = await setup();
    expect(await channelStatus(db, editor, null, world.fetch)).toEqual({ on: false });
    expect(world.google.calls).toEqual([]);
  });

  it("has no channel to offer when the space has none connected", async () => {
    const { status, world } = await setup({ connect: "no" });
    expect(await status()).toEqual({ on: true, connected: false });
    expect(world.google.calls).toEqual([]);
  });

  it("lists the channel's newest uploads, read with the channel's own permission", async () => {
    const { status, world } = await setup();
    const answer = await status();
    expect(answer).toMatchObject({ on: true, connected: true, channelTitle: "Seattle Solvers" });
    if (!answer.on || !answer.connected) throw new Error("not connected");
    expect(answer.videos.map((upload) => upload.id)).toEqual(uploadIds);
    expect(answer.videos[0]).toEqual({
      id: "aaaaaaaaaa1",
      url: "https://www.youtube.com/watch?v=aaaaaaaaaa1",
      title: "Match day 1",
      author: "Seattle Solvers",
      thumbnailUrl: "https://i.ytimg.com/vi/aaaaaaaaaa1/mqdefault.jpg",
      seconds: 45,
      description: "We won! Thanks for watching.",
      tags: ["robotics", "FTC"],
    });
    expect(world.reads).toEqual([`channels ${TOKEN}`, `playlistItems ${TOKEN}`, `videos ${TOKEN}`]);
  });

  it(`offers at most the ${CHANNEL_UPLOADS} newest`, async () => {
    const { status, world } = await setup();
    world.uploads = Array.from({ length: 40 }, (_, n) => video(`vid${String(n).padStart(8, "0")}`));
    const answer = await status();
    expect(answer.on && answer.connected && answer.videos.map((upload) => upload.id)).toEqual(world.uploads.slice(0, CHANNEL_UPLOADS).map((upload) => upload.id));
  });

  it("says why when EasyEdit may not see the channel's videos, without asking Google", async () => {
    const { status, world } = await setup({ connect: "without read" });
    expect(await status()).toEqual({ on: true, connected: false, message: STYLE_MESSAGES.channelHidden });
    expect(world.google.calls).toEqual([]);
  });

  it("is broken when Google ended the connection, and doesn't ask again", async () => {
    const { db, status, world } = await setup();
    world.google.refreshRefusal = "invalid_grant";
    expect(await status()).toEqual({ on: true, connected: false, broken: true, message: SOCIAL_MESSAGES.broken });
    expect((await db.select().from(socialConnection))[0].brokenAt).not.toBeNull();
    const asked = world.google.calls.length;
    expect(await status()).toEqual({ on: true, connected: false, broken: true, message: SOCIAL_MESSAGES.broken });
    expect(world.google.calls).toHaveLength(asked);
    expect(world.reads).toEqual([]);
  });

  it("is broken, saying why in the person's words, when YouTube refuses or doesn't answer", async () => {
    const { db, status, world } = await setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [answer, message] of [
      [{ status: 403, reason: "quotaExceeded" }, SOCIAL_MESSAGES.quota],
      [{ status: 403, reason: "forbidden" }, SOCIAL_MESSAGES.notAllowed],
      [{ status: 503, reason: "backendError" }, SOCIAL_MESSAGES.unreachable],
      [{ status: 400, reason: "badRequest" }, STYLE_MESSAGES.channelUnreadable],
    ] as const) {
      world.refusal = answer;
      expect(await status(), answer.reason).toEqual({ on: true, connected: false, broken: true, message });
    }
    expect(logged).toHaveBeenCalled();
    expect(logged.mock.calls.flat().join(" ")).not.toContain("ya29");
    // YouTube's refusal says nothing about the connection itself, which stays whole.
    expect((await db.select().from(socialConnection))[0].brokenAt).toBeNull();
  });

  it("says YouTube didn't answer when it can't be reached, or Google's sign-in answers something unusable", async () => {
    const { db, status, world } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    world.down = true;
    expect(await status()).toEqual({ on: true, connected: false, broken: true, message: SOCIAL_MESSAGES.unreachable });
    world.down = false;
    world.badSignIn = true;
    expect(await status()).toEqual({ on: true, connected: false, broken: true, message: SOCIAL_MESSAGES.unreachable });
    expect(world.reads).toEqual([`channels ${TOKEN}`]);
    expect((await db.select().from(socialConnection))[0].brokenAt).toBeNull();
  });

  it("is for editors and admins", async () => {
    const { status, world } = await setup();
    expect(refusal(await status(viewer).catch((e) => e))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(world.google.calls).toEqual([]);
    await expect(status(testActor({ userId: "u1", role: "admin" }))).resolves.toMatchObject({ on: true, connected: true });
  });
});

describe("addFromChannel", () => {
  it("adds an upload with what YouTube says about it", async () => {
    const { db, add, world } = await setup();
    const reference = await add("aaaaaaaaaa2");
    expect(reference).toMatchObject({
      kind: "link",
      provider: "channel",
      status: "ready",
      url: "https://www.youtube.com/watch?v=aaaaaaaaaa2",
      title: "Match day 2",
      author: "Seattle Solvers",
      thumbnailUrl: "https://i.ytimg.com/vi/aaaaaaaaaa2/mqdefault.jpg",
      analysis: {
        kind: "link",
        provider: "channel",
        title: "Match day 2",
        author: "Seattle Solvers",
        thumbnailUrl: "https://i.ytimg.com/vi/aaaaaaaaaa2/mqdefault.jpg",
        seconds: 45,
        description: "We won! Thanks for watching.",
        tags: ["robotics", "FTC"],
        fetchedAt: expect.any(String),
      },
    });
    expect(world.reads).toEqual([`videos ${TOKEN}`]);
    expect(await listReferences(db, viewer)).toEqual([reference]);
  });

  it("adding it again refreshes what YouTube says, and keeps one reference", async () => {
    const { add, references, world } = await setup();
    const first = await add("aaaaaaaaaa1");
    world.uploads[0] = video("aaaaaaaaaa1", { title: "Match day, the director's cut" });
    const again = await add("aaaaaaaaaa1");
    expect(again).toMatchObject({ id: first.id, title: "Match day, the director's cut", analysis: { title: "Match day, the director's cut" } });
    expect(await references()).toHaveLength(1);
  });

  it("refuses a video on another channel, one YouTube doesn't show, and an id that isn't a video's", async () => {
    const { add, references, world } = await setup();
    world.elsewhere.push(video("bbbbbbbbbb1", { channelId: "UCsomeoneElse" }));
    const notOurs = { code: "INVALID", status: 400, message: STYLE_MESSAGES.notOnChannel };
    expect(refusal(await add("bbbbbbbbbb1").catch((e) => e))).toEqual(notOurs);
    expect(refusal(await add("ccccccccccc").catch((e) => e))).toEqual(notOurs);
    const asked = world.google.calls.length;
    for (const id of ["", "abc", "aaaaaaaaaa1,bbbbbbbbbb1", "../../videos"]) expect(refusal(await add(id).catch((e) => e)), id).toEqual(notOurs);
    expect(world.google.calls).toHaveLength(asked);
    expect(await references()).toEqual([]);
  });

  it("is refused on a server without YouTube, and in a space with no channel it can read", async () => {
    const off = await setup();
    expect(refusal(await addFromChannel(off.db, editor, null, "aaaaaaaaaa1", off.world.fetch).catch((e) => e))).toEqual({ code: "NOT_FOUND", status: 404, message: STYLE_MESSAGES.channelOff });
    const none = await setup({ connect: "no" });
    expect(refusal(await none.add("aaaaaaaaaa1").catch((e) => e))).toEqual({ code: "NOT_CONNECTED", status: 409, message: SOCIAL_MESSAGES.notConnected });
    const hidden = await setup({ connect: "without read" });
    expect(refusal(await hidden.add("aaaaaaaaaa1").catch((e) => e))).toEqual({ code: "NOT_CONNECTED", status: 409, message: STYLE_MESSAGES.channelHidden });
    for (const { world } of [off, none, hidden]) expect(world.google.calls).toEqual([]);
  });

  it("says so when the connection is broken or YouTube refuses, and adds nothing", async () => {
    const { add, references, world } = await setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    world.refusal = { status: 403, reason: "quotaExceeded" };
    expect(refusal(await add("aaaaaaaaaa1").catch((e) => e))).toEqual({ code: "PLATFORM_REFUSED", status: 502, message: SOCIAL_MESSAGES.quota });
    world.refusal = { status: 400, reason: "badRequest" };
    expect(refusal(await add("aaaaaaaaaa1").catch((e) => e))).toEqual({ code: "PLATFORM_REFUSED", status: 502, message: STYLE_MESSAGES.channelUnreadable });
    world.refusal = null;
    world.down = true;
    expect(refusal(await add("aaaaaaaaaa1").catch((e) => e))).toEqual({ code: "PLATFORM_REFUSED", status: 502, message: SOCIAL_MESSAGES.unreachable });
    world.down = false;
    world.google.refreshRefusal = "invalid_grant";
    const broken = { code: "CONNECTION_BROKEN", status: 409, message: SOCIAL_MESSAGES.broken };
    expect(refusal(await add("aaaaaaaaaa1").catch((e) => e))).toEqual(broken);
    expect(refusal(await add("aaaaaaaaaa1").catch((e) => e))).toEqual(broken);
    expect(await references()).toEqual([]);
  });

  it("is for editors and admins", async () => {
    const { add, references, world } = await setup();
    expect(refusal(await add("aaaaaaaaaa1", viewer).catch((e) => e))).toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(world.google.calls).toEqual([]);
    expect(await references()).toEqual([]);
  });
});

describe("/api/style/channel and adding from it", () => {
  async function routes(opts: { youtube?: boolean } = {}) {
    const base = await setup();
    let current: CurrentUser = testUser({ id: "ed" });
    const style = makeStyleHandlers({
      db: () => base.db,
      auth: vi.fn(async () => current),
      fetch: base.world.fetch,
      ...(opts.youtube !== false && { config: () => base.world.cfg }),
    });
    const as = (id: string) => (current = testUser({ id }));
    return { ...base, style, as };
  }
  const get = (space: string) => new Request(`http://x/api/style/channel?space=${space}`);
  const post = (body: unknown) => new Request(`http://x/api/style/references?space=${SEED_TEAM_ID}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const read = async (r: Response) => ({ status: r.status, body: await r.json() });

  it("an editor sees the channel's uploads, never kept by the browser", async () => {
    const { style } = await routes();
    const response = await style.channel(get(SEED_TEAM_ID));
    expect(response.headers.get("cache-control")).toBe("no-store");
    const { status, body } = await read(response);
    expect(status).toBe(200);
    expect(body).toMatchObject({ on: true, connected: true, channelTitle: "Seattle Solvers" });
    expect(body.videos).toHaveLength(3);
  });

  it("is off on a server without YouTube, a viewer is refused, and someone outside the space gets what an unknown space gets", async () => {
    const off = await routes({ youtube: false });
    expect(await read(await off.style.channel(get(SEED_TEAM_ID)))).toEqual({ status: 200, body: { on: false } });
    const { style, as } = await routes();
    as("vi");
    expect((await read(await style.channel(get(SEED_TEAM_ID)))).status).toBe(403);
    as("out");
    expect(await read(await style.channel(get(SEED_TEAM_ID)))).toEqual({ status: 404, body: { code: "NOT_FOUND", message: "Space not found" } });
  });

  it("an editor adds an upload by its id, and the other kinds still work", async () => {
    const { style } = await routes();
    const added = await read(await style.addReference(post({ kind: "channel", videoId: "aaaaaaaaaa3" })));
    expect(added).toMatchObject({ status: 201, body: { reference: { kind: "link", provider: "channel", title: "Match day 3", url: "https://www.youtube.com/watch?v=aaaaaaaaaa3" } } });
    const other = await read(await style.addReference(post({ kind: "link", url: "https://vimeo.com/76979871" })));
    expect(other.status).toBe(201);
    expect(other.body.reference).toMatchObject({ kind: "link", provider: "vimeo" });
  });

  it("takes nothing but the id from the browser", async () => {
    const { style, references } = await routes();
    for (const body of [{ kind: "channel" }, { kind: "channel", videoId: 5 }, { kind: "channel", videoId: "aaaaaaaaaa1", title: "Not what YouTube says" }]) {
      expect((await read(await style.addReference(post(body)))).status, JSON.stringify(body)).toBe(400);
    }
    expect(await references()).toEqual([]);
  });

  it("adding from a channel on a server without YouTube is 404", async () => {
    const { style } = await routes({ youtube: false });
    expect(await read(await style.addReference(post({ kind: "channel", videoId: "aaaaaaaaaa1" })))).toEqual({ status: 404, body: { code: "NOT_FOUND", message: STYLE_MESSAGES.channelOff } });
  });
});

describe("the channel client", () => {
  afterEach(() => vi.unstubAllGlobals());

  function answer(status: number, body: unknown) {
    const fetchFn = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchFn);
    return (n = 0) => {
      const [input, init] = fetchFn.mock.calls[n];
      return { url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined };
    };
  }

  const UPLOAD = { id: "aaaaaaaaaa1", url: "https://www.youtube.com/watch?v=aaaaaaaaaa1", title: "Match day", seconds: 45, tags: ["FTC"] };

  it("reads what the channel offers, and refuses an answer that isn't that", async () => {
    for (const body of [{ on: false }, { on: true, connected: false }, { on: true, connected: false, broken: true, message: "Lost it." }, { on: true, connected: true, channelTitle: "Seattle Solvers", videos: [UPLOAD] }]) {
      const call = answer(200, body);
      await expect(fetchChannel("team 1")).resolves.toEqual(body);
      expect(call()).toEqual({ url: "/api/style/channel?space=team%201", method: "GET", body: undefined });
    }
    for (const body of [{}, null, { on: "yes" }, { on: true }, { on: true, connected: false, message: 5 }, { on: true, connected: true, videos: [] }, { on: true, connected: true, channelTitle: "S", videos: [{ ...UPLOAD, id: 1 }] }, { on: true, connected: true, channelTitle: "S", videos: [{ ...UPLOAD, thumbnailUrl: {} }] }]) {
      answer(200, body);
      await expect(fetchChannel("team1"), JSON.stringify(body)).rejects.toThrow("Your channel's videos couldn't be loaded. Try again.");
    }
    answer(403, { code: "FORBIDDEN", message: "You don't have permission." });
    await expect(fetchChannel("team1")).rejects.toThrow("You don't have permission.");
  });

  it("adds an upload by its id alone", async () => {
    const reference: StyleReference = { id: "r1", kind: "link", provider: "channel", title: "Match day", status: "ready", analysis: null, hasSheet: false, createdAt: "2026-11-25T10:00:00.000Z" };
    const call = answer(201, { reference });
    await expect(addChannelVideo("team1", "aaaaaaaaaa1")).resolves.toEqual(reference);
    expect(call()).toEqual({ url: "/api/style/references?space=team1", method: "POST", body: { kind: "channel", videoId: "aaaaaaaaaa1" } });
    answer(400, { code: "INVALID", message: STYLE_MESSAGES.notOnChannel });
    await expect(addChannelVideo("team1", "bbbbbbbbbb1")).rejects.toThrow(STYLE_MESSAGES.notOnChannel);
  });
});
