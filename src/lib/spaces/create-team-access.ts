import { openSignUp } from "@/lib/signup";
import { SEED_TEAM_ID, type MySpace } from "./types";

// Anyone may make a team while sign-up is open; before that, only an admin of Seattle Solvers.
export function canCreateTeam(spaces: readonly MySpace[], env: NodeJS.ProcessEnv = process.env): boolean {
  return openSignUp(env) || spaces.some((s) => s.id === SEED_TEAM_ID && s.role === "admin");
}
