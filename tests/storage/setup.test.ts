import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { assets, driveConnection, spaceStorage } from "@/db/schema";
import { readerAccountId } from "@/lib/drive/reader";
import { ServiceError } from "@/lib/service-error";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { ConnectionBrokenError, DRIVE_FILE_SCOPE } from "@/lib/storage/google-oauth";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { joinSpace } from "../helpers/actor";
import { type StorageWorld, storageWorld } from "../helpers/storage";

const FOLDER = "application/vnd.google-apps.folder";

const setUpFor = (w: StorageWorld, over: { mainSa?: StorageWorld["mainSa"] | null; projectId?: string | null } = {}) =>
  makeSetUpStorage({
    config: { ...w.cfg, ...(over.projectId === undefined ? {} : { projectId: over.projectId }) },
    mainSa: () => (over.mainSa === undefined ? w.mainSa : over.mainSa),
    fetch: w.fake.fetch,
  });

const storageOf = async (db: DB, spaceId: string) => (await db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, spaceId)))[0] ?? null;

// The folders the app made inside `folderId`, by name.
const inside = (w: StorageWorld, folderId: string) =>
  [...w.fake.files.values()]
    .filter((file) => file.parents.includes(folderId))
    .map((file) => ({ name: file.name, mimeType: file.mimeType, owner: file.owner }))
    .sort((a, b) => a.name.localeCompare(b.name));

async function addAsset(db: DB, spaceId: string, over: Partial<typeof assets.$inferInsert> = {}) {
  await db.insert(assets).values({
    id: nanoid(12), spaceId, kind: "video", name: "clip", fileName: "clip.mov", mimeType: "video/quicktime", sizeBytes: 1000, lastModifiedMs: 1, uploadedBy: "u1", ...over,
  });
}

const refusal = (error: unknown) => (error instanceof ServiceError ? { code: error.code, status: error.status } : error);

describe("setting up storage", () => {
  it("in a personal space: a folder at the top of the person's Drive with Originals and Previews, and no reader", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ email: "ada@gmail.com" });
    await setUpFor(w)(w.db, { spaceId: w.personal, connectionId: ada.id, byUserId: "u1" });

    const row = await storageOf(w.db, w.personal);
    expect(row).toMatchObject({ kind: "google_account", connectionId: ada.id, folderName: "EasyEdit – Personal", readerEmail: null, createdBy: "u1" });
    const root = w.fake.files.get(row!.rootFolderId!);
    expect(root).toMatchObject({ name: "EasyEdit – Personal", parents: [], mimeType: FOLDER, owner: "ada@gmail.com", trashed: false });
    expect(inside(w, row!.rootFolderId!)).toEqual([
      { name: "Originals", mimeType: FOLDER, owner: "ada@gmail.com" },
      { name: "Previews", mimeType: FOLDER, owner: "ada@gmail.com" },
    ]);
    // Only the person's drive.file token was used: no reader, no sharing, no IAM.
    expect(w.fake.accounts.size).toBe(0);
    expect(w.fake.permissionRequests).toEqual([]);
    expect(w.fake.impersonations).toEqual([]);
    const driveCalls = w.fake.calls.filter((call) => call.path.startsWith("/drive/"));
    expect(driveCalls.length).toBeGreaterThan(0);
    for (const call of driveCalls) expect(call.scope).toBe(DRIVE_FILE_SCOPE);
    expect(w.fake.calls.some((call) => call.path.startsWith("/v1/"))).toBe(false);
  });

  it("in a personal space needs no main service account", async () => {
    const w = await storageWorld();
    const ada = await w.connect();
    await setUpFor(w, { mainSa: null, projectId: null })(w.db, { spaceId: w.personal, connectionId: ada.id, byUserId: "u1" });
    expect(await storageOf(w.db, w.personal)).toMatchObject({ kind: "google_account", connectionId: ada.id });
  });

  it("in a team: makes one reader and shares the folder with it, read-only and without an email", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const ada = await w.connect({ email: "ada@gmail.com" });
    await setUpFor(w)(w.db, { spaceId: team, connectionId: ada.id, byUserId: "u1" });

    const reader = `${readerAccountId(team)}@${w.fake.projectId}.iam.gserviceaccount.com`;
    const row = await storageOf(w.db, team);
    expect(row).toMatchObject({ kind: "google_account", connectionId: ada.id, folderName: "EasyEdit – Robotics Club", readerEmail: reader, createdBy: "u1" });
    const rootId = row!.rootFolderId!;
    expect(w.fake.files.get(rootId)).toMatchObject({ name: "EasyEdit – Robotics Club", parents: [], owner: "ada@gmail.com" });
    expect(inside(w, rootId).map((file) => file.name)).toEqual(["Originals", "Previews"]);
    expect([...w.fake.accounts.keys()]).toEqual([reader]);
    expect(w.fake.shares.get(rootId)).toEqual(new Map([[reader, "reader"]])); // the reader only: never the main service account
    expect(w.fake.permissionRequests).toHaveLength(1);
    expect(w.fake.permissionRequests[0].query.sendNotificationEmail).toBe("false");
  });

  it("again with the same connection (a reconnect) keeps the storage as it is", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const ada = await w.connect();
    const setUp = setUpFor(w);
    await setUp(w.db, { spaceId: team, connectionId: ada.id, byUserId: "u1" });
    const before = await storageOf(w.db, team);
    await addAsset(w.db, team); // uploads don't stop a reconnect
    const files = w.fake.files.size;
    await setUp(w.db, { spaceId: team, connectionId: ada.id, byUserId: "u1" });
    expect(await storageOf(w.db, team)).toEqual(before);
    expect(w.fake.files.size).toBe(files);
    expect(w.fake.accounts.size).toBe(1);
  });

  it("with another account while the space holds no uploads moves it there, with the same reader", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const first = await w.connect({ email: "first@gmail.com" });
    const second = await w.connect({ email: "second@gmail.com" });
    const setUp = setUpFor(w);
    await setUp(w.db, { spaceId: team, connectionId: first.id, byUserId: "u1" });
    const before = await storageOf(w.db, team);
    await addAsset(w.db, team, { removedAt: new Date() }); // a removed upload doesn't count
    await setUp(w.db, { spaceId: team, connectionId: second.id, byUserId: "u1" });

    const after = await storageOf(w.db, team);
    expect(after).toMatchObject({ connectionId: second.id, readerEmail: before!.readerEmail });
    expect(after!.rootFolderId).not.toBe(before!.rootFolderId);
    expect(w.fake.files.get(after!.rootFolderId!)).toMatchObject({ owner: "second@gmail.com", name: "EasyEdit – Robotics Club" });
    expect(w.fake.accounts.size).toBe(1);
    expect(w.fake.shares.get(after!.rootFolderId!)?.get(before!.readerEmail!)).toBe("reader");
  });

  it("in a team with no main service account or no project: answers TEAM_STORAGE_NOT_CONFIGURED and writes nothing", async () => {
    for (const over of [{ mainSa: null }, { projectId: null }]) {
      const w = await storageWorld();
      const team = await w.team("Robotics Club");
      const ada = await w.connect();
      const error = await setUpFor(w, over)(w.db, { spaceId: team, connectionId: ada.id, byUserId: "u1" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ServiceError);
      expect(refusal(error)).toEqual({ code: "TEAM_STORAGE_NOT_CONFIGURED", status: 409 });
      expect(await storageOf(w.db, team)).toBeNull();
      expect(w.fake.calls).toEqual([]); // no folder made, no reader
      expect(w.fake.files.size).toBe(1); // only the shared drive's folder the fake starts with
    }
  });

  it("in a team when the service account key is set but can't be read: TEAM_STORAGE_NOT_CONFIGURED, one line, nothing written", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const ada = await w.connect();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const unreadable = () => {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not a service account key.");
    };
    const error = await makeSetUpStorage({ config: w.cfg, mainSa: unreadable, fetch: w.fake.fetch })(w.db, { spaceId: team, connectionId: ada.id, byUserId: "u1" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual({ code: "TEAM_STORAGE_NOT_CONFIGURED", status: 409 });
    expect(log.mock.calls).toEqual([["Drive settings could not be read"]]);
    expect(await storageOf(w.db, team)).toBeNull();
    expect(w.fake.calls).toEqual([]);
    log.mockRestore();
  });

  it("for a space that already holds uploads: answers STORAGE_IN_USE and changes nothing", async () => {
    const w = await storageWorld();
    const ada = await w.connect();
    await addAsset(w.db, SEED_TEAM_ID, { status: "uploading" });
    const before = await storageOf(w.db, SEED_TEAM_ID);
    expect(before).toMatchObject({ kind: "shared_folder" });
    const error = await setUpFor(w)(w.db, { spaceId: SEED_TEAM_ID, connectionId: ada.id, byUserId: "u1" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual({ code: "STORAGE_IN_USE", status: 409 });
    expect(await storageOf(w.db, SEED_TEAM_ID)).toEqual(before);
    expect(w.fake.calls).toEqual([]);

    // A personal space with storage and one upload, set up with another account.
    const first = await w.connect();
    const second = await w.connect();
    await setUpFor(w)(w.db, { spaceId: w.personal, connectionId: first.id, byUserId: "u1" });
    await addAsset(w.db, w.personal, { status: "ready" });
    const personalBefore = await storageOf(w.db, w.personal);
    const again = await setUpFor(w)(w.db, { spaceId: w.personal, connectionId: second.id, byUserId: "u1" }).catch((e: unknown) => e);
    expect(refusal(again)).toEqual({ code: "STORAGE_IN_USE", status: 409 });
    expect(await storageOf(w.db, w.personal)).toEqual(personalBefore);
  });

  it("refuses, as a missing space, someone who isn't the space's admin or a connection that isn't theirs", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    await joinSpace(w.db, { id: "u2" }, "editor", team);
    const theirs = await w.connect({ userId: "u2" });
    const mine = await w.connect();
    const setUp = setUpFor(w);
    for (const input of [
      { spaceId: team, connectionId: theirs.id, byUserId: "u2" }, // an editor
      { spaceId: team, connectionId: theirs.id, byUserId: "u1" }, // someone else's connection
      { spaceId: "team_nowhere", connectionId: mine.id, byUserId: "u1" },
      { spaceId: team, connectionId: "dc_nowhere", byUserId: "u1" },
    ]) {
      const error = await setUp(w.db, input).catch((e: unknown) => e);
      expect(refusal(error), JSON.stringify(input)).toEqual({ code: "NOT_FOUND", status: 404 });
    }
    expect(await storageOf(w.db, team)).toBeNull();
    expect(w.fake.calls).toEqual([]);
  });

  it("with a connection Google has revoked: marks it broken with the reason, and makes no storage", async () => {
    const w = await storageWorld();
    const ada = await w.connect();
    w.fake.revoke(ada.refreshToken);
    const error = await setUpFor(w)(w.db, { spaceId: w.personal, connectionId: ada.id, byUserId: "u1" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionBrokenError);
    const [row] = await w.db.select().from(driveConnection).where(eq(driveConnection.id, ada.id));
    expect(row.brokenAt).toBeInstanceOf(Date);
    expect(row.brokenReason).toBe("revoked");
    expect(await storageOf(w.db, w.personal)).toBeNull();
  });
});
