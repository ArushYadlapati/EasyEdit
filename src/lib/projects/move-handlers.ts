import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { apiRoute } from "@/lib/api-route";
import { checkAppBudget } from "@/lib/app-budget";
import type { DriveClient } from "@/lib/drive/client";
import { withDriveErrors } from "@/lib/media/handlers";
import { ServiceError } from "@/lib/service-error";
import { projectActor } from "@/lib/spaces/access";
import { abandonMove, completeCopy, completeCopyFile, finishMove, openCopy, openCopyFile, startMove, type MoveDeps } from "./move";

export type MoveHandlerDeps = {
  db: () => DB;
  auth: (req: Request) => Promise<CurrentUser | Response>; // authentication only; the move's owner and the roles are checked by the service
  driveFor: (db: DB, spaceId: string) => Promise<DriveClient | null>;
  origin: () => string;
  storage?: MoveDeps["storage"]; // test-only: stands in for the real storage settings; unset in production
};

export type ProjectContext = { params: Promise<{ id: string }> };
export type MoveContext = { params: Promise<{ moveId: string }> };
export type CopyContext = { params: Promise<{ moveId: string; assetId: string }> };

const startBody = z.strictObject({ toSpaceId: z.string() });
const openBody = z.strictObject({ sourceAssetId: z.string() });
const role = z.enum(["preview", "poster"]);
const openFileBody = z.strictObject({ role, sizeBytes: z.number() });
const completeFileBody = z.strictObject({ role });

// A request's JSON body in the given shape. Anything else is refused as INVALID.
async function bodyOf<T>(req: Request, shape: z.ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ServiceError("INVALID", 400, "Body must be valid JSON");
  }
  const parsed = shape.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue.path.join(".");
    throw new ServiceError("INVALID", 400, path ? `${path}: ${issue.message}` : issue.message);
  }
  return parsed.data;
}

export function makeMoveHandlers(deps: MoveHandlerDeps) {
  const moveDeps = (): MoveDeps => {
    const db = deps.db();
    return { db, driveFor: (spaceId) => deps.driveFor(db, spaceId), origin: deps.origin(), storage: deps.storage };
  };

  // Every route: refuse a cross-site write, sign-in, then the work with Drive failures answered as the media routes do.
  function route<Rest extends unknown[]>(work: (user: CurrentUser, req: Request, ...rest: Rest) => Promise<Response>) {
    return apiRoute(async (req: Request, ...rest: Rest): Promise<Response> => {
      const user = await deps.auth(req);
      if (user instanceof Response) return user;
      return withDriveErrors(() => work(user, req, ...rest));
    });
  }

  return {
    start: route(async (user, req, ctx: ProjectContext) => {
      const { id } = await ctx.params;
      const actor = await projectActor(deps.db(), user, id);
      if (!actor) throw new ServiceError("NOT_FOUND", 404, `Project "${id}" not found`);
      const { toSpaceId } = await bodyOf(req, startBody);
      return Response.json(await startMove(moveDeps(), actor, { projectId: id, toSpaceId }), { status: 201 });
    }),

    abandon: route(async (user, _req, ctx: MoveContext) => {
      const { moveId } = await ctx.params;
      await abandonMove(moveDeps(), user.id, moveId);
      return new Response(null, { status: 204 });
    }),

    openCopy: route(async (user, req, ctx: MoveContext) => {
      const { moveId } = await ctx.params;
      const { sourceAssetId } = await bodyOf(req, openBody);
      const db = deps.db();
      const opened = await openCopy({ ...moveDeps(), checkNew: () => checkAppBudget(db, user.id, "upload") }, user.id, moveId, sourceAssetId);
      return Response.json(opened);
    }),

    completeCopy: route(async (user, _req, ctx: CopyContext) => {
      const { moveId, assetId } = await ctx.params;
      return Response.json(await completeCopy(moveDeps(), user.id, moveId, assetId));
    }),

    openCopyFile: route(async (user, req, ctx: CopyContext) => {
      const { moveId, assetId } = await ctx.params;
      const input = await bodyOf(req, openFileBody);
      return Response.json(await openCopyFile(moveDeps(), user.id, moveId, assetId, input));
    }),

    completeCopyFile: route(async (user, req, ctx: CopyContext) => {
      const { moveId, assetId } = await ctx.params;
      const { role } = await bodyOf(req, completeFileBody);
      return Response.json(await completeCopyFile(moveDeps(), user.id, moveId, assetId, role));
    }),

    finish: route(async (user, _req, ctx: MoveContext) => {
      const { moveId } = await ctx.params;
      return Response.json(await finishMove(moveDeps(), user.id, moveId));
    }),
  };
}
