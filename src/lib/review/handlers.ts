import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { apiRoute } from "@/lib/api-route";
import { checkAppBudget } from "@/lib/app-budget";
import { ServiceError } from "@/lib/service-error";
import { projectActor } from "@/lib/spaces/access";
import { addComment, deleteComment, listComments, updateComment } from "./comments";
import { deleteVersion, listVersions, openVersion, renameVersion, saveVersion } from "./versions";

// Authentication only: the role comes from the project's space, and the services check it.
export type ReviewHandlerDeps = { db: () => DB; auth: (req: Request) => Promise<CurrentUser | Response> };
export type ProjectContext = { params: Promise<{ id: string }> };
export type CommentContext = { params: Promise<{ id: string; commentId: string }> };
export type VersionContext = { params: Promise<{ id: string; versionId: string }> };

const NO_STORE = { headers: { "cache-control": "no-store" } };

// A person acting in the space the project belongs to. A project they cannot see answers as an unknown one does.
async function actorFor(deps: ReviewHandlerDeps, req: Request, projectId: string): Promise<Actor | Response> {
  const user = await deps.auth(req);
  if (user instanceof Response) return user;
  const actor = await projectActor(deps.db(), user, projectId);
  return actor ?? Response.json({ code: "NOT_FOUND", message: `Project "${projectId}" not found` }, { status: 404 });
}

// The request's JSON body as an object. Anything else is refused as INVALID.
async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  const json: unknown = await req.json().catch(() => undefined);
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new ServiceError("INVALID", 400, "Body must be a JSON object");
  return json as Record<string, unknown>;
}

// The JSON routes of review comments and named versions, under /api/projects/<id>/.
export function makeReviewHandlers(deps: ReviewHandlerDeps) {
  return {
    // GET comments: every comment of the project, by its moment.
    comments: apiRoute(async (req: Request, ctx: ProjectContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      return Response.json({ comments: await listComments(deps.db(), actor, id), me: actor.userId, role: actor.role }, NO_STORE);
    }),
    // POST comments { frame, body, parentId? }
    addComment: apiRoute(async (req: Request, ctx: ProjectContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      const { frame, body, parentId } = await bodyOf(req);
      return Response.json({ comment: await addComment(deps.db(), actor, id, { frame, body, parentId }) }, { status: 201 });
    }),
    // PATCH comments/<commentId> { body? , resolved? }
    updateComment: apiRoute(async (req: Request, ctx: CommentContext): Promise<Response> => {
      const { id, commentId } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      const { body, resolved } = await bodyOf(req);
      if (body === undefined && resolved === undefined) throw new ServiceError("INVALID", 400, "Give body or resolved");
      return Response.json({ comment: await updateComment(deps.db(), actor, id, commentId, { body, resolved }) });
    }),
    deleteComment: apiRoute(async (req: Request, ctx: CommentContext): Promise<Response> => {
      const { id, commentId } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      await deleteComment(deps.db(), actor, id, commentId);
      return new Response(null, { status: 204 });
    }),

    // GET versions: the project's named versions, newest first (without their timelines).
    versions: apiRoute(async (req: Request, ctx: ProjectContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      return Response.json({ versions: await listVersions(deps.db(), actor, id) }, NO_STORE);
    }),
    // POST versions { name }: keeps the timeline as it is now.
    saveVersion: apiRoute(async (req: Request, ctx: ProjectContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      const { name } = await bodyOf(req);
      return Response.json(await saveVersion(deps.db(), actor, id, name), { status: 201 });
    }),
    // PATCH versions/<versionId> { name }
    renameVersion: apiRoute(async (req: Request, ctx: VersionContext): Promise<Response> => {
      const { id, versionId } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      const { name } = await bodyOf(req);
      await renameVersion(deps.db(), actor, id, versionId, name);
      return new Response(null, { status: 204 });
    }),
    deleteVersion: apiRoute(async (req: Request, ctx: VersionContext): Promise<Response> => {
      const { id, versionId } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      await deleteVersion(deps.db(), actor, id, versionId);
      return new Response(null, { status: 204 });
    }),
    // POST versions/<versionId>/open: a new project with that timeline. Counts as making a project.
    openVersion: apiRoute(async (req: Request, ctx: VersionContext): Promise<Response> => {
      const { id, versionId } = await ctx.params;
      const actor = await actorFor(deps, req, id);
      if (actor instanceof Response) return actor;
      await checkAppBudget(deps.db(), actor.userId, "project");
      return Response.json(await openVersion(deps.db(), actor, id, versionId), { status: 201 });
    }),
  };
}
