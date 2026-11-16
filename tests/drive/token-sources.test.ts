import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DriveError, SCOPE_CLOUD, SCOPE_READ, SCOPE_WRITE, connectionSource, impersonatedSource, serviceAccountSource } from "@/lib/drive/token";
import type { StorageConfig } from "@/lib/storage/config";
import { ConnectionBrokenError, refreshAccess } from "@/lib/storage/google-oauth";
import { type FakeDrive, makeFakeDrive } from "../helpers/fake-drive";

const HOUR = 3_600_000;
const oauth: StorageConfig = { clientId: "client-1", clientSecret: "shh", tokenKey: randomBytes(32), redirectUri: "https://app.test/api/storage/callback" };
const mainSa = (fake: FakeDrive, scope: string, fetchFn: typeof fetch = fake.fetch) =>
  serviceAccountSource({ clientEmail: fake.config.clientEmail, privateKey: fake.config.privateKey, scope, fetch: fetchFn, now: fake.now });
const tokenCalls = (fake: FakeDrive) => fake.calls.filter((call) => call.path === "/token").length;
const noWait = async () => {};

describe("a service account source", () => {
  it("keeps one token for its scope, shares a request in flight, and asks again only when too little time is left", async () => {
    const fake = makeFakeDrive();
    const source = mainSa(fake, SCOPE_WRITE);
    const [a, b] = await Promise.all([source.token(), source.token()]);
    expect(a).toEqual(b);
    expect(a.expiresAt).toBe(fake.now() + HOUR);
    expect(fake.whoHas(a.accessToken)).toEqual({ email: fake.config.clientEmail, scope: SCOPE_WRITE });
    expect(tokenCalls(fake)).toBe(1);
    fake.advance(HOUR - 301_000);
    expect(await source.token()).toEqual(a); // 301 s left: still good
    expect(tokenCalls(fake)).toBe(1);
    expect(await source.token(600)).not.toEqual(a); // the caller needs 600 s
    expect(tokenCalls(fake)).toBe(2);
  });

  it("is for one scope: a read source's token can only read", async () => {
    const fake = makeFakeDrive();
    const read = await mainSa(fake, SCOPE_READ).token();
    expect(fake.whoHas(read.accessToken)?.scope).toBe(SCOPE_READ);
    const cloud = await mainSa(fake, SCOPE_CLOUD).token();
    expect(fake.whoHas(cloud.accessToken)?.scope).toBe("https://www.googleapis.com/auth/cloud-platform");
  });

  it("forgets a failure, so the next call asks again", async () => {
    const fake = makeFakeDrive();
    const source = mainSa(fake, SCOPE_WRITE);
    fake.failNext(/^POST \/token/, 500, "backendError");
    await expect(source.token()).rejects.toMatchObject({ name: "DriveError", call: "token", status: 500, reason: "backendError" });
    expect((await source.token()).accessToken).toMatch(/^ya29\./);
  });
});

describe("a connection source", () => {
  it("keeps the refreshed token and refreshes again only when too little time is left", async () => {
    let refreshes = 0;
    let clock = 1_000_000;
    const source = connectionSource({
      refresh: async () => ({ accessToken: `access-${++refreshes}`, expiresAt: clock + HOUR }),
      now: () => clock,
    });
    const [a, b] = await Promise.all([source.token(), source.token()]);
    expect([a, b]).toEqual([{ accessToken: "access-1", expiresAt: 1_000_000 + HOUR }, { accessToken: "access-1", expiresAt: 1_000_000 + HOUR }]);
    expect(refreshes).toBe(1);
    clock += HOUR - 301_000;
    expect((await source.token()).accessToken).toBe("access-1");
    clock += 2_000;
    expect((await source.token()).accessToken).toBe("access-2");
    expect((await source.token(3_601)).accessToken).toBe("access-3"); // the caller needs more than an hour
  });

  it("refreshes with a person's refresh token at Google, and the token reaches their Drive", async () => {
    const fake = makeFakeDrive();
    const { refreshToken, email } = fake.connect({ email: "ada@gmail.com" });
    const source = connectionSource({ refresh: () => refreshAccess(oauth, refreshToken, fake.fetch), now: fake.now });
    const token = await source.token();
    expect(fake.whoHas(token.accessToken)).toEqual({ email, scope: "https://www.googleapis.com/auth/drive.file" });
    expect(token.expiresAt).toBeGreaterThan(fake.now() + HOUR - 5_000);
  });

  it("invalid_grant marks the connection broken", async () => {
    const fake = makeFakeDrive();
    const { refreshToken } = fake.connect();
    fake.revoke(refreshToken);
    const source = connectionSource({ refresh: () => refreshAccess(oauth, refreshToken, fake.fetch), now: fake.now });
    const error = await source.token().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectionBrokenError);
    expect(error).toMatchObject({ reason: "revoked" });
    // A refresh token Google never gave out is the same answer.
    const unknown = connectionSource({ refresh: () => refreshAccess(oauth, "1//not-from-here", fake.fetch) });
    await expect(unknown.token()).rejects.toBeInstanceOf(ConnectionBrokenError);
  });

  it("any other failure is not a broken connection, and is not remembered", async () => {
    const fake = makeFakeDrive();
    const { refreshToken } = fake.connect();
    const source = connectionSource({ refresh: () => refreshAccess(oauth, refreshToken, fake.fetch), now: fake.now });
    fake.failNext(/^POST \/token/, 503);
    const error = await source.token().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DriveError);
    expect(error).not.toBeInstanceOf(ConnectionBrokenError);
    expect((await source.token()).accessToken).toMatch(/^ya29\./);
  });
});

describe("an impersonated source", () => {
  async function withReader() {
    const fake = makeFakeDrive();
    const reader = fake.addServiceAccount("ee-r-abcdefghij");
    const caller = mainSa(fake, SCOPE_CLOUD);
    return { fake, reader, caller, source: impersonatedSource({ caller, targetEmail: reader, scope: SCOPE_READ, fetch: fake.fetch, now: fake.now }) };
  }

  it("asks IAM Credentials for the reader's token with the caller's token, for one hour", async () => {
    const { fake, reader, caller, source } = await withReader();
    const token = await source.token();
    expect(fake.whoHas(token.accessToken)).toEqual({ email: reader, scope: SCOPE_READ });
    expect(token.expiresAt).toBe(fake.now() + HOUR);
    const callerToken = (await caller.token()).accessToken;
    expect(fake.impersonations).toEqual([{ caller: fake.config.clientEmail, callerToken, target: reader, scope: [SCOPE_READ], lifetime: "3600s" }]);
    expect(fake.calls.at(-1)).toEqual({ method: "POST", path: `/v1/projects/-/serviceAccounts/${reader}:generateAccessToken`, scope: SCOPE_CLOUD, origin: null });
  });

  it("keeps the token and asks again only when too little time is left", async () => {
    const { fake, source } = await withReader();
    const [a, b] = await Promise.all([source.token(), source.token()]);
    expect(a).toEqual(b);
    fake.advance(HOUR - 301_000);
    expect(await source.token()).toEqual(a);
    expect(fake.impersonations).toHaveLength(1);
    fake.advance(2_000);
    expect(await source.token()).not.toEqual(a);
    expect(fake.impersonations).toHaveLength(2);
  });

  it("waits for a reader that was only just made, a few times, then gives up", async () => {
    const { fake, reader, caller } = await withReader();
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    const source = impersonatedSource({ caller, targetEmail: reader, scope: SCOPE_READ, fetch: fake.fetch, now: fake.now, sleep });
    fake.failNext(/generateAccessToken/, 404);
    fake.failNext(/generateAccessToken/, 404);
    expect(fake.whoHas((await source.token()).accessToken)?.email).toBe(reader);
    expect(waits).toHaveLength(2);
    const missing = impersonatedSource({ caller, targetEmail: "ee-r-0000000000@easyedit-test.iam.gserviceaccount.com", scope: SCOPE_READ, fetch: fake.fetch, sleep: noWait });
    await expect(missing.token()).rejects.toMatchObject({ name: "DriveError", call: "impersonate", status: 404, reason: "NOT_FOUND" });
  });

  it("is refused when the caller is not the app's service account or its token is not for Cloud", async () => {
    const { fake, reader } = await withReader();
    const notCloud = impersonatedSource({ caller: mainSa(fake, SCOPE_WRITE), targetEmail: reader, scope: SCOPE_READ, fetch: fake.fetch, sleep: noWait });
    await expect(notCloud.token()).rejects.toMatchObject({ call: "impersonate", status: 403, reason: "PERMISSION_DENIED" });
    const { refreshToken } = fake.connect();
    const person = connectionSource({ refresh: () => refreshAccess(oauth, refreshToken, fake.fetch) });
    const asPerson = impersonatedSource({ caller: person, targetEmail: reader, scope: SCOPE_READ, fetch: fake.fetch, sleep: noWait });
    await expect(asPerson.token()).rejects.toMatchObject({ call: "impersonate", status: 403 });
    expect(fake.impersonations).toEqual([]);
  });

  it("a caller that cannot get a token fails the same way, and nothing is remembered", async () => {
    const { fake, source } = await withReader();
    fake.failNext(/^POST \/token/, 500, "backendError");
    await expect(source.token()).rejects.toMatchObject({ call: "token", status: 500 });
    expect((await source.token()).accessToken).toMatch(/^ya29\./);
  });
});
