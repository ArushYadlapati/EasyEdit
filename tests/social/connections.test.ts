import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { socialConnection, socialPost } from "@/db/schema";
import { channelAccess, disconnectYoutube, dropChannel, findConnection, saveYoutubeConnection } from "@/lib/social/connections";
import { seal } from "@/lib/storage/secret-box";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { saveConnection } from "@/lib/storage/connections";
import { ConnectionBrokenError } from "@/lib/storage/google-oauth";
import { joinSpace } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { fakeYoutube, socialTestConfig } from "../helpers/social";
import { sql } from "drizzle-orm";

async function setup() {
  const db = await makeTestDb();
  const cfg = socialTestConfig();
  const google = fakeYoutube(cfg);
  await joinSpace(db, { id: "u1" }, "admin");
  await joinSpace(db, { id: "u2" }, "editor");
  const revoke = vi.fn(async () => {});
  const save = (over: Partial<Parameters<typeof saveYoutubeConnection>[2]> = {}) =>
    saveYoutubeConnection(
      db,
      cfg,
      { spaceId: SEED_TEAM_ID, connectedBy: "u1", googleSub: "g-yt-1", email: "team@gmail.com", channel: { id: "UC123", title: "Seattle Solvers" }, refreshToken: "1//yt-refresh-1", scopes: ["a", "b"], ...over },
      { revoke },
    );
  const team = async (id: string) => {
    await db.execute(sql`insert into organization (id, name, slug, created_at, kind) values (${id}, ${id}, ${id}, now(), 'team')`);
    await joinSpace(db, { id: "u1" }, "admin", id);
    return id;
  };
  return { db, cfg, google, revoke, save, team };
}

describe("saveYoutubeConnection", () => {
  it("keeps one channel per space, with the refresh token sealed", async () => {
    const { db, cfg, save } = await setup();
    const saved = await save();
    expect(saved).toMatchObject({ spaceId: SEED_TEAM_ID, connectedBy: "u1", email: "team@gmail.com", channelId: "UC123", channelTitle: "Seattle Solvers", broken: false });
    const rows = await db.select().from(socialConnection);
    expect(rows).toHaveLength(1);
    expect(rows[0].refreshTokenEnc).not.toContain("yt-refresh-1");
    expect(rows[0].scopes).toBe("a b");
    expect(await findConnection(db, cfg, SEED_TEAM_ID)).toEqual(saved);
    expect(await findConnection(db, cfg, "team_other")).toBeNull();
  });

  it("connecting the same account again replaces its token and mends it, without revoking anything", async () => {
    const { db, cfg, save, revoke } = await setup();
    const first = await save();
    await db.update(socialConnection).set({ brokenAt: new Date(), brokenReason: "revoked" });
    const again = await save({ refreshToken: "1//yt-refresh-2", channel: { id: "UC123", title: "Solvers" } });
    expect(again.id).toBe(first.id);
    expect(again).toMatchObject({ broken: false, channelTitle: "Solvers" });
    expect(await db.select().from(socialConnection)).toHaveLength(1);
    expect(revoke).not.toHaveBeenCalled();
    expect((await findConnection(db, cfg, SEED_TEAM_ID))?.broken).toBe(false);
  });

  it("a different account replaces the old one, which is revoked at Google", async () => {
    const { save, revoke } = await setup();
    await save();
    const next = await save({ googleSub: "g-yt-2", email: "other@gmail.com", channel: null, refreshToken: "1//yt-refresh-9" });
    expect(next).toMatchObject({ email: "other@gmail.com", channelId: null, channelTitle: null });
    expect(revoke).toHaveBeenCalledExactlyOnceWith("1//yt-refresh-1");
  });

  it("does not revoke the old account while another space's channel or a Drive still uses it", async () => {
    const { db, cfg, save, revoke, team } = await setup();
    await save();
    await save({ spaceId: await team("team_b") });
    await save({ googleSub: "g-yt-2", refreshToken: "1//yt-refresh-9" });
    expect(revoke).not.toHaveBeenCalled();

    await save({ spaceId: "team_b", googleSub: "g-drive", refreshToken: "1//yt-refresh-d" });
    await saveConnection(db, { ...cfg, redirectUri: "https://app.test/api/storage/callback" }, { userId: "u1", googleSub: "g-drive", email: "d@gmail.com", refreshToken: "1//drive", scopes: [] });
    await save({ spaceId: "team_b", googleSub: "g-yt-3", refreshToken: "1//yt-refresh-e" });
    // team_b went g-yt-1 → g-drive → g-yt-3: g-yt-1 was revoked (nothing else used it by then), g-drive was not.
    expect(revoke.mock.calls).toEqual([["1//yt-refresh-1"]]);
  });
});

describe("channelAccess", () => {
  it("gives an access token made from the sealed refresh token", async () => {
    const { db, cfg, google, save } = await setup();
    await save();
    const { accessToken, connection } = await channelAccess(db, cfg, SEED_TEAM_ID, google.fetch);
    expect(accessToken).toBe("ya29.for.1//yt-refresh-1");
    expect(connection.channelTitle).toBe("Seattle Solvers");
    expect(google.refreshes).toEqual(["1//yt-refresh-1"]);
  });

  it("refuses a space with no channel", async () => {
    const { db, cfg, google } = await setup();
    await expect(channelAccess(db, cfg, SEED_TEAM_ID, google.fetch)).rejects.toMatchObject({ code: "NOT_CONNECTED", status: 409 });
  });

  it("marks the connection broken when Google says it is gone, and does not ask again", async () => {
    const { db, cfg, google, save } = await setup();
    await save();
    google.refreshRefusal = "invalid_grant";
    await expect(channelAccess(db, cfg, SEED_TEAM_ID, google.fetch)).rejects.toBeInstanceOf(ConnectionBrokenError);
    expect((await findConnection(db, cfg, SEED_TEAM_ID))?.broken).toBe(true);
    google.refreshRefusal = null;
    await expect(channelAccess(db, cfg, SEED_TEAM_ID, google.fetch)).rejects.toMatchObject({ reason: "revoked" });
    expect(google.refreshes).toHaveLength(1);
  });

  it("a failure that says nothing about the connection leaves it whole", async () => {
    const { db, cfg, google, save } = await setup();
    await save();
    google.refreshRefusal = "internal_failure";
    await expect(channelAccess(db, cfg, SEED_TEAM_ID, google.fetch)).rejects.toMatchObject({ name: "DriveError" });
    expect((await findConnection(db, cfg, SEED_TEAM_ID))?.broken).toBe(false);
  });

  it("a token the server's key can't open reads as broken, and is whole again once the key is back", async () => {
    const { db, cfg, google, save } = await setup();
    await save();
    const wrong = { ...cfg, tokenKey: randomBytes(32) };
    await expect(channelAccess(db, wrong, SEED_TEAM_ID, google.fetch)).rejects.toMatchObject({ reason: "unknown" });
    expect(google.refreshes).toEqual([]); // Google was not asked
    expect((await findConnection(db, wrong, SEED_TEAM_ID))?.broken).toBe(true);
    expect((await findConnection(db, cfg, SEED_TEAM_ID))?.broken).toBe(false);
    expect((await channelAccess(db, cfg, SEED_TEAM_ID, google.fetch)).accessToken).toBe("ya29.for.1//yt-refresh-1");
  });
});

describe("disconnectYoutube", () => {
  it("removes the space's channel and revokes EasyEdit's access", async () => {
    const { db, cfg, save, revoke } = await setup();
    await save();
    await disconnectYoutube(db, cfg, { spaceId: SEED_TEAM_ID, byUserId: "u1" }, { revoke });
    expect(await db.select().from(socialConnection)).toEqual([]);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("1//yt-refresh-1");
  });

  it("is for the space's admins only, and reads as no such space to anyone else", async () => {
    const { db, cfg, save, revoke } = await setup();
    await save();
    for (const byUserId of ["u2", "stranger"]) {
      await expect(disconnectYoutube(db, cfg, { spaceId: SEED_TEAM_ID, byUserId }, { revoke })).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    }
    expect(await db.select().from(socialConnection)).toHaveLength(1);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to disconnect", async () => {
    const { db, cfg, revoke } = await setup();
    await expect(disconnectYoutube(db, cfg, { spaceId: SEED_TEAM_ID, byUserId: "u1" }, { revoke })).rejects.toMatchObject({ code: "NOT_CONNECTED" });
  });

  it("keeps the Google account's grant while another space's channel uses it", async () => {
    const { db, cfg, save, revoke, team } = await setup();
    await save();
    await save({ spaceId: await team("team_b") });
    await disconnectYoutube(db, cfg, { spaceId: SEED_TEAM_ID, byUserId: "u1" }, { revoke });
    expect(revoke).not.toHaveBeenCalled();
    await disconnectYoutube(db, cfg, { spaceId: "team_b", byUserId: "u1" }, { revoke });
    expect(revoke).toHaveBeenCalledOnce();
  });

  it("ends the space's uploads that are still open, at YouTube too", async () => {
    const { db, cfg, google, save, revoke } = await setup();
    await save();
    const session = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=session-1";
    google.sessions.set(session, { size: 10, received: 4, videoId: "video000001", canceled: false, origin: null, body: null, token: null });
    const post = { spaceId: SEED_TEAM_ID, platform: "youtube" as const, postedBy: "u2", title: "t", visibility: "private" as const, sizeBytes: 10 };
    await db.insert(socialPost).values([
      { id: "sp_open", ...post, uploadUrlEnc: seal(session, cfg.tokenKey) },
      { id: "sp_done", ...post, status: "posted", videoId: "video000009" },
    ]);
    await disconnectYoutube(db, cfg, { spaceId: SEED_TEAM_ID, byUserId: "u1" }, { revoke, fetch: google.fetch });
    const rows = Object.fromEntries((await db.select().from(socialPost)).map((row) => [row.id, row]));
    expect(rows.sp_open).toMatchObject({ status: "canceled", uploadUrlEnc: null });
    expect(rows.sp_open.finishedAt).not.toBeNull();
    expect(rows.sp_done).toMatchObject({ status: "posted", videoId: "video000009" });
    expect(google.sessions.get(session)?.canceled).toBe(true);
  });

  it("dropChannel can be held to the person who connected it", async () => {
    const { db, cfg, save, revoke } = await setup();
    await save();
    expect(await dropChannel(db, cfg, { spaceId: SEED_TEAM_ID, onlyConnectedBy: "u2" }, { revoke })).toBe(false);
    expect(await db.select().from(socialConnection)).toHaveLength(1);
    expect(await dropChannel(db, cfg, { spaceId: SEED_TEAM_ID, onlyConnectedBy: "u1" }, { revoke })).toBe(true);
    expect(await db.select().from(socialConnection)).toEqual([]);
    expect(await dropChannel(db, null, { spaceId: SEED_TEAM_ID })).toBe(false);
  });

  it("still removes the row when a failing revoke throws", async () => {
    const { db, cfg, save } = await setup();
    await save();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await disconnectYoutube(db, cfg, { spaceId: SEED_TEAM_ID, byUserId: "u1" }, { revoke: async () => Promise.reject(new Error("down")) });
    expect(await db.select().from(socialConnection)).toEqual([]);
  });
});
