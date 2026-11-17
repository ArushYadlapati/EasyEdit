import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { requireRole, type Actor } from "@/lib/actor";
import { apiRoute } from "@/lib/api-route";
import { checkAppBudget } from "@/lib/app-budget";
import { LIMITS } from "@/lib/limits";
import { actorUserId, displayActor } from "@/lib/projects/display-actor";
import { recordOpen } from "@/lib/projects/opens";
import { checkIn, leavePresence, type Share } from "@/lib/projects/presence";
import {
  applyProjectOps,
  createProject,
  deleteProject,
  duplicateProject,
  getAppliedRequest,
  getOpsSince,
  getProject,
  getProjectVersion,
  listProjects,
  renameProject,
} from "@/lib/projects/service";
import { readThumbnail, saveThumbnail, THUMBNAIL_TOO_LARGE } from "@/lib/projects/thumbnails";
import { getUserNames } from "@/lib/projects/user-names";
import type { ErrorBody } from "@/lib/service-error";
import { actorIn, projectActor, spaceQuery } from "@/lib/spaces/access";
import type { OpInput } from "@/lib/timeline";

// Authentication only: the role comes from the space, and the service checks it.
export type HandlerDeps = {
  db: () => DB;
  auth: (req: Request) => Promise<CurrentUser | Response>;
};

export type ProjectRouteContext = { params: Promise<{ id: string }> };

const opsBody = z.object({
  baseVersion: z.number().int().min(0),
  ops: z.array(z.unknown()).min(1),
  strict: z.boolean().optional(),
  requestId: z.string().optional(), // the service checks its format
});

// Only the shape; the service checks the name, format and size themselves. A project made here goes in no folder.
const createBody = z.object({
  name: z.string(),
  format: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const renameBody = z.object({ name: z.string() });

// Versions are Postgres integers.
const sinceParam = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(2_147_483_647));

const limitParam = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(LIMITS.opsPageMax));

function errorResponse(status: number, body: ErrorBody): Response {
  return Response.json(body, { status });
}

const invalid = (message: string) => errorResponse(400, { code: "INVALID", message });

const notFound = (id: string) => errorResponse(404, { code: "NOT_FOUND", message: `Project "${id}" not found` });

// A person acting in the space the request names in ?space=. A missing space, or one they are not a member of, answers
// 404, as an unknown space would.
async function collectionActor(deps: HandlerDeps, req: Request): Promise<Actor | Response> {
  const user = await deps.auth(req);
  if (user instanceof Response) return user;
  const spaceId = spaceQuery(req);
  const actor = spaceId ? await actorIn(deps.db(), user, spaceId) : null;
  return actor ?? errorResponse(404, { code: "NOT_FOUND", message: "Space not found" });
}

// A person acting in the space the project belongs to. A project they cannot see (unknown, deleted, or in a space
// they are not a member of) answers exactly as an unknown project does. `whenGone` replaces that answer for the
// routes that answer 204 for an unknown project.
async function itemActor(deps: HandlerDeps, req: Request, id: string, whenGone: () => Response = () => notFound(id)): Promise<Actor | Response> {
  const user = await deps.auth(req);
  if (user instanceof Response) return user;
  return (await projectActor(deps.db(), user, id)) ?? whenGone();
}

function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false };
  }
}

const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/; // the request-id character set (service.ts:62)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fitsId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= LIMITS.presenceIdChars;

// The body as text, or null when there is none or it passes the limit. Counted as it streams, so a chunked body with
// no content-length is cut off too.
async function readCappedText(req: Request, maxBytes: number): Promise<string | null> {
  const length = req.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes) return null;
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// The share in a check's body, cleaned. Null when the body is too large, is not a JSON object, or has no valid tabId;
// the check then answers the version alone. With a valid tabId the rest is cleaned, never refused, so a tab that keeps
// checking stays listed.
async function readShare(req: Request): Promise<Share | null> {
  const text = await readCappedText(req, LIMITS.presenceBodyBytes);
  if (text === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(body)) return null;
  const { tabId, clipIds, trackId, changedAgoMs } = body;
  if (typeof tabId !== "string" || !TAB_ID.test(tabId)) return null;
  const ids = Array.isArray(clipIds) ? clipIds.filter(fitsId) : [];
  return {
    tabId,
    clipIds: [...new Set(ids)].sort().slice(0, LIMITS.presenceClipIds),
    trackId: fitsId(trackId) ? trackId : null,
    changedAgoMs:
      typeof changedAgoMs === "number" && Number.isFinite(changedAgoMs)
        ? Math.min(Math.max(Math.round(changedAgoMs), 0), LIMITS.presenceKeepMs)
        : 0,
  };
}

export function makeProjectHandlers(deps: HandlerDeps) {
  return {
    list: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await collectionActor(deps, req);
      if (actor instanceof Response) return actor;
      return Response.json({ projects: await listProjects(deps.db(), actor) });
    }),

    create: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await collectionActor(deps, req);
      if (actor instanceof Response) return actor;
      const json = await readJson(req);
      if (!json.ok) return invalid("Body must be valid JSON");
      const parsed = createBody.safeParse(json.value);
      if (!parsed.success) return invalid(describeIssue(parsed.error));
      await checkAppBudget(deps.db(), actor.userId, "project");
      const { id } = await createProject(deps.db(), actor, parsed.data);
      return Response.json({ id }, { status: 201 });
    }),

    get: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      const project = await getProject(deps.db(), actor, id);
      if (!project) return notFound(id);
      return Response.json({
        id: project.id,
        name: project.name,
        format: project.format,
        doc: project.doc,
        version: project.version,
      });
    }),

    version: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      const version = await getProjectVersion(deps.db(), actor, id);
      if (version === null) return notFound(id);
      // The space too, so an open editor learns the project has moved.
      return Response.json({ version, spaceId: actor.spaceId });
    }),

    rename: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      const json = await readJson(req);
      if (!json.ok) return invalid("Body must be valid JSON");
      const parsed = renameBody.safeParse(json.value);
      if (!parsed.success) return invalid(describeIssue(parsed.error));
      return Response.json(await renameProject(deps.db(), actor, id, parsed.data.name));
    }),

    remove: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      await deleteProject(deps.db(), actor, id);
      return new Response(null, { status: 204 });
    }),

    duplicate: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      await checkAppBudget(deps.db(), actor.userId, "project");
      const copy = await duplicateProject(deps.db(), actor, id);
      return Response.json({ id: copy.id }, { status: 201 });
    }),

    // An unknown or deleted project records nothing and still answers 204: there is nothing to tell the editor.
    opened: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id, () => new Response(null, { status: 204 }));
      if (actor instanceof Response) return actor;
      await recordOpen(deps.db(), actor, id);
      return new Response(null, { status: 204 });
    }),

    // The editor's check for changes, carrying this tab's selection. The version is answered exactly as GET /version
    // answers it, and nothing about the selection can make the check fail.
    presence: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      const answer = await checkIn(deps.db(), actor, id, await readShare(req));
      if (!answer) return notFound(id);
      return Response.json(answer);
    }),

    // A tab going away. An unknown tab or project still answers 204: there is nothing to tell a closing page.
    leave: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id, () => new Response(null, { status: 204 }));
      if (actor instanceof Response) return actor;
      const tab = new URL(req.url).searchParams.get("tab");
      if (tab !== null && TAB_ID.test(tab)) await leavePresence(deps.db(), actor, id, tab);
      return new Response(null, { status: 204 });
    }),

    // A year-long cache only under the stored picture's own version, so another `v` never pins the wrong picture.
    getThumbnail: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      const stored = await readThumbnail(deps.db(), actor, id);
      if (!stored) return notFound(id);
      const v = sinceParam.safeParse(new URL(req.url).searchParams.get("v"));
      return new Response(stored.jpeg, {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": v.success && v.data === stored.version ? "private, max-age=31536000, immutable" : "private, no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }),

    // The one handler that checks the role itself: a viewer's body, like a bad version or a declared length over the
    // limit, is refused before it is read. The service checks the role, the size and the type again.
    putThumbnail: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      requireRole(actor, "editor");
      const v = sinceParam.safeParse(new URL(req.url).searchParams.get("v"));
      if (!v.success) return invalid("v must be a non-negative integer");
      const length = req.headers.get("content-length");
      if (length !== null && Number(length) > LIMITS.thumbnailBytes) {
        return errorResponse(400, { code: "LIMIT_EXCEEDED", message: THUMBNAIL_TOO_LARGE });
      }
      const jpeg = new Uint8Array(await req.arrayBuffer());
      const { saved } = await saveThumbnail(deps.db(), actor, id, v.data, jpeg);
      return Response.json({ saved });
    }),
  };
}

export function makeOpsHandlers(deps: HandlerDeps) {
  return {
    getSince: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      const since = sinceParam.safeParse(new URL(req.url).searchParams.get("since"));
      if (!since.success) return invalid("since must be a non-negative integer");
      const rawLimit = new URL(req.url).searchParams.get("limit");
      const limit = rawLimit === null ? undefined : limitParam.safeParse(rawLimit);
      if (limit && !limit.success) return invalid(`limit must be an integer from 1 to ${LIMITS.opsPageMax}`);
      const result = await getOpsSince(deps.db(), actor, id, since.data, limit?.data);
      if (!result) return notFound(id);
      const names = result.entries.length
        ? await getUserNames(deps.db(), result.entries.map((e) => actorUserId(e.actor)))
        : new Map<string, string>();
      const entries = result.entries.map((e) => ({ ...e, actorName: displayActor(e.actor, names) }));
      return Response.json({ ...result, entries });
    }),

    postOps: apiRoute(async (req: Request, ctx: ProjectRouteContext): Promise<Response> => {
      const { id } = await ctx.params;
      const actor = await itemActor(deps, req, id);
      if (actor instanceof Response) return actor;
      const json = await readJson(req);
      if (!json.ok) return invalid("Body must be valid JSON");
      const parsed = opsBody.safeParse(json.value);
      if (!parsed.success) return invalid(describeIssue(parsed.error));
      // A retry of a request that already landed is answered by the service, so it costs nothing and is never refused.
      const { requestId } = parsed.data;
      const retry = requestId !== undefined && (await getAppliedRequest(deps.db(), actor, id, requestId)) !== null;
      if (!retry) await checkAppBudget(deps.db(), actor.userId, "edit");
      const { version, ops, inverse } = await applyProjectOps(deps.db(), actor, {
        projectId: id,
        baseVersion: parsed.data.baseVersion,
        ops: parsed.data.ops as OpInput[],
        strict: parsed.data.strict,
        requestId: parsed.data.requestId,
      });
      return Response.json({ version, ops, inverse });
    }),
  };
}
