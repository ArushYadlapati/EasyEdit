import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { DB } from "@/db";
import { assets, spaceStorage, user } from "@/db/schema";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { sharedFolderClient } from "@/lib/drive/client";
import { type AccessSource, SCOPE_CLOUD, serviceAccountSource } from "@/lib/drive/token";
import { LIMITS } from "@/lib/limits";
import { makeMediaHandlers, makeReadTokenHandler, type AssetRouteContext, type MediaHandlerDeps } from "@/lib/media/handlers";
import { completeUpload, openUpload, type MediaDeps } from "@/lib/media/service";
import type { AssetView, OpenUploadInput } from "@/lib/media/types";
import { readerFor, storageFor, type StorageDeps } from "@/lib/spaces/storage";
import { personalSpaceId, SEED_TEAM_ID } from "@/lib/spaces/types";
import type { StorageConfig } from "@/lib/storage/config";
import { type Connection, saveConnection } from "@/lib/storage/connections";
import { DRIVE_FILE_SCOPE } from "@/lib/storage/google-oauth";
import { makeSetUpStorage } from "@/lib/storage/setup";
import { joinSpace, testActor } from "../helpers/actor";
import { makeTestDb } from "../helpers/db";
import { makeFakeDrive, piece, type FakeDrive } from "../helpers/fake-drive";

// Three files as a browser describes them when it opens an upload.
export const VIDEO: OpenUploadInput = {
  fileName: "IMG_4821.MOV",
  sizeBytes: 20_000_000,
  mimeType: "video/quicktime",
  lastModifiedMs: 1_762_800_000_000,
  probe: { kind: "video", durationMs: 12_500, width: 1080, height: 1920, fps: 30, hasAudio: true, videoCodec: "hevc" },
};

export const IMAGE: OpenUploadInput = {
  fileName: "field.jpg",
  sizeBytes: 3_000_000,
  mimeType: "image/jpeg",
  lastModifiedMs: 1_762_800_060_000,
  probe: { kind: "image", durationMs: null, width: 4032, height: 3024, fps: null, hasAudio: false, videoCodec: null },
};

export const AUDIO: OpenUploadInput = {
  fileName: "theme.mp3",
  sizeBytes: 4_000_000,
  mimeType: "audio/mpeg",
  lastModifiedMs: 1_762_800_120_000,
  probe: { kind: "audio", durationMs: 95_000, width: null, height: null, fps: null, hasAudio: true, videoCodec: null },
};

const APP_ORIGIN = "https://app.test"; // where the app is served in tests

// storage: what storageFor and readerFor read the server's settings with, pointed at the pretend Google: Seattle
// Solvers' shared folder is deps.drive, and a person's connection (personal or team) uses cfg.
export type MediaContext = {
  db: DB;
  fake: FakeDrive;
  deps: MediaDeps;
  ada: Actor;
  grace: Actor;
  vera: Actor;
  root: Actor;
  cfg: StorageConfig;
  mainSa: AccessSource;
  storage: StorageDeps;
};

const ada: Actor = testActor({ userId: "user-ada", email: "ada@gmail.com", role: "editor" });
const grace: Actor = testActor({ userId: "user-grace", email: "grace@gmail.com", role: "editor" });
const vera: Actor = testActor({ userId: "user-vera", email: "vera@gmail.com", role: "viewer" });
const root: Actor = testActor({ userId: "user-root", email: "root@gmail.com", role: "admin" });

// A migrated database with four members of Seattle Solvers in it, and the Drive client talking to a pretend Drive.
export async function mediaContext(): Promise<MediaContext> {
  const db = await makeTestDb();
  const member = (actor: Actor, name: string) => ({ id: actor.userId, name, email: actor.email, emailVerified: true });
  await db.insert(user).values([member(ada, "Ada Lovelace"), member(grace, "Grace Hopper"), member(vera, "Vera Rubin"), member(root, "Root Admin")]);
  for (const actor of [ada, grace, vera, root]) await joinSpace(db, { id: actor.userId, email: actor.email }, actor.role);
  const fake = makeFakeDrive();
  const drive = sharedFolderClient(fake.config, { fetch: fake.fetch, now: fake.now });
  const cfg: StorageConfig = { clientId: "client-1", clientSecret: "shh", tokenKey: randomBytes(32), redirectUri: `${APP_ORIGIN}/api/storage/callback` };
  const mainSa = serviceAccountSource({ clientEmail: fake.config.clientEmail, privateKey: fake.config.privateKey, scope: SCOPE_CLOUD, fetch: fake.fetch, now: fake.now });
  const storage: StorageDeps = { config: () => cfg, sharedFolder: () => drive, fetch: fake.fetch };
  return { db, fake, deps: { db, drive, origin: APP_ORIGIN }, ada, grace, vera, root, cfg, mainSa, storage };
}

export type ConnectedStorage = { connection: Connection; refreshToken: string; rootFolderId: string; readerEmail: string | null };

let people = 0;

// `by` connects a Google account (a made-up one unless `email` is given) and sets up the space's storage in it, as
// the connect callback does: a folder in that Drive.
export async function connectStorage(ctx: MediaContext, spaceId: string, by: Actor, email?: string): Promise<ConnectedStorage> {
  people += 1;
  const connected = ctx.fake.connect({ email: email ?? `drive${people}@gmail.com` });
  const connection = await saveConnection(ctx.db, ctx.cfg, { userId: by.userId, googleSub: `g-sub-${people}`, email: connected.email, refreshToken: connected.refreshToken, scopes: [DRIVE_FILE_SCOPE] });
  await makeSetUpStorage({ config: ctx.cfg, fetch: ctx.fake.fetch })(ctx.db, { spaceId, connectionId: connection.id, byUserId: by.userId });
  const [row] = await ctx.db.select().from(spaceStorage).where(eq(spaceStorage.spaceId, spaceId));
  return { connection, refreshToken: connected.refreshToken, rootFolderId: row.rootFolderId!, readerEmail: row.readerEmail };
}

// `owner`'s personal space with storage in a Drive they connected; `owner` as they act there.
export async function personalWithStorage(ctx: MediaContext, owner: Actor = ctx.ada, email?: string): Promise<ConnectedStorage & { actor: Actor }> {
  const actor: Actor = { ...owner, role: "admin", spaceId: personalSpaceId(owner.userId) };
  await joinSpace(ctx.db, { id: owner.userId, email: owner.email }, "admin", actor.spaceId);
  return { ...(await connectStorage(ctx, actor.spaceId, actor, email)), actor };
}

// A team run by `admin`, with `members` as editors, and storage in a Drive the admin connected, read with that connection.
export async function teamWithStorage(ctx: MediaContext, name: string, admin: Actor = ctx.ada, members: Actor[] = [ctx.grace], email?: string): Promise<ConnectedStorage & { spaceId: string; as(actor: Actor): Actor }> {
  const spaceId = `team_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await ctx.db.execute(sql`insert into organization (id, name, slug, created_at, kind) values (${spaceId}, ${name}, ${slug}, now(), 'team')`);
  await joinSpace(ctx.db, { id: admin.userId, email: admin.email }, "admin", spaceId);
  for (const member of members) await joinSpace(ctx.db, { id: member.userId, email: member.email }, "editor", spaceId);
  const as = (actor: Actor): Actor => ({ ...actor, spaceId, role: actor.userId === admin.userId ? "admin" : "editor" });
  return { ...(await connectStorage(ctx, spaceId, as(admin), email)), spaceId, as };
}

// What the routes hand the handlers, with each space's storage found as the server finds it (storageFor, readerFor),
// pointed at the pretend Google.
export function handlerDeps(ctx: MediaContext, actor: Actor, auth?: MediaHandlerDeps["auth"]): MediaHandlerDeps {
  const member: CurrentUser = { id: actor.userId, email: actor.email, name: actor.email, image: null, allowlistRole: actor.role };
  return {
    db: () => ctx.db,
    auth: auth ?? (async () => member),
    drive: (db, spaceId) => storageFor(db, spaceId, ctx.storage),
    reader: (db, spaceId) => readerFor(db, spaceId, ctx.storage),
    origin: () => APP_ORIGIN,
  };
}

// A fetch for the browser's API client: each request goes to the route handler Next would call for its method
// and path, with `actor` signed in. A request that has no route throws.
export function handlersFetch(ctx: MediaContext, actor: Actor, auth?: MediaHandlerDeps["auth"]): typeof fetch {
  const deps = handlerDeps(ctx, actor, auth);
  const media = makeMediaHandlers(deps);
  const readToken = makeReadTokenHandler(deps);
  const forAll = new Map<string, (req: Request) => Promise<Response>>([
    ["GET /api/media", media.list],
    ["POST /api/media", media.open],
    ["POST /api/drive/read-token", readToken],
    ["POST /api/media/local", media.addLocal],
  ]);
  // By what follows the asset's id in the path.
  const forOne = new Map<string, (req: Request, at: AssetRouteContext) => Promise<Response>>([
    ["PATCH ", media.update],
    ["DELETE ", media.remove],
    ["POST /offset", media.offset],
    ["POST /complete", media.complete],
    ["POST /files", media.openFile],
    ["POST /files/complete", media.completeFile],
    ["POST /preview-failed", media.previewFailed],
    ["POST /local-file", media.localFile],
  ]);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), APP_ORIGIN);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    headers.set("origin", APP_ORIGIN);
    const req = new Request(url, { method, headers, body: init?.body });
    if (url.origin === APP_ORIGIN) {
      const all = forAll.get(`${method} ${url.pathname}`);
      if (all) return all(req);
      const [, id, rest = ""] = /^\/api\/media\/([^/]+)(\/.*)?$/.exec(url.pathname) ?? [];
      const one = forOne.get(`${method} ${rest}`);
      if (id !== undefined && one) return one(req, { params: Promise.resolve({ id: decodeURIComponent(id) }) });
    }
    throw new Error(`No route for ${method} ${url.origin === APP_ORIGIN ? url.pathname : url.href}`);
  }) as typeof fetch;
}

// What a browser does: sends 8 MiB pieces from `from` until Drive answers 200.
export async function sendAll(fake: FakeDrive, uploadUrl: string, sizeBytes: number, from = 0): Promise<void> {
  for (let at = from; ; ) {
    const to = Math.min(at + LIMITS.mediaChunkBytes, sizeBytes);
    const answer = await piece(fake, uploadUrl, at, to, sizeBytes);
    if (answer.status === 200) return;
    if (answer.status !== 308) throw new Error(`The pretend Drive answered ${answer.status} to the piece at ${at}.`);
    at = to;
  }
}

// An asset whose original is in Drive: open, send every piece, complete.
export async function readyAsset(ctx: MediaContext, actor: Actor = ctx.ada, input: OpenUploadInput = VIDEO): Promise<AssetView> {
  const { asset, uploadUrl, offset } = await openUpload(ctx.deps, actor, input);
  if (offset < input.sizeBytes) await sendAll(ctx.fake, uploadUrl, input.sizeBytes, offset);
  return completeUpload(ctx.deps, actor, asset.id);
}

export const CLIP_TRANSFORM = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1, fit: "cover" };
// A video clip that names an asset, as an add_clip op carries it.
export const mediaClip = (assetId: string, over: Record<string, unknown> = {}) => ({ type: "video", assetId, start: 0, duration: 90, in: 0, speed: 1, volume: 1, transform: CLIP_TRANSFORM, ...over });

// A ready asset row written straight to the database, for tests that need an asset and no Drive. Defaults: a 12.5 s video named "IMG_4821", uploaded by "u1".
export async function insertAsset(db: DB, over: Partial<typeof assets.$inferInsert> = {}): Promise<string> {
  const id = over.id ?? nanoid(12);
  await db.insert(assets).values({
    spaceId: SEED_TEAM_ID, kind: "video", name: "IMG_4821", fileName: "IMG_4821.MOV", mimeType: "video/quicktime", sizeBytes: 20_000_000, lastModifiedMs: 1_762_800_000_000,
    status: "ready", driveFileId: `drive-${id}`, durationMs: 12_500, width: 1080, height: 1920, fps: 30, hasAudio: true, videoCodec: "hevc",
    previewStatus: "pending", uploadedBy: "u1", readyAt: new Date(), ...over, id,
  });
  return id;
}
