import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { requireRole, type Actor } from "@/lib/actor";
import { apiRoute } from "@/lib/api-route";
import { unpackBytes } from "@/lib/color/cube";
import { LIMITS } from "@/lib/limits";
import type { SocialConfig } from "@/lib/social/config";
import { actorIn, spaceQuery } from "@/lib/spaces/access";
import { addFromChannel, channelStatus } from "./channel";
import { STYLE_MESSAGES } from "./messages";
import {
  addLinkReference,
  addProjectReference,
  addVideoReference,
  failVideoAnalysis,
  getStyle,
  listReferences,
  referenceSheet,
  removeReference,
  saveVideoAnalysis,
  spaceOfReference,
  updateStyle,
} from "./service";
import type { StyleProfilePatch } from "./types";

// What the /api/style routes need: the database, and who is signed in (authentication only; the role comes from the
// space). fetch is what a pasted link's site, and YouTube, are asked with; the real one when left out. config is this
// server's YouTube settings, for picking videos from the space's channel; left out, there is no YouTube.
export type StyleHandlerDeps = {
  db: () => DB;
  auth: (req: Request) => Promise<CurrentUser | Response>;
  fetch?: typeof fetch;
  config?: () => SocialConfig | null;
};

// The id a reference route names in its path.
export type StyleReferenceRouteContext = { params: Promise<{ id: string }> };

const SPACE_NOT_FOUND = { code: "NOT_FOUND", message: "Space not found" } as const;
const REFERENCE_NOT_FOUND = { code: "NOT_FOUND", message: STYLE_MESSAGES.referenceGone } as const;
const invalid = (message: string) => Response.json({ code: "INVALID", message }, { status: 400 });

// The longest a strip of frames can be once it is base64 text, and the most an analysis body may be in all: the
// strip plus room for the measurements (400 cut times and a dozen frame times are a few KB).
const SHEET_TEXT_CHARS = Math.ceil(LIMITS.styleSheetBytes / 3) * 4;
const ANALYSIS_BODY_BYTES = SHEET_TEXT_CHARS + 64 * 1024;

const ID = z.string().min(1).max(100);

// The shape of each body, with unknown keys refused. What each must hold is the service's to check.
const isObject = (value: unknown) => typeof value === "object" && value !== null && !Array.isArray(value);
const patchBody = z.strictObject({
  profile: z.custom<StyleProfilePatch>(isObject).optional(),
  notes: z.string().optional(),
});
// A link of any length is the link reader's to refuse, so a long one is told what to paste instead.
const referenceBody = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("video"), assetId: ID }),
  z.strictObject({ kind: z.literal("link"), url: z.string() }),
  z.strictObject({ kind: z.literal("project"), projectId: ID }),
  z.strictObject({ kind: z.literal("channel"), videoId: ID }),
]);
// A browser's measurements of a video and its strip of frames as base64 JPEG, or why it couldn't measure it.
const analysisBody = z.union([z.strictObject({ analysis: z.unknown(), sheet: z.string().optional() }), z.strictObject({ failed: z.string().max(2000) })]);

// The request's JSON body in the given shape, or the 400 to answer: "Body must be valid JSON" when it isn't JSON, and
// "That isn't a style change." (or the shape's own words) when it doesn't fit.
async function bodyOf<T>(req: Request, shape: z.ZodType<T>, refusal: (error: z.ZodError) => string): Promise<T | Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return invalid("Body must be valid JSON");
  }
  const parsed = shape.safeParse(json);
  return parsed.success ? parsed.data : invalid(refusal(parsed.error));
}

const notAChange = () => STYLE_MESSAGES.notAStyleChange;

// The member acting in the space named by `?space=`. Someone not in it gets what an unknown space gets.
async function spaceActor(deps: StyleHandlerDeps, req: Request): Promise<Actor | Response> {
  const user = await deps.auth(req);
  if (user instanceof Response) return user;
  const spaceId = spaceQuery(req);
  const actor = spaceId ? await actorIn(deps.db(), user, spaceId) : null;
  return actor ?? Response.json(SPACE_NOT_FOUND, { status: 404 });
}

// The member acting in the space the reference in the path belongs to, and its id. Someone not in that space gets
// what an unknown reference gets.
async function referenceActor(deps: StyleHandlerDeps, req: Request, ctx: StyleReferenceRouteContext): Promise<{ actor: Actor; id: string } | Response> {
  const user = await deps.auth(req);
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const spaceId = await spaceOfReference(deps.db(), id);
  const actor = spaceId ? await actorIn(deps.db(), user, spaceId) : null;
  return actor ? { actor, id } : Response.json(REFERENCE_NOT_FOUND, { status: 404 });
}

// GET /api/style?space=<id>: any member reads the style. PATCH: an editor changes the fields named.
// GET /api/style/references?space=<id>: any member lists what the style learns from. POST: an editor adds a video,
// a link, a past project or an upload of the space's YouTube channel (by its id). DELETE /api/style/references/<id>:
// an editor removes one. PUT …/<id>/analysis: an editor's browser saves what it measured in a video, or says why it
// couldn't. GET …/<id>/sheet: a measured video's strip of frames, a JPEG. GET /api/style/channel?space=<id>: an
// editor sees the space's YouTube channel and its newest uploads, to pick from.
export function makeStyleHandlers(deps: StyleHandlerDeps) {
  const youtube = () => deps.config?.() ?? null;

  return {
    get: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      return Response.json(await getStyle(deps.db(), actor));
    }),

    patch: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      const body = await bodyOf(req, patchBody, notAChange);
      if (body instanceof Response) return body;
      return Response.json(await updateStyle(deps.db(), actor, body));
    }),

    references: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      return Response.json({ references: await listReferences(deps.db(), actor) });
    }),

    addReference: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      const body = await bodyOf(req, referenceBody, notAChange);
      if (body instanceof Response) return body;
      const db = deps.db();
      const reference =
        body.kind === "video"
          ? await addVideoReference(db, actor, body.assetId)
          : body.kind === "link"
            ? await addLinkReference(db, actor, body.url, deps.fetch)
            : body.kind === "project"
              ? await addProjectReference(db, actor, body.projectId)
              : await addFromChannel(db, actor, youtube(), body.videoId, deps.fetch);
      return Response.json({ reference }, { status: 201 });
    }),

    channel: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      return Response.json(await channelStatus(deps.db(), actor, youtube(), deps.fetch), { headers: { "cache-control": "no-store" } });
    }),

    removeReference: apiRoute(async (req: Request, ctx: StyleReferenceRouteContext): Promise<Response> => {
      const found = await referenceActor(deps, req, ctx);
      if (found instanceof Response) return found;
      await removeReference(deps.db(), found.actor, found.id);
      return new Response(null, { status: 204 });
    }),

    // The one handler that checks the role itself: a viewer's body isn't read at all. A body that says it is bigger
    // than a strip and its measurements can be is refused before it is read, and the strip's text is measured before
    // it is decoded. The service checks the role, the measurements and the strip's bytes again.
    analysis: apiRoute(async (req: Request, ctx: StyleReferenceRouteContext): Promise<Response> => {
      const found = await referenceActor(deps, req, ctx);
      if (found instanceof Response) return found;
      requireRole(found.actor, "editor");
      const length = req.headers.get("content-length");
      if (length !== null && Number(length) > ANALYSIS_BODY_BYTES) return invalid(STYLE_MESSAGES.sheetTooBig);
      const body = await bodyOf(req, analysisBody, () => STYLE_MESSAGES.badAnalysis);
      if (body instanceof Response) return body;
      const db = deps.db();
      if ("failed" in body) return Response.json({ reference: await failVideoAnalysis(db, found.actor, found.id, body.failed) });
      if (body.sheet !== undefined && body.sheet.length > SHEET_TEXT_CHARS) return invalid(STYLE_MESSAGES.sheetTooBig);
      const sheet = body.sheet === undefined ? null : unpackBytes(body.sheet);
      if (sheet === null && body.sheet !== undefined) return invalid(STYLE_MESSAGES.badAnalysis);
      return Response.json({ reference: await saveVideoAnalysis(db, found.actor, found.id, body.analysis, sheet) });
    }),

    sheet: apiRoute(async (req: Request, ctx: StyleReferenceRouteContext): Promise<Response> => {
      const found = await referenceActor(deps, req, ctx);
      if (found instanceof Response) return found;
      const jpeg = await referenceSheet(deps.db(), found.actor, found.id);
      if (!jpeg) return Response.json(REFERENCE_NOT_FOUND, { status: 404 });
      return new Response(jpeg, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
      });
    }),
  };
}
