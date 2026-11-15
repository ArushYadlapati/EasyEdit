import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDriveClient } from "@/lib/drive/client";
import { createReader, deleteReader, readerAccountId, shareFolderWith } from "@/lib/drive/reader";
import { type AccessSource, SCOPE_CLOUD, SCOPE_READ, SCOPE_WRITE, connectionSource, impersonatedSource, serviceAccountSource } from "@/lib/drive/token";
import { driveFileUrl } from "@/lib/media/read-tokens";
import type { StorageConfig } from "@/lib/storage/config";
import { refreshAccess } from "@/lib/storage/google-oauth";
import { type FakeDrive, makeFakeDrive, piece } from "../helpers/fake-drive";

const PROJECT = "easyedit-test";
const MiB = 1024 * 1024;
const oauth: StorageConfig = { clientId: "client-1", clientSecret: "shh", tokenKey: randomBytes(32), redirectUri: "https://app.test/api/storage/callback", projectId: PROJECT };
const noWait = async () => {};

const mainSa = (fake: FakeDrive, scope = SCOPE_CLOUD) => serviceAccountSource({ clientEmail: fake.config.clientEmail, privateKey: fake.config.privateKey, scope, fetch: fake.fetch, now: fake.now });
// A person's Drive, reached with their connection: they can change what the app made there.
function personalDrive(fake: FakeDrive, email: string) {
  const { refreshToken } = fake.connect({ email });
  const access = connectionSource({ refresh: () => refreshAccess(oauth, refreshToken, fake.fetch), now: fake.now });
  return { access, drive: (rootFolderId: string, read: AccessSource = access) => createDriveClient({ rootFolderId, write: access, read, fetch: fake.fetch }) };
}
// A folder made at the top of a person's Drive, as setting up storage does.
async function topFolder(fake: FakeDrive, access: AccessSource, name: string): Promise<string> {
  const answer = await fake.fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${(await access.token()).accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder" }),
  });
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { id: string }).id;
}
const readWith = async (fake: FakeDrive, source: AccessSource, fileId: string) =>
  fake.fetch(driveFileUrl(fileId), { headers: { Authorization: `Bearer ${(await source.token()).accessToken}` } });

describe("a team's reader", () => {
  it("has an account id made from the space id: ee-r- and ten base36 characters", () => {
    const id = readerAccountId("team_robotics");
    expect(id).toMatch(/^ee-r-[0-9a-z]{10}$/);
    expect(id).toMatch(/^[a-z]([-a-z0-9]*[a-z0-9])$/);
    expect(readerAccountId("team_robotics")).toBe(id);
    expect(readerAccountId("team_chess")).not.toBe(id);
    const digest = createHash("sha256").update("team_robotics").digest();
    expect(id.slice(5)).toBe((digest.readBigUInt64BE(0) % BigInt(36 ** 10)).toString(36).padStart(10, "0"));
  });

  it("is made in the project by the app's service account", async () => {
    const fake = makeFakeDrive();
    const { email } = await createReader({ caller: mainSa(fake), projectId: PROJECT, spaceId: "team_robotics", fetch: fake.fetch });
    expect(email).toBe(`${readerAccountId("team_robotics")}@${PROJECT}.iam.gserviceaccount.com`);
    expect([...fake.accounts.keys()]).toEqual([email]);
    expect(fake.accounts.get(email)).toEqual({ accountId: readerAccountId("team_robotics"), displayName: "EasyEdit reader team_robotics" });
    expect(fake.calls.at(-1)).toEqual({ method: "POST", path: `/v1/projects/${PROJECT}/serviceAccounts`, scope: SCOPE_CLOUD, origin: null });
  });

  it("is made once: a second call finds it already there and gives the same address", async () => {
    const fake = makeFakeDrive();
    const first = await createReader({ caller: mainSa(fake), projectId: PROJECT, spaceId: "team_robotics", fetch: fake.fetch });
    const again = await createReader({ caller: mainSa(fake), projectId: PROJECT, spaceId: "team_robotics", fetch: fake.fetch });
    expect(again).toEqual(first);
    expect(fake.accounts.size).toBe(1);
    expect(fake.calls.filter((call) => call.path.endsWith("/serviceAccounts")).length).toBe(2);
  });

  it("is not made for any other caller, and the failure says only the call, status and code", async () => {
    const fake = makeFakeDrive();
    await expect(createReader({ caller: mainSa(fake, SCOPE_WRITE), projectId: PROJECT, spaceId: "s", fetch: fake.fetch })).rejects.toMatchObject({ name: "DriveError", call: "reader", status: 403, reason: "PERMISSION_DENIED" });
    await expect(createReader({ caller: mainSa(fake), projectId: "someone-elses", spaceId: "s", fetch: fake.fetch })).rejects.toMatchObject({ call: "reader", status: 403 });
    expect(fake.accounts.size).toBe(0);
  });

  it("is deleted, and deleting one that is gone is fine", async () => {
    const fake = makeFakeDrive();
    const { email } = await createReader({ caller: mainSa(fake), projectId: PROJECT, spaceId: "team_robotics", fetch: fake.fetch });
    const reader = impersonatedSource({ caller: mainSa(fake), targetEmail: email, scope: SCOPE_READ, fetch: fake.fetch, now: fake.now, sleep: noWait });
    const before = await reader.token();
    await deleteReader({ caller: mainSa(fake), projectId: PROJECT, email, fetch: fake.fetch });
    expect(fake.accounts.size).toBe(0);
    await deleteReader({ caller: mainSa(fake), projectId: PROJECT, email, fetch: fake.fetch });
    expect(fake.calls.at(-1)).toEqual({ method: "DELETE", path: `/v1/projects/${PROJECT}/serviceAccounts/${email}`, scope: SCOPE_CLOUD, origin: null });
    // Its tokens stop working, and no new one is given.
    expect(fake.whoHas(before.accessToken)).toBeNull();
    await expect(impersonatedSource({ caller: mainSa(fake), targetEmail: email, scope: SCOPE_READ, fetch: fake.fetch, sleep: noWait }).token()).rejects.toMatchObject({ status: 404 });
    await expect(deleteReader({ caller: mainSa(fake, SCOPE_WRITE), projectId: PROJECT, email, fetch: fake.fetch })).rejects.toMatchObject({ call: "reader", status: 403 });
  });
});

describe("sharing a folder with a reader", () => {
  it("adds one reader permission, without an email, on the folder", async () => {
    const fake = makeFakeDrive();
    const { access } = personalDrive(fake, "ada@gmail.com");
    const folder = await topFolder(fake, access, "EasyEdit – Robotics");
    const { email } = await createReader({ caller: mainSa(fake), projectId: PROJECT, spaceId: "team_robotics", fetch: fake.fetch });
    await shareFolderWith({ write: access, fetch: fake.fetch }, folder, email);
    expect(fake.shares.get(folder)).toEqual(new Map([[email, "reader"]]));
    expect(fake.permissionRequests).toEqual([{ fileId: folder, query: { supportsAllDrives: "true", sendNotificationEmail: "false" }, body: { role: "reader", type: "user", emailAddress: email } }]);
    await shareFolderWith({ write: access, fetch: fake.fetch }, folder, email); // twice is the same permission
    expect(fake.shares.get(folder)).toEqual(new Map([[email, "reader"]]));
  });

  it("tries again while a reader that was only just made is not known yet, then gives up", async () => {
    const fake = makeFakeDrive();
    const { access } = personalDrive(fake, "ada@gmail.com");
    const folder = await topFolder(fake, access, "EasyEdit – Robotics");
    const { email } = await createReader({ caller: mainSa(fake), projectId: PROJECT, spaceId: "team_robotics", fetch: fake.fetch });
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    fake.failNext(/permissions/, 400, "invalidSharingRequest");
    fake.failNext(/permissions/, 404, "notFound");
    await shareFolderWith({ write: access, fetch: fake.fetch, sleep }, folder, email);
    expect(waits).toHaveLength(2);
    expect(fake.shares.get(folder)?.get(email)).toBe("reader");
    // An address Google knows no account for is the same answer, every time.
    await expect(shareFolderWith({ write: access, fetch: fake.fetch, sleep: noWait }, folder, "ee-r-nobody0000@easyedit-test.iam.gserviceaccount.com")).rejects.toMatchObject({ name: "DriveError", call: "share", status: 400, reason: "invalidSharingRequest" });
  });

  it("is refused on a folder the connection cannot change", async () => {
    const fake = makeFakeDrive();
    const ada = personalDrive(fake, "ada@gmail.com");
    const grace = personalDrive(fake, "grace@gmail.com");
    const folder = await topFolder(fake, ada.access, "EasyEdit – Robotics");
    const reader = fake.addServiceAccount("ee-r-abcdefghij");
    await expect(shareFolderWith({ write: grace.access, fetch: fake.fetch, sleep: noWait }, folder, reader)).rejects.toMatchObject({ call: "share", status: 404 });
    expect(fake.shares.get(folder)).toBeUndefined();
  });
});

describe("what each token can see", () => {
  it("a reader token can read a file in a folder shared with it and can't read one in a folder that isn't", async () => {
    const fake = makeFakeDrive();
    const { access, drive } = personalDrive(fake, "ada@gmail.com");
    const shared = await topFolder(fake, access, "EasyEdit – Robotics");
    const notShared = await topFolder(fake, access, "EasyEdit – Chess");
    const { email } = await createReader({ caller: mainSa(fake), projectId: PROJECT, spaceId: "team_robotics", fetch: fake.fetch });
    await shareFolderWith({ write: access, fetch: fake.fetch }, shared, email);
    const reader = impersonatedSource({ caller: mainSa(fake), targetEmail: email, scope: SCOPE_READ, fetch: fake.fetch, now: fake.now });

    // An upload into each folder, by the team's client: writes with the connection, reads with the reader.
    async function upload(rootFolderId: string) {
      const client = drive(rootFolderId, reader);
      const id = await client.newFileId();
      const url = await client.openUploadSession({ id, name: "clip.mp4", parentId: await client.folderId("Originals"), mimeType: "video/mp4", sizeBytes: MiB, origin: "https://app.test" });
      await piece(fake, url, 0, MiB, MiB);
      expect(await client.uploadOffset(url, MiB)).toEqual({ done: true, offset: MiB, fileId: id });
      return { client, id };
    }
    const inShared = await upload(shared);
    const inOther = await upload(notShared);

    const answer = await readWith(fake, reader, inShared.id);
    expect(answer.status).toBe(200);
    expect((await answer.arrayBuffer()).byteLength).toBe(MiB);
    expect((await readWith(fake, reader, inOther.id)).status).toBe(404);
    // The client hands out the reader's token, and that token can only read.
    const handedOut = await inShared.client.readToken(600);
    expect(fake.whoHas(handedOut.accessToken)).toEqual({ email, scope: SCOPE_READ });
    const trash = await fake.fetch(`https://www.googleapis.com/drive/v3/files/${inShared.id}?supportsAllDrives=true`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${handedOut.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
    });
    expect(trash.status).toBe(403);
  });

  it("a person's connection sees what the app made with it, nothing of anyone else's and nothing of the shared drive", async () => {
    const fake = makeFakeDrive();
    fake.files.set("shared-clip", { name: "shared-clip", parents: ["folder1"], sizeBytes: 10, mimeType: "video/mp4", trashed: false });
    const ada = personalDrive(fake, "ada@gmail.com");
    const grace = personalDrive(fake, "grace@gmail.com");
    const adaRoot = await topFolder(fake, ada.access, "EasyEdit – Personal");
    const adaOriginals = await ada.drive(adaRoot).folderId("Originals");
    expect(fake.files.get(adaOriginals)).toMatchObject({ name: "Originals", parents: [adaRoot], owner: "ada@gmail.com" });

    expect((await readWith(fake, ada.access, adaOriginals)).status).toBe(200);
    expect((await readWith(fake, grace.access, adaOriginals)).status).toBe(404);
    expect((await readWith(fake, ada.access, "shared-clip")).status).toBe(404);
    // The app's service account does not see into a person's Drive either.
    expect((await readWith(fake, mainSa(fake, SCOPE_READ), adaOriginals)).status).toBe(404);
    expect((await readWith(fake, mainSa(fake, SCOPE_READ), "shared-clip")).status).toBe(200);
    // Grace looking for "Originals" in Ada's folder finds nothing, so she cannot put anything there.
    await expect(grace.drive(adaRoot).folderId("Originals")).rejects.toMatchObject({ call: "folder", status: 404 });
  });

  it("a file in a person's Drive says it is in no shared drive", async () => {
    const fake = makeFakeDrive();
    const { access, drive } = personalDrive(fake, "ada@gmail.com");
    const client = drive(await topFolder(fake, access, "EasyEdit – Personal"));
    const parentId = await client.folderId("Previews");
    expect(await client.getFile(parentId)).toMatchObject({ id: parentId, name: "Previews", driveId: null, trashed: false });
    await client.trashFile(parentId);
    expect(await client.getFile(parentId)).toMatchObject({ trashed: true });
  });

  it("about.get tells a connection how much of its Drive is used", async () => {
    const fake = makeFakeDrive();
    const { access, drive } = personalDrive(fake, "ada@gmail.com");
    const client = drive(await topFolder(fake, access, "EasyEdit – Personal"));
    const id = await client.newFileId();
    const url = await client.openUploadSession({ id, name: "clip.mp4", parentId: await client.folderId("Originals"), mimeType: "video/mp4", sizeBytes: 2 * MiB, origin: "https://app.test" });
    await piece(fake, url, 0, 2 * MiB, 2 * MiB);
    const about = async () => {
      const answer = await fake.fetch("https://www.googleapis.com/drive/v3/about?fields=storageQuota", { headers: { Authorization: `Bearer ${(await access.token()).accessToken}` } });
      return { status: answer.status, body: await answer.json() };
    };
    expect(await about()).toEqual({ status: 200, body: { storageQuota: { limit: String(15 * 1024 ** 3), usage: String(2 * MiB), usageInDrive: String(2 * MiB), usageInDriveTrash: "0" } } });
    fake.setQuota("ada@gmail.com", { limitBytes: null, usedBytes: 5 });
    expect(await about()).toEqual({ status: 200, body: { storageQuota: { usage: "5", usageInDrive: "5", usageInDriveTrash: "0" } } });
    const noFields = await fake.fetch("https://www.googleapis.com/drive/v3/about", { headers: { Authorization: `Bearer ${(await access.token()).accessToken}` } });
    expect(noFields.status).toBe(400);
  });
});
