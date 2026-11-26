import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { assets, organization, socialConnection, styleReference } from "@/db/schema";
import { saveYoutubeConnection } from "@/lib/social/connections";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { CHANNEL_FACTS_DAYS } from "@/lib/style/service";
import { cleanUpStyles, makeStyleTrimCron } from "@/lib/style/trim-cron";
import { joinSpace } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { fakeYoutube, socialTestConfig } from "../helpers/social";
import { insertAsset } from "../media/context";

function cron(env: Record<string, string | undefined>) {
  const clean = vi.fn(async () => ({ trimmed: 3, dropped: 2, channelsGone: 1 }));
  return { handler: makeStyleTrimCron({ env, clean }), clean };
}

const get = (auth?: string) => new Request("http://localhost/api/cron/style-trim", { headers: auth === undefined ? {} : { authorization: auth } });

describe("the daily clean-up of the styles", () => {
  it("refuses a request without the cron secret, before cleaning anything up", async () => {
    const { handler, clean } = cron({ CRON_SECRET: "s3cret" });
    for (const auth of [undefined, "Bearer wrong", "s3cret"]) {
      expect((await handler(get(auth))).status, String(auth)).toBe(401);
    }
    expect(clean).not.toHaveBeenCalled();
  });

  it("refuses everything when no cron secret is set on the server", async () => {
    const { handler, clean } = cron({});
    expect((await handler(get("Bearer "))).status).toBe(401);
    expect((await handler(get("Bearer undefined"))).status).toBe(401);
    expect(clean).not.toHaveBeenCalled();
  });

  it("with the secret: cleans up and answers what it did", async () => {
    const { handler, clean } = cron({ CRON_SECRET: "s3cret" });
    const res = await handler(get("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ trimmed: 3, dropped: 2, channelsGone: 1 });
    expect(clean).toHaveBeenCalledOnce();
  });
});

describe("cleanUpStyles", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const TEAM_B = "team_b";

  async function setup() {
    const db = await makeTestDb();
    const cfg = socialTestConfig();
    const google = fakeYoutube(cfg);
    await joinSpace(db, { id: "u1" }, "admin");
    await db.insert(organization).values({ id: TEAM_B, name: "B", slug: TEAM_B, createdAt: new Date(), kind: "team" });
    await joinSpace(db, { id: "u1" }, "admin", TEAM_B);
    const connect = (spaceId: string, refreshToken: string) =>
      saveYoutubeConnection(db, cfg, { spaceId, connectedBy: "u1", googleSub: `g-${spaceId}`, email: "team@gmail.com", channel: { id: `UC-${spaceId}`, title: "Solvers" }, refreshToken, scopes: [] }, { revoke: async () => {} });
    // A video the space's style added from its channel, with YouTube's facts read at fetchedAt.
    const fromChannel = (id: string, spaceId: string, fetchedAt = new Date()) => ({
      id,
      spaceId,
      kind: "link" as const,
      title: "Match day",
      url: `https://www.youtube.com/watch?v=${id.padEnd(11, "a")}`,
      provider: "channel" as const,
      author: "Seattle Solvers",
      analysis: { kind: "link" as const, provider: "channel" as const, title: "Match day", author: "Seattle Solvers", fetchedAt: fetchedAt.toISOString() },
      fetchedAt,
      createdBy: "u1",
    });
    // A link pasted by hand, which isn't from the channel.
    const pasted = (id: string, spaceId: string) => ({ id, spaceId, kind: "link" as const, title: "Paper planes", url: `https://vimeo.com/${id}`, provider: "vimeo" as const, createdBy: "u1" });
    const ids = async () => (await db.select({ id: styleReference.id }).from(styleReference)).map((row) => row.id).sort();
    return { db, cfg, google, connect, fromChannel, pasted, ids };
  }

  it("drops what a style kept from a channel Google no longer lets EasyEdit read, and from a channel the space no longer has", async () => {
    const { db, cfg, google, connect, fromChannel, pasted, ids } = await setup();
    await connect(SEED_TEAM_ID, "1//yt-team");
    const old = new Date(Date.now() - (CHANNEL_FACTS_DAYS + 1) * DAY);
    await db.insert(styleReference).values([fromChannel("ch1", SEED_TEAM_ID), fromChannel("ch0", SEED_TEAM_ID, old), pasted("vm1", SEED_TEAM_ID), fromChannel("ch2", TEAM_B), pasted("vm2", TEAM_B)]);
    google.refreshRefusal = "invalid_grant"; // the team removed EasyEdit in its Google account
    // TEAM_B has no channel connected at all: what it kept from one is left over, and goes too. Old facts are cut back
    // first, before Google is asked anything.
    expect(await cleanUpStyles(db, cfg, google.fetch)).toEqual({ trimmed: 1, dropped: 1, channelsGone: 1 });
    expect(await ids()).toEqual(["vm1", "vm2"]);
    expect((await db.select().from(socialConnection))[0].brokenReason).toBe("revoked");
  });

  it("keeps what a working channel gave, and what a channel broken only by the server's key gave, and cuts back old facts", async () => {
    const { db, cfg, google, connect, fromChannel, ids } = await setup();
    await connect(SEED_TEAM_ID, "1//yt-team");
    await connect(TEAM_B, "1//yt-b");
    await db.update(socialConnection).set({ brokenAt: new Date(), brokenReason: "key" }).where(eq(socialConnection.spaceId, TEAM_B));
    const old = new Date(Date.now() - (CHANNEL_FACTS_DAYS + 1) * DAY);
    await db.insert(styleReference).values([fromChannel("ch1", SEED_TEAM_ID), fromChannel("ch2", SEED_TEAM_ID, old), fromChannel("ch3", TEAM_B)]);
    expect(await cleanUpStyles(db, cfg, google.fetch)).toEqual({ trimmed: 1, dropped: 0, channelsGone: 0 });
    expect(await ids()).toEqual(["ch1", "ch2", "ch3"]);
    expect(google.refreshes).toEqual(["1//yt-team"]); // a broken channel isn't asked about
    const [trimmed] = await db.select().from(styleReference).where(eq(styleReference.id, "ch2"));
    expect(trimmed).toMatchObject({ author: null, title: trimmed.url });
  });

  it("on a server without YouTube, asks Google nothing and still sweeps", async () => {
    const { db, google, fromChannel, ids } = await setup();
    const cam = await insertAsset(db, { uploadedBy: "u1" });
    await db.insert(styleReference).values([fromChannel("ch1", SEED_TEAM_ID), { id: "v1", spaceId: SEED_TEAM_ID, kind: "video", title: "IMG", assetId: cam, createdBy: "u1" }]);
    await db.update(assets).set({ removedAt: new Date(), removedBy: "u1" }).where(eq(assets.id, cam));
    expect(await cleanUpStyles(db, null, google.fetch)).toEqual({ trimmed: 0, dropped: 2, channelsGone: 0 });
    expect(await ids()).toEqual([]);
    expect(google.calls).toEqual([]);
  });
});
