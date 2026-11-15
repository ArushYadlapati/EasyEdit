import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import type { Actor } from "@/lib/actor";
import type { Role } from "@/lib/allowlist/service";
import { PROJECT_GONE } from "@/lib/dashboard/view";
import { createFolder, deleteFolder, FOLDER_GONE, moveProject, renameFolder } from "@/lib/projects/folders";
import { createProject, deleteProject, duplicateProject, renameProject } from "@/lib/projects/service";
import { ServiceError } from "@/lib/service-error";
import { actorIn } from "@/lib/spaces/access";
import { SEED_TEAM_ID } from "@/lib/spaces/types";

export type FormState = { error?: string };

// Not a member of the space (any more).
const SPACE_GONE = "You're not a member of this space.";

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
  async function run<T>(call: (db: DB, actor: Actor) => Promise<T>): Promise<{ value: T } | { error: string }> {
    // stage-1: space comes from Task 5
    const actor = await actorIn(deps.db(), await deps.requireUser(), SEED_TEAM_ID);
    if (!actor) return { error: SPACE_GONE };
    try {
      return { value: await call(deps.db(), actor) };
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      if (error.code !== "NOT_FOUND") return { error: error.message };
      // Deleted elsewhere: refresh the list so its card or folder goes away.
      deps.revalidate("/dashboard");
      return { error: error.message === FOLDER_GONE ? FOLDER_GONE : PROJECT_GONE };
    }
  }

  async function change(call: (db: DB, actor: Actor) => Promise<unknown>): Promise<FormState> {
    const result = await run(call);
    if ("error" in result) return { error: result.error };
    deps.revalidate("/dashboard");
    return {};
  }

  return {
    async create(_prev: FormState, formData: FormData): Promise<FormState> {
      const result = await run((db, actor) =>
        createProject(db, actor, {
          name: field(formData, "name"),
          format: field(formData, "format"),
          width: side(formData, "width"),
          height: side(formData, "height"),
          folderId: folder(formData),
        }),
      );
      if ("error" in result) return { error: result.error };
      return deps.redirect(`/editor/${result.value.id}`);
    },
    rename: (formData: FormData) =>
      change((db, actor) => renameProject(db, actor, field(formData, "id"), field(formData, "name"))),
    remove: (formData: FormData) => change((db, actor) => deleteProject(db, actor, field(formData, "id"))),
    duplicate: (formData: FormData) => change((db, actor) => duplicateProject(db, actor, field(formData, "id"))),
    move: (formData: FormData) =>
      change((db, actor) => moveProject(db, actor, field(formData, "id"), folder(formData))),
    createFolder: (formData: FormData) => change((db, actor) => createFolder(db, actor, field(formData, "name"))),
    renameFolder: (formData: FormData) =>
      change((db, actor) => renameFolder(db, actor, field(formData, "id"), field(formData, "name"))),
    deleteFolder: (formData: FormData) => change((db, actor) => deleteFolder(db, actor, field(formData, "id"))),
  };
}

export type DashboardActions = ReturnType<typeof makeDashboardActions>;
