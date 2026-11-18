import "server-only";
import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { apiRoute } from "@/lib/api-route";
import { ServiceError } from "@/lib/service-error";
import type { SocialConfig } from "./config";
import { cancelPost, finishPost, postingStatus, postOffset, startPost } from "./posts";
import { VISIBILITIES } from "./rules";

export type PostHandlerDeps = {
  db: () => DB;
  auth: (req: Request) => Promise<CurrentUser | Response>;
  config: () => SocialConfig | null;
  fetch?: typeof fetch;
};

export type PostRouteContext = { params: Promise<{ id: string }> };

export const NOT_SET_UP_BODY = { code: "NOT_SET_UP", message: "Posting to YouTube isn't set up on this server." } as const;

const startBody = z.strictObject({
  projectId: z.string().min(1).max(64),
  title: z.string().max(1000),
  description: z.string().max(20_000),
  visibility: z.enum(VISIBILITIES),
  madeForKids: z.boolean(),
  sizeBytes: z.number().int().positive(),
});
const finishBody = z.strictObject({ videoId: z.string().max(64).optional() });
const cancelBody = z.strictObject({ failed: z.boolean().optional() });

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

// The JSON routes of posting to YouTube. Each checks the session itself; the service checks the person's role in
// the project's space, and that a post is the caller's own.
export function makePostHandlers(deps: PostHandlerDeps) {
  // The signed-in person and this server's posting settings, or the answer that ends the request.
  type Ready = { user: CurrentUser; post: { config: SocialConfig; fetch?: typeof fetch } };
  async function ready(req: Request): Promise<Ready | Response> {
    const user = await deps.auth(req);
    if (user instanceof Response) return user;
    const config = deps.config();
    if (!config) return Response.json(NOT_SET_UP_BODY, { status: 503 });
    return { user, post: { config, fetch: deps.fetch } };
  }

  return {
    // GET /api/social/youtube/status?project=<id>: what the editor needs to offer posting. Never an error for a
    // server without posting: the editor just shows no button.
    status: apiRoute(async (req: Request): Promise<Response> => {
      const user = await deps.auth(req);
      if (user instanceof Response) return user;
      const projectId = new URL(req.url).searchParams.get("project") ?? "";
      return Response.json(await postingStatus(deps.db(), deps.config(), user.id, projectId), { headers: { "cache-control": "no-store" } });
    }),

    // POST /api/social/youtube/posts: starts a post. 201 with the post's id and the upload's address.
    start: apiRoute(async (req: Request): Promise<Response> => {
      const got = await ready(req);
      if (got instanceof Response) return got;
      const { projectId, sizeBytes, ...form } = await bodyOf(req, startBody);
      const started = await startPost(deps.db(), got.post, { userId: got.user.id, projectId, form, sizeBytes });
      return Response.json(started, { status: 201, headers: { "cache-control": "no-store" } });
    }),

    // POST /api/social/youtube/posts/<id>/offset: how much of the upload YouTube holds.
    offset: apiRoute(async (req: Request, ctx: PostRouteContext): Promise<Response> => {
      const got = await ready(req);
      if (got instanceof Response) return got;
      return Response.json(await postOffset(deps.db(), got.post, { userId: got.user.id, postId: (await ctx.params).id }));
    }),

    // POST /api/social/youtube/posts/<id>/finish: every byte was sent; records the post and answers with its link.
    finish: apiRoute(async (req: Request, ctx: PostRouteContext): Promise<Response> => {
      const got = await ready(req);
      if (got instanceof Response) return got;
      const { videoId } = await bodyOf(req, finishBody);
      return Response.json(await finishPost(deps.db(), got.post, { userId: got.user.id, postId: (await ctx.params).id, videoId }));
    }),

    // POST /api/social/youtube/posts/<id>/cancel: the person stopped it, or their browser gave up (failed: true).
    cancel: apiRoute(async (req: Request, ctx: PostRouteContext): Promise<Response> => {
      const got = await ready(req);
      if (got instanceof Response) return got;
      const { failed } = await bodyOf(req, cancelBody);
      // How the post ended: "posted" when YouTube turned out to have the whole video after all.
      return Response.json(await cancelPost(deps.db(), got.post, { userId: got.user.id, postId: (await ctx.params).id, failed }));
    }),
  };
}
