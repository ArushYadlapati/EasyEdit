import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { assets, driveConnection } from "@/db/schema";
import { SEED_TEAM_ID, type MySpace } from "@/lib/spaces/types";
import { storageBlock } from "@/lib/storage/availability";
import { connectionAccess } from "@/lib/storage/connections";
import { formatDriveBytes, usageLine } from "@/lib/storage/messages";
import { storageSettings } from "@/lib/storage/settings-view";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { driveUsage } from "@/lib/storage/usage";
import { joinSpace } from "../helpers/actor";
import { type StorageWorld, storageWorld } from "../helpers/storage";

const GiB = 1024 ** 3;

const personalOf = (w: StorageWorld): MySpace => ({ id: w.personal, slug: w.personal, name: "Personal", kind: "personal", role: "admin" });
const teamOf = (id: string, name: string): MySpace => ({ id, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, kind: "team", role: "admin" });
const deps = (w: StorageWorld, over: Partial<Parameters<typeof storageSettings>[3]> = {}) => ({ config: () => w.cfg, mainSa: () => w.mainSa, fetch: w.fake.fetch, ...over });
const setUp = (w: StorageWorld) => makeSetUpStorage({ config: w.cfg, mainSa: () => w.mainSa, fetch: w.fake.fetch });

async function addAsset(db: DB, spaceId: string) {
  await db.insert(assets).values({ id: nanoid(12), spaceId, kind: "video", name: "clip", fileName: "clip.mov", mimeType: "video/quicktime", sizeBytes: 1000, lastModifiedMs: 1, uploadedBy: "u1" });
}

describe("driveUsage", () => {
  it("reads how much of the account's Drive is used, and its limit", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    w.fake.setQuota("ada@gmail.com", { limitBytes: 15 * GiB, usedBytes: Math.round(12.4 * GiB) });
    const source = await connectionAccess(w.db, w.cfg, ada.id, w.fake.fetch);
    expect(await driveUsage(source, w.fake.fetch)).toEqual({ usedBytes: Math.round(12.4 * GiB), limitBytes: 15 * GiB });
    const asked = w.fake.calls.filter((call) => call.path === "/drive/v3/about");
    expect(asked).toHaveLength(1);
    expect(asked[0].method).toBe("GET");
  });

  it("an account with no limit has a null limit", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    w.fake.setQuota("ada@gmail.com", { limitBytes: null, usedBytes: 5 * GiB });
    const source = await connectionAccess(w.db, w.cfg, ada.id, w.fake.fetch);
    expect(await driveUsage(source, w.fake.fetch)).toEqual({ usedBytes: 5 * GiB, limitBytes: null });
  });

  it("is null when anything goes wrong: Google refuses, the network fails, the answer is odd, the token can't be had", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    const source = await connectionAccess(w.db, w.cfg, ada.id, w.fake.fetch);
    w.fake.failNext(/^GET \/drive\/v3\/about/, 500);
    expect(await driveUsage(source, w.fake.fetch)).toBeNull();
    expect(await driveUsage(source, async () => Promise.reject(new TypeError("fetch failed")))).toBeNull();
    expect(await driveUsage(source, async () => Response.json({}))).toBeNull();
    expect(await driveUsage(source, async () => Response.json({ storageQuota: { usage: "lots" } }))).toBeNull();
    expect(await driveUsage(source, async () => new Response("<html>", { status: 200 }))).toBeNull();
    expect(await driveUsage({ token: () => Promise.reject(new Error("no")) }, w.fake.fetch)).toBeNull();
  });
});

describe("usage as people read it", () => {
  it("counts in Google's own units, one decimal at most", () => {
    expect(formatDriveBytes(Math.round(12.4 * GiB))).toBe("12.4 GB");
    expect(formatDriveBytes(15 * GiB)).toBe("15 GB");
    expect(formatDriveBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(formatDriveBytes(1.5 * 1024 ** 4)).toBe("1.5 TB");
    expect(formatDriveBytes(2048)).toBe("2 KB");
    expect(formatDriveBytes(0)).toBe("0 B");
  });

  it("says how much is used of how much", () => {
    expect(usageLine({ usedBytes: Math.round(12.4 * GiB), limitBytes: 15 * GiB })).toBe("12.4 GB of 15 GB used");
    expect(usageLine({ usedBytes: 5 * GiB, limitBytes: null })).toBe("5 GB used");
  });
});

describe("storageBlock", () => {
  it("is null when this server can connect a Google account for the space", () => {
    const w = { cfg: { clientId: "c", clientSecret: "s", tokenKey: new Uint8Array(32), redirectUri: "https://app.test/api/storage/callback", projectId: "p1" } };
    const mainSa = { token: async () => ({ accessToken: "t", expiresAt: 0 }) };
    expect(storageBlock("personal", { config: () => w.cfg, mainSa: () => mainSa })).toBeNull();
    expect(storageBlock("team", { config: () => w.cfg, mainSa: () => mainSa })).toBeNull();
  });

  it("names the server when it has no storage settings, and team storage when teams can't have it here", () => {
    const cfg = { clientId: "c", clientSecret: "s", tokenKey: new Uint8Array(32), redirectUri: "https://app.test/api/storage/callback", projectId: null };
    const mainSa = { token: async () => ({ accessToken: "t", expiresAt: 0 }) };
    expect(storageBlock("personal", { config: () => null, mainSa: () => mainSa })).toBe("server");
    expect(storageBlock("team", { config: () => null, mainSa: () => mainSa })).toBe("server");
    expect(storageBlock("personal", { config: () => cfg, mainSa: () => null })).toBeNull(); // a personal space needs neither
    expect(storageBlock("team", { config: () => cfg, mainSa: () => mainSa })).toBe("team"); // no project for readers
    expect(storageBlock("team", { config: () => ({ ...cfg, projectId: "p1" }), mainSa: () => null })).toBe("team");
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(storageBlock("team", { config: () => ({ ...cfg, projectId: "p1" }), mainSa: () => { throw new Error("bad key"); } })).toBe("team");
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("what the storage settings page shows", () => {
  it("a personal space with none: the person's own connections to choose from", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    await joinSpace(w.db, { id: "u2" }, "editor");
    await w.connect({ userId: "u2", email: "someone-else@gmail.com" }); // someone else's: never shown
    const view = await storageSettings(w.db, personalOf(w), "u1", deps(w));
    expect(view).toEqual({
      space: { id: w.personal, slug: "personal", name: "Personal", kind: "personal" },
      storage: { kind: "none" },
      connections: [{ id: ada.id, email: "ada@gmail.com", broken: false }],
      blocked: null,
    });
  });

  it("Seattle Solvers: its shared drive", async () => {
    const w = await storageWorld();
    const view = await storageSettings(w.db, teamOf(SEED_TEAM_ID, "Seattle Solvers"), "u1", deps(w));
    expect(view.storage).toEqual({ kind: "shared_folder" });
  });

  it("a space in a Google account: whose, its folder, how full it is, and whether it holds uploads", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    await setUp(w)(w.db, { spaceId: w.personal, connectionId: ada.id, byUserId: "u1" });
    w.fake.setQuota("ada@gmail.com", { limitBytes: 15 * GiB, usedBytes: 2 * GiB });
    const view = await storageSettings(w.db, personalOf(w), "u1", deps(w));
    expect(view.storage).toEqual({
      kind: "google_account",
      email: "ada@gmail.com",
      folderName: "EasyEdit – Personal",
      broken: false,
      hasUploads: false,
      usage: { usedBytes: 2 * GiB, limitBytes: 15 * GiB },
      ownedByViewer: true,
      ownerEmail: "u1@gmail.com",
    });
    await addAsset(w.db, w.personal);
    expect((await storageSettings(w.db, personalOf(w), "u1", deps(w))).storage).toMatchObject({ hasUploads: true });
  });

  it("never waits on Google: a usage that fails or takes too long is left out", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    await setUp(w)(w.db, { spaceId: w.personal, connectionId: ada.id, byUserId: "u1" });
    w.fake.failNext(/^GET \/drive\/v3\/about/, 503);
    expect((await storageSettings(w.db, personalOf(w), "u1", deps(w))).storage).toMatchObject({ kind: "google_account", usage: null });
    const slow: typeof fetch = (input, init) =>
      String(input).includes("/drive/v3/about") ? new Promise<Response>(() => {}) : w.fake.fetch(input, init);
    expect((await storageSettings(w.db, personalOf(w), "u1", deps(w, { fetch: slow, usageTimeoutMs: 20 }))).storage).toMatchObject({ usage: null });
  });

  it("a broken connection: no call to Google for its usage", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    await setUp(w)(w.db, { spaceId: w.personal, connectionId: ada.id, byUserId: "u1" });
    await w.db.update(driveConnection).set({ brokenAt: new Date(), brokenReason: "revoked" }).where(eq(driveConnection.id, ada.id));
    const before = w.fake.calls.length;
    const view = await storageSettings(w.db, personalOf(w), "u1", deps(w));
    expect(view.storage).toMatchObject({ kind: "google_account", email: "ada@gmail.com", broken: true, usage: null });
    expect(view.connections).toEqual([{ id: ada.id, email: "ada@gmail.com", broken: true }]);
    expect(w.fake.calls.length).toBe(before);
  });

  it("another admin of the space sees whose connection it is, and that it isn't theirs", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    await joinSpace(w.db, { id: "u2", email: "bea@gmail.com" }, "admin", team);
    const ada = await w.connect({ email: "ada.drive@gmail.com" });
    await setUp(w)(w.db, { spaceId: team, connectionId: ada.id, byUserId: "u1" });
    const forBea = await storageSettings(w.db, teamOf(team, "Robotics Club"), "u2", deps(w));
    expect(forBea.storage).toMatchObject({ kind: "google_account", email: "ada.drive@gmail.com", ownedByViewer: false, ownerEmail: "u1@gmail.com" });
    expect((await storageSettings(w.db, teamOf(team, "Robotics Club"), "u1", deps(w))).storage).toMatchObject({ ownedByViewer: true });
  });

  it("says what stops a new connection here: no settings on this server, or teams can't have storage here", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    expect((await storageSettings(w.db, personalOf(w), "u1", deps(w, { config: () => null }))).blocked).toBe("server");
    expect((await storageSettings(w.db, teamOf(team, "Robotics Club"), "u1", deps(w, { mainSa: () => null }))).blocked).toBe("team");
    expect((await storageSettings(w.db, teamOf(team, "Robotics Club"), "u1", deps(w))).blocked).toBeNull();
  });

  it("with no settings on this server, a space in a Google account still says whose, and asks Google nothing", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    await setUp(w)(w.db, { spaceId: w.personal, connectionId: ada.id, byUserId: "u1" });
    const before = w.fake.calls.length;
    const view = await storageSettings(w.db, personalOf(w), "u1", deps(w, { config: () => null }));
    expect(view.storage).toMatchObject({ kind: "google_account", email: "ada@gmail.com", usage: null });
    expect(view.blocked).toBe("server");
    expect(w.fake.calls.length).toBe(before);
  });
});
