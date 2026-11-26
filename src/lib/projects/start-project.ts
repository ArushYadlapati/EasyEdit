import type { DB } from "@/db";
import type { CurrentUser } from "@/lib/access-rules";
import { PERSONAL_SOON, personalSpacesOpen } from "@/lib/spaces/personal";
import { ensurePersonalSpace, lastSpace, listMySpaces } from "@/lib/spaces/service";
import type { MySpace } from "@/lib/spaces/types";
import { makeDashboardActions, type DashboardActionDeps, type FormState } from "./dashboard-actions";

// No space this person may make a project in.
export const NOWHERE_TO_START = "You can only view the spaces you're in, so EasyEdit can't make a project for you yet.";

// A space a new project may go in: one the person edits in, and not a personal space while those are not offered.
function canStartIn(space: MySpace, open: boolean): boolean {
  return space.role !== "viewer" && (open || space.kind === "team");
}

// Where the project asked for on the home page goes: the space the dashboard would open (the one used last, or the
// Personal space of a new account), or, when the person cannot make one there, their Personal space, then their first
// team they edit in. Null when there is none.
export async function startSpace(db: DB, user: CurrentUser, env: NodeJS.ProcessEnv = process.env): Promise<MySpace | null> {
  const open = personalSpacesOpen(env);
  await ensurePersonalSpace(db, user); // lastSpace falls back on it
  const last = await lastSpace(db, user.id, env);
  if (canStartIn(last, open)) return last;
  const spaces = await listMySpaces(db, user.id);
  return spaces.find((s) => s.kind === "personal" && canStartIn(s, open)) ?? spaces.find((s) => canStartIn(s, open)) ?? null;
}

// Makes the project the home page's form asked for, with the dashboard's own create (the same name, format and size
// checks and the same daily limit), and opens it in the editor (deps.redirect). A refusal comes back as words to show.
export async function startProject(deps: DashboardActionDeps, formData: FormData, env: NodeJS.ProcessEnv = process.env): Promise<FormState> {
  const user = await deps.requireUser();
  const space = await startSpace(deps.db(), user, env);
  if (!space) return { error: personalSpacesOpen(env) ? NOWHERE_TO_START : PERSONAL_SOON.noTeam };
  return makeDashboardActions(deps).create(space.id, {}, formData);
}
