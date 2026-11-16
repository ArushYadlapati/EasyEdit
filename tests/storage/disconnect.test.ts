import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { describe, expect, it, vi } from "vitest";
import type { DB } from "@/db";
import { assets, driveConnection, spaceStorage } from "@/db/schema";
import { ServiceError } from "@/lib/service-error";
import { SEED_TEAM_ID } from "@/lib/spaces/types";
import { makeDisconnectStorage } from "@/lib/storage/disconnect";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { joinSpace } from "../helpers/actor";
import { type StorageWorld, storageWorld } from "../helpers/storage";

const storageOf = async (db: DB, spaceId: string) => (await db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, spaceId)))[0] ?? null;
const connectionRow = async (db: DB, id: string) => (await db.select().from(driveConnection).where(eq(driveConnection.id, id)))[0] ?? null;
const refusal = (error: unknown) => (error instanceof ServiceError ? { code: error.code, status: error.status, message: error.message } : error);

async function addAsset(db: DB, spaceId: string, over: Partial<typeof assets.$inferInsert> = {}) {
  await db.insert(assets).values({
    id: nanoid(12), spaceId, kind: "video", name: "clip", fileName: "clip.mov", mimeType: "video/quicktime", sizeBytes: 1000, lastModifiedMs: 1, uploadedBy: "u1", ...over,
  });
}

// A space with storage in a Google account `ownerId` connected, and a disconnect whose Google revoke is recorded.
async function connected(w: StorageWorld, spaceId: string, ownerId = "u1") {
  const connection = await w.connect({ userId: ownerId });
  await makeSetUpStorage({ config: w.cfg, fetch: w.fake.fetch })(w.db, { spaceId, connectionId: connection.id, byUserId: ownerId });
  const revoke = vi.fn<(token: string) => Promise<void>>(async () => {});
  const disconnect = makeDisconnectStorage({ config: w.cfg, revoke });
  return { connection, revoke, disconnect };
}

describe("disconnecting a Google account from a space", () => {
  it("the person who connected it, with no videos: the space has no storage, the connection is gone, and Google is told", async () => {
    const w = await storageWorld();
    const { connection, revoke, disconnect } = await connected(w, w.personal);
    await disconnect(w.db, { spaceId: w.personal, byUserId: "u1" });
    expect(await storageOf(w.db, w.personal)).toBeNull();
    expect(await connectionRow(w.db, connection.id)).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(connection.refreshToken);
  });

  it("a team's storage, by its admin who connected it", async () => {
    const w = await storageWorld();
    const team = await w.team("Robots");
    const { disconnect } = await connected(w, team);
    await disconnect(w.db, { spaceId: team, byUserId: "u1" });
    expect(await storageOf(w.db, team)).toBeNull();
  });

  it("a space with videos is refused, and nothing changes", async () => {
    const w = await storageWorld();
    const { connection, revoke, disconnect } = await connected(w, w.personal);
    await addAsset(w.db, w.personal);
    const error = await disconnect(w.db, { spaceId: w.personal, byUserId: "u1" }).catch((e) => e);
    expect(refusal(error)).toEqual({ code: "HAS_UPLOADS", status: 409, message: "This space has videos in that Google Drive, so it can't be disconnected yet." });
    expect(await storageOf(w.db, w.personal)).not.toBeNull();
    expect(await connectionRow(w.db, connection.id)).not.toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("removed videos don't count", async () => {
    const w = await storageWorld();
    const { disconnect } = await connected(w, w.personal);
    await addAsset(w.db, w.personal, { removedAt: new Date() });
    await disconnect(w.db, { spaceId: w.personal, byUserId: "u1" });
    expect(await storageOf(w.db, w.personal)).toBeNull();
  });

  it("another admin of the team can't disconnect someone else's Google account", async () => {
    const w = await storageWorld();
    const team = await w.team("Robots");
    await joinSpace(w.db, { id: "u2" }, "admin", team);
    const { connection, revoke, disconnect } = await connected(w, team);
    const error = await disconnect(w.db, { spaceId: team, byUserId: "u2" }).catch((e) => e);
    expect(refusal(error)).toEqual({ code: "NOT_OWNER", status: 403, message: "Only the person who connected this Google account can disconnect it." });
    expect(await storageOf(w.db, team)).not.toBeNull();
    expect(await connectionRow(w.db, connection.id)).not.toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("an editor, or someone not in the space, gets the same answer as a space that doesn't exist", async () => {
    const w = await storageWorld();
    const team = await w.team("Robots");
    await joinSpace(w.db, { id: "u3" }, "editor", team);
    const { disconnect } = await connected(w, team);
    for (const who of ["u3", "u9"]) {
      const error = await disconnect(w.db, { spaceId: team, byUserId: who }).catch((e) => e);
      expect(refusal(error)).toEqual({ code: "NOT_FOUND", status: 404, message: "Space not found" });
    }
    expect(await storageOf(w.db, team)).not.toBeNull();
  });

  it("a space with no Google account (none yet, or Seattle Solvers' shared drive) has nothing to disconnect", async () => {
    const w = await storageWorld();
    const disconnect = makeDisconnectStorage({ config: w.cfg, revoke: vi.fn(async () => {}) });
    for (const spaceId of [w.personal, SEED_TEAM_ID]) {
      if (spaceId === SEED_TEAM_ID) await w.db.insert(spaceStorage).values({ spaceId, kind: "shared_folder", createdBy: "u1" }).onConflictDoNothing();
      const error = await disconnect(w.db, { spaceId, byUserId: "u1" }).catch((e) => e);
      expect(refusal(error)).toEqual({ code: "NO_STORAGE", status: 409, message: "This space has no Google account to disconnect." });
    }
  });

  it("Google refusing the revoke doesn't stop the disconnect", async () => {
    const w = await storageWorld();
    const { connection } = await connected(w, w.personal);
    const failing = makeDisconnectStorage({ config: w.cfg, revoke: vi.fn(async () => Promise.reject(new Error("google down"))) });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await failing(w.db, { spaceId: w.personal, byUserId: "u1" });
    } finally {
      quiet.mockRestore();
    }
    expect(await storageOf(w.db, w.personal)).toBeNull();
    expect(await connectionRow(w.db, connection.id)).toBeNull();
  });

  it("a token the server's key can't open is still disconnected, without asking Google", async () => {
    const w = await storageWorld();
    const { connection } = await connected(w, w.personal);
    const revoke = vi.fn(async () => {});
    const otherKey = makeDisconnectStorage({ config: { ...w.cfg, tokenKey: randomBytes(32) }, revoke });
    await otherKey(w.db, { spaceId: w.personal, byUserId: "u1" });
    expect(await storageOf(w.db, w.personal)).toBeNull();
    expect(await connectionRow(w.db, connection.id)).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("afterwards the same Google account can hold another space's storage", async () => {
    const w = await storageWorld();
    const team = await w.team("Robots");
    const { connection, disconnect } = await connected(w, w.personal);
    await disconnect(w.db, { spaceId: w.personal, byUserId: "u1" });
    const again = await w.connect({ userId: "u1", googleSub: connection.googleSub, email: connection.email });
    await makeSetUpStorage({ config: w.cfg, fetch: w.fake.fetch })(w.db, { spaceId: team, connectionId: again.id, byUserId: "u1" });
    expect((await storageOf(w.db, team))?.googleSub).toBe(connection.googleSub);
  });
});
