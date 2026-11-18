import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { apiRoute } from "@/lib/api-route";
import { checkAppBudget } from "@/lib/app-budget";
import type { DriveClient } from "@/lib/drive/client";
import { SettingsError } from "@/lib/drive/config";
import { type AccessSource, DriveError } from "@/lib/drive/token";
import { LIMITS } from "@/lib/limits";
import { ServiceError } from "@/lib/service-error";
import type { CaptionWord } from "@/lib/timeline";
import { actorIn, assetActor, spaceQuery } from "@/lib/spaces/access";
import { ConnectionBrokenError } from "@/lib/storage/google-oauth";
import { forgetAllSources } from "@/lib/storage/token-cache";
import { getTranscript, saveTranscript } from "@/lib/captions/transcripts";
import { MEDIA_MESSAGES } from "./messages";
import {
  assetGone,
  completeAssetFile,
  completeUpload,
  failPreview,
  listAssets,
  openAssetFile,
  openUpload,
  removeAsset,
  updateAsset,
  uploadOffset,
  type AssetFileRole,
  type MediaDeps,
} from "./service";
import type { OpenUploadInput } from "./types";

export type MediaHandlerDeps = {
  db: () => DB;
  auth: (req: Request) => Promise<CurrentUser | Response>; // authentication only; the role comes from the space
  // The space's storage: null when it has none ready; a connection that is broken throws ConnectionBrokenError.
  drive: (db: DB, spaceId: string) => Promise<DriveClient | null>;
  reader: (db: DB, spaceId: string) => Promise<AccessSource | null>; // what the read token is made from, the same way
  origin: () => string;
};

export type AssetRouteContext = { params: Promise<{ id: string }> };

export const NOT_SET_UP_BODY = { code: "STORAGE_NOT_SET_UP", message: "Uploads are not set up yet." } as const;
export const STORAGE_DOWN_BODY = { code: "STORAGE_UNAVAILABLE", message: MEDIA_MESSAGES.storageDown } as const;
export const BROKEN_BODY = { code: "STORAGE_BROKEN", message: MEDIA_MESSAGES.broken } as const;
// What a collection route answers for a space that is unknown, not named, or not the caller's.
const SPACE_NOT_FOUND_BODY = { code: "NOT_FOUND", message: "Space not found" } as const;

// Only the shape of each body, with unknown keys refused. The service checks the values.
const probeBody = z.strictObject({
  kind: z.enum(["video", "image", "audio"]),
  durationMs: z.number().nullable(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  fps: z.number().nullable(),
  hasAudio: z.boolean(),
  videoCodec: z.string().nullable(),
});

const openBody: z.ZodType<OpenUploadInput> = z.strictObject({
  fileName: z.string(),
  sizeBytes: z.number(),
  mimeType: z.string(),
  lastModifiedMs: z.number(),
  probe: probeBody,
  event: z.string().optional(),
});

const updateBody = z.strictObject({ name: z.string().optional(), event: z.string().nullable().optional() });

const transcriptBody = z.strictObject({ words: z.array(z.unknown()), model: z.string() });

const fileRole: z.ZodType<AssetFileRole> = z.enum(["preview", "poster"]);
const openFileBody = z.strictObject({ role: fileRole, sizeBytes: z.number() });
const completeFileBody = z.strictObject({ role: fileRole });

const idsParam = z.array(z.string()).max(LIMITS.mediaIdsPerRequest, MEDIA_MESSAGES.tooManyIds);

const invalid = (message: string) => new ServiceError("INVALID", 400, message);

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function checked<T>(shape: z.ZodType<T>, value: unknown): T {
  const parsed = shape.safeParse(value);
  if (!parsed.success) throw invalid(describeIssue(parsed.error));
  return parsed.data;
}

// A request's JSON body in the given shape. Anything else is refused as INVALID.
async function bodyOf<T>(req: Request, shape: z.ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw invalid("Body must be valid JSON");
  }
  return checked(shape, json);
}

// The asset ids a list request names in `?ids=a,b`. Undefined when it names none: the whole library is meant.
function idsOf(req: Request): string[] | undefined {
  const param = new URL(req.url).searchParams.get("ids");
  if (param === null) return undefined;
  return checked(idsParam, param.split(",").filter((id) => id !== ""));
}

const notSetUp = () => Response.json(NOT_SET_UP_BODY, { status: 409 });

// The one line a failed Drive call leaves: which call, the status and Google's short code, which is all a DriveError holds.
export const logDriveError = (error: DriveError) => console.error("Drive call failed", error.call, error.status, error.reason);

// Who is acting, and in which space. A collection route names its space in `?space=`; an item route is in the space
// its asset belongs to. Someone who is not a member of it gets the answer a space or an asset that does not exist gets.
type Resolve<Rest extends unknown[]> = (deps: MediaHandlerDeps, user: CurrentUser, req: Request, ...rest: Rest) => Promise<Actor | Response>;

const inQueriedSpace: Resolve<[]> = async (deps, user, req) => {
  const spaceId = spaceQuery(req);
  const actor = spaceId ? await actorIn(deps.db(), user, spaceId) : null;
  return actor ?? Response.json(SPACE_NOT_FOUND_BODY, { status: 404 });
};

const inAssetSpace: Resolve<[AssetRouteContext]> = async (deps, user, _req, ctx) => {
  const { id } = await ctx.params;
  const actor = await assetActor(deps.db(), user, id);
  if (!actor) throw assetGone(); // the same answer as an id that is not in the library
  return actor;
};

// Runs a handler's work and answers a failed Drive call as the media routes do: 502 with that one line logged, and a
// connection Google no longer honours as 409 STORAGE_BROKEN. A 401 from Google drops the kept sources.
export async function withDriveErrors(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ConnectionBrokenError) return Response.json(BROKEN_BODY, { status: 409 });
    if (!(error instanceof DriveError)) throw error;
    logDriveError(error);
    if (error.status === 401) forgetAllSources();
    return Response.json(STORAGE_DOWN_BODY, { status: 502 });
  }
}

// What every route does around its own work. `apiRoute` refuses a write from another site and answers what the
// service refuses. Then the member and their role in the space are looked up, before anything else is read. A failed
// Drive call is answered 502 with that one line logged, and a connection Google no longer honours, 409 STORAGE_BROKEN.
// Google refusing a token (401) means a kept one is no longer good: the kept sources are dropped, so the next
// request asks for a new one (and finds out if the connection is gone).
function mediaRoute<Rest extends unknown[]>(
  deps: MediaHandlerDeps,
  resolve: Resolve<Rest>,
  handler: (actor: Actor, req: Request, ...rest: Rest) => Promise<Response>,
) {
  return apiRoute(async (req: Request, ...rest: Rest): Promise<Response> => {
    const user = await deps.auth(req);
    if (user instanceof Response) return user;
    const actor = await resolve(deps, user, req, ...rest);
    if (actor instanceof Response) return actor;
    return withDriveErrors(() => handler(actor, req, ...rest));
  });
}

export function makeMediaHandlers(deps: MediaHandlerDeps) {
  // What the service needs to reach Drive. Null when media is not set up. A Drive failure the member is not shown
  // (a file that could not be moved to the trash) leaves the same one line.
  const media = async (actor: Actor): Promise<MediaDeps | null> => {
    const db = deps.db();
    const drive = await deps.drive(db, actor.spaceId);
    return drive ? { db, drive, origin: deps.origin(), onDriveError: logDriveError } : null;
  };

  // Whether uploads can be made, as the list tells it. Settings that cannot be read count as not set up, with one line
  // saying only that, and so does a broken connection, so the library still lists. Anything else (the database
  // failing) is not a "no": it comes out of the request.
  const isSetUp = async (spaceId: string): Promise<boolean> => {
    try {
      return (await deps.drive(deps.db(), spaceId)) !== null;
    } catch (error) {
      if (error instanceof ConnectionBrokenError) return false;
      if (!(error instanceof SettingsError)) throw error;
      console.error("Drive settings could not be read");
      return false;
    }
  };

  return {
    list: mediaRoute(deps, inQueriedSpace, async (actor, req) => {
      const ids = idsOf(req);
      const assets = await listAssets(deps.db(), actor, { ids });
      return Response.json({ assets, setUp: await isSetUp(actor.spaceId) });
    }),

    open: mediaRoute(deps, inQueriedSpace, async (actor, req) => {
      const service = await media(actor);
      if (!service) return notSetUp();
      const { asset, uploadUrl, offset } = await openUpload(
        { ...service, checkNew: () => checkAppBudget(service.db, actor.userId, "upload") },
        actor,
        await bodyOf(req, openBody),
      );
      return Response.json({ asset, uploadUrl, offset }, { status: 201 });
    }),

    update: mediaRoute(deps, inAssetSpace, async (actor, req, ctx: AssetRouteContext) => {
      const { id } = await ctx.params;
      const patch = await bodyOf(req, updateBody);
      return Response.json({ asset: await updateAsset(deps.db(), actor, id, patch) });
    }),

    remove: mediaRoute(deps, inAssetSpace, async (actor, _req, ctx: AssetRouteContext) => {
      const service = await media(actor);
      if (!service) return notSetUp();
      const { id } = await ctx.params;
      await removeAsset(service, actor, id);
      return new Response(null, { status: 204 });
    }),

    offset: mediaRoute(deps, inAssetSpace, async (actor, _req, ctx: AssetRouteContext) => {
      const service = await media(actor);
      if (!service) return notSetUp();
      const { id } = await ctx.params;
      const { uploadUrl, offset, done } = await uploadOffset(service, actor, id);
      return Response.json({ uploadUrl, offset, done });
    }),

    complete: mediaRoute(deps, inAssetSpace, async (actor, _req, ctx: AssetRouteContext) => {
      const service = await media(actor);
      if (!service) return notSetUp();
      const { id } = await ctx.params;
      return Response.json({ asset: await completeUpload(service, actor, id) });
    }),

    openFile: mediaRoute(deps, inAssetSpace, async (actor, req, ctx: AssetRouteContext) => {
      const service = await media(actor);
      if (!service) return notSetUp();
      const { id } = await ctx.params;
      const { uploadUrl } = await openAssetFile(service, actor, id, await bodyOf(req, openFileBody));
      return Response.json({ uploadUrl }, { status: 201 });
    }),

    completeFile: mediaRoute(deps, inAssetSpace, async (actor, req, ctx: AssetRouteContext) => {
      const service = await media(actor);
      if (!service) return notSetUp();
      const { id } = await ctx.params;
      const { role } = await bodyOf(req, completeFileBody);
      return Response.json({ asset: await completeAssetFile(service, actor, id, role) });
    }),

    transcript: mediaRoute(deps, inAssetSpace, async (actor, _req, ctx: AssetRouteContext) => {
      const { id } = await ctx.params;
      return Response.json({ transcript: await getTranscript(deps.db(), actor, id) });
    }),

    saveTranscript: mediaRoute(deps, inAssetSpace, async (actor, req, ctx: AssetRouteContext) => {
      const { id } = await ctx.params;
      const { words, model } = await bodyOf(req, transcriptBody);
      await saveTranscript(deps.db(), actor, id, { words: words as CaptionWord[], model });
      return Response.json({ ok: true });
    }),

    previewFailed: mediaRoute(deps, inAssetSpace, async (actor, _req, ctx: AssetRouteContext) => {
      const { id } = await ctx.params;
      return Response.json({ asset: await failPreview(deps.db(), actor, id) });
    }),
  };
}

// The token a browser reads media files with, for any signed-in member, and never kept by a cache: the space's reader
// (readerFor), which is a team's read-only reader, a personal space's own connection, or Seattle Solvers' read-only
// service account token.
export function makeReadTokenHandler(deps: MediaHandlerDeps): (req: Request) => Promise<Response> {
  return mediaRoute(deps, inQueriedSpace, async (actor) => {
    const reader = await deps.reader(deps.db(), actor.spaceId);
    if (!reader) return notSetUp();
    const { accessToken, expiresAt } = await reader.token(LIMITS.mediaReadTokenMinSeconds);
    return Response.json({ accessToken, expiresAt }, { headers: { "Cache-Control": "no-store" } });
  });
}
