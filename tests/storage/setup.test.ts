import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";
import type { DB } from "@/db";
import { assets, driveConnection, member, spaceStorage } from "@/db/schema";
import { ServiceError } from "@/lib/service-error";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { ConnectionBrokenError, DRIVE_FILE_SCOPE } from "@/lib/storage/google-oauth";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { joinSpace } from "../helpers/actor";
import { type StorageWorld, storageWorld } from "../helpers/storage";

const FOLDER = "application/vnd.google-apps.folder";

const setUpFor = (w: StorageWorld) => makeSetUpStorage({ config: w.cfg, fetch: w.fake.fetch });

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

  it("in a team: the same folder as a personal space, with no reader, no sharing and no Google Cloud call", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const ada = await w.connect({ email: "ada@gmail.com" });
    await setUpFor(w)(w.db, { spaceId: team, connectionId: ada.id, byUserId: "u1" });

    const row = await storageOf(w.db, team);
    expect(row).toMatchObject({ kind: "google_account", connectionId: ada.id, folderName: "EasyEdit – Robotics Club", readerEmail: null, createdBy: "u1" });
    expect(w.fake.files.get(row!.rootFolderId!)).toMatchObject({ name: "EasyEdit – Robotics Club", parents: [], owner: "ada@gmail.com" });
    expect(inside(w, row!.rootFolderId!).map((file) => file.name)).toEqual(["Originals", "Previews"]);
    expect(w.fake.accounts.size).toBe(0);
    expect(w.fake.permissionRequests).toEqual([]);
    expect(w.fake.impersonations).toEqual([]);
    expect(w.fake.calls.some((call) => call.path.startsWith("/v1/"))).toBe(false);
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
    expect(w.fake.accounts.size).toBe(0);
  });

  it("with another account while the space holds no uploads moves it there", async () => {
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
    expect(after).toMatchObject({ connectionId: second.id, readerEmail: null });
    expect(after!.rootFolderId).not.toBe(before!.rootFolderId);
    expect(w.fake.files.get(after!.rootFolderId!)).toMatchObject({ owner: "second@gmail.com", name: "EasyEdit – Robotics Club" });
    expect(w.fake.accounts.size).toBe(0);
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

  it("never replaces Seattle Solvers' shared drive, even with no uploads in it, and asks Google nothing", async () => {
    const w = await storageWorld();
    const ada = await w.connect();
    const before = await storageOf(w.db, SEED_TEAM_ID);
    expect(before).toMatchObject({ kind: "shared_folder" });
    const calls = w.fake.calls.length;
    const error = await setUpFor(w)(w.db, { spaceId: SEED_TEAM_ID, connectionId: ada.id, byUserId: "u1" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual({ code: "STORAGE_IN_USE", status: 409 });
    expect((error as Error).message).toBe("This space already keeps files in Google Drive, so it can't move to another account yet.");
    expect(await storageOf(w.db, SEED_TEAM_ID)).toEqual(before);
    expect(w.fake.calls.length).toBe(calls);
  });

  it("a space whose storage became a shared folder while setting up keeps it", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const first = await w.connect();
    await setUpFor(w)(w.db, { spaceId: team, connectionId: first.id, byUserId: "u1" });
    const second = await w.connect();
    let flipped = false;
    const flipping = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!flipped) {
        flipped = true;
        await w.db.update(spaceStorage).set({ kind: "shared_folder", connectionId: null, rootFolderId: null, folderName: null, readerEmail: null }).where(eq(spaceStorage.spaceId, team));
      }
      return w.fake.fetch(input, init);
    }) as typeof fetch;
    const setUp = makeSetUpStorage({ config: w.cfg, fetch: flipping });
    const error = await setUp(w.db, { spaceId: team, connectionId: second.id, byUserId: "u1" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual({ code: "STORAGE_IN_USE", status: 409 });
    expect(await storageOf(w.db, team)).toMatchObject({ kind: "shared_folder", connectionId: null });
  });

  // A fetch that runs `change` once, before the first call to Google: something that happens while setup talks to Google.
  const changingOnce = (w: StorageWorld, change: () => Promise<unknown>) => {
    let done = false;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!done) {
        done = true;
        await change();
      }
      return w.fake.fetch(input, init);
    }) as typeof fetch;
  };

  it("saves nothing for an admin removed from the team while setting up, and answers as a missing space", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    await joinSpace(w.db, { id: "u2" }, "admin", team);
    const theirs = await w.connect({ userId: "u2" });
    const removing = changingOnce(w, () => w.db.delete(member).where(and(eq(member.organizationId, team), eq(member.userId, "u2"))));
    const setUp = makeSetUpStorage({ config: w.cfg, fetch: removing });
    const error = await setUp(w.db, { spaceId: team, connectionId: theirs.id, byUserId: "u2" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual({ code: "NOT_FOUND", status: 404 });
    expect(await storageOf(w.db, team)).toBeNull();
  });

  it("leaves the team's storage as it was for an admin demoted to editor while setting up", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    await joinSpace(w.db, { id: "u2" }, "admin", team);
    const mine = await w.connect();
    await setUpFor(w)(w.db, { spaceId: team, connectionId: mine.id, byUserId: "u1" });
    const before = await storageOf(w.db, team);
    const theirs = await w.connect({ userId: "u2" });
    const demoting = changingOnce(w, () => joinSpace(w.db, { id: "u2" }, "editor", team));
    const setUp = makeSetUpStorage({ config: w.cfg, fetch: demoting });
    const error = await setUp(w.db, { spaceId: team, connectionId: theirs.id, byUserId: "u2" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual({ code: "NOT_FOUND", status: 404 });
    expect(await storageOf(w.db, team)).toEqual(before);
  });

  it("saves nothing for an admin demoted to editor while setting up a team with no storage yet", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    await joinSpace(w.db, { id: "u2" }, "admin", team);
    const theirs = await w.connect({ userId: "u2" });
    const demoting = changingOnce(w, () => joinSpace(w.db, { id: "u2" }, "editor", team));
    const setUp = makeSetUpStorage({ config: w.cfg, fetch: demoting });
    const error = await setUp(w.db, { spaceId: team, connectionId: theirs.id, byUserId: "u2" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual({ code: "NOT_FOUND", status: 404 });
    expect(await storageOf(w.db, team)).toBeNull();
  });

  it("saves storage for a second admin who stays an admin", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    await joinSpace(w.db, { id: "u2" }, "admin", team);
    const theirs = await w.connect({ userId: "u2", email: "u2drive@gmail.com" });
    await setUpFor(w)(w.db, { spaceId: team, connectionId: theirs.id, byUserId: "u2" });
    expect(await storageOf(w.db, team)).toMatchObject({ kind: "google_account", connectionId: theirs.id, createdBy: "u2" });
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

describe("one Google account per space", () => {
  const ACCOUNT_IN_USE = { code: "ACCOUNT_IN_USE", status: 409 };
  // A fetch that runs `change` once, before the first call to Google.
  const changingOnce = (w: StorageWorld, change: () => Promise<unknown>) => {
    let done = false;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!done) {
        done = true;
        await change();
      }
      return w.fake.fetch(input, init);
    }) as typeof fetch;
  };

  it("refuses a Google account that already backs another space, before any call to Google", async () => {
    const w = await storageWorld();
    const first = await w.team("Robotics Club");
    await setUpFor(w)(w.db, { spaceId: first, connectionId: (await w.connect({ googleSub: "g1" })).id, byUserId: "u1" });
    const second = await w.team("Chess Club", "u2");
    const theirs = await w.connect({ userId: "u2", googleSub: "g1" }); // another EasyEdit person, the same Google account
    const calls = w.fake.calls.length;
    const error = await setUpFor(w)(w.db, { spaceId: second, connectionId: theirs.id, byUserId: "u2" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual(ACCOUNT_IN_USE);
    expect((error as Error).message).toBe("That Google account already holds another EasyEdit space's storage. Choose a different Google account.");
    expect(w.fake.calls.length).toBe(calls);
    expect(await storageOf(w.db, second)).toBeNull();
  });

  it("counts a personal space too", async () => {
    const w = await storageWorld();
    const mine = await w.connect({ googleSub: "g1" });
    await setUpFor(w)(w.db, { spaceId: w.personal, connectionId: mine.id, byUserId: "u1" });
    const team = await w.team("Robotics Club");
    const error = await setUpFor(w)(w.db, { spaceId: team, connectionId: mine.id, byUserId: "u1" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual(ACCOUNT_IN_USE);
  });

  it("lets a space reconnect with the Google account it already uses, through any of its admins", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    await joinSpace(w.db, { id: "u2" }, "admin", team);
    await setUpFor(w)(w.db, { spaceId: team, connectionId: (await w.connect({ googleSub: "g1" })).id, byUserId: "u1" });
    const again = await w.connect({ userId: "u2", googleSub: "g1" });
    await setUpFor(w)(w.db, { spaceId: team, connectionId: again.id, byUserId: "u2" });
    expect(await storageOf(w.db, team)).toMatchObject({ connectionId: again.id, googleSub: "g1" });
  });

  it("saves the Google account's id with the storage", async () => {
    const w = await storageWorld();
    const ada = await w.connect({ googleSub: "g-ada" });
    await setUpFor(w)(w.db, { spaceId: w.personal, connectionId: ada.id, byUserId: "u1" });
    expect(await storageOf(w.db, w.personal)).toMatchObject({ googleSub: "g-ada" });
  });

  it("two spaces racing for one Google account: the second gets ACCOUNT_IN_USE, not a database error", async () => {
    const w = await storageWorld();
    const team = await w.team("Robotics Club");
    const other = await w.team("Chess Club");
    const ada = await w.connect({ googleSub: "g1" });
    const otherConnection = await w.connect({ googleSub: "g-other" });
    // While this setup talks to Google, another space takes the same account.
    const racing = changingOnce(w, () =>
      w.db.insert(spaceStorage).values({ spaceId: other, kind: "google_account", connectionId: otherConnection.id, rootFolderId: "r-other", googleSub: "g1", createdBy: "u1" }),
    );
    const setUp = makeSetUpStorage({ config: w.cfg, fetch: racing });
    const error = await setUp(w.db, { spaceId: team, connectionId: ada.id, byUserId: "u1" }).catch((e: unknown) => e);
    expect(refusal(error)).toEqual(ACCOUNT_IN_USE);
    expect(await storageOf(w.db, team)).toBeNull();
  });
});
