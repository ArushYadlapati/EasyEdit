import type { Role } from "@/lib/allowlist/service";
import { personalSpacesOpen } from "./personal";

// A space is a Better Auth organization: everyone's own personal space, or a team.
export type SpaceKind = "personal" | "team";
export type Space = { id: string; slug: string; name: string; kind: SpaceKind };
// A space the viewer is a member of, with their role in it.
export type MySpace = Space & { role: Role };

// The team migration 0012 moved every existing project, folder and upload into.
export const SEED_TEAM_ID = "team_seattle_solvers";
export const SEED_TEAM_SLUG = "seattle-solvers";
export const SEED_TEAM_NAME = "Seattle Solvers";

// Whether an AI agent acting for the person can create or change anything: some space gives them editor or admin.
// Everyone is an admin of their own personal space, so where those are offered it always can. While they are not
// (personalSpacesOpen), only teams count: nothing new is made in a personal space, so a viewer of their teams is told
// their agents can only read.
export function canChangeInAnySpace(spaces: MySpace[], env: NodeJS.ProcessEnv = process.env): boolean {
  const open = personalSpacesOpen(env);
  return spaces.some((space) => space.role !== "viewer" && (open || space.kind === "team"));
}

// The address alias /s/personal: the viewer's own personal space.
export const PERSONAL_ALIAS = "personal";

// A personal space's id. Its slug is the same id.
export function personalSpaceId(userId: string): string {
  return `personal_${userId}`;
}
