import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DB } from "@/db";
import { type AccessSource, SCOPE_CLOUD, serviceAccountSource } from "@/lib/drive/token";
import type { StorageConfig } from "@/lib/storage/config";
import { type Connection, saveConnection } from "@/lib/storage/connections";
import { DRIVE_FILE_SCOPE } from "@/lib/storage/google-oauth";
import { personalSpaceId } from "@/lib/spaces/types";
import { joinSpace } from "./actor";
import { makeTestDb } from "./db";
import { type FakeDrive, makeFakeDrive } from "./fake-drive";

export type StorageWorld = {
  db: DB;
  fake: FakeDrive;
  cfg: StorageConfig; // the OAuth client and token key; projectId is the fake's project
  mainSa: AccessSource; // the app's service account, for the Cloud scope
  personal: string; // u1's personal space
  // Connects a Google account to `userId` (u1 unless given), as the callback saves it.
  connect(input?: { userId?: string; email?: string; googleSub?: string }): Promise<Connection & { refreshToken: string }>;
  team(name: string, adminId?: string): Promise<string>; // a team space with `adminId` (u1) as its admin; its id
};

// A database with u1 in Seattle Solvers (admin) and in their personal space, and a pretend Google.
export async function storageWorld(): Promise<StorageWorld> {
  const db = await makeTestDb();
  const fake = makeFakeDrive();
  await joinSpace(db, { id: "u1" }, "admin");
  await joinSpace(db, { id: "u1" }, "admin", personalSpaceId("u1"));
  const cfg: StorageConfig = { clientId: "client-1", clientSecret: "shh", tokenKey: randomBytes(32), redirectUri: "https://app.test/api/storage/callback", projectId: fake.projectId };
  const mainSa = serviceAccountSource({ clientEmail: fake.config.clientEmail, privateKey: fake.config.privateKey, scope: SCOPE_CLOUD, fetch: fake.fetch, now: fake.now });
  let people = 0;
  return {
    db,
    fake,
    cfg,
    mainSa,
    personal: personalSpaceId("u1"),
    async connect(input = {}) {
      people += 1;
      const userId = input.userId ?? "u1";
      const { refreshToken, email } = fake.connect({ email: input.email ?? `drive${people}@gmail.com` });
      const connection = await saveConnection(db, cfg, { userId, googleSub: input.googleSub ?? `g-sub-${people}`, email, refreshToken, scopes: [DRIVE_FILE_SCOPE] });
      return { ...connection, refreshToken };
    },
    async team(name, adminId = "u1") {
      const id = `team_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await db.execute(sql`insert into organization (id, name, slug, created_at, kind) values (${id}, ${name}, ${slug}, now(), 'team')`);
      await joinSpace(db, { id: adminId }, "admin", id);
      return id;
    },
  };
}
