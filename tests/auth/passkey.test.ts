import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { passkey as passkeyTable, session as sessionTable } from "@/db/schema";
import { addEntry, removeEntry, SEED_ADMIN_EMAIL, seedAdmin } from "@/lib/allowlist/service";
import { makeTestDb } from "../helpers/db";
import {
  addPasskey, ANONYMOUS_AAGUID, createSoftAuthenticator, ONE_PASSWORD_AAGUID, registrationOptions, sessionCookieOf,
  signInWithPasskey, type SoftAuthenticator,
} from "../helpers/passkey-authenticator";

let testDb: DB;
vi.mock("@/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db")>()),
  getDb: () => testDb,
}));

const SECRET = "test-secret-".repeat(4);
const BASE_URL = "http://localhost:3000";
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SESSION_DAYS = 30;

const globalForAuth = globalThis as typeof globalThis & { __easyEditAuth?: unknown };

async function realAuth() {
  const { getAuth } = await import("@/lib/auth");
  const auth = getAuth();
  return { auth, ctx: await auth.$context };
}

const send = async (request: Request) => (await realAuth()).auth.handler(request);

// The rate limiter counts per address, so every simulated browser gets its own unless a test shares one on purpose.
let addresses = 0;
const ip = () => `198.51.${100 + Math.floor(addresses / 250)}.${(addresses++ % 250) + 1}`;

// A device signed in to this account: a session row and the cookie the browser holds for it.
async function newSession(userId: string) {
  const { ctx } = await realAuth();
  const session = await ctx.internalAdapter.createSession(userId);
  const signed = `${session.token}.${await makeSignature(session.token, SECRET)}`;
  return { token: session.token, cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}` };
}

// A member as they are after signing in with Google.
async function member(email: string) {
  await addEntry(testDb, { email, role: "editor", invitedBy: SEED_ADMIN_EMAIL });
  const { ctx } = await realAuth();
  const { user } = await ctx.internalAdapter.createOAuthUser(
    { email, name: email.slice(0, email.indexOf("@")), emailVerified: true },
    { providerId: "google", accountId: `g-${email}` },
  );
  return { userId: user.id, ...(await newSession(user.id)) };
}

async function added(cookie: string, authenticator: SoftAuthenticator) {
  const res = await addPasskey(send, { cookie, authenticator, ip: ip() });
  expect(res.status, await res.clone().text()).toBe(200);
  return res;
}

const passkeysOf = (userId: string) => testDb.select().from(passkeyTable).where(eq(passkeyTable.userId, userId));
const sessions = () => testDb.select().from(sessionTable);

const post = (path: string, body: object, cookie?: string) =>
  send(new Request(`${BASE_URL}/api/auth${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL, "x-forwarded-for": ip(), ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }));

const getRegistrationOptions = (cookie?: string) =>
  send(new Request(`${BASE_URL}/api/auth/passkey/generate-register-options`, {
    headers: { "x-forwarded-for": ip(), ...(cookie ? { cookie } : {}) },
  }));

beforeEach(async () => {
  vi.stubEnv("BETTER_AUTH_URL", BASE_URL);
  vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
  delete globalForAuth.__easyEditAuth;
  testDb = await makeTestDb();
  await seedAdmin(testDb);
});

afterEach(() => {
  delete globalForAuth.__easyEditAuth;
  vi.unstubAllEnvs();
});

describe("adding a passkey", () => {
  it("registration options ask for a discoverable passkey from any passkey manager", async () => {
    const ann = await member("ann@gmail.com");
    const { body } = await registrationOptions(send, { cookie: ann.cookie, ip: ip() });

    expect(body.rp).toEqual({ id: "localhost", name: "EasyEdit" });
    // The passkey manager shows which account a passkey opens.
    expect(body.user).toMatchObject({ name: "ann@gmail.com", displayName: "ann@gmail.com" });
    expect(body.authenticatorSelection).toMatchObject({ residentKey: "required", userVerification: "preferred" });
    // Left open, so 1Password, phones and security keys are offered too.
    expect(body.authenticatorSelection).not.toHaveProperty("authenticatorAttachment");
    expect(body.attestation).toBe("none");
  });

  it("a signed-in member adds a passkey, named after its passkey manager", async () => {
    const ann = await member("ann@gmail.com");
    const onePassword = createSoftAuthenticator({ aaguid: ONE_PASSWORD_AAGUID });
    const keychain = createSoftAuthenticator({ aaguid: ANONYMOUS_AAGUID });

    const res = await added(ann.cookie, onePassword);
    await added(ann.cookie, keychain);

    // Adding a passkey signs nobody in.
    expect(sessionCookieOf(res)).toBeNull();
    expect(await sessions()).toHaveLength(1);
    const rows = await passkeysOf(ann.userId);
    expect(rows.map((r) => [r.credentialID, r.name]).sort()).toEqual([
      [onePassword.credentialId, "1Password"],
      [keychain.credentialId, "Passkey"],
    ].sort());
    expect(rows.find((r) => r.name === "1Password")).toMatchObject({ aaguid: ONE_PASSWORD_AAGUID, counter: 0, backedUp: true, deviceType: "multiDevice" });

    // The list holds exactly the member's own passkeys.
    const list = await send(new Request(`${BASE_URL}/api/auth/passkey/list-user-passkeys`, { headers: { cookie: ann.cookie } }));
    expect(((await list.json()) as { name: string }[]).map((p) => p.name).sort()).toEqual(["1Password", "Passkey"]);

    // The server names the passkeys the account has, so the browser refuses a second one in the same manager.
    await expect(addPasskey(send, { cookie: ann.cookie, authenticator: onePassword, ip: ip() }))
      .rejects.toMatchObject({ name: "InvalidStateError" });
    expect(await passkeysOf(ann.userId)).toHaveLength(2);
  });

  it("adding a passkey needs a session", async () => {
    const options = await getRegistrationOptions();
    expect(options.status).toBe(401);

    // A challenge given to a signed-in page, answered without the session.
    const ann = await member("ann@gmail.com");
    const given = await registrationOptions(send, { cookie: ann.cookie, ip: ip() });
    const res = await addPasskey(send, { authenticator: createSoftAuthenticator(), ip: ip(), options: given });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
    expect(await testDb.select().from(passkeyTable)).toHaveLength(0);
  });

  it("adding a passkey needs a sign-in from the last day", async () => {
    const ann = await member("ann@gmail.com");
    const signedIn = (hoursAgo: number) => testDb.update(sessionTable).set({ createdAt: new Date(Date.now() - hoursAgo * HOUR) });

    await signedIn(23);
    expect((await getRegistrationOptions(ann.cookie)).status).toBe(200);
    // Options asked for while the sign-in was fresh, answered after it went stale.
    const given = await registrationOptions(send, { cookie: ann.cookie, ip: ip() });

    await signedIn(25);
    const options = await getRegistrationOptions(ann.cookie);
    expect(options.status).toBe(403);
    expect(await options.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });

    const res = await addPasskey(send, { cookie: ann.cookie, authenticator: createSoftAuthenticator(), ip: ip(), options: given });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
    expect(await testDb.select().from(passkeyTable)).toHaveLength(0);
  });

  it("a passkey id that's already added can't be added again, so the first passkey keeps signing in", async () => {
    // A member who has used the shared team account can read its passkey's id, then sign in as herself and answer
    // with a forged authenticator that reuses that id with a key of her own.
    const team = await member("team@gmail.com");
    const teamPasskey = createSoftAuthenticator({ aaguid: ONE_PASSWORD_AAGUID });
    await added(team.cookie, teamPasskey);
    const mallory = await member("mallory@gmail.com");

    const res = await addPasskey(send, {
      cookie: mallory.cookie, authenticator: createSoftAuthenticator({ credentialId: teamPasskey.credentialId }), ip: ip(),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: "FAILED_TO_VERIFY_REGISTRATION" });
    expect(await passkeysOf(mallory.userId)).toHaveLength(0);
    const holders = await testDb.select().from(passkeyTable).where(eq(passkeyTable.credentialID, teamPasskey.credentialId));
    expect(holders.map((row) => row.userId)).toEqual([team.userId]);
    const signIn = await signInWithPasskey(send, { authenticator: teamPasskey, ip: ip() });
    expect(signIn.status).toBe(200);
  });
});

describe("signing in with a passkey", () => {
  it("signing in with a passkey gives a 30-day session", async () => {
    const { auth } = await realAuth();
    const ann = await member("ann@gmail.com");
    const authenticator = createSoftAuthenticator({ aaguid: ONE_PASSWORD_AAGUID });
    await added(ann.cookie, authenticator);

    const res = await signInWithPasskey(send, { authenticator, ip: ip() });

    expect(res.status).toBe(200);
    const cookie = sessionCookieOf(res);
    expect(cookie).not.toBeNull();
    const setCookie = res.headers.getSetCookie().find((line) => line.includes("session_token="));
    expect(setCookie).toContain(`Max-Age=${SESSION_DAYS * 24 * 60 * 60}`);
    const signedIn = await auth.api.getSession({ headers: new Headers({ cookie: cookie! }) });
    expect(signedIn?.user.email).toBe("ann@gmail.com");
    const [row] = await testDb.select().from(sessionTable).where(eq(sessionTable.token, signedIn!.session.token));
    expect(Math.abs(row.expiresAt.getTime() - (Date.now() + SESSION_DAYS * DAY))).toBeLessThan(60_000);
    // The stored counter follows the passkey's, so a copied passkey that falls behind is refused.
    expect((await passkeysOf(ann.userId))[0].counter).toBe(authenticator.counter);
  });

  it("an unknown passkey can't sign in", async () => {
    const ann = await member("ann@gmail.com");
    await added(ann.cookie, createSoftAuthenticator());

    // A passkey that was never added to EasyEdit.
    const res = await signInWithPasskey(send, { authenticator: createSoftAuthenticator(), ip: ip() });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "PASSKEY_NOT_FOUND" });
    expect(sessionCookieOf(res)).toBeNull();
    expect(await sessions()).toHaveLength(1);
  });

  it("a passkey removed from EasyEdit can't sign in, though the passkey manager still has it", async () => {
    const ann = await member("ann@gmail.com");
    const authenticator = createSoftAuthenticator();
    await added(ann.cookie, authenticator);
    const [row] = await passkeysOf(ann.userId);
    expect((await post("/passkey/delete-passkey", { id: row.id }, ann.cookie)).status).toBe(200);

    const res = await signInWithPasskey(send, { authenticator, ip: ip() });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "PASSKEY_NOT_FOUND" });
    expect(sessionCookieOf(res)).toBeNull();
    expect(await sessions()).toHaveLength(1);
  });

  it("an answer signed with another key can't sign in, even with the right passkey id", async () => {
    const ann = await member("ann@gmail.com");
    const authenticator = createSoftAuthenticator();
    await added(ann.cookie, authenticator);
    const { privateKey: otherKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

    const res = await signInWithPasskey(send, {
      authenticator, ip: ip(),
      tamper: (answer) => {
        const clientDataHash = createHash("sha256").update(Buffer.from(answer.response.clientDataJSON, "base64url")).digest();
        const signed = Buffer.concat([Buffer.from(answer.response.authenticatorData, "base64url"), clientDataHash]);
        answer.response.signature = sign("sha256", signed, otherKey).toString("base64url");
      },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "AUTHENTICATION_FAILED" });
    expect(sessionCookieOf(res)).toBeNull();
    expect(await sessions()).toHaveLength(1);
  });

  it("a removed member's passkey can't sign in", async () => {
    const ann = await member("ann@gmail.com");
    const authenticator = createSoftAuthenticator();
    await added(ann.cookie, authenticator);
    await removeEntry(testDb, "ann@gmail.com");
    expect(await sessions()).toHaveLength(0);

    const res = await signInWithPasskey(send, { authenticator, ip: ip() });

    // The session hook's own refusal, the same one Google sign-in gets.
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "NOT_ALLOWLISTED" });
    expect(sessionCookieOf(res)).toBeNull();
    expect(await sessions()).toHaveLength(0);

    // The passkey stays with the account, so adding the member back lets it in again, as with Google.
    expect(await passkeysOf(ann.userId)).toHaveLength(1);
    await addEntry(testDb, { email: "ann@gmail.com", role: "editor", invitedBy: SEED_ADMIN_EMAIL });
    const again = await signInWithPasskey(send, { authenticator, ip: ip() });
    expect(again.status).toBe(200);
    expect(sessionCookieOf(again)).not.toBeNull();
  });

  it("passkey sign-in is rate limited", async () => {
    const ann = await member("ann@gmail.com");
    const authenticator = createSoftAuthenticator();
    await added(ann.cookie, authenticator);
    const address = ip();

    // Three guesses from one address use up its sign-ins for the next ten seconds.
    for (let i = 0; i < 3; i++) {
      expect((await signInWithPasskey(send, { authenticator: createSoftAuthenticator(), ip: address })).status).toBe(401);
    }
    const blocked = await signInWithPasskey(send, { authenticator, ip: address });

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ message: "Too many requests. Please try again later." });
    expect(sessionCookieOf(blocked)).toBeNull();
    expect(await sessions()).toHaveLength(1);
    // The limit is per address.
    expect((await signInWithPasskey(send, { authenticator, ip: ip() })).status).toBe(200);

    // Asking for sign-in options has a looser limit of its own: ten in ten seconds.
    const optionsAddress = ip();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await send(new Request(`${BASE_URL}/api/auth/passkey/generate-authenticate-options`, { headers: { "x-forwarded-for": optionsAddress } }));
      statuses.push(res.status);
    }
    expect(statuses).toEqual([...Array<number>(10).fill(200), 429]);
  });
});

describe("managing passkeys", () => {
  it("only the owner can rename or remove a passkey", async () => {
    const ann = await member("ann@gmail.com");
    const bob = await member("bob@gmail.com");
    await added(ann.cookie, createSoftAuthenticator({ aaguid: ONE_PASSWORD_AAGUID }));
    const [row] = await passkeysOf(ann.userId);

    // Bob knows the id of Ann's passkey but can't see, rename or remove it.
    const list = await send(new Request(`${BASE_URL}/api/auth/passkey/list-user-passkeys`, { headers: { cookie: bob.cookie } }));
    expect(await list.json()).toEqual([]);
    const rename = await post("/passkey/update-passkey", { id: row.id, name: "Bob's now" }, bob.cookie);
    expect(rename.status).toBe(401);
    expect(await rename.json()).toMatchObject({ code: "YOU_ARE_NOT_ALLOWED_TO_REGISTER_THIS_PASSKEY" });
    expect((await post("/passkey/delete-passkey", { id: row.id }, bob.cookie)).status).toBe(401);
    // Nor can anyone signed out.
    expect((await post("/passkey/update-passkey", { id: row.id, name: "Anyone's" })).status).toBe(401);
    expect((await post("/passkey/delete-passkey", { id: row.id })).status).toBe(401);
    expect(await passkeysOf(ann.userId)).toEqual([row]);

    const renamed = await post("/passkey/update-passkey", { id: row.id, name: "  Team vault  " }, ann.cookie);
    expect(renamed.status).toBe(200);
    expect((await passkeysOf(ann.userId))[0].name).toBe("Team vault");
    expect((await post("/passkey/update-passkey", { id: row.id, name: "   " }, ann.cookie)).status).toBe(400);
    expect((await post("/passkey/delete-passkey", { id: row.id }, ann.cookie)).status).toBe(200);
    expect(await passkeysOf(ann.userId)).toHaveLength(0);
  });

  it("signing out all other devices ends only this member's other sessions", async () => {
    const ann = await member("ann@gmail.com");
    const annLaptop = await newSession(ann.userId);
    // One of the others came in with the team's passkey.
    const authenticator = createSoftAuthenticator();
    await added(ann.cookie, authenticator);
    expect((await signInWithPasskey(send, { authenticator, ip: ip() })).status).toBe(200);
    const bob = await member("bob@gmail.com");
    expect((await sessions()).filter((s) => s.userId === ann.userId)).toHaveLength(3);

    const res = await post("/revoke-other-sessions", {}, ann.cookie);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });
    expect((await sessions()).map((s) => s.token).sort()).toEqual([ann.token, bob.token].sort());
    // This device stays signed in; the others are signed out.
    const { auth } = await realAuth();
    expect((await auth.api.getSession({ headers: new Headers({ cookie: ann.cookie }) }))?.user.email).toBe("ann@gmail.com");
    expect(await auth.api.getSession({ headers: new Headers({ cookie: annLaptop.cookie }) })).toBeNull();
    expect((await auth.api.getSession({ headers: new Headers({ cookie: bob.cookie }) }))?.user.email).toBe("bob@gmail.com");
  });
});
