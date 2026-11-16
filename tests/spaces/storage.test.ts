import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { driveConnection, spaceStorage } from "@/db/schema";
import { getDrive } from "@/lib/drive";
import { sharedFolderClient } from "@/lib/drive/client";
import { SCOPE_READ } from "@/lib/drive/token";
import { readerFor, storageFor, storageState, type StorageDeps } from "@/lib/spaces/storage";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { ConnectionBrokenError, DRIVE_FILE_SCOPE } from "@/lib/storage/google-oauth";
import { forgetAllSources } from "@/lib/storage/token-cache";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { type StorageWorld, storageWorld } from "../helpers/storage";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (globalThis as { __easyEditDrive?: unknown }).__easyEditDrive;
  delete (globalThis as { __easyEditMainSa?: unknown }).__easyEditMainSa;
});

// What the server would use, pointed at the pretend Google.
const depsOf = (w: StorageWorld, over: StorageDeps = {}): StorageDeps => ({
  config: () => w.cfg,
  sharedFolder: () => sharedFolderClient(w.fake.config, { fetch: w.fake.fetch, now: w.fake.now }),
  fetch: w.fake.fetch,
  ...over,
});

// A space with storage in a person's Drive: its row and the connection's email.
async function withStorage(w: StorageWorld, spaceId: string) {
  const connection = await w.connect();
  await makeSetUpStorage({ config: w.cfg, fetch: w.fake.fetch })(w.db, { spaceId, connectionId: connection.id, byUserId: "u1" });
  const [row] = await w.db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, spaceId));
  return { row, connection };
}

const holderOf = async (w: StorageWorld, source: { token(): Promise<{ accessToken: string }> }) => w.fake.whoHas((await source.token()).accessToken);

function stubSharedFolderSettings(w: StorageWorld) {
  const key = { type: "service_account", client_email: w.fake.config.clientEmail, private_key: w.fake.config.privateKey };
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", Buffer.from(JSON.stringify(key)).toString("base64"));
  vi.stubEnv("DRIVE_FOLDER_ID", "folder1");
}

describe("a connection broken by a wrong storage key", () => {
  const wrongKey = (w: StorageWorld): StorageDeps => ({ config: () => ({ ...w.cfg, tokenKey: randomBytes(32) }) });

  it.each(["personal", "team"] as const)("in a %s space: broken while the key is wrong, mended and working once the right key is back", async (kind) => {
    const w = await storageWorld();
    const spaceId = kind === "personal" ? w.personal : await w.team("Robotics Club");
    const { connection } = await withStorage(w, spaceId);
    const bad = depsOf(w, wrongKey(w));
    forgetAllSources();
    // The wrong key: the first upload attempt finds the token won't open and marks the connection broken.
    const wrongClient = await storageFor(w.db, spaceId, bad);
    await expect(wrongClient!.folderId("Originals")).rejects.toBeInstanceOf(ConnectionBrokenError);
    expect((await w.db.select().from(driveConnection).where(eq(driveConnection.id, connection.id)))[0].brokenReason).toBe("key");
    expect(await storageState(w.db, spaceId, bad)).toEqual({ ready: false, reason: "broken" });
    await expect(storageFor(w.db, spaceId, bad)).rejects.toBeInstanceOf(ConnectionBrokenError);

    // The right key is back: the same calls heal it, with no reconnecting.
    expect(await storageState(w.db, spaceId, depsOf(w))).toEqual({ ready: true });
    expect((await w.db.select().from(driveConnection).where(eq(driveConnection.id, connection.id)))[0]).toMatchObject({ brokenAt: null, brokenReason: null });
    const client = await storageFor(w.db, spaceId, depsOf(w));
    expect(await client!.folderId("Originals")).toEqual(expect.any(String));
  });

  it("a connection Google revoked is not mended by the right key", async () => {
    const w = await storageWorld();
    const { connection } = await withStorage(w, w.personal);
    await w.db.update(driveConnection).set({ brokenAt: new Date(), brokenReason: "revoked" }).where(eq(driveConnection.id, connection.id));
    expect(await storageState(w.db, w.personal, depsOf(w))).toEqual({ ready: false, reason: "broken" });
    await expect(storageFor(w.db, w.personal, depsOf(w))).rejects.toBeInstanceOf(ConnectionBrokenError);
  });
});

describe("storageState", () => {
  it("is ready for Seattle Solvers' shared folder when its settings are there, without a Drive call", async () => {
    const w = await storageWorld();
    stubSharedFolderSettings(w);
    expect(await storageState(w.db, SEED_TEAM_ID)).toEqual({ ready: true });
    expect(w.fake.calls).toEqual([]);
  });

  it("is not_configured for the shared folder with no settings, or a key that can't be read (one line, no key)", async () => {
    const w = await storageWorld();
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "");
    vi.stubEnv("DRIVE_FOLDER_ID", "");
    expect(await storageState(w.db, SEED_TEAM_ID)).toEqual({ ready: false, reason: "not_configured" });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", '{"type":"service_account"}'); // the JSON itself, not base64
    vi.stubEnv("DRIVE_FOLDER_ID", "folder1");
    expect(await storageState(w.db, SEED_TEAM_ID)).toEqual({ ready: false, reason: "not_configured" });
    expect(log.mock.calls).toEqual([["Drive settings could not be read"]]);
  });

  it("is none for a space without storage, and for one that doesn't exist", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    for (const spaceId of [w.personal, team, "team_nowhere"]) expect(await storageState(w.db, spaceId, depsOf(w))).toEqual({ ready: false, reason: "none" });
  });

  it("is ready for a person's Drive, broken once the connection is, and not_configured without the OAuth settings", async () => {
    const w = await storageWorld();
    const { connection } = await withStorage(w, w.personal);
    const calls = w.fake.calls.length;
    expect(await storageState(w.db, w.personal, depsOf(w))).toEqual({ ready: true });
    expect(await storageState(w.db, w.personal, depsOf(w, { config: () => null }))).toEqual({ ready: false, reason: "not_configured" });

    await w.db.update(driveConnection).set({ brokenAt: new Date(), brokenReason: "revoked" }).where(eq(driveConnection.id, connection.id));
    expect(await storageState(w.db, w.personal, depsOf(w))).toEqual({ ready: false, reason: "broken" });
    expect(w.fake.calls.length).toBe(calls); // no Drive call
  });

  it("is ready for a team's Drive, like a person's", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    await withStorage(w, team);
    expect(await storageState(w.db, team, depsOf(w))).toEqual({ ready: true });
  });
});

describe("storageFor", () => {
  it("is null for a space without storage; a broken connection throws its ConnectionBrokenError, without asking Google", async () => {
    const w = await storageWorld();
    expect(await storageFor(w.db, w.personal, depsOf(w))).toBeNull();
    const team = await w.team("Robotics Club");
    const { connection } = await withStorage(w, team);
    await w.db.update(driveConnection).set({ brokenAt: new Date(), brokenReason: "revoked" }).where(eq(driveConnection.id, connection.id));
    const calls = w.fake.calls.length;
    await expect(storageFor(w.db, team, depsOf(w))).rejects.toMatchObject({ name: "ConnectionBrokenError", reason: "revoked" });
    expect(w.fake.calls.length).toBe(calls);
  });

  it("is the shared folder's client for Seattle Solvers", async () => {
    const w = await storageWorld();
    const shared = sharedFolderClient(w.fake.config, { fetch: w.fake.fetch });
    expect(await storageFor(w.db, SEED_TEAM_ID, depsOf(w, { sharedFolder: () => shared }))).toBe(shared);
    stubSharedFolderSettings(w);
    expect(await storageFor(w.db, SEED_TEAM_ID)).toBe(getDrive()); // the server's own, by default
  });

  it("in a personal space: writes and reads with the owner's connection, in the folder setting up made", async () => {
    const w = await storageWorld();
    const { row, connection } = await withStorage(w, w.personal);
    const drive = (await storageFor(w.db, w.personal, depsOf(w)))!;
    expect(drive.rootFolderId).toBe(row.rootFolderId);
    const made = w.fake.files.size;
    const originals = await drive.folderId("Originals");
    expect(w.fake.files.get(originals)).toMatchObject({ name: "Originals", parents: [row.rootFolderId] });
    expect(w.fake.files.size).toBe(made); // found, not made again
    expect(w.fake.whoHas((await drive.readToken(300)).accessToken)).toEqual({ email: connection.email, scope: DRIVE_FILE_SCOPE });
    expect(w.fake.calls.filter((call) => call.path.startsWith("/drive/")).every((call) => call.scope === DRIVE_FILE_SCOPE)).toBe(true);
  });

  it("in a team: writes and reads with the team's connection, with no reader account", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const { row, connection } = await withStorage(w, team);
    const drive = (await storageFor(w.db, team, depsOf(w)))!;
    const previews = await drive.folderId("Previews");
    expect(w.fake.files.get(previews)).toMatchObject({ name: "Previews", parents: [row.rootFolderId], owner: connection.email });
    expect(w.fake.whoHas((await drive.readToken(300)).accessToken)).toEqual({ email: connection.email, scope: DRIVE_FILE_SCOPE });
    expect(w.fake.impersonations).toEqual([]);
    expect(w.fake.accounts.size).toBe(0);
  });
});

describe("readerFor", () => {
  it("is Seattle Solvers' read-only main service account token, or the space's own connection", async () => {
    const w = await storageWorld();
    expect(await holderOf(w, (await readerFor(w.db, SEED_TEAM_ID, depsOf(w)))!)).toEqual({ email: w.fake.config.clientEmail, scope: SCOPE_READ });

    const { connection } = await withStorage(w, w.personal);
    expect(await holderOf(w, (await readerFor(w.db, w.personal, depsOf(w)))!)).toEqual({ email: connection.email, scope: DRIVE_FILE_SCOPE });

    const team = await w.team("Robotics Club");
    const teams = await withStorage(w, team);
    expect(await holderOf(w, (await readerFor(w.db, team, depsOf(w)))!)).toEqual({ email: teams.connection.email, scope: DRIVE_FILE_SCOPE });
    expect(w.fake.impersonations).toEqual([]);
  });

  it("is null for a space without storage, and the connection's own token for a team", async () => {
    const w = await storageWorld();
    const other = await w.team("Other Team");
    expect(await readerFor(w.db, other, depsOf(w))).toBeNull();
    const team = await w.team("Robotics Club");
    const { connection } = await withStorage(w, team);
    expect(await holderOf(w, (await readerFor(w.db, team, depsOf(w)))!)).toEqual({ email: connection.email, scope: DRIVE_FILE_SCOPE });
  });

  it("a team or personal space whose connection broke asks for a reconnect, for reads and writes alike", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const { connection } = await withStorage(w, team);
    await w.db.update(driveConnection).set({ brokenAt: new Date(), brokenReason: "expired" }).where(eq(driveConnection.id, connection.id));
    await expect(readerFor(w.db, team, depsOf(w))).rejects.toMatchObject({ name: "ConnectionBrokenError", reason: "expired" });
    await expect(storageFor(w.db, team, depsOf(w))).rejects.toMatchObject({ name: "ConnectionBrokenError", reason: "expired" });
    expect(await storageState(w.db, team, depsOf(w))).toEqual({ ready: false, reason: "broken" });

    const own = await withStorage(w, w.personal);
    await w.db.update(driveConnection).set({ brokenAt: new Date(), brokenReason: "revoked" }).where(eq(driveConnection.id, own.connection.id));
    await expect(readerFor(w.db, w.personal, depsOf(w))).rejects.toMatchObject({ name: "ConnectionBrokenError", reason: "revoked" });
  });
});
