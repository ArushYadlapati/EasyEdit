import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { apiRoute } from "@/lib/api-route";
import { actorIn, spaceQuery } from "@/lib/spaces/access";
import { deleteTemplate, getTemplate, listTemplates, saveTemplate, updateTemplate } from "./service";

export type TemplateHandlerDeps = { db: () => DB; auth: (req: Request) => Promise<CurrentUser | Response> };
export type TemplateRouteContext = { params: Promise<{ id: string }> };

const SPACE_NOT_FOUND = { code: "NOT_FOUND", message: "Space not found" } as const;
const invalid = (message: string) => Response.json({ code: "INVALID", message }, { status: 400 });

// Only the shape; the service checks lengths, names and the role.
const saveBody = z
  .object({
    projectId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    instructions: z.string().optional(),
    replace: z.boolean().optional(),
  })
  .strict();

const patchBody = z.object({ name: z.string(), description: z.string(), instructions: z.string() }).partial().strict();

// The member acting in the space named by `?space=`. Someone not in it gets what an unknown space gets.
async function spaceActor(deps: TemplateHandlerDeps, req: Request): Promise<Actor | Response> {
  const user = await deps.auth(req);
  if (user instanceof Response) return user;
  const spaceId = spaceQuery(req);
  const actor = spaceId ? await actorIn(deps.db(), user, spaceId) : null;
  return actor ?? Response.json(SPACE_NOT_FOUND, { status: 404 });
}

async function readBody<T extends z.ZodType>(req: Request, schema: T, what: string): Promise<z.infer<T> | Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return invalid("Body must be valid JSON");
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : invalid(`That is not ${what}.`);
}

// Templates of the space named by `?space=`. Any member reads; an editor saves, changes and deletes.
export function makeTemplateHandlers(deps: TemplateHandlerDeps) {
  return {
    list: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      return Response.json({ templates: await listTemplates(deps.db(), actor) });
    }),

    save: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      const body = await readBody(req, saveBody, "a template to save");
      if (body instanceof Response) return body;
      const result = await saveTemplate(deps.db(), actor, body);
      return Response.json(result, { status: result.replaced ? 200 : 201 });
    }),

    get: apiRoute(async (req: Request, ctx: TemplateRouteContext): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      const { id } = await ctx.params;
      const template = await getTemplate(deps.db(), actor, id);
      if (!template) return Response.json({ code: "NOT_FOUND", message: "Template not found" }, { status: 404 });
      return Response.json({ template });
    }),

    update: apiRoute(async (req: Request, ctx: TemplateRouteContext): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      const body = await readBody(req, patchBody, "a template change");
      if (body instanceof Response) return body;
      if (Object.keys(body).length === 0) return invalid("Name at least one thing to change.");
      const { id } = await ctx.params;
      await updateTemplate(deps.db(), actor, id, body);
      return new Response(null, { status: 204 });
    }),

    remove: apiRoute(async (req: Request, ctx: TemplateRouteContext): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      const { id } = await ctx.params;
      await deleteTemplate(deps.db(), actor, id);
      return new Response(null, { status: 204 });
    }),
  };
}
