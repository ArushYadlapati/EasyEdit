import { z } from "zod";
import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { apiRoute } from "@/lib/api-route";
import { actorIn, spaceQuery } from "@/lib/spaces/access";
import type { Actor } from "@/lib/actor";
import { getBrandKit, updateBrandKit } from "./service";

export type BrandHandlerDeps = { db: () => DB; auth: (req: Request) => Promise<CurrentUser | Response> };

const SPACE_NOT_FOUND = { code: "NOT_FOUND", message: "Space not found" } as const;
const invalid = (message: string) => Response.json({ code: "INVALID", message }, { status: 400 });

// The fields a change may name, and nothing else. What each must hold is the service's to check.
const patchBody = z
  .object({
    titleFont: z.string(),
    subtitleFont: z.string(),
    bodyFont: z.string(),
    colors: z.array(z.string()),
    logoAssetIds: z.array(z.string()),
  })
  .partial()
  .strict();

// The member acting in the space named by `?space=`. Someone not in it gets what an unknown space gets.
async function spaceActor(deps: BrandHandlerDeps, req: Request): Promise<Actor | Response> {
  const user = await deps.auth(req);
  if (user instanceof Response) return user;
  const spaceId = spaceQuery(req);
  const actor = spaceId ? await actorIn(deps.db(), user, spaceId) : null;
  return actor ?? Response.json(SPACE_NOT_FOUND, { status: 404 });
}

// GET /api/brand?space=<id>: any member reads the kit. PATCH: an editor changes the fields named.
export function makeBrandHandlers(deps: BrandHandlerDeps) {
  return {
    get: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      return Response.json(await getBrandKit(deps.db(), actor));
    }),

    patch: apiRoute(async (req: Request): Promise<Response> => {
      const actor = await spaceActor(deps, req);
      if (actor instanceof Response) return actor;
      let json: unknown;
      try {
        json = await req.json();
      } catch {
        return invalid("Body must be valid JSON");
      }
      const parsed = patchBody.safeParse(json);
      if (!parsed.success) return invalid("That is not a brand kit change.");
      return Response.json(await updateBrandKit(deps.db(), actor, parsed.data));
    }),
  };
}
