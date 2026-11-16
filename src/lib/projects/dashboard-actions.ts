import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import { checkAppBudget } from "@/lib/app-budget";
import type { Role } from "@/lib/allowlist/service";
import { PROJECT_GONE } from "@/lib/dashboard/view";
import { createFolder, deleteFolder, FOLDER_GONE, moveProject, renameFolder } from "@/lib/projects/folders";
import { pinProject, unpinProject } from "@/lib/projects/pins";
import { createProject, deleteProject, duplicateProject, renameProject } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { actorIn } from "@/lib/spaces/access";
import { editorPath, slugFor } from "@/lib/spaces/paths";
import { listMySpaces } from "@/lib/spaces/service";

export type FormState = { error?: string };

// Not a member of the space (any more).
const SPACE_GONE = "You're not a member of this space.";

// Every space's dashboard is this one route; revalidate takes it as a page pattern.
export const SPACE_PAGE = "/s/[space]";

export type DashboardActionDeps = {
  db: () => DB;
  requireUser: (min?: Role) => Promise<CurrentUser>; // called with no argument; the role comes from the space
  revalidate: (path: string) => void;
  redirect: (path: string) => never;
};

const field = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

// An empty or missing side is no size at all; any other text goes to the service as a number, NaN included.
const side = (formData: FormData, key: string) => {
  const text = field(formData, key);
  return text === "" ? undefined : Number(text);
};

// An empty or missing folder is no folder.
const folder = (formData: FormData) => field(formData, "folderId") || null;

export function makeDashboardActions(deps: DashboardActionDeps) {
  // Runs one service call as the signed-in user, in the space. A ServiceError becomes a message for the page; anything
  // else rethrows.
  async function run<T>(
    spaceId: string,
    call: (db: DB, actor: Actor) => Promise<T>,
  ): Promise<{ value: T } | { error: string }> {
    const actor = await actorIn(deps.db(), await deps.requireUser(), spaceId);
    if (!actor) return { error: SPACE_GONE };
    try {
      return { value: await call(deps.db(), actor) };
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      if (error.code !== "NOT_FOUND") return { error: error.message };
      // Deleted elsewhere: refresh the list so its card or folder goes away.
      deps.revalidate(SPACE_PAGE);
      return { error: error.message === FOLDER_GONE ? FOLDER_GONE : PROJECT_GONE };
    }
  }

  async function change(spaceId: string, call: (db: DB, actor: Actor) => Promise<unknown>): Promise<FormState> {
    const result = await run(spaceId, call);
    if ("error" in result) return { error: result.error };
    deps.revalidate(SPACE_PAGE);
    return {};
  }

  return {
    async create(spaceId: string, _prev: FormState, formData: FormData): Promise<FormState> {
      const result = await run(spaceId, async (db, actor) => {
        await checkAppBudget(db, actor.userId, "project");
        const project = await createProject(db, actor, {
          name: field(formData, "name"),
          format: field(formData, "format"),
          width: side(formData, "width"),
          height: side(formData, "height"),
          folderId: folder(formData),
        });
        const space = (await listMySpaces(db, actor.userId)).find((s) => s.id === spaceId);
        return { id: project.id, slug: space ? slugFor(space) : "personal" };
      });
      if ("error" in result) return { error: result.error };
      return deps.redirect(editorPath(result.value.slug, result.value.id));
    },
    rename: (spaceId: string, formData: FormData) =>
      change(spaceId, (db, actor) => renameProject(db, actor, field(formData, "id"), field(formData, "name"))),
    remove: (spaceId: string, formData: FormData) =>
      change(spaceId, (db, actor) => deleteProject(db, actor, field(formData, "id"))),
    duplicate: (spaceId: string, formData: FormData) =>
      change(spaceId, async (db, actor) => {
        await checkAppBudget(db, actor.userId, "project");
        return duplicateProject(db, actor, field(formData, "id"));
      }),
    move: (spaceId: string, formData: FormData) =>
      change(spaceId, (db, actor) => moveProject(db, actor, field(formData, "id"), folder(formData))),
    pin: (spaceId: string, formData: FormData) =>
      change(spaceId, (db, actor) => pinProject(db, actor, field(formData, "id"))),
    unpin: (spaceId: string, formData: FormData) =>
      change(spaceId, (db, actor) => unpinProject(db, actor, field(formData, "id"))),
    createFolder: (spaceId: string, formData: FormData) =>
      change(spaceId, (db, actor) => createFolder(db, actor, field(formData, "name"))),
    renameFolder: (spaceId: string, formData: FormData) =>
      change(spaceId, (db, actor) => renameFolder(db, actor, field(formData, "id"), field(formData, "name"))),
    deleteFolder: (spaceId: string, formData: FormData) =>
      change(spaceId, (db, actor) => deleteFolder(db, actor, field(formData, "id"))),
  };
}

// Each action as the page binds it to its space: the space id is the first argument of every one.
export type SpaceDashboardActions = ReturnType<typeof makeDashboardActions>;

type WithoutSpace<F> = F extends (spaceId: string, ...rest: infer R) => infer T ? (...rest: R) => T : never;

// What the dashboard components call: the actions with their space already bound.
export type DashboardActions = { [K in keyof SpaceDashboardActions]: WithoutSpace<SpaceDashboardActions[K]> };
